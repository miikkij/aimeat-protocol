/**
 * @file scripts/check-silent-catch.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Measures and gates the silent-exception backlog: runs ONLY aimeat/no-silent-catch
 *   across the codebase, reports counts per area and per finding type, and with `--strict` refuses a
 *   NEW silent handler or a NEW exemption anywhere under src/ and public/.
 *
 *   Why a separate script: the pre-commit gate runs `lint --max-warnings 0`, so a rule cannot be
 *   introduced repo-wide at any severity until the backlog is zero. The repo's established pattern
 *   is "clean an area to zero, ratchet it to error, move on"; where an area is not at zero yet, a
 *   per-file ceiling holds it where it is.
 *
 *   What `--strict` holds, by area:
 *     - src/ and public/ outside src/static: the three original shapes at zero (eslint.config.js has
 *       the rule at `error` there), the fourth (substitute) per file against
 *       security/silent-catch-substitutes.json.
 *     - src/static (the served SDK libs, the app-catalog bundle, the standalone scripts): all four
 *       shapes per file and per shape against security/silent-catch-static-baseline.json. The rule
 *       is not on in eslint.config.js there, so a disable directive in a linted src/static file reads
 *       as unused to the repo lint; fix the handler instead.
 *     - Everywhere: every finding a disable directive suppresses is an exemption, counted per file
 *       against security/silent-catch-exemptions.json, and a directive with no reason after `--` is
 *       refused. An exemption is a finding somebody chose to keep, so adding one is as visible as
 *       adding the finding.
 *   A count over its ceiling fails; a count under it is named so the gain can be locked in. The
 *   comparisons are pure functions in scripts/lib/silent-catch-ratchet.ts.
 * @structure
 *   - AREAS: the reporting buckets (backend write paths first — that is where a swallow costs most)
 *   - STATIC / baselines: the three ceiling files and their seed reasons
 *   - main(): lint, group findings, print the table; `--strict` compares; `--seed <which>` writes one
 * @usage
 *   cd aimeat && pnpm exec tsx scripts/check-silent-catch.ts
 *   cd aimeat && pnpm exec tsx scripts/check-silent-catch.ts --strict   # check:fast, CI, the hook
 *   cd aimeat && pnpm exec tsx scripts/check-silent-catch.ts --area src/storage --list
 *   cd aimeat && pnpm exec tsx scripts/check-silent-catch.ts --seed substitutes|static|exemptions
 * @version-history
 *   v1.3.0 — 2026-10-16 — src/static is gated (W25 "An error is not an empty result"): all four shapes
 *     per file and per shape against security/silent-catch-static-baseline.json, seeded from that
 *     day's 408 findings. Exemptions are counted: every finding an eslint-disable directive suppresses
 *     is ratcheted per file against security/silent-catch-exemptions.json, and a directive with no
 *     reason after `--` is refused. `--seed` names the baseline it rewrites. The comparisons moved to
 *     scripts/lib/silent-catch-ratchet.ts so a unit test holds them.
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
import { SHAPES, shapeName, compareCeilings, compareShapeCeilings, countExemptions, type Comparison, type SuppressedLike } from './lib/silent-catch-ratchet.js';

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
 * Every area `--strict` gates. src/ and public/ outside STATIC are at zero for the three original
 * shapes and eslint keeps them there; STATIC is held per file and per shape by its own baseline,
 * because its backlog (408 on 2026-10-16) is not at zero and a new silent handler there still has
 * to be refused.
 */
const GATED_AREAS = ['src/', 'public/'];
const STATIC = 'src/static/';

const SECURITY = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'security');

/**
 * The substitute baseline, and why it is keyed by FILE and a COUNT rather than by site.
 *
 * The other three shapes are at zero in the gated areas outside src/static and eslint keeps them
 * there. The fourth arrived on 2026-09-13 over code written before it existed: 87 handlers in the two
 * directories the rule is already an error in. Turning it on in eslint.config.js would have refused
 * every session's every commit until all 87 were read, so it is on HERE and measured against this file.
 *
 * A catch handler has no stable name, and the sibling ratchets say plainly why a line number is not
 * one either: "an entry keyed by line stops covering the code it was written for as soon as anything
 * above it moves". So the unit is the file and the claim is a ceiling.
 */
const SUBSTITUTES = join(SECURITY, 'silent-catch-substitutes.json');
const STATIC_BASELINE = join(SECURITY, 'silent-catch-static-baseline.json');
const EXEMPTIONS = join(SECURITY, 'silent-catch-exemptions.json');

interface Baseline {
  note: string;
  /** file → how many it is allowed to hold, and why. */
  files: Record<string, { count: number; reason: string }>;
}
interface ShapeBaseline {
  note: string;
  /** file → shape name → how many it is allowed to hold, and why. */
  files: Record<string, { counts: Record<string, number>; reason: string }>;
}

