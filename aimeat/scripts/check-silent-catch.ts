/**
 * @file scripts/check-silent-catch.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Measures the silent-exception backlog: runs ONLY aimeat/no-silent-catch across the
 *   codebase and reports counts per area and per finding type. This is the progress meter for the
 *   cleanup roadmap — the rule itself is enforced at `error` in eslint.config.js for the areas
 *   already cleaned, and this script shows what is left everywhere else without failing the gate.
 *
 *   Why a separate script: the pre-commit gate runs `lint --max-warnings 0`, so a rule cannot be
 *   introduced repo-wide at any severity until the backlog is zero. The repo's established pattern
 *   is "clean an area to zero, ratchet it to error, move on"; this measures the remaining work.
 * @structure
 *   - AREAS: the reporting buckets (backend write paths first — that is where a swallow costs most)
 *   - main(): lint, group findings, print the table; `--strict` exits 1 when anything is found
 * @usage
 *   cd aimeat && pnpm exec tsx scripts/check-silent-catch.ts
 *   cd aimeat && pnpm exec tsx scripts/check-silent-catch.ts --strict   # check:fast, CI, the hook
 *   cd aimeat && pnpm exec tsx scripts/check-silent-catch.ts --area src/storage --list
 *   cd aimeat && pnpm exec tsx scripts/check-silent-catch.ts --seed     # rewrite the substitute baseline
 * @version-history
 *   v1.2.0 — 2026-09-13 — The rule's fourth shape (a catch answering with a substitute value) is
 *     turned ON here and nowhere else, counted in its own column, and ratcheted per file against
 *     security/silent-catch-substitutes.json with `--seed` to write it. This script also joins
 *     FAST_CHECKS: the whole-tree pass had run nowhere at all, so the hook's staged view was the
 *     only thing calling it and the fourth shape would have had no keeper.
 *   v1.1.0 — 2026-09-05 — `--staged`: lint only the files about to be committed. The hook's
 *     whole-tree pass was a second full ESLint run, 35 s of every commit, for a rule a new file
 *     can only break in itself. CI keeps the whole-tree pass.
 *   v1.0.0 — 2026-07-26 — Initial (silent-exception cleanup roadmap).
 */
import { ESLint } from 'eslint';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// The parser comes from the installed `typescript-eslint` meta-package (as eslint.config.js does)
// rather than a new direct dependency on @typescript-eslint/parser.
import tseslint from 'typescript-eslint';
// @ts-expect-error — eslint-rules/index.js is plain JS in the ESLint plugin format, with no .d.ts.
import aimeatPlugin from '../eslint-rules/index.js';

const tsParser = tseslint.parser;

const RULE = 'aimeat/no-silent-catch';

/** Reporting buckets, most costly first. A swallow in a write path hides data loss. */
const AREAS: { label: string; match: (p: string) => boolean }[] = [
  { label: 'src/storage (write paths)', match: p => p.startsWith('src/storage/') },
  { label: 'src/auth', match: p => p.startsWith('src/auth/') },
  { label: 'src/routes', match: p => p.startsWith('src/routes/') },
  { label: 'src/services', match: p => p.startsWith('src/services/') },
  { label: 'src/mcp', match: p => p.startsWith('src/mcp/') },
  { label: 'src/cli', match: p => p.startsWith('src/cli/') },
  { label: 'src/other', match: p => p.startsWith('src/') && !p.startsWith('src/static/') },
  { label: 'src/static (browser)', match: p => p.startsWith('src/static/') },
  { label: 'public (browser)', match: p => p.startsWith('public/') },
];

/**
 * Areas that are AT ZERO and must stay there. `--strict` (the CI/hook gate) fails only on these, so
 * the gate protects what has been cleaned without blocking on what has not. Add an area here the
 * moment it reaches zero — that is the whole ratchet.
 *
 * Still outstanding, reported but not gated: src/static (the served SDK libs, the app-catalog bundle
 * and a few standalone scripts). They are browser code in a different style — `function ()`
 * callbacks rather than arrows — and need their own reporting channel per bundle, so they are their
 * own piece of work rather than a variation on this one.
 */
