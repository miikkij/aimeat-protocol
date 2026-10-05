/**
 * @file e2e-package-sale.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A package sold through a selling node's own checkout (docs/specs/package-sale-design.md,
 *   phase 3). R is the package repository, S the selling node (a shop's own AIMEAT, test money on), B a
 *   node that is to receive a package. The buyer has an account on S only, never on R.
 * @structure
 *   - Setup: boot R, B and S (S last: the payment handlers and the sale resolver are process-wide, and
 *     the resolver must close over S's peers); R and S are each other's peers; R publishes two private
 *     packages, KIT (sold for money) and DESK (granted on approval)
 *   - Phase 1: the author's offer: refusals, the author's own read, a stranger learns nothing
 *   - Phase 2: S prices the package: refused before R names S a seller, the operator only, the buyer's view
 *   - Phase 3: a purchase without a node gives a claim code; B redeems it once and pulls the package
 *     with package exchange switched off
 *   - Phase 4: a purchase for a named node grants it with the author's terms and keeps the card
 *   - Phase 5: a price change reaches new sales only; a renewal at the accepted price moves the date
 *   - Phase 6: automatic renewal: charged and moved once; a declined card is told once
 *   - Phase 7: a grant the repository refuses refunds the payment
 *   - Phase 8: an offer granted on approval: refused, then approved, the buyer told each time
 *   - Phase 8b: a version R withdraws reaches B's copy at B's check (phase 5, T6)
 *   - Phase 8c: a new version that can do more waits for S's review; renewals go on (phase 5)
 *   - Phase 8d: discovery finds the package for sale; the packages-only peer cap (phase 5, finding F)
 *   - Phase 9: a paused offer sells nothing new, and renewals go on
 *   - Phase 10: an unused packages-only peer is removed after 30 days; a seller is kept (finding F)
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=package-sale
 * @version-history
 *   v1.1.0 — 2026-10-02 — Phase 5: S reviews before it sells, a withdrawn version on B, a new version
 *     that waits for review, discovery, the peer cap and the cleanup.
 *   v1.0.0 — 2026-10-02 — Initial (package sale design, phase 3).
 */
import { randomBytes } from 'node:crypto';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { generateKeyPair, sign } from '../src/auth/keypair.js';
import type { AimeatConfig } from '../src/config.js';
import type { Server } from 'node:http';
import type { Storage } from '../src/storage/interface.js';
import type { PeerInfo } from '../src/services/federation.js';
import { runAutoRenewals } from '../src/services/packages/sale/package-renewals.js';
import { runAsNode } from '../src/utils/gaii.js';
import { cleanupPackagePeers } from '../src/services/packages/peer/package-peer-limits.js';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

interface NodeState {
    server: Server; config: AimeatConfig; storage: Storage; baseUrl: string; nodeId: string; adminPw: string;
    json: (p: string, o?: RequestInit) => Promise<{ status: number; body: any }>;
}

function makeJson(baseUrl: string) {
    return async (path: string, opts: RequestInit = {}) => {
        const res = await fetch(`${baseUrl}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
        const ct = res.headers.get('content-type') ?? '';
        const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
        return { status: res.status, body };
    };
}

async function bootNode(port: number, nodeId: string, repository: boolean, extra: Partial<AimeatConfig> = {}): Promise<NodeState> {
    const adminPw = randomBytes(16).toString('base64url');
    process.env.AIMEAT_PORT = String(port);
    process.env.AIMEAT_DEV_MODE = 'true';
    process.env.AIMEAT_TEST_MODE = 'true';
    process.env.AIMEAT_ADMIN_PASSWORD = adminPw;
    process.env.AIMEAT_NODE_ID = nodeId;
    process.env.AIMEAT_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.AIMEAT_STORAGE = 'memory';
    const { config } = loadConfig({});
    Object.assign(config, {
        port, nodeId, baseUrl: `http://127.0.0.1:${port}`, devMode: true, testMode: true, adminPassword: adminPw,
        storageProvider: 'memory', packagesEnabled: true, packageFederationEnabled: true, packageCreateRole: 'owner',
        packageRepository: repository, testMoneyHandler: true,
    }, extra);
    const { app, storage } = await createServer(config);
    const server = await new Promise<Server>((resolve) => { const s = app.listen(port, '127.0.0.1', () => resolve(s)); });
    return { server, config, storage, baseUrl: `http://127.0.0.1:${port}`, nodeId, adminPw, json: makeJson(`http://127.0.0.1:${port}`) };
}

