/**
 * @file test/unit/test-env-init-port.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `pnpm test:env:init` refuses an AIMEAT_E2E_PORT outside 40251-40499 instead of
 *   replacing it with the hashed port in silence (instruction review 2026-11-14, C1). Runs the real
 *   script in an empty directory, so a refusal writes nothing and a port in range stops at the
 *   missing example file without touching any database.
 * @version-history
 *   v1.1.0 -- 2026-11-15 -- A claimed port that the existing env file does not carry is refused
 *     without --force (instruction review, final round N1).
 *   v1.0.0 -- 2026-11-15 -- Initial.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AIMEAT = fileURLToPath(new URL('../..', import.meta.url));
const TSX = join(AIMEAT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const SCRIPT = join(AIMEAT, 'scripts', 'test-env-init.ts');

const scratch = mkdtempSync(join(tmpdir(), 'aimeat-env-init-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function init(port: string) {
    const cwd = join(scratch, `wt-${Math.random().toString(36).slice(2)}`, 'aimeat');
    mkdirSync(cwd, { recursive: true });
    const r = spawnSync(process.execPath, [TSX, SCRIPT], { cwd, env: { ...process.env, AIMEAT_E2E_PORT: port }, encoding: 'utf8', timeout: 60_000 });
    return { status: r.status, out: `${r.stdout}${r.stderr}`, wrote: existsSync(join(cwd, '.env.test.sqlite')) };
}

describe('test:env:init and an explicit E2E port', { timeout: 120_000 }, () => {
    it('refuses a port outside 40251-40499 and names the range', () => {
        for (const port of ['40600', '41000', '40250', 'abc']) {
            const r = init(port);
            expect(r.status, r.out).toBe(1);
            expect(r.out).toContain(`AIMEAT_E2E_PORT=${port} is refused`);
            expect(r.out).toContain('40251 to 40499');
            expect(r.wrote).toBe(false);
        }
    });

    it('refuses, without --force, a claimed port that the existing env file does not carry', () => {
        const cwd = join(scratch, `wt-${Math.random().toString(36).slice(2)}`, 'aimeat');
        mkdirSync(cwd, { recursive: true });
        writeFileSync(join(cwd, '.env.test.sqlite.example'), 'AIMEAT_PORT=40251\n');
        writeFileSync(join(cwd, '.env.test.sqlite'), 'AIMEAT_PORT=40300\nAIMEAT_TEST_PORT=40300\n');
        const r = spawnSync(process.execPath, [TSX, SCRIPT], { cwd, env: { ...process.env, AIMEAT_E2E_PORT: '40301' }, encoding: 'utf8', timeout: 60_000 });
        const out = `${r.stdout}${r.stderr}`;
        expect(r.status, out).toBe(1);
        expect(out).toContain('names port 40300, and AIMEAT_E2E_PORT asks for 40301');
        expect(out).toContain('--force');
        expect(readFileSync(join(cwd, '.env.test.sqlite'), 'utf8')).toContain('AIMEAT_PORT=40300');
    });

    it('takes a port inside the range', () => {
        const r = init('40499');
        expect(r.out).not.toContain('is refused');
        expect(r.out).toMatch(/port\s+40499/);
    });
});
