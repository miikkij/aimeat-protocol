/**
 * @file test/unit/scheduler-first-fire-dst.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A schedule's first run is not lost after it is created or after a restart, and every
 *   kind of schedule keeps its times through the summer-time and winter-time changes in Europe/Helsinki.
 *
 *   WHY. On the test place guestkoey3wfwk (2026-11-02) schedule 77293981, every four minutes, left no
 *   trace of its 08:52:00 UTC fire and ran normally at 08:56:00. croner 10 read the clock in
 *   _checkTrigger and again while computing the next target. A timer that woke just before the target,
 *   with the second turning between those reads, moved a job that had never fired to its following
 *   occurrence without running it. A restart re-arms every job, so a 07:00 digest could lose a day's run
 *   after a deploy. croner 11 computes from the one clock read.
 *
 *   The real Scheduler, the real croner and the real SQLite store run on a clock this file controls:
 *   Date and setTimeout are replaced, so a timer can wake a millisecond early, and each clock read can
 *   advance the clock. Every fire goes through claimCronFire, so a wrong fire time from previousRuns
 *   would lose the claim and fail the test too.
 * @usage cd aimeat && pnpm exec vitest run test/unit/scheduler-first-fire-dst.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial, with the move to croner 11 (Jouni, 2.11, option B).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

vi.mock('../../src/utils/logger.js', async (importOriginal) => {
    const real = await importOriginal<Record<string, unknown>>();
    const quiet: unknown = new Proxy({}, { get: () => () => quiet });
    return { ...real, logger: quiet };
});
vi.mock('../../src/services/system-fault-report.js', () => ({ reportJobFault: vi.fn(async () => {}) }));
vi.mock('../../src/services/notify.js', () => ({ notify: vi.fn(async () => ({ stored: true })) }));

import { createStorage } from '../../src/storage/storage-factory.js';
import { Scheduler } from '../../src/services/scheduler.js';
import type { ScheduledJobRecord, Storage } from '../../src/storage/interface.js';

const SQLITE_PATH = `./test/.schedfirstfire-${process.pid}.db`;
const HELSINKI = 'Europe/Helsinki';
const RealDate = Date;
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const realSetImmediate = globalThis.setImmediate;

let storage: Storage;
const ms = (iso: string): number => RealDate.parse(iso);
const iso = (t: number): string => new RealDate(t).toISOString();

/** A clock this test moves. `readStep` is added after each read, so the time can pass between two reads. */
const clock = { now: 0, readStep: 0 };
interface FakeTimer { id: number; at: number; fn: () => void }
let timers: FakeTimer[] = [];
let nextTimerId = 1;

function readClock(): number {
    const t = clock.now;
    clock.now += clock.readStep;
    return t;
}

class ClockDate extends RealDate {
    constructor(...args: unknown[]) {
        if (args.length === 0) super(readClock());
        else super(...(args as [number]));
    }
    static override now(): number { return readClock(); }
}

function installClock(start: string): void {
    clock.now = ms(start);
    clock.readStep = 0;
    timers = [];
    vi.stubGlobal('Date', ClockDate);
    vi.stubGlobal('setTimeout', (fn: () => void, delay = 0) => {
        const timer: FakeTimer = { id: nextTimerId++, at: clock.now + Math.max(0, delay), fn };
        timers.push(timer);
        return { id: timer.id, unref() { return this; }, ref() { return this; } };
    });
    vi.stubGlobal('clearTimeout', (handle?: { id?: number }) => {
        timers = timers.filter(t => t.id !== handle?.id);
    });
}

/** Let the promises a fire started finish, on the real event loop. */
const settle = async (): Promise<void> => {
    for (let i = 0; i < 12; i++) await new Promise(r => realSetImmediate(r));
};

/**
 * Run every timer due up to `until`. A timer due exactly at an instant in `earlyWake` wakes `early` ms
 * ahead, and each clock read inside it then takes a millisecond, so the second turns during its reads.
 */
async function runUntil(until: number, earlyWake: { at: Set<number>; early: number } = { at: new Set(), early: 0 }): Promise<void> {
    for (;;) {
        const next = timers.reduce<FakeTimer | null>((a, t) => (!a || t.at < a.at ? t : a), null);
        if (!next || next.at > until) break;
        timers = timers.filter(t => t !== next);
        if (earlyWake.at.delete(next.at)) {
            clock.now = next.at - earlyWake.early;
            clock.readStep = 1;
        } else {
            clock.now = Math.max(clock.now, next.at);
        }
        next.fn();
        clock.readStep = 0;
        await settle();
    }
    clock.now = Math.max(clock.now, until);
}

const running: Scheduler[] = [];
const createdJobs: string[] = [];

