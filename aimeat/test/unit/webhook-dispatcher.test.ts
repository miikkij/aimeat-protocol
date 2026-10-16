/**
 * @file test/unit/webhook-dispatcher.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The agent webhook dispatcher's retry and auto-disable (QA audit F07a-01). Until now the
 *   dispatcher appeared in tests only as a stub, so its retry schedule, its fail counter and the
 *   auto-disable after ten failures were asserted nowhere. safeFetch and validateOutboundUrl are
 *   replaced by recorders, the timers are fake, and storage is a small in-memory stand-in for the
 *   four methods the dispatcher calls. The signature itself is proven against a real receiver in
 *   test/e2e-agent-webhook.ts.
 * @usage cd aimeat && pnpm exec vitest run test/unit/webhook-dispatcher.test.ts
 * @version-history
 *   2026-10-16 — Initial (QA audit F07a-01).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';

const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
let answer: () => Promise<Response> = async () => new Response('{}', { status: 200 });

vi.mock('../../src/utils/url-validator.js', async (orig) => ({
  ...(await orig<typeof import('../../src/utils/url-validator.js')>()),
  validateOutboundUrl: vi.fn(async () => ({ valid: true })),
  safeFetch: vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
    return answer();
  }),
}));

const { createWebhookDispatcher } = await import('../../src/services/webhook-dispatcher.js');

const GAII = 'bot#alice@node';
const SECRET = 'dispatcher-test-secret-0123456789';
type Agent = { gaii: string; webhookUrl: string; webhookSecret: string; webhookEnabled: boolean; webhookFailCount: number; webhookLastSuccess?: string; webhookLastFailure?: string };
let agent: Agent;
const log: Array<{ status: string; attemptCount: number; httpStatus?: number }> = [];
const storage = {
  getAgent: async () => agent,
  updateAgent: async (_g: string, u: Partial<Agent>) => { agent = { ...agent, ...u }; return agent; },
  appendDeliveryLog: async (e: { status: string; attemptCount: number; httpStatus?: number }) => { log.push(e); },
  pruneDeliveryLog: async () => 0,
};
const dispatcher = createWebhookDispatcher({ config: { nodeId: 'node' } as never, storage: storage as never });

/** Let the fetch promise chain and the bookkeeping after it run. */
async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); await vi.advanceTimersByTimeAsync(0); }

describe('the webhook dispatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    calls.length = 0; log.length = 0;
    agent = { gaii: GAII, webhookUrl: 'https://agent.example/hook', webhookSecret: SECRET, webhookEnabled: true, webhookFailCount: 0 };
    answer = async () => new Response('{}', { status: 200 });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('a 2xx delivery is signed over the body it sends, resets the fail count and is logged as one attempt', async () => {
    agent.webhookFailCount = 4;
    await dispatcher.dispatchWebhookEvent(GAII, 'task.queued', { task_id: 't1' });
    await settle();
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.headers['X-AIMEAT-Signature']).toBe(`sha256=${createHmac('sha256', SECRET).update(c.body).digest('hex')}`);
    expect(c.headers['X-AIMEAT-Event']).toBe('task.queued');
    expect(JSON.parse(c.body)).toMatchObject({ event: 'task.queued', agent_gaii: GAII, node_id: 'node', data: { task_id: 't1' } });
    expect(agent.webhookFailCount).toBe(0);
    expect(typeof agent.webhookLastSuccess).toBe('string');
    expect(log).toEqual([expect.objectContaining({ status: 'success', attemptCount: 1, httpStatus: 200 })]);
  });

  it('a failing receiver is tried four times, at 5 s, 30 s and 2 min, then counted once as failed', async () => {
    answer = async () => new Response('no', { status: 503 });
    await dispatcher.dispatchWebhookEvent(GAII, 'task.updated', { task_id: 't2' });
    await settle();
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(4_999); await settle();
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); await settle();
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(30_000); await settle();
    expect(calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(120_000); await settle();
    expect(calls).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(600_000); await settle();
    expect(calls).toHaveLength(4);
    expect(agent.webhookFailCount).toBe(1);
    expect(agent.webhookEnabled).toBe(true);
    expect(log).toEqual([expect.objectContaining({ status: 'failed', attemptCount: 4, httpStatus: 503 })]);
  });

  it('the tenth failed delivery switches the webhook off, and a disabled webhook is not called', async () => {
    answer = async () => { throw new Error('connect ECONNREFUSED'); };
    agent.webhookFailCount = 9;
    await dispatcher.dispatchWebhookEvent(GAII, 'task.updated', { task_id: 't3' });
    await settle();
    await vi.advanceTimersByTimeAsync(5_000 + 30_000 + 120_000); await settle();
    expect(agent.webhookFailCount).toBe(10);
    expect(agent.webhookEnabled).toBe(false);
    calls.length = 0;
    await dispatcher.dispatchWebhookEvent(GAII, 'task.updated', { task_id: 't4' });
    await settle();
    expect(calls).toHaveLength(0);
  });
});
