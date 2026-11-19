/**
 * @file src/services/kyc/screening/match.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Name screening of one customer (a person or a legal entity) against parsed
 *   targeted-financial-sanctions lists (lists.ts), for customer due diligence under Regulation (EU)
 *   2024/1624 (AMLR). Pure: no I/O, no storage, no dependency beyond the standard library.
 *
 *   SCORING. Every subject name and alias is compared with every name of every entry of the same
 *   kind, after normaliseName (diacritics stripped, transliteration variants folded, punctuation
 *   dropped; for entities also the legal-form tokens):
 *   - equal normalised strings score 1 ("name exact");
 *   - the same token multiset in another order scores 0.97 ("name tokens reordered");
 *   - otherwise the Jaro-Winkler similarity of the sorted-token strings ("name similar 0.93").
 *   For a person with a birth date, an equal full date raises the score to at least 0.99 when the
 *   name already reached the threshold, and a birth year that matches none of the listed ones
 *   lowers it by 0.15. Only the best name pair per entry is kept, and only scores at or above the
 *   threshold (default 0.88) are returned. A hit is a candidate for a person to review, never a
 *   decision.
 *
 *   SPEED. A list is prepared once (normalised names, sorted tokens, a bitmask of the tokens' first
 *   letters) and the prepared form is cached by source and version in a module-level Map holding at
 *   most PREPARED_CACHE_MAX lists. A name pair is scored only when the two first-letter masks share
 *   at least half of the smaller mask's bits, which skips most of the list before Jaro-Winkler runs.
 * @structure Subject · Hit · ScreenOptions · LEGAL_FORM_TOKENS · normaliseName · jaroWinkler ·
 *   screen · _clearScreeningCache (test seam)
 * @usage const hits = screen({ kind: 'person', name: 'Ivan Petrovski', birthDate: '1971-04-12' }, [euList, unList]);
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial.
 */
import type { SanctionsEntry, SanctionsList, SanctionsSource } from './lists.js';

/** The customer being screened. */
export interface Subject {
  kind: 'person' | 'entity';
  name: string;
  aliases?: string[];
  /** YYYY or YYYY-MM-DD. Read only for persons. */
  birthDate?: string;
  /** ISO2 or a country name. Reported as a reason when a listed country equals it; not scored. */
  country?: string;
}

/** One candidate match of the subject against one list entry. */
export interface Hit {
  source: SanctionsSource;
  id: string;
  kind: 'person' | 'entity';
  /** The subject's name or alias that matched, as given. */
  matchedName: string;
  /** The entry's name that matched, as written in the list. */
  listedName: string;
  /** 0..1, rounded to three decimals. */
  score: number;
  /** Why the score is what it is, e.g. 'name exact', 'name similar 0.93', 'birth year differs'. */
  reasons: string[];
  programme: string;
}

/** Options for screen(). */
export interface ScreenOptions {
  /** The lowest score returned. Default DEFAULT_THRESHOLD. */
  threshold?: number;
}

/** The default lowest score returned by screen(). */
export const DEFAULT_THRESHOLD = 0.88;

/** Tokens dropped from entity names when legal forms are ignored. */
export const LEGAL_FORM_TOKENS: ReadonlySet<string> = new Set([
  'oy', 'ab', 'llc', 'ltd', 'gmbh', 'inc', 'oyj', 'sa', 'ag', 'bv', 'plc', 'co', 'company', 'corp',
  'limited', 'corporation', 'incorporated',
]);

/** Letters NFKD does not decompose into a base letter plus a combining mark. */
const FOLD: Readonly<Record<string, string>> = {
  'ß': 'ss', 'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'đ': 'd', 'ł': 'l', 'þ': 'th', 'ð': 'd', 'ı': 'i', 'ħ': 'h',
};
const FOLD_RE = /[ßøæœđłþðıħ]/g;

/**
 * Normalises a name for comparison: lowercase, folded transliteration variants, NFKD with the
 * combining marks removed, dots and apostrophes dropped, other punctuation turned into spaces, and
 * spaces collapsed. Non-Latin letters are kept as they are.
 * @param s The name as written.
 * @param opts dropLegalForms: remove LEGAL_FORM_TOKENS (for entity names). When that would leave
 *   nothing, the tokens are kept.
 */
