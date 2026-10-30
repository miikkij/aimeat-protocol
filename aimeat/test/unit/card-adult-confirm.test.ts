/**
 * @file test/unit/card-adult-confirm.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A credit card payment that only the seller's own Stripe account attests does not record
 *   the buyer as an adult by itself; the buyer confirms "I paid with my own card" with one press, in
 *   person (commerce/card-adult-ask.ts, publish-requests/apply-card-adult.ts, policy.ts in_person;
 *   secaudit2026oct26 round 8c, commerce-07, Jouni's option A 2026-10-30). Stripe is answered by a
 *   stand-in for safeFetch; the decisions go through decidePublishRequest, the function behind the
 *   REST route, the MCP tool and the CLI twin.
 *
 *   The attack, refused: the seller's account payment records nothing; the seller, the operator, an
 *   agent of the buyer and an app cannot confirm for the buyer. The designed use, kept: the buyer
 *   confirms and is recorded; a payment on an operator's own Stripe account records at once with no
 *   question; declining records nothing.
 * @usage cd aimeat && pnpm exec vitest run test/unit/card-adult-confirm.test.ts
 * @version-history
 *   2026-10-30 -- Initial (secaudit2026oct26 round 8c, commerce-07,
 *     commerce/stripe-checkout-complete:seller-paid-session-records-buyer-adult).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

let answer: Record<string, unknown> = {};
vi.mock('../../src/utils/url-validator.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  safeFetch: async () => new Response(JSON.stringify(answer), { status: 200 }),
}));

import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { stripePaymentHandler } from '../../src/commerce/stripe-handler.js';
import { sellerIsOperator } from '../../src/commerce/card-adult-ask.js';
import { readAdult, recordAdult } from '../../src/services/adult-assurance.js';
import { listPublishRequests, type PublishRequest } from '../../src/services/publish-requests/store.js';
import { decidePublishRequest } from '../../src/services/publish-requests/decide.js';
import { approvalDecisionRefusal } from '../../src/services/publish-requests/policy.js';
import { applyCardAdultConfirm } from '../../src/services/publish-requests/apply-card-adult.js';
import { callerFromAuth } from '../../src/services/caller-context.js';

const NODE = 'unit-card-adult';
const BUYER = `reader@${NODE}`;
const config = { encryptionKey: null, totpSecretEncryptionKey: null, baseUrl: 'https://node.test', nodeId: NODE } as never;
let storage: Storage;

const owner = (name: string, roles: string[]) =>
  storage.createOwner({ name, displayName: name, publicKey: 'pk', roles, createdAt: new Date().toISOString() } as never);

const creditCharge = (id: string) => ({ id, status: 'succeeded', livemode: true, latest_charge: { livemode: true, payment_method_details: { card: { funding: 'credit' } } } });

/** One live credit card payment on `sellerName`'s own Stripe account, paid by the buyer. */
async function pay(sellerName: string, id = 'pi_1', funding = 'credit') {
  answer = { ...creditCharge(id), latest_charge: { livemode: true, payment_method_details: { card: { funding } } } };
  return stripePaymentHandler(config).collect({ config, storage }, {
    buyerGhii: BUYER, amount: 4_990_000, currency: 'EUR', reference: `chk_${id}`, fee: 0, instrument: 'pm_card_visa',
    seller: { ghii: `${sellerName}@${NODE}`, owner: sellerName, psp: { secretKey: 'sk_live_stand_in' } },
  });
}

async function waitingQuestion(): Promise<PublishRequest | undefined> {
  return (await listPublishRequests(storage, BUYER)).find(r => r.kind === 'card-adult-confirm' && r.state === 'awaiting_owner');
}

