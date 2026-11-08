/**
 * @file test/unit/a2a-foreign-paid-turn.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The paid turn of the A2A door for a caller from another node (ForeignA2AHandler):
 *   two paid turns for one quoted work at the same moment collect once, and a collected payment whose
 *   paid-work write fails is recorded as undelivered for the seller and the caller is told not to pay
 *   again (secaudit2026nov08 round 14, continueWork:no-claim-before-collect and
 *   continueWork:settled-payment-failed-write-unrecorded).
 *
 *   The handler is the real one over a real SQLite storage in memory. The offering lookup and the
 *   price are stubbed (they read the EXCHANGE listing, which e2e-agent-v2-a2a covers end to end), and
 *   the x402 rail is a stub registered under the x402 handler id, so nothing outside is contacted. A
 *   storage wrapper holds the reads of one work record in pairs, so both turns read the work before
 *   either writes (docs/pitfalls.md, better-sqlite3 entry).
 * @usage cd aimeat && pnpm exec vitest run test/unit/a2a-foreign-paid-turn.test.ts
 * @version-history
 *   2026-11-08 — Initial (secaudit2026nov08 round 14).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { TaskState, type AgentCard } from '@a2a-js/sdk';
import type { ServerCallContext } from '@a2a-js/sdk/server';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, AgentRecord, MemoryRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { registerPaymentHandler } from '../../src/commerce/payment-handlers.js';
import { X402_HANDLER_ID } from '../../src/commerce/x402-handler.js';
import type { ForeignPeer } from '../../src/services/a2a-foreign.js';

const RUN = randomUUID().slice(0, 8);
const NODE_ID = `a2a-paid-${RUN}`;
const SELLER = `alice${RUN}`;
const SELLER_GHII = `${SELLER}@${NODE_ID}`;
const PRICE = 2_500_000;

vi.mock('../../src/services/a2a-offering.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/services/a2a-offering.js')>();
  const offering = () => ({
    offeringId: 'off-1', providerGhii: SELLER_GHII, providerOwner: SELLER, ext: `agentwork:${SELLER}/worker`,
    action: 'summarize', unit: 'money', title: 'Summarise', kind: 'agent-work', state: 'listed',
    surface: { kind: 'agent-work', agentName: 'worker', taskType: 'summarize' },
  });
  return {
    ...real,
    findSellableOffering: async () => ({ ok: true, offering: offering() }),
    priceForForeignCaller: async () => ({
      ok: true,
      price: { unit: 'money', amount: PRICE, currency: 'USD', requirements: { resource: 'https://node.test/v1/a2a/x/worker', description: 'Summarise' } },
    }),
  };
});

const { ForeignA2AHandler } = await import('../../src/services/a2a-foreign-handler.js');

type TestStorage = Storage & { close(): void | Promise<void> };

/** Reads of the held work key answer in pairs; writes to it throw while `failPaidWrite` is set. */
function wrapped(inner: Storage) {
  let held: string | null = null;
  let waiting: (() => void) | null = null;
  const state = { failPaidWrite: false };
  const isPaidWork = (r: MemoryRecord): boolean => r.ownerGaii === 'exchange-work'
    && Number((r.value as { chargedUnits?: number } | null)?.chargedUnits ?? 0) > 0;
  const proxy = new Proxy(inner, {
    get(target, prop) {
      const v = Reflect.get(target, prop, target) as unknown;
      if (typeof v !== 'function') return v;
      const name = String(prop);
      const fn = (v as (...a: unknown[]) => unknown).bind(target);
      if (name === 'setMemory' || name === 'setMemoryIfVersion' || name === 'createMemoryIfAbsent') {
        return async (rec: MemoryRecord, ...rest: unknown[]) => {
          if (state.failPaidWrite && isPaidWork(rec)) throw new Error('connection lost');
          return fn(rec, ...rest);
        };
      }
      if (name !== 'getMemory') return fn;
      return async (owner: string, key: string, ...rest: unknown[]) => {
        const out = await fn(owner, key, ...rest);
        if (owner !== 'exchange-work' || key !== held) return out;
        if (waiting) { const w = waiting; waiting = null; w(); return out; }
        await new Promise<void>(resolve => {
          const timer = setTimeout(() => { if (waiting === done) waiting = null; resolve(); }, 300);
          const done = () => { clearTimeout(timer); resolve(); };
          waiting = done;
        });
        return out;
      };
    },
  }) as Storage;
  return {
    storage: proxy, state,
    hold(key: string | null): void { held = key; waiting = null; },
  };
}

