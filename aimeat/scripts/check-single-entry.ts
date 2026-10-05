/**
 * @file scripts/check-single-entry.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A security decision that has one function of its own is made only through that
 *   function. The secaudit 2026-10 proposals C1 to C4 and C7 each moved hand copies of one decision
 *   into one function; this gate keeps the copies from coming back.
 *
 *   WHY. The October 2026 audit found the same decision written out by hand in many files, and the
 *   copies had drifted: a password checked without the account lock on one route, an account deleted
 *   without its agents and records on another, the operator's agent admitted on MCP and refused on
 *   REST. Each copy was right the day it was written. A machine can count them; a reviewer cannot.
 *
 *   WHAT IT READS. Every `.ts` file under src/ except src/static and src/generated, tokenised with
 *   the compiler's scanner so comments are not findings, and each line rebuilt from its tokens with a
 *   space only between two words, so `roles ?.includes( 'operator' )` and `roles?.includes('operator')`
 *   are the same text.
 *   Each RULE is a pattern on that text and the files where it may appear, with a ceiling per file
 *   and the sentence that says why the file is right. The ceilings live in
 *   security/single-entry-baseline.json.
 *
 *   IT FAILS on a file that is not listed, a file over its ceiling, and a file UNDER its ceiling
 *   (lower the ceiling in the same change: the count only goes down, and a ceiling left high is room
 *   for the next copy). `--seed` writes today's counts for the rules named after it, keeping every
 *   reason already written; seeding forgives a backlog, so it is a decision, not maintenance.
 * @structure RULES · lineTexts(source) · count(rule) · main()
 * @usage
 *   cd aimeat && pnpm check:single-entry           # the gate
 *   cd aimeat && pnpm check:single-entry --list    # every file each rule counts
 *   cd aimeat && pnpm check:single-entry --seed operator-role   # rewrite one rule's ceilings
 * @version-history
 *   v1.2.0 — 2026-10-05 — Rules agent-role, wildcard-test and caller-built: the caller is the
 *     CallerContext (services/caller-context.ts), and the remaining hand tests and hand-built callers
 *     only go down (secaudit 2026-10, C9).
 *   v1.1.0 — 2026-10-05 — Rule html-escape: HTML is escaped with escapeHtml (utils/html-escape.ts), which escapes all five characters (secaudit 2026-10, C8).
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, C1, C2 and C7).
 */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'security', 'single-entry-baseline.json');

interface Rule {
  id: string;
  /** What the one function is, for the refusal. */
  label: string;
  /** Matched against each line rebuilt from its tokens, with no spaces. */
  pattern: RegExp;
  /** Directories under src/ the rule does not read: the function's own layer. */
  skipDirs?: string[];
}