const SEED_REASON = 'SEEDED 2026-09-13, NOT REVIEWED — this file answered a caught error with a value '
  + 'that says nothing failed, and whether that substitute is the right answer or a confident wrong '
  + 'one is a question nobody has read yet. Kept so the gate can refuse a NEW one.';

const STATIC_SEED_REASON = 'SEEDED 2026-10-16, NOT REVIEWED — these handlers were in this file when '
  + 'src/static came under the gate, and whether each one is a deliberate swallow or a failure shown '
  + 'as an empty result is a question nobody has read yet. Kept so the gate can refuse a NEW one.';

const EXEMPTION_SEED_REASON = 'SEEDED 2026-10-16 from the directives in place that day, NOT RE-READ — '
  + 'each directive carries the reason its author wrote after `--` on its own line; this entry only '
  + 'records how many findings they suppress, so that adding one is a visible change.';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const list = args.includes('--list');
const seedTarget = args.includes('--seed') ? (args[args.indexOf('--seed') + 1] ?? '') : undefined;
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

function readJson<T>(path: string, empty: T): T {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) as T : empty;
}

/** Print a comparison's failures (returns true when there were any) and its gains. */
function report(c: Comparison, what: string, file: string, advice: string[]): boolean {
  if (c.over.length > 0) {
    console.error(`  ✗ ${c.over.length} file(s) hold MORE ${what} than before:\n`);
    for (const line of c.over) console.error(`      ${line}`);
    console.error('');
    for (const line of advice) console.error(`  ${line}`);
    console.error('');
  }
  if (c.under.length > 0) {
    console.log(`  ✓ ${c.under.length} file(s) hold fewer ${what} than listed. Lower the count in`);
    console.log(`    security/${file} to lock the gain in:\n`);
    for (const line of c.under) console.log(`      ${line}`);
    console.log('');
  }
  return c.over.length > 0;
}

