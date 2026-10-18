/**
 * @file src/services/provenance-embed/raster.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An XMP packet written into a PNG or a JPEG, the place each format keeps it, with every
 *   picture byte left as it was:
 *   - PNG: an `iTXt` chunk with the keyword `XML:com.adobe.xmp` right after `IHDR`, and a `tEXt`
 *     `Description` for viewers that read no XMP. An earlier XMP chunk is replaced, not doubled.
 *   - JPEG: an `APP1` segment with the `http://ns.adobe.com/xap/1.0/` header after `SOI` and any
 *     `APP0`, replacing an earlier XMP `APP1`.
 * @structure markPng · markJpeg
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (Comicland v3 A-8).
 */
import { crc32 } from 'node:zlib';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const XMP_KEYWORD = 'XML:com.adobe.xmp';
const JPEG_XMP_HEADER = Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1');

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData) >>> 0);
  return Buffer.concat([len, typeAndData, crc]);
}

/** The picture with its XMP packet; throws when the bytes are not a PNG the reader can walk. */
export function markPng(png: Buffer, xmp: string, description: string): Buffer {
  if (png.length < 33 || !png.subarray(0, 8).equals(PNG_SIG)) throw new Error('not a PNG');
  const kept: Buffer[] = [];
  let at = 8;
  let ihdrEnd = -1;
  while (at + 12 <= png.length) {
    const len = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    const end = at + 12 + len;
    if (end > png.length) throw new Error('a PNG chunk runs past the end of the file');
    const chunk = png.subarray(at, end);
    const isOurs = (type === 'iTXt' && png.toString('latin1', at + 8, at + 8 + XMP_KEYWORD.length + 1) === `${XMP_KEYWORD}\0`)
      || (type === 'tEXt' && png.toString('latin1', at + 8, at + 8 + 12) === 'Description\0');
    if (!isOurs) kept.push(chunk);
    if (type === 'IHDR') ihdrEnd = kept.length;
    at = end;
    if (type === 'IEND') break;
  }
  if (ihdrEnd !== 1) throw new Error('a PNG starts with IHDR');
  // iTXt: keyword, NUL, compression flag 0, method 0, empty language tag, NUL, empty translated keyword, NUL, text.
  const itxt = pngChunk('iTXt', Buffer.concat([Buffer.from(`${XMP_KEYWORD}\0\0\0\0\0`, 'latin1'), Buffer.from(xmp, 'utf8')]));
  const text = pngChunk('tEXt', Buffer.from(`Description\0${description.replace(/[^\x20-\x7e]/g, '?')}`, 'latin1'));
  return Buffer.concat([PNG_SIG, kept[0], itxt, text, ...kept.slice(1)]);
}

/** The picture with its XMP packet; throws when the bytes are not a JPEG the reader can walk. */
export function markJpeg(jpeg: Buffer, xmp: string): Buffer {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('not a JPEG');
  const payload = Buffer.concat([JPEG_XMP_HEADER, Buffer.from(xmp, 'utf8')]);
  if (payload.length + 2 > 0xffff) throw new Error('the XMP packet is too large for one JPEG segment');
  const len = Buffer.alloc(2);
  len.writeUInt16BE(payload.length + 2);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), len, payload]);
  // Walk the leading APPn segments: keep APP0 (JFIF) first, drop an earlier XMP APP1, insert ours.
  const head: Buffer[] = [jpeg.subarray(0, 2)];
  let at = 2;
  let inserted = false;
  while (at + 4 <= jpeg.length && jpeg[at] === 0xff && jpeg[at + 1] >= 0xe0 && jpeg[at + 1] <= 0xef) {
    const segLen = jpeg.readUInt16BE(at + 2);
    const seg = jpeg.subarray(at, at + 2 + segLen);
    const isXmp = jpeg[at + 1] === 0xe1 && jpeg.subarray(at + 4, at + 4 + JPEG_XMP_HEADER.length).equals(JPEG_XMP_HEADER);
    if (jpeg[at + 1] !== 0xe0 && !inserted) { head.push(app1); inserted = true; }
    if (!isXmp) head.push(seg);
    at += 2 + segLen;
  }
  if (!inserted) head.push(app1);
  return Buffer.concat([...head, jpeg.subarray(at)]);
}
