/**
 * @file zip.js
 * @description Self-contained ZIP subsystem for importing multi-file app bundles — a central-directory
 *   ZIP reader (extractZip; handles the data-descriptor streamed zips git/GitHub produce) and an inline
 *   bundler (bundleZip) that folds a bundle's CSS/JS/images into one self-contained HTML document via
 *   data: URIs. Pure byte/string work (DecompressionStream, TextDecoder, btoa) — no app state, no DOM.
 *   mimeFromExtension + toBase64 are internal helpers. Carved out of main.js.
 * @usage import { extractZip, bundleZip } from './zip.js'
 * @version-history
 *   v1.0.0 — 2026-07-10 — Initial extraction (TARGET-021 Aalto 3 modularization, phase 6 / A).
 */

// ── ZIP Helpers ────────────────────────────────

function mimeFromExtension(name) {
  var ext = (name.split('.').pop() || '').toLowerCase();
  var map = {
    html: 'text/html', htm: 'text/html',
    css: 'text/css',
    js: 'application/javascript', mjs: 'application/javascript',
    json: 'application/json',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    ico: 'image/x-icon',
    woff: 'font/woff', woff2: 'font/woff2',
    ttf: 'font/ttf', otf: 'font/otf',
    eot: 'application/vnd.ms-fontobject',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
    mp4: 'video/mp4', webm: 'video/webm',
    xml: 'application/xml',
    txt: 'text/plain',
    pdf: 'application/pdf'
  };
  return map[ext] || 'application/octet-stream';
}

function toBase64(uint8arr) {
  var binary = '';
  for (var i = 0; i < uint8arr.length; i++) {
    binary += String.fromCharCode(uint8arr[i]);
  }
  return btoa(binary);
}

// ── Minimal ZIP Parser ────────────────────────────

export async function extractZip(arrayBuffer) {
  var view = new DataView(arrayBuffer);
  var files = [];

  // Parse via the CENTRAL DIRECTORY, not the local headers: when the data-descriptor bit
  // (general-purpose flag bit 3) is set — git archive, GitHub "Download ZIP", streamed zips —
  // the local header carries compressedSize 0 (the real size lives in a trailing descriptor),
  // which used to truncate every file to zero bytes. The central directory always has the
  // authoritative sizes.
  // 1. Find the End Of Central Directory record (0x06054b50), scanning back from the end.
  var eocd = -1;
  for (var p = view.byteLength - 22; p >= 0; p--) {
    if (view.getUint32(p, true) === 0x06054b50) { eocd = p; break; }
  }
  if (eocd === -1) throw new Error('Not a valid ZIP (no end-of-central-directory record)');
  var cdCount = view.getUint16(eocd + 10, true);
  var cdPos = view.getUint32(eocd + 16, true);

  for (var n = 0; n < cdCount && cdPos + 46 <= view.byteLength; n++) {
    if (view.getUint32(cdPos, true) !== 0x02014b50) break; // central-directory file header
    var compressionMethod = view.getUint16(cdPos + 10, true);
    var compressedSize = view.getUint32(cdPos + 20, true);
    var nameLen = view.getUint16(cdPos + 28, true);
    var extraLen = view.getUint16(cdPos + 30, true);
    var commentLen = view.getUint16(cdPos + 32, true);
    var localOffset = view.getUint32(cdPos + 42, true);
    var name = new TextDecoder().decode(new Uint8Array(arrayBuffer, cdPos + 46, nameLen));
    cdPos += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue; // directory
    if (view.getUint32(localOffset, true) !== 0x04034b50) continue; // not a local header

    // The data starts after the LOCAL header's name + extra fields (its extra length can
    // differ from the central directory's), but its SIZE comes from the central directory.
    var lNameLen = view.getUint16(localOffset + 26, true);
    var lExtraLen = view.getUint16(localOffset + 28, true);
    var dataStart = localOffset + 30 + lNameLen + lExtraLen;
    var rawData = new Uint8Array(arrayBuffer, dataStart, compressedSize);

    var data;
    if (compressionMethod === 0) {
      data = rawData; // Stored (no compression)
    } else if (compressionMethod === 8) {
      // Deflate — ZIP stores RAW deflate (no zlib header), so the WHATWG format is 'deflate-raw'.
      // (Was 'raw' — an invalid format name that threw "Unsupported compression format" on every
      // DEFLATE-compressed bundle; STORED zips happened to skip this path. Fixed during extraction.)
      var ds = new DecompressionStream('deflate-raw');
      var writer = ds.writable.getWriter();
      writer.write(rawData);
      writer.close();
      var reader = ds.readable.getReader();
      var chunks = [];
      while (true) {
        var result = await reader.read();
        if (result.done) break;
        chunks.push(result.value);
      }
      var totalLen = chunks.reduce(function (s, c) { return s + c.length; }, 0);
      data = new Uint8Array(totalLen);
      var dpos = 0;
      for (var ci = 0; ci < chunks.length; ci++) {
        data.set(chunks[ci], dpos);
        dpos += chunks[ci].length;
      }
    } else {
      throw new Error('Unsupported compression method: ' + compressionMethod);
    }

    files.push({ name: name, data: data });
  }

  return files;
}

