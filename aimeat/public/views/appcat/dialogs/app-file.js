/**
 * @file public/views/appcat/dialogs/app-file.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reading an app's file in the browser, for the Add and Publish dialogs: what the HTML
 *   says about itself (features F92: the AIMEAT App Manifest comment, the <title> and a leading emoji
 *   in it, an emoji drawn in a data-URI SVG favicon, the keywords meta; unfilled {{…}} template
 *   placeholders dropped), and the other ZIP, an app bundle (F274): the central directory is read, so
 *   git's and GitHub's "Download ZIP" archives with data descriptors work; stored and deflated entries
 *   are read (DecompressionStream 'deflate-raw'), other methods refuse; then index.html (at any depth)
 *   or the first .html is the base, and its stylesheets, scripts and image, font, audio and video
 *   references are folded into it as <style>, inline <script> and data: URIs; http(s):, data:, #,
 *   javascript: and mailto: references are left as they are. The result is one HTML file, published
 *   like a pasted one. Pure bytes and strings: no state, no storage, no DOM.
 *   The logic is the old catalogue's own (src/static/app-catalog/js/apps-io.js parseAppMeta and
 *   js/zip.js), carried over line for line; its errors carry keys of their own (ZIP_*), which the Add
 *   dialog turns into words.
 * @structure parseAppMeta(html) · textToBase64(text) · readFileAsText(file) · extractZip(buffer) ·
 *   bundleZip(files) · ZipError
 * @usage const meta = parseAppMeta(html); const html = await bundleZip(await extractZip(await file.arrayBuffer()));
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial (appcat): carried from the old catalogue's apps-io.js and zip.js.
 */

/** An error the Add dialog says in words: `code` is 'noEocd' | 'method' | 'noHtml'. */
export class ZipError extends Error {
  /** @param {string} code @param {string} [detail] */
  constructor(code, detail) {
    super(code + (detail ? ': ' + detail : ''));
    this.code = code;
    this.detail = detail || '';
  }
}

/**
 * Everything the file can tell about itself. Never throws: a half-written file still publishes, the
 * fields just stay empty.
 * @param {string} html
 * @returns {{ name: string, description: string, icon: string, tags: string }}
 */
