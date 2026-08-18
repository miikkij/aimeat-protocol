/**
 * @file locale-merge.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Puts a translated slice back into locales/<tag>.json, in en.json's own shape and key
 *   order, and refuses the merge if the result would be broken.
 *
 *   THE OTHER HALF OF locale:extract. Two things it does that hand-editing the JSON does not:
 *
 *   IT PUTS EACH KEY WHERE ENGLISH PUTS IT. en.json mixes nested objects with already-dotted
 *   top-level keys ("admin.messages.desc" sits beside a nested `admin` object), and t() resolves
 *   both. A dotted key written as nesting — or the reverse — lands somewhere t() will never look,
 *   the string silently falls back to English, and the file still counts as translated.
 *
 *   IT REFUSES BEFORE IT WRITES. Unknown keys, a string where English has a list, a dropped {n},
 *   a shipped [TODO:xx]: all of it is checked against the merged result FIRST, and nothing is
 *   written if any of it fails. A half-merged locale file is worse than an unmerged one, because
 *   the next extract no longer knows what is outstanding.
 *
 *   Values identical to the English are allowed — "Total", "Marketing" and "MCP" are the same word
 *   in three languages — but they are counted and reported, because a whole batch of them means the
 *   translator pasted the extract file back unchanged.
 * @structure  read + validate args → map dotted keys into en's shape → findDefects → write or refuse
 * @usage  pnpm locale:merge es locales/.todo-es.json
 *         pnpm locale:merge es /tmp/next.json --dry-run
 * @version-history
 *   v1.0.0 — 2026-08-13 — Initial, replacing the ad-hoc scratchpad script Spanish was built with.
 */
import { readFileSync, existsSync } from 'node:fs';
import {
  shippedLocales, loadLocale, writeLocale, flatten, pathIn, setDeep, orderLike, findDefects,
  type LocaleTree, type LocaleValue,
} from './lib/locale-files.js';

const tag = process.argv[2];
const file = process.argv[3];
const dryRun = process.argv.includes('--dry-run');

if (!tag || !/^[a-z]{2}$/.test(tag) || !file) {
  console.error('usage: pnpm locale:merge <tag> <file.json> [--dry-run]');
  console.error(`       tags this node ships: ${shippedLocales().join(', ')}`);
  process.exit(1);
}
if (tag === 'en') {
  console.error('en.json is the source of truth — write English there by hand, with the code that uses it.');
  process.exit(1);
}
if (!existsSync(file)) {
  console.error(`no such file: ${file}`);
  process.exit(1);
}

const enTree = loadLocale('en');
const en = flatten(enTree);

let target: LocaleTree;
try {
  target = loadLocale(tag);
} catch {
  console.log(`locales/${tag}.json does not exist yet — creating it.`);
  target = {};
}

let incoming: Record<string, LocaleValue>;
try {
  incoming = JSON.parse(readFileSync(file, 'utf8')) as Record<string, LocaleValue>;
} catch (err) {
  console.error(`${file} is not valid JSON: ${(err as Error).message}`);
  process.exit(1);
}

const unknown: string[] = [];
let written = 0, unchanged = 0, replaced = 0;
const before = flatten(target);

for (const [key, value] of Object.entries(incoming)) {
  const path = pathIn(enTree, key);
  if (!path) { unknown.push(key); continue; }
  if (key in before) replaced++;
  if (JSON.stringify(value) === JSON.stringify(en[key])) unchanged++;
  setDeep(target, path, value);
  written++;
}

if (unknown.length) {
  console.error(`✖ ${unknown.length} key(s) in ${file} do not exist in en.json:\n`);
  for (const k of unknown.slice(0, 20)) console.error(`    ${k}`);
  if (unknown.length > 20) console.error(`    …and ${unknown.length - 20} more`);
  console.error('\n  → add the English first (with the code that reads it), or fix the spelling.');
  console.error('    Nothing was written.');
  process.exit(1);
}

const ordered = orderLike(enTree, target);
const defects = findDefects(tag, en, flatten(ordered));
if (defects.length) {
  console.error(`✖ the merged ${tag}.json would have ${defects.length} defect(s):\n`);
  for (const d of defects.slice(0, 20)) console.error(`  ✖ ${d.what}\n      → ${d.fix}`);
  if (defects.length > 20) console.error(`  …and ${defects.length - 20} more`);
  console.error('\n  Nothing was written.');
  process.exit(1);
}

const total = Object.keys(en).length;
const covered = Object.keys(flatten(ordered)).length;

if (dryRun) {
  console.log(`(dry run — nothing written)`);
} else {
  writeLocale(tag, ordered);
}

console.log(`${written} key(s) merged into locales/${tag}.json${replaced ? ` (${replaced} overwrote an existing translation)` : ''}`);
if (unchanged) {
  console.log(`${unchanged} of them are identical to the English. That is fine for "Total" or "MCP";`);
  console.log(`if it is most of the batch, the extract file went back untranslated.`);
}
console.log(`locales/${tag}.json now covers ${covered} / ${total} keys (${((100 * covered) / total).toFixed(1)} %).`);