const GATED_AREAS = ['src/', 'public/'];
const UNGATED = ['src/static/'];

/**
 * The substitute baseline, and why it is keyed by FILE and a COUNT rather than by site.
 *
 * The other three shapes are at zero in the gated areas and eslint keeps them there. The fourth
 * arrived on 2026-09-13 over code written before it existed: 87 handlers in the two directories the
 * rule is already an error in. Turning it on in eslint.config.js would have refused every session's
 * every commit until all 87 were read, so it is on HERE and measured against this file.
 *
 * A catch handler has no stable name, and the sibling ratchets say plainly why a line number is not
 * one either: "an entry keyed by line stops covering the code it was written for as soon as anything
 * above it moves". So the unit is the file and the claim is a ceiling. A new substitute raises a
 * file's count and the gate refuses it; fixing one lowers the count and the gate says so, which is
 * the direction this is supposed to move in.
 */
const BASELINE = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'security', 'silent-catch-substitutes.json');

interface Baseline {
  note: string;
  /** file → how many substitute handlers it is allowed to hold, and why nobody has fixed them. */
  files: Record<string, { count: number; reason: string }>;
}

const SEED_REASON = 'SEEDED 2026-09-13, NOT REVIEWED — this file answered a caught error with a value '
  + 'that says nothing failed, and whether that substitute is the right answer or a confident wrong '
  + 'one is a question nobody has read yet. Kept so the gate can refuse a NEW one.';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const list = args.includes('--list');
const seed = args.includes('--seed');
const staged = args.includes('--staged');
const areaFilter = args.includes('--area') ? args[args.indexOf('--area') + 1] : undefined;

const EVERYTHING = ['src/**/*.ts', 'src/**/*.js', 'public/**/*.js'];

/**
 * The files git is about to commit, as paths relative to this package. `--staged` is the hook's
 * mode: a new silent handler can only be in a file the commit touches, so the whole-tree pass —
 * a second full ESLint run of every file, 35 s on 2026-09-05 — is the CI's job and not the
 * commit's. Deleted files are left out (nothing to lint), renamed and copied ones are in.
 */
