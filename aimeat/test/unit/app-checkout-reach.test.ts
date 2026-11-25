/**
 * @file test/unit/app-checkout-reach.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description commerce/app-checkout-reach.ts: which cart is an app's own subscription, and the spend
 *   question at the card page and at completion for an app that holds no spending permission.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-checkout-reach.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-25 — Initial (wish-sovellus-saa-avata-oman-tilauksensa-maksun-commerce-buy-ei-o).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cartReach, sameApp, appCheckoutReach, checkoutSpendRefusal, NOT_OWN_CODE } from '../../src/commerce/app-checkout-reach.js';
import { registerPaymentHandler, resetPaymentHandlers } from '../../src/commerce/payment-handlers.js';
import { STRIPE_CHECKOUT_HANDLER_ID } from '../../src/commerce/stripe-checkout.js';
import type { Storage } from '../../src/storage/interface.js';
import type { PaymentHandler } from '../../src/commerce/types.js';

const APP = 'seller/plans.html';
const served = (map: Record<string, string | null>) => (ext: string) => map[ext] ?? null;

describe('sameApp', () => {
  it('reads the owner half without letter case and the file name exactly', () => {
    expect(sameApp('Seller/plans.html', 'seller/plans.html')).toBe(true);
    expect(sameApp('seller/Plans.html', 'seller/plans.html')).toBe(false);
    expect(sameApp('other/plans.html', 'seller/plans.html')).toBe(false);
    expect(sameApp(null, 'seller/plans.html')).toBe(false);
    expect(sameApp('plans.html', 'plans.html')).toBe(false);
  });
});

describe('cartReach', () => {
  it('own: every line is a plan of the extension that serves this app', () => {
    expect(cartReach(APP, [{ kind: 'subscription', app: 'plans-ext' }], served({ 'plans-ext': APP }))).toEqual({ kind: 'own' });
  });
  it('foreign: a plan of an extension that serves another app, or none', () => {
    expect(cartReach(APP, [{ kind: 'subscription', app: 'x' }], served({ x: 'other/shop.html' })))
      .toEqual({ kind: 'foreign', ext: 'x', servesApp: 'other/shop.html' });
    expect(cartReach(APP, [{ kind: 'subscription', app: 'plans-ext' }, { kind: 'subscription', app: 'y' }], served({ 'plans-ext': APP })))
      .toEqual({ kind: 'foreign', ext: 'y', servesApp: null });
  });
  it('other: a line of another kind, an empty cart, or no app', () => {
    expect(cartReach(APP, [{ kind: 'subscription', app: 'plans-ext' }, { kind: 'offer' }], served({ 'plans-ext': APP }))).toEqual({ kind: 'other' });
    expect(cartReach(APP, [], served({}))).toEqual({ kind: 'other' });
    expect(cartReach(null, [{ kind: 'subscription', app: 'plans-ext' }], served({ 'plans-ext': APP }))).toEqual({ kind: 'other' });
    expect(cartReach(APP, [{ kind: 'subscription' }], served({}))).toEqual({ kind: 'other' });
  });
});

/** A storage with one app grant, the seller's app `plans.html`, and two extensions. */
function fakeStorage(grant: { scopes: string[]; revoked?: boolean }): Storage {
  const grants: Record<string, unknown> = {
    g1: { grantId: 'g1', app: APP, owner: 'buyer', scopes: grant.scopes, createdAt: '2026-11-20T00:00:00Z', revoked: grant.revoked ?? false, spendCapMorsels: null },
  };
  const exts: Record<string, unknown> = {
    'plans-ext': { name: 'plans-ext', status: 'active', installedBy: 'seller', config: { app: 'seller/plans' } },
    'other-ext': { name: 'other-ext', status: 'active', installedBy: 'other', config: { app: 'other/shop.html' } },
    'claims-ext': { name: 'claims-ext', status: 'active', installedBy: 'mallory', config: { app: 'seller/plans.html' } },
  };
  return {
    getAppGrant: async (id: string) => grants[id] ?? null,
    getExtension: async (name: string) => exts[name] ?? null,
    appFilenamesAmong: async (owner: { ownerName?: string }, candidates: string[]) =>
      (owner.ownerName === 'seller' ? candidates.filter(c => c === 'plans.html') : owner.ownerName === 'other' ? candidates.filter(c => c === 'shop.html') : []),
  } as unknown as Storage;
}

