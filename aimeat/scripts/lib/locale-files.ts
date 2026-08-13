/**
 * @file scripts/lib/locale-files.ts
 * @description The one reader of locales/*.json that every locale tool shares: which languages the
 *   node ships, how a nested file flattens to the dotted keys t() actually resolves, how a dotted
 *   key finds its way back into en.json's own shape, and what counts as a defect in a translation.
 *
 *   WHY IT IS A LIBRARY. Three tools need the same four answers — check:locales, locale:extract and
 *   locale:merge — and this repo gates on the same decision being written out twice
 *   (check:copied-logic). More to the point, the flattening rule is subtle enough that two copies
 *   would drift: en.json mixes nested objects with ALREADY-DOTTED top-level keys
 *   ("admin.messages.desc" sits beside a nested `admin` object), and a tool that walks only the
 *   nesting silently reports half the file as missing.
 * @structure
 *   - shippedLocales() / loadLocale() / writeLocale()
 *   - flatten(obj)          — dotted key → value, both spellings
 *   - pathIn(en, key)       — where a dotted key belongs inside en.json's shape
 *   - setDeep / orderLike   — write a key back, then re-order to match en.json
 *   - varsOf(value)         — the {name} / {{name}} tokens a string interpolates
 *   - findDefects(en, loc)  — the shared verdict: unknown key, type drift, TODO, dropped variable
 * @usage import { flatten, findDefects } from './lib/locale-files.js';
 * @version-history
 *   v1.0.0 — 2026-08-13 — Extracted from check-locales.ts when extract/merge needed the same rules.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const LOCALES_DIR = join(here, '..', '..', 'locales');

/** A leaf in a locale file: a string, or a list of strings the view renders as a group. */
export type LocaleValue = string | string[];
export type LocaleTree = Record<string, unknown>;

/** Every locale the node ships, taken from the files themselves. English first, then the rest. */
export function shippedLocales(): string[] {
  const tags = readdirSync(LOCALES_DIR)
    .filter((f) => /^[a-z]{2}\.json$/.test(f))
    .map((f) => f.slice(0, 2));
  return ['en', ...tags.filter((t) => t !== 'en').sort()];
}

export function loadLocale(tag: string): LocaleTree {
  return JSON.parse(readFileSync(join(LOCALES_DIR, `${tag}.json`), 'utf8')) as LocaleTree;
}

export function writeLocale(tag: string, tree: LocaleTree): void {
  writeFileSync(join(LOCALES_DIR, `${tag}.json`), `${JSON.stringify(tree, null, 2)}\n`, 'utf8');
}

/**
 * Dotted key → value, exactly as t() resolves it. Handles both spellings a locale file uses:
 * nested objects, and top-level keys that already carry dots.
 */
export function flatten(obj: LocaleTree, prefix = '', out: Record<string, LocaleValue> = {}): Record<string, LocaleValue> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string' || Array.isArray(v)) out[key] = v as LocaleValue;
    else if (v && typeof v === 'object') flatten(v as LocaleTree, key, out);
  }
  return out;
}

/**
 * Where a dotted key belongs inside en.json's OWN shape, as a path of literal object keys.
 * `admin.messages.desc` may be one key at the top level or three levels of nesting, and English
 * decides which — a translation that guesses lands somewhere t() will never look.
 * Returns null when English has no such key.
 */
export function pathIn(en: LocaleTree, key: string): string[] | null {
  if (Object.prototype.hasOwnProperty.call(en, key)) return [key];
  const parts = key.split('.');
  for (let i = 1; i < parts.length; i++) {
    const head = parts.slice(0, i).join('.');
    const branch = en[head];
    if (branch && typeof branch === 'object' && !Array.isArray(branch)) {
      const rest = pathIn(branch as LocaleTree, parts.slice(i).join('.'));
      if (rest) return [head, ...rest];
    }
  }
  return null;
}

export function setDeep(tree: LocaleTree, path: string[], value: LocaleValue): void {
  let cur = tree;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    if (typeof cur[seg] !== 'object' || cur[seg] === null || Array.isArray(cur[seg])) cur[seg] = {};
    cur = cur[seg] as LocaleTree;
  }
  cur[path[path.length - 1]] = value;
}

/**
 * Rewrite `target` in `source`'s key order, keeping only keys source has. A diff between en.json
 * and a translation should line up line for line; a file in insertion order does not.
 */
export function orderLike(source: LocaleTree, target: LocaleTree): LocaleTree {
  const out: LocaleTree = {};
  for (const k of Object.keys(source)) {
    if (!(k in target)) continue;
    const sv = source[k], tv = target[k];
    out[k] = (sv && typeof sv === 'object' && !Array.isArray(sv) && tv && typeof tv === 'object' && !Array.isArray(tv))
      ? orderLike(sv as LocaleTree, tv as LocaleTree)
      : tv;
  }
  return out;
}

