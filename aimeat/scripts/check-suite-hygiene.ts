/**
 * @file scripts/check-suite-hygiene.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Six counts per E2E suite that may only fall: what the report of 2026-11-15 (docs/
 *   internal, sections 2.4, 2.5 and 5) found copied, loose or unchecked in the suites. A suite may
 *   not count more of anything than aimeat/security/suite-hygiene-baseline.json records for it, and a
 *   suite the baseline does not name records zero, so a NEW suite starts clean.
 *
 *     ownHarness    defines its own test() instead of importing test/helpers/harness.ts (685 of 710)
 *     deviceFlow    writes the device-authorization calls out instead of test/helpers/agent-device.ts
 *     mcpOauth      writes the MCP OAuth PKCE round out instead of helpers/mcp-oauth-pkce.ts or
 *                   helpers/mcp-session.ts
 *     looseRefusal  a refusal held by one half only: `assert(x.status !== 200 …)` (or `!== 404`,
 *                   `>= 400`) passes on a 500, and `?.code !== '…'` with no status beside it passes on
 *                   any status; expectRefusal() in the harness holds both
 *     lines         lines past 800 after the leading header (the limit src/ has; the lint rule is off
 *                   for test/, so this is where it is held)
 *     lintErrors    ESLint errors (`pnpm lint:tests`), which no hook, gate or CI step read before
 *
 *   A suite that tests the device flow or the OAuth round ITSELF writes the calls out on purpose;
 *   a line `// suite-hygiene: tests the device flow` or `// suite-hygiene: tests the oauth round`
 *   anywhere in it takes that count off for that file.
 *
 *   A count that falls below the baseline is reported, and `--update` writes the lower number, so the
 *   baseline follows every improvement. `--seed` writes the whole baseline from today's counts; it
 *   forgives everything, so it is a decision for the developer, never maintenance.
 * @structure METRICS · suiteCounts() · lintCounts() · main()
 * @usage
 *   cd aimeat && pnpm check:suite-hygiene             # the gate
 *   cd aimeat && pnpm check:suite-hygiene --update    # lower the baseline where counts fell
 *   cd aimeat && pnpm check:suite-hygiene --no-lint   # skip ESLint (about 100 s cold)
 * @version-history
 *   v1.0.0 -- 2026-11-15 -- Initial (report of 2026-11-15, 5.2, 5.3, 5.4 and 5.6).
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const METRICS = ['ownHarness', 'deviceFlow', 'mcpOauth', 'looseRefusal', 'lines', 'lintErrors'] as const;
export type Metric = typeof METRICS[number];
export type Counts = Partial<Record<Metric, number>>;

const OWN_TEST = /(?:async\s+function\s+test\s*\(|const\s+test\s*=\s*async\b)/;
// `status !== <any code>` and `status >= 400` inside an assert pass on a 500 as well; the sample of
// the August audit's part E (2026-11-15) found both shapes still open.
const LOOSE_STATUS = /assert\(\s*[\w.?!]+\.status\s*(?:!==?\s*\d{3}\b|>=?\s*400\b)/g;
const LOOSE_CODE = /\?\.code\s*!==?\s*['"`]/g;
const MAX_LINES = 800;

/** Lines after the leading header comment, the way aimeat/max-file-lines counts them in src/. */
function bodyLines(text: string): number {
    const end = text.startsWith('/**') ? text.indexOf('*/') : -1;
    const body = end >= 0 ? text.slice(end + 2) : text;
    return body.split(/\r?\n/).length;
}

/** Every count but lintErrors for one suite's source. */
export function suiteCounts(text: string): Counts {
    const c: Counts = {};
    if (OWN_TEST.test(text) && !/helpers\/harness\.js/.test(text)) c.ownHarness = 1;
    if (/\/v1\/agents\/device-token/.test(text) && !/helpers\/agent-device\.js/.test(text) && !/suite-hygiene: tests the device flow/.test(text)) c.deviceFlow = 1;
    if (/code_challenge/.test(text) && !/helpers\/(mcp-oauth-pkce|mcp-session)\.js/.test(text) && !/suite-hygiene: tests the oauth round/.test(text)) c.mcpOauth = 1;
    // Counted as text: the count is a backlog to work down, and a match that is in fact paired with
    // a status check costs one entry in the baseline, never a refusal of new work.
    const loose = (text.match(LOOSE_STATUS)?.length ?? 0) + (text.match(LOOSE_CODE)?.length ?? 0);
    if (loose > 0) c.looseRefusal = loose;
    const n = bodyLines(text);
    if (n > MAX_LINES) c.lines = n;
    return c;
}

