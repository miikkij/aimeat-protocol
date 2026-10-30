/**
 * @file test/unit/pdf-unmeasured-limits.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A PDF whose decode cost the budget cannot measure is read under a time and a memory
 *   limit (secaudit2026oct26 round 8c, pdf-budget.ts:pdfDecodesWithin:filter-detection-bypass). The
 *   budget counts the filters it knows; a filter name it does not know (here `/Fl#61teDecode`, which
 *   pdf.js reads as FlateDecode), an encrypted document, or a stream it cannot decode to the end is
 *   unmeasured. Such a PDF is read in a worker that ends at either limit: the file stays stored, its
 *   text is not read, and the reader and the content facts say so. A PDF the budget measures is read
 *   as before, and an unmeasured PDF within the limits gives the same text as before.
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (secaudit2026oct26 round 8c, memory-b-09).
 */
import { describe, it, expect } from 'vitest';
import { createDeflate, deflateSync } from 'node:zlib';
import PDFDocument from 'pdfkit';
import type { AimeatConfig } from '../../src/config.js';
import { pdfDecodeMeasure, pdfDecodesWithin } from '../../src/services/file-text/pdf-budget.js';
import { extractFileText } from '../../src/services/file-text/index.js';
import { readPdfFacts } from '../../src/services/content/extract-pdf.js';

const MB = 1024 * 1024;
const TEXT = 'BT /F1 12 Tf 10 100 Td (Hello escaped filter) Tj ET';

/** `size` bytes of spaces after `lead`, deflated a megabyte at a time so the test never holds them. */
function deflated(lead: string, size: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const z = createDeflate({ level: 9 });
    const parts: Buffer[] = [];
    z.on('data', (c: Buffer) => parts.push(c));
    z.on('end', () => resolve(Buffer.concat(parts)));
    z.on('error', reject);
    z.write(Buffer.from(lead, 'latin1'));
    const mb = Buffer.alloc(MB, 0x20);
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

/** A one-page PDF with a Helvetica font, a title, and one content stream of `dict` and `data`. */
function pdfWith(dict: string, data: Buffer, trailer = ''): Buffer {
  const head = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'
    + '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>\nendobj\n'
    + '5 0 obj\n<< /Title (Escaped) >>\nendobj\n'
    + `4 0 obj\n${dict}\nstream\n`;
  return Buffer.concat([Buffer.from(head, 'latin1'), data, Buffer.from(`\nendstream\nendobj\ntrailer\n<< /Root 1 0 R /Info 5 0 R${trailer} >>\n%%EOF\n`, 'latin1')]);
}

/** The content stream under a filter name the budget does not know and pdf.js reads as FlateDecode. */
const escaped = (data: Buffer) => pdfWith(`<< /Length ${data.length} /Filter /Fl#61teDecode >>`, data);

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

const configWith = (pdfTextSeconds: number, pdfTextMemoryMb: number) =>
  ({ docsignEnabled: false, pdfTextSeconds, pdfTextMemoryMb }) as unknown as AimeatConfig;

describe('pdfDecodeMeasure', () => {
  it('a filter name the budget does not know is unmeasured; pdfDecodesWithin keeps its answer', async () => {
    const pdf = escaped(deflateSync(Buffer.from(TEXT, 'latin1')));
    expect((await pdfDecodeMeasure(pdf)).verdict).toBe('unmeasured');
    expect(await pdfDecodesWithin(pdf)).toBe(true);
  });

  it('an encrypted document is unmeasured', async () => {
    const pdf = pdfWith(`<< /Length 4 /Filter /FlateDecode >>`, Buffer.from('xxxx'), ' /Encrypt 9 0 R');
    expect((await pdfDecodeMeasure(pdf)).verdict).toBe('unmeasured');
  });

  it('an ordinary PDF is within the budget, and one past it is over', async () => {
    expect((await pdfDecodeMeasure(await pdfkitPdf())).verdict).toBe('within');
    const over = pdfWith('<< /Length 0 /Filter /FlateDecode >>', await deflated('', 8 * MB));
    expect((await pdfDecodeMeasure(over, MB)).verdict).toBe('over');
  });
});

describe('an unmeasured PDF is read under the limits', () => {
  it('past the memory limit its text is not read, and the reader says so', async () => {
    const pdf = escaped(await deflated(TEXT, 96 * MB));
    expect(pdf.length).toBeLessThan(MB);
    const got = await extractFileText(pdf, 'application/pdf', 'big.pdf', { pdfLimits: { timeMs: 0, memoryMb: 32 } });
    expect(got?.text).toBe('');
    expect(got?.limit).toBe('memory');
    expect(got?.note).toMatch(/not read/);
    expect(got?.note).toMatch(/memory/);
  }, 120_000);

  it('past the time limit its text is not read, and the reader says so', async () => {
    const pdf = escaped(deflateSync(Buffer.from(TEXT, 'latin1')));
    const got = await extractFileText(pdf, 'application/pdf', 'slow.pdf', { pdfLimits: { timeMs: 1, memoryMb: 0 } });
    expect(got?.text).toBe('');
    expect(got?.limit).toBe('time');
    expect(got?.note).toMatch(/not read/);
  }, 60_000);

  it('the content facts record that the text was not read', async () => {
    const pdf = escaped(await deflated(TEXT, 96 * MB));
    const { facts, text, errors } = await readPdfFacts(configWith(0, 32), pdf, { online: false });
    expect(text).toBeNull();
    expect(facts.textNotRead?.reason).toBe('memory');
    expect(errors.pdfText).toMatch(/not read/);
  }, 120_000);
});

describe('usage: the readers give the same answers as before', () => {
  it('an unmeasured PDF within the default limits gives its text and title', async () => {
    const pdf = escaped(deflateSync(Buffer.from(TEXT, 'latin1')));
    const got = await extractFileText(pdf, 'application/pdf', 'small.pdf');
    expect(got?.text).toBe('Hello escaped filter');
    const { facts, text } = await readPdfFacts(configWith(120, 1024), pdf, { online: false });
    expect(text).toBe('Hello escaped filter');
    expect(facts.title).toBe('Escaped');
    expect(facts.pages).toBe(1);
    expect(facts.textNotRead).toBeUndefined();
  }, 60_000);

  it('a measured PDF is read as before', async () => {
    const { facts, text } = await readPdfFacts(configWith(120, 1024), await pdfkitPdf(), { online: false });
    expect(facts.title).toBe('Ordinary');
    expect(text).toContain('ordinary page');
  });
});