/** An account through the admin setup door, and a token for it. The first one on a node is its operator. */
async function setupOwner(node: NodeState, ownerName: string): Promise<string> {
    const reg = await node.json('/v1/admin/setup/register', {
        method: 'POST', headers: { 'X-Admin-Password': node.adminPw }, body: JSON.stringify({ name: ownerName }),
    });
    assert(reg.status === 200 && reg.body.ok === true, `register ${ownerName}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const tok = await node.json('/v1/admin/setup/token', {
        method: 'POST', headers: { 'X-Admin-Password': node.adminPw },
        body: JSON.stringify({ owner: ownerName, private_key: reg.body.private_key }),
    });
    assert(tok.body.ok === true, `token ${ownerName}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.token as string;
}

/** A person who signs up on the node: an owner, never an operator (the admin setup route makes operators). */
async function signUp(node: NodeState, name: string): Promise<string> {
    const body = JSON.stringify({ username: name, display_name: name, password: 'PackageSale1234' });
    let reg = await node.json('/v1/ghii', { method: 'POST', body });
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await node.json('/v1/ghii', { method: 'POST', body }); }
    assert(reg.status === 201, `sign up ${name}: ${reg.status} ${JSON.stringify(reg.body?.error)}`);
    const at = new Date().toISOString();
    const tok = await node.json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: at, signature: await sign(reg.body.data.private_key, name + node.nodeId + at) }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function peer(from: NodeState, fromToken: string, to: NodeState): Promise<void> {
    const key = (await to.json('/.well-known/aimeat')).body.data?.public_key;
    const add = await from.json('/v1/federation/peers', {
        method: 'POST', headers: auth(fromToken), body: JSON.stringify({ node_id: to.nodeId, url: to.baseUrl, public_key: key }),
    });
    assert(add.status === 201, `add peer: ${add.status} ${JSON.stringify(add.body)}`);
    const act = await from.json(`/v1/federation/peers/${encodeURIComponent(to.nodeId)}`, {
        method: 'PUT', headers: auth(fromToken), body: JSON.stringify({ status: 'active', share_catalogue: true }),
    });
    assert(act.status === 200, `activate: ${act.status} ${JSON.stringify(act.body)}`);
}

/** An agent of `owner` with the scopes given, and its token. */
async function registerAgent(node: NodeState, ownerToken: string, owner: string, name: string, scopes: string[]): Promise<string> {
    const reg = await node.json('/v1/agents', {
        method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ name, owner, capabilities: ['memory'], mode: 'interactive', scopes }),
    });
    assert(reg.status === 201, `agent ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const at = new Date().toISOString();
    const tok = await node.json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: at, signature: await sign(reg.body.data.private_key, gaii + at) }) });
    assert(tok.body.ok === true, `agent token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}

const ts = Date.now() % 1000000;
const EUR = (n: number) => ({ amount: n * 1_000_000, currency: 'EUR' });
const DAY = 86_400_000;
const APP_HTML = '<!DOCTYPE html><html><head><title>Kit</title></head><body><h1>Kit</h1></body></html>';

let R: NodeState, S: NodeState, B: NodeState;
let vendorToken = '', strangerToken = '', opsToken = '', buyerToken = '', bOpsToken = '';
let kit = '', desk = '';
const vendor = `vendor${ts}`;
const ops = `ops${ts}`;
const buyer = `buyer${ts}`;
// Nodes the repository has never seen and that do not answer: a grant to one stands with peer_pending.
const fakeNode = async (tag: string) => ({ node_id: `aimeat-test-001-${tag}${ts}`, url: 'http://127.0.0.1:40498', public_key: (await generateKeyPair()).publicKey });
let n1: { node_id: string; url: string; public_key: string };
let n2: { node_id: string; url: string; public_key: string };

const peersOf = async (node: NodeState): Promise<Map<string, PeerInfo>> =>
    new Map((await node.storage.listFederationPeers()).map(p => [p.nodeId, p as unknown as PeerInfo]));

/** Open a checkout for one package line on S and complete it with test money. */
async function buy(line: { app: string; offer_id?: string; input?: Record<string, unknown> }, instrument = 'card-ok', currency = 'EUR', token = buyerToken) {
    const create = await S.json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(token),
        body: JSON.stringify({ currency, items: [{ kind: 'package', agent: R.nodeId, app: line.app, offer_id: line.offer_id ?? 'buy', input: line.input ?? {} }] }),
    });
    if (create.status !== 201) return { create, done: null as any };
    const done = await S.json(`/v1/commerce/checkout-sessions/${create.body.data.session.id}/complete`, {
        method: 'POST', headers: auth(token), body: JSON.stringify({ payment: { handler: 'test.money', instrument } }),
    });
    return { create, done };
}
const resultOf = (done: any) => done.body.data.session.fulfillment.results[0].result;
const grantsOn = async (group: string) =>
    (await R.json(`/v1/packages/${encodeURIComponent(group)}/entitlements`, { headers: auth(vendorToken) })).body.data.entitlements as any[];
const subscriptions = async () => (await S.json('/v1/package-sales/subscriptions', { headers: auth(buyerToken) })).body.data;
const notifsOf = async (type: string) =>
    ((await S.json('/v1/notifications?limit=200', { headers: auth(buyerToken) })).body.data.notifications as any[]).filter(n => n.type === type);

console.log('Setup');

await test('Boot R, B and S; R and S are each other\'s peers; R publishes two private packages', async () => {
    // 40741-40743: no other suite names them.
    R = await bootNode(40741, `aimeat-test-001-salerepo${ts}`, true);
    B = await bootNode(40743, `aimeat-test-001-salebuy${ts}`, false, { packageFederationEnabled: false });
    S = await bootNode(40742, `aimeat-test-001-saleshop${ts}`, false);
    vendorToken = await setupOwner(R, vendor);
    strangerToken = await signUp(R, `stranger${ts}`);
    opsToken = await setupOwner(S, ops);
    buyerToken = await signUp(S, buyer);
    bOpsToken = await setupOwner(B, `bops${ts}`);
    await peer(S, opsToken, R);
    await peer(R, vendorToken, S);
    const publish = async (name: string) => {
        const r = await R.json('/v1/packages', {
            method: 'POST', headers: auth(vendorToken),
            body: JSON.stringify({ name, description: 'For sale', category: 'utility', visibility: 'private',
                components: [{ id: 'app-kit', type: 'app', label: 'Kit', content: APP_HTML, dependencies: [] }] }),
        });
        assert(r.status === 201, `publish ${name}: ${r.status} ${JSON.stringify(r.body)}`);
        return r.body.data.packageGroupId as string;
    };
    kit = await publish(`kit${ts}`);
    desk = await publish(`desk${ts}`);
    n1 = await fakeNode('n1');
    n2 = await fakeNode('n2');
});

