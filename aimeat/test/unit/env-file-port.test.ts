/**
 * @file test/unit/env-file-port.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The scripts that stop a server before a run read its port the way the node does (shell,
 *   then env file), and a worktree's derived E2E port steps past every port a test file writes down.
 *   kill-test-servers read the shell alone and stopped port 40251 on a plain `pnpm gate`, and
 *   test:env:init could hand out a port a suite owns (docs/pitfalls.md §13; incidents
 *   "kill-test-servers reads the port only from the shell" and "test:env:init can derive a worktree
 *   port that an E2E suite owns").
 * @version-history
 *   v1.1.0 — 2026-11-25 — pgAccountOf(): the account pnpm ready's batch worktree takes from the session.
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { envFileArgs, portFor } from '../../scripts/lib/env-file-port.js';
import { derivePort, pgAccountOf, portsNamedByTests } from '../../scripts/lib/worktree-ports.js';

const dir = mkdtempSync(join(tmpdir(), 'aimeat-env-port-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
writeFileSync(join(dir, '.env.test.sqlite'), 'AIMEAT_PORT=40475\nAIMEAT_TEST_PORT=40475\n');
writeFileSync(join(dir, '.env'), '# dev\nAIMEAT_PORT="40733"\n');

describe('the port a stop script clears is the one the node binds', () => {
    const keys = ['AIMEAT_TEST_PORT', 'AIMEAT_PORT'];
    it('reads the env file when the shell sets no port', () => {
        expect(portFor({ keys, envFiles: ['.env.test.sqlite'], cwd: dir, fallback: '40251', env: {} }))
            .toEqual({ port: '40475', source: '.env.test.sqlite AIMEAT_TEST_PORT' });
        expect(portFor({ keys: ['AIMEAT_PORT'], envFiles: ['.env'], cwd: dir, fallback: '40050', env: {} }).port).toBe('40733');
    });
    it('lets the shell win over the file, as node --env-file does', () => {
        expect(portFor({ keys, envFiles: ['.env.test.sqlite'], cwd: dir, fallback: '40251', env: { AIMEAT_PORT: '40300' } }))
            .toEqual({ port: '40300', source: 'shell AIMEAT_PORT' });
    });
    it('falls back to the default only when neither names one, and skips a missing file', () => {
        expect(portFor({ keys, envFiles: ['.env.missing', '.env.test.postgres-kysely'], cwd: dir, fallback: '40251', env: {} }))
            .toEqual({ port: '40251', source: 'default' });
    });
    it('reads --port-from= arguments in order', () => {
        expect(envFileArgs(['--port-from=.env.test.postgres-kysely', 'x', '--port-from=', '--env-file=.env'])).toEqual(['.env.test.postgres-kysely']);
    });
    it('kill-port refuses in a worktree that names no port, and stops nothing', () => {
        const wt = join(dir, '.worktrees', 'cc-x', 'aimeat');
        mkdirSync(wt, { recursive: true });
        const r = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('../../scripts/kill-port.ts', import.meta.url)), '--port-from=.env'],
            { cwd: wt, encoding: 'utf8', timeout: 30_000, env: { ...process.env, AIMEAT_PORT: '' } });
        expect(r.status).toBe(1);
        expect(r.stderr).toContain('names no AIMEAT_PORT');
    });
});

describe('a derived worktree port is not one a suite writes down', () => {
    it('steps past a named port, inside the band', () => {
        const free = derivePort('cc-jouni-agents-p1', new Set());
        expect(free).toBeGreaterThanOrEqual(40251);
        expect(free).toBeLessThanOrEqual(40390);
        const next = derivePort('cc-jouni-agents-p1', new Set([free]));
        expect(next).not.toBe(free);
        expect(next === free + 1 || (free === 40390 && next === 40251)).toBe(true);
    });
    it('is the same port on every run for the same name', () => {
        expect(derivePort('cc-a', new Set([40300]))).toBe(derivePort('cc-a', new Set([40300])));
    });
    it('reads the numbers the test files write, not the two defaults', () => {
        const t = mkdtempSync(join(tmpdir(), 'aimeat-named-ports-'));
        mkdirSync(join(t, 'test'));
        writeFileSync(join(t, 'test', 'e2e-x.ts'), "const STUB = process.env.STUB_PORT ?? '40314'; // E2E_BASE ?? 'http://localhost:40251'");
        try {
            const named = portsNamedByTests(t);
            expect([...named.keys()]).toEqual([40314]);
            expect(named.get(40314)).toEqual(['test/e2e-x.ts']);
        } finally { rmSync(t, { recursive: true, force: true }); }
    });
    it('the real test tree: a derived port is never one the runner would refuse', () => {
        const named = portsNamedByTests(fileURLToPath(new URL('../..', import.meta.url)));
        for (const slug of ['cc-jouni-agents-p1', 'cc-jouni-pitfalls', 'agent-aaab48633cc402bbd']) {
            expect(named.has(derivePort(slug, named))).toBe(false);
        }
    });
});

describe("the PostgreSQL account pnpm ready's batch worktree takes", () => {
    it('reads the account and server from the test env, without the database', () => {
        const a = join(dir, 'a'); const b = join(dir, 'b');
        mkdirSync(a); mkdirSync(b);
        writeFileSync(join(a, '.env.test.postgres-kysely'), 'DATABASE_URL="postgresql://appuser:devpassword123@localhost:5432/aimeat_kysely_e2e_one?schema=public"\n');
        writeFileSync(join(b, '.env.test.postgres-kysely'), 'DATABASE_URL="postgresql://alice:secret@localhost:5432/aimeat_kysely_e2e_two?schema=public"\n');
        expect(pgAccountOf(a)?.account).toBe('appuser:devpassword123@localhost:5432');
        expect(pgAccountOf(b)?.account).toBe('alice:secret@localhost:5432');
        expect(pgAccountOf(b)?.url).toContain('aimeat_kysely_e2e_two');
        expect(pgAccountOf(join(dir, 'missing'))).toBeNull();
    });
});