describe('the A2A paid turn for a caller from another node', () => {
  let inner: TestStorage;
  let ctl: ReturnType<typeof wrapped>;
  let config: AimeatConfig;
  const collects: string[] = [];
  let refunds = 0;
  const agent = { owner: SELLER, name: 'worker', gaii: `worker#${SELLER}@${NODE_ID}` } as unknown as AgentRecord;
  const peer: ForeignPeer = {
    gaii: 'scout#bob@far.example', keyX: 'x', kid: 'k', cardUri: 'https://far.example/card', jwksUri: 'https://far.example/jwks',
    displayName: 'scout', firstSeenAt: '', lastSeenAt: '', keyHost: 'far.example', hostIsNode: true,
  };
  const ctx = {} as ServerCallContext;
  const proof = (nonce: string) => Buffer.from(JSON.stringify({
    x402Version: 1, scheme: 'exact', network: 'base-sepolia',
    payload: { signature: '0x00', authorization: { nonce, from: '0x1', to: '0x2', value: String(PRICE) } },
  })).toString('base64');
  const handlerFor = (header?: string) => new ForeignA2AHandler(ctl.storage, config, agent, peer, {} as AgentCard, { header });
  const userMessage = (taskId?: string) => ({
    message: {
      messageId: randomUUID(), role: 'ROLE_USER', ...(taskId ? { taskId } : {}),
      parts: [{ content: { $case: 'text', value: 'Summarise this.' } }],
    },
  }) as never;

  /** A quoted, unpaid work id. */
  async function quoted(): Promise<string> {
    const task = await handlerFor().sendMessage(userMessage(), ctx) as { id: string; metadata?: Record<string, unknown> };
    expect(Array.isArray(task.metadata?.accepts)).toBe(true);
    return task.id;
  }
  const storedWork = async (id: string) => (await inner.getMemory('exchange-work', `xwork.${id}`))?.value as
    { state: string; chargedUnits: number; note: string };

  beforeAll(async () => {
    inner = await createStorage({ provider: 'sqlite', sqlitePath: ':memory:' }) as TestStorage;
    ctl = wrapped(inner);
    setThisNodeId(NODE_ID);
    config = { ...loadConfig().config, nodeId: NODE_ID, baseUrl: 'https://node.test', x402Enabled: true } as AimeatConfig;
    registerPaymentHandler({
      id: X402_HANDLER_ID, title: 'x402 (test)', currencies: ['USD'],
      async collect(_c, args) {
        await new Promise(r => setTimeout(r, 30));
        const nonce = (args.instrument as { payload: { authorization: { nonce: string } } }).payload.authorization.nonce;
        collects.push(nonce);
        return { trackingCode: `x402_USDC_test_${nonce}` };
      },
      async payout() { /* non-custodial */ },
      async refund() { refunds++; return { outcome: 'not_possible', detail: 'onchain' }; },
    } as never);
  }, 60_000);

  beforeEach(() => { collects.length = 0; refunds = 0; ctl.hold(null); ctl.state.failPaidWrite = false; });

  afterAll(async () => {
    setThisNodeId(null);
    await inner.close();
  });

  it('one paid turn settles once, books the sale and opens the work for the provider', async () => {
    const id = await quoted();
    const task = await handlerFor(proof('n-usage')).sendMessage(userMessage(id), ctx) as { status: { state: string } };
    expect(task.status.state).toBe(TaskState.TASK_STATE_WORKING);
    expect(collects).toEqual(['n-usage']);
    const w = await storedWork(id);
    expect(w.state).toBe('open');
    expect(w.chargedUnits).toBe(PRICE);
    expect(w.note).toContain('paid x402_USDC_test_n-usage');
    const fees = await inner.listMemory(SELLER_GHII, { prefix: 'commerce.platform-fee.' } as never) as unknown as { items?: MemoryRecord[] } | MemoryRecord[];
    const list = Array.isArray(fees) ? fees : fees.items ?? [];
    expect(list.filter(r => JSON.stringify(r.value).includes('x402_USDC_test_n-usage')).length).toBe(1);
  });

  it('two paid turns for one quoted work at the same moment collect once', async () => {
    const id = await quoted();
    ctl.hold(`xwork.${id}`);
    const out = await Promise.allSettled([
      handlerFor(proof('n-a')).sendMessage(userMessage(id), ctx),
      handlerFor(proof('n-b')).sendMessage(userMessage(id), ctx),
    ]);
    ctl.hold(null);
    expect(collects.length).toBe(1);
    const w = await storedWork(id);
    expect(w.state).toBe('open');
    expect(w.chargedUnits).toBe(PRICE);
    expect(w.note).toContain(`paid x402_USDC_test_${collects[0]}`);
    // The losing turn is told another payment is being settled, and that nothing was taken for it.
    const lost = out.find(o => o.status === 'rejected') as PromiseRejectedResult | undefined;
    expect(lost).toBeDefined();
    expect(JSON.stringify(lost!.reason)).toContain('Nothing was taken');
  });

  it('a paid turn after the work was paid collects nothing', async () => {
    const id = await quoted();
    await handlerFor(proof('n-first')).sendMessage(userMessage(id), ctx);
    const again = await handlerFor(proof('n-second')).sendMessage(userMessage(id), ctx) as { status: { state: string } };
    expect(again.status.state).toBe(TaskState.TASK_STATE_WORKING);
    expect(collects).toEqual(['n-first']);
  });

  it('a collected payment whose paid-work write fails is recorded for the seller, and the caller is told not to pay again', async () => {
    const id = await quoted();
    ctl.state.failPaidWrite = true;
    let answer: unknown = null;
    try {
      answer = await handlerFor(proof('n-lost')).sendMessage(userMessage(id), ctx);
    } catch (err) {
      answer = err;
    }
    ctl.state.failPaidWrite = false;
    expect(collects).toEqual(['n-lost']);
    const rec = await inner.getMemory(SELLER_GHII, `commerce.undelivered.a2a:${id}`);
    expect(rec).not.toBeNull();
    expect((rec!.value as { trackingCode: string }).trackingCode).toBe('x402_USDC_test_n-lost');
    expect(refunds).toBe(1);
    const text = JSON.stringify(answer);
    expect(text).toContain('Do not pay');
    expect(text).not.toContain('"accepts"');
  });

  it('a refused payment that moved no money still gets the quote back and can pay again', async () => {
    const id = await quoted();
    const bad = await handlerFor('not-a-proof').sendMessage(userMessage(id), ctx) as { metadata?: Record<string, unknown> };
    expect(Array.isArray(bad.metadata?.accepts)).toBe(true);
    expect(collects).toEqual([]);
    const paid = await handlerFor(proof('n-retry')).sendMessage(userMessage(id), ctx) as { status: { state: string } };
    expect(paid.status.state).toBe(TaskState.TASK_STATE_WORKING);
    expect(collects).toEqual(['n-retry']);
  });
});