console.log('\nPhase 1 — The author\'s offer');

const KIT_TERMS = {
    grant: 'payment', price: EUR(20), updates: { included_days: 2, renewal: { ...EUR(5), period_days: 30 } },
    channel: 'stable', licence: { spdx: 'LicenseRef-Kit-1.0', terms_url: 'https://example.org/kit-licence' },
    tax: { prices_include_tax: true, category: 'saas' }, support: { email: 'help@example.org', security_email: 'security@example.org' },
};

await test('A paid offer without a security contact, or priced in morsels, is refused', async () => {
    const put = (terms: unknown) => R.json(`/v1/packages/${encodeURIComponent(kit)}/offer`, { method: 'PUT', headers: auth(vendorToken), body: JSON.stringify({ terms }) });
    const noSec = await put({ ...KIT_TERMS, support: { email: 'help@example.org' } });
    assert(noSec.status === 400 && /security_email/.test(noSec.body.error?.message), `no security contact: ${noSec.status} ${JSON.stringify(noSec.body)}`);
    const morsel = await put({ ...KIT_TERMS, price: { amount: 5, currency: 'morsel' } });
    assert(morsel.status === 400 && /money/.test(morsel.body.error?.message), `morsels: ${morsel.status} ${JSON.stringify(morsel.body)}`);
});

await test('The author sets the terms; another account on R cannot set or read them', async () => {
    const set = await R.json(`/v1/packages/${encodeURIComponent(kit)}/offer`, { method: 'PUT', headers: auth(vendorToken), body: JSON.stringify({ terms: KIT_TERMS }) });
    assert(set.status === 200 && set.body.data.terms.id === 't1' && set.body.data.state === 'on_sale', `set: ${set.status} ${JSON.stringify(set.body)}`);
    const other = await R.json(`/v1/packages/${encodeURIComponent(kit)}/offer`, { method: 'PUT', headers: auth(strangerToken), body: JSON.stringify({ terms: KIT_TERMS }) });
    assert(other.status === 403, `a stranger's set: ${other.status} ${JSON.stringify(other.body)}`);
    const own = await R.json(`/v1/packages/${encodeURIComponent(kit)}/offer`, { headers: auth(vendorToken) });
    assert(own.status === 200 && own.body.data.terms.price.amount === 20_000_000, `the author's read: ${own.status} ${JSON.stringify(own.body)}`);
    // The private package's existence and author stay hidden: the answer of a package with no offer.
    const peek = await R.json(`/v1/packages/${encodeURIComponent(kit)}/offer`, { headers: auth(strangerToken) });
    assert(peek.status === 404 && peek.body.error?.code === 'NO_OFFER', `a stranger's read: ${peek.status} ${JSON.stringify(peek.body)}`);
    const anon = await R.json(`/v1/packages/${encodeURIComponent(kit)}/offer`);
    assert(anon.status === 401, `an anonymous read: ${anon.status}`);
    const deskOffer = await R.json(`/v1/packages/${encodeURIComponent(desk)}/offer`, {
        method: 'PUT', headers: auth(vendorToken), body: JSON.stringify({ terms: { grant: 'approval', updates: { included_days: 365 } } }),
    });
    assert(deskOffer.status === 200 && deskOffer.body.data.terms.grant === 'approval' && deskOffer.body.data.terms.price === null, `desk: ${deskOffer.status} ${JSON.stringify(deskOffer.body)}`);
});

console.log('\nPhase 2 — The selling node prices it');

await test('Before R names S a seller, S cannot read the author\'s terms', async () => {
    const r = await S.json(`/v1/package-sales/author-offer?repository=${encodeURIComponent(R.nodeId)}&group_id=${encodeURIComponent(kit)}`, { headers: auth(opsToken) });
    assert(r.status === 403 && r.body.error?.code === 'NOT_A_SELLER', `expected NOT_A_SELLER: ${r.status} ${JSON.stringify(r.body)}`);
});

await test('R names S a seller; S\'s operator reads every terms version, signed', async () => {
    const s = await R.json(`/v1/package-sellers/${S.nodeId}`, { method: 'PUT', headers: auth(vendorToken), body: JSON.stringify({ note: 'the shop' }) });
    assert(s.status === 200, `seller: ${s.status} ${JSON.stringify(s.body)}`);
    const r = await S.json(`/v1/package-sales/author-offer?repository=${encodeURIComponent(R.nodeId)}&group_id=${encodeURIComponent(kit)}`, { headers: auth(opsToken) });
    assert(r.status === 200 && r.body.data.terms.id === 't1' && r.body.data.all_terms.length === 1 && r.body.data.author === vendor, `offer: ${r.status} ${JSON.stringify(r.body)}`);
});

