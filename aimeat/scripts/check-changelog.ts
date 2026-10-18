/**
 * @file check-changelog.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Guard for public/changelog.json — the node's change log, which the landing page
 *   fetches and renders. A malformed file fails in the quietest possible way: the fetch rejects,
 *   the component renders nothing, and the front page simply stops announcing anything. Since the
 *   file is edited by hand (and by an assistant) alongside the change it describes, this parses it,
 *   checks each entry has the fields the renderer reads, and rejects an out-of-order list so the
 *   newest entry really is the one shown when the section is folded.
 * @structure checkChangelog() → prints every problem and exits non-zero on the first bad file.
 * @usage  pnpm check:changelog   (also in the pre-commit hook + CI)
 * @version-history
 *   v1.1.0 — 2026-10-18 — The news fields: a unique id, an audience, a highlight flag, a short
 *     summary, and an impact sentence on a fix or a security entry (the home's news band).
 *   v1.0.0 — 2026-07-31 — Initial: parse + shape + ordering guard for the landing change log.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'changelog.json');
const KINDS = ['feature', 'fix', 'security', 'notice'];
const AUDIENCES = ['user', 'agent', 'operator', 'developer'];
/** One sentence on the home's news band; a little room over the 110 the file's header asks for. */
const SUMMARY_MAX = 140;

/** A title/body is a plain string or a { en, fi } pair; both must carry actual text. */
function badText(value: unknown, field: string, at: string): string | null {
  if (typeof value === 'string') return value.trim() ? null : `${at}: ${field} is empty`;
  if (value && typeof value === 'object') {
    const vals = Object.values(value as Record<string, unknown>);
    if (!vals.length) return `${at}: ${field} has no languages`;
    const bad = vals.find(v => typeof v !== 'string' || !v.trim());
    return bad === undefined ? null : `${at}: ${field} has an empty or non-string language`;
  }
  return `${at}: ${field} must be a string or an { en, fi } object`;
}

function checkChangelog(): void {
  const problems: string[] = [];
  let parsed: { entries?: unknown };
  try {
    parsed = JSON.parse(readFileSync(FILE, 'utf-8'));
  } catch (err) {
    console.error(`✗ public/changelog.json does not parse: ${(err as Error).message}`);
    console.error('  The landing page would silently show no change log at all.');
    process.exit(1);
  }

  const entries = parsed.entries;
  if (!Array.isArray(entries)) {
    console.error('✗ public/changelog.json: "entries" must be an array');
    process.exit(1);
  }

  let previousDate = '';
  const seenIds = new Set<string>();
  entries.forEach((raw, i) => {
    const e = raw as Record<string, unknown>;
    const at = `entry ${i + 1}`;
    const date = typeof e.date === 'string' ? e.date : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) problems.push(`${at}: date must be YYYY-MM-DD (got ${JSON.stringify(e.date)})`);
    else if (Number.isNaN(new Date(date).getTime())) problems.push(`${at}: ${date} is not a real date`);
    else {
      // Newest first — the folded section shows entries[0] and would otherwise announce old news.
      if (previousDate && date > previousDate) problems.push(`${at}: ${date} is newer than the entry above it (${previousDate}) — the list runs newest first`);
      previousDate = date;
    }
    if (typeof e.kind !== 'string' || !KINDS.includes(e.kind)) {
      problems.push(`${at}: kind must be one of ${KINDS.join(' | ')} (got ${JSON.stringify(e.kind)})`);
    }
    const titleProblem = badText(e.title, 'title', at);
    if (titleProblem) problems.push(titleProblem);
    if (e.body !== undefined) {
      const bodyProblem = badText(e.body, 'body', at);
      if (bodyProblem) problems.push(bodyProblem);
    }
    if (e.version !== undefined && typeof e.version !== 'string') problems.push(`${at}: version must be a string`);

    // The news fields the home's band reads (views/home/news-data.js). The id is what a person's
    // "seen" record points at, so it must exist and stay unique; the rest is what keeps the band
    // short and says whom an entry is for.
    const id = typeof e.id === 'string' ? e.id : '';
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]+$/.test(id)) problems.push(`${at}: id must be the date plus a lowercase slug (got ${JSON.stringify(e.id)})`);
    else if (seenIds.has(id)) problems.push(`${at}: id ${id} is used twice`);
    else seenIds.add(id);
    if (!Array.isArray(e.audience) || e.audience.length === 0 || e.audience.some(a => !AUDIENCES.includes(a as string))) {
      problems.push(`${at}: audience must be a non-empty list of ${AUDIENCES.join(' | ')}`);
    }
    if (typeof e.highlight !== 'boolean') problems.push(`${at}: highlight must be true or false`);
    const summaryProblem = badText(e.summary, 'summary', at);
    if (summaryProblem) problems.push(summaryProblem);
    else if (e.summary && typeof e.summary === 'object') {
      for (const [lang, text] of Object.entries(e.summary as Record<string, string>)) {
        if (text.length > SUMMARY_MAX) problems.push(`${at}: summary.${lang} is ${text.length} characters; the band shows one short sentence (at most ${SUMMARY_MAX})`);
      }
    }
    if (e.kind === 'fix' || e.kind === 'security') {
      const impactProblem = badText(e.impact, 'impact', at);
      if (impactProblem) problems.push(`${impactProblem} (a fix or a security entry says whether the person's use changes)`);
    }
  });

  if (problems.length) {
    console.error('✗ public/changelog.json has problems the landing page cannot report:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`✓ changelog.json valid — ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}, newest first`);
}

checkChangelog();