const person = (name: string, roles: string[] = ['owner']) => ({ caller: callerFromAuth({ sub: name, owner: name, roles, scopes: [] }, NODE, storage) });
const buyerAgent = (scopes: string[] = ['*']) => ({ caller: callerFromAuth({ sub: `claude#reader@${NODE}`, owner: 'reader', roles: ['agent'], scopes }, NODE, storage) });
const buyerApp = () => ({ caller: callerFromAuth({ sub: 'reader', owner: 'reader', roles: ['app'], scopes: ['*'] }, NODE, storage), app: 'reader/shop.html' });
const decide = (who: Parameters<typeof decidePublishRequest>[1], id: string, d: 'approve' | 'decline', account?: string) =>
  decidePublishRequest({ storage, config }, who, id, d, account);

beforeEach(async () => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  await owner('reader', ['owner']);
  await owner('shop', ['owner']);
  await owner('op', ['owner', 'operator']);
});

describe('the attack is refused: a seller\'s own Stripe account does not make the buyer an adult', () => {
  it('a credit card payment on the seller\'s account records nothing and asks the buyer', async () => {
    const r = await pay('shop');
    expect(r.trackingCode).toBe('pi_1');
    expect((await readAdult(storage, BUYER)).verified).toBe(false);
    const q = await waitingQuestion();
    expect(q).toBeTruthy();
    expect(q!.approval).toMatchObject({ approver: 'owner', in_person: true, i18n: { key: 'approval_card_adult', vars: { seller: 'shop' } } });
    expect(q!.requested_by.principal).toBe(BUYER);
    expect(q!.target).toMatchObject({ seller: `shop@${NODE}`, checkout: 'chk_pi_1', payment: 'pi_1' });
  });

  it('the seller cannot confirm for the buyer, in its own account or by naming the buyer\'s', async () => {
    await pay('shop');
    const q = (await waitingQuestion())!;
    const own = await decide(person('shop'), q.id, 'approve');
    expect(own).toMatchObject({ ok: false, status: 404 });
    const named = await decide(person('shop'), q.id, 'approve', 'reader');
    expect(named).toMatchObject({ ok: false, status: 404 });
    expect((await readAdult(storage, BUYER)).verified).toBe(false);
    expect((await waitingQuestion())?.id).toBe(q.id);
  });

  it('an operator naming the buyer\'s account cannot confirm it either', async () => {
    await pay('shop');
    const q = (await waitingQuestion())!;
    const out = await decide(person('op', ['owner', 'operator']), q.id, 'approve', 'reader');
    expect(out).toMatchObject({ ok: false, status: 404 });
    expect((await readAdult(storage, BUYER)).verified).toBe(false);
  });

  it('an agent of the buyer, even with every permission, cannot confirm; an app cannot either', async () => {
    await pay('shop');
    const q = (await waitingQuestion())!;
    const byAgent = await decide(buyerAgent(), q.id, 'approve');
    expect(byAgent).toMatchObject({ ok: false, status: 403, code: 'OWNER_IN_PERSON' });
    const byApp = await decide(buyerApp(), q.id, 'approve');
    expect(byApp.ok).toBe(false);
    expect((await readAdult(storage, BUYER)).verified).toBe(false);
    // Refused before anything was settled: the buyer's own question still waits for them.
    expect((await waitingQuestion())?.id).toBe(q.id);
  });

  it('the applier refuses before it writes when the one who pressed is not the buyer in person', async () => {
    await pay('shop');
    const q = (await waitingQuestion())!;
    expect(await applyCardAdultConfirm({ storage, config }, BUYER, q, { by: `claude#reader@${NODE}`, kind: 'ai' })).toMatchObject({ ok: false });
    expect(await applyCardAdultConfirm({ storage, config }, BUYER, q, { by: `shop@${NODE}`, kind: 'human' })).toMatchObject({ ok: false });
    expect(await applyCardAdultConfirm({ storage, config }, BUYER, q)).toMatchObject({ ok: false });
    expect((await readAdult(storage, BUYER)).verified).toBe(false);
  });
});