await test('Only S\'s operator prices; the buyer sees S\'s price, the author\'s terms and who sells', async () => {
    const before = await S.json(`/v1/package-sales/offer?repository=${encodeURIComponent(R.nodeId)}&group_id=${encodeURIComponent(kit)}`, { headers: auth(buyerToken) });
    assert(before.status === 404 && before.body.error?.code === 'NOT_FOR_SALE', `not priced yet: ${before.status} ${JSON.stringify(before.body)}`);
    const price = (token: string, body: Record<string, unknown>) =>
        S.json('/v1/package-sales/catalogue', { method: 'PUT', headers: auth(token), body: JSON.stringify({ repository: R.nodeId, ...body }) });
    const notOps = await price(buyerToken, { group_id: kit, price: EUR(25) });
    assert(notOps.status === 403, `the buyer cannot price: ${notOps.status}`);
    const set = await price(opsToken, { group_id: kit, price: EUR(25), renewal: { ...EUR(6), period_days: 30 }, title: 'Kit' });
    assert(set.status === 200 && set.body.data.entry.seller_of_record === ops && set.body.data.entry.price.amount === 25_000_000, `price: ${set.status} ${JSON.stringify(set.body)}`);
    const deskSet = await price(opsToken, { group_id: desk, price: null, title: 'Desk' });
    assert(deskSet.status === 200, `desk: ${deskSet.status} ${JSON.stringify(deskSet.body)}`);
    // Priced but not reviewed: nothing sells yet (phase 5, review on a selling node).
    const unreviewed = await S.json(`/v1/package-sales/offer?repository=${encodeURIComponent(R.nodeId)}&group_id=${encodeURIComponent(kit)}`, { headers: auth(buyerToken) });
    assert(unreviewed.body.data.state === 'needs_review', `needs review: ${JSON.stringify(unreviewed.body.data)}`);
    const early = await buy({ app: kit });
    assert(early.create.status === 409 && early.create.body.error?.code === 'NEEDS_REVIEW', `no sale before review: ${early.create.status} ${JSON.stringify(early.create.body)}`);
    for (const g of [kit, desk]) {
        const rev = await S.json('/v1/package-sales/catalogue/review', { method: 'POST', headers: auth(opsToken), body: JSON.stringify({ repository: R.nodeId, group_id: g }) });
        assert(rev.status === 200 && rev.body.data.entry.reviewed?.capabilities_hash === rev.body.data.reviewed.hash && rev.body.data.reviewed.items.length > 0, `review ${g}: ${rev.status} ${JSON.stringify(rev.body)}`);
    }
    const buyerReview = await S.json('/v1/package-sales/catalogue/review', { method: 'POST', headers: auth(buyerToken), body: JSON.stringify({ repository: R.nodeId, group_id: kit }) });
    assert(buyerReview.status === 403, `only the operator reviews: ${buyerReview.status}`);
    const view = await S.json(`/v1/package-sales/offer?repository=${encodeURIComponent(R.nodeId)}&group_id=${encodeURIComponent(kit)}`, { headers: auth(buyerToken) });
    const v = view.body.data;
    assert(view.status === 200 && v.price.amount === 25_000_000 && v.renewal.amount === 6_000_000 && v.updates_included_days === 2
        && v.licence.spdx === 'LicenseRef-Kit-1.0' && v.support.security_email === 'security@example.org' && v.author === vendor
        && v.seller_of_record.account === ops && v.seller_of_record.node_id === S.nodeId && v.buy.currency === 'EUR', `view: ${JSON.stringify(v)}`);
});

await test('An agent of the buyer without commerce:buy reads nothing', async () => {
    const reader = await registerAgent(S, buyerToken, buyer, 'reader', ['memory:read']);
    const r = await S.json(`/v1/package-sales/offer?repository=${encodeURIComponent(R.nodeId)}&group_id=${encodeURIComponent(kit)}`, { headers: auth(reader) });
    assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body)}`);
    const subs = await S.json('/v1/package-sales/subscriptions', { headers: auth(reader) });
    assert(subs.status === 403, `subscriptions: expected 403, got ${subs.status}`);
});

console.log('\nPhase 3 — A claim code, redeemed once');

let claimCode = '';
await test('A checkout in another currency is refused; one without a node pays and gives a claim code', async () => {
    const usd = await buy({ app: kit }, 'card-ok', 'USD');
    assert(usd.create.status === 422 && usd.create.body.error?.code === 'CURRENCY_NOT_SUPPORTED', `USD: ${usd.create.status} ${JSON.stringify(usd.create.body)}`);
    const { create, done } = await buy({ app: kit });
    assert(create.body.data.session.total === 25_000_000, `the price is S's: ${JSON.stringify(create.body.data.session)}`);
    assert(done.status === 200, `complete: ${done.status} ${JSON.stringify(done.body)}`);
    const r = resultOf(done);
    claimCode = r.claim_code;
    assert(/^pkgc_/.test(claimCode) && r.seller_of_record.account === ops && r.supplier.author === vendor && r.supplier.terms_id === 't1'
        && r.supplier_cost.amount === 20_000_000 && r.paid.amount === 25_000_000, `result: ${JSON.stringify(r)}`);
});

