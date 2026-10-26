/**
 * @file test/e2e-purpose-shared-extensions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description PURPOSE: an extension is a service other accounts call, and each caller brings their
 *   own key. Owner A writes and shares one extension; owner B calls it and gets the answer, on the
 *   free path, the paced path and the money path the node runs; B's own vault key reaches the address
 *   the key is bound to, and a key stored without an address works after B's one press; A, the
 *   author, never sees B's key. AIMEAT-PURPOSE.md uses 1 and 2, invariant 20.
 *
 *   WHY IT EXISTS. The October 2026 audit's second wave closed a real hole on this path and, with
 *   every suite green, also took away "bring your own key" through a shared extension. Nothing
 *   tested the use, only the refusal. Each test here names the use and fails when the use is gone.
 *
 *   FAIL FIRST, 2026-10-21, both backends: with ctx.fetch reading no vault for another account's
 *   extension (services/extension-ctx.ts, vaultOwner null when the installer is not the caller's
 *   account, the shape of the first wave's fix), tests 5, 6 and 7 are red; restored byte for byte.
 *
 *   THE RECEIVER runs on 127.0.0.1 (the runner admits private egress) on E2E_PURPOSE_SHARED_PORT,
 *   40821 by default.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-purpose-shared-extensions
 * @version-history
 *   v1.0.0 -- 2026-10-21 -- Initial (wish wish-tarkoitustestit-e2e-sarjat-jotka-varmistavat-aimeatin-suunni).
 */
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent } from './helpers/mcp-session.js';
import { BASE, assert, auth, harness, installExtension, json, sleep, startReceiver } from './helpers/purpose-kit.js';

const h = harness('Purpose: an extension is a service other accounts call, with their own keys');
const STAMP = Date.now().toString(36);
const receiver = await startReceiver(parseInt(process.env.E2E_PURPOSE_SHARED_PORT ?? '40821', 10));
const EXT = `purposesvc${STAMP}`;
const WHY = "to read the caller's shop orders";

const SCRIPTS = {
    answer: `export default async function (ctx, input) {
        return { answer: 'forty-two for ' + (input.q || 'nobody'), caller: ctx.caller.owner };
    }`,
    // Calls the URL it is given with the caller's key named in a header; the node fills the value in.
    byok: `export default async function (ctx, input) {
        var failed = null, status = 0;
        try { var res = await ctx.fetch(input.url, { method: 'GET', headers: { 'X-Api-Key': '{{secret:' + input.secret + '}}' } }); status = res.status; }
        catch (err) { failed = err && err.message ? err.message : String(err); }
        return { status: status, failed: failed };
    }`,
};
const MANIFEST = JSON.stringify({
    metadata: { name: EXT, version: '1.0.0', description: 'A shared shop service: each caller uses their own shop key.', author: 'purpose' },
    uses_secrets: ['SHOP_KEY', 'SHOP_KEY_NEW'].map(name => ({ name, hosts: [receiver.host], why: WHY })),
    actions: [
        { id: 'answer', method: 'POST', path: '/answer', script: 'answer' },
        { id: 'paced', method: 'POST', path: '/paced', script: 'answer', tollMorsels: 2 },
        { id: 'paid', method: 'POST', path: '/paid', script: 'answer', commercial: { payMoney: { amount: 500000, currency: 'EUR' } } },
        { id: 'byok', method: 'POST', path: '/byok', script: 'byok' },
    ],
    config: { public_access: { default: true } },
    limits: { timeout_ms: 5000, max_api_calls: 3 },
}, null, 2);

const call = (token: string, action: string, input: Record<string, unknown>, headers: Record<string, string> = {}) =>
    json(`/v1/ext/${EXT}/${action}`, { method: 'POST', headers: { ...auth(token), ...headers }, body: JSON.stringify(input) });
const balance = async (token: string) => Number((await json('/v1/wallet', { headers: auth(token) })).body?.data?.balance ?? NaN);
const secretRow = async (token: string, name: string) =>
    ((await json('/v1/secrets', { headers: auth(token) })).body?.data?.secrets ?? []).find((s: any) => s.name === name);
