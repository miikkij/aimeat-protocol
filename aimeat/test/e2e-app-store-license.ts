/**
 * @file e2e-app-store-license.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The app-store licence follows the PERSON, not the exact principal. A buyer who
 *   purchases as the owner in person must have that licence recognised when their AGENT checks it,
 *   because the morsels came out of the one balance they share. Before the 2026-08-23 fix the
 *   purchase was keyed on the raw `sub` (a bare name for an owner session, an agent GAII for an
 *   agent) and the licence read false across the two, so the same app could be paid for twice — and
 *   the paywalled fork stayed shut to the agent of the very person who had bought it.
 *
 *   THE CROSS-PRINCIPAL CHECK IS THE ONE THIS FILE EXISTS FOR. Owner B buys; B's agent checks the
 *   licence, lists the purchase, and forks the paid source. All three must succeed. Against the
 *   pre-fix source the licence check and the fork both fail.
 *
 *   THE LICENCE ALSO ENDS WITH THE PERSON. A receipt outlives the account that made it, because it is
 *   the other side's book entry too, and a deleted name can be registered again. The erasure tests
 *   at the end prove that the next person to take the name starts with nothing, on either side of a
 *   sale, while the books keep the amount, the date and the app.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=app-store-license
 * @version-history
 *   v1.2.0 — 2026-09-26 — The receipt's manifest carries none of the seller's own findings (A6-10).
 *     Failed on the code before the fix: `dataMap.gap` was in it.
 *   v1.1.0 — 2026-09-24 — Erasure: a name registered again after its buyer or its seller deleted the
 *     account inherits no receipt, no sale, no paid content and no licence (audit A8-4).
 *   v1.0.0 — 2026-08-23 — Initial: purchase-as-owner, licence recognised for the owner's agent.
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
async function signMsg(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
const b64 = (html: string) => Buffer.from(html, 'utf8').toString('base64');
const auth = (t: string): RequestInit => ({ headers: { Authorization: `Bearer ${t}` } });

async function registerOwner(name: string): Promise<{ token: string; ghii: string }> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return { token: tok.body.data.token, ghii: `${name}@${NODE_ID}` };
}
async function createAgent(ownerName: string, ownerToken: string, agentName: string): Promise<{ gaii: string; token: string }> {
    const reg = await json('/v1/agents', { ...auth(ownerToken), method: 'POST', body: JSON.stringify({ name: agentName, owner: ownerName, capabilities: ['actions'], scopes: ['*'], model: 'test-model' }) });
    assert(reg.status === 201, `agent ${agentName}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const gaii = reg.body.data.agent.gaii;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: await signMsg(reg.body.data.private_key, gaii + ts) }) });
    assert(tok.body.ok === true, `agent token ${agentName}: ${JSON.stringify(tok.body.error)}`);
    return { gaii, token: tok.body.data.token };
}

console.log('\n=== App Store licence follows the person E2E ===\n');

const ts = Date.now() % 100000;
const sellerName = `apsell${ts}`;
const buyerName = `apbuy${ts}`;
const PAID = 'licensed-app.html';
let sellerTok = '', buyerTok = '';
let buyerAgent: { gaii: string; token: string };
let marketplaceOn = true;

await test('Setup: seller + buyer + buyer\'s agent, seller publishes a paid app', async () => {
    sellerTok = (await registerOwner(sellerName)).token;
    buyerTok = (await registerOwner(buyerName)).token;
    buyerAgent = await createAgent(buyerName, buyerTok, 'buyagent');

    const pub = await json('/v1/apps', { ...auth(sellerTok), method: 'POST', body: JSON.stringify({ filename: PAID, content: b64('<h1>licensed</h1>'), name: 'Licensed App', description: 'costs morsels', category: 'utility', tags: [], price_morsels: 50, license_type: 'lifetime' }) });
    assert(pub.status === 201, `publish: ${pub.status} ${JSON.stringify(pub.body)}`);
    await json(`/v1/apps/${PAID}`, { ...auth(sellerTok), method: 'PATCH', body: JSON.stringify({ forkable: true }) });
});

await test('The buyer purchases the app AS THE OWNER in person', async () => {
    const buy = await json('/v1/app-store/purchase', { ...auth(buyerTok), method: 'POST', body: JSON.stringify({ app_filename: PAID, app_owner: sellerName }) });
    if (buy.status === 403 && buy.body?.error?.code === 'APP_STORE_DISABLED') { marketplaceOn = false; console.log('    (skipped rest: marketplace disabled on this node)'); return; }
    assert(buy.status === 200 || buy.status === 201, `purchase: ${buy.status} ${JSON.stringify(buy.body)}`);
});

// A6-10. The receipt keeps a copy of the app's manifest, and the buyer reads it. The notes on a
// manifest that are the seller's own (the publish checks' findings, the build-spec state) are
// stripped from it, the way every other door that shows a manifest to somebody else strips them.
await test('The buyer\'s receipt carries the app\'s manifest without the seller\'s own findings', async () => {
    if (!marketplaceOn) return;
    const own = await json(`/v1/datamap/apps/${sellerName}/${PAID}`, auth(sellerTok));
    assert(own.status === 200 && !!own.body.data.stamp?.gap, `the seller's app carries a finding to strip: ${JSON.stringify(own.body.data?.stamp)}`);
    const list = await json('/v1/app-store/purchases', auth(buyerTok));
    const txId = (list.body.data?.purchases ?? []).find((p: any) => p.app_filename === PAID)?.transaction_id;
    assert(!!txId, `the buyer has the purchase: ${JSON.stringify(list.body.data?.purchases)}`);
    const receipt = await json(`/v1/app-store/purchases/${txId}`, auth(buyerTok));
    assert(receipt.status === 200, `receipt: ${receipt.status}`);
    const m = receipt.body.data.app_manifest ?? {};
    assert(m.name === 'Licensed App', `the receipt keeps the manifest: ${JSON.stringify(m).slice(0, 200)}`);
    assert(m.dataMap?.gap === undefined, `the buyer must not read the seller's data map finding: ${JSON.stringify(m.dataMap?.gap)}`);
    assert(m.aiPosture?.gap === undefined && m.specCheck === undefined,
        `nor the seller's other own notes: ${JSON.stringify({ gap: m.aiPosture?.gap, specCheck: m.specCheck })}`);
});

await test('The buyer\'s AGENT sees the licence the owner bought (cross-principal)', async () => {
    if (!marketplaceOn) return;
    const chk = await json(`/v1/app-store/license-check?app_filename=${PAID}&app_owner=${sellerName}`, auth(buyerAgent.token));
    assert(chk.status === 200, `license-check: ${chk.status} ${JSON.stringify(chk.body)}`);
    assert(chk.body.data?.has_license === true, `the owner's licence must be visible to their agent, got ${JSON.stringify(chk.body.data)}`);
});

await test('The owner in person also sees their own licence', async () => {
    if (!marketplaceOn) return;
    const chk = await json(`/v1/app-store/license-check?app_filename=${PAID}&app_owner=${sellerName}`, auth(buyerTok));
    assert(chk.body.data?.has_license === true, `the buyer's own licence must read true, got ${JSON.stringify(chk.body.data)}`);
});

await test('The purchase is in the agent\'s purchase list, not split off under the owner name', async () => {
    if (!marketplaceOn) return;
    const list = await json('/v1/app-store/purchases', auth(buyerAgent.token));
    assert(list.status === 200, `purchases: ${list.status}`);
    assert((list.body.data?.purchases ?? []).some((p: any) => p.app_filename === PAID),
        `the agent must see the owner's purchase, got ${JSON.stringify(list.body.data?.purchases)}`);
});

await test('The buyer\'s agent can fork the paid app it now holds a licence for', async () => {
    if (!marketplaceOn) return;
    const fork = await json(`/v1/apps/${sellerName}/${PAID}/fork`, { ...auth(buyerAgent.token), method: 'POST', body: JSON.stringify({ new_filename: 'bought-and-forked.html' }) });
    assert(fork.status === 200 || fork.status === 201, `the licensed fork must pass the paywall, got ${fork.status}: ${JSON.stringify(fork.body).slice(0, 200)}`);
});

// The DOWNLOAD door, which the 2026-08-23 fix did not reach. /license-check and /fork were keyed on
// the owner coordinate that day; GET /v1/apps/:owner/:filename kept reading `req.auth.sub`, so the
// paywall it enforces asked for a licence under the bare owner name for an owner session and under
// the agent GAII for an agent, while every receipt is keyed on `owner@node`. Both answered 402 for an
// app the person had paid for. Found 2026-09-04 by check:identity-resolution.
await test('The owner in person can DOWNLOAD the app they bought', async () => {
    if (!marketplaceOn) return;
    const dl = await json(`/v1/apps/${sellerName}/${PAID}`, auth(buyerTok));
    assert(dl.status !== 402, `the buyer's own purchase must open the paywall, got ${dl.status}: ${JSON.stringify(dl.body).slice(0, 200)}`);
    assert(dl.status === 200, `download: ${dl.status} ${JSON.stringify(dl.body).slice(0, 200)}`);
});

await test('The buyer\'s AGENT can download the app its owner bought', async () => {
    if (!marketplaceOn) return;
    const dl = await json(`/v1/apps/${sellerName}/${PAID}`, auth(buyerAgent.token));
    assert(dl.status !== 402, `the owner's licence must open the paywall for their agent, got ${dl.status}: ${JSON.stringify(dl.body).slice(0, 200)}`);
    assert(dl.status === 200, `agent download: ${dl.status} ${JSON.stringify(dl.body).slice(0, 200)}`);
});

await test('The SELLER can download their own paid app without buying it', async () => {
    if (!marketplaceOn) return;
    const dl = await json(`/v1/apps/${sellerName}/${PAID}`, auth(sellerTok));
    assert(dl.status !== 402, `the seller must not be paywalled out of their own app, got ${dl.status}: ${JSON.stringify(dl.body).slice(0, 200)}`);
});

await test('Someone who has NOT bought it is still refused (402)', async () => {
    if (!marketplaceOn) return;
    const stranger = await registerOwner(`apstr${ts}`);
    const dl = await json(`/v1/apps/${sellerName}/${PAID}`, auth(stranger.token));
    assert(dl.status === 402, `an unpaid caller must be refused, got ${dl.status}: ${JSON.stringify(dl.body).slice(0, 200)}`);
    await json(`/v1/owners/apstr${ts}`, { ...auth(stranger.token), method: 'DELETE' });
});

await test('A THIRD party — neither buyer nor seller — is refused the purchase detail (403)', async () => {
    if (!marketplaceOn) return;
    const outsider = await registerOwner(`apout${ts}`);
    // Find the buyer's transaction id, then try to read it as the outsider.
    const list = await json('/v1/app-store/purchases', auth(buyerTok));
    const txId = (list.body.data?.purchases ?? [])[0]?.transaction_id;
    assert(!!txId, `the buyer has a purchase to probe: ${JSON.stringify(list.body.data?.purchases)}`);
    const peek = await json(`/v1/app-store/purchases/${txId}`, auth(outsider.token));
    assert(peek.status === 403, `an outsider must not read someone else's receipt, got ${peek.status}`);
    await json(`/v1/owners/apout${ts}`, { ...auth(outsider.token), method: 'DELETE' });
});

// Buying spends the human's morsels, and until 2026-09-04 this door asked nothing before doing it.
// It was the FIFTH place on this node that charges: the four checkout doors gained appSpendRefusal
// as audit H-3 in August, through commerce/session-service.ts, and this one is not on that path. So
// an app the person approved for reading their notes could buy from the store with their balance —
// debitBalance resolves any principal to the owner GHII — and the per-app ceiling was never read.
//
// Only an APP principal is refused. An agent is not: appSpendRefusal bites `roles:['app']`, and an
// agent buying for its human is what an assistant is for. That is why this test does the app-grant
// dance rather than reusing buyerAgent above.
await test('An APP GRANT without contract:spend cannot buy — and with it, can', async () => {
    if (!marketplaceOn) return;

    // A second paid app: the buyer already holds a lifetime licence for the first, and that check
    // sits ahead of the spend check on purpose (nobody needs permission to spend nothing).
    const PAID2 = `spendgate-${Date.now()}.html`;
    const pub = await json('/v1/apps', { ...auth(sellerTok), method: 'POST', body: JSON.stringify({ filename: PAID2, content: b64('<h1>gated</h1>'), name: 'Spend Gate App', description: 'costs morsels', category: 'utility', tags: [], price_morsels: 25, license_type: 'lifetime' }) });
    assert(pub.status === 201, `publish second paid app: ${pub.status} ${JSON.stringify(pub.body)}`);

    // An app of the BUYER's, so the grant is theirs to consent to and the token acts in their name.
    const SHOP = `shopfront-${Date.now()}.html`;
    const shop = await json('/v1/apps', { ...auth(buyerTok), method: 'POST', body: JSON.stringify({ filename: SHOP, content: b64('<h1>shop</h1>'), name: 'Shop Front', description: 'buys things', category: 'utility', tags: [] }) });
    assert(shop.status === 201, `publish shopfront: ${shop.status} ${JSON.stringify(shop.body)}`);

    const REDIRECT = 'http://localhost:9/cb';
    const grantToken = async (scope: string) => {
        const verifier = randomBytes(32).toString('base64url');
        const challenge = createHash('sha256').update(verifier).digest('base64url');
        const q = new URLSearchParams({
            app: `${buyerName}/${SHOP}`, response_type: 'code', scope,
            redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256',
        });
        const authz = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
        const rid = decodeURIComponent(/req=([^&]+)/.exec(authz.headers.get('location') ?? '')?.[1] ?? '');
        assert(!!rid, `expected a consent redirect for "${scope}", got ${authz.status}`);
        const con = await json('/v1/app-grants/authorize-consent', {
            ...auth(buyerTok), method: 'POST', body: JSON.stringify({ request_id: rid }),
        });
        const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
        const tok = await json('/v1/app-grants/token', {
            method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT }),
        });
        assert(tok.body.ok === true, `grant token for "${scope}": ${JSON.stringify(tok.body?.error)}`);
        return tok.body.data.access_token as string;
    };

    const buy = (token: string) => json('/v1/app-store/purchase', {
        ...auth(token), method: 'POST', body: JSON.stringify({ app_filename: PAID2, app_owner: sellerName }),
    });

    const readOnly = await grantToken('memory:read');
    const refused = await buy(readOnly);
    assert(refused.status === 403, `an app approved for memory:read alone bought with the human's morsels: ${refused.status} ${JSON.stringify(refused.body?.data ?? refused.body?.error)}`);
    assert(refused.body.error?.code === 'SCOPE_DENIED', `refused for the wrong reason: ${JSON.stringify(refused.body.error)}`);

    // The refusal refused rather than charging and then complaining: no licence was written.
    const noLicence = await json(`/v1/app-store/license-check?app_filename=${PAID2}&app_owner=${sellerName}`, auth(buyerTok));
    assert(noLicence.body.data?.has_license === false, `the refused purchase left a licence behind: ${JSON.stringify(noLicence.body.data)}`);

    // And with the word the owner can grant on purpose, the same app buys. Without this half the
    // assertion above would pass just as well on a door that refuses everybody.
    const allowed = await grantToken('memory:read contract:spend');
    const bought = await buy(allowed);
    assert(bought.status === 200 || bought.status === 201,
        `an app granted contract:spend was still refused: ${bought.status} ${JSON.stringify(bought.body?.error)}`);
    const licence = await json(`/v1/app-store/license-check?app_filename=${PAID2}&app_owner=${sellerName}`, auth(buyerTok));
    assert(licence.body.data?.has_license === true, `the permitted purchase wrote no licence: ${JSON.stringify(licence.body.data)}`);
});

// ── Erasure: the next person to register a freed name starts with nothing ─────────────────────
// A deleted username is released for reuse, and the purchase receipt is KEPT when an account is
// deleted, because it is also the other side's book entry. Until 2026-09-24 the kept receipt still
// named its parties by `name@node`, which is the very coordinate every purchase read keys on, so
// whoever registered the freed name next held the previous person's receipts, the paid content in
// them and a valid licence (audit A8-4). One test per side of the sale.

/** A kept party is written as this prefix plus a random token: nothing any account can be named. */
const ERASED = /^erased:[0-9a-f]{24}$/;