describe('appCheckoutReach', () => {
  it('binds a plan to the app its extension names, resolved to the file', async () => {
    const s = fakeStorage({ scopes: ['memory:read'] });
    expect(await appCheckoutReach(s, 'g1', [{ kind: 'subscription', app: 'plans-ext' }])).toEqual({ kind: 'own' });
    expect((await appCheckoutReach(s, 'g1', [{ kind: 'subscription', app: 'other-ext' }])).kind).toBe('foreign');
  });
  it('an extension that names an app its installer does not own serves no app', async () => {
    const s = fakeStorage({ scopes: ['memory:read'] });
    expect(await appCheckoutReach(s, 'g1', [{ kind: 'subscription', app: 'claims-ext' }])).toEqual({ kind: 'foreign', ext: 'claims-ext', servesApp: null });
  });
  it('a revoked grant or an unknown one reaches nothing', async () => {
    expect((await appCheckoutReach(fakeStorage({ scopes: [], revoked: true }), 'g1', [{ kind: 'subscription', app: 'plans-ext' }])).kind).toBe('other');
    expect((await appCheckoutReach(fakeStorage({ scopes: [] }), 'nope', [{ kind: 'subscription', app: 'plans-ext' }])).kind).toBe('other');
  });
});

describe('checkoutSpendRefusal', () => {
  const app = { roles: ['app'], scopes: ['memory:read'], appGrantId: 'g1' };
  const own = { items: [{ kind: 'subscription', app: 'plans-ext' }] } as never;
  const foreign = { items: [{ kind: 'subscription', app: 'other-ext' }] } as never;
  const offer = { items: [{ kind: 'offer' }] } as never;
  beforeEach(() => {
    registerPaymentHandler({ id: STRIPE_CHECKOUT_HANDLER_ID, currencies: ['EUR'] } as unknown as PaymentHandler);
    registerPaymentHandler({ id: 'test.money', currencies: ['EUR'] } as unknown as PaymentHandler);
  });
  afterEach(() => resetPaymentHandlers());

  it('an app without contract:spend pays its own subscription on the card page', async () => {
    expect(await checkoutSpendRefusal(fakeStorage({ scopes: ['memory:read'] }), app, own, STRIPE_CHECKOUT_HANDLER_ID)).toBeNull();
  });
  it('and nowhere else: another handler is CARD_PAGE_ONLY', async () => {
    expect((await checkoutSpendRefusal(fakeStorage({ scopes: ['memory:read'] }), app, own, 'test.money'))?.code).toBe('CARD_PAGE_ONLY');
    expect((await checkoutSpendRefusal(fakeStorage({ scopes: ['memory:read'] }), app, own, undefined))?.code).toBe('CARD_PAGE_ONLY');
  });
  it('another app\'s plan is NOT_THIS_APPS_PRODUCT, another kind of line SCOPE_REQUIRED', async () => {
    expect((await checkoutSpendRefusal(fakeStorage({ scopes: ['memory:read'] }), app, foreign, STRIPE_CHECKOUT_HANDLER_ID))?.code).toBe(NOT_OWN_CODE);
    expect((await checkoutSpendRefusal(fakeStorage({ scopes: ['memory:read'] }), app, offer, STRIPE_CHECKOUT_HANDLER_ID))?.code).toBe('SCOPE_REQUIRED');
  });
  it('an app with contract:spend, a person and an agent are not changed', async () => {
    expect(await checkoutSpendRefusal(fakeStorage({ scopes: ['contract:spend'] }), { ...app, scopes: ['contract:spend'] }, foreign, 'test.money')).toBeNull();
    expect(await checkoutSpendRefusal(fakeStorage({ scopes: [] }), { roles: ['owner'], scopes: [] }, offer, 'test.money')).toBeNull();
    expect(await checkoutSpendRefusal(fakeStorage({ scopes: [] }), null, offer, undefined)).toBeNull();
  });
});
