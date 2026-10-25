/**
 * @file test/unit/pdf-decode-budget.test.ts
 * @description A PDF whose text and metadata streams decode past the budget is not handed to pdf.js:
 *   the content pipeline records why in its facts and the chat attachment reader says the file was
 *   not read. An ordinary PDF (pdfkit, compressed content) is read as before, and a large picture
 *   stream does not count, since pdf.js does not decode pictures to read text.
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, pdf.js decoded size on arrival).
 */
import { describe, it, expect } from 'vitest';
import { createDeflate, deflateSync } from 'node:zlib';
import PDFDocument from 'pdfkit';
import type { AimeatConfig } from '../../src/config.js';
import { pdfDecodesWithin } from '../../src/services/file-text/pdf-budget.js';
import { readPdfFacts } from '../../src/services/content/extract-pdf.js';
import { extractFileText } from '../../src/services/file-text/index.js';

/** `size` bytes of spaces, deflated a megabyte at a time so the test never holds them. */
function deflatedSpaces(size: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const z = createDeflate({ level: 9 });
    const parts: Buffer[] = [];
    z.on('data', (c: Buffer) => parts.push(c));
    z.on('end', () => resolve(Buffer.concat(parts)));
    z.on('error', reject);
    const mb = Buffer.alloc(1024 * 1024, 0x20);
    let left = size;
    const pump = () => {
      while (left > 0) {
        const n = Math.min(left, mb.length);
        left -= n;
        if (!z.write(n === mb.length ? mb : mb.subarray(0, n))) { z.once('drain', pump); return; }
      }
      z.end();
    };
    pump();
  });
}

/** A one-page PDF whose page content is `content` (already deflated), with a picture stream beside it. */
function onePage(content: Buffer, extra = ''): Buffer {
  const parts: Buffer[] = [];
  const offsets: number[] = [];
  let len = 0;
  const add = (b: Buffer | string) => { const buf = typeof b === 'string' ? Buffer.from(b, 'latin1') : b; parts.push(buf); len += buf.length; };
  add('%PDF-1.4\n');
  const obj = (n: number, body: Buffer | string) => { offsets[n] = len; add(`${n} 0 obj\n`); add(body); add('\nendobj\n'); };
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>');
  obj(4, Buffer.concat([Buffer.from(`<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), content, Buffer.from('\nendstream', 'latin1')]));
  if (extra) obj(5, extra);
  const xref = len;
  const count = extra ? 6 : 5;
  add(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let i = 1; i < count; i++) add(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  add(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}

function pdfkitPdf(): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ info: { Title: 'Ordinary' } });
    const parts: Buffer[] = [];
    doc.on('data', (b: Buffer) => parts.push(b));
    doc.on('end', () => resolve(Buffer.concat(parts)));
    doc.text('An ordinary page of text that the reader finds.');
    doc.end();
  });
}

const config = { docsignEnabled: false } as unknown as AimeatConfig;

describe('pdfDecodesWithin', () => {
  it('a stream that decodes past the budget is over it', async () => {
    const pdf = onePage(await deflatedSpaces(8 * 1024 * 1024));
    expect(pdf.length).toBeLessThan(64 * 1024);
    expect(await pdfDecodesWithin(pdf, 1024 * 1024)).toBe(false);
    expect(await pdfDecodesWithin(pdf, 16 * 1024 * 1024)).toBe(true);
  });

  it('a picture stream does not count', async () => {
    const image = deflateSync(Buffer.alloc(4 * 1024 * 1024, 0x80));
    const pdf = onePage(deflateSync(Buffer.from('BT /F1 12 Tf (x) Tj ET')),
      `<< /Type /XObject /Subtype /Image /Width 2048 /Height 2048 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${image.length} /Filter /FlateDecode >>\nstream\n${image.toString('latin1')}\nendstream`);
    expect(await pdfDecodesWithin(pdf, 1024 * 1024)).toBe(true);
  });

  it('an ordinary PDF is within the default budget', async () => {
    expect(await pdfDecodesWithin(await pdfkitPdf())).toBe(true);
  });
});

describe('the readers on a PDF past the default budget', () => {
  it('readPdfFacts records why and reads no text; extractFileText says it was not read', async () => {
    const bomb = onePage(await deflatedSpaces(300 * 1024 * 1024));
    const { facts, text, errors } = await readPdfFacts(config, bomb, { online: false });
    expect(errors.pdfMeta).toMatch(/256 MB/);
    expect(text).toBeNull();
    expect(facts.hasTextLayer).toBe(false);
    const got = await extractFileText(bomb, 'application/pdf', 'bomb.pdf');
    expect(got?.text).toBe('');
    expect(got?.note).toMatch(/not read/);
  }, 60_000);

  it('an ordinary PDF keeps its title and text', async () => {
    const { facts, text } = await readPdfFacts(config, await pdfkitPdf(), { online: false });
    expect(facts.title).toBe('Ordinary');
    expect(text).toContain('ordinary page');
  });
});
