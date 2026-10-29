/**
 * @file src/services/file-text/pdf-budget.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How much a PDF's streams decode to, measured before pdf.js reads the file. pdf.js
 *   decodes a stream fully in the node process with no size limit, so a small PDF whose content
 *   stream is a compressed run of one byte can grow to gigabytes. This scan reads each stream's own
 *   dictionary, takes its filter chain as pdf.js does (a name, an array, or either one named by an
 *   indirect object), and counts what the chain decodes to for text and metadata (not pictures, not
 *   attached files) without keeping the last filter's output, stopping as soon as the total passes the
 *   budget (pdf-filters.ts). A stream keyword followed by CR alone starts a stream, as it does for
 *   pdf.js. A dictionary the reader cannot parse is measured by the filter names its text holds.
 *
 *   NOT MEASURED. An encrypted document's streams are ciphertext until pdf.js decrypts them with the
 *   empty user password; this scan does not decrypt, so what such a stream decodes to is counted only
 *   as far as its bytes decode as they are. pdfDecodeMeasure says so: such a document, and one with
 *   a stream the scan could not count to its end, is `unmeasured`, and its text is read under a time
 *   and a memory limit (pdf-bounded.ts) instead of in this process.
 * @structure PDF_DECODE_BUDGET · PdfMeasure · pdfDecodeMeasure(bytes, budget) · pdfDecodesWithin(bytes, budget)
 * @usage const m = await pdfDecodeMeasure(bytes);   // 'within' | 'over' | 'unmeasured'
 * @version-history
 *   v1.2.0 — 2026-10-29 — pdfDecodeMeasure: within, over, or unmeasured (an encrypted document, a
 *     filter name it does not know, a stream that did not decode to its end, a dictionary or filter
 *     object it could not read). pdfDecodesWithin answers as before (secaudit2026oct26 round 8c,
 *     memory-b-09).
 *   v1.1.0 — 2026-10-27 — Each stream's own dictionary is parsed (a nested dictionary after /Filter, an
 *     indirect /Filter, a filter array), every filter pdf.js decodes for text is counted (Flate, LZW,
 *     RunLength, ASCIIHex, ASCII85, Brotli, in chains), and CR alone after `stream` starts a stream
 *     (secaudit2026oct26, pdf-budget.ts:pdfDecodesWithin:filter-detection-bypass).
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, pdf.js decoded size on arrival).
 */
import { decodeMeasure, normaliseFilter, type PdfFilter } from './pdf-filters.js';
import { logger } from '../../utils/logger.js';

/** What the text and metadata streams of one PDF may decode to in all. */
export const PDF_DECODE_BUDGET = 256 * 1024 * 1024;

/** How far back from `stream` the stream's object header is looked for. */
const DICT_LOOKBACK = 64 * 1024;

// ─── A small PDF object reader: just enough to read one stream's dictionary ───

type PdfValue = number | boolean | null | { name: string } | { ref: [number, number] } | { str: true } | PdfValue[] | PdfDict;
interface PdfDict { dict: Map<string, PdfValue> }

const isWhite = (c: number) => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00;
const isDelim = (c: number) => c === 0x28 || c === 0x29 || c === 0x3c || c === 0x3e || c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d || c === 0x2f || c === 0x25;

class Reader {
  constructor(private readonly s: string, public i = 0) {}
  private c(o = 0): number { return this.s.charCodeAt(this.i + o); }
  skip(): void {
    while (this.i < this.s.length) {
      const c = this.c();
      if (isWhite(c)) { this.i++; continue; }
      if (c === 0x25) { while (this.i < this.s.length && this.c() !== 0x0a && this.c() !== 0x0d) this.i++; continue; }
      break;
    }
  }
  private token(): string {
    const start = this.i;
    while (this.i < this.s.length && !isWhite(this.c()) && !isDelim(this.c())) this.i++;
    return this.s.slice(start, this.i);
  }
  value(depth = 0): PdfValue {
    if (depth > 64) throw new Error('nested too deep');
    this.skip();
    const c = this.c();
    if (this.i >= this.s.length) throw new Error('end of text');
    if (c === 0x3c && this.c(1) === 0x3c) {
      this.i += 2;
      const dict = new Map<string, PdfValue>();
      for (;;) {
        this.skip();
        if (this.c() === 0x3e && this.c(1) === 0x3e) { this.i += 2; return { dict }; }
        const key = this.value(depth + 1);
        if (!key || typeof key !== 'object' || !('name' in key)) throw new Error('a dictionary key is not a name');
        dict.set(key.name, this.value(depth + 1));
      }
    }
    if (c === 0x5b) {
      this.i++;
      const arr: PdfValue[] = [];
      for (;;) {
        this.skip();
        if (this.c() === 0x5d) { this.i++; return arr; }
        arr.push(this.value(depth + 1));
      }
    }
    if (c === 0x28) {
      this.i++;
      let nest = 1;
      while (this.i < this.s.length && nest > 0) {
        const d = this.c();
        if (d === 0x5c) this.i += 2;
        else { if (d === 0x28) nest++; else if (d === 0x29) nest--; this.i++; }
      }
      if (nest > 0) throw new Error('an open string');
      return { str: true };
    }
    if (c === 0x3c) {
      const end = this.s.indexOf('>', this.i);
      if (end < 0) throw new Error('an open hex string');
      this.i = end + 1;
      return { str: true };
    }
    if (c === 0x2f) { this.i++; return { name: this.token() }; }
    const tok = this.token();
    if (!tok) throw new Error(`an unexpected character ${String.fromCharCode(c)}`);
    if (tok === 'true' || tok === 'false') return tok === 'true';
    if (tok === 'null') return null;
    const n = Number(tok);
    if (!Number.isFinite(n)) throw new Error(`an unknown word ${tok}`);
    // `N G R` is a reference to an object.
    const back = this.i;
    this.skip();
    const g = this.token();
    if (/^\d+$/.test(g) && /^\d+$/.test(tok)) {
      this.skip();
      if (this.token() === 'R') return { ref: [n, Number(g)] };
    }
    this.i = back;
    return n;
  }
}