export function normaliseName(s: string, opts?: { dropLegalForms?: boolean }): string {
  const base = s.toLowerCase()
    .replace(FOLD_RE, (c) => FOLD[c] ?? c)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[.'’`´ʼ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (!opts?.dropLegalForms) return base;
  const kept = base.split(' ').filter((t) => t && !LEGAL_FORM_TOKENS.has(t));
  return kept.length > 0 ? kept.join(' ') : base;
}

/**
 * Jaro-Winkler similarity (prefix scale 0.1, prefix up to 4 characters).
 * @returns 0..1, 1 for equal strings.
 */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return 0;
  const window = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const aFlags = new Uint8Array(la);
  const bFlags = new Uint8Array(lb);
  let matches = 0;
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(lb - 1, i + window);
    const ca = a.charCodeAt(i);
    for (let j = lo; j <= hi; j++) {
      if (bFlags[j] === 0 && b.charCodeAt(j) === ca) {
        aFlags[i] = 1;
        bFlags[j] = 1;
        matches++;
        break;
      }
    }
  }
  if (matches === 0) return 0;
  let k = 0;
  let halfTranspositions = 0;
  for (let i = 0; i < la; i++) {
    if (aFlags[i] === 0) continue;
    while (bFlags[k] === 0) k++;
    if (a.charCodeAt(i) !== b.charCodeAt(k)) halfTranspositions++;
    k++;
  }
  const t = halfTranspositions / 2;
  const jaro = (matches / la + matches / lb + (matches - t) / matches) / 3;
  let prefix = 0;
  const maxPrefix = Math.min(4, la, lb);
  while (prefix < maxPrefix && a.charCodeAt(prefix) === b.charCodeAt(prefix)) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** One name in comparable form. */
interface PreparedName {
  raw: string;
  norm: string;
  /** Tokens sorted and joined with a space. */
  sorted: string;
  /** Bit per first letter of a token: a..z are bits 0..25, a digit bit 26, any other letter bit 27. */
  mask: number;
  bits: number;
  /** Whether dropping legal forms changed the name. */
  legalFormDropped: boolean;
}

/** One entry with its names prepared. */
interface PreparedEntry {
  entry: SanctionsEntry;
  names: PreparedName[];
  years: Set<string>;
  fullDates: Set<string>;
}

/** A list prepared for screening, split by kind. */
interface PreparedList {
  person: PreparedEntry[];
  entity: PreparedEntry[];
}

/** The most prepared lists kept at once. */
const PREPARED_CACHE_MAX = 4;
// process-local: each process prepares the lists it screens against once; a second process prepares its own, nothing is lost.
const preparedCache = new Map<string, PreparedList>();