await test('B\'s operator redeems the code once; R grants B, sold by S, on the terms paid for', async () => {
    const rKey = (await R.json('/.well-known/aimeat')).body.data.public_key as string;
    const claim = (code: string) => B.json('/v1/package-claims', {
        method: 'POST', headers: auth(bOpsToken), body: JSON.stringify({ repository: { node_id: R.nodeId, url: R.baseUrl, public_key: rKey }, group_id: kit, code }),
    });
    const wrong = await claim('pkgc_notarealcode');
    assert(wrong.status === 404 && wrong.body.error?.code === 'CLAIM_NOT_FOUND', `a wrong code: ${wrong.status} ${JSON.stringify(wrong.body)}`);
    const ok = await claim(claimCode);
    assert(ok.status === 200 && ok.body.data.entitlement.soldBy === S.nodeId && ok.body.data.entitlement.terms?.offerTermsId === 't1', `redeem: ${ok.status} ${JSON.stringify(ok.body)}`);
    const again = await claim(claimCode);
    assert(again.status === 404 && again.body.error?.code === 'CLAIM_NOT_FOUND', `a second redemption: ${again.status} ${JSON.stringify(again.body)}`);
    const e = (await grantsOn(kit)).find(x => x.nodeId === B.nodeId);
    assert(!!e && Date.parse(e.updatesUntil) > Date.now() + DAY && Date.parse(e.updatesUntil) <= Date.now() + 2 * DAY, `B's grant: ${JSON.stringify(e)}`);
});

await test('B pulls the package with package exchange switched off, because its operator claimed it there', async () => {
    const pull = await B.json('/v1/federation/packages/pull', {
        method: 'POST', headers: auth(bOpsToken), body: JSON.stringify({ group_id: kit, node_id: R.nodeId }),
    });
    assert(pull.status === 201 && pull.body.data.applied === true, `pull: ${pull.status} ${JSON.stringify(pull.body)}`);
});

console.log('\nPhase 4 — A purchase for a named node');

await test('The buyer buys for n1 with automatic renewal; R grants n1 with the terms; the card is kept, never shown', async () => {
    const { done } = await buy({ app: kit, input: { node: n1, auto_renew: true } });
    assert(done.status === 200, `complete: ${done.status} ${JSON.stringify(done.body)}`);
    const r = resultOf(done);
    assert(r.entitlement.nodeId === n1.node_id && r.peer_pending === true && r.auto_renew === true, `result: ${JSON.stringify(r)}`);
    const e = (await grantsOn(kit)).find(x => x.nodeId === n1.node_id);
    assert(e?.soldBy === S.nodeId && e?.terms?.offerTermsId === 't1' && e?.terms?.price?.amount === 20_000_000, `n1 on R: ${JSON.stringify(e)}`);
    const sub = (await subscriptions()).subscriptions.find((x: any) => x.node_id === n1.node_id);
    assert(sub?.auto_renew === true && sub?.renewal.amount === 6_000_000 && sub?.payment?.handler === 'test.money'
        && sub?.payment?.payment_method === undefined && sub?.payment?.customer === undefined, `subscription: ${JSON.stringify(sub)}`);
});

// Secaudit 2026-10, PKG-2: R cannot tell S's buyers apart, so a second buyer naming n1 used to reach
// R as S's own sale, and R wrote its date, channel and terms over the first buyer's grant.
await test('Another buyer on S cannot buy for n1, which the first buyer holds; the payment is refunded and R\'s grant stays', async () => {
    const otherToken = await signUp(S, `buyer2${ts}`);
    const before = (await grantsOn(kit)).find(x => x.nodeId === n1.node_id);
    const { done } = await buy({ app: kit, input: { node: n1 } }, 'card-ok', 'EUR', otherToken);
    assert(done.status !== 200 && /another buyer/.test(done.body.error?.message ?? '') && /refunded/i.test(done.body.error?.message ?? ''),
        `refused: ${done.status} ${JSON.stringify(done.body)}`);
    const after = (await grantsOn(kit)).find(x => x.nodeId === n1.node_id);
    assert(JSON.stringify(after) === JSON.stringify(before), `n1's grant is unchanged: ${JSON.stringify(after)}`);
});

console.log('\nPhase 5 — Price changes and a renewal by hand');

let n1Until = '';
await test('S raises its renewal price and the author sets new terms; the renewal n1 accepted costs what it did', async () => {
    const raise = await S.json('/v1/package-sales/catalogue', {
        method: 'PUT', headers: auth(opsToken), body: JSON.stringify({ repository: R.nodeId, group_id: kit, renewal: { ...EUR(9), period_days: 30 } }),
    });
    assert(raise.status === 200 && raise.body.data.entry.renewal.amount === 9_000_000 && raise.body.data.entry.price.amount === 25_000_000, `raise: ${JSON.stringify(raise.body)}`);
    const t2 = await R.json(`/v1/packages/${encodeURIComponent(kit)}/offer`, {
        method: 'PUT', headers: auth(vendorToken), body: JSON.stringify({ terms: { ...KIT_TERMS, price: EUR(30) } }),
    });
    assert(t2.status === 200 && t2.body.data.terms.id === 't2' && t2.body.data.earlier_terms[0] === 't1', `t2: ${JSON.stringify(t2.body)}`);
    const before = (await subscriptions()).subscriptions.find((x: any) => x.node_id === n1.node_id).updates_until as string;
    const { create, done } = await buy({ app: kit, offer_id: `renew:${n1.node_id}` });
    assert(create.body.data.session.total === 6_000_000, `the accepted renewal price: ${JSON.stringify(create.body.data.session)}`);
    assert(done.status === 200 && resultOf(done).renewed === true && resultOf(done).supplier_cost.amount === 5_000_000, `renew: ${done.status} ${JSON.stringify(done.body)}`);
    n1Until = (await subscriptions()).subscriptions.find((x: any) => x.node_id === n1.node_id).updates_until;
    assert(Date.parse(n1Until) - Date.parse(before) === 30 * DAY, `moved by the period: ${before} → ${n1Until}`);
    const e = (await grantsOn(kit)).find(x => x.nodeId === n1.node_id);
    assert(e?.updatesUntil === n1Until && e?.terms?.offerTermsId === 't1', `R keeps the accepted terms: ${JSON.stringify(e)}`);
});