const isDict = (v: PdfValue | undefined): v is PdfDict => !!v && typeof v === 'object' && 'dict' in v;
const nameOf = (v: PdfValue | undefined): string | null => (v && typeof v === 'object' && 'name' in v ? v.name : null);

/** Reads indirect objects of one file: the file's text is made once, and each object is looked up once. */
class Objects {
  private text: string | null = null;
  private readonly seen = new Map<string, PdfValue | undefined>();
  constructor(private readonly bytes: Buffer) {}
  get(ref: [number, number]): PdfValue | undefined {
    const id = ref.join(' ');
    if (!this.seen.has(id)) {
      this.text ??= this.bytes.toString('latin1');
      this.seen.set(id, objectValue(this.text, ref));
    }
    return this.seen.get(id);
  }
}

/** The value of indirect object `n g`, or undefined when it is not found or does not read. */
function objectValue(text: string, ref: [number, number]): PdfValue | undefined {
  const head = new RegExp(`(?:^|[^0-9])${ref[0]}\\s+${ref[1]}\\s+obj\\b`, 'g');
  const m = head.exec(text);
  if (!m) return undefined;
  try {
    return new Reader(text.slice(m.index + m[0].length, m.index + m[0].length + 4096)).value();
  } catch (err) {
    // The filter then counts as named by nothing, which pdf.js would not decode either.
    logger.debug('pdf-budget: an indirect filter object did not read', { ref: ref.join(' '), error: String(err) });
    return undefined;
  }
}

/** The stream's own dictionary, read from its object header to the `stream` keyword, or null. */
function streamDict(bytes: Buffer, kw: number): PdfDict | null {
  const from = Math.max(0, kw - DICT_LOOKBACK);
  const window = bytes.toString('latin1', from, kw);
  const heads = [...window.matchAll(/\d+\s+\d+\s+obj\b/g)];
  // The nearest header first; one inside a string of the dictionary does not read up to the keyword.
  for (const h of heads.reverse().slice(0, 4)) {
    const r = new Reader(window, h.index! + h[0].length);
    try {
      const v = r.value();
      r.skip();
      if (isDict(v) && r.i >= window.length) return v;
    } catch (err) {
      // Not this header: try the one before it.
      logger.debug('pdf-budget: an object header did not read up to its stream', { error: String(err) });
    }
  }
  return null;
}

/** The stream's filter chain and its LZW EarlyChange, as pdf.js reads the dictionary. */
function filtersOf(objects: Objects, dict: PdfDict): { filters: PdfFilter[]; earlyChange: number } {
  let f = dict.dict.get('Filter') ?? dict.dict.get('F');
  if (f && typeof f === 'object' && 'ref' in f) f = objects.get(f.ref);
  const names = Array.isArray(f) ? f.map(x => (x && typeof x === 'object' && 'ref' in x ? nameOf(objects.get(x.ref)) : nameOf(x))) : [nameOf(f)];
  const filters = names.filter((n): n is string => !!n).map(normaliseFilter);
  const params = dict.dict.get('DecodeParms') ?? dict.dict.get('DP');
  const list = Array.isArray(params) ? params : [params];
  const early = list.map(p => (isDict(p) ? p.dict.get('EarlyChange') : undefined)).find(v => typeof v === 'number');
  return { filters, earlyChange: early === 0 ? 0 : 1 };
}

