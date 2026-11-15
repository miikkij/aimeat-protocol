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
 *   v1.0.0 — 2026-11-15 — Initial.
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireMachineLock, releaseMachineLock, type MachineLockRecord } from '../../scripts/lib/machine-lock.js';

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