await test('A renewal of a node the buyer did not buy for is refused before payment', async () => {
    const { create } = await buy({ app: kit, offer_id: 'renew:aimeat-test-001-nobody' });
    assert(create.status === 404 && create.body.error?.code === 'NO_RENEWAL', `expected NO_RENEWAL: ${create.status} ${JSON.stringify(create.body)}`);
});

console.log('\nPhase 6 — Automatic renewal');

await test('Three days before the end, the kept card is charged once and the date moves; nothing is due twice', async () => {
    const peers = await peersOf(S);
    const at = Date.parse(n1Until) - DAY;
    const first = await runAsNode(S.nodeId, () => runAutoRenewals({ storage: S.storage, config: S.config, peers }, at));
    const mine = first.find(o => o.node_id === n1.node_id);
    assert(mine?.result === 'renewed', `renewal: ${JSON.stringify(first)}`);
    const after = (await subscriptions()).subscriptions.find((x: any) => x.node_id === n1.node_id).updates_until as string;
    assert(Date.parse(after) - Date.parse(n1Until) === 30 * DAY, `moved: ${n1Until} → ${after}`);
    const again = await runAsNode(S.nodeId, () => runAutoRenewals({ storage: S.storage, config: S.config, peers }, at));
    assert(!again.some(o => o.node_id === n1.node_id && o.result === 'renewed'), `not twice: ${JSON.stringify(again)}`);
    assert((await notifsOf('package_renewed')).length === 1, 'the buyer is told once');
    const e = (await grantsOn(kit)).find(x => x.nodeId === n1.node_id);
    assert(e?.updatesUntil === after, `R moved too: ${JSON.stringify(e)}`);
});

await test('The buyer turns automatic renewal off and on again; on needs a kept card', async () => {
    const set = (node_id: string, auto_renew: boolean) => S.json('/v1/package-sales/subscriptions/auto-renew', {
        method: 'PUT', headers: auth(buyerToken), body: JSON.stringify({ repository: R.nodeId, group_id: kit, node_id, auto_renew }),
    });
    const off = await set(n1.node_id, false);
    assert(off.status === 200 && off.body.data.auto_renew === false, `off: ${off.status} ${JSON.stringify(off.body)}`);
    const on = await set(n1.node_id, true);
    assert(on.status === 200 && on.body.data.auto_renew === true, `on: ${on.status} ${JSON.stringify(on.body)}`);
    const none = await set('aimeat-test-001-nobody', true);
    assert(none.status === 404, `no such subscription: ${none.status}`);
});

await test('A declined card fails the renewal, and the buyer is told once per period', async () => {
    const { done } = await buy({ app: kit, input: { node: n2, auto_renew: true } }, 'decline');
    assert(done.status === 200 && resultOf(done).auto_renew === true, `buy for n2: ${done.status} ${JSON.stringify(done.body)}`);
    const until = (await subscriptions()).subscriptions.find((x: any) => x.node_id === n2.node_id).updates_until as string;
    const peers = await peersOf(S);
    const at = Date.parse(until) - DAY;
    const first = await runAsNode(S.nodeId, () => runAutoRenewals({ storage: S.storage, config: S.config, peers }, at));
    assert(first.find(o => o.node_id === n2.node_id)?.result === 'failed', `declined: ${JSON.stringify(first)}`);
    await runAsNode(S.nodeId, () => runAutoRenewals({ storage: S.storage, config: S.config, peers }, at + 3_600_000));
    assert((await notifsOf('package_renewal_failed')).length === 1, 'told once');
    const sub = (await subscriptions()).subscriptions.find((x: any) => x.node_id === n2.node_id);
    assert(sub.updates_until === until && /CARD_DECLINED|declined/.test(sub.last_failure?.reason ?? ''), `unchanged, failure kept: ${JSON.stringify(sub)}`);
});

console.log('\nPhase 7 — A refusal on the repository refunds');

await test('A sale the repository refuses (a known node under another key) answers FULFILLMENT_FAILED and grants nothing', async () => {
    const before = (await grantsOn(kit)).find(x => x.nodeId === B.nodeId);
    const wrongKey = { node_id: B.nodeId, url: B.baseUrl, public_key: (await generateKeyPair()).publicKey };
    const { done } = await buy({ app: kit, input: { node: wrongKey } });
    assert(done.status === 502 && done.body.error?.code === 'FULFILLMENT_FAILED' && /refunded/i.test(done.body.error?.message), `refused: ${done.status} ${JSON.stringify(done.body)}`);
    const after = (await grantsOn(kit)).find(x => x.nodeId === B.nodeId);
    assert(JSON.stringify(after) === JSON.stringify(before), `B's grant is unchanged: ${JSON.stringify(after)}`);
});

console.log('\nPhase 8 — An offer granted on approval');