/** A stored job and a scheduler that records when it ran it. */
async function armed(cron: string, timezone: string | undefined, how: 'created' | 'restart'): Promise<{ id: string; ran: string[] }> {
    const now = iso(clock.now);
    const job: ScheduledJobRecord = {
        id: `test:firstfire-${randomUUID()}`, name: 'first fire', type: 'core', coreHandler: 'count', cron,
        enabled: true, createdBy: 'system', createdAt: now, updatedAt: now,
        ...(timezone ? { timezone } : {}),
    };
    await storage.createScheduledJob(job);
    createdJobs.push(job.id);
    const ran: string[] = [];
    const scheduler = new Scheduler({ nodeId: 'aimeat-sched-firstfire' } as never, storage);
    scheduler.registerCoreHandler('count', async () => { ran.push(iso(clock.now)); });
    scheduler.setRunOptions({ catchUpDelayMs: 2_000_000_000 });
    if (how === 'created') scheduler.addJob(job);
    else await scheduler.start();
    running.push(scheduler);
    await settle();
    return { id: job.id, ran };
}

beforeAll(async () => {
    storage = await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH });
}, 60_000);

/** Stop the schedulers and remove their jobs, so the next start() reads only the next job. */
async function clearArmed(): Promise<void> {
    for (const s of running.splice(0)) s.stop();
    for (const id of createdJobs.splice(0)) await storage.deleteScheduledJob(id);
}

afterEach(async () => {
    await clearArmed();
    vi.unstubAllGlobals();
});

afterAll(async () => {
    await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
    for (const suffix of ['', '-wal', '-shm']) {
        const p = SQLITE_PATH + suffix;
        if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch */ } }
    }
});

describe('the first run of a schedule', () => {
    // 1 ms early: the second turns between the check and the next-target reads. 2 ms early: it turns
    // between the two next-target reads. 3 and 5 ms: it turns later, and the job has to fire anyway.
    for (const early of [1, 2, 3, 5]) {
        for (const timezone of [HELSINKI, undefined]) {
            it(`after the schedule is created, with a timer ${early} ms early, ${timezone ?? 'no time zone'}`, async () => {
                installClock('2026-11-02T08:48:43.000Z');
                const { id, ran } = await armed('*/4 * * * *', timezone, 'created');
                await runUntil(ms('2026-11-02T08:52:30.000Z'), { at: new Set([ms('2026-11-02T08:52:00.000Z')]), early });
                expect(ran.length, `ran at ${JSON.stringify(ran)}`).toBe(1);
                expect(ms(ran[0])).toBeGreaterThanOrEqual(ms('2026-11-02T08:52:00.000Z'));
                expect(ms(ran[0])).toBeLessThan(ms('2026-11-02T08:52:01.000Z'));
                expect(await storage.claimScheduledFire(id, '2026-11-02T08:52:00.000Z'), 'the fire was claimed under its scheduled time').toBe(false);
            });
        }

        it(`of a 07:00 digest after a restart, with a timer ${early} ms early`, async () => {
            installClock('2026-11-02T04:10:00.000Z');
            const { ran } = await armed('0 7 * * *', HELSINKI, 'restart');
            await runUntil(ms('2026-11-02T05:00:30.000Z'), { at: new Set([ms('2026-11-02T05:00:00.000Z')]), early });
            expect(ran.length, `ran at ${JSON.stringify(ran)}`).toBe(1);
            expect(ms(ran[0])).toBeLessThan(ms('2026-11-02T05:00:01.000Z'));
        });
    }

    it('fires at its time when the timer is not early, and the job goes on', async () => {
        installClock('2026-11-02T08:48:43.000Z');
        const { ran } = await armed('*/4 * * * *', HELSINKI, 'created');
        await runUntil(ms('2026-11-02T09:00:30.000Z'));
        expect(ran).toEqual(['2026-11-02T08:52:00.000Z', '2026-11-02T08:56:00.000Z', '2026-11-02T09:00:00.000Z']);
    });

    it('of a 07:00 digest after a restart on the morning the clocks change', async () => {
        installClock('2027-03-28T03:00:00.000Z');
        const spring = await armed('0 7 * * *', HELSINKI, 'restart');
        await runUntil(ms('2027-03-28T04:00:30.000Z'), { at: new Set([ms('2027-03-28T04:00:00.000Z')]), early: 1 });
        expect(spring.ran.length, `ran at ${JSON.stringify(spring.ran)}`).toBe(1);
        expect(ms(spring.ran[0])).toBeLessThan(ms('2027-03-28T04:00:01.000Z'));
        await clearArmed();

        installClock('2027-10-31T03:00:00.000Z');
        const autumn = await armed('0 7 * * *', HELSINKI, 'restart');
        await runUntil(ms('2027-10-31T05:00:30.000Z'), { at: new Set([ms('2027-10-31T05:00:00.000Z')]), early: 1 });
        expect(autumn.ran.length, `ran at ${JSON.stringify(autumn.ran)}`).toBe(1);
        expect(ms(autumn.ran[0])).toBeLessThan(ms('2027-10-31T05:00:01.000Z'));
    });

    it('after a restart inside the hour that repeats in autumn', async () => {
        // 01:30 UTC is 03:30 winter time, the second time 03:30 comes that night.
        installClock('2027-10-31T01:30:30.000Z');
        const { ran } = await armed('*/4 * * * *', HELSINKI, 'restart');
        await runUntil(ms('2027-10-31T01:40:30.000Z'));
        expect(ran).toEqual(['2027-10-31T01:32:00.000Z', '2027-10-31T01:36:00.000Z', '2027-10-31T01:40:00.000Z']);
    });
});

