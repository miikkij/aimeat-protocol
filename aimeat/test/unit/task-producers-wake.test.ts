/**
 * @file test/unit/task-producers-wake.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Creating a task for an agent has to put a `task_assigned` delivery on the bus, from
 *   EVERY producer and not only the shared service. agent-task-write.ts emits it on the line after
 *   its webhook; four other places build their own AgentTaskRecord, write it with
 *   storage.createAgentTask() and had none. The workflow engine's copy of that miss cost a nightly
 *   paper two nights (crewaimeat, 2026-09-07 and 2026-09-08); these are its siblings, found in the
 *   same sweep and fixed before anyone had to report them.
 *
 *   COVERED HERE: the two producers a unit test can reach — the work bridge and the scheduler's
 *   public materialiseAgentTask. The scheduled `agent_task` kind and living-pulse's section
 *   dispatch are private inside larger state machines and carry the same one line, unasserted.
 * @usage pnpm test -- task-producers-wake
 * @version-history
 *   v1.0.0 -- 2026-09-08 -- Initial. Both cases fail on the pre-fix tree with zero deliveries.
 */
import { describe, expect, it } from 'vitest';
import { onDeliveryEvent, offDeliveryEvent } from '../../src/services/event-bus.js';
import { createTaskFromWork } from '../../src/services/work-task-bridge.js';
import { Scheduler } from '../../src/services/scheduler.js';
import type { Storage, WorkRecord, AgentTaskRecord } from '../../src/storage/interface.js';

interface Seen { target: string; kind: string; id: string }

/** Every delivery the bus sees while `fn` runs. */
async function deliveriesDuring(fn: () => Promise<unknown>): Promise<Seen[]> {
    const seen: Seen[] = [];
    const handler = (e: { target: string; kind: string; id: string }) =>
        void seen.push({ target: e.target, kind: e.kind, id: e.id });
    onDeliveryEvent(handler);
    try { await fn(); } finally { offDeliveryEvent(handler); }
    return seen;
}

const AGENT = 'news-fetcher#alice@aimeat-test-001';

describe('the work bridge wakes the provider it just gave a job to', () => {
    it('emits task_assigned for the provider agent', async () => {
        const created: AgentTaskRecord[] = [];
        const storage = {
            getAgentDirectives: async () => ({ directives: 'do the work' }),
            getAction: async () => ({ displayName: 'Fetch the sources' }),
            createAgentTask: async (r: AgentTaskRecord) => { created.push(r); return r; },
        } as unknown as Storage;
        const work = {
            trackingCode: 'W-1', actionId: 'fetch', requesterGaii: 'bob@aimeat-test-001', input: {},
        } as unknown as WorkRecord;

        const seen = await deliveriesDuring(() => createTaskFromWork(storage, work, AGENT));

        expect(created).toHaveLength(1);
        const wake = seen.filter(s => s.kind === 'task_assigned');
        expect(wake).toHaveLength(1);
        expect(wake[0].target).toBe(AGENT);
        expect(wake[0].id).toBe(created[0].id);
    });

    it('stays silent when the agent has no task system, because no task was created', async () => {
        const storage = { getAgentDirectives: async () => null } as unknown as Storage;
        const work = { trackingCode: 'W-2', actionId: 'fetch', requesterGaii: 'bob@n', input: {} } as unknown as WorkRecord;

        const seen = await deliveriesDuring(() => createTaskFromWork(storage, work, AGENT));
        expect(seen.filter(s => s.kind === 'task_assigned')).toHaveLength(0);
    });
});

describe('the scheduler wakes the agent it materialised a task for', () => {
    it('emits task_assigned, so a trigger reusing this path gets the whole wake it is promised', async () => {
        const created: AgentTaskRecord[] = [];
        const storage = {
            getAgent: async () => ({ gaii: AGENT, name: 'news-fetcher' }),
            createAgentTask: async (r: AgentTaskRecord) => { created.push(r); return r; },
            appendTaskEvent: async () => {},
        } as unknown as Storage;
        const scheduler = new Scheduler({ nodeId: 'aimeat-test-001' } as never, storage);

        const seen = await deliveriesDuring(() => scheduler.materialiseAgentTask({
            owner: 'alice@aimeat-test-001',
            agentGaii: AGENT,
            agentName: 'news-fetcher',
            parentRef: 'recipe-1',
            title: 'Fetch tonight',
        }));

        expect(created).toHaveLength(1);
        const wake = seen.filter(s => s.kind === 'task_assigned');
        expect(wake).toHaveLength(1);
        expect(wake[0].target).toBe(AGENT);
        expect(wake[0].id).toBe(created[0].id);
    });
});