await test('A request waits; refused, the buyer is told and nothing is granted; approved, R grants it', async () => {
    const n3 = await fakeNode('n3');
    const first = await buy({ app: desk, input: { node: n3 } });
    assert(first.create.body.data.session.total === 0, `no money: ${JSON.stringify(first.create.body.data.session)}`);
    const r1 = resultOf(first.done);
    assert(r1.status === 'awaiting_seller' && typeof r1.request_id === 'string', `waiting: ${JSON.stringify(r1)}`);
    const waiting = await S.json('/v1/package-sales/requests', { headers: auth(opsToken) });
    assert((waiting.body.data.requests as any[]).some(x => x.id === r1.request_id && x.state === 'waiting'), `listed: ${JSON.stringify(waiting.body)}`);
    const decide = (id: string, token: string, decision: string) => S.json(`/v1/package-sales/requests/${encodeURIComponent(id)}/decision`, {
        method: 'POST', headers: auth(token), body: JSON.stringify({ decision }),
    });
    assert((await decide(r1.request_id, buyerToken, 'approve')).status === 403, 'the buyer cannot decide');
    const refused = await decide(r1.request_id, opsToken, 'refuse');
    assert(refused.status === 200 && refused.body.data.request.state === 'refused', `refuse: ${JSON.stringify(refused.body)}`);
    assert(!(await grantsOn(desk)).some(x => x.nodeId === n3.node_id), 'nothing granted');
    const second = resultOf((await buy({ app: desk, input: { node: n3 } })).done);
    const approved = await decide(second.request_id, opsToken, 'approve');
    assert(approved.status === 200 && approved.body.data.request.state === 'approved', `approve: ${approved.status} ${JSON.stringify(approved.body)}`);
    const e = (await grantsOn(desk)).find(x => x.nodeId === n3.node_id);
    assert(e?.soldBy === S.nodeId && Date.parse(e.updatesUntil) > Date.now() + 364 * DAY, `granted: ${JSON.stringify(e)}`);
    const twice = await decide(second.request_id, opsToken, 'approve');
    assert(twice.status === 409 && twice.body.error?.code === 'ALREADY_DECIDED', `decided once: ${twice.status}`);
    assert((await notifsOf('package_sale_request_decided')).length === 2, 'the buyer is told each time');
});

console.log('\nPhase 8b — A withdrawn version reaches the customer node');

const bLocalKit = () => `${kit.split('::')[0]}::bops${ts}`;
await test('B installs the version it pulled; R withdraws it; B\'s check tells B\'s owner once, with the reason', async () => {
    const inst = await B.json(`/v1/packages/${encodeURIComponent(bLocalKit())}/install`, { method: 'POST', headers: auth(bOpsToken), body: JSON.stringify({ label: 'Kit here' }) });
    assert(inst.status === 201, `install on B: ${inst.status} ${JSON.stringify(inst.body)}`);
    const versions = (await R.json(`/v1/packages/${encodeURIComponent(kit)}/versions`, { headers: auth(vendorToken) })).body.data.versions as any[];
    const v1 = versions[0].version as string;
    const w = await R.json(`/v1/packages/${encodeURIComponent(kit)}/versions/${encodeURIComponent(v1)}/withdraw`, {
        method: 'POST', headers: auth(vendorToken), body: JSON.stringify({ reason: 'The first kit leaks its settings. A fixed version follows.' }),
    });
    assert(w.status === 200, `withdraw on R: ${w.status} ${JSON.stringify(w.body)}`);
    for (let i = 0; i < 2; i++) {
        const check = await B.json('/v1/instances/check-updates', { method: 'POST', headers: auth(bOpsToken), body: '{}' });
        assert(check.status === 200, `check on B: ${check.status} ${JSON.stringify(check.body)}`);
    }
    const notes = ((await B.json('/v1/notifications?limit=100', { headers: auth(bOpsToken) })).body.data.notifications as any[]).filter(n => n.type === 'package_version_withdrawn');
    assert(notes.length === 1 && String(notes[0].body).includes('leaks its settings'), `told once on B: ${JSON.stringify(notes)}`);
});

console.log('\nPhase 8c — A new version that can do more waits for the seller\'s review');

await test('R publishes a version with a part more; new sales wait for S\'s review, renewals go on', async () => {
    const v2 = await R.json(`/v1/packages/${encodeURIComponent(kit)}/versions`, {
        method: 'POST', headers: auth(vendorToken),
        body: JSON.stringify({ status: 'published', changelog: 'Fixed, and seeds a record', components: [
            { id: 'app-kit', type: 'app', label: 'Kit', content: APP_HTML.replace('Kit</h1>', 'Kit 2</h1>'), dependencies: [] },
            { id: 'seed', type: 'memory', label: 'Seed', content: JSON.stringify({ entries: [{ key: `kit.seed.${ts}`, value: { n: 1 } }] }), dependencies: [] },
        ] }),
    });
    assert(v2.status === 201, `v2: ${v2.status} ${JSON.stringify(v2.body)}`);
    const view = await S.json(`/v1/package-sales/offer?repository=${encodeURIComponent(R.nodeId)}&group_id=${encodeURIComponent(kit)}`, { headers: auth(buyerToken) });
    assert(view.body.data.state === 'needs_review', `needs review again: ${JSON.stringify(view.body.data.state)}`);
    const sale = await buy({ app: kit, input: { node: await fakeNode('n5') } });
    assert(sale.create.status === 409 && sale.create.body.error?.code === 'NEEDS_REVIEW', `no new sale: ${sale.create.status} ${JSON.stringify(sale.create.body)}`);
    const renew = await buy({ app: kit, offer_id: `renew:${n1.node_id}` });
    assert(renew.create.status === 201 && renew.done.status === 200, `the renewal goes on: ${renew.create.status} ${JSON.stringify(renew.done?.body ?? renew.create.body)}`);
    const rev = await S.json('/v1/package-sales/catalogue/review', { method: 'POST', headers: auth(opsToken), body: JSON.stringify({ repository: R.nodeId, group_id: kit }) });
    assert(rev.status === 200 && (rev.body.data.reviewed.items as string[]).some(i => i.includes('kit.seed')), `reviewed with the new part: ${JSON.stringify(rev.body.data.reviewed)}`);
    const after = await buy({ app: kit, input: { node: await fakeNode('n6') } });
    assert(after.create.status === 201 && after.done.status === 200, `sells again: ${after.create.status} ${JSON.stringify(after.done?.body ?? after.create.body)}`);
});

