/**
 * @file e2e-boot-port-in-use.ts
 * @description A node that cannot bind its port says so and exits, instead of announcing it started.
 *
 *   WHAT THIS PINS. Express 5's app.listen() registers its callback for the server's 'error' event
 *   as well as for 'listening'. index-start.ts put the whole start banner in that callback and never
 *   looked at the argument, so a node whose port was taken printed "AIMEAT node started", ran every
 *   scheduled job, and listened on nothing, with the error thrown away. From 2026-09-15 to
 *   2026-09-17 that was every "node never bound its port" failure of the nightly Postgres sweep:
 *   the process sat idle for 180 s with no TCP handle open, and the log of e2e-chat-agent's node
 *   showed the banner followed by three minutes of scheduler lines.
 *
 *   The port is taken here by a plain listener of this process. On the CI runner the taker was, as
 *   far as the evidence shows, an outgoing connection that the kernel had given a local port inside
 *   the E2E range; the workflow now reserves that range, and this test covers what the node does
 *   whatever took the port.
 *
 *   Port 40433: checked against every other suite before it was picked.
 * @version-history
 *   v1.0.0 — 2026-09-17 — Initial.
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-boot-port-in-use.ts

import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeEntryArgs } from './helpers/node-entry.js';

const PORT = 40433;

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

console.log('\n=== A node whose port is taken ===\n');

await test('a node whose port is already taken exits non-zero, names the port, and never says it started', async () => {
    // Bound on every address, the way the node itself binds, so the node's listen fails for certain.
    const holder: Server = createServer();
    await new Promise<void>((resolve, reject) => { holder.once('error', reject); holder.listen(PORT, () => resolve()); });
    const dir = mkdtempSync(join(tmpdir(), 'aimeat-portinuse-'));
    try {
        const dbPath = join(dir, 'node.db');
        const child = spawn(process.execPath, [...nodeEntryArgs(), 'start', '--db', 'sqlite', '--db-path', dbPath], {
            env: {
                ...process.env,
                AIMEAT_PORT: String(PORT),
                AIMEAT_BASE_URL: `http://127.0.0.1:${PORT}`,
                AIMEAT_STORAGE: 'sqlite',
                AIMEAT_SQLITE_PATH: dbPath,
                DATABASE_URL: '',
                AIMEAT_LOG_LEVEL: 'info',
                AIMEAT_ANONYMOUS: 'false',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout!.on('data', d => { output += String(d); });
        child.stderr!.on('data', d => { output += String(d); });

        // The old node never exits, so a bounded wait is the assertion. A boot takes a few seconds
        // from dist and up to about fifteen through a cold tsx.
        const budgetMs = Number(process.env.AIMEAT_E2E_BOOT_MS ?? 90_000);
        // Resolve on exit in both cases: on Windows the SQLite file stays locked until the process is
        // gone, and the directory removal below would fail on a node that was only signalled.
        let timedOut = false;
        const exitCode = await new Promise<number | null>(resolve => {
            const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, budgetMs);
            child.once('exit', c => { clearTimeout(timer); resolve(c); });
        });
        const code = timedOut ? null : exitCode;

        assert(code !== null, `the node was still running after ${budgetMs} ms; last output: ${output.slice(-600)}`);
        assert(code !== 0, `exit code ${code}`);
        assert(output.includes(String(PORT)), `the error names the port: ${output.slice(-600)}`);
        assert(/EADDRINUSE|in use/i.test(output), `the error names the cause: ${output.slice(-600)}`);
        assert(!output.includes('AIMEAT node started'), 'the node did not announce a start it never made');
    } finally {
        await new Promise<void>(resolve => holder.close(() => resolve()));
        rmSync(dir, { recursive: true, force: true });
    }
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