async function main(): Promise<void> {
  if (seedTarget !== undefined && !['substitutes', 'static', 'exemptions'].includes(seedTarget)) {
    console.error('  --seed takes the baseline to rewrite: substitutes, static or exemptions. Seeding forgives every entry in it.');
    process.exit(2);
  }
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
  const suppressed: { file: string; suppressed: SuppressedLike[] }[] = [];
  const unparsed: string[] = [];
  for (const r of results) {
    const rel = r.filePath.replace(/\\/g, '/').split('/aimeat/').pop() ?? r.filePath;
    for (const m of r.messages) {
      if (m.fatal) { unparsed.push(`${rel}:${m.line} ${m.message}`); continue; }
      if (m.ruleId !== RULE) continue;
      findings.push({ file: rel, line: m.line, messageId: m.messageId ?? 'unknown' });
    }
    if (r.suppressedMessages.length) suppressed.push({ file: rel, suppressed: r.suppressedMessages });
  }
  // A file that could not be parsed was NOT measured. Saying so is the whole point of this tool.
  if (unparsed.length) {
    console.error(`\n  ⚠ ${unparsed.length} file(s) could not be parsed and are therefore UNMEASURED:`);
    for (const u of unparsed.slice(0, 10)) console.error(`      ${u}`);
    if (unparsed.length > 10) console.error(`      … and ${unparsed.length - 10} more`);
  }

  const selected = areaFilter ? findings.filter(f => f.file.startsWith(areaFilter)) : findings;
  const inArea = (file: string) => !areaFilter || file.startsWith(areaFilter);
  const exemptions = countExemptions(suppressed.filter(s => inArea(s.file)), RULE);

  const byArea = new Map<string, Finding[]>();
  const claimed = new Set<Finding>();
  for (const area of AREAS) {
    const hits = selected.filter(f => !claimed.has(f) && area.match(f.file));
    hits.forEach(h => claimed.add(h));
    if (hits.length) byArea.set(area.label, hits);
  }
  const exemptByArea = (match: (p: string) => boolean) =>
    [...exemptions.perFile].filter(([f]) => match(f)).reduce((n, [, c]) => n + c, 0);

  const COLUMNS = SHAPES.map(s => ({ key: s.id, head: s.name, width: s.name.length + 3 }));
  const RULE_WIDTH = 28 + 7 + COLUMNS.reduce((n, c) => n + c.width, 0) + 10;

  console.log(`\n  Silent-exception backlog — rule ${RULE}\n`);
  console.log(`  ${'Area'.padEnd(28)}${'total'.padStart(7)}${COLUMNS.map(c => c.head.padStart(c.width)).join('')}${'exempted'.padStart(10)}`);
  console.log(`  ${'-'.repeat(RULE_WIDTH)}`);
  for (const area of AREAS) {
    const hits = byArea.get(area.label) ?? [];
    const exempt = exemptByArea(f => area.match(f) && !AREAS.slice(0, AREAS.indexOf(area)).some(a => a.match(f)));
    if (!hits.length && !exempt) continue;
    const cells = COLUMNS.map(c => String(hits.filter(h => h.messageId === c.key).length).padStart(c.width)).join('');
    console.log(`  ${area.label.padEnd(28)}${String(hits.length).padStart(7)}${cells}${String(exempt).padStart(10)}`);
  }
  console.log(`  ${'-'.repeat(RULE_WIDTH)}`);
  const tot = (k: string) => selected.filter(h => h.messageId === k).length;
  const exemptTotal = [...exemptions.perFile.values()].reduce((a, b) => a + b, 0);
  console.log(`  ${'TOTAL'.padEnd(28)}${String(selected.length).padStart(7)}${COLUMNS.map(c => String(tot(c.key)).padStart(c.width)).join('')}${String(exemptTotal).padStart(10)}\n`);

  if (list) {
    for (const f of selected.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
      console.log(`  ${f.file}:${f.line}  ${shapeName(f.messageId)}`);
    }
    console.log('');
  }

  const isGated = (file: string): boolean => GATED_AREAS.some(a => file.startsWith(a));
  const isStatic = (file: string): boolean => file.startsWith(STATIC);
  const perFile = (rows: Finding[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.file, (m.get(r.file) ?? 0) + 1);
    return new Map([...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  };
  const perFileShape = (rows: Finding[]): Map<string, Record<string, number>> => {
    const m = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const counts = m.get(r.file) ?? {};
      const s = shapeName(r.messageId);
      counts[s] = (counts[s] ?? 0) + 1;
      m.set(r.file, counts);
    }
    // Shapes in the table's order, so a re-seed diffs by count and never by key order.
    const ordered = (c: Record<string, number>) => Object.fromEntries(Object.entries(c)
      .sort((a, b) => SHAPES.findIndex(s => s.name === a[0]) - SHAPES.findIndex(s => s.name === b[0])));
    return new Map([...m].sort((a, b) => a[0].localeCompare(b[0])).map(([f, c]) => [f, ordered(c)]));
  };
  const staticNow = perFileShape(selected.filter(f => isStatic(f.file)));
  const substitutesNow = perFile(selected.filter(f => isGated(f.file) && !isStatic(f.file) && f.messageId === 'substitutesValue'));
  const exemptionsNow = new Map([...exemptions.perFile].filter(([f]) => isGated(f)));

  if (seedTarget) {
    // Seeding forgives the whole backlog, so it is a decision to be asked about rather than
    // maintenance — the same rule the security/*.json ratchets carry.
    if (seedTarget === 'substitutes') {
      const file: Baseline = {
        note: 'How many substitute-answering catch handlers each file is allowed to hold. A catch that '
          + 'returns a value saying nothing failed hands the caller a confident wrong answer; the rule\'s '
          + 'own header carries the case that found the shape. Seeded 2026-09-13 from the state of that '
          + 'day and NOT REVIEWED: an entry here is a question, not a clearance. Keyed by file and count '
          + 'because a catch handler has no stable name and a line number stops covering the code it was '
          + 'written for as soon as anything above it moves. Fixing one lowers its count; the gate names '
          + 'the gain so it can be locked in. Re-seeding forgives the lot.',
        files: Object.fromEntries([...substitutesNow].map(([f, count]) => [f, { count, reason: SEED_REASON }])),
      };
      writeFileSync(SUBSTITUTES, JSON.stringify(file, null, 2) + '\n', 'utf-8');
      console.log(`  seeded ${substitutesNow.size} file(s) → ${SUBSTITUTES}\n`);
    } else if (seedTarget === 'static') {
      const file: ShapeBaseline = {
        note: 'How many silent catch handlers of each shape (empty, absence, discards, substitute) each '
          + 'file under src/static is allowed to hold: the served SDK libs, the app-catalog bundle and the '
          + 'standalone scripts, which check:silent-catch reported and did not gate until 2026-10-16. '
          + 'Seeded that day from the state of the tree, with the developer\'s approval of the W25 '
          + 'acceptance criterion ("the silent-catch ratchet extends to src/static"), and NOT REVIEWED: '
          + 'an entry here is a question, not a clearance. Per shape, because fixing an empty catch does '
          + 'not buy room for a new substitute. Fixing one lowers its count; the gate names the gain so '
          + 'it can be locked in. Re-seeding forgives the lot.',
        files: Object.fromEntries([...staticNow].map(([f, counts]) => [f, { counts, reason: STATIC_SEED_REASON }])),
      };
      writeFileSync(STATIC_BASELINE, JSON.stringify(file, null, 2) + '\n', 'utf-8');
      console.log(`  seeded ${staticNow.size} file(s) → ${STATIC_BASELINE}\n`);
    } else {
      const file: Baseline = {
        note: 'How many silent-catch findings an eslint-disable directive suppresses in each file under '
          + 'src/ and public/. An exemption is a finding somebody chose to keep, so adding one has to be '
          + 'as visible as adding the finding: the gate refuses a file that holds more than its count, '
          + 'and refuses any directive with no reason after `--`. Counted from ESLint\'s own suppression '
          + 'record, so a block disable counts every finding it covers. Seeded 2026-10-16 with the '
          + 'developer\'s approval of the W25 acceptance criterion ("per-line exemptions counted"); the '
          + 'reasons are on the directives themselves and were not re-read when this was seeded. '
          + 'Removing one lowers its count; the gate names the gain so it can be locked in. Re-seeding '
          + 'forgives the lot.',
        files: Object.fromEntries([...exemptionsNow].map(([f, count]) => [f, { count, reason: EXEMPTION_SEED_REASON }])),
      };
      writeFileSync(EXEMPTIONS, JSON.stringify(file, null, 2) + '\n', 'utf-8');
      console.log(`  seeded ${exemptionsNow.size} file(s) → ${EXEMPTIONS}\n`);
    }
    return;
  }

  if (strict) {
    let failed = false;
    // Outside src/static the three original shapes are at zero and eslint keeps them there.
    const mustBeZero = selected.filter(f => isGated(f.file) && !isStatic(f.file) && f.messageId !== 'substitutesValue');
    if (mustBeZero.length > 0) {
      console.error(`  ✗ ${mustBeZero.length} silent handler(s) in an area that is supposed to be at zero:\n`);
      for (const f of mustBeZero.slice(0, 20)) console.error(`      ${f.file}:${f.line}`);
      console.error('\n  Log it, surface it, or add an eslint-disable WITH a reason after --.\n');
      failed = true;
    }

    if (exemptions.unreasoned.length > 0) {
      console.error(`  ✗ ${exemptions.unreasoned.length} eslint-disable directive(s) for ${RULE} give no reason:\n`);
      for (const at of exemptions.unreasoned.slice(0, 20)) console.error(`      ${at}`);
      console.error('\n  Write why the swallow is right after -- on the directive itself:');
      console.error(`  // eslint-disable-next-line ${RULE} -- <why nothing is lost>\n`);
      failed = true;
    }

    const wholeTree = !staged && !areaFilter;
    const subs = readJson<Baseline>(SUBSTITUTES, { note: '', files: {} });
    failed = report(compareCeilings(substitutesNow, subs.files, wholeTree), 'substitute values', 'silent-catch-substitutes.json', [
      'A catch that returns a value saying nothing failed hands the caller a confident',
      'wrong answer. Return something that carries the failure, let it propagate, log it,',
      'or add an eslint-disable WITH a reason.',
    ]) || failed;

    const stat = readJson<ShapeBaseline>(STATIC_BASELINE, { note: '', files: {} });
    failed = report(compareShapeCeilings(staticNow, stat.files, wholeTree), 'silent handlers under src/static', 'silent-catch-static-baseline.json', [
      'A failed read shown as an empty result is how an app came to write a default over the',
      'record it could not read (W25). Throw, return something that carries the failure, or log it.',
    ]) || failed;

    const ex = readJson<Baseline>(EXEMPTIONS, { note: '', files: {} });
    failed = report(compareCeilings(exemptionsNow, ex.files, wholeTree), `exemptions from ${RULE}`, 'silent-catch-exemptions.json', [
      'An eslint-disable is a finding somebody chose to keep. Fix the handler, or, when the',
      'swallow is right, raise the file\'s count in security/silent-catch-exemptions.json in the',
      'same change and say why in the directive after --.',
    ]) || failed;

    if (failed) process.exit(1);
    const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
    const staticTotal = [...staticNow.values()].reduce((n, c) => n + Object.values(c).reduce((a, b) => a + b, 0), 0);
    console.log(`  ✓ outside src/static the three cleaned shapes are at zero, and ${sum(substitutesNow)} listed substitute(s) held steady`);
    console.log(`  ✓ src/static: ${staticTotal} listed handler(s) in ${staticNow.size} file(s) held steady`);
    console.log(`  ✓ exemptions: ${sum(exemptionsNow)} in ${exemptionsNow.size} file(s), each with a reason, held steady\n`);
    return;
  }
  if (selected.length === 0) console.log('  ✓ no silent handlers\n');
}

await main();
