/**
 * @file src/services/content/extract-pdf.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a PDF says about itself: its Info dictionary and its XMP packet (title, author,
 *   subject, keywords, creator tool, producer, dates), the page count, the PDF version, whether it is
 *   encrypted, whether it has a text layer, and its signatures (types.ts PdfFacts).
 *
 *   READERS REUSED. The metadata and the page count come from unpdf's pdf.js (getDocumentProxy,
 *   getMetadata), the text from services/file-text extractFileText, and the signatures from
 *   services/docsign validatePdf. validatePdf runs only when `config.docsignEnabled` is true; off,
 *   or when it throws, the verdict is 'unchecked' and the reason goes into `errors.signatures`.
 *
 *   XMP OVER INFO. Where both carry a value, the XMP one wins: the Info dictionary is deprecated in
 *   PDF 2.0, and a tool that edits a PDF updates the XMP packet more often than the Info dictionary.
 *   Dates are rewritten to ISO 8601 when they parse ("D:20261020120000+03'00'" gives
 *   "2026-10-20T12:00:00+03:00"), otherwise kept as written.
 *
 *   A scan has no text layer; `hasTextLayer` is true only when the text is at least 40 characters
 *   after trimming, so a page number or a stamp alone does not count as a text layer.
 *
 *   A PDF WHOSE DECODE COST THE BUDGET CANNOT MEASURE (file-text/pdf-budget.ts 'unmeasured') is read
 *   in one worker, metadata and text, under the node's time and memory limits
 *   (file-text/pdf-bounded.ts). Past one, the file is left as it is, its text is not read, and
 *   `textNotRead` and `errors.pdfText` say which limit.
 * @structure readPdfFacts · pdfDateToIso · mapSignatures · applyMeta · readBounded
 * @usage const { facts, text, errors } = await readPdfFacts(config, bytes, { online: false });
 * @version-history
 *   v1.2.0 — 2026-10-29 — A PDF the budget cannot measure is read under the time and memory limits;
 *     past one, facts.textNotRead says which (secaudit2026oct26 round 8c, memory-b-09).
 *   v1.0.0 — 2026-10-20 — Initial.
 *   v1.1.0 — 2026-10-25 — secaudit2026oct22: a PDF whose text and metadata streams decode past
 *     256 MB is not handed to pdf.js (file-text/pdf-budget.ts); errors.pdfMeta says why.
 */
import { getDocumentProxy } from 'unpdf';
import type { AimeatConfig } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { extractFileText, pdfTextResult } from '../file-text/index.js';
import { pdfDecodeMeasure } from '../file-text/pdf-budget.js';
import { PdfLimitReached, limitsActive, pdfReadLimits, readPdfBounded, type PdfReadLimits } from '../file-text/pdf-bounded.js';
import { validatePdf, type ValidationReport } from '../docsign/validate.js';
import type { PdfFacts } from './types.js';

/** Text shorter than this, trimmed, is not counted as a text layer. */
const MIN_TEXT_LAYER_CHARS = 40;

/**
 * A PDF date ("D:YYYYMMDDHHmmSSOHH'mm'") or an XMP date as ISO 8601. A date with no zone gets none.
 * A value that does not parse is returned trimmed, and an empty one gives undefined.
 */
export function pdfDateToIso(v: unknown): string | undefined {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.toISOString();
  if (typeof v !== 'string' || !v.trim()) return undefined;
  const s = v.trim();
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(Z|[+-]\d{2}'?\d{2}'?|[+-]\d{2})?/.exec(s);
  if (m) {
    const [, y, mo = '01', d = '01', h = '00', mi = '00', se = '00', z] = m;
    let zone = '';
    if (z === 'Z') zone = 'Z';
    else if (z) {
      const digits = z.replace(/'/g, '');
      zone = `${digits.slice(0, 3)}:${digits.slice(3, 5) || '00'}`;
    }
    return `${y}-${mo}-${d}T${h}:${mi}:${se}${zone}`;
  }
  // An XMP date is ISO 8601 already; anything else is kept as written.
  return s;
}

/** A metadata value as one string: arrays (XMP Seq, Bag, Alt) joined with ", ". */
function textOf(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) {
    const parts = v.map(textOf).filter((x): x is string => !!x);
    return parts.length ? parts.join(', ') : undefined;
  }
  return undefined;
}

