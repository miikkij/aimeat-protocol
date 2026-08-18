/**
 * @file scripts/changelog-add.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Add one entry to BOTH change logs from one file, so shipping a note is one command.
 *
 *   There are two logs and they are for different readers: `public/changelog.json` is what a person
 *   sees on the node's front page (EN + FI, newest first, validated by check:changelog), and
 *   `CHANGELOG.md` is the developer account under `## [Unreleased]`. Writing them by hand means
 *   hand-editing JSON, getting the ordering right, remembering that nothing there parses markdown,
 *   and then doing the second file. This does all of that from one input file.
 *
 *   NOTHING PARSES MARKDOWN in the public log — `.ld-log-body` prints the body as text with
 *   `white-space: pre-line`. So `**bold**` renders as asterisks and a single newline is a line
 *   break. Write plain prose with blank lines between paragraphs. This script refuses `**` in the
 *   public body rather than letting it ship looking broken.
 * @structure
 *   loadNote() · addPublic() · addDeveloper() · main()
 * @usage
 *   cd aimeat && pnpm exec node --import tsx scripts/changelog-add.ts <note.json> [--apply]
 *
 *   The note file:
 *   {
 *     "date": "2026-08-12",              // optional, defaults to today
 *     "version": "2.8.0",                // optional
 *     "kind": "feature",                 // feature | fix | security | notice
 *     "title": { "en": "...", "fi": "..." },
 *     "body":  { "en": "...", "fi": "..." },
 *     "developer": "**Headline.** The technical account, markdown, for CHANGELOG.md."
 *   }
 *   `developer` is optional: omit it to touch only the public log. Without --apply it prints what
 *   it would write and changes nothing.
 * @version-history
 *   v1.0.0 — 2026-08-12 — Initial. Written after doing it by hand once, which is once too often.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_LOG = resolve(HERE, '../public/changelog.json');
const DEV_LOG = resolve(HERE, '../../CHANGELOG.md');
const KINDS = ['feature', 'fix', 'security', 'notice'];

interface Note {
  date?: string;
  version?: string;
  kind: string;
  title: string | { en: string; fi: string };
  body: string | { en: string; fi: string };
  developer?: string;
}

function fail(msg: string): never {
  console.error(`\x1b[31m✖ ${msg}\x1b[0m`);
  process.exit(1);
}

function loadNote(path: string): Note {
  let raw: string;
  try { raw = readFileSync(path, 'utf8'); } catch { fail(`cannot read ${path}`); }
  let note: Note;
  try { note = JSON.parse(raw); } catch (e) { fail(`${path} is not valid JSON: ${(e as Error).message}`); }

  if (!KINDS.includes(note.kind)) fail(`kind must be one of ${KINDS.join(' | ')}`);
  for (const field of ['title', 'body'] as const) {
    const v = note[field];
    if (typeof v === 'string') { if (!v.trim()) fail(`${field} is empty`); continue; }
    if (!v || typeof v !== 'object' || !v.en?.trim() || !v.fi?.trim()) {
      fail(`${field} must be a non-empty string, or { en, fi } with both filled in`);
    }
  }
  // The public log renders as text. Asterisks would ship as asterisks.
  const bodies = typeof note.body === 'string' ? [note.body] : [note.body.en, note.body.fi];
  if (bodies.some(b => b.includes('**'))) {
    fail('the public body cannot contain "**" — nothing renders markdown there, so it would show as asterisks. Put emphasis in the words instead.');
  }
  if (note.date && !/^\d{4}-\d{2}-\d{2}$/.test(note.date)) fail('date must be YYYY-MM-DD');
  return note;
}

/** Prepend to public/changelog.json. Newest first is the file's rule, and check:changelog enforces it. */
function addPublic(note: Note, apply: boolean): string {
  const doc = JSON.parse(readFileSync(PUBLIC_LOG, 'utf8'));
  const entry: Record<string, unknown> = {
    date: note.date ?? new Date().toISOString().slice(0, 10),
    ...(note.version ? { version: note.version } : {}),
    kind: note.kind,
    title: note.title,
    body: note.body,
  };
  const newest = doc.entries?.[0]?.date;
  if (newest && String(entry.date) < newest) {
    fail(`date ${entry.date} is older than the newest entry (${newest}) — the list runs newest first`);
  }
  doc.entries = [entry, ...(doc.entries ?? [])];
  if (apply) writeFileSync(PUBLIC_LOG, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  return `public/changelog.json: ${doc.entries.length} entries (was ${doc.entries.length - 1})`;
}

/** Insert under `## [Unreleased]`, above whatever is already there. */
function addDeveloper(text: string, apply: boolean): string {
  const md = readFileSync(DEV_LOG, 'utf8');
  const marker = '## [Unreleased]';
  const at = md.indexOf(marker);
  if (at === -1) fail(`no "${marker}" heading in CHANGELOG.md`);
  const cut = at + marker.length;
  const next = `${md.slice(0, cut)}\n\n${text.trim()}\n${md.slice(cut)}`;
  if (apply) writeFileSync(DEV_LOG, next, 'utf8');
  return `CHANGELOG.md: ${text.trim().split('\n').length} line(s) under ${marker}`;
}

function main(): void {
  const args = process.argv.slice(2).filter(a => a !== '--apply');
  const apply = process.argv.includes('--apply');
  if (args.length !== 1) {
    console.error('usage: node --import tsx scripts/changelog-add.ts <note.json> [--apply]');
    process.exit(2);
  }
  const note = loadNote(resolve(process.cwd(), args[0]));

  console.log(addPublic(note, apply));
  if (note.developer) console.log(addDeveloper(note.developer, apply));
  else console.log('CHANGELOG.md: skipped (no "developer" field in the note)');

  if (!apply) console.log('\nDry run. Re-run with --apply to write, then `pnpm check:changelog`.');
  else console.log('\nWritten. Run `pnpm check:changelog` before committing.');
}

main();