const RULES: Rule[] = [
  {
    id: 'password-verify',
    label: 'An account password is checked only by checkPassword (services/password-check.ts), which applies the account lock (C1)',
    pattern: /\bverifyPassword\(/,
  },
  {
    id: 'delete-owner',
    label: 'An account is deleted only by eraseOwner (services/owner-erasure.ts), which also clears what the storage cascade does not reach: memory, consents, sessions, grants, audit rows (C7)',
    pattern: /\bstorage\.deleteOwner\(/,
  },
  {
    id: 'operator-role',
    label: 'An operator check asks isOperatorCaller or operatorOverride (services/operator-override.ts), so the operator\'s agent holding operator:admin passes on REST as on MCP and a pass in another person\'s account writes the operator trail (C2)',
    pattern: /roles\)?\??\.includes\(['"]operator['"]\)/,
    // utils/operator-account.ts is the account-record question, isOperatorAccount.
    skipDirs: ['src/auth/', 'src/utils/operator-account.ts'],
  },
  {
    id: 'scope-test',
    label: 'Whether a principal holds a scope is asked with scopeIsCovered, and the node ceiling with exceedsCeiling (utils/scope-coverage.ts), which know the words no wildcard carries (C3)',
    // A domain wildcard built or written by hand: includes(`${domain}:*`) or includes('memory:*').
    pattern: /includes\((`\$\{[^}]+\}:\*`|['"][a-z-]+:\*['"])\)/,
    skipDirs: ['src/utils/scope-coverage.ts'],
  },
  {
    id: 'uncapped-read',
    label: 'A response body is read under a ceiling with readJson, readText, readBodyCapped or readBodyPrefix (utils/read-capped.ts): json(), text() and arrayBuffer() hold the whole body before anything measures it (C6)',
    // An empty-argument body read; Express's res.json(x) takes an argument and is not one.
    pattern: /\.(json|text|arrayBuffer)\(\)/,
    // src/data holds app, cortex and extension code shipped as data: it runs in a browser tab or an
    // extension sandbox, not on the node.
    skipDirs: ['src/utils/read-capped.ts', 'src/data/'],
  },
  {
    id: 'operator-route',
    label: 'An operator route is gated by requireOperator(storage) (auth/middleware.ts), which admits the operator\'s agent holding operator:admin as the MCP admin tools do (C2)',
    pattern: /requireRole\(['"]operator['"]\)/,
    skipDirs: ['src/auth/'],
  },
  {
    id: 'html-escape',
    label: 'HTML is escaped with escapeHtml (utils/html-escape.ts), which escapes all five characters (C8)',
    // A hand-written escaper's `<` step, `.replace(/</g, '&lt;')`, as the rebuilt line reads it.
    pattern: /replace\(\/<\/g,['"]&lt;['"]\)/,
    // src/data holds app and cortex code shipped as data, which runs in a browser, not on the node.
    skipDirs: ['src/utils/html-escape.ts', 'src/data/'],
  },
  {
    id: 'owner-role',
    label: 'The account holder in person is asked with isOwnerInPerson (utils/gaii.ts), which also refuses an agent, an ecosystem app, an app grant and a visitor (C4)',
    pattern: /roles\)?\??\.includes\(['"]owner['"]\)/,
    skipDirs: ['src/auth/', 'src/utils/gaii.ts'],
  },
  {
    id: 'email-pattern',
    label: 'An e-mail address is checked with isValidEmail (utils/email-validator.ts), which also caps the length (M2)',
    pattern: /\[\^\\s@\]\+@/,
    skipDirs: ['src/utils/email-validator.ts', 'src/data/', 'src/static/'],
  },
  {
    id: 'agent-name-pattern',
    label: 'An agent name is checked with validateAgentName or isValidAgentName (utils/gaii.ts); the looser {1,63} pattern admitted names no agent can have (M2)',
    pattern: /\[a-z0-9\]\[a-z0-9-\]\{1,63\}\$/,
    skipDirs: ['src/utils/gaii.ts'],
  },
  {
    id: 'agent-role',
    label: 'What kind of principal a caller is, is asked of its caller object (services/caller-context.ts: kind, inPerson), built once per request (callerOf) or per MCP session (C9)',
    pattern: /roles\)?\??\.includes\(['"]agent['"]\)/,
    skipDirs: ['src/auth/', 'src/utils/gaii.ts', 'src/services/caller-context.ts'],
  },
  {
    id: 'wildcard-test',
    label: 'A held scope is asked with scopeIsCovered (utils/scope-coverage.ts) or the caller object\'s has(word); a hand `includes(\'*\')` misses the words no wildcard carries (C9)',
    pattern: /includes\(['"]\*['"]\)/,
    skipDirs: ['src/utils/scope-coverage.ts', 'src/data/', 'src/static/'],
  },
  {
    id: 'caller-built',
    label: 'A caller is the CallerContext (services/caller-context.ts), not an object built at the call site with a literal role: the MCP session\'s comes from register-all.ts, a request\'s from callerOf (C9)',
    pattern: /roles:\[['"]agent['"]\]/,
    skipDirs: ['src/services/caller-context.ts', 'src/auth/'],
  },
  {
    id: 'request-caller-built',
    label: 'A route\'s caller is callerOf(req) (middleware/caller.ts), built once per request with its answers on it, not an object copied field by field from req.auth (C9)',
    pattern: /roles:req\.auth!?\.roles/,
    skipDirs: ['src/middleware/caller.ts', 'src/auth/'],
  },
];

interface FileEntry { count: number; why: string }
type Baseline = { note: string; rules: Record<string, Record<string, FileEntry>> };

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'static' || name === 'generated' || name === 'node_modules') continue;
      walk(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

const WORD = /[\w$]/;

/** One space between two word tokens (`async function f`), none around punctuation. */
function joinToken(line: string, token: string): string {
  return line && WORD.test(line.slice(-1)) && WORD.test(token[0] ?? '') ? `${line} ${token}` : line + token;
}

/** Each line's tokens, spaced only between words; comments and whitespace are not tokens. */
export function lineTexts(source: string): string[] {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source);
  const lines: string[] = [];
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) starts.push(i + 1);
  const lineOf = (pos: number): number => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid]! <= pos) lo = mid; else hi = mid - 1; }
    return lo;
  };
  // Inside `${ … }` the closing brace ends the expression, not a block: the scanner is told so, or
  // it reads the rest of the template as code (or the rest of the file as a template).
  const braces: ('block' | 'template')[] = [];
  let kind = scanner.scan();
  while (kind !== ts.SyntaxKind.EndOfFileToken) {
    if (kind === ts.SyntaxKind.TemplateHead) braces.push('template');
    else if (kind === ts.SyntaxKind.OpenBraceToken) braces.push('block');
    else if (kind === ts.SyntaxKind.CloseBraceToken) {
      if (braces.pop() === 'template') {
        kind = scanner.reScanTemplateToken(false);
        if (kind === ts.SyntaxKind.TemplateMiddle) braces.push('template');
      }
    }
    const line = lineOf(scanner.getTokenStart());
    lines[line] = joinToken(lines[line] ?? '', scanner.getTokenText());
    // A regex literal, read as a division by the scanner, would swallow the line's tokens wrongly;
    // ask for it again as a regex when a slash follows something that cannot end an expression.
    if (kind === ts.SyntaxKind.SlashToken || kind === ts.SyntaxKind.SlashEqualsToken) {
      const prev = (lines[line] ?? '').slice(0, -1);
      if (prev === '' || /[=(,:!&|?{};[]$/.test(prev)) {
        scanner.reScanSlashToken();
        lines[line] = joinToken(prev, scanner.getTokenText());
      }
    }
    kind = scanner.scan();
  }
  return lines.map((l) => l ?? '');
}

function countAll(): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = Object.fromEntries(RULES.map((r) => [r.id, {}]));
  for (const file of walk(path.join(ROOT, 'src'))) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const lines = lineTexts(readFileSync(file, 'utf-8'));
    for (const rule of RULES) {
      if (rule.skipDirs?.some((d) => rel.startsWith(d))) continue;
      const n = lines.filter((l) => rule.pattern.test(l)).length;
      if (n > 0) out[rule.id]![rel] = n;
    }
  }
  return out;
}

function readBaseline(): Baseline {
  if (!existsSync(BASELINE)) return { note: '', rules: {} };
  return JSON.parse(readFileSync(BASELINE, 'utf-8')) as Baseline;
}

export function main(): boolean {
  const args = process.argv.slice(2);
  const counts = countAll();
  const baseline = readBaseline();

  if (args[0] === '--seed') {
    const ids = args.slice(1);
    for (const rule of RULES) {
      if (ids.length > 0 && !ids.includes(rule.id)) continue;
      const old = baseline.rules[rule.id] ?? {};
      baseline.rules[rule.id] = Object.fromEntries(Object.entries(counts[rule.id]!).sort(([a], [b]) => a.localeCompare(b))
        .map(([file, count]) => [file, { count, why: old[file]?.why ?? 'UNREVIEWED' }]));
    }
    writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + '\n');
    console.log(`Seeded ${ids.length ? ids.join(', ') : 'every rule'} into ${path.relative(ROOT, BASELINE)}.`);
    return true;
  }

  const problems: string[] = [];
  for (const rule of RULES) {
    const allowed = baseline.rules[rule.id] ?? {};
    const found = counts[rule.id]!;
    if (args.includes('--list')) {
      console.log(`\n${rule.id}: ${rule.label}`);
      for (const [file, n] of Object.entries(found)) console.log(`  ${String(n).padStart(3)}  ${file}  ${allowed[file] ? '' : '(not listed)'}`);
    }
    for (const [file, n] of Object.entries(found)) {
      const entry = allowed[file];
      if (!entry) problems.push(`${rule.id}: ${file} has ${n}, and the file is not listed. ${rule.label}.`);
      else if (n > entry.count) problems.push(`${rule.id}: ${file} has ${n}, its ceiling is ${entry.count}. ${rule.label}.`);
      else if (n < entry.count) problems.push(`${rule.id}: ${file} has ${n}, under its ceiling ${entry.count}: lower the ceiling in security/single-entry-baseline.json.`);
    }
    for (const file of Object.keys(allowed)) {
      if (!(file in found)) problems.push(`${rule.id}: ${file} is listed and has none any more: remove its entry.`);
    }
  }

  const total = RULES.map((r) => `${r.id} ${Object.values(counts[r.id]!).reduce((a, b) => a + b, 0)}`).join(' · ');
  if (problems.length > 0) {
    for (const p of problems) console.error(`✖ ${p}`);
    console.error(`\n${problems.length} problem(s). Counts: ${total}.`);
    return false;
  }
  console.log(`✓ single entry: ${total}`);
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main() ? 0 : 1);
}
