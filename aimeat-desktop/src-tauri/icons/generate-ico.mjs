/**
 * generate-ico.mjs
 *
 * Generates icon.ico from existing PNG files.
 * ICO format is a simple container that embeds PNG data directly.
 * Uses only Node.js built-in modules.
 *
 * Usage:
 *   node icons/generate-ico.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ICO files can embed PNG data directly (since Vista+).
// Format: ICONDIR header + ICONDIRENTRY[] + PNG data

const pngFiles = [
  { file: '32x32.png', w: 32, h: 32 },
  { file: '128x128.png', w: 128, h: 128 },
  { file: '128x128@2x.png', w: 0, h: 0 }, // 256x256 — 0 means 256 in ICO spec
];

const pngBuffers = pngFiles.map(({ file }) =>
  readFileSync(join(__dirname, file))
);

// ICONDIR: 6 bytes
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);                // reserved
header.writeUInt16LE(1, 2);                // type: 1 = ICO
header.writeUInt16LE(pngFiles.length, 4);  // image count

// Calculate data offset: header (6) + entries (16 each)
let dataOffset = 6 + pngFiles.length * 16;

// ICONDIRENTRY: 16 bytes each
const entries = [];
for (let i = 0; i < pngFiles.length; i++) {
  const entry = Buffer.alloc(16);
  entry[0] = pngFiles[i].w;       // width (0 = 256)
  entry[1] = pngFiles[i].h;       // height (0 = 256)
  entry[2] = 0;                    // color palette
  entry[3] = 0;                    // reserved
  entry.writeUInt16LE(1, 4);       // color planes
  entry.writeUInt16LE(32, 6);      // bits per pixel
  entry.writeUInt32LE(pngBuffers[i].length, 8);   // size of PNG data
  entry.writeUInt32LE(dataOffset, 12);             // offset to PNG data
  entries.push(entry);
  dataOffset += pngBuffers[i].length;
}

const ico = Buffer.concat([header, ...entries, ...pngBuffers]);
const outPath = join(__dirname, 'icon.ico');
writeFileSync(outPath, ico);
console.log(`icon.ico generated (${ico.length} bytes) with ${pngFiles.length} sizes`);
