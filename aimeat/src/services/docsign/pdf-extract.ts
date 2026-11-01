/**
 * @file src/services/docsign/pdf-extract.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Finds the signatures inside a PDF: every signature dictionary's /ByteRange, the
 *   CMS blob in its /Contents, the dictionary fields a reader shows (/SubFilter, /M, /Name,
 *   /Reason, /Location), and what the file holds after the bytes each signature covers.
 *
 *   NO PDF PARSER. A signature dictionary is located by its /ByteRange array, which ISO 32000
 *   requires to be a direct object in an uncompressed dictionary (the signer has to patch the
 *   offsets in after writing the file, which a compressed object stream would not allow). The
 *   four numbers name the two signed spans; the gap between them is exactly the /Contents hex
 *   string. That makes the extraction a byte scan, and keeps a full PDF parser (and its attack
 *   surface) out of a route that takes files from anyone.
 *
 *   WHAT "COVERS THE WHOLE FILE" MEANS. A signature covers [a, a+b) and [c, c+d). When c+d is the
 *   file length, nothing was appended after signing. When it is not, the file carries later
 *   incremental updates. Those are normal when they hold later signatures, a document timestamp
 *   or validation data (/DSS), and a change of content otherwise. The scan classifies the appended
 *   bytes by the object types they declare; a deep object-by-object comparison of revisions is out
 *   of scope and the report says so.
 * @structure PdfSignatureField · extractPdfSignatures · classifyAppended · scanAppendedObjects
 * @usage const sigs = extractPdfSignatures(buffer);
 * @version-history
 *   2026-11-01 — classifyAppended: an all-zero placeholder /ByteRange is not a later signature;
 *     validation data comes only from a /DSS an updated Catalog names (or a rewrite of the signed
 *     revision's DSS), not from the characters /DSS anywhere; an object the signed revision had,
 *     rewritten as anything but its Catalog, AcroForm, pages, annotations, signatures, Info,
 *     metadata or DSS, is a change; and an update that only validation data explains holds only
 *     validation data. Objects inside object streams are read (pdf-objects.ts). Content changed
 *     after a signature read NOT_WHOLE_FILE before (secaudit2026oct31w2 round 11).
 *   2026-10-27 — extractPdfSignatures takes maxFields and refuses a file with more distinct signature
 *     fields (TOO_MANY_SIGNATURES) before reading any of them, and a field's signedBytes is made when
 *     read instead of held, so memory no longer grows with fields x file size (secaudit2026oct26).
 *   v1.0.0 — 2026-10-09 — Initial (wish-virallisen-dokumentin-allekirjoitus-ja-allekirjoituksen-tark).
 */

import { PdfObjects, canonical, topLevelRef, typeOf, type PdfValue } from './pdf-objects.js';

export interface PdfSignatureField {
  /** Zero-based position of this signature among the ones found, in file order. */
  index: number;
  byteRange: [number, number, number, number];
  /** The DER bytes of the CMS SignedData (or RFC 3161 token), trailing zero padding removed. */
  cms: Buffer;
  /** The bytes the signature covers: [a, a+b) followed by [c, c+d). A fresh copy on each read; read it once per check. */
  readonly signedBytes: Buffer;
  subFilter: string | null;
  /** /Type /DocTimeStamp: a document timestamp rather than a person's signature. */
  isDocTimestamp: boolean;
  /** /M as written by the signing software. Claimed, never proved. */
  claimedSigningTime: string | null;
  name: string | null;
  reason: string | null;
  location: string | null;
  contactInfo: string | null;
  /** True when c+d equals the file length. */
  coversWholeFile: boolean;
  /** What the bytes after this signature's range contain, when there are any. */
  appended: AppendedContent | null;
}

