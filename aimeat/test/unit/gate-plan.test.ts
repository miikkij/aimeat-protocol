/**
 * @file test/unit/gate-plan.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Runs the real gate planner against disposable Git repositories. Stronger modes
 * must retain changed suites, and shared security code must select the guard tier.
 * @version-history
 *   v1.0.0 -- 2026-09-07 -- Review regression: --full dropped changed non-guard E2E suites.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scratch = mkdtempSync(join(tmpdir(), 'aimeat-gate-plan-'));
const aimeat = join(scratch, 'aimeat');
mkdirSync(aimeat);
const git = (...args: string[]) => execFileSync('git', args, { cwd: scratch, stdio: 'pipe' });
git('init', '-q');
git('-c', 'user.name=Gate Test', '-c', 'user.email=gate@example.invalid', '-c', 'commit.gpgsign=false',
    '-c', 'core.hooksPath=', 'commit', '--allow-empty', '-qm', 'baseline');
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function plan(path: string, ...flags: string[]): string {
    const file = join(scratch, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '// changed by the gate selection test\n');
    try {
        return execFileSync(process.execPath, ['--import', import.meta.resolve('tsx'),
            fileURLToPath(new URL('../../scripts/gate.ts', import.meta.url)), '--plan', '--base=HEAD', ...flags],
        { cwd: aimeat, encoding: 'utf8', timeout: 20_000 });
    } finally { rmSync(file); }
}

describe('the gate selects what the change can affect', () => {
    it('keeps a changed non-guard suite under --full', () => {
        expect(plan('aimeat/test/e2e-example.ts', '--full')).toContain('own E2E suite(s)');
    });
    it('runs changed suites on Postgres when requested, even without changed backend source', () => {
        expect(plan('aimeat/test/e2e-example.ts', '--postgres')).toMatch(/own E2E suite\(s\).*Postgres/);
    });
    it.each(['aimeat/src/utils/gaii.ts', 'aimeat/src/config.ts', 'aimeat/src/server-bootstrap/routes-loader.ts',
        'aimeat/src/commerce/session-service.ts'])(
        'selects guards for %s', path => { expect(plan(path)).toContain('guard tier, SQLite'); });
    it('keeps documentation-only changes on the static checks', () => {
        const output = plan('docs/example.md');
        expect(output).toContain('check:fast');
        expect(output).not.toContain('guard tier, SQLite');
    });
    it('retains ordinary changed-suite selection', () => {
        expect(plan('aimeat/test/e2e-example.ts')).toContain('own E2E suite(s)');
    });
});
