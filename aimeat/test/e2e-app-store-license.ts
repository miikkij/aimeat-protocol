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
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=app-store-license
 * @version-history
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

await test('Cleanup', async () => {
    await json(`/v1/owners/${sellerName}`, { ...auth(sellerTok), method: 'DELETE' });
    await json(`/v1/owners/${buyerName}`, { ...auth(buyerTok), method: 'DELETE' });
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