/** The validatePdf report in the PdfFacts signature shape. */
function mapSignatures(report: ValidationReport): PdfFacts['signatures'] {
  return {
    verdict: report.verdict,
    count: report.signatures.length,
    online: report.online,
    signers: report.signatures.map((s) => {
      const signer: PdfFacts['signatures']['signers'][number] = {};
      const name = s.signer?.commonName ?? s.signer?.name;
      if (name) signer.name = name;
      if (s.signer?.organization) signer.organisation = s.signer.organization;
      if (s.signer?.country) signer.country = s.signer.country;
      if (s.signer?.email) signer.email = s.signer.email;
      if (s.level) signer.level = s.level;
      const at = s.signedAt?.time ?? s.pdf?.claimedTime;
      if (at) signer.signedAt = at;
      signer.trusted = !!s.trust?.trusted;
      signer.integrity = s.integrity.contentIntact && s.integrity.signatureValid ? 'intact'
        : !s.integrity.contentIntact ? 'content-changed' : 'signature-invalid';
      if (s.pdf?.reason) signer.reason = s.pdf.reason;
      if (s.pdf?.location) signer.location = s.pdf.location;
      return signer;
    }),
  };
}

type Meta = { get(name: string): unknown } | null | undefined;

/** One XMP property, tried with the casing pdf.js keeps and in lower case. */
function xmpGet(meta: Meta, name: string): unknown {
  if (!meta || typeof meta.get !== 'function') return undefined;
  return meta.get(name) ?? meta.get(name.toLowerCase()) ?? undefined;
}

/** The XMP names applyMeta reads. */
const XMP_NAMES = ['dc:title', 'dc:creator', 'dc:description', 'pdf:Keywords', 'xmp:CreatorTool', 'pdf:Producer', 'xmp:CreateDate', 'xmp:ModifyDate'] as const;

/** The Info dictionary and the XMP packet into the facts, XMP first. */
function applyMeta(facts: PdfFacts, info: Record<string, unknown>, metadata: Meta): void {
  if (typeof info.PDFFormatVersion === 'string') facts.pdfVersion = info.PDFFormatVersion;
  facts.encrypted = !!info.EncryptFilterName;
  const pick = (xmpName: string, infoName: string): string | undefined =>
    textOf(xmpGet(metadata, xmpName)) ?? textOf(info[infoName]);
  const title = pick('dc:title', 'Title');
  const author = pick('dc:creator', 'Author');
  const subject = pick('dc:description', 'Subject');
  const keywords = pick('pdf:Keywords', 'Keywords');
  const creator = pick('xmp:CreatorTool', 'Creator');
  const producer = pick('pdf:Producer', 'Producer');
  const createdAt = pdfDateToIso(textOf(xmpGet(metadata, 'xmp:CreateDate')) ?? info.CreationDate);
  const modifiedAt = pdfDateToIso(textOf(xmpGet(metadata, 'xmp:ModifyDate')) ?? info.ModDate);
  Object.assign(facts, Object.fromEntries(Object.entries({ title, author, subject, keywords, creator, producer, createdAt, modifiedAt })
    .filter(([, v]) => v !== undefined)));
}

/** A metadata read that failed: a password error marks the PDF encrypted, the message is kept. */
function metaFailed(facts: PdfFacts, errors: Record<string, string>, err: unknown): void {
  const msg = (err as Error)?.message || String(err);
  if ((err as Error)?.name === 'PasswordException' || /password/i.test(msg)) facts.encrypted = true;
  errors.pdfMeta = msg.slice(0, 300);
}

/**
 * A PDF the budget cannot measure: its metadata and text in one worker under `limits`. At a limit
 * the file is left as it is, its text is not read, and the facts say which limit (textNotRead).
 */