export interface AppendedContent {
  bytes: number;
  /** A later signature or document timestamp starts in the appended bytes. */
  laterSignatures: number;
  /** A /DSS (validation data) dictionary was added. */
  validationData: boolean;
  /** Objects other than signatures, signature fields, annotations of a signature and /DSS. */
  otherChanges: boolean;
  /** Object types seen in the appended bytes, for the report (e.g. Page, Annot, XObject). */
  types: string[];
}

export class PdfExtractError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

const BYTE_RANGE_RE = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;

/** The whole PDF as latin1 text, so string offsets equal byte offsets. */
function asText(buf: Buffer): string {
  return buf.toString('latin1');
}

/** Length of a DER element starting at buf[0]: the trailing zero padding of /Contents is cut by it. */
function derLength(buf: Buffer): number | null {
  if (buf.length < 2 || buf[0] !== 0x30) return null;
  const first = buf[1]!;
  if (first < 0x80) return 2 + first;
  const n = first & 0x7f;
  if (n === 0 || n > 4 || buf.length < 2 + n) return null;
  let len = 0;
  for (let i = 0; i < n; i++) len = len * 256 + buf[2 + i]!;
  return 2 + n + len;
}

/**
 * The dictionary around a /ByteRange: walk outward to the enclosing `<<` and `>>`, counting nested
 * dictionaries and stepping over the /Contents hex string, whose byte span the ByteRange names.
 */
function enclosingDictionary(text: string, at: number, gapStart: number, gapEnd: number): string {
  let depth = 0;
  let start = -1;
  for (let i = at; i > 1 && at - i < 64 * 1024; i--) {
    if (i > gapStart && i <= gapEnd) { i = gapStart; continue; }
    if (text[i] === '>' && text[i - 1] === '>') { depth++; i--; continue; }
    if (text[i] === '<' && text[i - 1] === '<') {
      if (depth === 0) { start = i - 1; break; }
      depth--; i--;
    }
  }
  if (start < 0) return '';
  depth = 0;
  for (let i = start + 2; i < text.length - 1 && i - start < 64 * 1024 + (gapEnd - gapStart); i++) {
    if (i >= gapStart && i < gapEnd) { i = gapEnd - 1; continue; }
    if (text[i] === '<' && text[i + 1] === '<') { depth++; i++; continue; }
    if (text[i] === '>' && text[i + 1] === '>') {
      if (depth === 0) return text.slice(start, i + 2).replace(text.slice(gapStart, gapEnd), '<…>');
      depth--; i++;
    }
  }
  return text.slice(start, Math.min(text.length, start + 4096));
}

/** Decode a PDF literal string's escapes, enough for names and reasons (not a full PDF lexer). */
function pdfLiteral(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch !== '\\') { out += ch; continue; }
    const nx = raw[++i];
    if (nx === undefined) break;
    if (nx === 'n') out += '\n';
    else if (nx === 'r') out += '\r';
    else if (nx === 't') out += '\t';
    else if (/[0-7]/.test(nx)) {
      let oct = nx;
      while (oct.length < 3 && /[0-7]/.test(raw[i + 1] ?? '')) oct += raw[++i];
      out += String.fromCharCode(parseInt(oct, 8));
    } else out += nx;
  }
  // UTF-16BE with a byte order mark is how PDF writes non-Latin text in a string.
  if (out.charCodeAt(0) === 0xfe && out.charCodeAt(1) === 0xff) {
    const bytes = Buffer.from(out.slice(2), 'latin1');
    if (bytes.length % 2 === 1) return bytes.subarray(0, bytes.length - 1).swap16().toString('utf16le');
    return Buffer.from(bytes).swap16().toString('utf16le');
  }
  // Some writers put raw UTF-8 in a string; the standard says PDFDocEncoding. Try the first, fall
  // back to the second.
  const utf8 = Buffer.from(out, 'latin1').toString('utf8');
  if (!utf8.includes('�')) return utf8;
  return [...out].map((ch) => PDF_DOC_ENCODING[ch.charCodeAt(0)] ?? ch).join('');
}

