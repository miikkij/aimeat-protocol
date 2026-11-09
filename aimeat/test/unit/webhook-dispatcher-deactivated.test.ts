/**
 * @file test/unit/webhook-dispatcher-deactivated.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The agent webhook dispatcher and a deactivated account (secaudit2026nov08 round 14, older
 *   item O2). safeFetch and validateOutboundUrl are recorders, as in webhook-dispatcher.test.ts, and
 *   storage is a small in-memory stand-in that also answers getOwner.
 *   - Designed use: the agent of an active account gets the event, signed, once.
 *   - While the account is deactivated the agent gets no webhook, and nothing is counted against it.
 *   - After reactivation the next event is delivered again: nothing was deleted or switched off.
 * @usage cd aimeat && pnpm exec vitest run test/unit/webhook-dispatcher-deactivated.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08 round 14, older item O2).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const calls: string[] = [];

vi.mock('../../src/utils/url-validator.js', async (orig) => ({
  ...(await orig<typeof import('../../src/utils/url-validator.js')>()),
  validateOutboundUrl: vi.fn(async () => ({ valid: true })),
  safeFetch: vi.fn(async (url: string) => { calls.push(url); return new Response('{}', { status: 200 }); }),
}));

const { createWebhookDispatcher } = await import('../../src/services/webhook-dispatcher.js');

const GAII = 'bot#alice@node';
type Agent = { gaii: string; webhookUrl: string; webhookSecret: string; webhookEnabled: boolean; webhookFailCount: number };
let agent: Agent;
let disabledAt: string | null = null;
const storage = {
  getAgent: async () => agent,
  getOwner: async (name: string) => (name === 'alice' ? { name: 'alice', disabledAt } : null),
  updateAgent: async (_g: string, u: Partial<Agent>) => { agent = { ...agent, ...u }; return agent; },
  appendDeliveryLog: async () => undefined,
  pruneDeliveryLog: async () => 0,
};
const dispatcher = createWebhookDispatcher({ config: { nodeId: 'node' } as never, storage: storage as never });

/** Let the fetch promise chain and the bookkeeping after it run. */
async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); await vi.advanceTimersByTimeAsync(0); }

describe('the webhook dispatcher and a deactivated account', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    calls.length = 0;
    disabledAt = null;
    agent = { gaii: GAII, webhookUrl: 'https://agent.example/hook', webhookSecret: 'secret-0123456789', webhookEnabled: true, webhookFailCount: 0 };
  });
  afterEach(() => { vi.useRealTimers(); });

  it('delivers to the agent of an active account (designed use)', async () => {
    await dispatcher.dispatchWebhookEvent(GAII, 'message.inbound', { message_id: 'm1' });
    await settle();
    expect(calls).toEqual(['https://agent.example/hook']);
  });

  it('sends nothing while the account is deactivated, and counts nothing against the webhook', async () => {
    disabledAt = new Date().toISOString();
    await dispatcher.dispatchWebhookEvent(GAII, 'message.inbound', { message_id: 'm2' });
    await dispatcher.dispatchWebhookEvent(GAII, 'task.updated', { task_id: 't2' });
    await settle();
    expect(calls).toEqual([]);
    expect(agent.webhookFailCount).toBe(0);
    expect(agent.webhookEnabled).toBe(true);
  });

  it('delivers again after reactivation', async () => {
    disabledAt = new Date().toISOString();
    await dispatcher.dispatchWebhookEvent(GAII, 'message.inbound', { message_id: 'm3' });
    disabledAt = null;
    await dispatcher.dispatchWebhookEvent(GAII, 'message.inbound', { message_id: 'm4' });
    await settle();
    expect(calls).toEqual(['https://agent.example/hook']);
  });
});
