/**
 * @file test/unit/ucp-guest-booking-order.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A UCP guest checkout books its sale (bookSessionlessSale) only after the seller's order
 *   and the completed checkout are written, so an order that cannot be written leaves no fee and no
 *   share booked. Before, the sale was booked first. Usage case (passes before and after): a paid
 *   checkout books the sale once with the same amounts and its receipt carries the same fee. The
 *   platform, the card rail and the booking are stubs; nothing leaves the process.
 * @usage cd aimeat && pnpm exec vitest run test/unit/ucp-guest-booking-order.test.ts
 * @version-history
 *   2026-11-04 -- Initial (codebase analysis 2026-11-03, item B2).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';

const booked: Array<{ gross: number; trackingCode: string; reference: string }> = [];
let writesSeenAtBooking: string[] = [];
const written: string[] = [];

vi.mock('../../src/utils/url-validator.js', () => ({ safeFetch: async () => new Response('{}', { status: 200 }) }));
vi.mock('../../src/services/ucp/platform-profile.js', () => ({
  platformProfile: async (url: string) => ({ url, keys: [], webhookUrl: 'https://platform.example/hooks/orders', version: '2026-08-25' }),
}));
vi.mock('../../src/commerce/sellable-resolvers.js', () => ({
  getSellableResolver: () => ({
    resolve: async (_s: unknown, _c: unknown, ref: { offer_id?: string }) => ({
      kind: 'offer', agentGaii: 'vendor#shop@node-1', offerId: ref.offer_id, title: 'Audit', unitPrice: 19_990_000, tollMorsels: 0, sellerOwner: 'shop', sellerGhii: 'shop@node-1',
    }),
  }),
}));
vi.mock('../../src/commerce/payment-handlers.js', () => ({
  getPaymentHandler: () => ({ id: 'com.stripe.spt', collect: async () => ({ trackingCode: 'pi_order_1' }) }),
  PaymentError: class extends Error {},
}));
vi.mock('../../src/commerce/fulfillment.js', () => ({ createFulfillmentTask: async () => 'task-1' }));
vi.mock('../../src/commerce/session-service.js', () => ({
  bookSessionlessSale: async (_s: unknown, _c: unknown, a: { gross: number; trackingCode: string; reference: string }) => {
    booked.push({ gross: a.gross, trackingCode: a.trackingCode, reference: a.reference });
    writesSeenAtBooking = [...written];
    return { fee: Math.ceil(a.gross * 0.05), net: a.gross - Math.ceil(a.gross * 0.05) };
  },
}));
vi.mock('../../src/services/account-events.js', () => ({ recordAccountEvent: async () => undefined }));
vi.mock('../../src/services/visibility/visibility-counter.js', () => ({
  recordPurchase: () => undefined, recordCheckoutStage: () => undefined, resolvePlaceOwner: async () => 'shop@node-1',
}));
vi.mock('../../src/services/visibility/merchant-feed-settings.js', () => ({ getFeedSettings: async () => ({ stripeProfileId: 'profile_test123', productLinks: {} }) }));

const g = await import('../../src/commerce/ucp-guest-checkout.js');

const PLATFORM = 'https://copilot.microsoft.com/.well-known/ucp';
const nodeKey = (() => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKey: Buffer.from((privateKey.export({ format: 'jwk' }) as { d: string }).d, 'base64url').toString('base64'),
    publicKey: Buffer.from((publicKey.export({ format: 'jwk' }) as { x: string }).x, 'base64url').toString('base64'),
  };
})();
function fakeStorage(failOrderWrite: boolean) {
  const mem = new Map<string, { value: unknown; key: string; ownerGaii: string; version: number; createdAt: string }>();
  const put = (o: string, k: string, v: unknown) => mem.set(`${o}|${k}`, { value: structuredClone(v), key: k, ownerGaii: o, version: 1, createdAt: '' });
  put('shop@node-1', 'commerce.psp', { secretKey: 'sk_test_shop' });
  return {
    mem,
    getNodeKey: async () => nodeKey,
    getMemory: async (o: string, k: string) => { const r = mem.get(`${o}|${k}`); return r ? { ...r, value: structuredClone(r.value) } : null; },
    setMemory: async (r: { ownerGaii: string; key: string; value: unknown }) => {
      if (failOrderWrite && r.key.startsWith('commerce.order.')) throw new Error('disk full');
      written.push(r.key);
      put(r.ownerGaii, r.key, r.value);
      return r;
    },
    deleteMemory: async (o: string, k: string) => mem.delete(`${o}|${k}`),
    listMemoryKeysByPrefix: async (p: string) => [...mem.values()].filter((r) => r.key.startsWith(p)).map((r) => ({ ownerGaii: r.ownerGaii, key: r.key })),
    countMemory: async (owners: string[], opts?: { prefix?: string }) => [...mem.values()].filter((r) => owners.includes(r.ownerGaii) && (!opts?.prefix || r.key.startsWith(opts.prefix))).length,
    listMemory: async (o: string, opts?: { prefix?: string }) => [...mem.values()].filter((r) => r.ownerGaii === o && (!opts?.prefix || r.key.startsWith(opts.prefix))).map((r) => ({ ...r, value: structuredClone(r.value) })),
  };
}
const config = { baseUrl: 'https://shop.example', nodeId: 'node-1', commerceEnabled: true, encryptionKey: null, totpSecretEncryptionKey: null } as never;
const line = [{ item: { id: 'offer:vendor#shop@node-1:audit' }, quantity: 2 }];
const pay = { instruments: [{ credential: { type: 'stripe_payment_token', token: 'spt_good12345' } }] };

beforeEach(() => { booked.length = 0; written.length = 0; writesSeenAtBooking = []; });

describe('a UCP guest checkout books its sale after the order is written', () => {
  it('an order that cannot be written books no sale', async () => {
    const storage = fakeStorage(true);
    const s = await g.createGuestCheckout(storage as never, config, { profileUrl: PLATFORM, lineItems: line, buyer: { email: 'pat@example.com' } });
    await expect(g.completeGuestCheckout(storage as never, config, s.id, PLATFORM, pay)).rejects.toThrow('disk full');
    expect(booked, 'the sale was booked for an order that was never written').toEqual([]);
  });

  it('designed use: a paid checkout books the sale once, with the same amounts and receipt', async () => {
    const storage = fakeStorage(false);
    const s = await g.createGuestCheckout(storage as never, config, { profileUrl: PLATFORM, lineItems: line, buyer: { email: 'pat@example.com' } });
    const done = await g.completeGuestCheckout(storage as never, config, s.id, PLATFORM, pay);
    expect(done.status).toBe('completed');
    expect(booked).toEqual([{ gross: 39_980_000, trackingCode: 'pi_order_1', reference: done.orderId }]);
    const order = await g.readUcpOrder(storage as never, config, done.orderId!, PLATFORM);
    expect(order.receipt).toMatchObject({ charged: 39_980_000, fee: 1_999_000, earned: 37_981_000, trackingCode: 'pi_order_1' });
  });

  it('the booking sees the order and the completed checkout already written', async () => {
    const storage = fakeStorage(false);
    const s = await g.createGuestCheckout(storage as never, config, { profileUrl: PLATFORM, lineItems: line, buyer: { email: 'pat@example.com' } });
    const done = await g.completeGuestCheckout(storage as never, config, s.id, PLATFORM, pay);
    expect(writesSeenAtBooking).toContain(`commerce.order.${done.orderId}`);
    expect(writesSeenAtBooking.lastIndexOf(`commerce.ucp.session.${s.id}`)).toBeGreaterThan(writesSeenAtBooking.indexOf(`commerce.order.${done.orderId}`));
  });
});