export function parseAppMeta(html) {
  const meta = { name: '', description: '', icon: '', tags: '' };
  const src = html || '';
  try {
    const m = src.match(/AIMEAT App Manifest([\s\S]*?)-->/i);
    if (m) {
      const nm = m[1].match(/\bname:\s*(.+)/i); if (nm) meta.name = nm[1].trim();
      const dm = m[1].match(/\bdescription:\s*(.+)/i); if (dm) meta.description = dm[1].trim();
      const im = m[1].match(/\bicon:\s*(.+)/i); if (im) meta.icon = im[1].trim();
      const gm = m[1].match(/\btags:\s*(.+)/i); if (gm) meta.tags = gm[1].trim();
    }
    let titleText = '';
    const tt = src.match(/<title>([^<]+)<\/title>/i);
    if (tt) titleText = tt[1].trim();
    if (!meta.name && titleText) meta.name = titleText;
    // A leading emoji in the title is the icon nearly every single-file app has; it belongs in the
    // icon field rather than doubled into the name.
    if (!meta.icon && titleText) {
      const lead = titleText.match(/^(\p{Extended_Pictographic}️?)\s+/u);
      if (lead) {
        meta.icon = lead[1];
        if (meta.name === titleText) meta.name = titleText.slice(lead[0].length).trim();
      }
    }
    // The other real source: an emoji drawn into a data-URI SVG favicon.
    if (!meta.icon) {
      const fav = src.match(/<link[^>]*rel=["'][^"']*icon[^"']*["'][^>]*>/i);
      if (fav) {
        const glyph = decodeURIComponent(fav[0]).match(/<text[^>]*>([^<]+)<\/text>/i);
        if (glyph) meta.icon = glyph[1].trim();
      }
    }
    if (!meta.tags) {
      const kw = src.match(/<meta[^>]*name=["']keywords["'][^>]*content=["']([^"']+)["']/i);
      if (kw) meta.tags = kw[1].trim();
    }
  } catch (err) {
    // A malformed favicon URI (decodeURIComponent) is the one thing that throws here: the fields read
    // so far stay, the rest stay empty, and the file still publishes.
    console.warn('[appcat] could not read everything from the app file', err);
  }
  // Drop unfilled {{template}} placeholders.
  for (const k of /** @type {const} */ (['name', 'description', 'icon', 'tags'])) {
    if (/\{\{.*\}\}/.test(meta[k])) meta[k] = '';
  }
  return meta;
}

/** Text as base64 of its UTF-8 bytes (what POST /v1/apps takes as `content`). */
export function textToBase64(text) {
  return bytesToBase64(new TextEncoder().encode(String(text ?? '')));
}

/** @param {Uint8Array} bytes */
function bytesToBase64(bytes) {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

/** A picked file as text (UTF-8). */
export function readFileAsText(file) {
  return file.text();
}

// ── The ZIP bundle ──────────────────────────────────────────────────────────────────────────

const MIME = {
  html: 'text/html', htm: 'text/html', css: 'text/css',
  js: 'application/javascript', mjs: 'application/javascript', json: 'application/json',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm',
  xml: 'application/xml', txt: 'text/plain', pdf: 'application/pdf',
};

function mimeFromExtension(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

/**
 * The files of a ZIP, read through its central directory (the local headers of a streamed ZIP carry
 * size 0; the central directory always has the real sizes).
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<Array<{ name: string, data: Uint8Array }>>}
 */
export async function extractZip(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const files = [];
  let eocd = -1;
  for (let p = view.byteLength - 22; p >= 0; p--) {
    if (view.getUint32(p, true) === 0x06054b50) { eocd = p; break; }
  }
  if (eocd === -1) throw new ZipError('noEocd');
  const cdCount = view.getUint16(eocd + 10, true);
  let cdPos = view.getUint32(eocd + 16, true);

  for (let n = 0; n < cdCount && cdPos + 46 <= view.byteLength; n++) {
    if (view.getUint32(cdPos, true) !== 0x02014b50) break;
    const method = view.getUint16(cdPos + 10, true);
    const compressedSize = view.getUint32(cdPos + 20, true);
    const nameLen = view.getUint16(cdPos + 28, true);
    const extraLen = view.getUint16(cdPos + 30, true);
    const commentLen = view.getUint16(cdPos + 32, true);
    const localOffset = view.getUint32(cdPos + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(arrayBuffer, cdPos + 46, nameLen));
    cdPos += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;
    if (view.getUint32(localOffset, true) !== 0x04034b50) continue;
    // The data starts after the LOCAL header's name and extra fields; its size is the central directory's.
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = new Uint8Array(arrayBuffer, dataStart, compressedSize);

    let data;
    if (method === 0) {
      data = raw;
    } else if (method === 8) {
      // A ZIP stores raw deflate (no zlib header): the WHATWG format name is 'deflate-raw'.
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(raw);
      writer.close();
      const reader = ds.readable.getReader();
      const chunks = [];
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        chunks.push(r.value);
      }
      const total = chunks.reduce((s, c) => s + c.length, 0);
      data = new Uint8Array(total);
      let at = 0;
      for (const c of chunks) { data.set(c, at); at += c.length; }
    } else {
      throw new ZipError('method', String(method));
    }
    files.push({ name, data });
  }
  return files;
}

/**
 * One self-contained HTML document from a bundle's files.
 * @param {Array<{ name: string, data: Uint8Array }>} files
 * @returns {Promise<string>}
 */
export async function bundleZip(files) {
  let htmlFile = files.find((f) => { const l = f.name.toLowerCase(); return l === 'index.html' || l.endsWith('/index.html'); }) || null;
  if (!htmlFile) htmlFile = files.find((f) => /\.html?$/.test(f.name.toLowerCase())) || null;
  if (!htmlFile) throw new ZipError('noHtml');

  const lastSlash = htmlFile.name.lastIndexOf('/');
  const basePath = lastSlash >= 0 ? htmlFile.name.substring(0, lastSlash + 1) : '';

  /** @type {Record<string, Uint8Array>} */
  const fileMap = {};
  for (const f of files) {
    if (basePath && f.name.startsWith(basePath)) fileMap[f.name.substring(basePath.length)] = f.data;
    fileMap[f.name] = f.data;
  }
  const resolveRef = (ref) => {
    const cleaned = ref.replace(/^\.\//, '');
    return fileMap[cleaned] || fileMap[basePath + cleaned] || null;
  };
  const asText = (data) => new TextDecoder().decode(data);
  const asDataUrl = (ref, data) => 'data:' + mimeFromExtension(ref) + ';base64,' + bytesToBase64(data);
  const inlineCssUrls = (css) => css.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, (match, ref) => {
    if (/^(data:|https?:|#)/i.test(ref)) return match;
    const data = resolveRef(ref);
    return data ? 'url("' + asDataUrl(ref, data) + '")' : match;
  });

  let html = asText(htmlFile.data);

  // Stylesheets become <style>, with their own url()s folded in.
  html = html.replace(/<link\s+[^>]*rel\s*=\s*["']stylesheet["'][^>]*>/gi, (tag) => {
    const hrefMatch = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!hrefMatch) return tag;
    const data = resolveRef(hrefMatch[1]);
    if (!data) return tag;
    return '<style>/* ' + hrefMatch[1] + ' */\n' + inlineCssUrls(asText(data)) + '</style>';
  });

  // Script files become inline scripts.
  html = html.replace(/<script\s+[^>]*src\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi, (tag, src) => {
    const data = resolveRef(src);
    if (!data) return tag;
    return '<script>/* ' + src + ' */\n' + asText(data) + '</script>';
  });

  // Images, fonts, audio and video become data: URIs.
  html = html.replace(/(src|href)\s*=\s*["']([^"']+)["']/gi, (match, attr, ref) => {
    if (/^(data:|https?:|#|javascript:|mailto:)/i.test(ref)) return match;
    const data = resolveRef(ref);
    if (!data) return match;
    return /^(image|font|audio|video)\//.test(mimeFromExtension(ref)) ? attr + '="' + asDataUrl(ref, data) + '"' : match;
  });

  // url() inside inline <style> blocks.
  html = html.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (tag, css) => {
    const inlined = inlineCssUrls(css);
    // A function, so a "$" in the stylesheet is not read as a replacement pattern.
    return inlined !== css ? tag.replace(css, () => inlined) : tag;
  });

  return html;
}
