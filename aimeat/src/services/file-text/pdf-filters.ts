/**
 * @file src/services/file-text/pdf-filters.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The stream filters pdf.js decodes for a page's text, measured with a limit: how many
 *   bytes a stream decodes to through its whole filter chain, stopping as soon as the count passes
 *   the limit. The last filter of a chain only counts; an earlier one hands the next its output, held
 *   up to the limit. Flate and Brotli go through node:zlib a chunk at a time; LZW (EarlyChange as
 *   pdf.js reads it), RunLength, ASCIIHex and ASCII85 are decoded here. A filter for pictures (DCT,
 *   JPX, CCITT, JBIG2) is not decoded to read text and ends the chain at nothing; Crypt passes the
 *   bytes on as they are. A filter pdf.js does not know decodes nothing there either.
 *   Written for services/file-text/pdf-budget.ts (secaudit2026oct26,
 *   pdf-budget.ts:pdfDecodesWithin:filter-detection-bypass).
 * @structure PdfFilter · normaliseFilter(name) · decodedLength(data, filters, limit)
 * @usage const n = await decodedLength(data, ['ASCIIHexDecode', 'FlateDecode'], budgetLeft);
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import { createInflate, createBrotliDecompress, constants } from 'node:zlib';

export type PdfFilter = 'flate' | 'lzw' | 'runlength' | 'hex' | 'a85' | 'brotli' | 'crypt' | 'picture' | 'unknown';

/** A filter name as a PDF writes it, long or abbreviated, to the kind this module measures. */
export function normaliseFilter(name: string): PdfFilter {
  switch (name) {
    case 'FlateDecode': case 'Fl': return 'flate';
    case 'LZWDecode': case 'LZW': return 'lzw';
    case 'RunLengthDecode': case 'RL': return 'runlength';
    case 'ASCIIHexDecode': case 'AHx': return 'hex';
    case 'ASCII85Decode': case 'A85': return 'a85';
    case 'BrotliDecode': return 'brotli';
    case 'Crypt': return 'crypt';
    case 'DCTDecode': case 'DCT': case 'JPXDecode': case 'CCITTFaxDecode': case 'CCF': case 'JBIG2Decode': return 'picture';
    default: return 'unknown';
  }
}

/** Receives decoded bytes; answers false to stop the decoder. */
type Sink = (chunk: Buffer) => boolean;

/** A zlib stream (inflate or brotli) fed `data`, its output handed to `sink` until it says stop. */
function zlibInto(kind: 'flate' | 'brotli', data: Buffer, sink: Sink): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const z = kind === 'flate' ? createInflate({ finishFlush: constants.Z_SYNC_FLUSH }) : createBrotliDecompress();
    const finish = () => { if (!done) { done = true; resolve(); } };
    z.on('data', (c: Buffer) => { if (!done && !sink(c)) { z.destroy(); finish(); } });
    z.on('end', finish);
    // A stream zlib cannot read is pdf.js's to report; what decoded before the error is counted.
    z.on('error', finish);
    z.on('close', finish);
    z.end(data);
  });
}

/** LZW as pdf.js's LZWStream reads it: 9 to 12 bit codes, 256 clears, 257 ends. */
function lzwInto(data: Buffer, earlyChange: number, sink: Sink): void {
  const prevOf = new Int32Array(4096);
  const lenOf = new Int32Array(4096);
  const valOf = new Uint8Array(4096);
  for (let i = 0; i < 256; i++) { lenOf[i] = 1; valOf[i] = i; }
  let codeLength = 9, nextCode = 258, prevCode = -1;
  let seq = new Uint8Array(4096), seqLen = 0;
  let pos = 0, acc = 0, bits = 0;
  for (;;) {
    while (bits < codeLength) {
      if (pos >= data.length) return;
      acc = ((acc << 8) | data[pos++]!) >>> 0; bits += 8;
    }
    const code = (acc >>> (bits - codeLength)) & ((1 << codeLength) - 1);
    bits -= codeLength;
    acc &= (1 << bits) - 1;
    const hasPrev = seqLen > 0;
    if (code < 256) {
      seq[0] = code; seqLen = 1;
    } else if (code >= 258) {
      if (code < nextCode) {
        seqLen = lenOf[code]!;
        if (seq.length < seqLen) seq = new Uint8Array(seqLen);
        for (let j = seqLen - 1, q = code; j >= 0; j--) { seq[j] = valOf[q]!; q = prevOf[q]!; }
      } else {
        if (!hasPrev) return;
        seq[seqLen++] = seq[0]!;
      }
    } else if (code === 256) {
      codeLength = 9; nextCode = 258; seqLen = 0; continue;
    } else {
      return;
    }
    if (hasPrev && nextCode < 4096) {
      prevOf[nextCode] = prevCode;
      lenOf[nextCode] = lenOf[prevCode]! + 1;
      valOf[nextCode] = seq[0]!;
      nextCode++;
      const n = nextCode + earlyChange;
      if ((n & (n - 1)) === 0) codeLength = Math.min(Math.floor(Math.log2(n)) + 1, 12);
    }
    prevCode = code;
    if (!sink(Buffer.from(seq.subarray(0, seqLen)))) return;
  }
}

