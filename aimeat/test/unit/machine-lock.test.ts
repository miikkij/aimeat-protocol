/**
 * @file test/unit/machine-lock.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The machine-wide lock (scripts/lib/machine-lock.ts) that keeps `pnpm check:fast` to
 *   one run at a time: a second taker waits until the first releases and says once whom it waits
 *   for, a lock whose holder process is gone is passed over, and a wait past its limit names the
 *   holder.
 * @usage pnpm exec vitest run test/unit/machine-lock.test.ts
 * @version-history
 *   v1.2.0 — 2026-11-23 — tryMachineLock: one try, no wait.
 *   v1.1.0 — 2026-11-23 — holdMachineForRun: one whole run at a time, and a live run older than the
 *     default age limit keeps its lock.
 *   v1.0.0 — 2026-11-15 — Initial.
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireMachineLock, holdMachineForRun, releaseMachineLock, tryMachineLock, WHOLE_RUN_LOCK, type MachineLockRecord } from '../../scripts/lib/machine-lock.js';

const owner = (session: string) => ({ session, worktree: `/w/${session}` });

describe('acquireMachineLock', () => {
    it('lets a second taker in only after the first releases, and tells it whom it waits for', async () => {
        const root = mkdtempSync(join(tmpdir(), 'mlock-'));
        const first = await acquireMachineLock('check-fast', owner('a'), { root });
        const waitedFor: (MachineLockRecord | null)[] = [];
        let secondIn = false;
        const second = acquireMachineLock('check-fast', owner('b'), { root, pollMs: 20, onWait: h => waitedFor.push(h) })
            .then(h => { secondIn = true; return h; });
        await new Promise(r => setTimeout(r, 120));
        expect(secondIn).toBe(false);
        expect(waitedFor.length).toBe(1);
        expect(waitedFor[0]?.session).toBe('a');
        releaseMachineLock(first);
        releaseMachineLock(await second);
        expect(secondIn).toBe(true);
    });

    it('passes over a lock whose holder process is gone', async () => {
        const root = mkdtempSync(join(tmpdir(), 'mlock-'));
        const dir = join(root, 'check-fast');
        mkdirSync(dir);
        // A pid no process on this machine has.
        writeFileSync(join(dir, 'owner.json'), JSON.stringify({ name: 'check-fast', session: 'gone', worktree: '/w/gone', pid: 2 ** 22 + 12345, at: new Date().toISOString() }));
        const held = await acquireMachineLock('check-fast', owner('a'), { root, pollMs: 20, timeoutMs: 1000 });
        releaseMachineLock(held);
    });

    it('names the holder when the wait runs out', async () => {
        const root = mkdtempSync(join(tmpdir(), 'mlock-'));
        const first = await acquireMachineLock('check-fast', owner('a'), { root });
        await expect(acquireMachineLock('check-fast', owner('b'), { root, pollMs: 20, timeoutMs: 100 })).rejects.toThrow(/held by a/);
        releaseMachineLock(first);
    });
});

describe('tryMachineLock', () => {
    it('takes a free lock at once, and answers with the holder instead of waiting when it is held', () => {
        const root = mkdtempSync(join(tmpdir(), 'mlock-'));
        const first = tryMachineLock(WHOLE_RUN_LOCK, owner('a'), { root });
        expect(first.held).not.toBeNull();
        const second = tryMachineLock(WHOLE_RUN_LOCK, owner('b'), { root });
        expect(second.held).toBeNull();
        expect(second.holder?.session).toBe('a');
        releaseMachineLock(first.held!);
        const third = tryMachineLock(WHOLE_RUN_LOCK, owner('b'), { root });
        expect(third.held).not.toBeNull();
        releaseMachineLock(third.held!);
    });

    it('takes a lock whose holder process is gone', () => {
        const root = mkdtempSync(join(tmpdir(), 'mlock-'));
        const dir = join(root, WHOLE_RUN_LOCK);
        mkdirSync(dir);
        writeFileSync(join(dir, 'owner.json'), JSON.stringify({ name: WHOLE_RUN_LOCK, session: 'gone', worktree: '/w/gone', pid: 2 ** 22 + 12345, at: new Date().toISOString() }));
        const taken = tryMachineLock(WHOLE_RUN_LOCK, owner('a'), { root });
        expect(taken.held).not.toBeNull();
        releaseMachineLock(taken.held!);
    });
});

describe('holdMachineForRun', () => {
    it('makes a second whole run wait for the first, which pnpm ready and pnpm gate both are', async () => {
        const root = mkdtempSync(join(tmpdir(), 'mlock-'));
        await holdMachineForRun('ready', owner('a'), { root });
        const waitedFor: (MachineLockRecord | null)[] = [];
        await expect(holdMachineForRun('gate', owner('b'), { root, pollMs: 20, timeoutMs: 100, onWait: h => waitedFor.push(h) }))
            .rejects.toThrow(/whole-run is held by a/);
        expect(waitedFor[0]?.session).toBe('a');
        releaseMachineLock({ dir: join(root, WHOLE_RUN_LOCK) });
        await holdMachineForRun('gate', owner('b'), { root, pollMs: 20, timeoutMs: 1000 });
        releaseMachineLock({ dir: join(root, WHOLE_RUN_LOCK) });
    });

    it('does not pass over a live run two hours old, which the 90-minute default would', async () => {
        const root = mkdtempSync(join(tmpdir(), 'mlock-'));
        const dir = join(root, WHOLE_RUN_LOCK);
        mkdirSync(dir);
        // This test's own process is the holder: alive, and its lock is two hours old.
        writeFileSync(join(dir, 'owner.json'), JSON.stringify({ name: WHOLE_RUN_LOCK, session: 'long', worktree: '/w/long', pid: process.pid, at: new Date().toISOString() }));
        const twoHoursAgo = (Date.now() - 2 * 60 * 60_000) / 1000;
        utimesSync(dir, twoHoursAgo, twoHoursAgo);
        await expect(holdMachineForRun('ready', owner('b'), { root, pollMs: 20, timeoutMs: 100 })).rejects.toThrow(/whole-run is held by long/);
        // The default age limit takes the same lock: the reason a whole run names a longer one.
        releaseMachineLock(await acquireMachineLock(WHOLE_RUN_LOCK, owner('c'), { root, pollMs: 20, timeoutMs: 1000 }));
    });
});
