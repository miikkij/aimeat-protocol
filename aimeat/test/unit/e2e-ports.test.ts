/**
 * @file test/unit/e2e-ports.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two rules that keep two sessions' E2E runs off each other's ports
 *   (scripts/lib/e2e-ports.ts): a session's lane ports are computed from its own base port, and a
 *   suite's own ports are taken under a lock every runner on the machine honours. On 2026-10-11
 *   two `pnpm gate` runs were refused because two sessions took lane port 40501 at once; the first
 *   group here is that case as arithmetic, and the last group is the wait that replaces a collision.
 * @usage pnpm exec vitest run test/unit/e2e-ports.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial.
 */
import { describe, expect, it, afterAll } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    LANES_PER_SESSION, lanePortFor, sessionLanePorts, sessionSlot, suiteOwnPorts,
    acquirePortLocks, releasePortLocks, holdBasePort, basePortHolder,
} from '../../scripts/lib/e2e-ports.js';

const root = mkdtempSync(join(tmpdir(), 'aimeat-port-locks-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const fresh = (name: string): string => { const d = join(root, name); mkdirSync(d, { recursive: true }); return d; };
const A = { suite: 'e2e-mailbox-push', session: 'cc-a' };
const B = { suite: 'e2e-mailbox-push', session: 'cc-b' };

describe('lane ports are a session\'s own', () => {
    it('the two sessions of 2026-10-11 no longer meet: different base ports give disjoint lane ports', () => {
        const mine = new Set(sessionLanePorts(40356));
        const theirs = sessionLanePorts(40312);
        expect(theirs.some(p => mine.has(p))).toBe(false);
        expect(lanePortFor(40356, 1)).not.toBe(lanePortFor(40312, 1));
    });

    it('every base port the board hands out (40251 to 40750) owns a block no other one touches', () => {
        const seen = new Map<number, number>();
        for (let base = 40251; base <= 40750; base++) {
            for (const p of sessionLanePorts(base)) {
                expect(seen.has(p), `port ${p} belongs to ${seen.get(p)} and to ${base}`).toBe(false);
                seen.set(p, base);
            }
        }
        expect(seen.size).toBe(500 * (LANES_PER_SESSION - 1));
    });

    it('every lane port is below 32768, which no system hands out, and is not the base port', () => {
        for (const base of [40251, 40356, 40499, 40750, 40050, 3000, 65000]) {
            for (const p of sessionLanePorts(base)) {
                expect(p).toBeGreaterThanOrEqual(20000);
                expect(p).toBeLessThan(28000);
                expect(p).not.toBe(base);
            }
        }
    });

    it('the same base port gives the same lane ports on every run', () => {
        expect(sessionLanePorts(40356)).toEqual(sessionLanePorts(40356));
        expect(lanePortFor(40251, 1)).toBe(20001);
        expect(sessionSlot(40251)).toBe(0);
    });

    it('refuses a lane that is not 1 to 15, and a base that is not a port', () => {
        expect(() => lanePortFor(40356, 0)).toThrow(/a lane is 1 to 15/);
        expect(() => lanePortFor(40356, 16)).toThrow(/a lane is 1 to 15/);
        expect(() => sessionSlot(Number.NaN)).toThrow(/not a port/);
    });
});

describe('the ports a suite binds for itself, read from its source', () => {
    it('finds each written port once, sorted, and leaves out the runner\'s default and the dev server', () => {
        const src = `const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';\nconst STUB = 40313; // dev is 40050\nlisten(40313); listen(40297);`;
        expect(suiteOwnPorts(src, 40356)).toEqual([40297, 40313]);
    });

    it('resolves suitePort(block, …) for the lane the suite runs in', () => {
        const src = 'const ALT_PORT = String(suitePort(31000, BASE));\nA = await bootNode(suitePort(31200, lane), x);';
        expect(suiteOwnPorts(src, 20841)).toEqual([31041, 31241]);
        expect(suiteOwnPorts(src, 40356)).toEqual([31056, 31256]);
    });

    it('a suite that binds nothing has nothing to lock', () => {
        expect(suiteOwnPorts(`const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';`, 40356)).toEqual([]);
    });
});

describe('the lock two sessions share', () => {
    it('one session takes a port and gives it back; the directory is gone afterwards', async () => {
        const dir = fresh('one');
        const held = await acquirePortLocks([40313], A, { root: dir });
        expect(readdirSync(dir)).toEqual(['port-40313']);
        expect(JSON.parse(readFileSync(join(dir, 'port-40313', 'owner.json'), 'utf-8'))).toMatchObject({ suite: A.suite, session: 'cc-a', port: 40313, pid: process.pid });
        releasePortLocks(held);
        expect(readdirSync(dir)).toEqual([]);
        releasePortLocks(held); // twice is harmless
    });

    it('a second session WAITS for the port and runs when the first is done: no collision, no failure', async () => {
        const dir = fresh('wait');
        const first = await acquirePortLocks([40313], A, { root: dir });
        const waited: Array<{ port: number; session?: string }> = [];
        let secondHas = false;
        const second = acquirePortLocks([40313], B, { root: dir, pollMs: 20, onWait: (port, h) => waited.push({ port, session: h?.session }) })
            .then((h) => { secondHas = true; return h; });
        await new Promise(r => setTimeout(r, 120));
        expect(secondHas).toBe(false);
        expect(waited).toEqual([{ port: 40313, session: 'cc-a' }]);
        releasePortLocks(first);
        const held = await second;
        expect(secondHas).toBe(true);
        expect(JSON.parse(readFileSync(join(dir, 'port-40313', 'owner.json'), 'utf-8')).session).toBe('cc-b');
        releasePortLocks(held);
    });

    it('all or nothing: a run that cannot get its second port holds no first port while it waits', async () => {
        const dir = fresh('all-or-nothing');
        const other = await acquirePortLocks([40322], B, { root: dir });
        const mine = acquirePortLocks([40320, 40322], A, { root: dir, pollMs: 20 });
        await new Promise(r => setTimeout(r, 100));
        // 40320 was free and is NOT held: holding it while waiting is how two runs deadlock.
        expect(existsSync(join(dir, 'port-40320'))).toBe(false);
        releasePortLocks(other);
        const held = await mine;
        expect(held.ports).toEqual([40320, 40322]);
        releasePortLocks(held);
    });

    it('a lock whose process is gone is passed over at once', async () => {
        const dir = fresh('dead');
        mkdirSync(join(dir, 'port-40313'));
        // A process id that cannot exist: above the largest one any system gives out.
        writeFileSync(join(dir, 'port-40313', 'owner.json'), JSON.stringify({ suite: 'x', session: 'cc-gone', pid: 2147483646, at: new Date().toISOString(), port: 40313 }));
        const t0 = Date.now();
        const held = await acquirePortLocks([40313], A, { root: dir, pollMs: 20 });
        expect(Date.now() - t0).toBeLessThan(1000);
        expect(JSON.parse(readFileSync(join(dir, 'port-40313', 'owner.json'), 'utf-8')).session).toBe('cc-a');
        releasePortLocks(held);
    });

    it('a lock older than any suite runs is passed over even when its process id is alive', async () => {
        const dir = fresh('old');
        mkdirSync(join(dir, 'port-40313'));
        writeFileSync(join(dir, 'port-40313', 'owner.json'), JSON.stringify({ suite: 'x', session: 'cc-stuck', pid: process.pid, at: 'long ago', port: 40313 }));
        const old = new Date(Date.now() - 3 * 60 * 60_000);
        utimesSync(join(dir, 'port-40313'), old, old);
        const held = await acquirePortLocks([40313], A, { root: dir, pollMs: 20 });
        expect(held.ports).toEqual([40313]);
        releasePortLocks(held);
    });

    it('a live holder that never lets go ends in an error naming it, not in a run on a taken port', async () => {
        const dir = fresh('timeout');
        const stuck = await acquirePortLocks([40313], B, { root: dir });
        await expect(acquirePortLocks([40313], A, { root: dir, pollMs: 20, timeoutMs: 150 }))
            .rejects.toThrow(/Port 40313 is held by cc-b \(e2e-mailbox-push, pid \d+/);
        releasePortLocks(stuck);
    });

    it('a base port is held for a whole run: a second run stops at once and is told who holds it', () => {
        const dir = fresh('base');
        const release = holdBasePort(40356, { session: 'cc-a', worktree: '/w/a' }, { root: dir });
        expect(basePortHolder(40356, { root: dir })).toMatchObject({ session: 'cc-a', worktree: '/w/a', port: 40356, pid: process.pid });
        // Another worktree whose name hashed to the same port: told to take a port of its own.
        expect(() => holdBasePort(40356, { session: 'cc-b', worktree: '/w/b' }, { root: dir }))
            .toThrow(/Port 40356 is the base port of a test run in progress: cc-a in \/w\/a .*Two worktrees have the same test port.*AIMEAT_E2E_PORT/s);
        // A second run of the SAME worktree: told to wait, because it would share the database too.
        expect(() => holdBasePort(40356, { session: 'cc-a', worktree: '/w/a' }, { root: dir }))
            .toThrow(/a run of this same worktree/);
        // A different port is nobody's business.
        const other = holdBasePort(40357, { session: 'cc-b', worktree: '/w/b' }, { root: dir });
        other();
        release();
        expect(basePortHolder(40356, { root: dir })).toBeNull();
        holdBasePort(40356, { session: 'cc-b', worktree: '/w/b' }, { root: dir })();
    });

    it('a base port whose run is gone is free: the cleanup script and the next run both see nobody', () => {
        const dir = fresh('base-dead');
        holdBasePort(40356, { session: 'cc-gone', worktree: '/w/gone' }, { root: dir, pid: 2147483646 });
        expect(basePortHolder(40356, { root: dir })).toBeNull();
        const release = holdBasePort(40356, { session: 'cc-a', worktree: '/w/a' }, { root: dir });
        expect(basePortHolder(40356, { root: dir })?.session).toBe('cc-a');
        release();
    });

    it('nothing to lock is nothing to do, and makes no directory', async () => {
        const dir = join(root, 'never-made');
        const held = await acquirePortLocks([], A, { root: dir });
        expect(held.ports).toEqual([]);
        expect(existsSync(dir)).toBe(false);
    });
});
