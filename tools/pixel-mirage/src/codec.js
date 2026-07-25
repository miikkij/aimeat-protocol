/**
 * @file codec.js
 * @description Pure-JS image codec for the Pixel Mirage extension sandbox (QuickJS): base64,
 *   PNG decode (all non-interlaced colour types), baseline JPEG decode with a scaled IDCT, and
 *   indexed PNG encode with a fixed-Huffman deflate. No Node, no DOM, no typed-array extras
 *   beyond Uint8Array/Int32Array/Float64Array.
 * @structure PMC.b64decode · b64encode · decodeImage · encodeIndexedPng
 * @usage var img = PMC.decodeImage(bytes, 512); // {width,height,rgba}
 * @version-history
 *   v1.0.0 - 2026-07-25 - Initial codec for the agent-facing dither service.
 */
var PMC = (function () {
  'use strict';

  /* ------------------------------------------------------------------ base64 */

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var B64R = null;

  function b64init() {
    if (B64R) return;
    B64R = new Int16Array(256);
    for (var i = 0; i < 256; i++) B64R[i] = -1;
    for (var j = 0; j < 64; j++) B64R[B64.charCodeAt(j)] = j;
    B64R[45] = 62; // '-' url-safe
    B64R[95] = 63; // '_' url-safe
  }

  function b64decode(s) {
    b64init();
    var comma = s.indexOf('base64,');
    if (comma >= 0) s = s.slice(comma + 7);
    var out = new Uint8Array(((s.length * 3) >> 2) + 4), o = 0, acc = 0, bits = 0;
    for (var k = 0; k < s.length; k++) {
      var v = B64R[s.charCodeAt(k) & 255];
      if (v < 0) continue;
      acc = (acc << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 255; }
    }
    return out.subarray(0, o);
  }

  function b64encode(bytes) {
    var parts = [], i = 0, n = bytes.length;
    for (; i + 2 < n; i += 3) {
      var v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      parts.push(B64[(v >> 18) & 63] + B64[(v >> 12) & 63] + B64[(v >> 6) & 63] + B64[v & 63]);
    }
    var rem = n - i;
    if (rem === 1) {
      var a = bytes[i] << 16;
      parts.push(B64[(a >> 18) & 63] + B64[(a >> 12) & 63] + '==');
    } else if (rem === 2) {
      var b = (bytes[i] << 16) | (bytes[i + 1] << 8);
      parts.push(B64[(b >> 18) & 63] + B64[(b >> 12) & 63] + B64[(b >> 6) & 63] + '=');
    }
    return parts.join('');
  }

  /* ------------------------------------------------------------------ checksums */

  var CRC_TABLE = null;
  function crcTable() {
    if (CRC_TABLE) return CRC_TABLE;
    CRC_TABLE = new Int32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_TABLE[n] = c;
    }
    return CRC_TABLE;
  }

  function crc32(bytes, start, end) {
    var t = crcTable(), c = 0xFFFFFFFF;
    for (var i = start; i < end; i++) c = t[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function adler32(bytes) {
    var a = 1, b = 0;
    for (var i = 0; i < bytes.length; i++) {
      a += bytes[i];
      if (a >= 65521) a -= 65521;
      b += a;
      if (b >= 65521) b -= 65521;
    }
    return ((b << 16) | a) >>> 0;
  }

  /* ------------------------------------------------------------------ inflate */

  var LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  var LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  var DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  var DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  var CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  function buildHuff(lengths, n) {
    var counts = new Int32Array(16), i;
    for (i = 0; i < n; i++) counts[lengths[i]]++;
    counts[0] = 0;
    var offs = new Int32Array(16), sum = 0;
    for (i = 1; i < 16; i++) { offs[i] = sum; sum += counts[i]; }
    var symbols = new Int32Array(sum);
    for (i = 0; i < n; i++) if (lengths[i]) symbols[offs[lengths[i]]++] = i;

    var fast = new Int32Array(512), code = 0, idx = 0;
    for (var len = 1; len <= 9; len++) {
      var cnt = counts[len];
      for (var k = 0; k < cnt; k++) {
        var sym = symbols[idx + k], c = code + k, rev = 0;
        for (var b = 0; b < len; b++) rev = (rev << 1) | ((c >> b) & 1);
        for (var f = rev; f < 512; f += (1 << len)) fast[f] = (sym << 4) | len;
      }
      idx += cnt; code = (code + cnt) << 1;
    }
    return { counts: counts, symbols: symbols, fast: fast };
  }

  /** Raw DEFLATE stream -> Uint8Array. `start` is the offset of the first deflate byte. */
  function inflateRaw(data, start) {
    var pos = start, bitbuf = 0, bitcnt = 0;
    var out = new Uint8Array(1 << 16), olen = 0;

    function grow(n) {
      if (olen + n <= out.length) return;
      var cap = out.length;
      while (cap < olen + n) cap *= 2;
      var nb = new Uint8Array(cap);
      nb.set(out.subarray(0, olen));
      out = nb;
    }
    function bits(n) {
      while (bitcnt < n) { bitbuf |= (pos < data.length ? data[pos] : 0) << bitcnt; pos++; bitcnt += 8; }
      var v = bitbuf & ((1 << n) - 1);
      bitbuf >>>= n; bitcnt -= n;
      return v;
    }
    function sym(h) {
      while (bitcnt < 15) { bitbuf |= (pos < data.length ? data[pos] : 0) << bitcnt; pos++; bitcnt += 8; }
      var e = h.fast[bitbuf & 511];
      if (e) { var l = e & 15; bitbuf >>>= l; bitcnt -= l; return e >> 4; }
      var code = 0, first = 0, index = 0;
      for (var len = 1; len < 16; len++) {
        code |= bits(1);
        var count = h.counts[len];
        if (code - first < count) return h.symbols[index + (code - first)];
        index += count; first = (first + count) << 1; code <<= 1;
      }
      throw new Error('corrupt deflate stream');
    }

    var fixedLit = null, fixedDist = null;
    for (;;) {
      var last = bits(1), type = bits(2), lit, dist;
      if (type === 0) {
        bitbuf = 0; bitcnt = 0;
        var len = data[pos] | (data[pos + 1] << 8);
        pos += 4;
        grow(len);
        out.set(data.subarray(pos, pos + len), olen);
        olen += len; pos += len;
      } else {
        if (type === 1) {
          if (!fixedLit) {
            var fl = new Uint8Array(288), i;
            for (i = 0; i < 144; i++) fl[i] = 8;
            for (i = 144; i < 256; i++) fl[i] = 9;
            for (i = 256; i < 280; i++) fl[i] = 7;
            for (i = 280; i < 288; i++) fl[i] = 8;
            fixedLit = buildHuff(fl, 288);
            var fd = new Uint8Array(30);
            for (i = 0; i < 30; i++) fd[i] = 5;
            fixedDist = buildHuff(fd, 30);
          }
          lit = fixedLit; dist = fixedDist;
        } else if (type === 2) {
          var hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
          var clens = new Uint8Array(19), j;
          for (j = 0; j < hclen; j++) clens[CLEN_ORDER[j]] = bits(3);
          var ch = buildHuff(clens, 19);
          var lens = new Uint8Array(hlit + hdist), p = 0;
          while (p < hlit + hdist) {
            var s = sym(ch);
            if (s < 16) lens[p++] = s;
            else if (s === 16) { var prev = lens[p - 1], r = 3 + bits(2); while (r--) lens[p++] = prev; }
            else if (s === 17) { var r2 = 3 + bits(3); while (r2--) lens[p++] = 0; }
            else { var r3 = 11 + bits(7); while (r3--) lens[p++] = 0; }
          }
          lit = buildHuff(lens.subarray(0, hlit), hlit);
          dist = buildHuff(lens.subarray(hlit), hdist);
        } else {
          throw new Error('invalid deflate block type');
        }
        for (;;) {
          var s2 = sym(lit);
          if (s2 < 256) { grow(1); out[olen++] = s2; }
          else if (s2 === 256) break;
          else {
            s2 -= 257;
            var l2 = LEN_BASE[s2] + bits(LEN_EXTRA[s2]);
            var ds = sym(dist);
            var d2 = DIST_BASE[ds] + bits(DIST_EXTRA[ds]);
            grow(l2);
            var from = olen - d2;
            for (var q = 0; q < l2; q++) out[olen++] = out[from++];
          }
        }
      }
      if (last) break;
    }
    return out.subarray(0, olen);
  }

  /* ------------------------------------------------------------------ deflate (fixed Huffman + LZ77) */

  function BitWriter() {
    this.buf = new Uint8Array(1 << 16);
    this.len = 0; this.acc = 0; this.n = 0;
  }
  BitWriter.prototype.grow = function (n) {
    if (this.len + n <= this.buf.length) return;
    var cap = this.buf.length;
    while (cap < this.len + n) cap *= 2;
    var nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.len));
    this.buf = nb;
  };
  /** Write `n` bits of `v`, LSB-first (deflate stream order). */
  BitWriter.prototype.bits = function (v, n) {
    this.acc |= (v << this.n); this.n += n;
    while (this.n >= 8) {
      this.grow(1);
      this.buf[this.len++] = this.acc & 255;
      this.acc >>>= 8; this.n -= 8;
    }
  };
  /** Write a Huffman code (MSB-first canonical) reversed into the LSB-first stream. */
  BitWriter.prototype.code = function (v, n) {
    var rev = 0;
    for (var i = 0; i < n; i++) rev = (rev << 1) | ((v >> i) & 1);
    this.bits(rev, n);
  };
  BitWriter.prototype.flush = function () {
    if (this.n > 0) { this.grow(1); this.buf[this.len++] = this.acc & 255; this.acc = 0; this.n = 0; }
    return this.buf.subarray(0, this.len);
  };

  function litCode(w, s) {
    if (s < 144) w.code(0x30 + s, 8);
    else if (s < 256) w.code(0x190 + s - 144, 9);
    else if (s < 280) w.code(s - 256, 7);
    else w.code(0xC0 + s - 280, 8);
  }

  function lenSymbol(l) {
    for (var i = 28; i >= 0; i--) if (l >= LEN_BASE[i]) return i;
    return 0;
  }
  function distSymbol(d) {
    for (var i = 29; i >= 0; i--) if (d >= DIST_BASE[i]) return i;
    return 0;
  }

  /** zlib stream (2-byte header + fixed-Huffman deflate + adler32). */
  function deflateZlib(data) {
    var w = new BitWriter();
    var n = data.length;
    var HSIZE = 1 << 15, HMASK = HSIZE - 1;
    var head = new Int32Array(HSIZE), prev = new Int32Array(n > 0 ? n : 1);
    for (var h = 0; h < HSIZE; h++) head[h] = -1;
    for (var p = 0; p < n; p++) prev[p] = -1;

    w.bits(1, 1); // final block
    w.bits(1, 2); // fixed Huffman

    var i = 0;
    while (i < n) {
      var bestLen = 0, bestDist = 0;
      if (i + 3 <= n) {
        var hv = ((data[i] << 10) ^ (data[i + 1] << 5) ^ data[i + 2]) & HMASK;
        var cand = head[hv], chain = 0;
        while (cand >= 0 && chain < 16) {
          var d = i - cand;
          if (d > 32768) break;
          if (data[cand + bestLen] === data[i + bestLen]) {
            var l = 0, max = n - i;
            if (max > 258) max = 258;
            while (l < max && data[cand + l] === data[i + l]) l++;
            if (l > bestLen) { bestLen = l; bestDist = d; if (l >= 258) break; }
          }
          cand = prev[cand]; chain++;
        }
        prev[i] = head[hv];
        head[hv] = i;
      }
      if (bestLen >= 3) {
        var ls = lenSymbol(bestLen);
        litCode(w, 257 + ls);
        if (LEN_EXTRA[ls]) w.bits(bestLen - LEN_BASE[ls], LEN_EXTRA[ls]);
        var dsy = distSymbol(bestDist);
        w.code(dsy, 5);
        if (DIST_EXTRA[dsy]) w.bits(bestDist - DIST_BASE[dsy], DIST_EXTRA[dsy]);
        // register the skipped positions so later matches can still find them
        for (var k = 1; k < bestLen; k++) {
          var j = i + k;
          if (j + 3 <= n) {
            var hv2 = ((data[j] << 10) ^ (data[j + 1] << 5) ^ data[j + 2]) & HMASK;
            prev[j] = head[hv2]; head[hv2] = j;
          }
        }
        i += bestLen;
      } else {
        litCode(w, data[i]);
        i++;
      }
    }
    litCode(w, 256);
    var body = w.flush();

    var out = new Uint8Array(body.length + 6);
    out[0] = 0x78; out[1] = 0x01;
    out.set(body, 2);
    var ad = adler32(data);
    out[body.length + 2] = (ad >>> 24) & 255;
    out[body.length + 3] = (ad >>> 16) & 255;
    out[body.length + 4] = (ad >>> 8) & 255;
    out[body.length + 5] = ad & 255;
    return out;
  }

  /* ------------------------------------------------------------------ PNG decode */

  function be32(b, i) { return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0; }

  function decodePng(bytes, maxPixels) {
    if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) throw new Error('not a PNG');
    var pos = 8, width = 0, height = 0, depth = 8, colorType = 6, interlace = 0;
    var palette = null, trns = null, idat = [], idatLen = 0;

    while (pos + 8 <= bytes.length) {
      var len = be32(bytes, pos);
      var type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
      var dstart = pos + 8;
      if (type === 'IHDR') {
        width = be32(bytes, dstart); height = be32(bytes, dstart + 4);
        depth = bytes[dstart + 8]; colorType = bytes[dstart + 9];
        interlace = bytes[dstart + 12];
      } else if (type === 'PLTE') {
        palette = bytes.subarray(dstart, dstart + len);
      } else if (type === 'tRNS') {
        trns = bytes.subarray(dstart, dstart + len);
      } else if (type === 'IDAT') {
        idat.push(bytes.subarray(dstart, dstart + len)); idatLen += len;
      } else if (type === 'IEND') {
        break;
      }
      pos = dstart + len + 4;
    }
    if (!width || !height) throw new Error('PNG has no IHDR');
    if (interlace) throw new Error('interlaced (Adam7) PNG is not supported — save it non-interlaced');
    if (!idatLen) throw new Error('PNG has no image data');
    // A PNG cannot be decoded at reduced scale the way a JPEG can — the whole thing has to be
    // inflated. Refusing a source that will not fit the time budget is worth more to a caller
    // than a bare "interrupted" after four seconds of work.
    if (maxPixels && width * height > maxPixels) {
      throw new Error('PNG is ' + width + '×' + height + ' (' + Math.round(width * height / 1e6 * 10) / 10
        + ' MP), over the ' + Math.round(maxPixels / 1e6 * 10) / 10 + ' MP decode budget'
        + ' — downscale it first, or send the same picture as a JPEG, which can be decoded at reduced scale');
    }

    var z = new Uint8Array(idatLen), zo = 0;
    for (var c = 0; c < idat.length; c++) { z.set(idat[c], zo); zo += idat[c].length; }
    var raw = inflateRaw(z, 2);

    var channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : 4;
    var bpp = Math.ceil(channels * depth / 8);
    var stride = Math.ceil(channels * depth * width / 8);
    var rgba = new Uint8Array(width * height * 4);
    var line = new Uint8Array(stride), prevLine = new Uint8Array(stride);
    var rp = 0;

    for (var y = 0; y < height; y++) {
      var filter = raw[rp++];
      for (var x = 0; x < stride; x++) {
        var rawv = raw[rp + x];
        var a = x >= bpp ? line[x - bpp] : 0;
        var b = prevLine[x];
        var cc = x >= bpp ? prevLine[x - bpp] : 0;
        var v;
        if (filter === 0) v = rawv;
        else if (filter === 1) v = rawv + a;
        else if (filter === 2) v = rawv + b;
        else if (filter === 3) v = rawv + ((a + b) >> 1);
        else {
          var pa = Math.abs(b - cc), pb = Math.abs(a - cc), pc = Math.abs(a + b - 2 * cc);
          v = rawv + ((pa <= pb && pa <= pc) ? a : (pb <= pc ? b : cc));
        }
        line[x] = v & 255;
      }
      rp += stride;
      expandRow(line, rgba, y * width * 4, width, depth, colorType, palette, trns);
      var t = prevLine; prevLine = line; line = t;
    }
    return { width: width, height: height, rgba: rgba };
  }

  function expandRow(line, rgba, out, width, depth, colorType, palette, trns) {
    var i, o = out, v, sample;
    function getSample(idx) {
      if (depth === 8) return line[idx];
      if (depth === 16) return line[idx * 2];
      var per = 8 / depth;
      var byteI = (idx / per) | 0;
      var shift = 8 - depth * ((idx % per) + 1);
      var mask = (1 << depth) - 1;
      return (line[byteI] >> shift) & mask;
    }
    var maxv = (1 << (depth === 16 ? 8 : depth)) - 1;
    if (colorType === 0) {
      for (i = 0; i < width; i++) {
        sample = getSample(i);
        v = depth === 8 || depth === 16 ? sample : Math.round(sample * 255 / maxv);
        rgba[o] = v; rgba[o + 1] = v; rgba[o + 2] = v; rgba[o + 3] = 255; o += 4;
      }
    } else if (colorType === 2) {
      var st = depth === 16 ? 2 : 1;
      for (i = 0; i < width; i++) {
        rgba[o] = line[i * 3 * st]; rgba[o + 1] = line[(i * 3 + 1) * st]; rgba[o + 2] = line[(i * 3 + 2) * st];
        rgba[o + 3] = 255; o += 4;
      }
    } else if (colorType === 3) {
      for (i = 0; i < width; i++) {
        var pi = getSample(i);
        rgba[o] = palette ? palette[pi * 3] : 0;
        rgba[o + 1] = palette ? palette[pi * 3 + 1] : 0;
        rgba[o + 2] = palette ? palette[pi * 3 + 2] : 0;
        rgba[o + 3] = trns && pi < trns.length ? trns[pi] : 255;
        o += 4;
      }
    } else if (colorType === 4) {
      var st4 = depth === 16 ? 2 : 1;
      for (i = 0; i < width; i++) {
        v = line[i * 2 * st4];
        rgba[o] = v; rgba[o + 1] = v; rgba[o + 2] = v; rgba[o + 3] = line[(i * 2 + 1) * st4]; o += 4;
      }
    } else {
      var st6 = depth === 16 ? 2 : 1;
      for (i = 0; i < width; i++) {
        rgba[o] = line[i * 4 * st6]; rgba[o + 1] = line[(i * 4 + 1) * st6];
        rgba[o + 2] = line[(i * 4 + 2) * st6]; rgba[o + 3] = line[(i * 4 + 3) * st6];
        o += 4;
      }
    }
  }

  /* ------------------------------------------------------------------ PNG encode (indexed) */

  function writeChunk(parts, type, data) {
    var len = data.length;
    var head = new Uint8Array(8);
    head[0] = (len >>> 24) & 255; head[1] = (len >>> 16) & 255; head[2] = (len >>> 8) & 255; head[3] = len & 255;
    for (var i = 0; i < 4; i++) head[4 + i] = type.charCodeAt(i);
    var body = new Uint8Array(4 + len);
    body.set(head.subarray(4), 0);
    body.set(data, 4);
    var crc = crc32(body, 0, body.length);
    var tail = new Uint8Array(4);
    tail[0] = (crc >>> 24) & 255; tail[1] = (crc >>> 16) & 255; tail[2] = (crc >>> 8) & 255; tail[3] = crc & 255;
    parts.push(head, data, tail);
  }

  /**
   * Encode an indexed image. `indices` is one byte per pixel (palette index),
   * `palette` an array of [r,g,b]. Bit depth is chosen from the palette size.
   */
  function encodeIndexedPng(indices, width, height, palette) {
    var n = palette.length;
    var depth = n <= 2 ? 1 : n <= 4 ? 2 : n <= 16 ? 4 : 8;
    var per = 8 / depth;
    var stride = Math.ceil(width / per);
    var raw = new Uint8Array((stride + 1) * height), ro = 0;

    for (var y = 0; y < height; y++) {
      raw[ro++] = 0; // filter: none (indexed rows filter badly with anything else)
      var base = y * width;
      if (depth === 8) {
        for (var x = 0; x < width; x++) raw[ro + x] = indices[base + x];
        ro += stride;
      } else {
        for (var xx = 0; xx < width; xx++) {
          var byteI = ro + ((xx / per) | 0);
          var shift = 8 - depth * ((xx % per) + 1);
          raw[byteI] |= (indices[base + xx] & ((1 << depth) - 1)) << shift;
        }
        ro += stride;
      }
    }

    var ihdr = new Uint8Array(13);
    ihdr[0] = (width >>> 24) & 255; ihdr[1] = (width >>> 16) & 255; ihdr[2] = (width >>> 8) & 255; ihdr[3] = width & 255;
    ihdr[4] = (height >>> 24) & 255; ihdr[5] = (height >>> 16) & 255; ihdr[6] = (height >>> 8) & 255; ihdr[7] = height & 255;
    ihdr[8] = depth; ihdr[9] = 3; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

    var plte = new Uint8Array(n * 3);
    for (var p = 0; p < n; p++) { plte[p * 3] = palette[p][0]; plte[p * 3 + 1] = palette[p][1]; plte[p * 3 + 2] = palette[p][2]; }

    var parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])];
    writeChunk(parts, 'IHDR', ihdr);
    writeChunk(parts, 'PLTE', plte);
    writeChunk(parts, 'IDAT', deflateZlib(raw));
    writeChunk(parts, 'IEND', new Uint8Array(0));

    var total = 0, i2;
    for (i2 = 0; i2 < parts.length; i2++) total += parts[i2].length;
    var out = new Uint8Array(total), off = 0;
    for (i2 = 0; i2 < parts.length; i2++) { out.set(parts[i2], off); off += parts[i2].length; }
    return out;
  }

  /* ------------------------------------------------------------------ JPEG decode (baseline, scaled) */

  var ZIGZAG = [
    0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
    12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
    58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
  ];

  var IDCT_CACHE = {};
  /**
   * Box-downsampling IDCT matrix: M[k][u] such that out[k] = sum_u M[k][u] * F[u] is the exact
   * average of IDCT samples in group k. N=8 is the plain IDCT, N=1 is DC-only.
   */
  function idctMatrix(N) {
    if (IDCT_CACHE[N]) return IDCT_CACHE[N];
    var g = 8 / N, M = [];
    for (var k = 0; k < N; k++) {
      var row = new Float64Array(8);
      for (var u = 0; u < 8; u++) {
        var s = 0;
        for (var x = k * g; x < (k + 1) * g; x++) s += Math.cos((2 * x + 1) * u * Math.PI / 16);
        row[u] = ((u === 0 ? Math.SQRT1_2 : 1) / 2) * s / g;
      }
      M.push(row);
    }
    IDCT_CACHE[N] = M;
    return M;
  }

  function buildJpegHuff(codeLengths, values) {
    var minCode = new Int32Array(17), maxCode = new Int32Array(17), valPtr = new Int32Array(17);
    var code = 0, k = 0, l;
    for (l = 1; l <= 16; l++) {
      valPtr[l] = k;
      minCode[l] = code;
      var cnt = codeLengths[l - 1];
      code += cnt; k += cnt;
      maxCode[l] = cnt ? code - 1 : -1;
      code <<= 1;
    }
    var fast = new Int32Array(256), c2 = 0, k2 = 0;
    for (l = 1; l <= 8; l++) {
      for (var i = 0; i < codeLengths[l - 1]; i++) {
        var val = values[k2++], pre = c2 << (8 - l);
        for (var f = 0; f < (1 << (8 - l)); f++) fast[pre | f] = (l << 8) | val;
        c2++;
      }
      c2 <<= 1;
    }
    return { minCode: minCode, maxCode: maxCode, valPtr: valPtr, values: values, fast: fast };
  }

  function decodeJpeg(data, targetLongEdge) {
    var pos = 2;
    if (data[0] !== 0xFF || data[1] !== 0xD8) throw new Error('not a JPEG');

    var qt = [], huffDC = [], huffAC = [], frame = null, restartInterval = 0, adobeTransform = -1;

    function u16(i) { return (data[i] << 8) | data[i + 1]; }

    while (pos < data.length) {
      if (data[pos] !== 0xFF) { pos++; continue; }
      var marker = data[pos + 1];
      pos += 2;
      if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) continue;
      if (marker === 0xD9) break;
      var len = u16(pos), segEnd = pos + len;

      if (marker === 0xDB) {
        var q = pos + 2;
        while (q < segEnd) {
          var pq = data[q] >> 4, tq = data[q] & 15;
          q++;
          var tbl = new Int32Array(64);
          for (var z = 0; z < 64; z++) {
            tbl[ZIGZAG[z]] = pq ? ((data[q] << 8) | data[q + 1]) : data[q];
            q += pq ? 2 : 1;
          }
          qt[tq] = tbl;
        }
      } else if (marker === 0xC4) {
        var hp = pos + 2;
        while (hp < segEnd) {
          var tc = data[hp] >> 4, th = data[hp] & 15;
          hp++;
          var counts = new Int32Array(16), total = 0;
          for (var ci = 0; ci < 16; ci++) { counts[ci] = data[hp + ci]; total += counts[ci]; }
          hp += 16;
          var vals = new Uint8Array(total);
          for (var vi = 0; vi < total; vi++) vals[vi] = data[hp + vi];
          hp += total;
          var built = buildJpegHuff(counts, vals);
          if (tc === 0) huffDC[th] = built; else huffAC[th] = built;
        }
      } else if (marker === 0xC0 || marker === 0xC1) {
        var h = u16(pos + 3), w = u16(pos + 5), nc = data[pos + 7], comps = [];
        var maxH = 1, maxV = 1;
        for (var k = 0; k < nc; k++) {
          var off = pos + 8 + k * 3;
          var comp = { id: data[off], h: data[off + 1] >> 4, v: data[off + 1] & 15, tq: data[off + 2] };
          if (comp.h > maxH) maxH = comp.h;
          if (comp.v > maxV) maxV = comp.v;
          comps.push(comp);
        }
        frame = { width: w, height: h, comps: comps, maxH: maxH, maxV: maxV };
      } else if (marker === 0xC2) {
        throw new Error('progressive JPEG is not supported — re-save as baseline JPEG or PNG');
      } else if (marker === 0xC3 || (marker >= 0xC5 && marker <= 0xCF && marker !== 0xC8 && marker !== 0xCC)) {
        throw new Error('unsupported JPEG encoding (arithmetic or lossless)');
      } else if (marker === 0xDD) {
        restartInterval = u16(pos + 2);
      } else if (marker === 0xEE) {
        if (len >= 14 && data[pos + 2] === 0x41 && data[pos + 3] === 0x64) adobeTransform = data[pos + 13];
      } else if (marker === 0xDA) {
        if (!frame) throw new Error('JPEG scan before frame header');
        var ns = data[pos + 2], scan = [];
        for (var si = 0; si < ns; si++) {
          var so = pos + 3 + si * 2, cid = data[so], td = data[so + 1] >> 4, ta = data[so + 1] & 15;
          for (var fi = 0; fi < frame.comps.length; fi++) {
            if (frame.comps[fi].id === cid) scan.push({ comp: frame.comps[fi], dc: huffDC[td], ac: huffAC[ta] });
          }
        }
        return decodeScan(data, segEnd, frame, scan, qt, restartInterval, targetLongEdge, adobeTransform);
      }
      pos = segEnd;
    }
    throw new Error('JPEG has no scan data');
  }

  function decodeScan(data, scanStart, frame, scan, qt, restartInterval, targetLongEdge, adobeTransform) {
    var longEdge = Math.max(frame.width, frame.height);
    var N = 8;
    if (targetLongEdge > 0) {
      // Pick the cheapest scale that still (nearly) covers the requested output. A full-scale IDCT
      // costs roughly four times a half-scale one, so accepting a decode up to SLACK× short of the
      // target and letting the resampler make up the difference is the single biggest saving on the
      // whole path — and invisible once the picture has been reduced to a handful of inks.
      var SLACK = 1.35;
      if (longEdge / 8 * SLACK >= targetLongEdge) N = 1;
      else if (longEdge / 4 * SLACK >= targetLongEdge) N = 2;
      else if (longEdge / 2 * SLACK >= targetLongEdge) N = 4;
    }
    var M = idctMatrix(N);

    var mcuW = frame.maxH * 8, mcuH = frame.maxV * 8;
    var mcusX = Math.ceil(frame.width / mcuW), mcusY = Math.ceil(frame.height / mcuH);

    var comps = frame.comps;
    for (var c = 0; c < comps.length; c++) {
      var cc = comps[c];
      cc.blocksX = mcusX * cc.h;
      cc.blocksY = mcusY * cc.v;
      cc.lineW = cc.blocksX * N;
      cc.data = new Uint8Array(cc.lineW * cc.blocksY * N);
      cc.pred = 0;
    }

    var pos = scanStart, bb = 0, bn = 0, eof = false;

    function fill() {
      while (bn <= 16) {
        var b = 0;
        if (!eof && pos < data.length) {
          b = data[pos];
          if (b === 0xFF) {
            var b2 = data[pos + 1];
            if (b2 === 0) { pos += 2; }
            else { b = 0; eof = true; }
          } else pos++;
        } else { b = 0; eof = true; }
        bb = ((bb << 8) | b) & 0x00FFFFFF;
        bn += 8;
        if (bn > 24) { bn = 24; }
      }
    }
    function getBits(n) {
      if (n === 0) return 0;
      if (bn < n) fill();
      bn -= n;
      var v = (bb >>> bn) & ((1 << n) - 1);
      bb &= (1 << bn) - 1;
      return v;
    }
    function decodeHuff(h) {
      if (bn < 16) fill();
      var e = h.fast[(bb >>> (bn - 8)) & 255];
      if (e) { bn -= (e >> 8); bb &= (1 << bn) - 1; return e & 255; }
      var code = 0, l = 0;
      while (l < 16) {
        if (bn < 1) fill();
        bn--; code = (code << 1) | ((bb >>> bn) & 1); bb &= (1 << bn) - 1; l++;
        if (h.maxCode[l] >= 0 && code <= h.maxCode[l]) return h.values[h.valPtr[l] + (code - h.minCode[l])];
      }
      throw new Error('corrupt JPEG entropy data');
    }
    function extend(v, n) { return v < (1 << (n - 1)) ? v - (1 << n) + 1 : v; }

    var blk = new Float64Array(64), tmp = new Float64Array(64), outBlk = new Float64Array(64);

    function decodeBlock(comp, sc, bx, by) {
      var q = qt[comp.tq];
      for (var i = 0; i < 64; i++) blk[i] = 0;
      var t = decodeHuff(sc.dc);
      var diff = t === 0 ? 0 : extend(getBits(t), t);
      comp.pred += diff;
      blk[0] = comp.pred * q[0];
      var maxNz = 0, kk = 1;
      while (kk < 64) {
        var rs = decodeHuff(sc.ac), s = rs & 15, r = rs >> 4;
        if (s === 0) {
          if (r < 15) break;
          kk += 16;
        } else {
          kk += r;
          if (kk > 63) break;
          var zz = ZIGZAG[kk];
          blk[zz] = extend(getBits(s), s) * q[zz];
          maxNz = 1;
          kk++;
        }
      }

      var lineW = comp.lineW, ox = bx * N, oy = by * N, d = comp.data, i2, j2;
      if (!maxNz) {
        // Flat block: every output sample is the same value.
        var flat = blk[0] * M[0][0] * M[0][0] + 128;
        var fv = flat < 0 ? 0 : flat > 255 ? 255 : (flat + 0.5) | 0;
        for (i2 = 0; i2 < N; i2++) {
          var ro = (oy + i2) * lineW + ox;
          for (j2 = 0; j2 < N; j2++) d[ro + j2] = fv;
        }
        return;
      }
      // Rows: 8 rows x N outputs
      for (var v = 0; v < 8; v++) {
        var rb = v * 8;
        for (var k2 = 0; k2 < N; k2++) {
          var mk = M[k2], s2 = 0;
          for (var u = 0; u < 8; u++) s2 += mk[u] * blk[rb + u];
          tmp[v * N + k2] = s2;
        }
      }
      // Columns: N outputs x N columns
      for (var rr = 0; rr < N; rr++) {
        var mr = M[rr];
        for (var cc2 = 0; cc2 < N; cc2++) {
          var s3 = 0;
          for (var vv = 0; vv < 8; vv++) s3 += mr[vv] * tmp[vv * N + cc2];
          outBlk[rr * N + cc2] = s3;
        }
      }
      for (i2 = 0; i2 < N; i2++) {
        var ro2 = (oy + i2) * lineW + ox;
        for (j2 = 0; j2 < N; j2++) {
          var val = outBlk[i2 * N + j2] + 128;
          d[ro2 + j2] = val < 0 ? 0 : val > 255 ? 255 : (val + 0.5) | 0;
        }
      }
    }

    var mcuCount = 0;
    for (var my = 0; my < mcusY; my++) {
      for (var mx = 0; mx < mcusX; mx++) {
        if (restartInterval && mcuCount > 0 && mcuCount % restartInterval === 0) {
          // Byte-align, consume the RSTn marker, reset predictors.
          bn = 0; bb = 0; eof = false;
          while (pos + 1 < data.length && !(data[pos] === 0xFF && data[pos + 1] >= 0xD0 && data[pos + 1] <= 0xD7)) pos++;
          if (pos + 1 < data.length) pos += 2;
          for (var rc = 0; rc < comps.length; rc++) comps[rc].pred = 0;
        }
        for (var s4 = 0; s4 < scan.length; s4++) {
          var sc = scan[s4], comp = sc.comp;
          for (var vy = 0; vy < comp.v; vy++) {
            for (var hx = 0; hx < comp.h; hx++) {
              decodeBlock(comp, sc, mx * comp.h + hx, my * comp.v + vy);
            }
          }
        }
        mcuCount++;
      }
    }

    var outW = Math.max(1, Math.round(frame.width * N / 8));
    var outH = Math.max(1, Math.round(frame.height * N / 8));
    var rgba = new Uint8Array(outW * outH * 4);
    var nc = comps.length;

    for (var y = 0; y < outH; y++) {
      var o = y * outW * 4;
      for (var x = 0; x < outW; x++) {
        if (nc === 1) {
          var g = comps[0].data[Math.min(y, comps[0].blocksY * N - 1) * comps[0].lineW + Math.min(x, comps[0].lineW - 1)];
          rgba[o] = g; rgba[o + 1] = g; rgba[o + 2] = g;
        } else {
          var c0 = comps[0], c1 = comps[1], c2 = comps[2];
          var Y = c0.data[sampleIdx(c0, x, y, frame, N)];
          var Cb = c1.data[sampleIdx(c1, x, y, frame, N)] - 128;
          var Cr = c2.data[sampleIdx(c2, x, y, frame, N)] - 128;
          if (nc === 4 && adobeTransform === 0) {
            rgba[o] = Y; rgba[o + 1] = c1.data[sampleIdx(c1, x, y, frame, N)]; rgba[o + 2] = c2.data[sampleIdx(c2, x, y, frame, N)];
          } else {
            var r = Y + 1.402 * Cr, gg = Y - 0.344136 * Cb - 0.714136 * Cr, b = Y + 1.772 * Cb;
            rgba[o] = r < 0 ? 0 : r > 255 ? 255 : r | 0;
            rgba[o + 1] = gg < 0 ? 0 : gg > 255 ? 255 : gg | 0;
            rgba[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b | 0;
          }
        }
        rgba[o + 3] = 255;
        o += 4;
      }
    }
    return { width: outW, height: outH, rgba: rgba };
  }

  function sampleIdx(comp, x, y, frame, N) {
    var cx = (x * comp.h / frame.maxH) | 0;
    var cy = (y * comp.v / frame.maxV) | 0;
    if (cx >= comp.lineW) cx = comp.lineW - 1;
    var maxY = comp.blocksY * N - 1;
    if (cy > maxY) cy = maxY;
    return cy * comp.lineW + cx;
  }

  /* ------------------------------------------------------------------ facade */

  /**
   * Decode PNG or JPEG bytes to `{width,height,rgba}`. `targetLongEdge` lets the JPEG path
   * decode at 1/8, 1/4 or 1/2 scale when the source is much larger than the wanted output.
   */
  function decodeImage(bytes, targetLongEdge, maxPixels) {
    if (bytes.length > 3 && bytes[0] === 0x89 && bytes[1] === 0x50) return decodePng(bytes, maxPixels);
    if (bytes.length > 3 && bytes[0] === 0xFF && bytes[1] === 0xD8) return decodeJpeg(bytes, targetLongEdge || 0);
    throw new Error('unsupported image format — send PNG or baseline JPEG bytes');
  }

  return {
    b64decode: b64decode,
    b64encode: b64encode,
    decodeImage: decodeImage,
    decodePng: decodePng,
    decodeJpeg: decodeJpeg,
    encodeIndexedPng: encodeIndexedPng,
    inflateRaw: inflateRaw,
    deflateZlib: deflateZlib,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PMC;