/** The {name} and {{name}} tokens a value interpolates. Both forms are in use on this node. */
export function varsOf(v: LocaleValue): Set<string> {
  const text = Array.isArray(v) ? v.join(' ') : v;
  const found = new Set<string>();
  for (const m of text.matchAll(/\{\{?(\w+)\}?\}/g)) found.add(m[1]);
  return found;
}

export interface Defect { key: string; what: string; fix: string; }

/**
 * Words that mix two writing systems inside a single token — "информativa" for "informativa".
 * A keyboard layout left in the wrong state produces a word that LOOKS right at a glance and is
 * unsearchable, unpronounceable and unfixable-by-eye. Script-agnostic on purpose: a future Russian
 * locale would write whole Cyrillic words, which this does not touch; only the mixture is wrong.
 * The check is one this repo earned — the example above shipped into a merge on 2026-08-13.
 */
function mixedScriptWords(v: LocaleValue): string[] {
  const text = Array.isArray(v) ? v.join(' ') : v;
  const out: string[] = [];
  for (const word of text.split(/\s+/)) {
    const latin = /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(word);
    const other = /[Ͱ-ϿЀ-ӿ԰-֏֐-׿؀-ۿ]/.test(word);
    if (latin && other) out.push(word);
  }
  return out;
}

/**
 * What is wrong with a translation, given English. Deliberately NOT "incomplete": a missing key
 * falls back to English per key, which is the design and is how a language gets filled in over
 * several passes. These are the four ways a key that IS there can still be broken.
 */
export function findDefects(tag: string, en: Record<string, LocaleValue>, loc: Record<string, LocaleValue>): Defect[] {
  const out: Defect[] = [];

  for (const [key, value] of Object.entries(loc)) {
    const source = en[key];

    if (source === undefined) {
      out.push({ key, what: `${key} exists in ${tag}.json but not in en.json`,
        fix: 'add the English, or delete the key. A key English does not have is dead: t() is called '
          + 'with the English spelling, so nothing ever reads this one.' });
      continue;
    }

    const srcArray = Array.isArray(source), locArray = Array.isArray(value);
    if (srcArray !== locArray) {
      out.push({ key, what: `${key} is ${locArray ? 'an array' : 'a string'} in ${tag}.json but ${srcArray ? 'an array' : 'a string'} in en.json`,
        fix: 'match the English shape. The view either maps over this value or prints it, and it cannot do both.' });
      continue;
    }
    if (srcArray && locArray && (source as string[]).length !== (value as string[]).length) {
      out.push({ key, what: `${key} has ${(value as string[]).length} entries in ${tag}.json and ${(source as string[]).length} in en.json`,
        fix: 'give it the same number of entries. A list rendered short in one language reads as a bug.' });
    }

    const text = Array.isArray(value) ? value.join(' ') : value;
    if (text.includes(`[TODO:${tag}]`)) {
      out.push({ key, what: `${key} in ${tag}.json is still a [TODO:${tag}] placeholder`,
        fix: `write the ${tag} text, or remove the key so it falls back to English. A visible TODO reads as broken software.` });
    }

    // Renamed is not dropped. Two strings on this node put a {placeholder} in the prose as an
    // EXAMPLE of the syntax, and a translation translates the example word — {{variable}} becomes
    // {{muuttuja}}. Counting names alone reports both as bugs, and a gate that cries wolf on
    // correct text gets switched off. Compare how MANY tokens each side carries: a rename keeps
    // the count, and only a genuine drop lowers it.
    const mixed = mixedScriptWords(value);
    if (mixed.length) {
      out.push({ key, what: `${key} in ${tag}.json mixes writing systems inside a word: ${mixed.slice(0, 3).join(', ')}`,
        fix: 'retype the word. A Cyrillic or Greek letter sitting inside a Latin word passes every '
          + 'spellcheck by eye and none by machine.' });
    }

    const srcVars = varsOf(source), locVars = varsOf(value);
    const missing = [...srcVars].filter((v) => !locVars.has(v));
    const renamed = [...locVars].filter((v) => !srcVars.has(v));
    if (missing.length > renamed.length) {
      out.push({ key, what: `${key} in ${tag}.json carries ${locVars.size} interpolation token(s) where en.json has ${srcVars.size} (missing ${missing.map((v) => `{${v}}`).join(', ')})`,
        fix: 'put the token back, spelled exactly as in en.json. Whatever it carried — a count, a name, '
          + 'an address — vanishes from the sentence in this language only.' });
    }
  }

  return out;
}
