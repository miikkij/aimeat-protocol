/**
 * @file src/services/docsign/pdf-objects.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reads PDF objects for pdf-extract.ts, so that it can tell validation data and a later
 *   signature's revision from a change of what the document shows: the objects an incremental update
 *   defines (written out, or inside a FlateDecode object stream), and the value an object number had
 *   in the revision a signature covers.
 *
 *   NOT A PDF PARSER. It reads one PDF value at the start of an object (the dictionary of a stream,
 *   or the array or dictionary the object is), skips strings and comments, and does not follow
 *   cross-reference tables. Each read stops where the next object starts, so the work stays linear in
 *   the file size whatever the file holds, and object streams are inflated under one ceiling per
 *   file. An object stream it cannot read (another filter, decode parameters, past the ceiling) is
 *   reported as unreadable, and the caller decides what that means.
 * @structure PdfValue · parseValue · typeOf · topLevelRef · canonical · AppendedObject · PdfObjects
 *   (valueBefore, appendedAfter) · OBJSTM_INFLATE_MAX_BYTES
 * @usage const objects = new PdfObjects(text); const { objects: added } = objects.appendedAfter(from);
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial: the object-level read behind classifyAppended
 *     (secaudit2026oct31w2 round 11).
 */
import { inflateSync } from 'node:zlib';
import { logger } from '../../utils/logger.js';

export type PdfValue =
  | { k: 'dict'; entries: Map<string, PdfValue> }
  | { k: 'array'; items: PdfValue[] }
  | { k: 'name'; v: string }
  | { k: 'ref'; num: number }
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'word'; v: string };

const MAX_DEPTH = 32;
/** The most the object streams of one file may inflate to, in total. */
export const OBJSTM_INFLATE_MAX_BYTES = 32 * 1024 * 1024;

const isWs = (c: string | undefined) => c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\f' || c === '\0';
const isDelim = (c: string | undefined) => c === '(' || c === ')' || c === '<' || c === '>' || c === '[' || c === ']' || c === '{' || c === '}' || c === '/' || c === '%';

