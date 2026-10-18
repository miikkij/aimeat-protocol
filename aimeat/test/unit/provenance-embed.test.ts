/**
 * @file test/unit/provenance-embed.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The provenance written into exported files (services/provenance-embed/), read back by
 *   real readers rather than by the writer's own parser: a PNG whose chunks still check out and whose
 *   picture bytes are unchanged, a JPEG with its XMP segment, a PDF that pdf.js (unpdf) opens and whose
 *   metadata it reads, with the original bytes untouched in front, and a CBZ whose pages are marked
 *   and whose other entries are copied as they were.
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (Comicland v3 A-8).
 */
import { describe, it, expect } from 'vitest';
import { deflateSync, crc32 } from 'node:zlib';
import yauzl from 'yauzl';
import { ZipArchive } from 'archiver';
import PDFDocument from 'pdfkit';
import { getDocumentProxy, getMeta } from 'unpdf';
import { buildXmp } from '../../src/services/provenance-embed/xmp.js';
import { markPng, markJpeg } from '../../src/services/provenance-embed/raster.js';
import { markPdf } from '../../src/services/provenance-embed/pdf.js';
import { markArchive } from '../../src/services/provenance-embed/archive.js';

const COMPOSITE = 'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia';
const xmp = buildXmp({
  digitalSourceType: COMPOSITE, description: 'Combines content made with AI with work by people.',
  records: [{ id: 'prov_1', url: 'https://node.test/v1/provenance/prov_1', level: 'ai-generated', model: 'google/gemini-2.5-flash-image', mediaKind: 'image' }],
  markedAt: '2026-10-18T12:00:00Z', tool: 'AIMEAT node.test',
});

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
/** A real 2x2 RGBA PNG. */
function png(): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.from([0, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
/** Every chunk of a PNG, with whether its CRC checks out. */
function chunks(b: Buffer): Array<{ type: string; data: Buffer; ok: boolean }> {
  const out = []; let at = 8;
  while (at < b.length) {
    const len = b.readUInt32BE(at); const type = b.toString('latin1', at + 4, at + 8);
    const data = b.subarray(at + 8, at + 8 + len);
    out.push({ type, data, ok: (crc32(b.subarray(at + 4, at + 8 + len)) >>> 0) === b.readUInt32BE(at + 8 + len) });
    at += 12 + len;
  }
  return out;
}
function pdfkitPdf(info: Record<string, string> = {}): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ info, compress: false });
    const parts: Buffer[] = [];
    doc.on('data', (c: Buffer) => parts.push(c));
    doc.on('end', () => resolve(Buffer.concat(parts)));
    doc.text('Harbour Lights, episode 3, page 1');
    doc.end();
  });
}

describe('markPng', () => {
  it('adds the XMP iTXt right after IHDR, every CRC checks out, and the picture data is unchanged', () => {
    const before = png();
    const after = markPng(before, xmp, 'Made with AI.');
    const c = chunks(after);
    expect(c.map(x => x.type)).toEqual(['IHDR', 'iTXt', 'tEXt', 'IDAT', 'IEND']);
    expect(c.every(x => x.ok)).toBe(true);
    expect(c[1].data.toString('utf8')).toContain('compositeWithTrainedAlgorithmicMedia');
    expect(c[1].data.toString('latin1').startsWith('XML:com.adobe.xmp\0')).toBe(true);
    expect(c[3].data.equals(chunks(before)[1].data)).toBe(true);
  });
  it('marking twice replaces the packet instead of adding a second one', () => {
    const twice = markPng(markPng(png(), xmp, 'a'), xmp, 'b');
    expect(chunks(twice).filter(x => x.type === 'iTXt').length).toBe(1);
    expect(chunks(twice).filter(x => x.type === 'tEXt').length).toBe(1);
  });
  it('refuses bytes that are not a PNG', () => {
    expect(() => markPng(Buffer.from('not a png at all, really'), xmp, 'x')).toThrow();
  });
});

