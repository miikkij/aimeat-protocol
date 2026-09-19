/**
 * @file src/services/decide/scrub.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The decide scrubber (TARGET-080, Module A): takes personal data out of everything the
 *   node sends to the decision model and lets the node put the real values back afterwards.
 *   Deterministic, no model call, no I/O.
 *
 *   ONE SCRUBBER PER DECISION. The state, the instructions and the choice option names are scrubbed
 *   by the same instance, so the same original always gets the same placeholder and a choice answer
 *   such as `[PERSON_1]` can be mapped back to the option the caller wrote. Names and e-mails match
 *   case-insensitively; the first spelling seen is what restore() puts back.
 *
 *   FIELD NAMES ARE EVIDENCE. Inside value(), a property called `name`, `email`, `phone`, `address`,
 *   `hetu`, `iban` (and their Finnish and snake/camel variants) has its whole string replaced even
 *   when no pattern would match it. Names found that way are learnt BEFORE any string is scrubbed,
 *   so a first name in `notes` that comes before the `name` field is still caught.
 * @structure
 *   - ScrubOptions, ScrubReport, Scrubber — the contract
 *   - hintClassForKey   — field-name hint table
 *   - createScrubber    — the stateful scrubber
 * @usage
 *   import { createScrubber } from './scrub.js';
 *   const sc = createScrubber({ knownNames: ['Aino Mäkelä'] });
 *   const state = sc.value(record);            // send this
 *   const option = sc.restore(answer.choice);  // real option name back
 * @version-history
 *   v1.0.0 — 2026-09-19 — TARGET-080 Module A, initial.
 */
import {
  PII_CLASSES, PLACEHOLDER_GLOBAL, PLACEHOLDER_SPLIT,
  buildNameMatchers, scrubAddresses, scrubEmails, scrubHetus, scrubIbans, scrubLiterals,
  scrubNames, scrubPhones,
  type NameMatchers, type PiiClass, type Replacer,
} from './scrub-detect.js';

export { PII_CLASSES, type PiiClass };

/** What the caller knows and allows. */
export interface ScrubOptions {
  /** Person names known to the node (contacts, organism members, caller hints). Full names. */
  knownNames?: string[];
  /** Classes the owner allows to leave unscrubbed. Default none. */
  allow?: PiiClass[];
}

/** Distinct values replaced, per class, and their sum. */
export interface ScrubReport { removed: Record<PiiClass, number>; total: number }

/** A scrubber bound to one decision. */
export interface Scrubber {
  /** Scrub one string. Same original value gives the same placeholder for the lifetime of this scrubber. */
  text(s: string): string;
  /** Deep-walk a JSON value: string values are scrubbed, keys kept, field-name hints replace whole values. */
  value<T>(v: T): T;
  /** Put originals back into a string. Unknown placeholders stay. */
  restore(s: string): string;
  /** Distinct values replaced so far. */
  report(): ScrubReport;
  /** placeholder to original, for restoring structured output (for example a choice key). */
  mapping(): ReadonlyMap<string, string>;
}

const PREFIX: Record<PiiClass, string> = {
  email: 'EMAIL', phone: 'PHONE', hetu: 'HETU', iban: 'IBAN', address: 'ADDRESS', person: 'PERSON',
};

const HINTS: ReadonlyArray<[PiiClass, ReadonlySet<string>]> = [
  // The sender and recipient fields of a message thread name a person whether or not the node knows
  // them: a DM or mail array is the commonest state an owner sends, and its `from` went out as-is.
  ['person', new Set(['name', 'fullname', 'firstname', 'lastname', 'contactname', 'person', 'nimi', 'etunimi', 'sukunimi',
    'from', 'sender', 'sendername', 'fromname', 'author', 'recipient', 'lähettäjä', 'lahettaja', 'vastaanottaja'])],
  ['email', new Set(['email', 'emailaddress', 'sähköposti', 'sahkoposti'])],
  ['phone', new Set(['phone', 'phonenumber', 'mobile', 'mobilephone', 'tel', 'telephone', 'puhelin', 'puhelinnumero', 'gsm'])],
  ['address', new Set(['address', 'streetaddress', 'street', 'osoite', 'katuosoite'])],
  ['hetu', new Set(['ssn', 'hetu', 'henkilotunnus', 'henkilötunnus', 'personalid'])],
  ['iban', new Set(['iban', 'accountnumber', 'tilinumero'])],
];