function stagedFiles(): string[] {
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { encoding: 'utf8' });
  return out.split('\n')
    .map(l => l.trim().replace(/^aimeat\//, ''))
    .filter(f => /^(src\/.*\.(ts|js)|public\/.*\.js)$/.test(f) && existsSync(f));
}

async function main(): Promise<void> {
  const eslint = new ESLint({
    // Ignore the repo config entirely: this run is only about one rule, everywhere it can apply.
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.js'],
        plugins: { aimeat: aimeatPlugin },
        languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
        rules: { [RULE]: ['error', { substitutes: true }] },
      },
      {
        // .ts needs the TypeScript parser. Without it every backend file is a fatal parse error and
        // the run reports a cheerful zero — the very failure mode this rule exists to prevent, so
        // fatal messages are counted and printed below instead of being dropped.
        files: ['**/*.ts'],
        plugins: { aimeat: aimeatPlugin },
        languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: 'module' },
        rules: { [RULE]: ['error', { substitutes: true }] },
      },
      {
        // Vendored/minified/generated bundles are not ours to clean.
        ignores: [
          '**/node_modules/**', '**/*.min.js', 'public/lib/**', 'public/cortex-bundled/**',
          'src/static/sdk-libs/**/dist/**', 'src/static/app-catalog/dist/**', '**/dist/**',
        ],
      },
    ],
  });

  let targets = EVERYTHING;
  if (staged) {
    const candidates = stagedFiles();
    targets = [];
    for (const f of candidates) if (!await eslint.isPathIgnored(f)) targets.push(f);
    if (targets.length === 0) {
      console.log('\n  ✓ no staged file is in scope of the rule (--staged); the whole tree is CI\'s pass\n');
      return;
    }
    console.log(`\n  --staged: ${targets.length} file(s) about to be committed`);
  }
  const results = await eslint.lintFiles(targets);

  type Finding = { file: string; line: number; messageId: string };
  const findings: Finding[] = [];
  const unparsed: string[] = [];
  for (const r of results) {
    const rel = r.filePath.replace(/\\/g, '/').split('/aimeat/').pop() ?? r.filePath;
    for (const m of r.messages) {
      if (m.fatal) { unparsed.push(`${rel}:${m.line} ${m.message}`); continue; }
      if (m.ruleId !== RULE) continue;
      findings.push({ file: rel, line: m.line, messageId: m.messageId ?? 'unknown' });
    }
  }
  // A file that could not be parsed was NOT measured. Saying so is the whole point of this tool.
  if (unparsed.length) {
    console.error(`\n  ⚠ ${unparsed.length} file(s) could not be parsed and are therefore UNMEASURED:`);
    for (const u of unparsed.slice(0, 10)) console.error(`      ${u}`);
    if (unparsed.length > 10) console.error(`      … and ${unparsed.length - 10} more`);
  }

  const selected = areaFilter ? findings.filter(f => f.file.startsWith(areaFilter)) : findings;

  const byArea = new Map<string, Finding[]>();
  const claimed = new Set<Finding>();
  for (const area of AREAS) {
    const hits = selected.filter(f => !claimed.has(f) && area.match(f.file));
    hits.forEach(h => claimed.add(h));
    if (hits.length) byArea.set(area.label, hits);
  }

  const kindLabel: Record<string, string> = {
    emptyCatch: 'empty', returnsAbsence: 'returns-absence', discardsError: 'discards',
    substitutesValue: 'substitute',
  };

  const COLUMNS = [
    { key: 'emptyCatch', head: 'empty', width: 8 },
    { key: 'returnsAbsence', head: 'absence', width: 9 },
    { key: 'discardsError', head: 'discards', width: 10 },
    { key: 'substitutesValue', head: 'substitute', width: 12 },
  ] as const;
  const RULE_WIDTH = 28 + 7 + COLUMNS.reduce((n, c) => n + c.width, 0);

  console.log(`\n  Silent-exception backlog — rule ${RULE}\n`);
  console.log(`  ${'Area'.padEnd(28)}${'total'.padStart(7)}${COLUMNS.map(c => c.head.padStart(c.width)).join('')}`);
  console.log(`  ${'-'.repeat(RULE_WIDTH)}`);
  for (const [label, hits] of byArea) {
    const cells = COLUMNS.map(c => String(hits.filter(h => h.messageId === c.key).length).padStart(c.width)).join('');
    console.log(`  ${label.padEnd(28)}${String(hits.length).padStart(7)}${cells}`);
  }
  console.log(`  ${'-'.repeat(RULE_WIDTH)}`);
  const tot = (k: string) => selected.filter(h => h.messageId === k).length;
  console.log(`  ${'TOTAL'.padEnd(28)}${String(selected.length).padStart(7)}${COLUMNS.map(c => String(tot(c.key)).padStart(c.width)).join('')}\n`);

  if (list) {
    for (const f of selected.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
      console.log(`  ${f.file}:${f.line}  ${kindLabel[f.messageId] ?? f.messageId}`);
    }
    console.log('');
  }

  const isGated = (f: Finding): boolean =>
    GATED_AREAS.some(a => f.file.startsWith(a)) && !UNGATED.some(a => f.file.startsWith(a));
  const perFile = (rows: Finding[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.file, (m.get(r.file) ?? 0) + 1);
    return new Map([...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  };

  if (seed) {
    // Seeding forgives the whole backlog, so it is a decision to be asked about rather than
    // maintenance — the same rule the security/*.json ratchets carry.
    const counts = perFile(selected.filter(f => isGated(f) && f.messageId === 'substitutesValue'));
    const file: Baseline = {
      note: 'How many substitute-answering catch handlers each file is allowed to hold. A catch that '
        + 'returns a value saying nothing failed hands the caller a confident wrong answer; the rule\'s '
        + 'own header carries the case that found the shape. Seeded 2026-09-13 from the state of that '
        + 'day and NOT REVIEWED: an entry here is a question, not a clearance. Keyed by file and count '
        + 'because a catch handler has no stable name and a line number stops covering the code it was '
        + 'written for as soon as anything above it moves. Fixing one lowers its count; the gate names '
        + 'the gain so it can be locked in. Re-seeding forgives the lot.',
      files: Object.fromEntries([...counts].map(([f, count]) => [f, { count, reason: SEED_REASON }])),
    };
    writeFileSync(BASELINE, JSON.stringify(file, null, 2) + '\n', 'utf-8');
    console.log(`  seeded ${counts.size} file(s), ${[...counts.values()].reduce((a, b) => a + b, 0)} handler(s) → ${BASELINE}\n`);
    return;
  }

  if (strict) {
    const gated = selected.filter(isGated);
    // The three original shapes are at zero here and eslint keeps them there. A finding is a break.
    const mustBeZero = gated.filter(f => f.messageId !== 'substitutesValue');
    if (mustBeZero.length > 0) {
      console.error(`  ✗ ${mustBeZero.length} silent handler(s) in an area that is supposed to be at zero:\n`);
      for (const f of mustBeZero.slice(0, 20)) console.error(`      ${f.file}:${f.line}`);
      console.error('\n  Log it, surface it, or add an eslint-disable WITH a reason.\n');
      process.exit(1);
    }

    // The fourth shape is a ratchet: a file may not hold more than the baseline says.
    const base: Baseline = existsSync(BASELINE)
      ? JSON.parse(readFileSync(BASELINE, 'utf-8')) as Baseline
      : { note: '', files: {} };
    const now = perFile(gated.filter(f => f.messageId === 'substitutesValue'));
    const over: string[] = [];
    const under: string[] = [];
    for (const [f, count] of now) {
      const allowed = base.files[f]?.count ?? 0;
      if (count > allowed) over.push(`${f}: ${count} now, ${allowed} allowed`);
    }
    // Only the whole-tree pass may say a file improved. In `--staged` mode every file the commit
    // does not touch was never linted, so it would read as zero and the gate would claim 80 gains.
    if (!staged) {
      for (const [f, entry] of Object.entries(base.files)) {
        const count = now.get(f) ?? 0;
        if (count < entry.count) under.push(`${f}: ${count} now, ${entry.count} listed`);
      }
    }
    if (over.length > 0) {
      console.error(`  ✗ ${over.length} file(s) answer a caught error with MORE substitute values than before:\n`);
      for (const line of over) console.error(`      ${line}`);
      console.error('\n  A catch that returns a value saying nothing failed hands the caller a confident');
      console.error('  wrong answer. Return something that carries the failure, let it propagate, log it,');
      console.error('  or add an eslint-disable WITH a reason.\n');
      process.exit(1);
    }
    if (under.length > 0) {
      console.log(`  ✓ ${under.length} file(s) hold fewer substitutes than listed. Lower the count in`);
      console.log(`    security/silent-catch-substitutes.json to lock the gain in:\n`);
      for (const line of under) console.log(`      ${line}`);
      console.log('');
    }
    const listed = [...now.values()].reduce((a, b) => a + b, 0);
    const backlog = selected.length - gated.length;
    console.log(`  ✓ gated areas: the three cleaned shapes are at zero, and ${listed} listed substitute(s) held steady`);
    if (backlog > 0) console.log(`    ${backlog} still open in ${UNGATED.join(', ')} (reported, not gated)`);
    console.log('');
    return;
  }
  if (selected.length === 0) console.log('  ✓ no silent handlers\n');
}

await main();
