/**
 * @file scripts/check-silent-catch.ts
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
 *   cd aimeat && pnpm exec tsx scripts/check-silent-catch.ts --strict   # CI-style gate
 *   cd aimeat && pnpm exec tsx scripts/check-silent-catch.ts --area src/storage --list
 * @version-history
 *   v1.0.0 — 2026-07-26 — Initial (silent-exception cleanup roadmap).
 */
import { ESLint } from 'eslint';
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

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const list = args.includes('--list');
const areaFilter = args.includes('--area') ? args[args.indexOf('--area') + 1] : undefined;

async function main(): Promise<void> {
  const eslint = new ESLint({
    // Ignore the repo config entirely: this run is only about one rule, everywhere it can apply.
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.js'],
        plugins: { aimeat: aimeatPlugin },
        languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
        rules: { [RULE]: 'error' },
      },
      {
        // .ts needs the TypeScript parser. Without it every backend file is a fatal parse error and
        // the run reports a cheerful zero — the very failure mode this rule exists to prevent, so
        // fatal messages are counted and printed below instead of being dropped.
        files: ['**/*.ts'],
        plugins: { aimeat: aimeatPlugin },
        languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: 'module' },
        rules: { [RULE]: 'error' },
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

  const results = await eslint.lintFiles(['src/**/*.ts', 'src/**/*.js', 'public/**/*.js']);

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

  const kinds = ['emptyCatch', 'returnsAbsence', 'discardsError'] as const;
  const kindLabel: Record<string, string> = {
    emptyCatch: 'empty', returnsAbsence: 'returns-absence', discardsError: 'discards',
  };

  console.log(`\n  Silent-exception backlog — rule ${RULE}\n`);
  console.log(`  ${'Area'.padEnd(28)}${'total'.padStart(7)}${'empty'.padStart(8)}${'absence'.padStart(9)}${'discards'.padStart(10)}`);
  console.log(`  ${'-'.repeat(62)}`);
  for (const [label, hits] of byArea) {
    const c = (k: string) => String(hits.filter(h => h.messageId === k).length).padStart(k === 'emptyCatch' ? 8 : k === 'returnsAbsence' ? 9 : 10);
    console.log(`  ${label.padEnd(28)}${String(hits.length).padStart(7)}${c('emptyCatch')}${c('returnsAbsence')}${c('discardsError')}`);
  }
  console.log(`  ${'-'.repeat(62)}`);
  const tot = (k: string) => selected.filter(h => h.messageId === k).length;
  console.log(`  ${'TOTAL'.padEnd(28)}${String(selected.length).padStart(7)}${String(tot('emptyCatch')).padStart(8)}${String(tot('returnsAbsence')).padStart(9)}${String(tot('discardsError')).padStart(10)}\n`);

  if (list) {
    for (const f of selected.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
      console.log(`  ${f.file}:${f.line}  ${kindLabel[f.messageId] ?? f.messageId}`);
    }
    console.log('');
  }

  for (const k of kinds) void k;

  if (strict && selected.length > 0) {
    console.error(`  ✗ ${selected.length} silent handler(s) found${areaFilter ? ` under ${areaFilter}` : ''}.\n`);
    process.exit(1);
  }
  if (selected.length === 0) console.log('  ✓ no silent handlers\n');
}

await main();
