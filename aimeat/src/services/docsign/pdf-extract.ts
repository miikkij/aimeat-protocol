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
 * @structure PdfSignatureField · extractPdfSignatures · classifyAppended
 * @usage const sigs = extractPdfSignatures(buffer);
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (wish-virallisen-dokumentin-allekirjoitus-ja-allekirjoituksen-tark).
 */

export interface PdfSignatureField {
  /** Zero-based position of this signature among the ones found, in file order. */
  index: number;
  byteRange: [number, number, number, number];
  /** The DER bytes of the CMS SignedData (or RFC 3161 token), trailing zero padding removed. */
  cms: Buffer;
  /** The bytes the signature covers: [a, a+b) followed by [c, c+d). */
  signedBytes: Buffer;
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

/**
 * What an incremental update appended. Object types are read from `/Type /X` declarations; a
 * signature revision normally adds a Sig dictionary, a signature field (an Annot with /FT /Sig),
 * an updated AcroForm and catalog, and an xref. Anything else is a change of content.
 */
export function classifyAppended(text: string, from: number): AppendedContent {
  const tail = text.slice(from);
  const types = new Set<string>();
  for (const m of tail.matchAll(/\/Type\s*\/([A-Za-z]+)/g)) types.add(m[1]!);
  const laterSignatures = [...tail.matchAll(BYTE_RANGE_RE)].length;
  const validationData = /\/DSS\b/.test(tail) || types.has('DSS');
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
      || (laterSignatures === 0 && !validationData && /\bobj\b/.test(tail)),
    types: [...types].sort(),
  };
}

/**
 * Every signature in the file, in file order. Throws PdfExtractError for a file that is not a PDF;
 * a PDF with no signatures returns an empty list.
 */
export function extractPdfSignatures(pdf: Buffer): PdfSignatureField[] {
  if (pdf.length < 8 || pdf.subarray(0, 1024).indexOf('%PDF-') < 0) {
    throw new PdfExtractError('NOT_A_PDF', 'The file is not a PDF (no %PDF- header).');
  }
  const text = asText(pdf);
  const out: PdfSignatureField[] = [];
  const seen = new Set<string>();
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
    const signedBytes = Buffer.concat([pdf.subarray(a, a + b), pdf.subarray(c, c + d)]);
    const coversWholeFile = c + d === pdf.length;
    out.push({
      index: out.length,
      byteRange: br,
      cms,
      signedBytes,
      subFilter: nameField(dict, 'SubFilter'),
      isDocTimestamp: nameField(dict, 'Type') === 'DocTimeStamp' || nameField(dict, 'SubFilter') === 'ETSI.RFC3161',
      claimedSigningTime: pdfDateToIso(stringField(dict, 'M')),
      name: stringField(dict, 'Name'),
      reason: stringField(dict, 'Reason'),
      location: stringField(dict, 'Location'),
      contactInfo: stringField(dict, 'ContactInfo'),
      coversWholeFile,
      appended: coversWholeFile ? null : classifyAppended(text, c + d),
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