// ── ZIP Inline Bundler ────────────────────────────

export async function bundleZip(files) {
  // 1. Find index.html or any .html file as the base
  var htmlFile = null;
  for (var i = 0; i < files.length; i++) {
    var lowerName = files[i].name.toLowerCase();
    if (lowerName === 'index.html' || lowerName.endsWith('/index.html')) {
      htmlFile = files[i];
      break;
    }
  }
  if (!htmlFile) {
    for (var i = 0; i < files.length; i++) {
      if (files[i].name.toLowerCase().match(/\.html?$/)) {
        htmlFile = files[i];
        break;
      }
    }
  }
  if (!htmlFile) {
    throw new Error('No HTML file found in ZIP');
  }

  // 2. Determine the base path (directory containing the HTML file)
  var lastSlash = htmlFile.name.lastIndexOf('/');
  var basePath = lastSlash >= 0 ? htmlFile.name.substring(0, lastSlash + 1) : '';

  // 3. Build a map of relative file paths to file data
  var fileMap = {};
  for (var i = 0; i < files.length; i++) {
    var fname = files[i].name;
    // Store path relative to base
    if (basePath && fname.startsWith(basePath)) {
      fileMap[fname.substring(basePath.length)] = files[i].data;
    }
    // Also store the full path for lookup
    fileMap[fname] = files[i].data;
  }

  // Helper: resolve a reference relative to the HTML file's directory
  function resolveRef(ref) {
    // Strip leading ./
    var cleaned = ref.replace(/^\.\//, '');
    // Try direct lookup
    if (fileMap[cleaned]) return fileMap[cleaned];
    // Try with basePath prepended
    if (fileMap[basePath + cleaned]) return fileMap[basePath + cleaned];
    return null;
  }

  // Helper: get file content as text
  function fileAsText(data) {
    return new TextDecoder().decode(data);
  }

  // Helper: get file content as data URL
  function fileAsDataUrl(ref, data) {
    var mime = mimeFromExtension(ref);
    return 'data:' + mime + ';base64,' + toBase64(data);
  }

  var html = fileAsText(htmlFile.data);

  // 4. Replace <link rel="stylesheet" href="..."> with inline <style>
  html = html.replace(/<link\s+[^>]*rel\s*=\s*["']stylesheet["'][^>]*>/gi, function (tag) {
    var hrefMatch = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!hrefMatch) return tag;
    var href = hrefMatch[1];
    var fileData = resolveRef(href);
    if (!fileData) return tag; // keep original if file not found
    var cssContent = fileAsText(fileData);
    // Inline CSS url() references within the stylesheet
    cssContent = inlineCssUrls(cssContent);
    return '<style>/* ' + href + ' */\n' + cssContent + '</style>';
  });

  // 5. Replace script-src tags with inline script blocks
  html = html.replace(/<script\s+[^>]*src\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi, function (tag, src) {
    var fileData = resolveRef(src);
    if (!fileData) return tag; // keep original if file not found
    return '<script>/* ' + src + ' */\n' + fileAsText(fileData) + '<\/script>';
  });

  // 6. Replace src="..." and href="..." pointing to binary assets with data URLs
  html = html.replace(/(src|href)\s*=\s*["']([^"']+)["']/gi, function (match, attr, ref) {
    // Skip data: URLs, http(s) URLs, # anchors, and javascript:
    if (ref.match(/^(data:|https?:|#|javascript:|mailto:)/i)) return match;
    // Skip already-inlined stylesheets and scripts (they won't match since already replaced)
    var fileData = resolveRef(ref);
    if (!fileData) return match;
    var mime = mimeFromExtension(ref);
    // Only inline binary/image/font assets, not html/css/js (already handled above)
    if (mime.match(/^(image|font|audio|video)\//)) {
      return attr + '="' + fileAsDataUrl(ref, fileData) + '"';
    }
    return match;
  });

  // 7. Replace CSS url(...) references in inline <style> blocks
  html = html.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, function (tag, cssContent) {
    var inlined = inlineCssUrls(cssContent);
    if (inlined !== cssContent) {
      return tag.replace(cssContent, inlined);
    }
    return tag;
  });

  function inlineCssUrls(css) {
    return css.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, function (match, ref) {
      if (ref.match(/^(data:|https?:|#)/i)) return match;
      var fileData = resolveRef(ref);
      if (!fileData) return match;
      return 'url("' + fileAsDataUrl(ref, fileData) + '")';
    });
  }

  return html;
}
