/**
 * @file test/e2e-bundled-extensions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The four extensions the node ships in docs/extensions, installed through the operator's
 *   one-click route and RUN, action by action, the way a member of the node calls them. e2e-admin-doors
 *   proves they install; nothing ran their actions until this suite.
 *
 *   The marketplace half pins the pacing ruling (decision-morseli-on-tahdistus-ei-hinta-tarjouksen-kaksi-
 *   arvoa): a morsel paces use and is never a price. The marketplace used to charge a listing fee and the
 *   whole purchase price in morsels through ctx.wallet.consume, a burn that credited nobody, so the seller
 *   was never paid. Now the node charges each paced action's `tollMorsels`, credits the extension's
 *   installer, and the listing's money price is data the extension never collects.
 * @structure
 *   - Setup: an operator (the installer), a seller and a buyer
 *   - marketplace-behaviors: listing, browse, purchase, deliver, rate; who pays what in morsels
 *   - matching-behaviors, membership-behaviors, rest-connector: install and one action each
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts \
 *     --test=e2e-bundled-extensions
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial (docs audit phase 2). On the code before: the installer was credited
 *     nothing for a listing, and the purchase debited the buyer price + fee in morsels.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body };
}

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

async function ownerTokenFor(name: string, privKey: string): Promise<string> {
    const timestamp = new Date().toISOString();
    const sig = await ed.signAsync(new TextEncoder().encode(name + NODE_ID + timestamp), Buffer.from(privKey, 'base64'));
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp, signature: Buffer.from(sig).toString('base64') }),
    });
    assert(body.ok === true, `token for ${name}: ${JSON.stringify(body.error)}`);
    return body.data.token as string;
}

const stamp = Date.now();
const operatorName = `bundop${stamp}`;
const sellerName = `bundseller${stamp}`;
const buyerName = `bundbuyer${stamp}`;
const tokens: Record<string, string> = {};

function as(who: string, opts: RequestInit = {}): RequestInit {
    return { ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${tokens[who]}` } };
}
async function balanceOf(who: string): Promise<number> {
    const { status, body } = await json('/v1/wallet', as(who));
    assert(status === 200, `wallet of ${who}: ${status} ${JSON.stringify(body.error)}`);
    return body.data.balance as number;
}
async function install(name: string) {
    const { status, body } = await json(`/v1/admin/extensions/available/${name}/install`, as(operatorName, { method: 'POST' }));
    assert(status === 201, `install ${name}: ${status} ${JSON.stringify(body.error ?? body)}`);
    assert(body.data.extension.status === 'active', `${name} is active after install`);
}
async function newInstance(ext: string, id: string, config: Record<string, unknown>) {
    const { status, body } = await json(`/v1/extensions/${ext}/instances`, as(operatorName, {
        method: 'POST', body: JSON.stringify({ id, config }),
    }));
    assert(status === 201, `instance ${ext}/${id}: ${status} ${JSON.stringify(body.error ?? body)}`);
}
async function call(who: string, path: string, input: Record<string, unknown> = {}) {
    return json(path, as(who, { method: 'POST', body: JSON.stringify(input) }));
}

console.log('\n=== AIMEAT bundled extensions E2E ===\n');
console.log('Setup');

await test('an operator, who installs the bundled extensions', async () => {
    const { status, body } = await json('/v1/admin/setup/register', {
        method: 'POST', headers: { 'X-Admin-Password': ADMIN_PW }, body: JSON.stringify({ name: operatorName }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    tokens[operatorName] = await ownerTokenFor(operatorName, body.private_key);
});

for (const name of [sellerName, buyerName]) {
    await test(`a member of the node: ${name.replace(String(stamp), '')}`, async () => {
        const { status, body } = await json('/v1/owners', {
            method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }),
        });
        assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
        tokens[name] = await ownerTokenFor(name, body.data.private_key);
    });
}

console.log('\nmarketplace-behaviors');
const MKT = '/v1/ext/marketplace-behaviors/flea';
let listingId = '';
let purchaseId = '';

await test('installs, and the operator opens an instance', async () => {
    await install('marketplace-behaviors');
    await newInstance('marketplace-behaviors', 'flea', { visibility: 'public', categories: ['books', 'general'] });
});

await test('carries no morsel fee in its configuration', async () => {
    // GET /v1/extensions/{name} does not list an action's pacing amount, so the charge itself is
    // asserted below, on the balances.
    const { body } = await json('/v1/extensions/marketplace-behaviors', as(operatorName));
    const ext = body.data.extension;
    assert(!JSON.stringify(ext.config ?? {}).includes('morsel'), `no morsel fee in the config: ${JSON.stringify(ext.config)}`);
});

await test('a listing costs the seller its pacing (2), and the node credits the installer', async () => {
    const sellerBefore = await balanceOf(sellerName);
    const installerBefore = await balanceOf(operatorName);
    const { status, body } = await call(sellerName, `${MKT}/create-listing`, {
        title: 'Old atlas', description: 'A 1970s school atlas', price: 12.5, currency: 'EUR', category: 'books',
    });
    assert(status === 200, `create-listing ${status}: ${JSON.stringify(body.error ?? body)}`);
    listingId = body.data.result?.listingId ?? body.data.listingId;
    assert(typeof listingId === 'string' && listingId.length > 0, `listingId: ${JSON.stringify(body.data)}`);
    const sellerAfter = await balanceOf(sellerName);
    const installerAfter = await balanceOf(operatorName);
    const tx = await json('/v1/wallet/transactions?limit=5', as(sellerName));
    const rows = JSON.stringify((tx.body.data?.transactions ?? []).slice(0, 4).map((t: any) => [t.type, t.amount, t.counterparty_gaii ?? t.counterpartyGaii]));
    assert(sellerAfter === sellerBefore - 2, `the seller paid the pacing amount, 2 morsels: ${sellerBefore} → ${sellerAfter} ${rows}`);
    // The burn rate's share burns (the test node runs a non-zero rate) and the rest reaches the
    // installer; an extension call carries no operator share.
    const burned = (tx.body.data?.transactions ?? []).filter((t: any) => t.type === 'pacing_burn').slice(0, 1)
        .reduce((n: number, t: any) => n - t.amount, 0);
    assert(installerAfter - installerBefore === 2 - burned && installerAfter > installerBefore,
        `the installer received the pacing less the burned share: ${installerBefore} → ${installerAfter}, burned ${burned} ${rows}`);
});

await test('browse shows the listing with its money price', async () => {
    const { status, body } = await call(buyerName, `${MKT}/browse`, { category: 'books' });
    assert(status === 200, `browse ${status}: ${JSON.stringify(body.error ?? body)}`);
    const result = body.data.result ?? body.data;
    const found = (result.listings as any[]).find(l => l.id === listingId);
    assert(!!found, `listing ${listingId} not in browse: ${JSON.stringify(result)}`);
    assert(found.price === 12.5 && found.currency === 'EUR', `money price on the listing: ${JSON.stringify(found)}`);
});

await test('a purchase takes the buyer\'s pacing (1) and never the price in morsels', async () => {
    const buyerBefore = await balanceOf(buyerName);
    const { status, body } = await call(buyerName, `${MKT}/purchase`, { listingId });
    assert(status === 200, `purchase ${status}: ${JSON.stringify(body.error ?? body)}`);
    const result = body.data.result ?? body.data;
    purchaseId = result.purchaseId;
    assert(result.status === 'agreed', `status agreed, got ${result.status}`);
    assert(result.price === 12.5 && result.currency === 'EUR', `the money price is stated: ${JSON.stringify(result)}`);
    assert(await balanceOf(buyerName) === buyerBefore - 1, 'the buyer paid only the pacing amount, 1 morsel');
});

await test('the seller confirms delivery and the buyer rates it', async () => {
    const d = await call(sellerName, `${MKT}/deliver`, { purchaseId });
    assert(d.status === 200, `deliver ${d.status}: ${JSON.stringify(d.body.error ?? d.body)}`);
    const r = await call(buyerName, `${MKT}/rate`, { purchaseId, score: 5, comment: 'As described' });
    assert(r.status === 200, `rate ${r.status}: ${JSON.stringify(r.body.error ?? r.body)}`);
});

await test('the listing is public, the purchase record (who bought what) is private to the extension', async () => {
    const ns = encodeURIComponent('ext:marketplace-behaviors.flea');
    const listing = await json(`/v1/memory/${ns}/${encodeURIComponent('listing.' + listingId)}`);
    assert(listing.status === 200, `the public listing read is the control for the path: ${listing.status}`);
    const { status } = await json(`/v1/memory/${ns}/${encodeURIComponent('purchase.' + purchaseId)}`);
    assert(status === 403 || status === 404, `a private purchase record must not be readable, got ${status}`);
});

console.log('\nmatching-behaviors');
await test('installs; create-profile refuses without the matching consent and runs with it', async () => {
    await install('matching-behaviors');
    await newInstance('matching-behaviors', 'hobbies', {});
    const profile = { displayName: 'Seller', interests: ['chess', 'hiking'], city: 'Helsinki' };
    const refused = await call(sellerName, '/v1/ext/matching-behaviors/hobbies/create-profile', profile);
    assert(refused.status >= 400 && JSON.stringify(refused.body).includes('CONSENT_REQUIRED'),
        `without consent: ${refused.status} ${JSON.stringify(refused.body.error)}`);
    const consent = await json('/v1/consent', as(sellerName, {
        method: 'POST', body: JSON.stringify({ data_pattern: 'matching.*', recipient: `node:${NODE_ID}`, purpose: 'matching' }),
    }));
    assert(consent.status === 201, `consent ${consent.status}: ${JSON.stringify(consent.body.error)}`);
    const { status, body } = await call(sellerName, '/v1/ext/matching-behaviors/hobbies/create-profile', profile);
    assert(status === 200, `create-profile ${status}: ${JSON.stringify(body.error ?? body)}`);
});

console.log('\nmembership-behaviors');
await test('installs; create makes a group and join adds a member to it', async () => {
    await install('membership-behaviors');
    const before = await call(buyerName, '/v1/ext/membership-behaviors/join', { organismKey: `org.club${stamp}` });
    assert(before.status >= 400, `join before the group exists must fail, got ${before.status}`);
    const created = await call(sellerName, '/v1/ext/membership-behaviors/create', { organismKey: `org.club${stamp}`, name: 'Club' });
    assert(created.status === 200, `create ${created.status}: ${JSON.stringify(created.body.error ?? created.body)}`);
    const again = await call(buyerName, '/v1/ext/membership-behaviors/create', { organismKey: `org.club${stamp}` });
    assert(again.status >= 400, `a second create with the same key must be refused, got ${again.status}`);
    const { status, body } = await call(buyerName, '/v1/ext/membership-behaviors/join', { organismKey: `org.club${stamp}` });
    assert(status === 200, `join ${status}: ${JSON.stringify(body.error ?? body)}`);
    const result = body.data.result ?? body.data;
    assert(result.status === 'joined', `joined: ${JSON.stringify(result)}`);
    const members = await json(`/v1/memory/${encodeURIComponent('ext:membership-behaviors')}/${encodeURIComponent(`org.club${stamp}.members`)}`);
    assert(members.status === 403 || members.status === 404, `the member list is private, got ${members.status}`);
});

console.log('\nrest-connector');
await test('installs, and pull runs in an instance with its secret decrypted and never returned', async () => {
    await install('rest-connector');
    await newInstance('rest-connector', 'acme', { apiKey: 'sk-test-0042' });
    const { status, body } = await call(operatorName, '/v1/ext/rest-connector/acme/pull', {});
    assert(status === 200, `pull ${status}: ${JSON.stringify(body.error ?? body)}`);
    const result = body.data.result ?? body.data;
    assert(result.apiKeyType === 'string' && result.apiKeyLen === 12 && result.apiKeyTail === '42',
        `the secret arrived decrypted: ${JSON.stringify(result)}`);
    assert(!JSON.stringify(body).includes('sk-test-0042'), 'the secret itself is never in the answer');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