describe('markJpeg', () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'), Buffer.from([0xff, 0xdb, 0x00, 0x03, 0x00, 0xff, 0xd9])]);
  it('puts the XMP APP1 after APP0 and keeps the rest byte for byte', () => {
    const after = markJpeg(jpeg, xmp);
    expect(after.subarray(0, 20).equals(jpeg.subarray(0, 20))).toBe(true);
    expect(after[20]).toBe(0xff); expect(after[21]).toBe(0xe1);
    expect(after.toString('latin1', 24, 24 + 29)).toBe('http://ns.adobe.com/xap/1.0/\0');
    expect(after.subarray(after.length - 7).equals(jpeg.subarray(jpeg.length - 7))).toBe(true);
    const twice = markJpeg(after, xmp);
    expect(twice.length).toBe(after.length);
  });
});

/**
 * Every object the LAST cross-reference section names starts exactly where it says. pdf.js rebuilds a
 * broken table by scanning, so a file it opens can still have a wrong one; this reads the table itself.
 */
function xrefPointsRight(pdf: Buffer): number {
  const text = pdf.toString('latin1');
  const at = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(text.slice(-200))![1]);
  let rows: Array<{ num: number; off: number }> = [];
  if (text.startsWith('xref', at)) {
    const section = text.slice(at, text.indexOf('trailer', at));
    const lines = section.split(/\r?\n/).slice(1).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      const [a, b] = lines[i].trim().split(/\s+/).map(Number);
      for (let k = 0; k < b; k++) { const off = Number(lines[i + 1 + k].slice(0, 10)); rows.push({ num: a + k, off }); }
      i += b;
    }
  } else {
    const head = text.slice(at, text.indexOf('stream', at));
    const index = /\/Index\s*\[([^\]]*)\]/.exec(head)![1].trim().split(/\s+/).map(Number);
    const data = pdf.subarray(text.indexOf('stream', at) + 7);
    let r = 0;
    for (let i = 0; i < index.length; i += 2) for (let k = 0; k < index[i + 1]; k++, r++) rows.push({ num: index[i] + k, off: data.readUInt32BE(r * 7 + 1) });
  }
  rows = rows.filter(r => r.off > 0);
  for (const r of rows) expect(text.slice(r.off, r.off + 20)).toMatch(new RegExp(`^${r.num} \\d+ obj`));
  return rows.length;
}

