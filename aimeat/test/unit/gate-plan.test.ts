/**
 * @file test/unit/gate-plan.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Runs the real gate planner against disposable Git repositories. Stronger modes
 * must retain changed suites, shared security code must select the guard tier, and a storage,
 * identity, door or runner change must select the PostgreSQL legs without being asked.
 * @version-history
 *   2026-10-21 -- The purpose tier is selected wherever the guard tier is, on the same backends; red on
 *     the planner before the change (wish wish-tarkoitustestit-e2e-sarjat-jotka-varmistavat-aimeatin-suunni).
 *   2026-10-18 -- aimeat-crewai, the offer and signal schemas and the shape allowlist select the Python
 *     parity tests; an unrelated change does not.
 *   2026-10-17 -- A changed suite or test/version-aware-suites.txt selects the version-aware suite list check.
 *   2026-10-16 -- Each case may take 30 s, above the child process's own 20 s limit: under load the
 *     first case timed out at vitest's 5 s default while the planner was still compiling.
 *   v1.1.0 -- 2026-10-16 -- The planner runs with AIMEAT_CI_STATE=off: the plan now prints main's CI
 *     state, and a unit test reads no network (QA audit P2-01).
 *   2026-10-16 -- The guard tier for config-*.ts, server.ts, index-start.ts, tool-catalog, the
 *     runner and its helpers; the Postgres legs (guard tier and unit files with a Postgres half)
 *     for a storage, identity, route or runner change without --postgres; a changed suite found by
 *     registration (federation-messages.ts). Each new case failed on the planner before the change
 *     (QA audit P2-04, P2-05, P2-06, P8-06, P1-03).
 *   v1.0.0 -- 2026-09-07 -- Review regression: --full dropped changed non-guard E2E suites.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scratch = mkdtempSync(join(tmpdir(), 'aimeat-gate-plan-'));
const aimeat = join(scratch, 'aimeat');
mkdirSync(join(aimeat, 'test'), { recursive: true });
// A runner that registers one suite without the e2e- prefix, committed in the baseline so it is not a change.
writeFileSync(join(aimeat, 'test', 'run-e2e-ci.ts'), "const ALL_SUITES = ['test/federation-messages.ts', 'test/e2e-example.ts'];\n");
const git = (...args: string[]) => execFileSync('git', args, { cwd: scratch, stdio: 'pipe' });
git('init', '-q');
git('add', 'aimeat/test/run-e2e-ci.ts');
git('-c', 'user.name=Gate Test', '-c', 'user.email=gate@example.invalid', '-c', 'commit.gpgsign=false',
    '-c', 'core.hooksPath=', 'commit', '-qm', 'baseline');
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function plan(path: string, ...flags: string[]): string {
    const file = join(scratch, path);
    mkdirSync(dirname(file), { recursive: true });
    const before = existsSync(file) ? readFileSync(file) : null;
    writeFileSync(file, `${before ? before.toString() : ''}// changed by the gate selection test\n`);
    try {
        return execFileSync(process.execPath, ['--import', import.meta.resolve('tsx'),
            fileURLToPath(new URL('../../scripts/gate.ts', import.meta.url)), '--plan', '--base=HEAD', ...flags],
        { cwd: aimeat, encoding: 'utf8', timeout: 20_000, env: { ...process.env, AIMEAT_CI_STATE: 'off' } });
    } finally {
        if (before) writeFileSync(file, before); else rmSync(file);
    }
}

// Each case starts the planner in a child process with a 20 s limit; the first compiles gate.ts
// through tsx and took 12.5 s on a loaded machine, past vitest's 5 s default.
describe('the gate selects what the change can affect', { timeout: 30_000 }, () => {
    it('keeps a changed non-guard suite under --full', () => {
        expect(plan('aimeat/test/e2e-example.ts', '--full')).toContain('own E2E suite(s)');
    });
    it('runs changed suites on Postgres when requested, even without changed backend source', () => {
        expect(plan('aimeat/test/e2e-example.ts', '--postgres')).toMatch(/own E2E suite\(s\).*Postgres/);
    });
    it.each(['aimeat/src/utils/gaii.ts', 'aimeat/src/config.ts', 'aimeat/src/server-bootstrap/routes-loader.ts',
        'aimeat/src/commerce/session-service.ts',
        // Outside the old pattern (QA audit P2-05, P8-06, P1-03):
        'aimeat/src/config-security.ts', 'aimeat/src/server.ts', 'aimeat/src/index-start.ts',
        'aimeat/src/tool-catalog/memory.ts', 'aimeat/src/tool-dispatch/memory.ts', 'aimeat/src/models/x.ts',
        'aimeat/package.json',
        // The E2E machinery itself (QA audit P2-06):
        'aimeat/test/run-e2e-server.ts', 'aimeat/test/helpers/owner-login.ts', 'aimeat/test/fixtures/x.json',
        'aimeat/test/version-aware-suites.txt'])(
        'selects guards for %s', path => { expect(plan(path)).toContain('guard tier, SQLite'); });
    it('keeps a served browser library change off the guard tier', () => {
        expect(plan('aimeat/src/static/sdk-libs/x.js')).not.toContain('guard tier, SQLite');
    });
    it('keeps documentation-only changes on the static checks', () => {
        const output = plan('docs/example.md');
        expect(output).toContain('check:fast');
        expect(output).not.toContain('guard tier, SQLite');
        expect(output).not.toContain('guard tier, Postgres');
    });
    it('retains ordinary changed-suite selection', () => {
        expect(plan('aimeat/test/e2e-example.ts')).toContain('own E2E suite(s)');
    });
    it('runs a changed registered suite that has no e2e- prefix', () => {
        expect(plan('aimeat/test/federation-messages.ts')).toContain('own E2E suite(s), SQLite: federation-messages');
    });
    it('checks the version-aware suite list when a suite or the list changes, and not for source alone', () => {
        expect(plan('aimeat/test/e2e-example.ts')).toContain('version-aware suite list');
        expect(plan('aimeat/test/version-aware-suites.txt')).toContain('version-aware suite list');
        expect(plan('aimeat/src/services/board-ttl.ts')).not.toContain('version-aware suite list');
    });
    it('runs the unit tests a runner change reaches', () => {
        expect(plan('aimeat/test/run-e2e-server.ts')).toContain('unit tests reaching');
    });
    it.each(['python/aimeat-crewai/src/aimeat_crewai/offers.py', 'aimeat/src/models/offer-schemas.ts',
        'aimeat/src/models/workflow-signals.ts', 'aimeat/security/python-shape-parity.json'])(
        'runs the Python parity tests for %s', path => { expect(plan(path)).toContain('Python parity tests'); });
    it('keeps the Python parity tests off for an unrelated change, and says so', () => {
        const output = plan('aimeat/src/services/board-ttl.ts');
        expect(output).not.toContain('• Python parity tests');
        expect(output).toContain('skipped: Python parity tests');
    });
});

describe('PostgreSQL runs by itself for storage, identity, door and runner changes (QA audit P2-04)', { timeout: 30_000 }, () => {
    it.each(['aimeat/src/storage/providers/postgres-kysely/methods/memory.ts', 'aimeat/src/auth/middleware.ts',
        'aimeat/src/routes/memory/crud.ts', 'aimeat/src/mcp/index.ts', 'aimeat/src/tool-catalog/memory.ts',
        'aimeat/src/services/identity-links.ts', 'aimeat/test/run-e2e-ci.ts'])(
        'selects the Postgres guard tier and the Postgres unit files for %s', path => {
            const output = plan(path);
            expect(output).toContain('guard tier, Postgres');
            expect(output).toContain('unit tests with a Postgres half, Postgres');
        });
    it('runs a changed suite on Postgres too when the change also touches storage', () => {
        writeFileSync(join(scratch, 'aimeat/test/e2e-example.ts'), 'x\n');
        try {
            expect(plan('aimeat/src/storage/interface.ts')).toMatch(/own E2E suite\(s\), Postgres/);
        } finally { rmSync(join(scratch, 'aimeat/test/e2e-example.ts')); }
    });
    it('keeps a change outside those places on SQLite and says why', () => {
        const output = plan('aimeat/src/services/board-ttl.ts');
        expect(output).toContain('guard tier, SQLite');
        expect(output).not.toContain('guard tier, Postgres');
        expect(output).toContain('skipped: PostgreSQL legs');
    });
    it('--postgres still forces the legs for any change', () => {
        expect(plan('aimeat/src/services/board-ttl.ts', '--postgres')).toContain('guard tier, Postgres');
    });
});

describe('the purpose tier runs wherever the guard tier runs (docs/pitfalls.md §126)', { timeout: 30_000 }, () => {
    it('a server source change selects it on SQLite, and on Postgres when the legs run', () => {
        const sqlite = plan('aimeat/src/services/board-ttl.ts');
        expect(sqlite).toContain('purpose tier, SQLite');
        expect(sqlite).not.toContain('purpose tier, Postgres');
        expect(plan('aimeat/src/routes/memory/crud.ts')).toContain('purpose tier, Postgres');
        expect(plan('aimeat/src/services/board-ttl.ts', '--postgres')).toContain('purpose tier, Postgres');
    });
    it('a change that skips the guard tier skips it too, and says so', () => {
        const output = plan('docs/example.md');
        expect(output).not.toContain('purpose tier, SQLite');
        expect(output).toContain('skipped: guard and purpose tiers');
    });
});