describe('the designed use works', () => {
  it('the buyer confirms with one press and is recorded as an adult by the credit card', async () => {
    await pay('shop');
    const q = (await waitingQuestion())!;
    const out = await decide(person('reader'), q.id, 'approve');
    expect(out).toMatchObject({ ok: true, decision: 'approve', request: { state: 'approved' } });
    expect(await readAdult(storage, BUYER)).toMatchObject({ verified: true, method: 'credit-card' });
  });

  it('declining records nothing, and an agent of the buyer may decline', async () => {
    await pay('shop');
    const q = (await waitingQuestion())!;
    const out = await decide(buyerAgent(), q.id, 'decline');
    expect(out).toMatchObject({ ok: true, decision: 'decline', request: { state: 'declined' } });
    expect((await readAdult(storage, BUYER)).verified).toBe(false);
  });

  it('a payment on an operator\'s own Stripe account records the adult at once, with no question', async () => {
    expect(await sellerIsOperator(storage, { ghii: `op@${NODE}`, owner: 'op' })).toBe(true);
    expect(await sellerIsOperator(storage, { ghii: `shop@${NODE}`, owner: 'shop' })).toBe(false);
    await pay('op');
    expect(await readAdult(storage, BUYER)).toMatchObject({ verified: true, method: 'credit-card' });
    expect(await listPublishRequests(storage, BUYER)).toHaveLength(0);
  });

  it('one question at a time: a second seller payment while the first waits files no second one', async () => {
    await pay('shop', 'pi_1');
    await pay('shop', 'pi_2');
    expect((await listPublishRequests(storage, BUYER)).filter(r => r.kind === 'card-adult-confirm')).toHaveLength(1);
  });

  it('a debit card, or a buyer already recorded as an adult, is not asked', async () => {
    await pay('shop', 'pi_d', 'debit');
    expect(await listPublishRequests(storage, BUYER)).toHaveLength(0);
    await recordAdult(storage, BUYER, 'ftn');
    await pay('shop', 'pi_c');
    expect(await listPublishRequests(storage, BUYER)).toHaveLength(0);
  });

  it('a buyer recorded as an adult by another check since the question ends it outdated, and the record stays', async () => {
    await pay('shop');
    const q = (await waitingQuestion())!;
    await recordAdult(storage, BUYER, 'eudiw');
    const out = await decide(person('reader'), q.id, 'approve');
    expect(out).toMatchObject({ ok: false, status: 409, code: 'OUTDATED' });
    expect(await readAdult(storage, BUYER)).toMatchObject({ verified: true, method: 'eudiw' });
  });
});

describe('policy: a question marked in_person', () => {
  const request = { requested_by: { principal: BUYER, sub: BUYER }, approval: { approver: 'owner' as const, in_person: true } };
  const decider = (kind: 'owner' | 'agent' | 'app', inPerson: boolean) => ({ kind, inPerson, has: () => true, principal: 'x', auth: { sub: 'x' } });
  it('is allowed by the owner in person only, and declined by the owner or an agent', () => {
    expect(approvalDecisionRefusal(decider('owner', true), request, 'approve', false)).toBeNull();
    expect(approvalDecisionRefusal(decider('owner', false), request, 'approve', false)).toMatchObject({ code: 'OWNER_IN_PERSON' });
    expect(approvalDecisionRefusal(decider('agent', false), request, 'approve', false)).toMatchObject({ code: 'OWNER_IN_PERSON' });
    expect(approvalDecisionRefusal(decider('agent', false), request, 'decline', false)).toBeNull();
    expect(approvalDecisionRefusal(decider('app', false), request, 'decline', false)).toMatchObject({ code: 'ACCESS_DENIED' });
  });
  it('leaves a question without it as before: an agent of the owner may allow it', () => {
    const plain = { requested_by: request.requested_by, approval: { approver: 'owner' as const } };
    expect(approvalDecisionRefusal(decider('agent', false), plain, 'approve', false)).toBeNull();
  });
});
