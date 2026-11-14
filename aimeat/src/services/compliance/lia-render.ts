/**
 * @file src/services/compliance/lia-render.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A balancing test as a document a person files or sends on: Markdown, a PDF and an
 *   Excel workbook. All three print the same rows (liaRows), in the five sections of the question set
 *   (data/compliance-lia.ts) and the outcome, so no format says something another leaves out.
 *
 *   EVERY ROW SAYS WHERE IT CAME FROM: read from the app, an AI, a person, or a proposal of the
 *   server. A reader of the file sees which answers a model drafted and which a person gave, and the
 *   last rows say who approved the test and when.
 *
 *   THE WORKBOOK IS WRITTEN HERE, WITHOUT A SPREADSHEET LIBRARY. An .xlsx file is a ZIP of six small
 *   XML parts; the node already carries the ZIP writer (archiver). One sheet, text cells as inline
 *   strings, one bold style for the headings. Excel, LibreOffice and the node's own reader
 *   (file-text/xlsx.ts) open it.
 * @structure LiaRenderContext · LiaRow · liaRows() · liaMarkdown() · renderLiaPdf() · renderLiaXlsx()
 * @usage const pdf = await renderLiaPdf(lia, { app: 'crm.html', registerTitle: 'Customers', standing: 'approved' });
 * @version-history
 *   v1.1.0 — 2026-11-14 — An approval by an agent or an app says so beside the approver, and the one who
 *     asked for an owner's approval has a row.
 *   v1.0.0 — 2026-11-13 — Initial.
 */
import PDFDocument from 'pdfkit';
import { ZipArchive } from 'archiver';
import { LIA_LABELS, LIA_SECTIONS, type LiaLang } from '../../data/compliance-lia.js';
import { complianceDomainById } from '../../data/compliance-domains.js';
import { escapeHtml } from '../../utils/html-escape.js';
import type { ComplianceLia } from './lia-schemas.js';

export interface LiaRenderContext {
  app: string;
  registerTitle: string;
  /** Where the test stands now (lia-need.ts liaStanding). */
  standing: 'draft' | 'approved' | 'reopened' | 'review-due';
  lang?: LiaLang;
}

/** One printed row. `kind` decides how a format sets it: a heading, a fact, a question or free text. */
export interface LiaRow {
  kind: 'title' | 'section' | 'fact' | 'question' | 'text' | 'footer';
  label: string;
  value?: string;
  note?: string;
  source?: string;
}

const day = (iso: string | undefined): string => (iso ? iso.slice(0, 10) : '');

