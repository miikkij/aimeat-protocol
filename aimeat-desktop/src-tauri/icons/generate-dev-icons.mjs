/**
 * generate-dev-icons.mjs
 *
 * Generates development placeholder PNG icons for Tauri bundling.
 * Uses only Node.js built-in modules (no dependencies).
 *
 * The generated PNGs are simple colored squares with the AIMEAT brand
 * color gradient approximation. For production icons, use:
 *
 *   cargo tauri icon icons/icon.svg
 *
 * or use the sharp-based generation approach described in icons/README.md.
 *
 * Usage:
 *   node icons/generate-dev-icons.mjs
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- PNG generation helpers (no dependencies) ---

function crc32(buf) {
  // CRC32 lookup table
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);

  const typeAndData = Buffer.concat([typeBytes, data]);
  const crcVal = crc32(typeAndData);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal, 0);

  return Buffer.concat([len, typeAndData, crcBuf]);
}

function createPng(width, height, pixelCallback) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const ihdrChunk = makeChunk('IHDR', ihdr);

  // IDAT chunk - raw pixel data with filter bytes
  // Each row: 1 filter byte (0 = None) + width * 3 bytes (RGB)
  const rawData = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 3);
    rawData[rowOffset] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelCallback(x, y, width, height);
      const pixOffset = rowOffset + 1 + x * 3;
      rawData[pixOffset] = r;
      rawData[pixOffset + 1] = g;
      rawData[pixOffset + 2] = b;
    }
  }
  const compressed = deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', compressed);

  // IEND chunk
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// --- AIMEAT brand colors ---

// Background: #1a1a2e
const BG = [0x1a, 0x1a, 0x2e];

// Heart gradient: #c084fc -> #f472b6 -> #fb923c
function heartColor(t) {
  // t from 0..1 across gradient
  if (t < 0.5) {
    const s = t * 2;
    return [
      Math.round(0xc0 + (0xf4 - 0xc0) * s),
      Math.round(0x84 + (0x72 - 0x84) * s),
      Math.round(0xfc + (0xb6 - 0xfc) * s),
    ];
  } else {
    const s = (t - 0.5) * 2;
    return [
      Math.round(0xf4 + (0xfb - 0xf4) * s),
      Math.round(0x72 + (0x92 - 0x72) * s),
      Math.round(0xb6 + (0x3c - 0xb6) * s),
    ];
  }
}

// Simple heart shape test: is (x, y) inside the heart?
// Heart centered at (cx, cy) with given scale
function isInHeart(px, py, cx, cy, scale) {
  // Normalize to -1..1 range
  const x = (px - cx) / scale;
  const y = (cy - py) / scale; // flip y so heart points down visually

  // Heart implicit equation: (x^2 + y^2 - 1)^3 - x^2 * y^3 < 0
  const x2 = x * x;
  const y2 = y * y;
  const val = Math.pow(x2 + y2 - 1, 3) - x2 * y2 * y;
  return val < 0;
}

// Is point inside the rounded rect background?
function isInRoundedRect(x, y, w, h, r) {
  if (x < r && y < r) {
    return (x - r) * (x - r) + (y - r) * (y - r) <= r * r;
  }
  if (x > w - r && y < r) {
    return (x - (w - r)) * (x - (w - r)) + (y - r) * (y - r) <= r * r;
  }
  if (x < r && y > h - r) {
    return (x - r) * (x - r) + (y - (h - r)) * (y - (h - r)) <= r * r;
  }
  if (x > w - r && y > h - r) {
    return (x - (w - r)) * (x - (w - r)) + (y - (h - r)) * (y - (h - r)) <= r * r;
  }
  return true;
}

// Circuit node dot check
function isInCircle(px, py, cx, cy, r) {
  return (px - cx) * (px - cx) + (py - cy) * (py - cy) <= r * r;
}

// Line segment distance
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.sqrt((px - projX) * (px - projX) + (py - projY) * (py - projY));
}

function aimeatPixel(x, y, w, h) {
  const cornerRadius = w * 96 / 512;
  // Outside rounded rect -> transparent-ish (just use dark)
  if (!isInRoundedRect(x, y, w, h, cornerRadius)) {
    return [0, 0, 0];
  }

  // Background gradient
  const t = (x + y) / (w + h);
  const bgR = Math.round(0x1a + (0x16 - 0x1a) * t);
  const bgG = Math.round(0x1a + (0x21 - 0x1a) * t);
  const bgB = Math.round(0x2e + (0x3e - 0x2e) * t);

  // Heart: centered, scaled
  const cx = w / 2;
  const cy = h * 0.48; // slightly above center
  const heartScale = w * 0.28;

  if (isInHeart(x, y, cx, cy, heartScale)) {
    // Gradient across heart
    const ht = x / w;
    const [hr, hg, hb] = heartColor(ht);

    // Circuit nodes (white dots) - scaled positions
    const s = w / 512;
    const nodes = [
      { x: cx - 50 * s, y: cy - 35 * s, r: 10 * s },  // left
      { x: cx + 50 * s, y: cy - 35 * s, r: 10 * s },  // right
      { x: cx, y: cy, r: 12 * s },                       // center
      { x: cx, y: cy + 55 * s, r: 8 * s },              // bottom
    ];

    // Circuit lines
    const lines = [
      { x1: nodes[0].x, y1: nodes[0].y, x2: nodes[2].x, y2: nodes[2].y, w: 3 * s },
      { x1: nodes[1].x, y1: nodes[1].y, x2: nodes[2].x, y2: nodes[2].y, w: 3 * s },
      { x1: nodes[2].x, y1: nodes[2].y, x2: nodes[3].x, y2: nodes[3].y, w: 3 * s },
    ];

    // Check circuit lines first (under nodes)
    for (const line of lines) {
      if (distToSegment(x, y, line.x1, line.y1, line.x2, line.y2) < line.w) {
        // White line, blended
        return [
          Math.round(hr * 0.5 + 255 * 0.5),
          Math.round(hg * 0.5 + 255 * 0.5),
          Math.round(hb * 0.5 + 255 * 0.5),
        ];
      }
    }

    // Check circuit nodes
    for (const node of nodes) {
      if (isInCircle(x, y, node.x, node.y, node.r)) {
        return [240, 240, 250]; // white-ish
      }
    }

    return [hr, hg, hb];
  }

  return [bgR, bgG, bgB];
}

// --- Generate all required sizes ---

const sizes = [
  { name: '32x32.png', w: 32, h: 32 },
  { name: '128x128.png', w: 128, h: 128 },
  { name: '128x128@2x.png', w: 256, h: 256 },
  { name: 'icon.png', w: 256, h: 256 },          // tray icon
  { name: 'Square30x30Logo.png', w: 30, h: 30 },  // Windows UWP
  { name: 'Square44x44Logo.png', w: 44, h: 44 },  // Windows UWP
  { name: 'Square71x71Logo.png', w: 71, h: 71 },  // Windows UWP
  { name: 'Square89x89Logo.png', w: 89, h: 89 },  // Windows UWP
  { name: 'Square107x107Logo.png', w: 107, h: 107 },
  { name: 'Square142x142Logo.png', w: 142, h: 142 },
  { name: 'Square150x150Logo.png', w: 150, h: 150 },
  { name: 'Square284x284Logo.png', w: 284, h: 284 },
  { name: 'Square310x310Logo.png', w: 310, h: 310 },
  { name: 'StoreLogo.png', w: 50, h: 50 },
];

const outDir = __dirname;
if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

console.log('Generating AIMEAT development placeholder icons...\n');

for (const { name, w, h } of sizes) {
  const pngData = createPng(w, h, aimeatPixel);
  const outPath = join(outDir, name);
  writeFileSync(outPath, pngData);
  console.log(`  ${name.padEnd(24)} ${w}x${h} (${pngData.length} bytes)`);
}

console.log('\nDone! Development icons generated.');
console.log('For production icons, run: cargo tauri icon icons/icon.svg');