/** The class a property name marks its value as, or null. `_`, `-`, spaces and case are ignored. */
export function hintClassForKey(key: string): PiiClass | null {
  const k = key.replace(/[_\-\s]/g, '').toLowerCase();
  for (const [cls, set] of HINTS) if (set.has(k)) return cls;
  return null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

/** Stability key: names and e-mails case-insensitive, whitespace collapsed for all. */
function keyOf(cls: PiiClass, original: string): string {
  const s = original.trim().replace(/\s+/g, ' ');
  return `${cls}:${cls === 'person' || cls === 'email' || cls === 'address' ? s.toLowerCase() : s}`;
}

/** Create a scrubber. Its placeholders and mapping live as long as the instance. */
export function createScrubber(opts: ScrubOptions = {}): Scrubber {
  const allow = new Set<PiiClass>(opts.allow ?? []);
  const byKey = new Map<string, string>();
  const originals = new Map<string, string>();
  const counters = Object.fromEntries(PII_CLASSES.map((c) => [c, 0])) as Record<PiiClass, number>;
  const names = new Set<string>();
  const literals = Object.fromEntries(PII_CLASSES.map((c) => [c, new Set<string>()])) as Record<PiiClass, Set<string>>;
  let matchers: NameMatchers | null = null;

  const addName = (n: string): void => {
    const t = n.trim();
    if (t.length >= 2 && !names.has(t)) { names.add(t); matchers = null; }
  };
  for (const n of opts.knownNames ?? []) addName(n);

  const placeholderFor = (cls: PiiClass, original: string): string => {
    const key = keyOf(cls, original);
    const hit = byKey.get(key);
    if (hit) return hit;
    counters[cls] += 1;
    const ph = `[${PREFIX[cls]}_${counters[cls]}]`;
    byKey.set(key, ph);
    originals.set(ph, original);
    return ph;
  };

  /** Apply one pass to the parts of `s` that are not placeholders already. */
  const outside = (s: string, pass: (seg: string) => string): string =>
    s.split(PLACEHOLDER_SPLIT).map((seg, i) => (i % 2 === 1 || !seg ? seg : pass(seg))).join('');

  const run = (s: string): string => {
    let out = s;
    const stage = (cls: PiiClass, fn: (seg: string, rep: Replacer) => string): void => {
      if (allow.has(cls)) return;
      const rep: Replacer = (o) => placeholderFor(cls, o);
      if (literals[cls].size) out = outside(out, (seg) => scrubLiterals(seg, rep, literals[cls]));
      out = outside(out, (seg) => fn(seg, rep));
    };
    stage('email', scrubEmails);
    stage('iban', scrubIbans);
    stage('hetu', scrubHetus);
    stage('phone', scrubPhones);
    stage('address', scrubAddresses);
    if (!allow.has('person') && names.size) {
      matchers ??= buildNameMatchers(names);
      const m = matchers;
      const rep: Replacer = (o) => placeholderFor('person', o);
      out = outside(out, (seg) => scrubNames(seg, rep, m, 'full'));
      out = outside(out, (seg) => scrubNames(seg, rep, m, 'token'));
    }
    return out;
  };

  /** First pass: learn names and literal values from field-name hints. */
  const learn = (v: unknown, depth: number): void => {
    if (depth > 64) return;
    if (Array.isArray(v)) { for (const x of v) learn(x, depth + 1); return; }
    if (!isPlainObject(v)) return;
    for (const [k, x] of Object.entries(v)) {
      const cls = hintClassForKey(k);
      const strings = typeof x === 'string' ? [x] : Array.isArray(x) ? x.filter((y): y is string => typeof y === 'string') : [];
      if (cls && !allow.has(cls)) {
        for (const s of strings) {
          if (!s.trim()) continue;
          if (cls === 'person') addName(s);
          else literals[cls].add(s.trim());
        }
      }
      learn(x, depth + 1);
    }
  };

  const walk = (v: unknown, hint: PiiClass | null, depth: number): unknown => {
    if (typeof v === 'string') {
      if (hint && v.trim()) return placeholderFor(hint, v.trim());
      return run(v);
    }
    if (depth > 64) return v;
    if (Array.isArray(v)) return v.map((x) => walk(x, hint, depth + 1));
    if (!isPlainObject(v)) return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const cls = hintClassForKey(k);
      out[k] = walk(x, cls && !allow.has(cls) ? cls : null, depth + 1);
    }
    return out;
  };

  return {
    text: (s) => run(s),
    value: <T>(v: T): T => {
      learn(v, 0);
      return walk(v, null, 0) as T;
    },
    restore: (s) => s.replace(PLACEHOLDER_GLOBAL, (ph) => originals.get(ph) ?? ph),
    report: () => {
      const removed = { ...counters };
      return { removed, total: PII_CLASSES.reduce((n, c) => n + removed[c], 0) };
    },
    mapping: () => new Map(originals),
  };
}
