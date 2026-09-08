/**
 * @file test/unit/workflow-task-dispatch-wake.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Dispatching a workflow agent step must put a `task_assigned` delivery on the bus,
 *   the same one agent-task-write.ts emits right after its webhook. The engine builds its own
 *   record and writes it straight to storage, so nothing shared enforces this and nothing errored
 *   when it was missing: the task was created, the webhook fired, the tunnel heard nothing, and a
 *   parked spawn daemon slept through two nights of a nightly workflow (crewaimeat, 2026-09-07 and
 *   2026-09-08, 0/6 steps, agents reachable throughout).
 *
 *   The assertion is on the BUS rather than on a tunnel, because emitDelivery is the node's one
 *   hand-off point: whether a socket is open is the tunnel manager's business, and a target with no
 *   tunnel is a task that waits in the store, which is correct.
 * @usage pnpm test -- workflow-task-dispatch-wake
 * @version-history
 *   v1.0.0 -- 2026-09-08 -- Initial. Fails on the pre-fix engine, which emits no delivery at all.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { onDeliveryEvent, offDeliveryEvent } from '../../src/services/event-bus.js';
import { dispatchStep, type StepDeps } from '../../src/services/workflow/engine-steps.js';
import type { AgentTaskRecord } from '../../src/storage/interface.js';

interface Seen { target: string; kind: string; id: string }

/** Collect every delivery the bus sees while `fn` runs. */
async function deliveriesDuring(fn: () => Promise<unknown>): Promise<Seen[]> {
    const seen: Seen[] = [];
    const handler = (e: { target: string; kind: string; id: string }) =>
        void seen.push({ target: e.target, kind: e.kind, id: e.id });
    onDeliveryEvent(handler);
    try { await fn(); } finally { offDeliveryEvent(handler); }
    return seen;
}

/** The two storage calls the engine's dispatch actually makes, and nothing else. */
function stubDeps(): { deps: StepDeps; created: AgentTaskRecord[] } {
    const created: AgentTaskRecord[] = [];
    const storage = {
        createAgentTask: async (r: AgentTaskRecord) => { created.push(r); },
        appendTaskEvent: async () => {},
    };
    const deps = {
        storage: storage as unknown as StepDeps['storage'],
        config: { nodeId: 'aimeat-test-001' } as unknown as StepDeps['config'],
    } satisfies StepDeps;
    return { deps, created };
}

const run = {
    workflowId: 'evening-news', runId: 'run-1', status: 'running', vars: {}, steps: [],
    defSnapshot: { description: 'evening news' },
} as unknown as Parameters<typeof dispatchStep>[2];

const step = { id: 'fetch', agent: 'news-fetcher', description: 'fetch the sources' } as unknown as Parameters<typeof dispatchStep>[3];

afterEach(() => { /* handlers are removed in deliveriesDuring's finally */ });

describe('a dispatched workflow step wakes the agent it dispatched to', () => {
    it('emits task_assigned for the agent, addressed by its GAII', async () => {
        const { deps, created } = stubDeps();
        const seen = await deliveriesDuring(() =>
            dispatchStep(deps, 'alice@aimeat-test-001', run, step, undefined, () => {}));

        expect(created).toHaveLength(1);
        const wake = seen.filter(s => s.kind === 'task_assigned');
        expect(wake).toHaveLength(1);
        expect(wake[0].target).toBe('news-fetcher#alice@aimeat-test-001');
        expect(wake[0].id).toBe(created[0].id);
    });

    it('emits one per agent when a step names several', async () => {
        const { deps, created } = stubDeps();
        const many = { ...(step as object), agent: ['news-fetcher', 'editor'] } as typeof step;
        const seen = await deliveriesDuring(() =>
            dispatchStep(deps, 'alice@aimeat-test-001', run, many, undefined, () => {}));

        expect(created).toHaveLength(2);
        const targets = seen.filter(s => s.kind === 'task_assigned').map(s => s.target).sort();
        expect(targets).toEqual(['editor#alice@aimeat-test-001', 'news-fetcher#alice@aimeat-test-001']);
    });

    it('carries the task the agent is meant to read, not a bare id', async () => {
        const { deps, created } = stubDeps();
        let payload: unknown;
        const handler = (e: { kind: string; payload?: unknown }) => { if (e.kind === 'task_assigned') payload = e.payload; };
        onDeliveryEvent(handler);
        try {
            await dispatchStep(deps, 'alice@aimeat-test-001', run, step, undefined, () => {});
        } finally { offDeliveryEvent(handler); }

        expect((payload as AgentTaskRecord | undefined)?.id).toBe(created[0].id);
        expect((payload as AgentTaskRecord | undefined)?.status).toBe('active');
    });
});
