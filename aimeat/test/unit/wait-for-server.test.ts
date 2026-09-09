/**
 * @file test/unit/wait-for-server.test.ts
 * @description Unit tests for test/helpers/wait-for-server.ts — the wait the seventeen suites that
 *   spawn their own node share.
 *
 *   WHAT THESE ARE FOR. The behaviour being asserted is what a failing E2E run TELLS you, which is
 *   not something an E2E run can assert about itself: on the nightly sweep of 2026-09-09 the only
 *   red thing on the production backend was a suite that said `Server failed to start` and nothing
 *   else, and the node's own reason had gone into a listener that discarded it. So the cases below
 *   are about the message and about how long the failure takes to arrive.
 * @usage cd aimeat && pnpm test -- wait-for-server
 * @version-history
 *   v1.0.0 — 2026-09-09 — Initial, with the helper.
 */
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { waitForServer } from '../helpers/wait-for-server.js';

/** A child that runs one line of JavaScript, with both streams piped as the helper expects. */
const child = (code: string) =>
    spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });

describe('waitForServer', () => {
    it('returns the child as soon as the address answers', async () => {
        const server: Server = createServer((_, res) => { res.statusCode = 200; res.end('{}'); });
        await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
        const port = (server.address() as AddressInfo).port;
        const c = child('setTimeout(() => {}, 30_000)');
        try {
            await expect(waitForServer(c, `http://127.0.0.1:${port}`, { budgetMs: 10_000 })).resolves.toBe(c);
        } finally {
            c.kill('SIGKILL');
            await new Promise<void>(r => server.close(() => r()));
        }
    });

    it('reports a node that dies at once, without waiting out the budget', async () => {
        const started = Date.now();
        // Nothing is listening on this port, so a helper that only polled would sit here for the
        // whole budget. The point is that it notices the process is gone instead.
        await expect(waitForServer(child('process.exit(3)'), 'http://127.0.0.1:1', { budgetMs: 60_000 }))
            .rejects.toThrow(/exited during startup.*code 3/s);
        expect(Date.now() - started).toBeLessThan(10_000);
    });

    it('quotes what the node said on its way out', async () => {
        await expect(waitForServer(
            child('console.error("EADDRINUSE: address already in use"); process.exit(1)'),
            'http://127.0.0.1:1', { budgetMs: 60_000 },
        )).rejects.toThrow(/EADDRINUSE: address already in use/);
    });

    it('names the address, the budget and the way out when nothing ever answers', async () => {
        const c = child('setTimeout(() => {}, 30_000)');
        try {
            await expect(waitForServer(c, 'http://127.0.0.1:1', { budgetMs: 1_000, label: 'the widget node' }))
                .rejects.toThrow(/the widget node did not answer http:\/\/127\.0\.0\.1:1\/v1\/spec within 1000ms.*AIMEAT_E2E_BOOT_MS/s);
        } finally { c.kill('SIGKILL'); }
    });

    it('says nothing bound the port, and that the node printed nothing', async () => {
        const c = child('setTimeout(() => {}, 30_000)');
        try {
            await expect(waitForServer(c, 'http://127.0.0.1:1', { budgetMs: 1_000 }))
                .rejects.toThrow(/refuses connections, so nothing ever bound it.*printed NOTHING/s);
        } finally { c.kill('SIGKILL'); }
    });

    it('says something IS there when the port answers but the path does not', async () => {
        // The other half of the same question: a port that accepts connections and a readiness
        // path that never turns 200 is a stalled node or somebody else's process, not a missing one.
        const server: Server = createServer((_, res) => { res.statusCode = 503; res.end(); });
        await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
        const port = (server.address() as AddressInfo).port;
        const c = child('console.log("booting"); setTimeout(() => {}, 30_000)');
        try {
            await expect(waitForServer(c, `http://127.0.0.1:${port}`, { budgetMs: 1_500 }))
                .rejects.toThrow(/IS accepting connections.*printed 8 bytes/s);
        } finally {
            c.kill('SIGKILL');
            await new Promise<void>(r => server.close(() => r()));
        }
    });
});
