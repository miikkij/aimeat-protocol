/**
 * @file test/e2e-app-checkout-scope.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an app grant needs to open, read, list, change and complete a checkout session
 *   (routes/commerce.ts CHECKOUT_SCOPES).
 *
 *   AIMEAT.commerce.openCheckout, subscribe and buyOffer open the session with the app's own token.
 *   That route asked commerce:buy alone, which no app grant can hold (services/app/grant-vocabulary.ts),
 *   while the card page and the completion already took contract:spend. So an app the owner allowed
 *   to pay could not open what it pays for. Since 2026-11-21 the open, list, read and change routes
 *   take contract:spend as well; an app without it is still refused at the open.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-app-checkout-scope
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import { BASE, assert, expectRefusal, finish, json, test } from './helpers/harness.js';
import { registerOwner } from './helpers/owner-login.js';
import { appGrantToken } from './helpers/purpose-kit.js';

const TAG = Date.now().toString(36).slice(-6);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

console.log('\nAn app grant and the checkout session routes');

// A neutral first owner, so neither of the two below is the operator on a fresh database.
await registerOwner(BASE, `opr${TAG}`);
const seller = await registerOwner(BASE, `seller${TAG}`);
const buyer = await registerOwner(BASE, `buyer${TAG}`);
let vendorGaii = '';
const OFFER = { id: 'translate-doc', title: 'Translate a document', ask: 'Send a document.', deliverable: { format: 'document', sample: 'untested' }, tollMorsels: 1, visibility: 'public' };

/** A new app of the buyer, signed in through the browser's app-grant flow with the given scope words. */
let apps = 0;
const appToken = (scope: string): Promise<string> =>
    appGrantToken(buyer, `checkout${TAG}-${++apps}.html`, scope, '<html><body>buy</body></html>', BASE);
const open = (token: string) => json('/v1/commerce/checkout-sessions', {
    method: 'POST', headers: auth(token), body: JSON.stringify({ items: [{ kind: 'offer', agent: vendorGaii, offer_id: OFFER.id, quantity: 1 }] }),
});

await test('setup: the seller offers work', async () => {
    const ag = await json('/v1/agents', { method: 'POST', headers: auth(seller.token), body: JSON.stringify({ name: 'vendor', owner: seller.name, capabilities: ['social'] }) });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body.error)}`);
    vendorGaii = `vendor#${seller.name}@${String(seller.ghii).split('@')[1]}`;
    const offers = await json('/v1/agents/vendor/offers', { method: 'PUT', headers: auth(seller.token), body: JSON.stringify({ offers: [OFFER] }) });
    assert(offers.status === 200, `offers ${offers.status}: ${JSON.stringify(offers.body.error)}`);
});

await test('POSITIVE: an app with contract:spend opens, reads, lists and completes its own checkout (the library\'s buyOffer flow)', async () => {
    const spender = await appToken('memory:read contract:spend');
    const r = await open(spender);
    assert(r.status === 201, `open ${r.status}: ${JSON.stringify(r.body.error)}`);
    const sid = r.body.data.session.id as string;
    const read = await json(`/v1/commerce/checkout-sessions/${sid}`, { headers: auth(spender) });
    assert(read.status === 200 && read.body.data.session.id === sid, `read ${read.status}: ${JSON.stringify(read.body.error)}`);
    const list = await json('/v1/commerce/checkout-sessions', { headers: auth(spender) });
    assert(list.status === 200 && list.body.data.sessions.some((s: any) => s.id === sid), `list ${list.status}: ${JSON.stringify(list.body.error)}`);
    const done = await json(`/v1/commerce/checkout-sessions/${sid}/complete`, { method: 'POST', headers: auth(spender), body: JSON.stringify({}) });
    assert(done.status === 200, `complete ${done.status}: ${JSON.stringify(done.body.error)}`);
});

await test('REFUSAL: an app without contract:spend cannot open a checkout, and the refusal names both words', async () => {
    const narrow = await appToken('memory:read');
    const r = await open(narrow);
    expectRefusal(r, 403, 'SCOPE_DENIED');
    const said = JSON.stringify(r.body.error);
    assert(said.includes('contract:spend') && said.includes('commerce:buy'), `the refusal names both words: ${said}`);
});

await test('EDGE: an app with contract:spend cancels its own open session, and the owner still opens one', async () => {
    const spender = await appToken('memory:read contract:spend');
    const r = await open(spender);
    assert(r.status === 201, `open ${r.status}: ${JSON.stringify(r.body.error)}`);
    const cancel = await json(`/v1/commerce/checkout-sessions/${r.body.data.session.id}`, { method: 'PATCH', headers: auth(spender), body: JSON.stringify({ cancel: true }) });
    assert(cancel.status === 200 && cancel.body.data.session.status !== 'open', `cancel ${cancel.status}: ${JSON.stringify(cancel.body.error ?? cancel.body.data?.session?.status)}`);
    const own = await open(buyer.token);
    assert(own.status === 201, `the owner's own open: ${own.status} ${JSON.stringify(own.body.error)}`);
});

finish();
