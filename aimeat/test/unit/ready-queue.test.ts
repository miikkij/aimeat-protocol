/**
 * @file test/unit/ready-queue.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The queue of pnpm ready on one machine (scripts/lib/ready-queue.ts): who is waiting and
 *   in which order, an entry whose process is gone, a verdict that answers one entry and no other, and
 *   what is removed with age.
 * @version-history
 *   v1.0.0 — 2026-11-23 — Initial.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KEEP_MS, readyQueue, type Verdict } from '../../scripts/lib/ready-queue.js';

const scratch = mkdtempSync(join(tmpdir(), 'aimeat-ready-queue-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const FLAGS = { full: false, fresh: false, noChecks: false, noMerge: false };
const ask = (session: string, pid = 1) => ({ session, worktree: `/w/${session}/aimeat`, sha: 'a'.repeat(40), flags: FLAGS, pid });
/** A clock that moves a second on every reading, so two entries never share a time. */
const clock = (start = Date.parse('2026-11-23T10:00:00Z')) => { let t = start; return () => (t += 1000); };
const landed = (main: string): Verdict => ({ status: 'landed', main, batch: 'batch-1', with: [], notes: [] });

describe('readyQueue', () => {
    it('lists the waiting sessions oldest first, whatever their names', () => {
        const q = readyQueue(join(scratch, 'order'), { alive: () => true, now: clock() });
        q.enqueue(ask('cc-zed-first'));
        q.enqueue(ask('cc-alice-second'));
        q.enqueue(ask('cc-bob-third'));
        expect(q.waiting().map(e => e.session)).toEqual(['cc-zed-first', 'cc-alice-second', 'cc-bob-third']);
    });

    it('keeps one entry a session: asking again replaces the first and moves it to the end', () => {
        const q = readyQueue(join(scratch, 'again'), { alive: () => true, now: clock() });
        const first = q.enqueue(ask('cc-alice-x'));
        q.enqueue(ask('cc-bob-y'));
        const second = q.enqueue({ ...ask('cc-alice-x'), sha: 'b'.repeat(40) });
        expect(second.id).not.toBe(first.id);
        expect(q.waiting().map(e => [e.session, e.sha[0]])).toEqual([['cc-bob-y', 'a'], ['cc-alice-x', 'b']]);
    });

    it('drops an entry whose pnpm ready is gone, so nothing lands for a session that stopped waiting', () => {
        const dir = join(scratch, 'gone');
        const q = readyQueue(dir, { alive: pid => pid !== 404, now: clock() });
        q.enqueue(ask('cc-alice-waits', 7));
        q.enqueue(ask('cc-bob-left', 404));
        expect(q.waiting().map(e => e.session)).toEqual(['cc-alice-waits']);
        expect(readdirSync(join(dir, 'queue'))).toEqual(['cc-alice-waits.json']);
    });

    it('gives a verdict to the entry it answers, takes that entry off the queue, and to no later entry of the session', () => {
        const q = readyQueue(join(scratch, 'verdict'), { alive: () => true, now: clock() });
        const first = q.enqueue(ask('cc-alice-x'));
        expect(q.verdictFor(first)).toBeNull();
        q.settle(first, landed('c'.repeat(40)));
        expect(q.verdictFor(first)).toEqual(landed('c'.repeat(40)));
        expect(q.waiting()).toEqual([]);

        // The session asks again: the old verdict is not this entry's answer.
        const second = q.enqueue(ask('cc-alice-x'));
        expect(q.verdictFor(second)).toBeNull();
        expect(q.waiting().map(e => e.id)).toEqual([second.id]);
    });

    it('does not take a newer entry off the queue when an older one of the same session is answered', () => {
        const q = readyQueue(join(scratch, 'late-verdict'), { alive: () => true, now: clock() });
        const first = q.enqueue(ask('cc-alice-x'));
        const second = q.enqueue(ask('cc-alice-x'));
        q.settle(first, { status: 'refused', reason: 'red', batch: 'batch-1', log: null });
        expect(q.waiting().map(e => e.id)).toEqual([second.id]);
        expect(q.verdictFor(second)).toBeNull();
    });

    it('forgets an entry and its verdict, and leaves another session alone', () => {
        const q = readyQueue(join(scratch, 'forget'), { alive: () => true, now: clock() });
        const alice = q.enqueue(ask('cc-alice-x'));
        const bob = q.enqueue(ask('cc-bob-y'));
        q.settle(alice, landed('c'.repeat(40)));
        q.forget(alice);
        q.forget(alice);
        expect(q.verdictFor(alice)).toBeNull();
        expect(q.waiting().map(e => e.id)).toEqual([bob.id]);
    });

    it('refuses a session name a path could be built from', () => {
        const q = readyQueue(join(scratch, 'names'), { alive: () => true });
        expect(() => q.enqueue(ask('../../outside'))).toThrow(/not a session name/);
        expect(() => q.enqueue(ask(''))).toThrow(/not a session name/);
    });

    it('removes a verdict nobody read and a log, once they are older than the keep time', () => {
        const dir = join(scratch, 'age');
        const q = readyQueue(dir, { alive: () => true, now: clock() });
        q.settle(q.enqueue(ask('cc-alice-old')), landed('c'.repeat(40)));
        q.settle(q.enqueue(ask('cc-bob-new')), landed('d'.repeat(40)));
        writeFileSync(q.logFile('batch-old'), 'old');
        writeFileSync(q.logFile('batch-new'), 'new');
        const old = (Date.now() - KEEP_MS - 60_000) / 1000;
        utimesSync(join(dir, 'verdicts', 'cc-alice-old.json'), old, old);
        utimesSync(q.logFile('batch-old'), old, old);

        readyQueue(dir, { alive: () => true });
        expect(readdirSync(join(dir, 'verdicts'))).toEqual(['cc-bob-new.json']);
        expect(existsSync(q.logFile('batch-old'))).toBe(false);
        expect(existsSync(q.logFile('batch-new'))).toBe(true);
    });

    it('names a log file from the batch id with nothing a path could be built from', () => {
        const dir = join(scratch, 'log-name');
        const q = readyQueue(dir, { alive: () => true });
        expect(q.logFile('batch-20261123-cc-alice-x')).toBe(join(dir, 'logs', 'batch-20261123-cc-alice-x.log'));
        expect(q.logFile('../../x')).toBe(join(dir, 'logs', '.._.._x.log'));
    });
});
