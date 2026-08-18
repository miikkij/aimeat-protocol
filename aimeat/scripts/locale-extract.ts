/**
 * @file locale-extract.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Hands you the next slice of a language to translate: every key en.json has that the
 *   target locale does not, as a flat {key: "the English"} file you overwrite in place.
 *
 *   THIS IS HALF OF HOW A LANGUAGE GETS ADDED HERE. The other half is locale:merge, which puts the
 *   answers back in en.json's own shape. Between them, adding a fourth language is a loop rather
 *   than a project: add the tag to LOCALES in src/i18n.ts, create an empty locales/<tag>.json, then
 *   repeat extract → translate → merge until check:locales reports 100 %. Nothing else in the code
 *   needs touching, because every locale-aware surface reads the LOCALES list.
 *
 *   IT DOES NOT TRANSLATE. No model is called and nothing is billed. The file it writes is meant to
 *   be filled in by whoever is doing the language: a person, or an AI reading the glossary in the
 *   `aimeat-writing` skill. That is deliberate — this repo does not spend the developer's money on
 *   its own initiative, and a machine translation merged unread is exactly the "translated English"
 *   the writing rules exist to prevent.
 *
 *   SLICE BY PREFIX, NOT BY COUNT ALONE. A translator needs the strings of one screen together, or
 *   the same noun comes out three ways. `--prefix profile.agents.` is a screen; the first 200 keys
 *   alphabetically are four half-screens.
 * @structure  args → missing keys → optional prefix/limit filter → write file + per-prefix summary
 * @usage  pnpm locale:extract es                          — everything still missing
 *         pnpm locale:extract es --prefix profile.agents.  — one screen's worth
 *         pnpm locale:extract es --prefix dashboard. --limit 150 --out /tmp/next.json
 * @version-history
 *   v1.0.0 — 2026-08-13 — Initial, replacing the ad-hoc scratchpad script Spanish was built with.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { shippedLocales, loadLocale, flatten, LOCALES_DIR, type LocaleValue } from './lib/locale-files.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
function args(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((a, i) => { if (a === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]); });
  return out;
}

const tag = process.argv[2];
if (!tag || !/^[a-z]{2}$/.test(tag)) {
  console.error('usage: pnpm locale:extract <tag> [--prefix p]… [--limit n] [--out file]');
  console.error(`       tags this node ships: ${shippedLocales().join(', ')}`);
  process.exit(1);
}
if (tag === 'en') {
  console.error('en.json is the source of truth — there is nothing to extract from it.');
  process.exit(1);
}

const en = flatten(loadLocale('en'));
let loc: Record<string, LocaleValue> = {};
try {
  loc = flatten(loadLocale(tag));
} catch {
  console.log(`locales/${tag}.json does not exist yet — treating the whole file as missing.`);
  console.log(`Create it with {} and add '${tag}' to LOCALES in src/i18n.ts, then merge into it.\n`);
}

const prefixes = args('prefix');
const limit = Number(arg('limit') ?? 0);

let missing = Object.keys(en).filter((k) => !(k in loc));
const totalMissing = missing.length;
if (prefixes.length) missing = missing.filter((k) => prefixes.some((p) => k === p || k.startsWith(p)));
const matched = missing.length;
if (limit > 0) missing = missing.slice(0, limit);

if (missing.length === 0) {
  console.log(prefixes.length
    ? `Nothing missing under ${prefixes.join(', ')} — that slice of ${tag} is done.`
    : `Nothing missing: locales/${tag}.json covers all ${Object.keys(en).length} keys.`);
  process.exit(0);
}

const payload: Record<string, LocaleValue> = {};
for (const k of missing) payload[k] = en[k];

const out = arg('out') ?? join(LOCALES_DIR, `.todo-${tag}.json`);
writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

// What the translator is looking at, grouped the way they will work through it.
const byPrefix = new Map<string, { n: number; chars: number }>();
for (const k of missing) {
  const g = k.split('.').slice(0, 2).join('.');
  const e = byPrefix.get(g) ?? { n: 0, chars: 0 };
  e.n++; e.chars += String(en[k]).length;
  byPrefix.set(g, e);
}

console.log(`locales/${tag}.json is missing ${totalMissing} of ${Object.keys(en).length} keys.`);
if (prefixes.length) console.log(`  ${matched} of those match ${prefixes.join(', ')}`);
console.log(`Wrote ${missing.length} to ${out}\n`);
console.log('  keys   chars  block');
for (const [g, e] of [...byPrefix.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 20)) {
  console.log(`  ${String(e.n).padStart(4)}  ${String(e.chars).padStart(6)}  ${g}`);
}
console.log(`\nNext: replace every value with the ${tag} text (keep {tokens} exactly, and read the`);
console.log(`glossary in the aimeat-writing skill first), then: pnpm locale:merge ${tag} ${out}`);
