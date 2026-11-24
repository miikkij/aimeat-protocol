/**
 * @file scripts/lib/ready-scope.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Decides how much of the E2E sweep pnpm ready runs for the commits it brings: for code,
 *   the suites the change can reach (./ready-reach.ts), and the whole sweep only when a changed file is
 *   on every request's path; for text, only the suites that name a changed text. The nightly runs the
 *   whole sweep (Jouni, 2026-11-24).
 *
 *   WHY. A change of words (locale files, docs, comments, the text inside a string) cannot break a
 *   suite unless the suite quotes the old words or is itself changed, and the full sweep on this
 *   machine takes about two hours. Ruled by the developer on 2026-11-22, after a terminology change
 *   waited two hours for a sweep that could only find what a search of the tests had already found.
 *
 *   WHAT COUNTS AS TEXT. A file under a text path (locales, Markdown, docs, the session guides, the
 *   checks and their ledgers, the tests, the hooks), or a code file whose tokens are the same before
 *   and after once comments and the contents of its prose strings are set aside. A prose string has
 *   a space in it; a string without one is a key, a route or an id, and changing it is code, as is a
 *   new or removed string, a number or a name. A string that had a space before is prose whatever it
 *   says after ("a way of moving" to "navigation"). openapi.yaml counts as text when only its
 *   `description` and `summary` values changed. package.json counts as text when only its scripts
 *   changed. Anything the rule cannot read (a new file under src/, a binary) is code.
 *
 *   WHICH SUITES, FOR TEXT. Every E2E suite file that changed, and every suite that contains, word for
 *   word, an English locale value or a string literal the change removed (at least 20 characters).
 *
 *   A WIDE TEXT CHANGE ALSO RUNS THE FULL SWEEP ON SQLITE. The search above misses a suite that quotes
 *   a part of a sentence shorter than 20 characters, and on 2026-11-22 a terminology change of 624
 *   files passed its 7 picked suites while 8 other suites quoted the old words; the full SQLite sweep
 *   found all 10 failures. A text change is wide when it changes WIDE_FILES or more files a person or
 *   an AI reads in the product (not Markdown, docs/ or the session guides), or removes WIDE_TEXTS or
 *   more texts. Then the full sweep runs on SQLite, the faster backend, and the picked suites on
 *   PostgreSQL.
 * @structure changedFiles() · isTextOnly() · sameCode() · htmlShape() · targetedSuites() · isWideText() · readyScope() (codeReach in ./ready-reach.ts)
 * @version-history
 *   v2.0.0 — 2026-11-24 — A code change runs the suites it can reach (ready-reach.ts), not the whole
 *     sweep; the whole sweep stays for a change on every request's path and for the nightly.
 *   v1.3.0 — 2026-11-23 — public/changelog.json is text: a changelog entry alone ran the full sweep
 *     on both backends.
 *   v1.2.0 — 2026-11-23 — A wide text change (WIDE_FILES files or WIDE_TEXTS removed texts) also runs
 *     the full sweep on SQLite (Jouni, 2026-11-23).
 *   v1.1.0 — 2026-11-22 — openapi.yaml with only its prose changed is text; a prose string that
 *     became one word is still prose; an attribute value in double quotes may hold an apostrophe.
 *   v1.0.0 — 2026-11-22 — Initial.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { parse as parseYaml } from 'yaml';
import { codeReach } from './ready-reach.js';

const git = (repo: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const gitShow = (repo: string, base: string, file: string): string | null => {
  try { return git(repo, 'show', `${base}:${file}`); } catch { return null; }
};

/** Paths whose content is words for a person or a session, or the checks that read them. */
const TEXT_PATH = /^(?:aimeat\/locales\/[a-z]{2}\.json$|aimeat\/public\/changelog\.json$|.*\.md$|docs\/|\.claude\/|\.githooks\/|aimeat\/scripts\/|aimeat\/security\/|aimeat\/test\/|aimeat\/public\/data\/everything\.|aimeat\/public\/THIRD-PARTY-NOTICES\.md$|THIRD-PARTY-NOTICES\.md$|aimeat\/src\/services\/prompt-defaults\/shipped-hashes\.ts$|aimeat\/src\/services\/ui-library\/facts\.generated\.ts$)/;
// changelog.json is the landing page's list of entries, words a person reads; check:changelog holds
// its shape and order, and no route reads it for anything but display.
// shipped-hashes.ts lists the hash of every default prompt text; it changes only with that text, and
// a unit test holds the two together. facts.generated.ts is the component library's index of which
// file uses which class and token, read from the source by pnpm build:ui-library and shown on the
// library page; it follows the files it indexes, which this rule reads on their own.

