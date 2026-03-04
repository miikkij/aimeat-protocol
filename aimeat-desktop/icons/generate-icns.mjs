/**
 * generate-icns.mjs
 *
 * Generates icon.icns from existing PNG files.
 * Modern ICNS files embed PNG data directly with specific type codes.
 * Uses only Node.js built-in modules.
 *
 * Usage:
 *   node icons/generate-icns.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ICNS type codes for PNG-embedded icons
// See: https://en.wikipedia.org/wiki/Apple_Icon_Image_format
const entries = [
  { type: 'icp4', file: '32x32.png' },       // 16x16@2x / 32x32
  { type: 'icp5', file: '32x32.png' },        // 32x32
  { type: 'icp6', file: '128x128.png' },      // 64x64 (using 128)
  { type: 'ic07', file: '128x128.png' },       // 128x128
  { type: 'ic08', file: '128x128@2x.png' },   // 256x256
  { type: 'ic09', file: '128x128@2x.png' },   // 512x512 (using 256 as placeholder)
];

const chunks = [];
let totalSize = 8; // magic (4) + file length (4)

for (const { type, file } of entries) {
  const pngData = readFileSync(join(__dirname, file));
  const typeCode = Buffer.from(type, 'ascii');  // 4 bytes
  const length = Buffer.alloc(4);
  length.writeUInt32BE(8 + pngData.length, 0);  // type(4) + length(4) + data
  chunks.push(Buffer.concat([typeCode, length, pngData]));
  totalSize += 8 + pngData.length;
}

// ICNS header
const header = Buffer.alloc(8);
header.write('icns', 0, 4, 'ascii');
header.writeUInt32BE(totalSize, 4);

const icns = Buffer.concat([header, ...chunks]);
const outPath = join(__dirname, 'icon.icns');
writeFileSync(outPath, icns);
console.log(`icon.icns generated (${icns.length} bytes) with ${entries.length} icon types`);
