/**
 * @file scripts/lib/gate-text-tests.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The unit tests whose source TEXT names a changed file: the ones `vitest --changed`
 *   cannot select, because they read the file with readFileSync rather than import it.
 *
 *   WHY. `pnpm gate` picks unit tests by vitest's import graph. A test that holds a generated
 *   registry or a served file to a spec (atelier-recipe.test.ts reads sdk-libs/atelier/describe-data.js,
 *   cortex-bundle-versions.test.ts reads public/cortex-bundled/) is outside that graph, so a change to
 *   the file it reads passed the gate and turned the test red on the next whole run (docs/pitfalls.md
 *   §108 until 2026-11-21). This reads each unit test's text for path literals and selects the test
 *   when one of them is a changed file or a folder that holds one.
 *
 *   WHAT COUNTS AS NAMING. A string or comment fragment that looks like a path with a slash:
 *   `../../src/static/sdk-libs/atelier/describe-data.js` (resolved against the test's own folder),
 *   `src/services/x.ts` or `public/cortex-bundled/` (read against aimeat/, the test's working
 *   directory), or a tail such as `sdk-libs/atelier/describe-data.js` that ends a changed path. A
 *   folder counts when it is at least two levels below aimeat/ (`public/cortex-bundled/`), so
 *   `src/` alone selects nothing. A bare file name is not read: `index.ts` is in hundreds of tests.
 * @structure unitTestFiles(aimeatDir) · namedPaths(testFile, text, aimeatDir) · testsNamingChanged(aimeatDir, changed)
 * @usage import { testsNamingChanged } from './lib/gate-text-tests.js';
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial; retires docs/pitfalls.md §108.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';

/** The folders vitest's unit project reads (vitest.config.ts include), relative to aimeat/. */
const TEST_ROOTS = ['test/unit', 'test/integration', 'src'];

/** Every unit test file under aimeat/, as an absolute path. */
export function unitTestFiles(aimeatDir: string): string[] {
    const out: string[] = [];
    // Under src/ only a __tests__ folder holds unit tests (vitest.config.ts).
    const walk = (dir: string, inTests: boolean): void => {
        if (!existsSync(dir)) return;
        for (const name of readdirSync(dir)) {
            if (name === 'node_modules' || name === 'dist') continue;
            const p = join(dir, name);
            if (statSync(p).isDirectory()) walk(p, inTests || name === '__tests__');
            else if (inTests && name.endsWith('.test.ts')) out.push(p);
        }
    };
    for (const r of TEST_ROOTS) walk(join(aimeatDir, r), r !== 'src');
    return out;
}

/** A path fragment: letters, digits and the usual punctuation of file names, with at least one slash. */
const PATH_LIKE = /(?:\.{1,2}\/)*[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)+\/?/g;

/**
 * The repository-relative paths (`aimeat/src/x.ts`, `aimeat/public/cortex-bundled/`) and the bare
 * tails (`sdk-libs/atelier/describe-data.js`) a test's text names.
 */
export function namedPaths(testFile: string, text: string, aimeatDir: string): { exact: Set<string>; tails: Set<string> } {
    const repo = resolve(aimeatDir, '..');
    const exact = new Set<string>();
    const tails = new Set<string>();
    for (const m of text.matchAll(PATH_LIKE)) {
        const raw = m[0];
        if (raw.startsWith('./') || raw.startsWith('../')) {
            const abs = resolve(dirname(testFile), raw);
            exact.add(relative(repo, abs).split('\\').join('/') + (raw.endsWith('/') ? '/' : ''));
        } else if (/^(?:src|public|locales|scripts|security|test|bin|data)\//.test(raw)) {
            exact.add(`aimeat/${raw}`);
        } else {
            tails.add(raw.replace(/\/$/, ''));
        }
    }
    return { exact, tails };
}

/** Is `named` the changed file, or a folder two or more levels below aimeat/ that holds it? */
function covers(named: string, changed: string): boolean {
    const n = named.replace(/\/$/, '');
    if (n === changed) return true;
    if (!changed.startsWith(`${n}/`)) return false;
    return n.split('/').length >= 3; // aimeat/<top>/<folder>, never aimeat/src alone
}

/**
 * The unit tests, relative to aimeat/, whose text names one of `changed` (repository-relative paths
 * as git prints them). A changed test file is left out: vitest --changed runs it already.
 */
export function testsNamingChanged(aimeatDir: string, changed: string[]): string[] {
    const targets = changed.filter(f => !f.endsWith('.test.ts'));
    if (targets.length === 0) return [];
    const out: string[] = [];
    for (const file of unitTestFiles(aimeatDir)) {
        let text: string;
        try { text = readFileSync(file, 'utf8'); } catch { continue; }
        const { exact, tails } = namedPaths(file, text, aimeatDir);
        const hit = targets.some(c => [...exact].some(n => covers(n, c))
            || [...tails].some(t => t.split('/').length >= 2 && c.endsWith(`/${t}`)));
        if (hit) out.push(posix.normalize(relative(aimeatDir, file).split('\\').join('/')));
    }
    return out.sort();
}