/** Skip whitespace and comments, not past `limit`. */
function skip(s: string, i: number, limit: number): number {
  while (i < limit) {
    const c = s[i];
    if (isWs(c)) { i++; continue; }
    if (c === '%') { while (i < limit && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
    break;
  }
  return i;
}

function regular(s: string, i: number, limit: number): number {
  while (i < limit && !isWs(s[i]) && !isDelim(s[i])) i++;
  return i;
}

/**
 * One PDF value starting at `i`, read no further than `limit`, or null when the text there is not
 * one. A number followed by `g R` is a reference.
 */
export function parseValue(s: string, i: number, limit = s.length, depth = 0): { value: PdfValue; end: number } | null {
  if (depth > MAX_DEPTH) return null;
  limit = Math.min(limit, s.length);
  i = skip(s, i, limit);
  if (i >= limit) return null;
  const c = s[i];
  if (c === '<' && s[i + 1] === '<') {
    const entries = new Map<string, PdfValue>();
    i += 2;
    for (;;) {
      i = skip(s, i, limit);
      if (i + 1 < limit && s[i] === '>' && s[i + 1] === '>') return { value: { k: 'dict', entries }, end: i + 2 };
      if (i >= limit || s[i] !== '/') return null;
      const keyEnd = regular(s, i + 1, limit);
      const v = parseValue(s, keyEnd, limit, depth + 1);
      if (!v) return null;
      entries.set(s.slice(i + 1, keyEnd), v.value);
      i = v.end;
    }
  }
  if (c === '[') {
    const items: PdfValue[] = [];
    i++;
    for (;;) {
      i = skip(s, i, limit);
      if (i < limit && s[i] === ']') return { value: { k: 'array', items }, end: i + 1 };
      const v = parseValue(s, i, limit, depth + 1);
      if (!v) return null;
      items.push(v.value);
      i = v.end;
    }
  }
  if (c === '/') {
    const end = regular(s, i + 1, limit);
    return { value: { k: 'name', v: s.slice(i + 1, end) }, end };
  }
  if (c === '(') {
    let d = 1;
    let j = i + 1;
    for (; j < limit && d > 0; j++) {
      if (s[j] === '\\') { j++; continue; }
      if (s[j] === '(') d++;
      else if (s[j] === ')') d--;
    }
    if (d > 0) return null;
    return { value: { k: 'str', v: s.slice(i + 1, j - 1) }, end: j };
  }
  if (c === '<') {
    let j = i + 1;
    while (j < limit && s[j] !== '>') j++;
    if (j >= limit) return null;
    return { value: { k: 'str', v: s.slice(i + 1, j) }, end: j + 1 };
  }
  const end = regular(s, i, limit);
  if (end === i) return null;
  const word = s.slice(i, end);
  if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
    const ref = /^\s+\d+\s+R(?![^\s/<>[\]()%])/.exec(s.slice(end, Math.min(limit, end + 32)));
    if (/^\d+$/.test(word) && ref) return { value: { k: 'ref', num: Number(word) }, end: end + ref[0].length };
    return { value: { k: 'num', v: Number(word) }, end };
  }
  return { value: { k: 'word', v: word }, end };
}

export function typeOf(v: PdfValue | null | undefined): string | null {
  if (v?.k !== 'dict') return null;
  const t = v.entries.get('Type');
  return t?.k === 'name' ? t.v : null;
}

export function topLevelRef(v: PdfValue | null | undefined, key: string): number | null {
  if (v?.k !== 'dict') return null;
  const r = v.entries.get(key);
  return r?.k === 'ref' ? r.num : null;
}

/** A value written one way, so two dictionaries with the same entries compare equal. */
export function canonical(v: PdfValue | null | undefined): string {
  if (!v) return '';
  switch (v.k) {
    case 'dict': return `<<${[...v.entries.keys()].sort().map((k) => `/${k} ${canonical(v.entries.get(k))}`).join(' ')}>>`;
    case 'array': return `[${v.items.map(canonical).join(' ')}]`;
    case 'name': return `/${v.v}`;
    case 'ref': return `${v.num} R`;
    case 'num': return String(v.v);
    case 'str': return `(${v.v})`;
    case 'word': return v.v;
  }
}

export interface AppendedObject {
  num: number;
  value: PdfValue | null;
  /** Read from inside an object stream. */
  packed: boolean;
}

const OBJ_RE = /(?<![\d.])(\d+)\s+(\d+)\s+obj\b/g;

/** The objects of one PDF file, read on demand. One instance per file; every signature shares it. */
export class PdfObjects {
  /** Object number to the positions its written-out definitions start at, ascending. */
  private readonly at = new Map<number, number[]>();
  /** Every written-out definition's start, ascending: a read stops at the next one. */
  private readonly starts: number[] = [];
  /** Object stream position to its objects, or null when it could not be read. */
  private readonly streams = new Map<number, Map<number, PdfValue | null> | null>();
  private streamPositions: number[] | null = null;
  private budget = OBJSTM_INFLATE_MAX_BYTES;
  private readonly before = new Map<string, PdfValue | null | undefined>();
  private packed: Map<number, number[]> | null = null;

  constructor(private readonly text: string) {
    for (const m of text.matchAll(OBJ_RE)) {
      const pos = m.index! + m[0].length;
      this.starts.push(pos);
      const n = Number(m[1]);
      const list = this.at.get(n);
      if (list) list.push(pos); else this.at.set(n, [pos]);
    }
  }

  /** Where the definition after `pos` starts, or the end of the text. */
  private nextStart(pos: number): number {
    let lo = 0;
    let hi = this.starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.starts[mid]! <= pos) lo = mid + 1; else hi = mid;
    }
    return lo < this.starts.length ? this.starts[lo]! : this.text.length;
  }

  private read(pos: number): { value: PdfValue; end: number } | null {
    return parseValue(this.text, pos, this.nextStart(pos));
  }

  /** The start of the definition `pos` lies in, or -1. */
  private startBefore(pos: number): number {
    let lo = 0;
    let hi = this.starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.starts[mid]! <= pos) lo = mid + 1; else hi = mid;
    }
    return lo > 0 ? this.starts[lo - 1]! : -1;
  }

  /** The positions of the written-out object streams, found once. */
  private objectStreams(): number[] {
    if (this.streamPositions) return this.streamPositions;
    const checked = new Set<number>();
    const found: number[] = [];
    for (const m of this.text.matchAll(/\/Type\s*\/ObjStm\b/g)) {
      const owner = this.startBefore(m.index!);
      if (owner < 0 || checked.has(owner)) continue;
      checked.add(owner);
      if (typeOf(this.read(owner)?.value) === 'ObjStm') found.push(owner);
    }
    this.streamPositions = found.sort((a, b) => a - b);
    return this.streamPositions;
  }

  /** Object number to the positions of the readable object streams that hold it, ascending; built once. */
  private packedAt(): Map<number, number[]> {
    if (this.packed) return this.packed;
    this.packed = new Map();
    for (const p of this.objectStreams()) {
      for (const num of this.unpack(p)?.keys() ?? []) {
        const list = this.packed.get(num);
        if (list) list.push(p); else this.packed.set(num, [p]);
      }
    }
    return this.packed;
  }

  /** The objects of the object stream at `pos` (ISO 32000-1 7.5.7), or null when it cannot be read here. */
  private unpack(pos: number): Map<number, PdfValue | null> | null {
    if (this.streams.has(pos)) return this.streams.get(pos)!;
    const out = this.inflateStream(pos);
    this.streams.set(pos, out);
    return out;
  }

  private inflateStream(pos: number): Map<number, PdfValue | null> | null {
    const parsed = this.read(pos);
    const dict = parsed?.value;
    if (!parsed || dict?.k !== 'dict') return null;
    const filter = dict.entries.get('Filter');
    const only = filter?.k === 'array' && filter.items.length === 1 ? filter.items[0] : filter;
    const length = dict.entries.get('Length');
    const n = dict.entries.get('N');
    const first = dict.entries.get('First');
    if (only?.k !== 'name' || only.v !== 'FlateDecode' || dict.entries.has('DecodeParms')) return null;
    if (length?.k !== 'num' || n?.k !== 'num' || first?.k !== 'num' || this.budget <= 0) return null;
    const head = /^\s*stream\r?\n/.exec(this.text.slice(parsed.end, parsed.end + 64));
    if (!head) return null;
    const start = parsed.end + head[0].length;
    if (length.v < 0 || start + length.v > this.nextStart(pos)) return null;
    let raw: Buffer;
    try {
      raw = inflateSync(Buffer.from(this.text.slice(start, start + length.v), 'latin1'), { maxOutputLength: this.budget });
    } catch (err) {
      // Unreadable is an answer the caller weighs (a change in an update only validation data
      // explains), not "nothing here". Debug level: a hostile file can hold many such streams.
      logger.debug?.('docsign: an object stream did not inflate within the ceiling', { error: String(err) });
      return null;
    }
    this.budget -= raw.length;
    const body = raw.toString('latin1');
    const pairs = body.slice(0, first.v).trim().split(/\s+/).map(Number);
    if (pairs.length !== n.v * 2 || pairs.some((x) => !Number.isInteger(x) || x < 0)) return null;
    const objects = new Map<number, PdfValue | null>();
    for (let i = 0; i < n.v; i++) {
      const at = first.v + pairs[2 * i + 1]!;
      if (at > body.length) return null;
      const next = i + 1 < n.v ? first.v + pairs[2 * i + 3]! : body.length;
      objects.set(pairs[2 * i]!, parseValue(body, at, next > at ? next : body.length)?.value ?? null);
    }
    return objects;
  }

  /**
   * The value object `num` had in the first `limit` bytes (the revision a signature covers): its
   * last definition there, written out or packed. `undefined` when it had none; null when it had one
   * that could not be read.
   */
  valueBefore(num: number, limit: number): PdfValue | null | undefined {
    // Remembered per number and limit: an update may name one number many times.
    const key = `${num}:${limit}`;
    if (this.before.has(key)) return this.before.get(key);
    const value = this.findBefore(num, limit);
    this.before.set(key, value);
    return value;
  }

  private findBefore(num: number, limit: number): PdfValue | null | undefined {
    let best = -1;
    let value: PdfValue | null | undefined;
    for (const p of this.at.get(num) ?? []) {
      if (p > limit) break;
      best = p;
      value = undefined;
    }
    for (const p of this.packedAt().get(num) ?? []) {
      if (p > limit) break;
      if (p < best) continue;
      best = p;
      value = this.unpack(p)!.get(num)!;
    }
    if (best < 0) return undefined;
    if (value !== undefined) return value;
    return parseValue(this.text, best, Math.min(limit, this.nextStart(best)))?.value ?? null;
  }

  /** Whether object `num` had a definition in the first `limit` bytes, written out or packed. */
  definedBefore(num: number, limit: number): boolean {
    return this.valueBefore(num, limit) !== undefined;
  }

  /** The objects written after byte `from`, those inside readable object streams included. */
  appendedAfter(from: number): { objects: AppendedObject[]; unreadable: boolean } {
    const objects: AppendedObject[] = [];
    let unreadable = false;
    const order = [...this.at].flatMap(([num, list]) => list.filter((p) => p > from).map((p) => [p, num] as const)).sort((a, b) => a[0] - b[0]);
    for (const [pos, num] of order) {
      const value = this.read(pos)?.value ?? null;
      objects.push({ num, value, packed: false });
      if (typeOf(value) !== 'ObjStm') continue;
      const inner = this.unpack(pos);
      if (!inner) { unreadable = true; continue; }
      for (const [n, v] of inner) objects.push({ num: n, value: v, packed: true });
    }
    return { objects, unreadable };
  }
}