/** The rows of a test, in reading order. */
export function liaRows(lia: ComplianceLia, ctx: LiaRenderContext): LiaRow[] {
  const lang = ctx.lang ?? lia.language ?? 'en';
  const t = LIA_LABELS[lang];
  const f = lia.facts;
  const src = (key: string): string => {
    const s = lia.answerSources?.[key];
    return s ? t.sources[s] : '';
  };
  const evidence = t.sources.evidence;
  const join = (xs: string[] | undefined): string => (xs?.length ? xs.join('; ') : t.none);
  const rows: LiaRow[] = [
    { kind: 'title', label: t.title },
    { kind: 'fact', label: t.app, value: ctx.app },
    { kind: 'fact', label: t.register, value: ctx.registerTitle },
    { kind: 'fact', label: t.status, value: ctx.standing === 'draft' ? t.draft : ctx.standing === 'reopened' ? t.reopened : t.approved },
  ];
  const facts: Record<string, LiaRow[]> = f ? {
    basis: [
      { kind: 'fact', label: t.purpose, value: f.purposeText || t.none, source: evidence },
      { kind: 'fact', label: t.basis, value: join(f.legalBasis.map(b => t.bases[b] ?? b)), source: evidence },
    ],
    interest: [{ kind: 'fact', label: t.purpose, value: f.purposeText || t.none, source: evidence }],
    necessity: [
      { kind: 'fact', label: t.categories, value: join(f.dataCategories), source: evidence },
      { kind: 'fact', label: t.minimisation, value: f.minimisation.length ? f.minimisation.map(m => `${m.what} (${m.why})`).join('; ') : t.none, source: t.sources.proposed },
    ],
    balancing: [
      { kind: 'fact', label: t.categories, value: join(f.dataCategories), source: evidence },
      { kind: 'fact', label: t.domains, value: join(f.domains.map(d => complianceDomainById(d)?.name[lang] ?? d)), source: evidence },
      { kind: 'fact', label: t.subjects, value: join(f.subjects), source: evidence },
      { kind: 'fact', label: t.ai, value: f.usesAi ? `${t.yes}: ${f.aiEvidence.join('; ')}` : t.none, source: evidence },
      { kind: 'fact', label: t.reach, value: t.reaches[f.reach], source: evidence },
      ...(f.reminders.length ? [{ kind: 'fact' as const, label: t.reminders, value: f.reminders.join(' '), source: evidence }] : []),
    ],
    safeguards: [{ kind: 'fact', label: t.nodeSafeguards, value: f.nodeSafeguards.length ? f.nodeSafeguards.map(m => m.text).join(' ') : t.none, source: evidence }],
  } : {};
  for (const s of LIA_SECTIONS) {
    rows.push({ kind: 'section', label: s.title[lang] });
    rows.push(...(facts[s.id] ?? []));
    for (const q of s.questions) {
      const a = lia.answers?.[q.id];
      rows.push({ kind: 'question', label: q.text[lang], value: a === 'yes' ? t.yes : a === 'no' ? t.no : t.unanswered, note: lia.notes?.[q.id] ?? '', source: a ? src(`answers.${q.id}`) : '' });
    }
    rows.push({ kind: 'text', label: s.id === 'safeguards' ? t.appSafeguards : `${t.reasoning}: ${s.asks[lang]}`, value: lia.notes?.[s.id] ?? '', source: lia.notes?.[s.id] ? src(`notes.${s.id}`) : '' });
  }
  rows.push({ kind: 'section', label: t.outcome });
  rows.push({ kind: 'fact', label: t.outcome, value: lia.outcome?.result === 'suitable' ? t.suitable : lia.outcome?.result === 'not-suitable' ? t.notSuitable : t.unanswered, source: lia.outcome ? src('outcome') : '' });
  rows.push({ kind: 'text', label: t.summary, value: lia.outcome?.summary ?? '', source: lia.outcome?.summary ? src('outcome') : '' });
  // An agent's or an app's approval says so beside its name, so the file never reads as a person's.
  const byWhat = lia.approvedByKind === 'agent' ? ` (${t.byAgent})` : lia.approvedByKind === 'app' ? ` (${t.byApp})` : '';
  rows.push({ kind: 'fact', label: t.approvedBy, value: lia.approvedBy ? `${lia.approvedBy}${byWhat}` : '' });
  if (lia.requestedBy) rows.push({ kind: 'fact', label: t.requestedBy, value: lia.requestedBy });
  rows.push({ kind: 'fact', label: t.approvedAt, value: day(lia.approvedAt) });
  rows.push({ kind: 'fact', label: t.reviewAt, value: day(lia.reviewAt) });
  rows.push({ kind: 'fact', label: t.preparedBy, value: [lia.updatedBy, day(lia.updatedAt)].filter(Boolean).join(', ') });
  rows.push({ kind: 'footer', label: t.notLegalAdvice });
  return rows;
}