describe('markPdf', () => {
  it('appends an update pdf.js opens: the subject, the keywords and the XMP are read back, and the original bytes are untouched', async () => {
    const before = await pdfkitPdf({ Title: 'Harbour Lights 3', Author: 'Studio' });
    const after = markPdf(before, { xmp, subject: 'Combines content made with AI with work by people.', keywords: 'AI-generated, AI provenance', digitalSourceType: COMPOSITE, recordUrls: ['https://node.test/v1/provenance/prov_1'] });
    expect(after.subarray(0, before.length).equals(before)).toBe(true);
    expect(xrefPointsRight(after)).toBe(3);   // the information dictionary, the XMP stream, the catalog
    const meta = await getMeta(await getDocumentProxy(new Uint8Array(after)));
    const info = meta.info as Record<string, unknown>;
    expect(info.Subject).toBe('Combines content made with AI with work by people.');
    expect(info.Keywords).toBe('AI-generated, AI provenance');
    expect(info.Title).toBe('Harbour Lights 3');
    expect(info.Author).toBe('Studio');
    expect(JSON.stringify(info.Custom ?? info)).toContain('compositeWithTrainedAlgorithmicMedia');
    const xmpRead = meta.metadata as { getRaw?: () => string } | null;
    expect(xmpRead?.getRaw?.() ?? '').toContain('Iptc4xmpExt:DigitalSourceType');
  });
  it('a PDF with a cross-reference stream gets a stream update, and pdf.js still opens it and reads the subject', async () => {
    // Objects 1-3 and an uncompressed cross-reference stream (object 4), the shape PDF 1.5 writers use.
    const objs = ['1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n', '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\n'];
    let body = '%PDF-1.5\n';
    const offs: number[] = [];
    for (const o of objs) { offs.push(body.length); body += o; }
    const xrefAt = body.length;
    const rows = Buffer.alloc(4 * 7);
    rows[0] = 0; rows.writeUInt32BE(0, 1); rows.writeUInt16BE(65535, 5);
    offs.forEach((o, i) => { rows[(i + 1) * 7] = 1; rows.writeUInt32BE(o, (i + 1) * 7 + 1); rows.writeUInt16BE(0, (i + 1) * 7 + 5); });
    const xrefObj = Buffer.concat([Buffer.from(`4 0 obj\n<< /Type /XRef /Size 5 /W [1 4 2] /Index [0 4] /Root 1 0 R /Length ${rows.length} >>\nstream\n`, 'latin1'), rows, Buffer.from(`\nendstream\nendobj\nstartxref\n${xrefAt}\n%%EOF\n`, 'latin1')]);
    const before = Buffer.concat([Buffer.from(body, 'latin1'), xrefObj]);
    const after = markPdf(before, { xmp, subject: 'Made with AI.', keywords: 'AI-generated', digitalSourceType: COMPOSITE, recordUrls: ['https://node.test/v1/provenance/prov_1'] });
    expect(after.toString('latin1', before.length)).toContain('/Type /XRef');
    expect(xrefPointsRight(after)).toBe(4);   // information, XMP, catalog, and the stream itself
    const meta = await getMeta(await getDocumentProxy(new Uint8Array(after)));
    expect((meta.info as Record<string, unknown>).Subject).toBe('Made with AI.');
    expect((meta.metadata as { getRaw?: () => string } | null)?.getRaw?.() ?? '').toContain('DigitalSourceType');
  });
  it('refuses bytes that are not a PDF', () => {
    expect(() => markPdf(Buffer.from('hello'), { xmp, subject: 's', keywords: 'k', digitalSourceType: COMPOSITE, recordUrls: [] })).toThrow();
  });
});

describe('markArchive', () => {
  async function cbz(): Promise<Buffer> {
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const parts: Buffer[] = [];
    const done = new Promise<Buffer>((resolve) => { archive.on('data', (c: Buffer) => parts.push(c)); archive.on('end', () => resolve(Buffer.concat(parts))); });
    archive.append(png(), { name: '001.png' });
    archive.append(png(), { name: '002.png' });
    archive.append(Buffer.from('<ComicInfo><Title>Harbour Lights</Title></ComicInfo>'), { name: 'ComicInfo.xml' });
    await archive.finalize();
    return done;
  }
  function entries(zip: Buffer): Promise<Record<string, Buffer>> {
    return new Promise((resolve, reject) => {
      yauzl.fromBuffer(zip, { lazyEntries: true }, (e, z) => {
        if (e || !z) return reject(e);
        const out: Record<string, Buffer> = {};
        z.on('entry', (en: yauzl.Entry) => z.openReadStream(en, (err, s) => {
          if (err || !s) return reject(err);
          const c: Buffer[] = []; s.on('data', (d: Buffer) => c.push(d)); s.on('end', () => { out[en.fileName] = Buffer.concat(c); z.readEntry(); });
        }));
        z.on('end', () => resolve(out));
        z.readEntry();
      });
    });
  }
  it('marks every page, keeps ComicInfo.xml and the order, and adds the packet beside them', async () => {
    const { data, pages } = await markArchive(await cbz(), xmp, 'Made with AI.');
    expect(pages).toBe(2);
    const e = await entries(data);
    expect(Object.keys(e)).toEqual(['001.png', '002.png', 'ComicInfo.xml', 'AIMEAT-provenance.xmp']);
    expect(chunks(e['001.png']).some(c => c.type === 'iTXt')).toBe(true);
    expect(e['ComicInfo.xml'].toString()).toContain('Harbour Lights');
    expect(e['AIMEAT-provenance.xmp'].toString()).toContain('DigitalSourceType');
  });
});