await test('A name registered again after the BUYER deleted their account inherits no receipt, content or licence', async () => {
    if (!marketplaceOn) return;
    const name = `aperb${ts}`;
    const first = await registerOwner(name);
    const buy = await json('/v1/app-store/purchase', { ...auth(first.token), method: 'POST', body: JSON.stringify({ app_filename: PAID, app_owner: sellerName }) });
    assert(buy.status === 201, `purchase before the erasure: ${buy.status} ${JSON.stringify(buy.body)}`);
    const txId = buy.body.data.transaction_id as string;
    const held = await json(`/v1/app-store/license-check?app_filename=${PAID}&app_owner=${sellerName}`, auth(first.token));
    assert(held.body.data?.has_license === true, `the buyer holds the licence before the erasure: ${JSON.stringify(held.body.data)}`);

    const del = await json(`/v1/owners/${name}`, { ...auth(first.token), method: 'DELETE' });
    assert(del.status === 200, `delete the buyer: ${del.status} ${JSON.stringify(del.body)}`);
    const again = await registerOwner(name);

    const list = await json('/v1/app-store/purchases', auth(again.token));
    assert(list.status === 200, `purchases: ${list.status}`);
    assert((list.body.data?.purchases ?? []).length === 0,
        `the new account inherited the previous person's receipts: ${JSON.stringify(list.body.data?.purchases)}`);
    const lic = await json(`/v1/app-store/license-check?app_filename=${PAID}&app_owner=${sellerName}`, auth(again.token));
    assert(lic.body.data?.has_license === false, `the new account inherited a licence it never paid for: ${JSON.stringify(lic.body.data)}`);
    const receipt = await json(`/v1/app-store/purchases/${txId}`, auth(again.token));
    assert(receipt.status === 403, `the new account read the old receipt and the paid content in it: ${receipt.status}`);
    const dl = await json(`/v1/apps/${sellerName}/${PAID}`, auth(again.token));
    assert(dl.status === 402, `the paywall opened for the new account: ${dl.status}`);

    // The seller's book entry stays: the amount, the date and the app, and no longer the name.
    const sales = await json('/v1/app-store/sales', auth(sellerTok));
    const row = (sales.body.data?.sales ?? []).find((s: any) => s.transaction_id === txId);
    assert(!!row, `the sale must outlive the buyer's account: ${JSON.stringify(sales.body.data?.sales)}`);
    assert(row.buyer_owner !== name, `the seller's sales list still names the erased buyer: ${JSON.stringify(row)}`);
    assert(ERASED.test(String(row.buyer_owner)), `the buyer is written as a pseudonym: ${JSON.stringify(row)}`);
    assert(row.price_morsels === 50 && row.app_filename === PAID && row.purchased_at === buy.body.data.purchased_at,
        `the books changed with the erasure: ${JSON.stringify(row)}`);
    const detail = await json(`/v1/app-store/purchases/${txId}`, auth(sellerTok));
    assert(detail.status === 200, `the seller still reads their sale: ${detail.status}`);
    assert(detail.body.data.buyer_owner === row.buyer_owner, `the receipt names the same pseudonym: ${JSON.stringify(detail.body.data.buyer_owner)}`);
    // The node's signature covered the erased identity, so keeping it would confirm a guessed name.
    assert(detail.body.data.signature === '', 'the signature over the erased identity was kept');

    await json(`/v1/owners/${name}`, { ...auth(again.token), method: 'DELETE' });
});

