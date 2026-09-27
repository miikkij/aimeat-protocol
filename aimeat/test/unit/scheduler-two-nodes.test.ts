/**
 * @file test/unit/scheduler-two-nodes.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two nodes in one process each schedule, and fire, their own copy of a job with the
 *   same id, and each scheduler still finds its job by the id.
 *
 *   WHY. croner keeps one list of job names for the whole process and refuses a name it already
 *   holds. Every node seeds its core jobs under the same ids (core:daily-allowance), and the
 *   multi-node E2E suites boot two or three nodes in one process. The croner name carries the node id
 *   beside the job id; the scheduler keeps its own map keyed by the job id, which stop, removeJob,
 *   reschedule and the next-run read use.
 * @usage cd aimeat && pnpm exec vitest run test/unit/scheduler-two-nodes.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { scheduledJobs } from 'croner';

vi.mock('../../src/utils/logger.js', async (importOriginal) => {
    const real = await importOriginal<Record<string, unknown>>();
    const quiet: unknown = new Proxy({}, { get: () => () => quiet });
    return { ...real, logger: quiet };
});

import { Scheduler } from '../../src/services/scheduler.js';
import type { ScheduledJobRecord, Storage } from '../../src/storage/interface.js';

const NODE_A = 'aimeat-sched-node-a';
const NODE_B = 'aimeat-sched-node-b';
const JOB_ID = 'core:daily-allowance';

/** The allowance job every node seeds, on a cron that fires every second so the test sees it fire. */
function allowanceJob(): ScheduledJobRecord {
    const now = new Date().toISOString();
    return {
        id: JOB_ID, name: 'Daily Allowance', type: 'core', coreHandler: 'daily-allowance',
        cron: '* * * * * *', enabled: true, createdBy: 'system', createdAt: now, updatedAt: now,
    };
}

/** One node's store: the job it seeded, and nothing to do for the writes a run makes. */
function storageWith(job: ScheduledJobRecord): Storage {
    return {
        listScheduledJobs: async () => [job],
        getScheduledJob: async (id: string) => (id === job.id ? job : null),
        updateScheduledJob: async () => {},
        createExecutionLog: async () => {},
    } as unknown as Storage;
}

/** The croner names of the allowance job that this process holds, sorted. */
const cronNames = (): string[] =>
    scheduledJobs.map((c) => c.name).filter((n): n is string => !!n && n.startsWith(JOB_ID)).sort();

const fired: string[] = [];
const schedulers: Scheduler[] = [];

beforeAll(async () => {
    for (const node of [NODE_A, NODE_B]) {
        const scheduler = new Scheduler({ nodeId: node } as never, storageWith(allowanceJob()));
        scheduler.registerCoreHandler('daily-allowance', async () => { fired.push(node); });
        await scheduler.start();
        schedulers.push(scheduler);
    }
});

afterAll(() => { for (const s of schedulers) s.stop(); });

describe('two nodes in one process, each with core:daily-allowance', () => {
    it('schedules a croner job for each node, named by the job id and the node id', () => {
        expect(cronNames()).toEqual([`${JOB_ID}@${NODE_A}`, `${JOB_ID}@${NODE_B}`]);
    });

    it('fires the job of each node', async () => {
        const deadline = Date.now() + 3_000;
        while (Date.now() < deadline && !(fired.includes(NODE_A) && fired.includes(NODE_B))) {
            await new Promise((r) => setTimeout(r, 50));
        }
        expect([...new Set(fired)].sort()).toEqual([NODE_A, NODE_B]);
    });

    it('finds the job by its id to remove, reschedule and stop it', async () => {
        const [a] = schedulers;
        a.removeJob(JOB_ID);
        expect(cronNames()).toEqual([`${JOB_ID}@${NODE_B}`]);
        await a.reschedule(JOB_ID);
        expect(cronNames()).toEqual([`${JOB_ID}@${NODE_A}`, `${JOB_ID}@${NODE_B}`]);
        a.stop();
        expect(cronNames()).toEqual([`${JOB_ID}@${NODE_B}`]);
    });
});