async function readBounded(bytes: Buffer, limits: PdfReadLimits, facts: PdfFacts, errors: Record<string, string>): Promise<string | null> {
  try {
    const got = await readPdfBounded(bytes, limits, { text: true, meta: XMP_NAMES });
    if (typeof got.pages === 'number') facts.pages = got.pages;
    const xmp = got.xmp ?? {};
    applyMeta(facts, got.info ?? {}, { get: (name: string) => xmp[name] });
    const text = pdfTextResult(got.text ?? '').text;
    return text || null;
  } catch (err) {
    if (err instanceof PdfLimitReached) {
      facts.textNotRead = { reason: err.limit, limit: err.limit === 'time' ? err.value / 1000 : err.value };
      errors.pdfText = `The text of this PDF was not read: ${err.message}. The file is stored as it was.`;
      return null;
    }
    metaFailed(facts, errors, err);
    logger.debug(`[content] a PDF read in the worker failed: ${errors.pdfMeta}`);
    return null;
  }
}

/**
 * The facts of a PDF, its text layer and the readers that failed.
 * @param {AimeatConfig} config - Reads `docsignEnabled` (and, inside validatePdf, the docsign settings).
 * @param {Buffer} bytes - The PDF.
 * @param {{online: boolean}} opts - Whether signature validation may ask trust lists and revocation online.
 * @returns {Promise<{facts: PdfFacts, text: string|null, errors: Record<string, string>}>}
 */
export async function readPdfFacts(config: AimeatConfig, bytes: Buffer, opts: { online: boolean }): Promise<{
  facts: PdfFacts; text: string | null; errors: Record<string, string>;
}> {
  const errors: Record<string, string> = {};
  const facts: PdfFacts = {
    hasTextLayer: false,
    signatures: { verdict: 'unchecked', count: 0, signers: [], online: false },
  };

  const header = /^%PDF-(\d\.\d)/.exec(bytes.toString('latin1', 0, 16));
  if (header) facts.pdfVersion = header[1];

  // pdf.js inflates every stream it reads with no size limit, in this process. A PDF whose text and
  // metadata streams decode past the budget is not handed to it: the facts say why, and the
  // signature check, which reads the raw bytes, still runs. One whose decode cost the budget cannot
  // measure is read in a worker under the node's time and memory limits (file-text/pdf-bounded.ts).
  const measure = await pdfDecodeMeasure(bytes);
  const withinBudget = measure.verdict !== 'over';
  const limits = pdfReadLimits(config);
  const bounded = measure.verdict === 'unmeasured' && limitsActive(limits);
  let text: string | null = null;
  if (!withinBudget) {
    errors.pdfMeta = 'The PDF was not read: its content decodes to more than 256 MB.';
  } else if (bounded) {
    text = await readBounded(bytes, limits, facts, errors);
  } else {
    try {
      const doc = await getDocumentProxy(new Uint8Array(bytes));
      try {
        facts.pages = doc.numPages;
        const { info, metadata } = await doc.getMetadata() as unknown as { info: Record<string, unknown>; metadata: Meta };
        applyMeta(facts, info, metadata);
      } finally {
        // Frees pdf.js's worker-side document; a failure here loses no facts, so it is only logged.
        await doc.loadingTask.destroy().catch((err: unknown) => {
          logger.debug(`[content] pdf.js destroy failed: ${(err as Error)?.message || String(err)}`);
        });
      }
    } catch (err) {
      metaFailed(facts, errors, err);
    }
    try {
      const got = await extractFileText(bytes, 'application/pdf', 'file.pdf', { pdfLimits: limits });
      // An empty text with a note is a scan (no text layer) or a read failure; the second one also
      // fails getDocumentProxy above, so errors.pdfMeta already carries it.
      text = got?.text ? got.text : null;
    } catch (err) {
      errors.pdfText = ((err as Error)?.message || String(err)).slice(0, 300);
    }
  }
  facts.hasTextLayer = (text?.trim().length ?? 0) >= MIN_TEXT_LAYER_CHARS;
  if (text !== null && !text.trim()) text = null;

  if (config.docsignEnabled) {
    try {
      facts.signatures = mapSignatures(await validatePdf(config, bytes, { online: opts.online }));
    } catch (err) {
      errors.signatures = ((err as Error)?.message || String(err)).slice(0, 300);
    }
  }

  return { facts, text, errors };
}