/** PDFDocEncoding where it differs from Latin-1 (ISO 32000-1, Annex D.2). */
const PDF_DOC_ENCODING: Record<number, string> = {
  0x80: '•', 0x81: '†', 0x82: '‡', 0x83: '…', 0x84: '—', 0x85: '–',
  0x86: 'ƒ', 0x87: '⁄', 0x88: '‹', 0x89: '›', 0x8a: '−', 0x8b: '‰',
  0x8c: '„', 0x8d: '“', 0x8e: '”', 0x8f: '‘', 0x90: '’', 0x91: '‚',
  0x92: '™', 0x93: 'ﬁ', 0x94: 'ﬂ', 0x95: 'Ł', 0x96: 'Œ', 0x97: 'Š',
  0x98: 'Ÿ', 0x99: 'Ž', 0x9a: 'ı', 0x9b: 'ł', 0x9c: 'œ', 0x9d: 'š',
  0x9e: 'ž', 0xa0: '€',
};

/** One field of a dictionary: a literal string `( … )` or a hex string `< … >`. */
function stringField(dict: string, key: string): string | null {
  const lit = new RegExp(`/${key}\\s*\\(`).exec(dict);
  if (lit) {
    let depth = 1;
    let i = lit.index + lit[0].length;
    const start = i;
    for (; i < dict.length && depth > 0; i++) {
      if (dict[i] === '\\') { i++; continue; }
      if (dict[i] === '(') depth++;
      else if (dict[i] === ')') depth--;
    }
    return pdfLiteral(dict.slice(start, i - 1)).trim() || null;
  }
  const hex = new RegExp(`/${key}\\s*<([0-9A-Fa-f\\s]*)>`).exec(dict);
  if (hex) {
    const b = Buffer.from(hex[1]!.replace(/\s+/g, ''), 'hex');
    return pdfLiteral(b.toString('latin1')).trim() || null;
  }
  return null;
}

function nameField(dict: string, key: string): string | null {
  const m = new RegExp(`/${key}\\s*/([^\\s/<>\\[\\]()]+)`).exec(dict);
  return m ? m[1]! : null;
}