/** Number of set bits in a 32-bit integer. */
function popcount(n: number): number {
  let v = n - ((n >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** The first-letter bit of a token. */
function letterBit(token: string): number {
  const c = token.charCodeAt(0);
  if (c >= 97 && c <= 122) return 1 << (c - 97);
  if (c >= 48 && c <= 57) return 1 << 26;
  return 1 << 27;
}

/** Prepares one name; null when it normalises to nothing. */
function prepareName(raw: string, kind: 'person' | 'entity'): PreparedName | null {
  const norm = normaliseName(raw, { dropLegalForms: kind === 'entity' });
  if (!norm) return null;
  const tokens = norm.split(' ');
  let mask = 0;
  for (const t of tokens) mask |= letterBit(t);
  const legalFormDropped = kind === 'entity' && norm !== normaliseName(raw);
  return { raw, norm, sorted: tokens.slice().sort().join(' '), mask, bits: popcount(mask), legalFormDropped };
}

/** The year part of a YYYY or YYYY-MM-DD date, or '' when it has none. */
function yearOf(d: string): string {
  const m = /^(\d{4})/.exec(d.trim());
  return m ? m[1] : '';
}

/** Whether a string is a full YYYY-MM-DD date. */
function isFullDate(d: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(d.trim());
}

/** Prepares a list, or returns its cached prepared form. */
function prepared(list: SanctionsList): PreparedList {
  const key = `${list.source}:${list.version}`;
  const hit = preparedCache.get(key);
  if (hit) {
    preparedCache.delete(key);
    preparedCache.set(key, hit);
    return hit;
  }
  const out: PreparedList = { person: [], entity: [] };
  for (const entry of list.entries) {
    const names: PreparedName[] = [];
    for (const raw of entry.names) {
      const p = prepareName(raw, entry.kind);
      if (p) names.push(p);
    }
    if (names.length === 0) continue;
    const years = new Set<string>();
    const fullDates = new Set<string>();
    for (const d of entry.birthDates) {
      const y = yearOf(d);
      if (y) years.add(y);
      if (isFullDate(d)) fullDates.add(d.trim());
    }
    out[entry.kind].push({ entry, names, years, fullDates });
  }
  preparedCache.set(key, out);
  while (preparedCache.size > PREPARED_CACHE_MAX) {
    const oldest = preparedCache.keys().next().value;
    if (oldest === undefined) break;
    preparedCache.delete(oldest);
  }
  return out;
}

/** Whether two first-letter masks share at least half of the smaller mask's bits. */
function prefilter(a: PreparedName, b: PreparedName): boolean {
  const shared = popcount(a.mask & b.mask);
  return shared > 0 && shared * 2 >= Math.min(a.bits, b.bits);
}

/** Scores one name pair. */
function scorePair(s: PreparedName, e: PreparedName): { score: number; reason: string } {
  if (s.norm === e.norm) return { score: 1, reason: 'name exact' };
  if (s.sorted === e.sorted) return { score: 0.97, reason: 'name tokens reordered' };
  const score = jaroWinkler(s.sorted, e.sorted);
  return { score, reason: `name similar ${score.toFixed(2)}` };
}

/** Whether the subject's country equals one of the entry's countries (ISO2 or normalised text). */
function countryListed(country: string, entry: SanctionsEntry): boolean {
  const c = normaliseName(country);
  return c !== '' && entry.countries.some((x) => normaliseName(x) === c);
}

/**
 * Screens one subject against sanctions lists.
 * @param subject The customer: kind, name, aliases, optional birth date and country.
 * @param lists Parsed lists (listOf in lists.ts).
 * @param opts threshold: the lowest score returned (default 0.88).
 * @returns The best hit per entry at or above the threshold, sorted by score, highest first.
 */
export function screen(subject: Subject, lists: SanctionsList[], opts?: ScreenOptions): Hit[] {
  const threshold = opts?.threshold ?? DEFAULT_THRESHOLD;
  const subjectNames: PreparedName[] = [];
  for (const raw of [subject.name, ...(subject.aliases ?? [])]) {
    const p = prepareName(raw, subject.kind);
    if (p && !subjectNames.some((x) => x.norm === p.norm)) subjectNames.push(p);
  }
  if (subjectNames.length === 0) return [];
  const birth = subject.kind === 'person' ? (subject.birthDate ?? '').trim() : '';
  const birthYear = yearOf(birth);
  const birthFull = isFullDate(birth) ? birth : '';
  const hits: Hit[] = [];

  for (const list of lists) {
    for (const pe of prepared(list)[subject.kind]) {
      let best: { score: number; reason: string; s: PreparedName; e: PreparedName } | null = null;
      for (const s of subjectNames) {
        for (const e of pe.names) {
          if (!prefilter(s, e)) continue;
          const r = scorePair(s, e);
          if (!best || r.score > best.score) best = { ...r, s, e };
          if (best.score === 1) break;
        }
        if (best?.score === 1) break;
      }
      // A birth date can only lower a name score or confirm one that reached the threshold already.
      if (!best || best.score < threshold) continue;

      let score = best.score;
      const reasons = [best.reason];
      if (best.s.legalFormDropped || best.e.legalFormDropped) reasons.push('legal form ignored');
      if (birthYear && pe.years.size > 0) {
        if (birthFull && pe.fullDates.has(birthFull)) {
          score = Math.max(score, 0.99);
          reasons.push('birth date equal');
        } else if (!pe.years.has(birthYear)) {
          score -= 0.15;
          reasons.push('birth year differs');
        } else {
          reasons.push('birth year equal');
        }
      }
      if (subject.country && countryListed(subject.country, pe.entry)) reasons.push('country listed');
      score = Math.round(Math.min(1, Math.max(0, score)) * 1000) / 1000;
      if (score < threshold) continue;
      hits.push({
        source: pe.entry.source, id: pe.entry.id, kind: pe.entry.kind,
        matchedName: best.s.raw, listedName: best.e.raw, score, reasons, programme: pe.entry.programme,
      });
    }
  }
  return hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/** Test seam: empties the prepared-list cache. */
export function _clearScreeningCache(): void {
  preparedCache.clear();
}