console.log('\nPhase 8d — Discovery and the peer cap');

await test('An agent searching S finds the package for sale, with its price and the tool that buys it', async () => {
    const r = await S.json(`/v1/discover?scope=public&q=Kit&per_page=50`);
    const e = (r.body.data.entries as any[]).find(x => x.type === 'offering' && x.segment === 'package' && x.id === `${R.nodeId}/${kit}`);
    assert(!!e && /25\.00 EUR/.test(e.description) && /aimeat_package_buy/.test(e.description), `found: ${JSON.stringify(r.body.data.entries)}`);
});

await test('At the packages-only peer cap R refuses a new node, writes nothing, and a node already known still gets its grant', async () => {
    const before = R.config.packagePeerCap;
    R.config.packagePeerCap = 1;
    try {
        const nNew = await fakeNode('capped');
        const refused = await buy({ app: kit, input: { node: nNew } });
        assert(refused.done?.status === 502 && /PACKAGE_PEER_CAP|as many nodes/.test(JSON.stringify(refused.done.body)), `refused and refunded: ${JSON.stringify(refused.done?.body ?? refused.create.body)}`);
        assert(!(await grantsOn(kit)).some(x => x.nodeId === nNew.node_id), 'no grant for the refused node');
        const known = await buy({ app: kit, input: { node: { node_id: B.nodeId, url: B.baseUrl, public_key: (await B.json('/.well-known/aimeat')).body.data.public_key } } });
        assert(known.done?.status === 200, `a known node is not refused: ${JSON.stringify(known.done?.body ?? known.create.body)}`);
    } finally {
        R.config.packagePeerCap = before;
    }
});

console.log('\nPhase 9 — A paused offer');

await test('Paused on S, no new sale opens, and a renewal still does', async () => {
    const pause = await S.json('/v1/package-sales/catalogue', {
        method: 'PUT', headers: auth(opsToken), body: JSON.stringify({ repository: R.nodeId, group_id: kit, state: 'paused' }),
    });
    assert(pause.status === 200 && pause.body.data.entry.state === 'paused', `pause: ${JSON.stringify(pause.body)}`);
    const sale = await buy({ app: kit, input: { node: await fakeNode('n4') } });
    assert(sale.create.status === 404 && sale.create.body.error?.code === 'NOT_FOR_SALE', `no new sale: ${sale.create.status} ${JSON.stringify(sale.create.body)}`);
    const renew = await buy({ app: kit, offer_id: `renew:${n1.node_id}` });
    assert(renew.create.status === 201 && renew.done.status === 200, `renewal: ${renew.create.status} ${renew.done?.status} ${JSON.stringify(renew.done?.body ?? renew.create.body)}`);
});

console.log('\nPhase 10 — An unused packages-only peer is removed');

await test('When B holds no grant any more, R\'s daily cleanup removes it after 30 days, and keeps S, its seller', async () => {
    const del = await S.json(`/v1/package-sales/entitlements?repository=${encodeURIComponent(R.nodeId)}&group_id=${encodeURIComponent(kit)}&node_id=${encodeURIComponent(B.nodeId)}`, {
        method: 'DELETE', headers: auth(opsToken),
    });
    assert(del.status === 200, `revoke B: ${del.status} ${JSON.stringify(del.body)}`);
    const peers = await peersOf(R);
    const soon = await cleanupPackagePeers({ storage: R.storage, config: R.config, peers }, Date.now() + 86_400_000);
    assert(!soon.includes(B.nodeId), `not before 30 days: ${JSON.stringify(soon)}`);
    const later = await cleanupPackagePeers({ storage: R.storage, config: R.config, peers: await peersOf(R) }, Date.now() + 31 * 86_400_000);
    assert(later.includes(B.nodeId) && !later.includes(S.nodeId), `B removed, S kept: ${JSON.stringify(later)}`);
    const left = (await R.storage.listFederationPeers()).map(p => p.nodeId);
    assert(!left.includes(B.nodeId) && left.includes(S.nodeId), `stored peers: ${JSON.stringify(left)}`);
});

console.log('\nCleanup');
// Close and exit without awaiting: the nodes fetched each other over keep-alive (see e2e-federation-packages.ts).
try { R!.server.close(); S!.server.close(); B!.server.close(); } catch { /* the process is going away regardless */ }

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
await new Promise<void>(r => process.stdout.write('', r));
process.exit(failed > 0 ? 1 : 0);
