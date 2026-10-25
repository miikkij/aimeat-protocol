/**
 * @file src/services/file-text/pdf-budget.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How much a PDF's Flate streams decode to, measured before pdf.js reads the file.
 *   pdf.js inflates a stream fully in the node process with no size limit, so a small PDF whose
 *   content stream is a deflated run of one byte can grow to gigabytes. This scan inflates each
 *   FlateDecode stream that pdf.js would decode for text and metadata (not pictures, not attached
 *   files) and counts the bytes without keeping them, stopping as soon as the total passes the
 *   budget, so the measurement itself holds one zlib chunk at a time. A stream that does not
 *   inflate on its own (encrypted, another filter first, damaged) is left to pdf.js.
 * @structure PDF_DECODE_BUDGET · pdfDecodesWithin(bytes, budget)
 * @usage if (!(await pdfDecodesWithin(bytes))) return { note: 'too large to read' };
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, pdf.js decoded size on arrival).
 */
import { createInflate, constants } from 'node:zlib';

/** What the text and metadata streams of one PDF may decode to in all. */
export const PDF_DECODE_BUDGET = 256 * 1024 * 1024;

/** How far back from `stream` the stream's dictionary is looked for. */
const DICT_LOOKBACK = 4096;

/** The decoded length of one deflated stream, or the first count past `limit` (then it stops). */
function inflatedLength(data: Buffer, limit: number): Promise<number> {
  return new Promise((resolve) => {
    let n = 0;
    let done = false;
    const z = createInflate({ finishFlush: constants.Z_SYNC_FLUSH });
    const finish = (v: number) => { if (!done) { done = true; resolve(v); } };
    z.on('data', (c: Buffer) => {
      n += c.length;
      if (n > limit) { z.destroy(); finish(n); }
    });
    z.on('end', () => finish(n));
    // A stream zlib cannot read is pdf.js's to report; what decoded before the error is counted.
    z.on('error', () => finish(n));
    z.end(data);
  });
}

/** Whether the text and metadata streams of `bytes` decode to `budget` bytes or fewer in all. */
export async function pdfDecodesWithin(bytes: Buffer, budget = PDF_DECODE_BUDGET): Promise<boolean> {
  let total = 0;
  let at = 0;
  for (;;) {
    const kw = bytes.indexOf('stream', at, 'latin1');
    if (kw < 0) return true;
    at = kw + 6;
    // `endstream` also contains the word; only a `stream` keyword right after a dictionary starts one.
    if (kw >= 3 && bytes.toString('latin1', kw - 3, kw) === 'end') continue;
    let start = at;
    if (bytes[start] === 0x0d) start++;
    if (bytes[start] !== 0x0a) continue;
    start++;
    const dict = bytes.toString('latin1', Math.max(0, kw - DICT_LOOKBACK), kw);
    const open = dict.lastIndexOf('<<');
    const head = open >= 0 ? dict.slice(open) : dict;
    const end = bytes.indexOf('endstream', start, 'latin1');
    if (end < 0) return true;
    at = end + 9;
    if (!/\/FlateDecode\b|\/Fl\b/.test(head)) continue;
    // Pictures and attached files are not decoded to read text or metadata.
    if (/\/Subtype\s*\/Image\b|\/Type\s*\/EmbeddedFile\b/.test(head)) continue;
    total += await inflatedLength(bytes.subarray(start, end), budget - total);
    if (total > budget) return false;
  }
}
