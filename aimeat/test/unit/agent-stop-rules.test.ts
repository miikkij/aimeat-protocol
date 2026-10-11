/**
 * @file test/unit/agent-stop-rules.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What "stopped" means for an agent, as the pure rules (services/agent-stop-rules.ts):
 *   which fields a list shows, and which deliveries and webhook events would start new work and are
 *   therefore held. The line the two lists draw is the feature: a stopped agent must still hear
 *   that a task it is doing was cancelled, and must not be woken for a new one.
 * @usage pnpm exec vitest run test/unit/agent-stop-rules.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial.
 */
import { describe, expect, it } from 'vitest';
import { isStopped, stoppedView, isWakeDelivery, isWakeWebhookEvent } from '../../src/services/agent-stop-rules.js';

describe('whether an agent is stopped', () => {
    it('is the presence of stoppedAt, and nothing else', () => {
        expect(isStopped({ stoppedAt: '2026-10-11T08:00:00.000Z' })).toBe(true);
        expect(isStopped({ stoppedAt: null })).toBe(false);
        expect(isStopped({})).toBe(false);
        expect(isStopped(null)).toBe(false);
        expect(isStopped(undefined)).toBe(false);
    });

    it('the view names who and when while stopped, and nothing once started', () => {
        expect(stoppedView({ stoppedAt: '2026-10-11T08:00:00.000Z', stoppedBy: 'alice@n' }))
            .toEqual({ stopped: true, stopped_at: '2026-10-11T08:00:00.000Z', stopped_by: 'alice@n' });
        expect(stoppedView({})).toEqual({ stopped: false, stopped_at: null, stopped_by: null });
        // A leftover name without a time is not a stop, and is not shown as one.
        expect(stoppedView({ stoppedAt: null, stoppedBy: 'alice@n' })).toEqual({ stopped: false, stopped_at: null, stopped_by: null });
    });
});

describe('what is held from a stopped agent, and what still reaches it', () => {
    it('a delivery that hands it new work is held', () => {
        for (const kind of ['task_assigned', 'dm.inbound', 'v2.message', 'v2.task.assigned', 'workspace.record']) {
            expect(isWakeDelivery(kind), kind).toBe(true);
        }
    });

    it('a cancelled task and a changed definition still reach it: neither starts work', () => {
        for (const kind of ['task.cancelled', 'crew.def_updated', 'v2.task.cancelled', 'something.new']) {
            expect(isWakeDelivery(kind), kind).toBe(false);
        }
    });

    it('the same line over a webhook: new work is held, news of work in flight is sent', () => {
        for (const event of ['task.queued', 'task.approved', 'message.inbound']) expect(isWakeWebhookEvent(event), event).toBe(true);
        for (const event of ['task.updated', 'task.paused', 'task.cancelled']) expect(isWakeWebhookEvent(event), event).toBe(false);
    });
});