/** A dictionary the reader could not parse: the filter names its text holds, in order. */
function filtersByText(bytes: Buffer, kw: number): PdfFilter[] {
  const text = bytes.toString('latin1', Math.max(0, kw - 4096), kw);
  const open = text.lastIndexOf('obj');
  const names = [...text.slice(open >= 0 ? open : 0).matchAll(/\/(FlateDecode|Fl|LZWDecode|LZW|RunLengthDecode|RL|ASCIIHexDecode|AHx|ASCII85Decode|A85|BrotliDecode)\b/g)].map(m => m[1]!);
  return names.map(normaliseFilter);
}

/**
 * What the budget can say about a PDF: its text and metadata streams decode `within` the budget, go
 * `over` it, or are `unmeasured`: within as far as the scan counted, but the scan could not count
 * all of it (an encrypted document, a filter name it does not know, a picture filter on a text
 * stream, a stream that did not decode to its end, a dictionary or a filter object it could not
 * read, a stream with no end). `why` names the first such stream for the log.
 */
export interface PdfMeasure { verdict: 'within' | 'over' | 'unmeasured'; why?: string }

/** A trailer or cross-reference dictionary that names an encryption dictionary. */
function encrypted(bytes: Buffer): boolean {
  for (let at = bytes.indexOf('/Encrypt', 0, 'latin1'); at >= 0; at = bytes.indexOf('/Encrypt', at + 8, 'latin1')) {
    if (/^\/Encrypt\s*(\d+\s+\d+\s+R|<<)/.test(bytes.toString('latin1', at, at + 40))) return true;
  }
  return false;
}

/** How the text and metadata streams of `bytes` stand against `budget` (PdfMeasure). */
export async function pdfDecodeMeasure(bytes: Buffer, budget = PDF_DECODE_BUDGET): Promise<PdfMeasure> {
  let total = 0;
  let at = 0;
  let why: string | undefined = encrypted(bytes) ? 'the document is encrypted' : undefined;
  const answer = (): PdfMeasure => (why ? { verdict: 'unmeasured', why } : { verdict: 'within' });
  const objects = new Objects(bytes);
  for (;;) {
    const kw = bytes.indexOf('stream', at, 'latin1');
    if (kw < 0) return answer();
    at = kw + 6;
    // `endstream` also contains the word; only a `stream` keyword right after a dictionary starts one.
    if (kw >= 3 && bytes.toString('latin1', kw - 3, kw) === 'end') continue;
    let start = at;
    if (bytes[start] === 0x0d) start++;
    if (bytes[start] === 0x0a) start++;
    else if (bytes[start - 1] !== 0x0d) continue;
    // A dictionary closes right before the keyword.
    const before = bytes.toString('latin1', Math.max(0, kw - 64), kw).trimEnd();
    if (!before.endsWith('>>')) continue;
    const end = bytes.indexOf('endstream', start, 'latin1');
    if (end < 0) { why ??= `a stream at byte ${kw} has no end`; return answer(); }
    at = end + 9;
    const dict = streamDict(bytes, kw);
    let filters: PdfFilter[];
    let earlyChange = 1;
    if (dict) {
      // Pictures and attached files are not decoded to read text or metadata.
      if (nameOf(dict.dict.get('Subtype')) === 'Image' || nameOf(dict.dict.get('Type')) === 'EmbeddedFile') continue;
      ({ filters, earlyChange } = filtersOf(objects, dict));
      const named = dict.dict.get('Filter') ?? dict.dict.get('F');
      const count = named === undefined || named === null ? 0 : Array.isArray(named) ? named.length : 1;
      if (count > 0 && filters.length < count) why ??= `a filter of the stream at byte ${kw} did not read`;
    } else {
      const head = bytes.toString('latin1', Math.max(0, kw - 4096), kw);
      if (/\/Subtype\s*\/Image\b|\/Type\s*\/EmbeddedFile\b/.test(head.slice(head.lastIndexOf('obj') + 1))) continue;
      filters = filtersByText(bytes, kw);
      why ??= `the dictionary of the stream at byte ${kw} did not read`;
    }
    if (filters.length === 0) continue;
    const got = await decodeMeasure(bytes.subarray(start, end), filters, budget - total, earlyChange);
    total += got.length;
    if (total > budget) return { verdict: 'over' };
    if (!got.complete) why ??= `the stream at byte ${kw} did not decode to its end`;
  }
}

/** Whether the text and metadata streams of `bytes` decode to `budget` bytes or fewer, as far as the scan counts. */
export async function pdfDecodesWithin(bytes: Buffer, budget = PDF_DECODE_BUDGET): Promise<boolean> {
  return (await pdfDecodeMeasure(bytes, budget)).verdict !== 'over';
}