// In Helsinki the clocks go from 03:00 to 04:00 on 2027-03-28 (01:00 UTC), and from 04:00 back to 03:00
// on 2027-10-31 (01:00 UTC). Summer time is UTC+3, winter time UTC+2.
describe('the summer-time and winter-time changes, Europe/Helsinki', () => {
    const fires = async (cron: string, from: string, to: string): Promise<string[]> => {
        installClock(from);
        const { ran } = await armed(cron, HELSINKI, 'created');
        await runUntil(ms(to));
        return ran.map(t => t.replace(':00.000Z', 'Z'));
    };
    const every = (startIso: string, count: number, stepMinutes: number): string[] =>
        Array.from({ length: count }, (_, i) => iso(ms(startIso) + i * stepMinutes * 60_000).replace(':00.000Z', 'Z'));

    it('the 07:00 digest stays at 07:00 on the clock, once a day, in spring', async () => {
        expect(await fires('0 7 * * *', '2027-03-26T22:00:00Z', '2027-03-29T22:00:00Z'))
            .toEqual(['2027-03-27T05:00Z', '2027-03-28T04:00Z', '2027-03-29T04:00Z']);
    }, 60_000);

    it('the 07:00 digest stays at 07:00 on the clock, once a day, in autumn', async () => {
        expect(await fires('0 7 * * *', '2027-10-29T22:00:00Z', '2027-11-01T22:00:00Z'))
            .toEqual(['2027-10-30T04:00Z', '2027-10-31T05:00Z', '2027-11-01T05:00Z']);
    }, 60_000);

    it('a weekly Sunday schedule runs once on the Sunday the clocks change', async () => {
        expect(await fires('0 7 * * 0', '2027-03-27T00:00:00Z', '2027-03-29T00:00:00Z')).toEqual(['2027-03-28T04:00Z']);
        await clearArmed();
        expect(await fires('0 7 * * 0', '2027-10-30T00:00:00Z', '2027-11-01T00:00:00Z')).toEqual(['2027-10-31T05:00Z']);
    }, 60_000);

    it('a daily schedule inside the hour that spring skips runs right after the gap, once', async () => {
        // 03:30 does not exist on 2027-03-28: it runs at 04:00 summer time (croner 10 ran it at 04:30).
        expect(await fires('30 3 * * *', '2027-03-26T22:00:00Z', '2027-03-29T22:00:00Z'))
            .toEqual(['2027-03-27T01:30Z', '2027-03-28T01:00Z', '2027-03-29T00:30Z']);
    }, 60_000);

    it('a daily schedule inside the hour that autumn repeats runs once, the first time', async () => {
        expect(await fires('30 3 * * *', '2027-10-29T22:00:00Z', '2027-11-01T22:00:00Z'))
            .toEqual(['2027-10-30T00:30Z', '2027-10-31T00:30Z', '2027-11-01T01:30Z']);
    }, 60_000);

    it('a schedule every four minutes keeps a four-minute step through spring', async () => {
        expect(await fires('*/4 * * * *', '2027-03-27T23:58:00Z', '2027-03-28T02:00:30Z'))
            .toEqual(every('2027-03-28T00:00:00Z', 31, 4));
    }, 60_000);

    it('a schedule every four minutes keeps a four-minute step through autumn', async () => {
        expect(await fires('*/4 * * * *', '2027-10-30T23:58:00Z', '2027-10-31T02:00:30Z'))
            .toEqual(every('2027-10-31T00:00:00Z', 31, 4));
    }, 60_000);

    it('an hourly schedule runs every real hour through both changes', async () => {
        expect(await fires('0 * * * *', '2027-03-27T22:30:00Z', '2027-03-28T04:30:00Z'))
            .toEqual(every('2027-03-27T23:00:00Z', 6, 60));
        await clearArmed();
        expect(await fires('0 * * * *', '2027-10-30T22:30:00Z', '2027-10-31T04:30:00Z'))
            .toEqual(every('2027-10-30T23:00:00Z', 6, 60));
    }, 60_000);

    it('a schedule with several hours skips the missing time in spring and runs twice in the repeated hour in autumn', async () => {
        expect(await fires('15 3,4 * * *', '2027-03-27T22:00:00Z', '2027-03-28T04:00:00Z')).toEqual(['2027-03-28T01:15Z']);
        await clearArmed();
        expect(await fires('15 3,4 * * *', '2027-10-30T22:00:00Z', '2027-10-31T04:00:00Z'))
            .toEqual(['2027-10-31T00:15Z', '2027-10-31T01:15Z', '2027-10-31T02:15Z']);
    }, 60_000);
});

// A clock left replaced would change what every later test in this worker reads.
it('restores the real clock after each test', () => {
    expect(globalThis.setTimeout).toBe(realSetTimeout);
    expect(globalThis.clearTimeout).toBe(realClearTimeout);
    expect(Date).toBe(RealDate);
});
