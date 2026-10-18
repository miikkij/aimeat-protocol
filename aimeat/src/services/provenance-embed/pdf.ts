/**
 * @file src/services/provenance-embed/pdf.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The provenance facts written into a PDF as an INCREMENTAL UPDATE: the original bytes
 *   stay exactly as they were, and new objects, a new cross-reference section and a new trailer are
 *   appended after them, the way the PDF format lets any writer add to a file it did not make.
 *
 *   What is added: a document information dictionary (`/Info`) that keeps the existing entries when
 *   the old one can be read and adds `/Subject`, `/Keywords` and the node's own keys
 *   (`/AIDigitalSourceType`, `/AIProvenance`); and, when the document catalog is a plain object in the
 *   file, the XMP packet as the catalog's `/Metadata` stream. A catalog kept inside a compressed
 *   object stream is left alone, and the information dictionary still says it.
 *
 *   The new cross-reference section has the shape the file already uses: a classic `xref` table after
 *   a classic one, an uncompressed cross-reference stream after a stream.
 * @structure markPdf
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (Comicland v3 A-8).
 */

/** A PDF text string any reader decodes, whatever characters it holds: UTF-16BE with a BOM, as hex. */
function pdfText(s: string): string {
  const be = Buffer.alloc(2 + s.length * 2);
  be.writeUInt16BE(0xfeff, 0);
  for (let i = 0; i < s.length; i++) be.writeUInt16BE(s.charCodeAt(i), 2 + i * 2);
  return `<${be.toString('hex').toUpperCase()}>`;
}

/** The dictionary text after `<<` up to its matching `>>`, from `from`; null when unbalanced. */
function dictAt(text: string, from: number): { body: string; end: number } | null {
  const start = text.indexOf('<<', from);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length - 1; i++) {
    if (text[i] === '<' && text[i + 1] === '<') { depth++; i++; continue; }
    if (text[i] === '>' && text[i + 1] === '>') { depth--; i++; if (depth === 0) return { body: text.slice(start + 2, i - 1), end: i + 1 }; }
  }
  return null;
}

/** The body of the LAST plain `num gen obj << … >>` in the file, or null when there is none. */
function plainObjectDict(text: string, num: number, gen: number): string | null {
  const re = new RegExp(`(?:^|[\\s>])${num}\\s+${gen}\\s+obj\\b`, 'g');
  let last = -1;
  for (let m = re.exec(text); m; m = re.exec(text)) last = m.index + m[0].length;
  if (last < 0) return null;
  const d = dictAt(text, last);
  // Only when the dictionary comes before the object's end, not some later object's.
  const objEnd = text.indexOf('endobj', last);
  return d && (objEnd < 0 || d.end <= objEnd + 2) ? d.body : null;
}

function refIn(dict: string, key: string): { num: number; gen: number } | null {
  const m = new RegExp(`/${key}\\s+(\\d+)\\s+(\\d+)\\s+R`).exec(dict);
  return m ? { num: Number(m[1]), gen: Number(m[2]) } : null;
}

/** Remove one entry (`/Key value`) of a simple value kind from a dictionary body. */
function withoutKey(dict: string, key: string): string {
  return dict.replace(new RegExp(`/${key}\\s*(\\d+\\s+\\d+\\s+R|<[0-9A-Fa-f\\s]*>|\\((?:\\\\.|[^\\\\)])*\\)|/[^\\s/<>\\[\\]()]+)`, 'g'), '');
}