/** The test as Markdown. */
export function liaMarkdown(lia: ComplianceLia, ctx: LiaRenderContext): string {
  const t = LIA_LABELS[ctx.lang ?? lia.language ?? 'en'];
  const out: string[] = [];
  const tail = (r: LiaRow): string => (r.source ? ` _(${t.source}: ${r.source})_` : '');
  for (const r of liaRows(lia, ctx)) {
    if (r.kind === 'title') out.push(`# ${r.label}`, '');
    else if (r.kind === 'section') out.push('', `## ${r.label}`, '');
    else if (r.kind === 'fact') out.push(`- **${r.label}:** ${r.value || '…'}${tail(r)}`);
    else if (r.kind === 'question') out.push(`- ${r.label} **${r.value}**${r.note ? ` ${r.note}` : ''}${tail(r)}`);
    else if (r.kind === 'text') out.push('', `**${r.label}**`, '', `${r.value || '…'}${tail(r)}`, '');
    else out.push('', '---', '', r.label);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** The characters Windows-1252 has beyond Latin-1, which Helvetica prints too. */
const CP1252_EXTRA = new Set([0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017D,
  0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x017E, 0x0178]);

/** Helvetica prints Windows-1252; another character becomes '?' in the PDF only. */
function printable(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    out += (c >= 0x20 && c <= 0x7E) || (c >= 0xA0 && c <= 0xFF) || CP1252_EXTRA.has(c) ? ch : c === 0x0A ? ' ' : '?';
  }
  return out;
}

const M = 56;

/** The test as a PDF: the rows typeset, with the test's id and the page number on every page. */
export function renderLiaPdf(lia: ComplianceLia, ctx: LiaRenderContext): Promise<Buffer> {
  const t = LIA_LABELS[ctx.lang ?? lia.language ?? 'en'];
  const rows = liaRows(lia, ctx);
  return new Promise((resolvePdf, rejectPdf) => {
    const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true, info: { Title: `${t.title}: ${ctx.app}`, Subject: ctx.registerTitle, Keywords: lia.id } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolvePdf(Buffer.concat(chunks)));
    doc.on('error', rejectPdf);
    const width = doc.page.width - 2 * M;
    const grey = '#555555';
    const source = (r: LiaRow): void => {
      if (r.source) doc.font('Helvetica-Oblique').fontSize(8).fillColor(grey).text(printable(`${t.source}: ${r.source}`), { width }).fillColor('black');
    };
    for (const r of rows) {
      if (r.kind === 'title') doc.font('Helvetica-Bold').fontSize(18).text(printable(r.label), { width }).moveDown(0.4);
      else if (r.kind === 'section') doc.moveDown(0.6).font('Helvetica-Bold').fontSize(13).text(printable(r.label), { width }).moveDown(0.2);
      else if (r.kind === 'fact') {
        doc.font('Helvetica-Bold').fontSize(10).text(printable(`${r.label}: `), { width, continued: true }).font('Helvetica').text(printable(r.value || '…'));
        source(r);
      } else if (r.kind === 'question') {
        doc.moveDown(0.2).font('Helvetica').fontSize(10).text(printable(r.label), { width });
        doc.font('Helvetica-Bold').text(printable(r.value ?? ''), { width, continued: !!r.note }).font('Helvetica');
        if (r.note) doc.text(printable(`  ${r.note}`), { width });
        source(r);
      } else if (r.kind === 'text') {
        doc.moveDown(0.3).font('Helvetica-Bold').fontSize(10).text(printable(r.label), { width });
        doc.font('Helvetica').text(printable(r.value || '…'), { width });
        source(r);
      } else doc.moveDown(0.8).font('Helvetica-Oblique').fontSize(8.5).fillColor(grey).text(printable(r.label), { width }).fillColor('black');
    }
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Writing inside the bottom margin would make pdfkit open a new page; the footer is set there.
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(8).fillColor(grey)
        .text(printable(`${lia.id} · ${i + 1}/${range.count}`), M, doc.page.height - M + 18, { width, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}

/** Text as XML content: the characters XML 1.0 does not allow are dropped (they make Excel refuse the whole file), the rest escaped. */
// eslint-disable-next-line no-control-regex
const xml = (s: string): string => escapeHtml(s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, ''));

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** A text cell as an inline string. Style 1 is bold, 0 is plain; both wrap. */
const cell = (col: string, row: number, text: string, style: 0 | 1): string => (text
  ? `<c r="${col}${row}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xml(text.slice(0, 32000))}</t></is></c>`
  : '');

/** The test as an Excel workbook: one sheet, five columns (item, answer or value, note, source), a row per printed row. */
export function renderLiaXlsx(lia: ComplianceLia, ctx: LiaRenderContext): Promise<Buffer> {
  const t = LIA_LABELS[ctx.lang ?? lia.language ?? 'en'];
  const lines: string[] = [];
  let n = 0;
  const put = (cells: Array<[string, string, 0 | 1]>): void => {
    n++;
    lines.push(`<row r="${n}">${cells.map(([col, text, style]) => cell(col, n, text, style)).join('')}</row>`);
  };
  for (const r of liaRows(lia, ctx)) {
    if (r.kind === 'title') { put([['A', r.label, 1]]); put([['A', t.question, 1], ['B', t.answer, 1], ['C', t.note, 1], ['D', t.source, 1]]); }
    else if (r.kind === 'section') { put([]); put([['A', r.label, 1]]); }
    else if (r.kind === 'question') put([['A', r.label, 0], ['B', r.value ?? '', 0], ['C', r.note ?? '', 0], ['D', r.source ?? '', 0]]);
    else if (r.kind === 'footer') { put([]); put([['A', r.label, 0]]); }
    else put([['A', r.label, r.kind === 'text' ? 1 : 0], ['B', r.value ?? '', 0], ['D', r.source ?? '', 0]]);
  }
  const sheet = `${HEAD}<worksheet xmlns="${NS}"><sheetViews><sheetView workbookViewId="0"/></sheetViews>`
    + '<cols><col min="1" max="1" width="60" customWidth="1"/><col min="2" max="2" width="60" customWidth="1"/><col min="3" max="3" width="50" customWidth="1"/><col min="4" max="4" width="24" customWidth="1"/></cols>'
    + `<sheetData>${lines.join('')}</sheetData></worksheet>`;
  const wrap = '<alignment vertical="top" wrapText="1"/>';
  const styles = `${HEAD}<styleSheet xmlns="${NS}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>`
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">${wrap}</xf>`
    + `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">${wrap}</xf></cellXfs>`
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  const parts: Array<[string, string]> = [
    ['[Content_Types].xml', `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${HEAD}<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet name="${xml(t.title.split(' (')[0]!).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', styles],
    ['xl/worksheets/sheet1.xml', sheet],
  ];
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolveZip, rejectZip) => {
    archive.on('data', (c: Buffer) => chunks.push(c));
    archive.on('end', () => resolveZip(Buffer.concat(chunks)));
    archive.on('error', rejectZip);
  });
  for (const [name, body] of parts) archive.append(Buffer.from(body, 'utf8'), { name });
  void archive.finalize();
  return done;
}
