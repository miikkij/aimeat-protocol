/**
 * @file python-parity-test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Python half of the offer-shape comparison, as a step `pnpm gate` can run: the
 *   aimeat-crewai tests that build offers and signals with the package's builders and validate them
 *   against the node's schema (tests/test_node_schema_parity.py, against the fixture
 *   `pnpm check:python-shapes` keeps fresh) and the builders' own tests (tests/test_offers.py).
 *   Both are pure Python, need no node and take a few seconds once the environment exists.
 *
 *   It runs through uv on Python 3.12, the version the package's CI workflow uses: on 3.14 the
 *   package's dependencies (chromadb's pydantic v1 settings) fail to import before any test runs.
 *   `--frozen` installs from uv.lock as it stands and never re-resolves.
 *
 *   NO uv IS A FAILURE WITH ITS REASON, never a pass: a gate step that passes because its tool is
 *   missing says the Python side was checked when it was not (Jouni, 2026-10-18).
 * @usage cd aimeat && pnpm test:python-parity
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (wish wish-vertailutarkistus-python-paketin-ja-liittimen-kahdennuksille; Jouni: pytest in pnpm gate).
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'python', 'aimeat-crewai');
const TESTS = ['tests/test_node_schema_parity.py', 'tests/test_offers.py'];
// No shell: uv is an executable (uv.exe on Windows), which spawn finds on PATH by itself.
const shell = false;

const probe = spawnSync('uv', ['--version'], { encoding: 'utf8', shell });
if (probe.status !== 0) {
    console.error('✗ test:python-parity: uv is not on PATH, so the Python half of the offer-shape comparison did not run.\n'
        + '  Install uv (https://docs.astral.sh/uv/getting-started/installation/) and run the gate again;\n'
        + '  uv brings Python 3.12 and the package\'s locked dependencies itself.');
    process.exit(1);
}

const t0 = Date.now();
const r = spawnSync('uv', ['run', '--python', '3.12', '--frozen', '--extra', 'dev', 'pytest', ...TESTS, '-q'],
    { cwd: PACKAGE, stdio: 'inherit', shell });
const secs = ((Date.now() - t0) / 1000).toFixed(0);
if (r.status !== 0) {
    console.error(`✗ test:python-parity: the Python parity tests failed (${secs}s, ${probe.stdout.trim()}).`);
    process.exit(1);
}
console.log(`✓ test:python-parity: ${TESTS.join(', ')} passed in ${secs}s (${probe.stdout.trim()}, Python 3.12)`);