const B_KEY = `b-own-shop-key-${STAMP}`;
const B_NEW_KEY = `b-new-shop-key-${STAMP}`;

const author = await registerOwner(BASE, `purposeauthor${STAMP}`);   // first owner on a cleared database: the operator
const caller = await registerOwner(BASE, `purposecaller${STAMP}`);
const callerAgent = await makeAgent(BASE, caller, ['ext:invoke']);

await h.test('1. The author shares an extension whose source states which key it uses, where it sends it and why', async () => {
    await installExtension(author.token, EXT, MANIFEST, SCRIPTS);
    const shown = await json(`/v1/extensions/${EXT}`);
    const uses = shown.body?.data?.extension?.uses_secrets ?? [];
    assert(uses.some((u: any) => u.name === 'SHOP_KEY' && u.hosts[0] === receiver.host && u.why === WHY), `uses_secrets is public: ${JSON.stringify(uses)}`);
});

await h.test("2. EXTENSIONS AS A SERVICE: another account calls the author's action and gets the answer, as itself", async () => {
    const r = await call(caller.token, 'answer', { q: 'B' });
    assert(r.status === 200, `B's call: ${r.status} ${JSON.stringify(r.body?.error)}`);
    assert(r.body.data.answer === 'forty-two for B' && r.body.data.caller === caller.name, `the answer: ${JSON.stringify(r.body.data)}`);
});

await h.test('3. The paced path: the call is paced from the caller\'s own morsels and still answers', async () => {
    const before = await balance(caller.token);
    const r = await call(caller.token, 'paced', { q: 'paced' });
    assert(r.status === 200 && r.body.data.answer === 'forty-two for paced', `paced call: ${r.status} ${JSON.stringify(r.body?.error ?? r.body.data)}`);
    assert(await balance(caller.token) === before - 2, `the caller paid the 2-morsel pace from ${before}`);
});

await h.test('4. The money path: the refusal says how to pay, the caller pays at checkout, and the call answers', async () => {
    const refused = await call(caller.token, 'paid', { q: 'paid' });
    assert(refused.status === 402 && /checkout/.test(refused.body?.error?.message ?? ''), `the 402 names the checkout: ${refused.status} ${JSON.stringify(refused.body?.error)}`);
    const open = await json('/v1/commerce/checkout-sessions', {
        method: 'POST', headers: auth(caller.token),
        body: JSON.stringify({ currency: 'EUR', items: [{ kind: 'ext-call', app: EXT, tool: 'paid' }] }),
    });
    assert(open.status === 201, `checkout ${open.status} ${JSON.stringify(open.body?.error)} (the run needs AIMEAT_TEST_MONEY_HANDLER=true)`);
    const done = await json(`/v1/commerce/checkout-sessions/${open.body.data.session.id}/complete`, {
        method: 'POST', headers: auth(caller.token), body: JSON.stringify({ payment: { handler: 'test.money' } }),
    });
    const token = done.body?.data?.session?.fulfillment?.results?.[0]?.result?.pay_token;
    assert(typeof token === 'string' && token.length > 0, `paid, a token: ${done.status} ${JSON.stringify(done.body?.error ?? done.body?.data?.session?.fulfillment)}`);
    const paid = await call(caller.token, 'paid', { q: 'paid' }, { 'x-aimeat-pay-token': token });
    assert(paid.status === 200 && paid.body.data.answer === 'forty-two for paid', `the paid call: ${paid.status} ${JSON.stringify(paid.body?.error)}`);
});

await h.test("5. BRING YOUR OWN KEY: the caller's key, bound to its address, reaches that address through the author's extension", async () => {
    const put = await json('/v1/secrets/SHOP_KEY', { method: 'PUT', headers: auth(caller.token), body: JSON.stringify({ value: B_KEY, host: receiver.host }) });
    assert(put.status === 200, `B stores the key for its address: ${put.status} ${JSON.stringify(put.body?.error)}`);
    receiver.deliveries.length = 0;
    const r = await call(caller.token, 'byok', { url: `${receiver.url}/orders`, secret: 'SHOP_KEY' });
    assert(r.status === 200 && r.body.data.failed === null && r.body.data.status === 200, `B's call: ${r.status} ${JSON.stringify(r.body?.data ?? r.body?.error)}`);
    assert(receiver.arrived('/orders')[0]?.key === B_KEY, `the shop got B's key: ${JSON.stringify(receiver.deliveries)}`);
});

