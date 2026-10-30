/**
 * @file test/unit/stripe-webhook-card-page.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Stripe webhook completes a checkout only from a card page the node opened for it
 *   (commerce/stripe-checkout-complete.ts, session.cardPages). A paid Checkout Session the seller made
 *   on its own Stripe account with the checkout's metadata completes nothing and records no adult
 *   check; the node's own page completes and records it as before, and so does a checkout whose page
 *   was opened before the node kept them. Stripe is answered by a stand-in for safeFetch.
 * @usage cd aimeat && pnpm exec vitest run test/unit/stripe-webhook-card-page.test.ts
 * @version-history
 *   2026-10-30 -- The node's own page on a seller's (not an operator's) Stripe account waits for the
 *     buyer's confirmation before the adult check is recorded; one assertion changed with Jouni's
 *     approval (secaudit2026oct26 round 8c, commerce-07).
 *   2026-10-27 -- Initial (secaudit2026oct26, commerce/stripe-checkout-complete:seller-paid-session-records-buyer-adult).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

let answer: Record<string, unknown> = {};
const sent: string[] = [];
vi.mock('../../src/utils/url-validator.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  safeFetch: async (url: string) => { sent.push(url); return new Response(JSON.stringify(answer), { status: 200 }); },
}));

import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import type { CheckoutSessionRecord } from '../../src/commerce/types.js';
import { registerPaymentHandler } from '../../src/commerce/payment-handlers.js';
import { registerSellableResolver } from '../../src/commerce/sellable-resolvers.js';
import { stripeCheckoutHandler } from '../../src/commerce/stripe-checkout.js';
import { completeFromStripeCheckout } from '../../src/commerce/stripe-checkout-complete.js';
import { rememberCardPage } from '../../src/commerce/session-claim.js';
import { getSession } from '../../src/commerce/session-service.js';
import { readAdult } from '../../src/services/adult-assurance.js';
import { listPublishRequests } from '../../src/services/publish-requests/store.js';
import { decidePublishRequest } from '../../src/services/publish-requests/decide.js';
import { callerFromAuth } from '../../src/services/caller-context.js';

registerSellableResolver({
  kind: 'unit-card',
  async resolve() {
    return {
      kind: 'unit-card', agentGaii: `shop@unit-card-page`, agentName: 'shop', offerId: 'ep3', title: 'Episode 3',
      sellerOwner: 'shop', sellerGhii: `shop@unit-card-page`, unitPrice: 4_990_000, tollMorsels: 0, psp: { secretKey: 'sk_test_stand_in' },
      async fulfill() { return { delivered: true }; },
    };
  },
});

const NODE = 'unit-card-page';
const BUYER = `reader@${NODE}`;
const SELLER = `shop@${NODE}`;
let storage: Storage;
let config: AimeatConfig;

async function stored(id: string): Promise<CheckoutSessionRecord> {
  const now = new Date().toISOString();
  const session = {
    id, status: 'open', buyerOwner: 'reader', buyerGhii: BUYER, buyerIdentity: BUYER, sellerOwner: 'shop', sellerGhii: SELLER,
    items: [{ kind: 'unit-card', agent: SELLER, offerId: 'ep3', title: 'Episode 3', unitPrice: 4_990_000, quantity: 1, tollMorsels: 0 }],
    currency: 'EUR', total: 4_990_000, createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  } as unknown as CheckoutSessionRecord;
  await storage.setMemory({
    key: `commerce.session.${id}`, ownerGaii: BUYER, value: session as unknown as Record<string, unknown>,
    visibility: 'owner', tags: ['commerce'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
  } as never);
  return session;
}

const paid = (cs: string, session: string) => ({
  id: cs, payment_status: 'paid', amount_total: 499, currency: 'eur', metadata: { aimeat_session: session, aimeat_buyer: BUYER },
  payment_intent: { id: `pi_${cs}`, payment_method: 'pm_1', latest_charge: { payment_method_details: { card: { funding: 'credit' } } } },
});
const delivery = (cs: string, session: string) => ({ id: cs, metadata: { aimeat_session: session, aimeat_buyer: BUYER } });

beforeEach(async () => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  config = { ...loadConfig().config, nodeId: NODE, baseUrl: 'https://node.test', encryptionKey: null } as AimeatConfig;
  registerPaymentHandler(stripeCheckoutHandler(config));
  const now = new Date().toISOString();
  // The buyer has an account here, so the node can ask them to confirm the card (commerce-07).
  await storage.createOwner({ name: 'reader', displayName: 'reader', publicKey: 'pk', roles: ['owner'], createdAt: now } as never);
  await storage.setMemory({
    key: 'commerce.psp', ownerGaii: SELLER, value: { provider: 'stripe', secretKey: 'sk_test_stand_in' }, visibility: 'private',
    tags: ['commerce'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
  } as never);
  sent.length = 0;
});

describe('the Stripe webhook completes a checkout only from a card page the node opened', () => {
  it('a Checkout Session the seller made itself completes nothing and records no adult check', async () => {
    const s = await stored('chk_one');
    await rememberCardPage(storage, s, 'cs_node_page');
    answer = paid('cs_seller_made', 'chk_one');
    const out = await completeFromStripeCheckout(storage, config, SELLER, delivery('cs_seller_made', 'chk_one'));
    expect(out).toBe('checkout_not_found');
    expect(sent.length).toBe(0);
    expect((await getSession(storage, BUYER, 'chk_one'))?.status).toBe('open');
    expect((await readAdult(storage, BUYER)).verified).toBe(false);
  });

  it('designed use: the node\'s own card page is read back from Stripe and records the credit card adult check', async () => {
    const s = await stored('chk_two');
    await rememberCardPage(storage, s, 'cs_node_page');
    expect((await getSession(storage, BUYER, 'chk_two'))?.updatedAt).toBe(s.updatedAt);
    answer = paid('cs_node_page', 'chk_two');
    await completeFromStripeCheckout(storage, config, SELLER, delivery('cs_node_page', 'chk_two'));
    expect(sent.some(u => u.includes('checkout/sessions/cs_node_page'))).toBe(true);
    // Changed 2026-10-30 (secaudit2026oct26 round 8c, commerce-07, approved by Jouni): this asserted
    // the hole being closed, an adult recorded on the seller's own Stripe account's word. It now waits
    // for the buyer's confirmation, and after the buyer confirms the adult is recorded.
    expect((await readAdult(storage, BUYER)).verified).toBe(false);
    const asked = (await listPublishRequests(storage, BUYER)).find(r => r.kind === 'card-adult-confirm' && r.state === 'awaiting_owner');
    const confirmed = await decidePublishRequest({ storage, config },
      { caller: callerFromAuth({ sub: 'reader', owner: 'reader', roles: ['owner'], scopes: [] }, NODE, storage) }, asked!.id, 'approve');
    expect(confirmed.ok).toBe(true);
    expect(await readAdult(storage, BUYER)).toMatchObject({ verified: true, method: 'credit-card' });
  });

  it('designed use: a checkout whose page was opened before the node kept pages completes as before', async () => {
    await stored('chk_old');
    answer = paid('cs_old_page', 'chk_old');
    await completeFromStripeCheckout(storage, config, SELLER, delivery('cs_old_page', 'chk_old'));
    expect(sent.some(u => u.includes('checkout/sessions/cs_old_page'))).toBe(true);
  });
});
