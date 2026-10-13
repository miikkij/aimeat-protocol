/**
 * @file version-aware-suites.test.ts
 * @description Every E2E suite whose expected answers depend on the node's release is named in
 *   test/version-aware-suites.txt, the list the nightly sweep runs as node 4.0.0
 *   (.github/workflows/e2e-full.yml, job release-4-0-0), and every name there is a suite.
 *
 *   WHY. Until 2026-10-13 the 4.0.0 half of the version-aware suites ran only when somebody started
 *   a sweep with AIMEAT_TEST_SOFTWARE_VERSION=4.0.0 by hand (docs-audit 2026-10,
 *   4.0-testimuutokset.md §4 item 4). The nightly job runs the list; this keeps a new version-aware
 *   suite from being left out of it, which would put its 4.0.0 half back to "by hand only".
 *
 *   A suite is version-aware when it calls removedOn(), imports helpers/node-release or
 *   helpers/owner-key-sign-in, reads AIMEAT_TEST_SOFTWARE_VERSION, calls versionAtLeast(), or names
 *   a *_REMOVED_IN constant. Only the suites directly under test/ are read (the runner files,
 *   helpers and unit tests are not suites).
 * @usage cd aimeat && pnpm exec vitest run test/unit/version-aware-suites.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-13 — Initial (4.0-testimuutokset.md §4 item 4).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIST = join(TEST_DIR, 'version-aware-suites.txt');

/** What makes a suite version-aware. */
const MARKERS = /removedOn\(|helpers\/node-release|helpers\/owner-key-sign-in|AIMEAT_TEST_SOFTWARE_VERSION|versionAtLeast\(|_REMOVED_IN\b/;

function listed(): string[] {
    return readFileSync(LIST, 'utf-8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
}

function versionAwareSuites(): string[] {
    return readdirSync(TEST_DIR)
        .filter(f => f.endsWith('.ts') && !f.startsWith('run-e2e-'))
        .filter(f => MARKERS.test(readFileSync(join(TEST_DIR, f), 'utf-8')))
        .map(f => f.slice(0, -3))
        .sort();
}

describe('test/version-aware-suites.txt, the nightly 4.0.0 run', () => {
    it('names every suite that branches on the release', () => {
        const names = new Set(listed());
        const missing = versionAwareSuites().filter(s => !names.has(s));
        expect(missing, `add these to test/version-aware-suites.txt so the nightly sweep runs them as node 4.0.0: ${missing.join(', ')}`).toEqual([]);
    });

    it('names only suites that exist, once each', () => {
        const names = listed();
        const unknown = names.filter(n => !existsSync(join(TEST_DIR, `${n}.ts`)));
        expect(unknown, `no such suite under test/: ${unknown.join(', ')}`).toEqual([]);
        const twice = names.filter((n, i) => names.indexOf(n) !== i);
        expect(twice, `listed twice: ${twice.join(', ')}`).toEqual([]);
    });

    it('carries e2e-node-update, which fails a run whose node did not start as the asked release', () => {
        expect(listed()).toContain('e2e-node-update');
    });
});
