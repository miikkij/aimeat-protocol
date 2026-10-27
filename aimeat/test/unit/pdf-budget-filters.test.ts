/**
 * @file test/unit/pdf-budget-filters.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The PDF decode budget counts every stream pdf.js decodes for text, by the stream's own
 *   dictionary (secaudit2026oct26, pdf-budget.ts:pdfDecodesWithin:filter-detection-bypass). It found a
 *   stream's filter by a text match after the last `<<` before `stream` and counted Flate only, so a
 *   nested dictionary after /Filter, a filter named by an indirect object, a chain that does not start
 *   with Flate, LZW, RunLength, Brotli and a `stream` keyword followed by CR alone all counted as
 *   nothing while pdf.js decoded them in full. Each fixture holds one content stream that decodes to
 *   8 MB of spaces and is checked against a 1 MB budget; the same shapes small stay within it, and an
 *   ordinary PDF is read as before.
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect } from 'vitest';
import { deflateSync, brotliCompressSync } from 'node:zlib';
import PDFDocument from 'pdfkit';
import { pdfDecodesWithin } from '../../src/services/file-text/pdf-budget.js';

const MB = 1024 * 1024;
const BIG = 8 * MB;
const SMALL = 64 * 1024;
const spaces = (n: number) => Buffer.alloc(n, 0x20);

/** LZW as PDF writes it (EarlyChange 1), for the fixtures. */
function lzwEncode(input: Buffer): Buffer {
  const out: number[] = [];
  let acc = 0, bits = 0;
  let codeLen = 9;
  const put = (code: number) => {
    acc = (acc << codeLen) | code; bits += codeLen;
    while (bits >= 8) { out.push((acc >>> (bits - 8)) & 0xff); bits -= 8; acc &= (1 << bits) - 1; }
  };
  // The dictionary keys a code and the next byte as one number.
  let dict = new Map<number, number>();
  let next = 258;
  const reset = () => { dict = new Map(); next = 258; codeLen = 9; };
  put(256);
  let w = input[0]!;
  for (let i = 1; i < input.length; i++) {
    const c = input[i]!;
    const known = dict.get(w * 256 + c);
    if (known !== undefined) { w = known; continue; }
    put(w);
    dict.set(w * 256 + c, next++);
    // The reader adds each entry one code later; with EarlyChange 1 it widens when its next code plus
    // one is a power of two, which is when this side's next code is.
    if (next >= (1 << codeLen)) {
      if (codeLen < 12) codeLen++;
      else { put(256); reset(); }
    }
    w = c;
  }
  put(w);
  put(257);
  if (bits > 0) out.push((acc << (8 - bits)) & 0xff);
  return Buffer.from(out);
}

/** 128 copies of one byte per two bytes of RunLength. */
function runLength(input: Buffer): Buffer {
  const out: number[] = [];
  for (let i = 0; i < input.length; i += 128) out.push(129, input[i]!);
  out.push(128);
  return Buffer.from(out);
}

/** A one-page PDF whose content stream has `dict` and `data`, plus `extra` objects. */
function pdfWith(dict: string, data: Buffer, opts: { eol?: string; extra?: string } = {}): Buffer {
  const head = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`
    + `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>\nendobj\n${opts.extra ?? ''}`
    + `4 0 obj\n${dict}\nstream${opts.eol ?? '\n'}`;
  return Buffer.concat([Buffer.from(head, 'latin1'), data, Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1')]);
}

const shapes: Array<[string, (n: number) => Buffer]> = [
  ['a nested dictionary after /Filter', (n) => { const d = deflateSync(spaces(n)); return pdfWith(`<< /Length ${d.length} /Filter /FlateDecode /DecodeParms << /Predictor 1 >> >>`, d); }],
  ['a filter named by an indirect object', (n) => { const d = deflateSync(spaces(n)); return pdfWith(`<< /Length ${d.length} /Filter 9 0 R >>`, d, { extra: '9 0 obj\n/FlateDecode\nendobj\n' }); }],
  ['a filter array named by an indirect object', (n) => { const d = deflateSync(spaces(n)); return pdfWith(`<< /Length ${d.length} /Filter 9 0 R >>`, d, { extra: '9 0 obj\n[/FlateDecode]\nendobj\n' }); }],
  ['a chain that starts with ASCIIHex', (n) => { const d = Buffer.from(deflateSync(spaces(n)).toString('hex') + '>', 'latin1'); return pdfWith(`<< /Length ${d.length} /Filter [/ASCIIHexDecode /FlateDecode] >>`, d); }],
  ['LZW', (n) => { const d = lzwEncode(spaces(n)); return pdfWith(`<< /Length ${d.length} /Filter /LZWDecode >>`, d); }],
  ['RunLength', (n) => { const d = runLength(spaces(n)); return pdfWith(`<< /Length ${d.length} /Filter /RunLengthDecode >>`, d); }],
  ['Brotli', (n) => { const d = brotliCompressSync(spaces(n)); return pdfWith(`<< /Length ${d.length} /Filter /BrotliDecode >>`, d); }],
  ['a stream keyword followed by CR alone', (n) => { const d = deflateSync(spaces(n)); return pdfWith(`<< /Length ${d.length} /Filter /FlateDecode >>`, d, { eol: '\r' }); }],
];

describe('every stream pdf.js decodes is counted', () => {
  it.each(shapes)('%s: 8 MB is over a 1 MB budget', async (_name, make) => {
    const pdf = make(BIG);
    expect(pdf.length).toBeLessThan(BIG / 8);
    expect(await pdfDecodesWithin(pdf, MB)).toBe(false);
  }, 60_000);

  it.each(shapes)('%s: 64 kB is within it', async (_name, make) => {
    expect(await pdfDecodesWithin(make(SMALL), MB)).toBe(true);
  }, 60_000);
});

describe('an ordinary PDF', () => {
  it('a pdfkit document is within the default budget', async () => {
    const pdf = await new Promise<Buffer>((resolve) => {
      const doc = new PDFDocument({ info: { Title: 'Ordinary' } });
      const parts: Buffer[] = [];
      doc.on('data', (b: Buffer) => parts.push(b));
      doc.on('end', () => resolve(Buffer.concat(parts)));
      doc.text('An ordinary page of text that the reader finds.');
      doc.end();
    });
    expect(await pdfDecodesWithin(pdf)).toBe(true);
  });

  it('a large picture stream does not count', async () => {
    const d = deflateSync(spaces(BIG));
    expect(await pdfDecodesWithin(pdfWith(`<< /Type /XObject /Subtype /Image /Width 10 /Height 10 /Length ${d.length} /Filter /FlateDecode >>`, d), MB)).toBe(true);
  });
});
