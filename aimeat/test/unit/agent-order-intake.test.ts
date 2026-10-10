/**
 * @file test/unit/agent-order-intake.test.ts
 * @description An AI shopping agent's order through Stripe's Agentic Commerce Suite becoming the
 *   seller's order here (commerce/agent-order-intake.ts), against a stand-in for Stripe: the session
 *   is read with the documented expansion and version, a line is matched to the seller's product by
 *   its feed id, the order and one fulfilment task are written once, the purchase is counted under
 *   the agent, and a checkout that is not from the feed is left alone.
 * @version-history
 *   v1.1.0 — 2026-10-10 — Two concurrent deliveries create one set of tasks (secaudit 2026-10-10 I1).
 *   v1.0.0 — 2026-10-08 — Initial (AI visibility, layer E).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetched: Array<{ url: string; headers: Record<string, string> }> = [];
let stripeSession: Record<string, unknown> = {};
const tasks: Array<{ item: { kind: string; agent: string; offerId: string }; assignee?: string }> = [];
const purchases: Array<Record<string, unknown>> = [];

vi.mock('../../src/utils/url-validator.js', () => ({
  safeFetch: async (url: string, init: { headers?: Record<string, string> }) => {
    fetched.push({ url, headers: init.headers ?? {} });
    return new Response(JSON.stringify(stripeSession), { status: 200 });
  },
}));
vi.mock('../../src/commerce/app-tool-catalog.js', () => ({ listPricedAppTools: async () => [] }));
vi.mock('../../src/commerce/fulfillment.js', () => ({
  createFulfillmentTask: async (_s: unknown, _o: unknown, item: { kind: string; agent: string; offerId: string }, assignee?: string) => {
    tasks.push({ item, assignee });
    return `task-${tasks.length}`;
  },
}));
vi.mock('../../src/services/account-events.js', () => ({ recordAccountEvent: async () => undefined }));
vi.mock('../../src/services/visibility/visibility-counter.js', () => ({ recordPurchase: (_s: unknown, _c: unknown, p: Record<string, unknown>) => { purchases.push(p); } }));

const { intakeAgentOrder, ACS_STRIPE_VERSION } = await import('../../src/commerce/agent-order-intake.js');
const { feedIdOf } = await import('../../src/services/visibility/merchant-feed.js');

const SELLER = 'shop@node-1';
const AGENT = 'vendor#shop@node-1';
const SKU = `offer:${AGENT}:audit`;

function fakeStorage() {
  const mem = new Map<string, { value: unknown; key: string; ownerGaii: string; version: number; createdAt: string }>();
  const put = (ownerGaii: string, key: string, value: unknown) => mem.set(`${ownerGaii}|${key}`, { value, key, ownerGaii, version: 1, createdAt: '' });
  put(SELLER, 'commerce.psp', { secretKey: 'sk_test_owner' });
  put(AGENT, 'agents.vendor.offers', { offers: [{ id: 'audit', title: 'Audit', ask: 'An audit.', priceMoney: { amount: 19_990_000, currency: 'USD' }, visibility: 'public' }] });
  return {
    mem,
    getMemory: async (o: string, k: string) => mem.get(`${o}|${k}`) ?? null,
    setMemory: async (r: { ownerGaii: string; key: string; value: unknown }) => { put(r.ownerGaii, r.key, r.value); return r; },
    createMemoryIfAbsent: async (r: { ownerGaii: string; key: string; value: unknown }) => {
      if (mem.has(`${r.ownerGaii}|${r.key}`)) return null;
      put(r.ownerGaii, r.key, r.value);
      return r;
    },
    listAllMemory: async ({ prefix }: { prefix: string }) => ({ items: [...mem.values()].filter((r) => r.key.startsWith(prefix)) }),
    getOwner: async () => ({ name: 'shop', displayName: 'Shop' }),
  };
}
const config = { baseUrl: 'https://place.example', encryptionKey: null, totpSecretEncryptionKey: null } as never;

beforeEach(() => { fetched.length = 0; tasks.length = 0; purchases.length = 0; });

describe('intakeAgentOrder', () => {
  it('turns a session whose line names a feed id into one order and one task, counted under the agent', async () => {
    const storage = fakeStorage();
    stripeSession = {
      id: 'cs_test_abc123', currency: 'usd', amount_total: 3998,
      customer_details: { email: 'buyer@example.com', name: 'Pat Buyer' },
      payment_intent: { id: 'pi_1', agent_details: { name: 'Microsoft Copilot' } },
      line_items: { data: [
        { quantity: 2, price: { external_reference: feedIdOf(SKU), unit_amount: 1999 } },
        { quantity: 1, price: { external_reference: 'someone-elses-product', unit_amount: 500 } },
      ] },
    };
    const r = await intakeAgentOrder(storage as never, config, SELLER, { id: 'cs_test_abc123' }, 'evt_1');
    expect(r).toMatchObject({ action: 'agent_order', orderId: 'cs_test_abc123', taskIds: ['task-1'] });
    expect(fetched[0]!.url).toBe('https://api.stripe.com/v1/checkout/sessions/cs_test_abc123?expand[]=line_items.data.price.product&expand[]=payment_intent');
    expect(fetched[0]!.headers).toMatchObject({ Authorization: 'Bearer sk_test_owner', 'Stripe-Version': ACS_STRIPE_VERSION });
    expect(tasks).toEqual([{ item: expect.objectContaining({ kind: 'offer', agent: AGENT, offerId: 'audit', quantity: 2, unitPrice: 19_990_000 }), assignee: undefined }]);
    const order = (await storage.getMemory(SELLER, 'commerce.order.cs_test_abc123'))!.value as Record<string, any>;
    expect(order).toMatchObject({ status: 'completed', total: 39_980_000, currency: 'USD', guest: { source: 'stripe-acs', platform: 'copilot', email: 'buyer@example.com' } });
    expect(order.buyerIdentity).toContain('copilot agent for Pat Buyer <buyer@example.com>');
    expect(purchases).toEqual([expect.objectContaining({ channel: 'ai', family: 'copilot', via: 'agent', amount: 39_980_000, currency: 'USD' })]);
  });

  it('does nothing twice for the same session', async () => {
    const storage = fakeStorage();
    stripeSession = { id: 'cs_test_twice1', currency: 'usd', amount_total: 1999, line_items: { data: [{ quantity: 1, price: { external_reference: feedIdOf(SKU), unit_amount: 1999 } }] } };
    await intakeAgentOrder(storage as never, config, SELLER, { id: 'cs_test_twice1' }, 'evt_1');
    const again = await intakeAgentOrder(storage as never, config, SELLER, { id: 'cs_test_twice1' }, 'evt_2');
    expect(again.action).toBe('already_taken');
    expect(tasks).toHaveLength(1);
    expect(purchases).toHaveLength(1);
  });

  it('creates one set of tasks when two deliveries of the same session run at once (secaudit 2026-10-10 I1)', async () => {
    const storage = fakeStorage();
    stripeSession = { id: 'cs_test_race01', currency: 'usd', amount_total: 1999, line_items: { data: [{ quantity: 1, price: { external_reference: feedIdOf(SKU), unit_amount: 1999 } }] } };
    const [a, b] = await Promise.all([
      intakeAgentOrder(storage as never, config, SELLER, { id: 'cs_test_race01' }, 'evt_1'),
      intakeAgentOrder(storage as never, config, SELLER, { id: 'cs_test_race01' }, 'evt_1'),
    ]);
    expect([a.action, b.action].sort()).toEqual(['agent_order', 'already_taken']);
    expect(tasks).toHaveLength(1);
    expect(purchases).toHaveLength(1);
    const order = (await storage.getMemory(SELLER, 'commerce.order.cs_test_race01'))!.value as Record<string, any>;
    expect(order.fulfillment).toEqual({ taskIds: ['task-1'] });
  });

  it('leaves alone a checkout whose lines name no product of the feed, and an id that is not a session', async () => {
    const storage = fakeStorage();
    stripeSession = { id: 'cs_test_other1', currency: 'usd', amount_total: 500, line_items: { data: [{ quantity: 1, price: { external_reference: 'tshirt-42', unit_amount: 500 } }] } };
    expect((await intakeAgentOrder(storage as never, config, SELLER, { id: 'cs_test_other1' }, 'evt_3')).action).toBe('not_an_agent_order');
    expect((await intakeAgentOrder(storage as never, config, SELLER, { id: '../../v1/account' }, 'evt_4')).action).toBe('not_an_agent_order');
    expect(tasks).toHaveLength(0);
    expect(storage.mem.has(`${SELLER}|commerce.order.cs_test_other1`)).toBe(false);
  });
});
