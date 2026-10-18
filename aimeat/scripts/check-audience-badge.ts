/**
 * @file scripts/check-audience-badge.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every view that shows a person their own content says who can read it with the one
 *   component, components/AudienceBadge.js (plan doc-mvcn6c7e4e5q, V6.4). Before it, each view printed
 *   the stored word its kind keeps ('members', 'owner', 'shared', 'organism:<id>'), a package said
 *   "private" for every level but public, and a board of chosen members read like one for every
 *   account. The badge reads every kind's value into the same words; this gate keeps a view from going
 *   back to its own.
 *
 *   A VIEW PASSES when its source, comments stripped, imports AudienceBadge from
 *   /components/AudienceBadge.js and renders it (`<${AudienceBadge}`). A comment that names the badge
 *   does not count, the same rule check:ai-disclosure's label views follow.
 *
 *   ADDING A VIEW. A new screen that shows a person their own records, files, workspace pages, apps,
 *   packages, knowledge packages, boards or skills goes on AUDIENCE_VIEWS in the same change.
 * @structure AUDIENCE_VIEWS · stripComments(src) · audienceBadgeFindings(views, read) · main()
 * @usage pnpm check:audience-badge   (in check:fast through scripts/lib/check-registry.mjs)
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V6.4).
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The views that show the owner their content, and what each shows. */
export const AUDIENCE_VIEWS: Array<{ file: string; shows: string }> = [
  { file: 'public/views/profile/memory-tab/entries-view.js', shows: 'memory records, one row a key' },
  { file: 'public/views/profile/memory-tab/cover.js', shows: 'memory key spaces, a record page and the files' },
  { file: 'public/views/profile/organisms/workspace/panels.js', shows: 'the workspace pages a share opens' },
  { file: 'public/views/profile/organisms/document.js', shows: 'the pictures of a workspace page' },
  { file: 'public/views/profile/apps/page.js', shows: 'the apps that changed last' },
  { file: 'public/views/profile/packages/rows.js', shows: 'the packages the person made' },
  { file: 'public/views/profile/knowledge/frame.js', shows: 'the knowledge packages, one row each' },
  { file: 'public/views/profile/knowledge/package.js', shows: 'a knowledge package and its entries' },
  { file: 'public/views/profile/boards/frame.js', shows: 'the boards, one row each' },
  { file: 'public/views/profile/boards/board.js', shows: 'a board\'s own page' },
  { file: 'public/views/profile/skills/rows.js', shows: 'the skills, one row each' },
  { file: 'public/views/profile/exposure-tab.js', shows: 'what others can see of the person\'s' },
];

/**
 * The source without its comments: every block comment, and every line that is only a `//` comment.
 * A character-level scanner reads a view's nested html`` templates (a template inside a `${}` inside
 * a template) as strings that end early, and then takes the `//` of an address for a comment and
 * drops the rest of the line with the badge on it, as it did on organisms/document.js. A view's
 * comments sit in its header or on lines of their own, so this is the safer cut; a `//` after code on
 * the same line stays, which can only make the gate pass a line that a comment ends, never fail one.
 */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

const IMPORTS = /import\s*\{[^}]*\bAudienceBadge\b[^}]*\}\s*from\s*['"]\/components\/AudienceBadge\.js['"]/;
const RENDERS = /<\$\{AudienceBadge\}/;

/**
 * What is wrong with the listed views: a file that is gone, or one that no longer imports and draws
 * the badge. `read` returns a file's source, or null when it does not exist.
 */
export function audienceBadgeFindings(
  views: Array<{ file: string; shows: string }>, read: (file: string) => string | null,
): string[] {
  const out: string[] = [];
  for (const v of views) {
    const src = read(v.file);
    if (src === null) { out.push(`${v.file}: listed in AUDIENCE_VIEWS but not found (${v.shows}); move the entry with the view`); continue; }
    const code = stripComments(src);
    if (!IMPORTS.test(code) || !RENDERS.test(code)) {
      out.push(`${v.file} no longer draws the AudienceBadge (${v.shows}): import { AudienceBadge } from '/components/AudienceBadge.js' and render it with the level the API returns`);
    }
  }
  return out;
}

function main(): void {
  const read = (file: string): string | null => {
    const abs = path.join(ROOT, file);
    return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  };
  const findings = audienceBadgeFindings(AUDIENCE_VIEWS, read);
  if (findings.length) {
    console.error(`✖ ${findings.length} view(s) say who can read the person's content without the AudienceBadge:\n`);
    for (const f of findings) console.error(`  ${f}`);
    process.exitCode = 1;
    return;
  }
  console.log(`✓ AudienceBadge: all ${AUDIENCE_VIEWS.length} views that show the owner their content draw it.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