/** RunLength: a length byte n below 128 copies n + 1 bytes, above 128 repeats one byte 257 - n times, 128 ends. */
function runLengthInto(data: Buffer, sink: Sink): void {
  for (let i = 0; i < data.length;) {
    const n = data[i++]!;
    if (n === 128) return;
    if (n < 128) {
      if (!sink(data.subarray(i, i + n + 1))) return;
      i += n + 1;
    } else {
      if (i >= data.length) return;
      if (!sink(Buffer.alloc(257 - n, data[i++]!))) return;
    }
  }
}

/** ASCIIHex: two hex digits a byte, white space ignored, `>` ends. */
function hexInto(data: Buffer, sink: Sink): void {
  const out: number[] = [];
  let high = -1;
  for (const c of data) {
    if (c === 0x3e) break;
    const v = c >= 0x30 && c <= 0x39 ? c - 0x30 : c >= 0x41 && c <= 0x46 ? c - 0x37 : c >= 0x61 && c <= 0x66 ? c - 0x57 : -1;
    if (v < 0) continue;
    if (high < 0) high = v; else { out.push(high * 16 + v); high = -1; }
  }
  if (high >= 0) out.push(high * 16);
  sink(Buffer.from(out));
}

/** ASCII85: five characters four bytes, `z` four zeros, `~>` ends. */
function a85Into(data: Buffer, sink: Sink): void {
  const out: number[] = [];
  const group: number[] = [];
  const flush = (count: number) => {
    let v = 0;
    for (let i = 0; i < 5; i++) v = v * 85 + (group[i] ?? 84);
    for (let i = 0; i < count - 1; i++) out.push((v >>> (24 - 8 * i)) & 0xff);
  };
  for (const c of data) {
    if (c === 0x7e) break;
    if (c === 0x7a && group.length === 0) { out.push(0, 0, 0, 0); continue; }
    if (c < 0x21 || c > 0x75) continue;
    group.push(c - 0x21);
    if (group.length === 5) { flush(5); group.length = 0; }
  }
  if (group.length > 1) flush(group.length);
  sink(Buffer.from(out));
}

/** The output of one filter, held up to `limit` bytes (the caller sees `over` past it). */
async function decodeOne(kind: PdfFilter, data: Buffer, limit: number, earlyChange: number, keep: boolean): Promise<{ length: number; data: Buffer | null }> {
  if (kind === 'crypt') return { length: data.length, data };
  if (kind === 'picture' || kind === 'unknown') return { length: 0, data: null };
  let length = 0;
  const parts: Buffer[] = [];
  const sink: Sink = (chunk) => {
    length += chunk.length;
    if (keep && length <= limit) parts.push(chunk);
    return length <= limit;
  };
  if (kind === 'flate' || kind === 'brotli') await zlibInto(kind, data, sink);
  else if (kind === 'lzw') lzwInto(data, earlyChange, sink);
  else if (kind === 'runlength') runLengthInto(data, sink);
  else if (kind === 'hex') hexInto(data, sink);
  else a85Into(data, sink);
  return { length, data: keep && length <= limit ? Buffer.concat(parts) : null };
}

/**
 * How many bytes `data` decodes to through `filters` in order, or the first count past `limit`.
 * `earlyChange` is the LZW parameter of the stream (1 unless its DecodeParms say 0).
 */
export async function decodedLength(data: Buffer, filters: readonly PdfFilter[], limit: number, earlyChange = 1): Promise<number> {
  let current = data;
  for (let i = 0; i < filters.length; i++) {
    const last = i === filters.length - 1;
    const step = await decodeOne(filters[i]!, current, limit, earlyChange, !last);
    if (last || step.length > limit || !step.data) return step.length;
    current = step.data;
  }
  return current.length;
}