/** PDF date `D:YYYYMMDDHHmmSSOHH'mm'` → ISO 8601, or null when it does not parse. */
export function pdfDateToIso(value: string | null): string | null {
  if (!value) return null;
  const m = /^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?'?/.exec(value.trim());
  if (!m) return null;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00', tz, th = '00', tm = '00'] = m;
  const offset = !tz || tz === 'Z' || tz === 'z' ? 'Z' : `${tz}${th}:${tm}`;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** An all-zero /ByteRange is an unsigned signature field's placeholder, not a signature. */
const isPlaceholder = (m: RegExpMatchArray) => m[2] === '0' && m[3] === '0' && m[4] === '0';

/**
 * What an incremental update appended. Object types are read from `/Type /X` declarations; a
 * signature revision normally adds a Sig dictionary, a signature field (an Annot with /FT /Sig),
 * an updated AcroForm and catalog, and an xref. Anything else is a change of content.
 *
 * A later signature counts only when its /ByteRange is not the all-zero placeholder, and validation
 * data only when an updated Catalog names a /DSS or the signed revision's /DSS is rewritten; an
 * object the signed revision already had, rewritten as anything but what scanAppendedObjects allows,
 * is a change whatever else the update holds (secaudit2026oct31w2 round 11).
 */
export function classifyAppended(text: string, from: number, objects: PdfObjects = new PdfObjects(text)): AppendedContent {
  const tail = text.slice(from);
  const types = new Set<string>();
  for (const m of tail.matchAll(/\/Type\s*\/([A-Za-z]+)/g)) types.add(m[1]!);
  const laterSignatures = [...tail.matchAll(BYTE_RANGE_RE)].filter((m) => !isPlaceholder(m)).length;
  const scan = scanAppendedObjects(text, from, objects, laterSignatures > 0);
  const validationData = scan.validationData;
  // A signature revision rewrites the catalog, the AcroForm, the page carrying the widget, and adds
  // the widget annotation, an appearance XObject and the xref. Those are expected around a later
  // signature; new pages, content streams or annotations of other kinds are not.
  const expected = new Set(['Sig', 'DocTimeStamp', 'Catalog', 'XRef', 'DSS', 'VRI', 'Annot', 'XObject', 'Font', 'FontDescriptor', 'AcroForm', 'Page', 'Metadata', 'ObjStm', 'OCG', 'OCProperties']);
  const unusual = [...types].filter((t) => !expected.has(t));
  const annotsNotWidgets = /\/Subtype\s*\/(?!Widget\b)(Text|FreeText|Link|Ink|Square|Circle|Line|Polygon|PolyLine|Highlight|Underline|StrikeOut|Stamp|FileAttachment|Popup)\b/.test(tail);
  // A page object without a later signature to explain it is a changed or added page.
  const pageWithoutSignature = types.has('Page') && laterSignatures === 0;
  return {
    bytes: text.length - from,
    laterSignatures,
    validationData,
    otherChanges: unusual.length > 0 || annotsNotWidgets || pageWithoutSignature
      || scan.rewritten
      // An update that only validation data explains holds only validation data.
      || (laterSignatures === 0 && validationData && (scan.notValidationData || scan.unreadable))
      || (laterSignatures === 0 && !validationData && /\bobj\b/.test(tail)),
    types: [...types].sort(),
  };
}

/** Object types a validation-data update (PAdES-B-LT, no later signature) writes. */
const VALIDATION_TYPES = new Set(['Catalog', 'DSS', 'VRI', 'XRef', 'ObjStm', 'Metadata', 'Extensions', 'DeveloperExtensions']);
/** Catalog entries a validation-data update may change; every other entry stays as signed. */
const VALIDATION_CATALOG_KEYS = new Set(['DSS', 'Extensions', 'Metadata']);
/** What a later signature's revision may rewrite in place: the form, its pages and annotations. */
const SIGNATURE_REWRITES = new Set(['catalog', 'page', 'annot', 'acroform', 'refs', 'sig', 'metadata', 'dss']);

type Kind = 'catalog' | 'page' | 'annot' | 'acroform' | 'refs' | 'sig' | 'metadata' | 'dss' | 'other';

function kindOf(v: PdfValue | null | undefined): Kind {
  const t = typeOf(v);
  if (t === 'Catalog') return 'catalog';
  if (t === 'Page' || t === 'Pages') return 'page';
  if (t === 'Annot') return 'annot';
  if (t === 'AcroForm') return 'acroform';
  if (t === 'Sig' || t === 'DocTimeStamp') return 'sig';
  if (t === 'Metadata') return 'metadata';
  if (t === 'DSS' || t === 'VRI') return 'dss';
  if (!t && v?.k === 'dict') {
    const sub = v.entries.get('Subtype');
    if (v.entries.has('FT') || (sub?.k === 'name' && sub.v === 'Widget')) return 'annot';
    if (v.entries.has('Fields')) return 'acroform';
  }
  if (v?.k === 'array' && v.items.every((i) => i.k === 'ref')) return 'refs';
  return 'other';
}

/** Does `after` keep every entry of the signed Catalog `before` except the validation-data ones? */
function catalogKeepsSigned(before: PdfValue | null | undefined, after: PdfValue | null): boolean {
  if (before?.k !== 'dict' || after?.k !== 'dict') return false;
  for (const key of new Set([...before.entries.keys(), ...after.entries.keys()])) {
    if (VALIDATION_CATALOG_KEYS.has(key)) continue;
    if (canonical(before.entries.get(key)) !== canonical(after.entries.get(key))) return false;
  }
  return true;
}

/** A new object a validation-data update may write: its typed objects, and untyped data such as certificates. */
function fitsValidationData(v: PdfValue | null): boolean {
  const t = typeOf(v);
  if (t) return VALIDATION_TYPES.has(t);
  if (v?.k !== 'dict') return true;
  const sub = v.entries.get('Subtype');
  return !v.entries.has('FT') && (!sub || (sub.k === 'name' && sub.v === 'XML'));
}

/**
 * Every object number the signed revision reaches from `root` through dictionaries and arrays,
 * bounded. Read in the signed revision only, so an update cannot widen it by naming an object.
 */
function signedReach(objects: PdfObjects, from: number, root: number | null): Set<number> {
  const seen = new Set<number>();
  const queue = root === null ? [] : [root];
  const visit = (v: PdfValue | null | undefined, depth: number): void => {
    if (!v || depth > 8) return;
    if (v.k === 'ref') { if (!seen.has(v.num)) queue.push(v.num); return; }
    if (v.k === 'dict') for (const x of v.entries.values()) visit(x, depth + 1);
    if (v.k === 'array') for (const x of v.items) visit(x, depth + 1);
  };
  while (queue.length && seen.size < 4096) {
    const n = queue.shift()!;
    if (seen.has(n)) continue;
    seen.add(n);
    visit(objects.valueBefore(n, from), 0);
  }
  return seen;
}

/**
 * The object-level read of an update: whether it carries validation data, whether it rewrites an
 * object the signed revision had as something no signature or validation revision writes, and,
 * for an update that no later signature explains, whether it writes anything but validation data.
 */
function scanAppendedObjects(text: string, from: number, objects: PdfObjects, signatureRevision: boolean) {
  const { objects: added, unreadable } = objects.appendedAfter(from);
  const signedText = text.slice(0, from);
  const lastRef = (key: string): number | null => {
    let n: number | null = null;
    for (const m of signedText.matchAll(new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R\\b`, 'g'))) n = Number(m[1]);
    return n;
  };
  const rootNum = lastRef('Root');
  const signedCatalog = rootNum === null ? undefined : objects.valueBefore(rootNum, from);
  const signedDss = topLevelRef(signedCatalog, 'DSS');
  const infoNum = lastRef('Info');
  const named = new Set([topLevelRef(signedCatalog, 'AcroForm'), topLevelRef(signedCatalog, 'Metadata')].filter((n): n is number => n !== null));

  const latest = new Map<number, PdfValue | null>();
  for (const o of added) latest.set(o.num, o.value);
  const catalogs = added.filter((o) => kindOf(o.value) === 'catalog');
  const validationData = catalogs.some((c) => c.value?.k === 'dict' && c.value.entries.has('DSS'))
    || (signedDss !== null && latest.has(signedDss));
  // A later validation round rewrites the signed revision's DSS and what it holds, and nothing else.
  const validationObjects = signedReach(objects, from, signedDss);

  let rewritten = false;
  let notValidationData = false;
  for (const o of added) {
    const before = objects.valueBefore(o.num, from);
    const kind = kindOf(o.value);
    if (!signatureRevision && kind === 'catalog' && !catalogKeepsSigned(signedCatalog, o.value)) notValidationData = true;
    if (before === undefined) {
      if (!signatureRevision && !fitsValidationData(o.value)) notValidationData = true;
      continue;
    }
    // A rewrite of an object the signed revision had.
    if (validationObjects.has(o.num)) continue;
    if (o.num === infoNum && o.value?.k === 'dict' && !typeOf(o.value)) continue;
    if (kind === 'metadata' && kindOf(before) === 'metadata') continue;
    if (kind === 'catalog' && kindOf(before) === 'catalog' && (signatureRevision || catalogKeepsSigned(before, o.value))) continue;
    if (signatureRevision && named.has(o.num) && o.value?.k === 'dict') continue;
    if (signatureRevision && kind === kindOf(before) && SIGNATURE_REWRITES.has(kind)) continue;
    rewritten = true;
  }
  return { validationData, rewritten, notValidationData, unreadable };
}

/**
 * Every signature in the file, in file order. Throws PdfExtractError for a file that is not a PDF;
 * a PDF with no signatures returns an empty list.
 */
export function extractPdfSignatures(pdf: Buffer, opts: { maxFields?: number } = {}): PdfSignatureField[] {
  if (pdf.length < 8 || pdf.subarray(0, 1024).indexOf('%PDF-') < 0) {
    throw new PdfExtractError('NOT_A_PDF', 'The file is not a PDF (no %PDF- header).');
  }
  const text = asText(pdf);
  // Each field is checked on its own, so the count is bounded before any of them is read
  // (docsign.max_signatures; 0 or absent is no limit; secaudit2026oct26).
  const max = opts.maxFields ?? 0;
  if (max > 0) {
    const distinct = new Set<string>();
    for (const m of text.matchAll(BYTE_RANGE_RE)) {
      if (m[2] === '0' && m[3] === '0' && m[4] === '0') continue;
      distinct.add(`${m[1]},${m[2]},${m[3]},${m[4]}`);
      if (distinct.size > max) {
        throw new PdfExtractError('TOO_MANY_SIGNATURES',
          `The file has more than ${max} signatures, and this node checks at most ${max} in one file. The operator sets the number with the setting docsign.max_signatures.`);
      }
    }
  }
  const out: PdfSignatureField[] = [];
  const seen = new Set<string>();
  // One object read per file, shared by every signature's classification.
  let objects: PdfObjects | null = null;
  for (const m of text.matchAll(BYTE_RANGE_RE)) {
    const br = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as [number, number, number, number];
    const key = br.join(',');
    if (seen.has(key)) continue; // the same field referenced twice
    seen.add(key);
    const [a, b, c, d] = br;
    // A placeholder (all zeros) is an unsigned signature field.
    if (b === 0 && c === 0 && d === 0) continue;
    if (a !== 0 || b <= 0 || c <= a + b || d < 0 || c + d > pdf.length) {
      out.push(malformed(out.length, br, pdf));
      continue;
    }
    const gap = text.slice(a + b, c);
    const hex = /^\s*<([0-9A-Fa-f\s]*)>\s*$/.exec(gap);
    if (!hex) { out.push(malformed(out.length, br, pdf)); continue; }
    let cms = Buffer.from(hex[1]!.replace(/\s+/g, ''), 'hex');
    const len = derLength(cms);
    if (len && len <= cms.length) cms = cms.subarray(0, len);
    const dict = enclosingDictionary(text, m.index!, a + b, c);
    const coversWholeFile = c + d === pdf.length;
    out.push({
      index: out.length,
      byteRange: br,
      cms,
      // Made when read, not held: a held copy per field made memory grow with fields x file size.
      get signedBytes() { return Buffer.concat([pdf.subarray(a, a + b), pdf.subarray(c, c + d)]); },
      subFilter: nameField(dict, 'SubFilter'),
      isDocTimestamp: nameField(dict, 'Type') === 'DocTimeStamp' || nameField(dict, 'SubFilter') === 'ETSI.RFC3161',
      claimedSigningTime: pdfDateToIso(stringField(dict, 'M')),
      name: stringField(dict, 'Name'),
      reason: stringField(dict, 'Reason'),
      location: stringField(dict, 'Location'),
      contactInfo: stringField(dict, 'ContactInfo'),
      coversWholeFile,
      appended: coversWholeFile ? null : classifyAppended(text, c + d, objects ??= new PdfObjects(text)),
    });
  }
  return out;
}

/** A ByteRange that names spans outside the file or out of order: reported, never verified. */
function malformed(index: number, br: [number, number, number, number], pdf: Buffer): PdfSignatureField {
  return {
    index, byteRange: br, cms: Buffer.alloc(0), signedBytes: Buffer.alloc(0),
    subFilter: null, isDocTimestamp: false, claimedSigningTime: null, name: null, reason: null,
    location: null, contactInfo: null,
    coversWholeFile: br[2] + br[3] === pdf.length, appended: null,
  };
}
