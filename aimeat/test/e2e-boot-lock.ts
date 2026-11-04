/**
 * @file test/e2e-boot-lock.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two processes of one node, started at the same moment on one empty PostgreSQL
 *   database, both come up: they take the boot lock in turn (storage/providers/postgres-kysely/
 *   migrate.ts takeBootLock), so the second finds the migrations applied and the seeding done
 *   instead of running the same file at the same time.
 *
 *   WHY. Without the lock both read the applied set and both ran the next migration file; the second
 *   blocked on the first's locks, then failed on its primary key or a CREATE, and did not boot until
 *   the process manager started it again (codebase analysis 2026-11-03, HA stage 1). A standby that
 *   starts beside the active process is that case.
 *
 *   SQLite is one file for one process, so on a SQLite run the test is skipped with that reason.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.postgres-kysely --import tsx test/run-e2e-ci.ts --test=e2e-boot-lock
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, HA stage 1: migration lock).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb, runBackend } from './helpers/own-node-db.js';
import { skip, isSkip } from './helpers/skip.js';

const PORTS = [28747, 28748];
const NODE_ID = 'aimeat-boot-lock-001';

let passed = 0;
let failed = 0;
let skipped = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) {
        if (isSkip(err)) { skipped++; console.log(`  ⏭ ${name}: ${err.message}`); return; }
        failed++; console.log(`  ❌ ${name}: ${(err as Error).message}`);
    }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

console.log('\n=== BOOT LOCK E2E (two processes start together on one empty database) ===\n');

const procs: Array<{ proc: ChildProcess; out: () => string; exit: () => number | null }> = [];

try {
    await test('two processes started at once on one empty database both answer ready, and neither exits', async () => {
        if (runBackend() !== 'postgres-kysely') skip('SQLite is one file for one process; the boot lock is PostgreSQL only');
        const db = await ownNodeDb('boot-lock');
        for (const port of PORTS) {
            let out = '';
            let code: number | null = null;
            const proc = spawn(process.execPath, [...nodeEntryArgs(), 'start', ...db.args, '--port', String(port)], {
                cwd: process.cwd(),
                env: {
                    ...process.env, ...db.env,
                    AIMEAT_PORT: String(port), AIMEAT_BASE_URL: `http://127.0.0.1:${port}`, AIMEAT_NODE_ID: NODE_ID,
                    AIMEAT_LOG_LEVEL: 'warn',
                },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            proc.stdout?.on('data', (c: Buffer) => { out += c.toString(); });
            proc.stderr?.on('data', (c: Buffer) => { out += c.toString(); });
            proc.once('exit', (c) => { code = c ?? -1; });
            procs.push({ proc, out: () => out, exit: () => code });
        }
        const deadline = Date.now() + 240_000;
        const ready = PORTS.map(() => false);
        while (ready.some((r) => !r) && Date.now() < deadline) {
            for (let i = 0; i < PORTS.length; i++) {
                const exited = procs[i].exit();
                assert(exited === null, `process ${i + 1} exited with code ${exited} while booting: ${procs[i].out().slice(-1200)}`);
                if (ready[i]) continue;
                const r = await fetch(`http://127.0.0.1:${PORTS[i]}/v1/health/ready`, { signal: AbortSignal.timeout(2_000) }).catch(() => null);
                if (r?.status === 200) ready[i] = true;
            }
            await sleep(500);
        }
        assert(ready.every(Boolean), `ready: ${JSON.stringify(ready)}; ${procs.map((p, i) => `process ${i + 1}: ${p.out().slice(-600)}`).join('\n')}`);
    });
} finally {
    for (const p of procs) if (p.exit() === null) p.proc.kill();
}

console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
process.exit(failed > 0 ? 1 : 0);