export function changedFiles(repo: string, base: string): string[] {
  return git(repo, 'diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
}

/** The code of a script with every comment dropped and every string literal's text blanked. */
export function codeShape(source: string, file: string): { shape: string; strings: string[] } {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const parts: string[] = [];
  const strings: string[] = [];
  const STRINGISH = new Set([ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.TemplateHead, ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail]);
  // The parser's leaves are the tokens; comments are trivia and never a leaf. A JSDoc block is a
  // child node in a .ts file, so it is skipped by kind.
  const walk = (node: ts.Node): void => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const children = node.getChildren(sf);
    if (!children.length) {
      // Only a string with a space in it is prose. A string with none is a key, a route, a class or an
      // id (t('profile.x'), '/v1/apps'), and changing it changes what the code does.
      const text = STRINGISH.has(node.kind) ? (node as ts.LiteralLikeNode).text : null;
      if (text !== null && /\s/.test(text)) { strings.push(text); parts.push(`S${node.kind}`); }
      else parts.push(node.getText(sf));
      return;
    }
    for (const c of children) walk(c);
  };
  walk(sf);
  return { shape: parts.join(' '), strings };
}

/** The tags of a page with comments dropped and the prose inside attribute values (alt, title) blanked. */
export function htmlShape(source: string): string {
  const tags = source.replace(/<!--[\s\S]*?-->/g, '').match(/<[^>]*>/g) ?? [];
  // Each quote kind on its own: a value in double quotes may hold an apostrophe ("the world's").
  return tags.map(t => t.replace(/="([^"]*\s[^"]*)"/g, '="S"').replace(/='([^']*\s[^']*)'/g, "='S'")).join('');
}

/**
 * True when two versions of a script differ only in comments and prose. Every string literal is set
 * aside, and each one that changed must have been prose before (it had a space): a key, a route or an
 * id has none, so a changed one is code, while a sentence that became one word ("navigation") is
 * still the words a person reads.
 */
export function sameCode(before: string, after: string, file: string): boolean {
  const literals = (source: string): { shape: string; strings: string[] } => {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
      file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
    const parts: string[] = [];
    const strings: string[] = [];
    const STRINGISH = new Set([ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral,
      ts.SyntaxKind.TemplateHead, ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail]);
    const walk = (node: ts.Node): void => {
      if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
      const children = node.getChildren(sf);
      if (!children.length) {
        if (STRINGISH.has(node.kind)) { strings.push((node as ts.LiteralLikeNode).text); parts.push(`S${node.kind}`); }
        else parts.push(node.getText(sf));
        return;
      }
      for (const c of children) walk(c);
    };
    walk(sf);
    return { shape: parts.join(' '), strings };
  };
  const a = literals(before), b = literals(after);
  if (a.shape !== b.shape) return false;
  return a.strings.every((s, i) => s === b.strings[i] || /\s/.test(s));
}

/**
 * The API contract with its prose set aside: every `description` and `summary` value dropped. What
 * is left (paths, schemas, types, enums, examples) is what a client and the generated types read.
 */
export function contractShape(source: string): string | null {
  try {
    const strip = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(strip);
      if (v && typeof v === 'object') {
        return Object.fromEntries(Object.entries(v as Record<string, unknown>)
          .filter(([k, x]) => !((k === 'description' || k === 'summary') && typeof x === 'string'))
          // x-enum-descriptions: a sentence per enum value, for a reader; the values are in `enum`.
          .filter(([k]) => k !== 'x-enum-descriptions')
          // An unquoted description in a flow map ({ type: string, description: a, b c }) leaves the
          // words after its comma as a key with no value; no schema key has a space in it.
          .filter(([k, x]) => !(x === null && /\s/.test(k)))
          .map(([k, x]) => [k, strip(x)]));
      }
      return v;
    };
    return JSON.stringify(strip(parseYaml(source)));
  } catch { return null; }
}

/** True when the file changed only in words: comments, string contents, text between tags. */
export function isTextOnly(repo: string, base: string, file: string): boolean {
  if (TEXT_PATH.test(file)) return true;
  const before = gitShow(repo, base, file);
  const abs = path.join(repo, file);
  if (before === null || !existsSync(abs)) return false; // a new or deleted file is code
  const after = readFileSync(abs, 'utf8');
  if (/\.(ts|js|mjs|cjs)$/.test(file)) return sameCode(before, after, file);
  if (/\.html$/.test(file)) return htmlShape(before) === htmlShape(after);
  if (file === 'openapi.yaml') { const a = contractShape(before); return a !== null && a === contractShape(after); }
  if (/\.css$/.test(file)) return before.replace(/\/\*[\s\S]*?\*\//g, '') === after.replace(/\/\*[\s\S]*?\*\//g, '');
  if (/(^|\/)package\.json$/.test(file)) {
    const strip = (s: string) => { const j = JSON.parse(s) as Record<string, unknown>; delete j.scripts; return JSON.stringify(j); };
    try { return strip(before) === strip(after); } catch { return false; }
  }
  return false;
}

function flatStrings(o: unknown, out: Record<string, string> = {}, p = ''): Record<string, string> {
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const q = p ? `${p}.${k}` : k;
      if (typeof v === 'string') out[q] = v; else flatStrings(v, out, q);
    }
  }
  return out;
}