/** The PDF with the facts appended; throws when its end-of-file structure cannot be read. */
export function markPdf(pdf: Buffer, facts: { xmp: string; subject: string; keywords: string; digitalSourceType: string; recordUrls: string[] }): Buffer {
  const text = pdf.toString('latin1');
  if (!text.startsWith('%PDF-')) throw new Error('not a PDF');
  const tail = text.slice(-2048);
  const sx = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail);
  if (!sx) throw new Error('the PDF has no readable startxref');
  const prev = Number(sx[1]);
  const classic = text.startsWith('xref', prev);
  let trailer: string | null;
  if (classic) {
    const t = text.indexOf('trailer', prev);
    trailer = t < 0 ? null : dictAt(text, t)?.body ?? null;
  } else {
    trailer = dictAt(text, prev)?.body ?? null;
    if (trailer && !/\/Type\s*\/XRef/.test(trailer)) trailer = null;
  }
  if (!trailer) throw new Error('the PDF trailer could not be read');
  const size = Number(/\/Size\s+(\d+)/.exec(trailer)?.[1] ?? NaN);
  const root = refIn(trailer, 'Root');
  if (!Number.isInteger(size) || !root) throw new Error('the PDF trailer names no /Size or /Root');
  const id = /\/ID\s*(\[[^\]]*\])/.exec(trailer)?.[1];

  const parts: string[] = [];
  const offsets: Array<{ num: number; gen: number; at: number }> = [];
  let cursor = pdf.length;
  const add = (num: number, gen: number, body: string): void => {
    const chunk = `\n${num} ${gen} obj\n${body}\nendobj\n`;
    // The object starts after the newline that separates it from what came before.
    offsets.push({ num, gen, at: cursor + 1 });
    parts.push(chunk);
    cursor += Buffer.byteLength(chunk, 'latin1');
  };

  let next = size;
  // The information dictionary, keeping what the file already said when it can be read.
  const oldInfo = refIn(trailer, 'Info');
  const oldInfoBody = oldInfo ? plainObjectDict(text, oldInfo.num, oldInfo.gen) : null;
  let info = oldInfoBody ?? '';
  for (const k of ['Subject', 'Keywords', 'AIDigitalSourceType', 'AIProvenance']) info = withoutKey(info, k);
  info += ` /Subject ${pdfText(facts.subject)} /Keywords ${pdfText(facts.keywords)}`
    + ` /AIDigitalSourceType ${pdfText(facts.digitalSourceType)} /AIProvenance ${pdfText(facts.recordUrls.join(' '))}`;
  const infoNum = next++;
  add(infoNum, 0, `<<${info} >>`);

  // The XMP packet as the catalog's /Metadata, when the catalog is a plain object here.
  const catalog = plainObjectDict(text, root.num, root.gen);
  if (catalog !== null) {
    const xmpBytes = Buffer.from(facts.xmp, 'utf8');
    const metaNum = next++;
    // The stream holds UTF-8; written through latin1 the bytes stay the same.
    add(metaNum, 0, `<< /Type /Metadata /Subtype /XML /Length ${xmpBytes.length} >>\nstream\n${xmpBytes.toString('latin1')}\nendstream`);
    add(root.num, root.gen, `<<${withoutKey(catalog, 'Metadata')} /Metadata ${metaNum} 0 R >>`);
  }

  const trailerKeys = `/Root ${root.num} ${root.gen} R /Info ${infoNum} 0 R /Prev ${prev}${id ? ` /ID ${id}` : ''}`;
  let xrefPart: Buffer;
  const xrefAt = cursor + 1;
  if (classic) {
    const rows = offsets.sort((a, b) => a.num - b.num)
      .map(o => `${o.num} 1\n${String(o.at).padStart(10, '0')} ${String(o.gen).padStart(5, '0')} n\r\n`).join('');
    xrefPart = Buffer.from(`\nxref\n${rows}trailer\n<< /Size ${next} ${trailerKeys} >>\nstartxref\n${xrefAt}\n%%EOF\n`, 'latin1');
  } else {
    // An uncompressed cross-reference stream: one row per object, type 1, a 4-byte offset, a 2-byte generation.
    const xrefNum = next++;
    const rows = [...offsets, { num: xrefNum, gen: 0, at: xrefAt }].sort((a, b) => a.num - b.num);
    const data = Buffer.alloc(rows.length * 7);
    rows.forEach((o, i) => { data[i * 7] = 1; data.writeUInt32BE(o.at, i * 7 + 1); data.writeUInt16BE(o.gen, i * 7 + 5); });
    const head = `\n${xrefNum} 0 obj\n<< /Type /XRef /Size ${next} /W [1 4 2] /Index [${rows.map(o => `${o.num} 1`).join(' ')}] ${trailerKeys} /Length ${data.length} >>\nstream\n`;
    xrefPart = Buffer.concat([Buffer.from(head, 'latin1'), data, Buffer.from(`\nendstream\nendobj\nstartxref\n${xrefAt}\n%%EOF\n`, 'latin1')]);
  }
  return Buffer.concat([pdf, Buffer.from(parts.join(''), 'latin1'), xrefPart]);
}