/** ESLint errors per test file, from one cached run over test/. */
function lintCounts(aimeat: string): Map<string, number> {
    const out = join(mkdtempSync(join(tmpdir(), 'aimeat-lint-tests-')), 'lint.json');
    try {
        // One command string: the path is our own temporary file, and a string needs no shell flag.
        execSync(`pnpm -s exec eslint test/ --cache --cache-location node_modules/.cache/eslint-tests/ -f json -o "${out}"`, { cwd: aimeat, stdio: 'ignore' });
    } catch { /* ESLint exits 1 when it finds errors; the report is what counts */ }
    const counts = new Map<string, number>();
    if (!existsSync(out)) throw new Error('ESLint wrote no report; run `pnpm lint:tests` to see why');
    for (const f of JSON.parse(readFileSync(out, 'utf8')) as Array<{ filePath: string; errorCount: number }>) {
        const rel = f.filePath.replace(/\\/g, '/').replace(/^.*?\/aimeat\//, '');
        if (f.errorCount > 0) counts.set(rel, f.errorCount);
    }
    return counts;
}

function suiteFiles(aimeat: string): string[] {
    return readdirSync(join(aimeat, 'test')).filter(n => n.endsWith('.ts') && !n.startsWith('run-e2e-')).map(n => `test/${n}`).sort();
}

function main(): void {
    const aimeat = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
    const baselineFile = join(aimeat, 'security', 'suite-hygiene-baseline.json');
    const args = process.argv.slice(2);
    const seed = args.includes('--seed');
    const update = args.includes('--update');
    const withLint = !args.includes('--no-lint');

    const doc = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, 'utf8')) as { suites: Record<string, Counts> } : { suites: {} };
    const baseline = doc.suites ?? {};
    const lint = withLint ? lintCounts(aimeat) : new Map<string, number>();

    const now: Record<string, Counts> = {};
    for (const file of suiteFiles(aimeat)) {
        const c = suiteCounts(readFileSync(join(aimeat, file), 'utf8'));
        if (Object.keys(c).length) now[file] = c;
    }
    // Lint errors are held for every file under test/ (helpers and unit tests too), not only suites.
    const lintFiles = withLint ? [...lint.keys()] : Object.keys(baseline).filter(f => baseline[f].lintErrors);
    for (const file of lintFiles) {
        const n = withLint ? lint.get(file)! : baseline[file].lintErrors!;
        now[file] = { ...(now[file] ?? {}), lintErrors: n };
    }

    const worse: string[] = [];
    const better: string[] = [];
    for (const file of new Set([...Object.keys(now), ...Object.keys(baseline)])) {
        for (const m of METRICS) {
            const was = baseline[file]?.[m] ?? 0;
            const is = now[file]?.[m] ?? 0;
            // `lines` is held at the baseline length only for a suite already past the limit.
            if (is > was) worse.push(`${file}: ${m} ${was} → ${is}`);
            else if (is < was) better.push(`${file}: ${m} ${was} → ${is}`);
        }
    }

    const totals = Object.fromEntries(METRICS.map(m => [m, Object.values(now).filter(c => (c[m] ?? 0) > 0).length]));
    console.log('\n  E2E suite hygiene (may only fall)');
    console.log('  ' + '─'.repeat(62));
    for (const m of METRICS) console.log(`  ${m.padEnd(14)} ${String(totals[m]).padStart(4)} ${m === 'lintErrors' ? 'file(s) under test/' : 'suite(s)'}${m === 'lintErrors' && !withLint ? '  (not measured: --no-lint)' : ''}`);

    if (seed || update) {
        const next: Record<string, Counts> = {};
        for (const [file, c] of Object.entries(now)) {
            const kept: Counts = {};
            for (const m of METRICS) {
                const v = seed ? c[m] : Math.min(c[m] ?? 0, baseline[file]?.[m] ?? 0);
                if (v) kept[m] = v;
            }
            if (Object.keys(kept).length) next[file] = kept;
        }
        const header = {
            note: 'Per-suite counts that may only fall (scripts/check-suite-hygiene.ts says what each one is). A suite this file does not name may count zero of everything. Seeded 2026-11-15 from the report of that day; --update lowers a count that fell, and re-seeding forgives the whole backlog.',
            suites: next,
        };
        writeFileSync(baselineFile, JSON.stringify(header, null, 1) + '\n', 'utf8');
        console.log(`  ${seed ? 'seeded' : 'updated'} ${baselineFile}`);
        if (seed) return;
    }
    if (better.length && !update) {
        console.log(`\n  ${better.length} count(s) fell; \`pnpm check:suite-hygiene --update\` writes them into the baseline:`);
        for (const b of better.slice(0, 20)) console.log(`    ${b}`);
    }
    if (worse.length) {
        console.error(`\n✖ ${worse.length} count(s) grew past the baseline:`);
        for (const w of worse) console.error(`    ${w}`);
        console.error('\n  A new or changed suite uses test/helpers/harness.ts (test, assert, json, expectRefusal, finish), connects agents with');
        console.error('  test/helpers/agent-device.ts, opens MCP with helpers/mcp-session.ts, holds a refusal with expectRefusal(res, status, code),');
        console.error('  stays within 800 lines and passes `pnpm lint:tests`.');
        process.exit(1);
    }
    console.log('  ✓ no count grew');
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
