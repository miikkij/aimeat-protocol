/**
 * @file engine.js
 * @description The Pixel Mirage dither engine — the single source of truth for what a recipe means.
 *   The same file runs in the browser studio and inside the QuickJS extension sandbox, so a preview
 *   in the app and a render bought through the app-tool are the same picture. No DOM, no Node.
 * @structure PM.PALETTES · PM.ALGORITHMS · PM.normalizeRecipe · PM.render · PM.extractPalette
 * @usage var out = PM.render(rgba, w, h, PM.normalizeRecipe({palette:'gameboy', algorithm:'bayer8'}));
 * @version-history
 *   v2.0.0 - 2026-07-25 - Multi-colour palettes, 18 algorithms, adjustments, halftone screens.
 */
var PM = (function () {
  'use strict';

  /* ================================================================= palettes */

  var PALETTES = [
    // — two-tone, the original illusion family —
    { id: 'ink-cyan', name: 'Ink & Cyan', tags: ['duotone'], colors: ['#111111', '#00e5d0'] },
    { id: 'hot-magenta', name: 'Hot Magenta', tags: ['duotone'], colors: ['#1f1b5b', '#ff4d8d'] },
    { id: 'midnight-gold', name: 'Midnight Gold', tags: ['duotone'], colors: ['#102030', '#ffd84d'] },
    { id: 'paper-red', name: 'Paper & Red', tags: ['duotone', 'print'], colors: ['#ffffff', '#ff3b30'] },
    { id: 'terminal', name: 'Terminal', tags: ['duotone', 'retro'], colors: ['#002b36', '#9cff57'] },
    { id: 'amber-crt', name: 'Amber CRT', tags: ['duotone', 'retro'], colors: ['#0b0b0f', '#ffb000'] },
    { id: 'blueprint', name: 'Blueprint', tags: ['duotone', 'print'], colors: ['#0a2d5e', '#e8f1ff'] },
    { id: 'newsprint', name: 'Newsprint', tags: ['duotone', 'print'], colors: ['#f2ede3', '#0b0b0f'] },
    { id: 'riso-flame', name: 'Riso Flame', tags: ['duotone', 'print'], colors: ['#fff1e0', '#ff4d3d'] },
    { id: 'oxide', name: 'Oxide', tags: ['duotone'], colors: ['#241a13', '#e07a3f'] },

    // — three to five inks, risograph and poster territory —
    { id: 'riso-trio', name: 'Riso Trio', tags: ['print', 'artistic'], colors: ['#fff6e8', '#0050d0', '#ff4d8d'] },
    { id: 'riso-quad', name: 'Riso Quad', tags: ['print', 'artistic'], colors: ['#fff6e8', '#0050d0', '#ff4d8d', '#ffd400'] },
    { id: 'sunset-strip', name: 'Sunset Strip', tags: ['artistic'], colors: ['#1b1033', '#6b2d8c', '#e0457b', '#ff9e4a', '#ffe6a7'] },
    { id: 'vaporwave', name: 'Vaporwave', tags: ['artistic'], colors: ['#20003c', '#6a1e9a', '#ff5ebc', '#3ee8f0', '#fff3fb'] },
    { id: 'thermal', name: 'Thermal', tags: ['artistic', 'scientific'], colors: ['#000018', '#4b0f6e', '#c2274b', '#ff8c1a', '#ffe98a', '#ffffff'] },
    { id: 'ocean-depth', name: 'Ocean Depth', tags: ['artistic'], colors: ['#01121f', '#063a5e', '#0d7a94', '#48c9b0', '#dff7f4'] },
    { id: 'forest-floor', name: 'Forest Floor', tags: ['artistic'], colors: ['#12180f', '#2f4227', '#5c7a3f', '#a3b86c', '#e8e4c9'] },
    { id: 'sepia-five', name: 'Sepia Five', tags: ['photo'], colors: ['#241a12', '#4f3823', '#8a6743', '#c6a276', '#f2e3cd'] },
    { id: 'ash-grey', name: 'Ash', tags: ['photo'], colors: ['#101014', '#3a3a42', '#6d6d78', '#a8a8b2', '#e8e8ee'] },
    { id: 'neon-noir', name: 'Neon Noir', tags: ['artistic'], colors: ['#07030f', '#2a0f45', '#7b1fa2', '#ff2e88', '#00f0ff', '#f7f2ff'] },
    { id: 'candy-shop', name: 'Candy Shop', tags: ['artistic'], colors: ['#fff6fb', '#ffd1e8', '#ff7ac0', '#7ad7ff', '#3a2a5e'] },

    // — hardware palettes, exact —
    { id: 'gameboy', name: 'Game Boy', tags: ['retro', 'hardware'], colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'] },
    { id: 'gameboy-pocket', name: 'Game Boy Pocket', tags: ['retro', 'hardware'], colors: ['#181818', '#4a4a4a', '#8c8c8c', '#c8c8c8'] },
    { id: 'cga-cyan', name: 'CGA Mode 4', tags: ['retro', 'hardware'], colors: ['#000000', '#55ffff', '#ff55ff', '#ffffff'] },
    { id: 'cga-red', name: 'CGA Mode 5', tags: ['retro', 'hardware'], colors: ['#000000', '#00aaaa', '#aa0000', '#aaaaaa'] },
    { id: 'teletext', name: 'Teletext', tags: ['retro', 'hardware'], colors: ['#000000', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff'] },
    {
      id: 'ega', name: 'EGA 16', tags: ['retro', 'hardware'],
      colors: ['#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#aa5500', '#aaaaaa',
        '#555555', '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff', '#ffff55', '#ffffff'],
    },
    {
      id: 'c64', name: 'Commodore 64', tags: ['retro', 'hardware'],
      colors: ['#000000', '#ffffff', '#880000', '#aaffee', '#cc44cc', '#00cc55', '#0000aa', '#eeee77',
        '#dd8855', '#664400', '#ff7777', '#333333', '#777777', '#aaff66', '#0088ff', '#bbbbbb'],
    },
    {
      id: 'pico8', name: 'PICO-8', tags: ['retro', 'hardware'],
      colors: ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
        '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'],
    },
    {
      id: 'zx-spectrum', name: 'ZX Spectrum', tags: ['retro', 'hardware'],
      colors: ['#000000', '#0000d7', '#d70000', '#d700d7', '#00d700', '#00d7d7', '#d7d700', '#d7d7d7',
        '#0000ff', '#ff0000', '#ff00ff', '#00ff00', '#00ffff', '#ffff00', '#ffffff'],
    },
    {
      id: 'solarized', name: 'Solarized', tags: ['artistic'],
      colors: ['#002b36', '#073642', '#586e75', '#839496', '#93a1a1', '#eee8d5', '#fdf6e3',
        '#b58900', '#cb4b16', '#dc322f', '#d33682', '#6c71c4', '#268bd2', '#2aa198', '#859900'],
    },
    { id: 'mono', name: 'Pure Mono', tags: ['duotone'], colors: ['#000000', '#ffffff'] },
  ];

  var PALETTE_INDEX = {};
  for (var pi = 0; pi < PALETTES.length; pi++) PALETTE_INDEX[PALETTES[pi].id] = PALETTES[pi];

  /* =============================================================== algorithms */

  var ALGORITHMS = [
    { id: 'bayer2', name: 'Bayer 2×2', kind: 'ordered', note: 'Coarsest ordered grid — heavy, graphic texture.' },
    { id: 'bayer4', name: 'Bayer 4×4', kind: 'ordered', note: 'The classic crosshatch look.' },
    { id: 'bayer8', name: 'Bayer 8×8', kind: 'ordered', note: 'Finer grid, smoother gradients.' },
    { id: 'bayer16', name: 'Bayer 16×16', kind: 'ordered', note: 'Almost continuous tone, still perfectly regular.' },
    { id: 'void-cluster', name: 'Blue noise', kind: 'noise', note: 'Organic, grainless film-like texture with no visible grid.' },
    { id: 'white-noise', name: 'White noise', kind: 'noise', note: 'Random static — rough, analogue, deliberately ugly.' },
    { id: 'spiral', name: 'Spiral cluster', kind: 'ordered', note: 'Clustered dots that grow outward — engraved feel.' },
    { id: 'halftone-dot', name: 'Halftone dots', kind: 'halftone', note: 'Rotatable print screen. Try 45°.' },
    { id: 'halftone-line', name: 'Halftone lines', kind: 'halftone', note: 'Line screen — engraving and banknote territory.' },
    { id: 'halftone-cross', name: 'Crosshatch', kind: 'halftone', note: 'Two line screens crossed — pen-and-ink shading.' },
    { id: 'floyd-steinberg', name: 'Floyd–Steinberg', kind: 'diffusion', note: 'The standard error diffusion. Detailed, slightly wormy.' },
    { id: 'jarvis', name: 'Jarvis–Judice–Ninke', kind: 'diffusion', note: 'Wide diffusion — soft and smooth.' },
    { id: 'stucki', name: 'Stucki', kind: 'diffusion', note: 'Like Jarvis but crisper.' },
    { id: 'burkes', name: 'Burkes', kind: 'diffusion', note: 'Fast two-row diffusion, clean edges.' },
    { id: 'sierra', name: 'Sierra', kind: 'diffusion', note: 'Balanced three-row diffusion.' },
    { id: 'sierra-lite', name: 'Sierra Lite', kind: 'diffusion', note: 'Minimal diffusion — grainy and contrasty.' },
    { id: 'atkinson', name: 'Atkinson', kind: 'diffusion', note: 'Classic Macintosh look: blown highlights, airy.' },
    { id: 'threshold', name: 'Hard threshold', kind: 'none', note: 'No dither at all — pure posterised shapes.' },
  ];

  var ALGO_INDEX = {};
  for (var ai = 0; ai < ALGORITHMS.length; ai++) ALGO_INDEX[ALGORITHMS[ai].id] = ALGORITHMS[ai];

  /** Error-diffusion kernels: [dx, dy, weight] with a shared divisor. */
  var KERNELS = {
    'floyd-steinberg': { div: 16, taps: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] },
    jarvis: { div: 48, taps: [[1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3], [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]] },
    stucki: { div: 42, taps: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2], [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]] },
    burkes: { div: 32, taps: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2]] },
    sierra: { div: 32, taps: [[1, 0, 5], [2, 0, 3], [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4], [2, 1, 2], [-1, 2, 2], [0, 2, 3], [1, 2, 2]] },
    'sierra-lite': { div: 4, taps: [[1, 0, 2], [-1, 1, 1], [0, 1, 1]] },
    atkinson: { div: 8, taps: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] },
  };

  /* ================================================================== helpers */

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function clampInt(v, a, b) { v = Math.round(+v); if (!isFinite(v)) v = a; return v < a ? a : v > b ? b : v; }

  function hexToRgb(h) {
    if (typeof h !== 'string') return [0, 0, 0];
    h = h.trim().replace(/^#/, '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return [0, 0, 0];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(c) {
    var s = ((1 << 24) + (c[0] << 16) + (c[1] << 8) + c[2]).toString(16).slice(1);
    return '#' + s;
  }

  /** Bayer threshold matrix of order n (2, 4, 8, 16), values 0..n*n-1. */
  function bayerMatrix(n) {
    var m = [[0]];
    while (m.length < n) {
      var s = m.length, r = [];
      for (var y = 0; y < s * 2; y++) r.push(new Int32Array(s * 2));
      for (var yy = 0; yy < s; yy++) {
        for (var xx = 0; xx < s; xx++) {
          var v = m[yy][xx] * 4;
          r[yy][xx] = v; r[yy][xx + s] = v + 2; r[yy + s][xx] = v + 3; r[yy + s][xx + s] = v + 1;
        }
      }
      m = r;
    }
    return m;
  }

  /** Clustered-dot spiral matrix (8×8): thresholds grow outward from the cell centre. */
  function spiralMatrix() {
    var n = 8, cells = [];
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        var dx = x - 3.5, dy = y - 3.5;
        cells.push({ x: x, y: y, d: dx * dx + dy * dy + 0.001 * Math.atan2(dy, dx) });
      }
    }
    cells.sort(function (a, b) { return a.d - b.d; });
    var m = [];
    for (var i = 0; i < n; i++) m.push(new Int32Array(n));
    for (var k = 0; k < cells.length; k++) m[cells[k].y][cells[k].x] = k;
    return m;
  }

  /** Build a normalised (0..1) threshold tile for an ordered algorithm. */
  function orderedTile(algorithm) {
    var m, n;
    if (algorithm === 'spiral') { m = spiralMatrix(); n = 8; }
    else {
      n = algorithm === 'bayer2' ? 2 : algorithm === 'bayer8' ? 8 : algorithm === 'bayer16' ? 16 : 4;
      m = bayerMatrix(n);
    }
    var tile = new Float64Array(n * n), den = n * n;
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) tile[y * n + x] = (m[y][x] + 0.5) / den;
    return { tile: tile, n: n };
  }

  /* ================================================================== recipes */

  var DEFAULTS = {
    size: 512,
    palette: 'ink-cyan',
    colors: null,
    colorCount: 6,
    algorithm: 'bayer4',
    scale: 2,
    strength: 100,
    serpentine: true,
    pixelate: false,
    angle: 45,
    brightness: 0,
    contrast: 20,
    gamma: 100,
    saturation: 0,
    hue: 0,
    sharpen: 0,
    invert: false,
    posterize: 0,
    bias: 0,
    zoom: 100,
    offsetX: 0,
    offsetY: 0,
    rotate: 0,
    fit: 'cover',
  };

  /**
   * Fill in every field, clamp every range, and resolve the palette to concrete colours.
   * `maxSize` lets the browser allow bigger renders than the sandbox does.
   */
  function normalizeRecipe(input, maxSize) {
    var r = {}, k;
    input = input || {};
    for (k in DEFAULTS) if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) r[k] = DEFAULTS[k];
    for (k in input) if (Object.prototype.hasOwnProperty.call(DEFAULTS, k) && input[k] !== undefined && input[k] !== null) r[k] = input[k];

    r.size = clampInt(r.size, 64, maxSize || 1024);
    r.scale = clampInt(r.scale, 1, 24);
    r.strength = clampInt(r.strength, 0, 200);
    r.angle = clampInt(r.angle, 0, 180);
    r.brightness = clampInt(r.brightness, -100, 100);
    r.contrast = clampInt(r.contrast, -100, 100);
    r.gamma = clampInt(r.gamma, 10, 300);
    r.saturation = clampInt(r.saturation, -100, 200);
    r.hue = clampInt(r.hue, -180, 180);
    r.sharpen = clampInt(r.sharpen, 0, 100);
    r.posterize = clampInt(r.posterize, 0, 16);
    if (r.posterize === 1) r.posterize = 2;
    r.bias = clampInt(r.bias, -100, 100);
    r.zoom = clampInt(r.zoom, 100, 400);
    r.offsetX = clampInt(r.offsetX, -100, 100);
    r.offsetY = clampInt(r.offsetY, -100, 100);
    r.rotate = clampInt(r.rotate, -180, 180);
    r.colorCount = clampInt(r.colorCount, 2, 16);
    r.serpentine = !!r.serpentine;
    r.pixelate = !!r.pixelate;
    r.invert = !!r.invert;
    r.fit = r.fit === 'contain' ? 'contain' : 'cover';
    if (!ALGO_INDEX[r.algorithm]) r.algorithm = 'bayer4';

    var colors = null;
    if (Array.isArray(r.colors) && r.colors.length >= 2) {
      colors = [];
      for (var i = 0; i < r.colors.length && colors.length < 16; i++) colors.push(rgbToHex(hexToRgb(r.colors[i])));
      r.palette = PALETTE_INDEX[r.palette] ? r.palette : 'custom';
    } else if (r.palette === 'auto') {
      colors = null; // resolved from the image at render time
    } else {
      var p = PALETTE_INDEX[r.palette];
      if (!p) { p = PALETTE_INDEX['ink-cyan']; r.palette = 'ink-cyan'; }
      colors = p.colors.slice();
    }
    r.colors = colors;
    return r;
  }

  /* ============================================================= palette pick */

  /** Median-cut palette extraction from an RGBA buffer. Returns hex strings. */
  function extractPalette(rgba, w, h, count) {
    count = clampInt(count, 2, 16);
    var step = Math.max(1, Math.floor(Math.sqrt(w * h / 5000)));
    var pts = [];
    for (var y = 0; y < h; y += step) {
      for (var x = 0; x < w; x += step) {
        var i = (y * w + x) * 4;
        pts.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
      }
    }
    if (!pts.length) return ['#000000', '#ffffff'];

    var boxes = [pts];
    while (boxes.length < count) {
      var bi = -1, bestRange = -1;
      for (var b = 0; b < boxes.length; b++) {
        if (boxes[b].length < 2) continue;
        var mins = [255, 255, 255], maxs = [0, 0, 0];
        for (var q = 0; q < boxes[b].length; q++) {
          for (var c = 0; c < 3; c++) {
            var v = boxes[b][q][c];
            if (v < mins[c]) mins[c] = v;
            if (v > maxs[c]) maxs[c] = v;
          }
        }
        var range = Math.max(maxs[0] - mins[0], maxs[1] - mins[1], maxs[2] - mins[2]) * boxes[b].length;
        if (range > bestRange) { bestRange = range; bi = b; }
      }
      if (bi < 0 || bestRange <= 0) break;

      var box = boxes[bi], mn = [255, 255, 255], mx = [0, 0, 0];
      for (var q2 = 0; q2 < box.length; q2++) {
        for (var c2 = 0; c2 < 3; c2++) {
          if (box[q2][c2] < mn[c2]) mn[c2] = box[q2][c2];
          if (box[q2][c2] > mx[c2]) mx[c2] = box[q2][c2];
        }
      }
      var axis = 0, span = mx[0] - mn[0];
      if (mx[1] - mn[1] > span) { axis = 1; span = mx[1] - mn[1]; }
      if (mx[2] - mn[2] > span) { axis = 2; }
      box.sort(function (p1, p2) { return p1[axis] - p2[axis]; });
      var mid = box.length >> 1;
      boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
    }

    var out = [];
    for (var bb = 0; bb < boxes.length; bb++) {
      var s0 = 0, s1 = 0, s2 = 0, n = boxes[bb].length;
      if (!n) continue;
      for (var t = 0; t < n; t++) { s0 += boxes[bb][t][0]; s1 += boxes[bb][t][1]; s2 += boxes[bb][t][2]; }
      out.push(rgbToHex([Math.round(s0 / n), Math.round(s1 / n), Math.round(s2 / n)]));
    }
    out.sort(function (a, b2) {
      var ca = hexToRgb(a), cb = hexToRgb(b2);
      return (ca[0] * 0.2126 + ca[1] * 0.7152 + ca[2] * 0.0722) - (cb[0] * 0.2126 + cb[1] * 0.7152 + cb[2] * 0.0722);
    });
    while (out.length < 2) out.push(out.length ? '#ffffff' : '#000000');
    return out;
  }

  /* ================================================================= geometry */

  /**
   * Resample the source into `dw × dh` applying zoom / offset / rotation. Box-averages when
   * downscaling without rotation (sharp, alias-free) and bilinear-samples otherwise.
   */
  function resample(src, sw, sh, dw, dh, r) {
    var out = new Uint8Array(dw * dh * 4);
    var rot = r.rotate * Math.PI / 180;
    var cos = Math.cos(rot), sin = Math.sin(rot);
    var rw = Math.abs(sw * cos) + Math.abs(sh * sin);
    var rh = Math.abs(sw * sin) + Math.abs(sh * cos);
    var base = (r.fit === 'contain' ? Math.min(dw / rw, dh / rh) : Math.max(dw / rw, dh / rh)) * (r.zoom / 100);
    var dx = (r.offsetX / 100) * dw * 0.45, dy = (r.offsetY / 100) * dh * 0.45;

    // Fast path: axis-aligned box average. Also taken for a mild upscale, where the box collapses
    // to a single source pixel — nearest sampling, which after quantising to a few inks is
    // indistinguishable from bilinear and costs a fraction of it.
    if (r.rotate === 0 && base <= 1.4) {
      var invS = 1 / base;
      for (var y = 0; y < dh; y++) {
        var sy0 = (y - dh / 2 - dy) * invS + sh / 2;
        var sy1 = sy0 + invS;
        var y0 = Math.floor(sy0), y1 = Math.ceil(sy1);
        if (y1 <= y0) y1 = y0 + 1;
        if (y0 < 0) y0 = 0;
        if (y1 > sh) y1 = sh;
        for (var x = 0; x < dw; x++) {
          var sx0 = (x - dw / 2 - dx) * invS + sw / 2;
          var sx1 = sx0 + invS;
          var x0 = Math.floor(sx0), x1 = Math.ceil(sx1);
          if (x1 <= x0) x1 = x0 + 1;
          if (x0 < 0) x0 = 0;
          if (x1 > sw) x1 = sw;
          var o = (y * dw + x) * 4;
          if (x1 <= x0 || y1 <= y0) { out[o] = 255; out[o + 1] = 255; out[o + 2] = 255; out[o + 3] = 255; continue; }
          var a0 = 0, a1 = 0, a2 = 0, cnt = 0;
          for (var yy = y0; yy < y1; yy++) {
            var rowo = yy * sw * 4;
            for (var xx = x0; xx < x1; xx++) {
              var si = rowo + xx * 4;
              a0 += src[si]; a1 += src[si + 1]; a2 += src[si + 2]; cnt++;
            }
          }
          out[o] = (a0 / cnt) | 0; out[o + 1] = (a1 / cnt) | 0; out[o + 2] = (a2 / cnt) | 0; out[o + 3] = 255;
        }
      }
      return out;
    }

    // General path: inverse-map each destination pixel through the transform, bilinear sample.
    var inv = 1 / base;
    for (var y2 = 0; y2 < dh; y2++) {
      var py = (y2 - dh / 2 - dy) * inv;
      for (var x2 = 0; x2 < dw; x2++) {
        var px = (x2 - dw / 2 - dx) * inv;
        var sx = px * cos + py * sin + sw / 2;
        var sy = -px * sin + py * cos + sh / 2;
        var o2 = (y2 * dw + x2) * 4;
        if (sx < 0 || sy < 0 || sx >= sw - 1 || sy >= sh - 1) {
          var cx = clamp(Math.round(sx), 0, sw - 1), cy = clamp(Math.round(sy), 0, sh - 1);
          if (sx < -1 || sy < -1 || sx > sw || sy > sh) {
            out[o2] = 255; out[o2 + 1] = 255; out[o2 + 2] = 255; out[o2 + 3] = 255;
          } else {
            var ci = (cy * sw + cx) * 4;
            out[o2] = src[ci]; out[o2 + 1] = src[ci + 1]; out[o2 + 2] = src[ci + 2]; out[o2 + 3] = 255;
          }
          continue;
        }
        var ix = sx | 0, iy = sy | 0, fx = sx - ix, fy = sy - iy;
        var i00 = (iy * sw + ix) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
        var w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        out[o2] = (src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11) | 0;
        out[o2 + 1] = (src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11) | 0;
        out[o2 + 2] = (src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11) | 0;
        out[o2 + 3] = 255;
      }
    }
    return out;
  }

  /* =============================================================== adjustments */

  /** Brightness, contrast, gamma, invert and posterize collapse into one 256-entry curve. */
  function toneCurve(r) {
    var lut = new Uint8Array(256);
    var k = 1 + r.contrast / 100;
    var b = r.brightness * 2.55;
    var g = 100 / r.gamma;
    var levels = r.posterize >= 2 ? r.posterize : 0;
    for (var i = 0; i < 256; i++) {
      var v = i;
      v = (v - 128) * k + 128 + b;
      v = clamp(v, 0, 255);
      if (g !== 1) v = 255 * Math.pow(v / 255, g);
      if (r.invert) v = 255 - v;
      if (levels) v = Math.round(Math.round(v * (levels - 1) / 255) * 255 / (levels - 1));
      lut[i] = clamp(Math.round(v), 0, 255);
    }
    return lut;
  }

  /** Hue rotation + saturation as one 3×3 matrix (YIQ-style, the classic filter matrix). */
  function colorMatrix(r) {
    var s = 1 + (r.saturation >= 0 ? r.saturation / 100 : r.saturation / 100);
    var a = r.hue * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
    var lr = 0.2126, lg = 0.7152, lb = 0.0722;
    // saturation matrix
    var m = [
      lr + s * (1 - lr), lg - s * lg, lb - s * lb,
      lr - s * lr, lg + s * (1 - lg), lb - s * lb,
      lr - s * lr, lg - s * lg, lb + s * (1 - lb),
    ];
    if (r.hue === 0) return m;
    var h = [
      lr + c * (1 - lr) - sn * lr, lg + c * (-lg) - sn * lg, lb + c * (-lb) + sn * (1 - lb),
      lr + c * (-lr) + sn * 0.143, lg + c * (1 - lg) + sn * 0.140, lb + c * (-lb) - sn * 0.283,
      lr + c * (-lr) - sn * (1 - lr), lg + c * (-lg) + sn * lg, lb + c * (1 - lb) + sn * lb,
    ];
    // multiply saturation after hue
    var out = new Array(9);
    for (var i = 0; i < 3; i++) {
      for (var j = 0; j < 3; j++) {
        out[i * 3 + j] = m[i * 3] * h[j] + m[i * 3 + 1] * h[3 + j] + m[i * 3 + 2] * h[6 + j];
      }
    }
    return out;
  }

  function applyAdjustments(buf, w, h, r) {
    var n = w * h, i;

    if (r.sharpen > 0) {
      var amt = r.sharpen / 100 * 1.6;
      var copy = new Uint8Array(buf.length);
      copy.set(buf);
      for (var y = 1; y < h - 1; y++) {
        for (var x = 1; x < w - 1; x++) {
          var o = (y * w + x) * 4;
          for (var c = 0; c < 3; c++) {
            var centre = copy[o + c];
            var blur = (copy[o - 4 + c] + copy[o + 4 + c] + copy[o - w * 4 + c] + copy[o + w * 4 + c]) * 0.25;
            buf[o + c] = clamp(centre + (centre - blur) * amt, 0, 255) | 0;
          }
        }
      }
    }

    if (r.saturation !== 0 || r.hue !== 0) {
      var m = colorMatrix(r);
      for (i = 0; i < n; i++) {
        var p = i * 4, R = buf[p], G = buf[p + 1], B = buf[p + 2];
        buf[p] = clamp(m[0] * R + m[1] * G + m[2] * B, 0, 255) | 0;
        buf[p + 1] = clamp(m[3] * R + m[4] * G + m[5] * B, 0, 255) | 0;
        buf[p + 2] = clamp(m[6] * R + m[7] * G + m[8] * B, 0, 255) | 0;
      }
    }

    var lut = toneCurve(r);
    for (i = 0; i < n; i++) {
      var q = i * 4;
      buf[q] = lut[buf[q]]; buf[q + 1] = lut[buf[q + 1]]; buf[q + 2] = lut[buf[q + 2]];
    }
  }

  /** Average each scale×scale block so the dither lands on chunky pixel-art cells. */
  function pixelateBuffer(buf, w, h, cell) {
    if (cell < 2) return;
    for (var by = 0; by < h; by += cell) {
      var yEnd = Math.min(by + cell, h);
      for (var bx = 0; bx < w; bx += cell) {
        var xEnd = Math.min(bx + cell, w), a0 = 0, a1 = 0, a2 = 0, cnt = 0, y, x, o;
        for (y = by; y < yEnd; y++) {
          for (x = bx; x < xEnd; x++) { o = (y * w + x) * 4; a0 += buf[o]; a1 += buf[o + 1]; a2 += buf[o + 2]; cnt++; }
        }
        a0 = (a0 / cnt) | 0; a1 = (a1 / cnt) | 0; a2 = (a2 / cnt) | 0;
        for (y = by; y < yEnd; y++) {
          for (x = bx; x < xEnd; x++) { o = (y * w + x) * 4; buf[o] = a0; buf[o + 1] = a1; buf[o + 2] = a2; }
        }
      }
    }
  }

  /* ================================================================ quantiser */

  function makeQuantiser(palette) {
    var n = palette.length;
    var pr = new Int32Array(n), pg = new Int32Array(n), pb = new Int32Array(n);
    for (var i = 0; i < n; i++) { pr[i] = palette[i][0]; pg[i] = palette[i][1]; pb[i] = palette[i][2]; }

    // Small palettes are faster to search directly than to cache.
    if (n <= 4) {
      return function (r, g, b) {
        var best = 0, bd = 1e9;
        for (var k = 0; k < n; k++) {
          var dr = r - pr[k], dg = g - pg[k], db = b - pb[k];
          var d = dr * dr * 3 + dg * dg * 6 + db * db;
          if (d < bd) { bd = d; best = k; }
        }
        return best;
      };
    }
    // Lazily filled 6-bit-per-channel cache: a photo touches a small slice of it.
    var cache = new Int8Array(262144);
    for (var c = 0; c < 262144; c++) cache[c] = -1;
    return function (r, g, b) {
      var key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
      var hit = cache[key];
      if (hit >= 0) return hit;
      var best = 0, bd = 1e9;
      for (var k = 0; k < n; k++) {
        var dr = r - pr[k], dg = g - pg[k], db = b - pb[k];
        var d = dr * dr * 3 + dg * dg * 6 + db * db;
        if (d < bd) { bd = d; best = k; }
      }
      cache[key] = best;
      return best;
    };
  }

  /** How far apart the palette entries sit — sets how much threshold offset actually helps. */
  function paletteSpread(palette) {
    var n = palette.length;
    if (n < 2) return 64;
    var sum = 0;
    for (var i = 0; i < n; i++) {
      var best = 1e9;
      for (var j = 0; j < n; j++) {
        if (i === j) continue;
        var dr = palette[i][0] - palette[j][0], dg = palette[i][1] - palette[j][1], db = palette[i][2] - palette[j][2];
        var d = Math.sqrt(dr * dr + dg * dg + db * db);
        if (d < best) best = d;
      }
      sum += best;
    }
    return sum / n;
  }

  /* =================================================================== render */

  /**
   * Turn a source RGBA buffer into a palette-indexed image.
   * Returns `{ indices, palette, colors, width, height, recipe }`.
   */
  /**
   * Work out the output geometry and which resample path a recipe will take, WITHOUT doing any
   * of the work. The caller uses this to price a render before committing to it; `render` uses
   * the same function, so the estimate and the job can never disagree about the shape.
   */
  function plan(sw, sh, r) {
    var ratio = sw / sh, dw, dh;
    if (ratio >= 1) { dw = r.size; dh = Math.max(1, Math.round(r.size / ratio)); }
    else { dh = r.size; dw = Math.max(1, Math.round(r.size * ratio)); }
    var rot = r.rotate * Math.PI / 180;
    var cos = Math.abs(Math.cos(rot)), sin = Math.abs(Math.sin(rot));
    var rw = sw * cos + sh * sin, rh = sw * sin + sh * cos;
    var base = (r.fit === 'contain' ? Math.min(dw / rw, dh / rh) : Math.max(dw / rw, dh / rh)) * (r.zoom / 100);
    return { width: dw, height: dh, base: base, bilinear: r.rotate !== 0 || base > 1.4 };
  }

  function render(src, sw, sh, recipe) {
    var r = recipe;
    var geo = plan(sw, sh, r);
    var dw = geo.width, dh = geo.height;

    var buf = resample(src, sw, sh, dw, dh, r);
    applyAdjustments(buf, dw, dh, r);
    if (r.pixelate && r.scale > 1) pixelateBuffer(buf, dw, dh, r.scale);

    var colors = r.colors;
    if (!colors) colors = extractPalette(buf, dw, dh, r.colorCount);
    var palette = [];
    for (var pcI = 0; pcI < colors.length; pcI++) palette.push(hexToRgb(colors[pcI]));

    var indices = new Uint8Array(dw * dh);
    var algo = ALGO_INDEX[r.algorithm];
    var strength = r.strength / 100;

    if (algo.kind === 'diffusion') {
      diffuse(buf, dw, dh, palette, indices, KERNELS[r.algorithm], strength, r.serpentine);
    } else if (palette.length === 2) {
      thresholdTwoTone(buf, dw, dh, palette, indices, r, algo, strength);
    } else {
      orderedMulti(buf, dw, dh, palette, indices, r, algo, strength);
    }

    return {
      indices: indices, palette: palette, colors: colors,
      width: dw, height: dh, recipe: r,
    };
  }

  /**
   * The screen as DATA where it can be one — an ordered matrix is a plain array lookup, and the
   * inner loops below read it directly instead of paying a closure call per pixel. Only the
   * screens that genuinely need arithmetic per pixel (halftone angles, noise) stay callable.
   */
  function screenDescriptor(r, algo) {
    if (algo.kind === 'ordered') {
      var ot = orderedTile(r.algorithm);
      return { kind: 'tile', tile: ot.tile, n: ot.n, scale: r.scale };
    }
    return { kind: 'fn', fn: makeScreen(r, algo) };
  }

  /** Threshold source: returns a function (x, y) -> t in 0..1 for the chosen ordered/halftone screen. */
  function makeScreen(r, algo) {
    if (algo.kind === 'halftone') {
      var T = clamp(r.scale * 4, 4, 64);
      var a = r.angle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      var invT = 1 / T;
      var mode = r.algorithm;
      return function (x, y) {
        var u = (x * ca + y * sa) * invT, v = (-x * sa + y * ca) * invT;
        var fu = u - Math.floor(u), fv = v - Math.floor(v);
        var tu = fu < 0.5 ? fu * 2 : 2 - fu * 2;
        var tv = fv < 0.5 ? fv * 2 : 2 - fv * 2;
        if (mode === 'halftone-line') return tu;
        if (mode === 'halftone-cross') return tu < tv ? tu : tv;
        return (tu + tv) * 0.5;
      };
    }
    if (algo.kind === 'noise') {
      var cell = r.scale;
      if (r.algorithm === 'white-noise') {
        return function (x, y) {
          var h = ((x / cell) | 0) * 374761393 + ((y / cell) | 0) * 668265263;
          h = (h ^ (h >> 13)) * 1274126177;
          return ((h ^ (h >> 16)) >>> 0) / 4294967296;
        };
      }
      // Interleaved gradient noise: blue-noise-like spectrum, three operations.
      return function (x, y) {
        var v = 0.06711056 * ((x / cell) | 0) + 0.00583715 * ((y / cell) | 0);
        var f = 52.9829189 * (v - Math.floor(v));
        return f - Math.floor(f);
      };
    }
    if (algo.kind === 'none') return function () { return 0.5; };
    var ot = orderedTile(r.algorithm), tile = ot.tile, n = ot.n, sc = r.scale;
    return function (x, y) {
      return tile[(((y / sc) | 0) % n) * n + (((x / sc) | 0) % n)];
    };
  }

  /** Two-colour path: threshold on luminance, which is what makes the classic illusion read. */
  function thresholdTwoTone(buf, dw, dh, palette, indices, r, algo, strength) {
    var sd = screenDescriptor(r, algo);
    var bias = r.bias / 200, x, y, i, lum, t;
    if (sd.kind === 'tile') {
      var tile = sd.tile, n = sd.n, sc = sd.scale;
      for (y = 0; y < dh; y++) {
        var row = (((y / sc) | 0) % n) * n;
        for (x = 0; x < dw; x++) {
          i = (y * dw + x) * 4;
          lum = (0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) / 255;
          t = 0.5 + (tile[row + (((x / sc) | 0) % n)] - 0.5) * strength - bias;
          indices[y * dw + x] = lum > t ? 1 : 0;
        }
      }
      return;
    }
    var screen = sd.fn;
    for (y = 0; y < dh; y++) {
      for (x = 0; x < dw; x++) {
        i = (y * dw + x) * 4;
        lum = (0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) / 255;
        t = 0.5 + (screen(x, y) - 0.5) * strength - bias;
        indices[y * dw + x] = lum > t ? 1 : 0;
      }
    }
  }

  /** Multi-colour ordered path: offset every channel by the screen, then snap to the palette. */
  function orderedMulti(buf, dw, dh, palette, indices, r, algo, strength) {
    var sd = screenDescriptor(r, algo);
    var quant = makeQuantiser(palette);
    var spread = paletteSpread(palette) * 0.55 * strength;
    var bias = r.bias * 1.28;
    var x, y, i, off, R, G, B;

    if (sd.kind === 'tile') {
      var tile = sd.tile, n = sd.n, sc = sd.scale;
      for (y = 0; y < dh; y++) {
        var row = (((y / sc) | 0) % n) * n;
        for (x = 0; x < dw; x++) {
          i = (y * dw + x) * 4;
          off = (tile[row + (((x / sc) | 0) % n)] - 0.5) * spread - bias;
          R = buf[i] + off; G = buf[i + 1] + off; B = buf[i + 2] + off;
          indices[y * dw + x] = quant(
            R < 0 ? 0 : R > 255 ? 255 : R | 0,
            G < 0 ? 0 : G > 255 ? 255 : G | 0,
            B < 0 ? 0 : B > 255 ? 255 : B | 0,
          );
        }
      }
      return;
    }
    var screen = sd.fn;
    for (y = 0; y < dh; y++) {
      for (x = 0; x < dw; x++) {
        i = (y * dw + x) * 4;
        off = (screen(x, y) - 0.5) * spread - bias;
        R = buf[i] + off; G = buf[i + 1] + off; B = buf[i + 2] + off;
        indices[y * dw + x] = quant(
          R < 0 ? 0 : R > 255 ? 255 : R | 0,
          G < 0 ? 0 : G > 255 ? 255 : G | 0,
          B < 0 ? 0 : B > 255 ? 255 : B | 0,
        );
      }
    }
  }

  /** Error diffusion over the palette, optionally serpentine so the error does not streak one way. */
  function diffuse(buf, dw, dh, palette, indices, kernel, strength, serpentine) {
    var quant = makeQuantiser(palette);
    var errR = new Float32Array(dw * dh), errG = new Float32Array(dw * dh), errB = new Float32Array(dw * dh);
    var taps = kernel.taps, div = kernel.div, nt = taps.length;
    // A palette whose hull does not contain the image colour cannot absorb the error: the residue
    // compounds and a flat field slides into an ink nowhere near it. Bounding the carried error
    // keeps the dither local — at the limit of 0 this degrades to plain nearest-colour, which is
    // the honest answer when the palette simply cannot express the tone.
    var emax = clamp(paletteSpread(palette) * 0.75, 24, 110);

    for (var y = 0; y < dh; y++) {
      var ltr = !serpentine || (y & 1) === 0;
      for (var s = 0; s < dw; s++) {
        var x = ltr ? s : dw - 1 - s;
        var p = y * dw + x, i = p * 4;
        var eR = errR[p], eG = errG[p], eB = errB[p];
        if (eR > emax) eR = emax; else if (eR < -emax) eR = -emax;
        if (eG > emax) eG = emax; else if (eG < -emax) eG = -emax;
        if (eB > emax) eB = emax; else if (eB < -emax) eB = -emax;
        var R = buf[i] + eR, G = buf[i + 1] + eG, B = buf[i + 2] + eB;
        var cr = R < 0 ? 0 : R > 255 ? 255 : R | 0;
        var cg = G < 0 ? 0 : G > 255 ? 255 : G | 0;
        var cb = B < 0 ? 0 : B > 255 ? 255 : B | 0;
        var k = quant(cr, cg, cb);
        indices[p] = k;
        // The error must come from the CLAMPED value. Taking it from the raw accumulator lets a
        // palette whose inks are not collinear with the image colour compound its own error
        // without bound — a flat dark field then drifts into whatever ink sits off that axis.
        var dr = (cr - palette[k][0]) * strength;
        var dg = (cg - palette[k][1]) * strength;
        var db = (cb - palette[k][2]) * strength;
        for (var t = 0; t < nt; t++) {
          var tap = taps[t];
          var tx = x + (ltr ? tap[0] : -tap[0]), ty = y + tap[1];
          if (tx < 0 || tx >= dw || ty >= dh) continue;
          var tp = ty * dw + tx, wgt = tap[2] / div;
          errR[tp] += dr * wgt; errG[tp] += dg * wgt; errB[tp] += db * wgt;
        }
      }
    }
  }

  /** Expand an indexed result back to RGBA (what the browser paints). */
  function toRgba(result) {
    var n = result.width * result.height, out = new Uint8Array(n * 4), pal = result.palette;
    for (var i = 0; i < n; i++) {
      var c = pal[result.indices[i]], o = i * 4;
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
    }
    return out;
  }

  return {
    PALETTES: PALETTES,
    ALGORITHMS: ALGORITHMS,
    algorithmKind: function (id) { return (ALGO_INDEX[id] || ALGO_INDEX['bayer4']).kind; },
    DEFAULTS: DEFAULTS,
    normalizeRecipe: normalizeRecipe,
    extractPalette: extractPalette,
    hexToRgb: hexToRgb,
    rgbToHex: rgbToHex,
    render: render,
    plan: plan,
    toRgba: toRgba,
    resample: resample,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PM;
