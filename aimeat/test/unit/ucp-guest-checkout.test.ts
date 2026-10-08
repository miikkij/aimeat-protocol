/**
 * @file test/unit/ucp-guest-checkout.test.ts
 * @description The UCP 2026-08-25 guest checkout (commerce/ucp-guest-checkout.ts) end to end against
 *   stand-ins for Stripe, the sellable resolver and the platform: a checkout waits for the buyer's
 *   email, a payment that fails leaves it open and counts the failure, a paid one becomes the
 *   seller's order with a task per line and a signed order webhook the platform can verify with the
 *   node's published key, a finished task adds a delivered event and a second webhook, and a webhook
 *   that fails is tried again by the upkeep when its wait is over.
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (AI visibility, layer E).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';

const webhooks: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
let webhookStatus = 200;
const charges: Array<{ amount: number; instrument: string; seller: string }> = [];
const stages: Array<{ stage: string; code?: string | null }> = [];
const purchases: unknown[] = [];

vi.mock('../../src/utils/url-validator.js', () => ({
  safeFetch: async (url: string, init: { headers?: Record<string, string>; body?: string }) => {
    webhooks.push({ url, headers: init.headers ?? {}, body: String(init.body ?? '') });
    return new Response('{}', { status: webhookStatus });
  },
}));
vi.mock('../../src/services/ucp/platform-profile.js', () => ({
  platformProfile: async (url: string) => ({ url, keys: [], webhookUrl: 'https://platform.example/hooks/orders', version: '2026-08-25' }),
}));
vi.mock('../../src/commerce/sellable-resolvers.js', () => ({
  getSellableResolver: () => ({
    resolve: async (_s: unknown, _c: unknown, ref: { offer_id?: string }) => {
      if (ref.offer_id === 'gone') throw Object.assign(new Error('gone'), { code: 'OFFER_NOT_FOUND' });
      return { kind: 'offer', agentGaii: 'vendor#shop@node-1', offerId: ref.offer_id, title: 'Audit', priceMorsels: 19_990_000, sellerOwner: 'shop', sellerGhii: 'shop@node-1' };
    },
  }),
}));
vi.mock('../../src/commerce/payment-handlers.js', () => ({
  getPaymentHandler: () => ({
    id: 'com.stripe.spt',
    collect: async (_ctx: unknown, a: { amount: number; instrument: string; seller: { ghii: string } }) => {
      if (a.instrument === 'spt_declined1234') throw new PaymentErrorStub('PSP_ERROR', 422, 'Your card was declined.');
      charges.push({ amount: a.amount, instrument: a.instrument, seller: a.seller.ghii });
      return { trackingCode: 'pi_test_1' };
    },
  }),
  PaymentError: class PaymentErrorStub extends Error { constructor(public code: string, public statusCode: number, m: string) { super(m); } },
}));
class PaymentErrorStub extends Error { constructor(public code: string, public statusCode: number, m: string) { super(m); } }
vi.mock('../../src/commerce/fulfillment.js', () => ({ createFulfillmentTask: async () => 'task-1' }));
vi.mock('../../src/commerce/session-service.js', () => ({ bookSessionlessSale: async (_s: unknown, _c: unknown, a: { gross: number }) => ({ fee: Math.ceil(a.gross * 0.05), net: a.gross - Math.ceil(a.gross * 0.05) }) }));
vi.mock('../../src/services/account-events.js', () => ({ recordAccountEvent: async () => undefined }));
vi.mock('../../src/services/visibility/visibility-counter.js', () => ({
  recordPurchase: (_s: unknown, _c: unknown, p: unknown) => { purchases.push(p); },
  recordCheckoutStage: (_s: unknown, _c: unknown, p: { stage: string; code?: string | null }) => { stages.push({ stage: p.stage, code: p.code }); },
  resolvePlaceOwner: async () => 'shop@node-1',
}));
vi.mock('../../src/services/visibility/merchant-feed-settings.js', () => ({ getFeedSettings: async () => ({ stripeProfileId: 'profile_test123', productLinks: {} }) }));

const g = await import('../../src/commerce/ucp-guest-checkout.js');
const { ucpSigningKey, resetUcpKeyCache } = await import('../../src/services/ucp/ucp-keys.js');
const { verifyMessage } = await import('../../src/services/ucp/http-signatures.js');

const PLATFORM = 'https://copilot.microsoft.com/.well-known/ucp';
const nodeKey = (() => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKey: Buffer.from((privateKey.export({ format: 'jwk' }) as { d: string }).d, 'base64url').toString('base64'),
    publicKey: Buffer.from((publicKey.export({ format: 'jwk' }) as { x: string }).x, 'base64url').toString('base64'),
  };
})();
function fakeStorage() {
  const mem = new Map<string, { value: unknown; key: string; ownerGaii: string; version: number; createdAt: string }>();
  const put = (o: string, k: string, v: unknown) => mem.set(`${o}|${k}`, { value: structuredClone(v), key: k, ownerGaii: o, version: 1, createdAt: '' });
  put('shop@node-1', 'commerce.psp', { secretKey: 'sk_test_shop' });
  return {
    mem,
    getNodeKey: async () => nodeKey,
    getMemory: async (o: string, k: string) => { const r = mem.get(`${o}|${k}`); return r ? { ...r, value: structuredClone(r.value) } : null; },
    setMemory: async (r: { ownerGaii: string; key: string; value: unknown }) => { put(r.ownerGaii, r.key, r.value); return r; },
    deleteMemory: async (o: string, k: string) => mem.delete(`${o}|${k}`),
    listMemoryKeysByPrefix: async (p: string) => [...mem.values()].filter((r) => r.key.startsWith(p)).map((r) => ({ ownerGaii: r.ownerGaii, key: r.key })),
  };
}
const config = { baseUrl: 'https://shop.example', nodeId: 'node-1', commerceEnabled: true, encryptionKey: null, totpSecretEncryptionKey: null } as never;
const flush = () => new Promise((r) => setTimeout(r, 20));
const line = [{ item: { id: 'offer:vendor#shop@node-1:audit' }, quantity: 2 }];

beforeEach(() => { webhooks.length = 0; charges.length = 0; stages.length = 0; purchases.length = 0; webhookStatus = 200; resetUcpKeyCache(); });

describe('the UCP guest checkout', () => {
  it('waits for the buyer\'s email, then is ready, and offers Stripe with the seller\'s profile', async () => {
    const storage = fakeStorage();
    const s = await g.createGuestCheckout(storage as never, config, { profileUrl: PLATFORM, lineItems: line });
    expect(s).toMatchObject({ status: 'incomplete', platformFamily: 'copilot', sellerGhii: 'shop@node-1' });
    expect(s.id).toMatch(/^ucs_/);
    expect(g.sellerOfSessionId(s.id, config)).toBe('shop@node-1');
    const view = g.toUcpCheckout(s, config, await g.sellerPaymentHandlers(storage as never, config, 'shop@node-1'));
    expect(view.totals).toEqual([{ type: 'subtotal', amount: 3998 }, { type: 'total', amount: 3998 }]);
    expect((view.ucp as any).payment_handlers['com.stripe.payments'][0].config).toEqual({ environment: 'sandbox', business_profile: 'profile_test123' });
    expect(view.messages).toEqual([expect.objectContaining({ code: 'missing', path: '$.buyer.email' })]);
    const u = await g.updateGuestCheckout(storage as never, config, s.id, PLATFORM, { lineItems: line, buyer: { email: 'pat@example.com', first_name: 'Pat' } });
    expect(u.status).toBe('ready_for_complete');
    await expect(g.readGuestCheckout(storage as never, config, s.id, 'https://other.example/ucp')).rejects.toMatchObject({ code: 'not_found' });
    expect(stages.map((x) => x.stage)).toEqual(['created', 'updated']);
  });

  it('keeps a checkout open when the payment fails, and counts where it stopped', async () => {
    const storage = fakeStorage();
    const s = await g.createGuestCheckout(storage as never, config, { profileUrl: PLATFORM, lineItems: line, buyer: { email: 'pat@example.com' } });
    await expect(g.completeGuestCheckout(storage as never, config, s.id, PLATFORM, { instruments: [{ credential: { type: 'stripe_payment_token', token: 'spt_declined1234' } }] }))
      .rejects.toMatchObject({ code: 'payment_failed', httpStatus: 200 });
    const after = await g.readGuestCheckout(storage as never, config, s.id, PLATFORM);
    expect(after.status).toBe('ready_for_complete');
    expect(after.lastError).toMatchObject({ code: 'payment_failed' });
    expect(stages.at(-1)).toEqual({ stage: 'failed', code: 'payment_failed' });
    await expect(g.completeGuestCheckout(storage as never, config, s.id, PLATFORM, { instruments: [{ credential: { type: 'card', token: 'pm_x' } }] }))
      .rejects.toMatchObject({ code: 'payment_failed' });
    expect(charges).toHaveLength(0);
  });

  it('turns a paid checkout into the seller\'s order and sends a webhook the platform can verify', async () => {
    const storage = fakeStorage();
    const s = await g.createGuestCheckout(storage as never, config, { profileUrl: PLATFORM, lineItems: line, buyer: { email: 'pat@example.com', first_name: 'Pat' } });
    const done = await g.completeGuestCheckout(storage as never, config, s.id, PLATFORM, { instruments: [{ selected: true, credential: { type: 'stripe_payment_token', token: 'spt_good12345' } }] });
    expect(done.status).toBe('completed');
    expect(charges).toEqual([{ amount: 39_980_000, instrument: 'spt_good12345', seller: 'shop@node-1' }]);
    const order = await g.readUcpOrder(storage as never, config, done.orderId!, PLATFORM);
    expect(order).toMatchObject({ status: 'completed', total: 39_980_000, guest: { source: 'ucp', platform: 'copilot', email: 'pat@example.com' }, fulfillment: { taskIds: ['task-1'] } });
    expect(order.receipt).toMatchObject({ charged: 39_980_000, fee: 1_999_000, earned: 37_981_000 });
    expect(purchases).toEqual([expect.objectContaining({ channel: 'ai', family: 'copilot', via: 'agent', amount: 39_980_000 })]);
    await flush();
    expect(webhooks).toHaveLength(1);
    const hook = webhooks[0]!;
    const key = (await ucpSigningKey(storage as never))!;
    const lower = Object.fromEntries(Object.entries(hook.headers).map(([k, v]) => [k.toLowerCase(), v]));
    expect(verifyMessage({ method: 'POST', url: hook.url, headers: lower }, Buffer.from(hook.body), [key.publicJwk])).toEqual({ ok: true, kid: key.kid });
    const snapshot = JSON.parse(hook.body);
    expect(snapshot).toMatchObject({ id: done.orderId, checkout_id: s.id, currency: 'USD', totals: [{ type: 'subtotal', amount: 3998 }, { type: 'total', amount: 3998 }] });
    expect(snapshot.line_items[0]).toMatchObject({ status: 'processing', quantity: { original: 2, total: 2, fulfilled: 0 } });
    expect(storage.mem.has(`shop@node-1|commerce.ucp.pending.${done.orderId}`)).toBe(false);
    await expect(g.completeGuestCheckout(storage as never, config, s.id, PLATFORM, {})).rejects.toMatchObject({ code: 'checkout_closed' });
  });

  it('marks the line delivered when its task is done, and tries a failed webhook again when its wait is over', async () => {
    const storage = fakeStorage();
    const s = await g.createGuestCheckout(storage as never, config, { profileUrl: PLATFORM, lineItems: line, buyer: { email: 'pat@example.com' } });
    const done = await g.completeGuestCheckout(storage as never, config, s.id, PLATFORM, { instruments: [{ credential: { type: 'stripe_payment_token', token: 'spt_good12345' } }] });
    await flush();
    webhooks.length = 0;
    webhookStatus = 503;
    await g.onUcpTaskDone(storage as never, config, { id: 'task-1', ownerGaii: 'shop@node-1', scope: [{ name: 'commerce_session', value: done.orderId, type: 'text' }] } as never);
    await flush();
    const order = await g.readUcpOrder(storage as never, config, done.orderId!, PLATFORM);
    expect(order.ucpOrder!.events.map((e) => e.type)).toEqual(['processing', 'delivered']);
    expect(webhooks).toHaveLength(1);
    const pending = storage.mem.get(`shop@node-1|commerce.ucp.pending.${done.orderId}`)!.value as { attempts: number; nextAt: string };
    expect(pending.attempts).toBe(1);
    expect(await g.runUcpUpkeep(storage as never, config)).toEqual({ tried: 0, delivered: 0 });
    pending.nextAt = new Date(Date.now() - 1000).toISOString();
    storage.mem.get(`shop@node-1|commerce.ucp.pending.${done.orderId}`)!.value = pending;
    webhookStatus = 200;
    expect(await g.runUcpUpkeep(storage as never, config)).toEqual({ tried: 1, delivered: 1 });
    expect(JSON.parse(webhooks.at(-1)!.body).line_items[0]).toMatchObject({ status: 'fulfilled', quantity: { fulfilled: 2 } });
  });

  it('refuses an item that is not sold here, and a checkout id this node did not mint', async () => {
    const storage = fakeStorage();
    await expect(g.createGuestCheckout(storage as never, config, { profileUrl: PLATFORM, lineItems: [{ item: { id: 'package:repo|group|buy' } }] }))
      .rejects.toMatchObject({ code: 'item_unavailable', httpStatus: 200 });
    await expect(g.createGuestCheckout(storage as never, config, { profileUrl: PLATFORM, lineItems: [] })).rejects.toMatchObject({ httpStatus: 400 });
    expect(g.sellerOfSessionId('ucs_Li4vYWRtaW4_0123', config)).toBeNull();
    await expect(g.readGuestCheckout(storage as never, config, 'ucs_nope', PLATFORM)).rejects.toMatchObject({ code: 'not_found' });
  });
});