/**
 * The texts the change took out: old English locale values and removed string literals. `count` is
 * how many there were; `parts` are the pieces of 20 characters or more that a suite can be searched for.
 */
function removedTexts(repo: string, base: string, files: string[]): { count: number; parts: string[] } {
  const texts = new Set<string>();
  for (const f of files) {
    const before = gitShow(repo, base, f);
    const abs = path.join(repo, f);
    if (before === null || !existsSync(abs)) continue;
    const after = readFileSync(abs, 'utf8');
    if (f === 'aimeat/locales/en.json') {
      const a = flatStrings(JSON.parse(before)), b = flatStrings(JSON.parse(after));
      for (const [k, v] of Object.entries(a)) if (b[k] !== v) texts.add(v);
    } else if (/\.(ts|js|mjs|cjs)$/.test(f) && !f.startsWith('aimeat/test/')) {
      const now = new Set(codeShape(after, f).strings);
      for (const s of codeShape(before, f).strings) if (!now.has(s)) texts.add(s);
    }
  }
  // Placeholders split a sentence the tests may quote in parts; a part shorter than 20 characters
  // ("this site", "the paste") is in too many unrelated strings to point at a suite.
  const parts = new Set<string>();
  for (const t of texts) for (const p of t.split(/\{\{?\w+\}?\}|\$\{[^}]*\}/)) if (p.trim().length >= 20) parts.add(p.trim());
  return { count: texts.size, parts: [...parts] };
}

/** How many product files or removed texts make a text change wide (see the header). */
export const WIDE_FILES = 20;
export const WIDE_TEXTS = 100;

/**
 * Why a text change is wide, or null when it is not. A product file is one a person or an AI reads
 * in the running product: everything but Markdown, docs/ and the session guides under .claude/.
 */
export function isWideText(files: string[], removedCount: number): string | null {
  const product = files.filter(f => !/\.md$/.test(f) && !f.startsWith('docs/') && !f.startsWith('.claude/'));
  if (product.length >= WIDE_FILES) return `${product.length} product files changed`;
  if (removedCount >= WIDE_TEXTS) return `${removedCount} texts removed`;
  return null;
}

/** A file's code with only its comments dropped: what a suite does, whatever its comments say. */
function withoutComments(source: string, file: string): string {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const parts: string[] = [];
  const walk = (node: ts.Node): void => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const children = node.getChildren(sf);
    if (!children.length) { parts.push(node.getText(sf)); return; }
    for (const c of children) walk(c);
  };
  walk(sf);
  return parts.join(' ');
}

/** The E2E suites (by name) a text change can reach; `texts` are removedTexts' parts. */
export function targetedSuites(repo: string, base: string, files: string[], texts = removedTexts(repo, base, files).parts): string[] {
  const testDir = path.join(repo, 'aimeat', 'test');
  const suites = readdirSync(testDir).filter(n => /^e2e-.*\.ts$/.test(n));
  const picked = new Set<string>();
  // A suite whose code or strings changed runs; one whose comments alone changed does not.
  for (const f of files) {
    const m = /^aimeat\/test\/(e2e-[^/]*)\.ts$/.exec(f);
    if (!m || !suites.includes(`${m[1]}.ts`)) continue;
    const before = gitShow(repo, base, f);
    const after = readFileSync(path.join(repo, f), 'utf8');
    if (before === null || withoutComments(before, f) !== withoutComments(after, f)) picked.add(m[1]);
  }
  // A suite whose strings hold a text the change removed: it may assert the old words.
  if (texts.length) {
    for (const n of suites) {
      const literals = codeShape(readFileSync(path.join(testDir, n), 'utf8'), n).strings.join('\n');
      if (texts.some(t => literals.includes(t))) picked.add(n.replace(/\.ts$/, ''));
    }
  }
  return [...picked].sort();
}

/**
 * `wide` says why a text change also runs the full SQLite sweep, or is null. `fullWhy` says why a code
 * change runs the whole sweep (ready-reach.ts), or is null.
 */
export interface ReadyScope { full: boolean; code: string[]; suites: string[]; wide: string | null; fullWhy?: string | null }

/**
 * For code: the suites the changed code can reach (ready-reach.ts), or the whole sweep when a changed
 * file is on every request's path. For text: the suites that changed or quote the changed words, and
 * for a wide text change the reason it also runs the full sweep on SQLite. The suites a text change
 * picks are added to a code change's.
 */
export function readyScope(repo: string, base: string): ReadyScope {
  const files = changedFiles(repo, base);
  const code = files.filter(f => !isTextOnly(repo, base, f));
  const removed = removedTexts(repo, base, files);
  const textSuites = targetedSuites(repo, base, files, removed.parts);
  if (code.length) {
    const reach = codeReach(repo, code, base);
    if (reach.full) return { full: true, code, suites: [], wide: null, fullWhy: reach.full };
    return { full: false, code, suites: [...new Set([...reach.suites, ...textSuites])].sort(), wide: null, fullWhy: null };
  }
  return { full: false, code: [], suites: textSuites, wide: isWideText(files, removed.count) };
}