await h.test('6. A key stored without an address: the first call asks the caller, one press allows it, and the call then works', async () => {
    const put = await json('/v1/secrets/SHOP_KEY_NEW', { method: 'PUT', headers: auth(caller.token), body: JSON.stringify({ value: B_NEW_KEY }) });
    assert(put.status === 200, `B stores the key: ${put.status}`);
    receiver.deliveries.length = 0;
    const asked = await call(caller.token, 'byok', { url: `${receiver.url}/first`, secret: 'SHOP_KEY_NEW' });
    const said = String(asked.body?.data?.failed ?? '');
    assert(said.startsWith('SECRET_HOST:') && said.includes('/v1/secret-allow?'), `the first call asks, naming the allow page: ${JSON.stringify(asked.body)}`);
    assert(receiver.deliveries.length === 0, 'nothing was sent before the caller answered');
    // The press is the key owner's own: their AI is told to ask them, it does not press for them.
    const byAgent = await json('/v1/secrets/SHOP_KEY_NEW/approvals', { method: 'POST', headers: auth(callerAgent.token), body: JSON.stringify({ extension: EXT, host: receiver.host }) });
    assert(byAgent.status === 403, `the caller's agent pressed Allow: ${byAgent.status}`);
    const allow = await json('/v1/secrets/SHOP_KEY_NEW/approvals', { method: 'POST', headers: auth(caller.token), body: JSON.stringify({ extension: EXT, host: receiver.host }) });
    assert(allow.status === 200, `the one press: ${allow.status} ${JSON.stringify(allow.body?.error)}`);
    const again = await call(caller.token, 'byok', { url: `${receiver.url}/first`, secret: 'SHOP_KEY_NEW' });
    assert(again.status === 200 && again.body.data.failed === null, `after the press: ${JSON.stringify(again.body?.data ?? again.body?.error)}`);
    assert(receiver.arrived('/first')[0]?.key === B_NEW_KEY, `the shop got B's key: ${JSON.stringify(receiver.deliveries)}`);
});

await h.test('7. The author never sees the caller\'s key: not in their vault, not in the extension, not through their own call', async () => {
    const mine = JSON.stringify((await json('/v1/secrets', { headers: auth(author.token) })).body);
    assert(!mine.includes('SHOP_KEY') && !mine.includes(B_KEY), `the author's vault lists B's key: ${mine.slice(0, 300)}`);
    const full = JSON.stringify((await json(`/v1/extensions/${EXT}?full=true`, { headers: auth(author.token) })).body);
    assert(full.includes(EXT) && !full.includes(B_KEY) && !full.includes(B_NEW_KEY), 'the extension record holds B\'s key');
    receiver.deliveries.length = 0;
    const own = await call(author.token, 'byok', { url: `${receiver.url}/author`, secret: 'SHOP_KEY' });
    assert(typeof own.body?.data?.failed === 'string' && receiver.deliveries.every(d => d.key !== B_KEY),
        `the author's own call reached B's key: ${JSON.stringify(own.body?.data)} ${JSON.stringify(receiver.deliveries)}`);
    // The use is stamped after the call returns, so the list is read until it shows it.
    let row = await secretRow(caller.token, 'SHOP_KEY');
    for (let i = 0; i < 20 && !row?.usedBy?.includes(EXT); i++) { await sleep(100); row = await secretRow(caller.token, 'SHOP_KEY'); }
    assert(row && !JSON.stringify(row).includes(B_KEY) && row.usedBy.includes(EXT), `B's own list shows the use and never the value: ${JSON.stringify(row)}`);
});

await receiver.stop();
h.finish();