await test('A name registered again after the SELLER deleted their account inherits none of their sales', async () => {
    if (!marketplaceOn) return;
    const shop = `apers${ts}`;
    const customer = `apercu${ts}`;
    const APP = 'erased-seller-app.html';
    const s1 = await registerOwner(shop);
    const pub = await json('/v1/apps', { ...auth(s1.token), method: 'POST', body: JSON.stringify({ filename: APP, content: b64('<h1>bought before</h1>'), name: 'Bought Before', description: 'costs morsels', category: 'utility', tags: [], price_morsels: 10, license_type: 'lifetime' }) });
    assert(pub.status === 201, `publish: ${pub.status} ${JSON.stringify(pub.body)}`);
    const c = await registerOwner(customer);
    const buy = await json('/v1/app-store/purchase', { ...auth(c.token), method: 'POST', body: JSON.stringify({ app_filename: APP, app_owner: shop }) });
    assert(buy.status === 201, `purchase: ${buy.status} ${JSON.stringify(buy.body)}`);
    const txId = buy.body.data.transaction_id as string;

    const del = await json(`/v1/owners/${shop}`, { ...auth(s1.token), method: 'DELETE' });
    assert(del.status === 200, `delete the seller: ${del.status} ${JSON.stringify(del.body)}`);
    const s2 = await registerOwner(shop);

    const sales = await json('/v1/app-store/sales', auth(s2.token));
    assert(sales.status === 200, `sales: ${sales.status}`);
    assert((sales.body.data?.sales ?? []).length === 0,
        `the new account inherited the previous seller's sales and customers: ${JSON.stringify(sales.body.data?.sales)}`);
    const peek = await json(`/v1/app-store/purchases/${txId}`, auth(s2.token));
    assert(peek.status === 403, `the new account read a receipt of the previous seller's customer: ${peek.status}`);

    // The customer keeps the receipt and the content they paid for, without the erased seller's name.
    const mine = await json(`/v1/app-store/purchases/${txId}`, auth(c.token));
    assert(mine.status === 200, `the customer still reads their receipt: ${mine.status}`);
    assert(Buffer.from(String(mine.body.data.app_content), 'base64').toString('utf8').includes('bought before'),
        'the customer keeps the content they paid for');
    assert(mine.body.data.seller_owner !== shop && ERASED.test(String(mine.body.data.seller_owner)),
        `the receipt still names the erased seller: ${JSON.stringify(mine.body.data.seller_owner)}`);

    // And the old licence does not open whatever the new account publishes under the same name.
    const pub2 = await json('/v1/apps', { ...auth(s2.token), method: 'POST', body: JSON.stringify({ filename: APP, content: b64('<h1>somebody new</h1>'), name: 'Somebody New', description: 'costs morsels', category: 'utility', tags: [], price_morsels: 10, license_type: 'lifetime' }) });
    assert(pub2.status === 201, `publish under the reused name: ${pub2.status} ${JSON.stringify(pub2.body)}`);
    const lic = await json(`/v1/app-store/license-check?app_filename=${APP}&app_owner=${shop}`, auth(c.token));
    assert(lic.body.data?.has_license === false, `a licence bought from the erased seller opened the new account's app: ${JSON.stringify(lic.body.data)}`);

    await json(`/v1/owners/${shop}`, { ...auth(s2.token), method: 'DELETE' });
    await json(`/v1/owners/${customer}`, { ...auth(c.token), method: 'DELETE' });
});

await test('Cleanup', async () => {
    await json(`/v1/owners/${sellerName}`, { ...auth(sellerTok), method: 'DELETE' });
    await json(`/v1/owners/${buyerName}`, { ...auth(buyerTok), method: 'DELETE' });
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
