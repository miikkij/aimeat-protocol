/**
 * @file test/e2e-atomic-money.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two writers of one record at the same moment, on the commerce books, the UCP guest
 *   checkout, the package sales catalogue and the owner's AI settings: each test asserts that both
 *   changes persist, or that a once-only step happens once (check:atomic-writes, group G1 of
 *   wish-ei-atomisen-kirjoituksen-107-avointa-kohtaa-korjataan-raha-j).
 *
 *   HOW THE TWO WRITERS MEET. `afterRead(owner, key, between, run)` runs `run`, and right after its
 *   first read of `key` returns, runs `between` to its end, so `run` goes on with the copy it read
 *   before `between` wrote. That is the interleaving two requests or two node processes produce,
 *   written out, so a test fails on code that writes back a stale copy on both backends (a
 *   synchronous SQLite driver does not interleave two HTTP requests by itself, docs/pitfalls.md). The
 *   hook replaces `getMemory` on the storage instance the node uses, for one read, so it reaches a
 *   route as well as a service function. Where two copies of one step race (a webhook delivery),
 *   the two are fired together with Promise.all, which interleaves at every await.
 *
 *   The node is in this process (port 40473) on a database of its own on the run's backend
 *   (helpers/own-node-db.ts); a stand-in UCP platform answers the order webhook from this process.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=atomic-money
 * @version-history
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   v1.0.0 — 2026-10-18 — Initial (wish-ei-atomisen-kirjoituksen-107-avointa-kohtaa-korjataan-raha-j, G1).
 */
import { randomBytes } from 'node:crypto';
import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { McpServer } from '@modelcontextprotocol/server';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import type { MemoryRecord } from '../src/storage/interface.js';
import { bookBeneficiaryShares, settleEntryStatus, markEntriesPaid, type BeneficiaryEntry } from '../src/commerce/beneficiary-book.js';
import { bookPayable } from '../src/commerce/payable-book.js';
import { getSession } from '../src/commerce/session-service.js';
import { readGuestCheckout, onUcpTaskDone, deliverOrderWebhook } from '../src/commerce/ucp-guest-checkout.js';
import { setCatalogueEntry, recordReview, putSubscription, readCatalogue, subscriptionsOf, NS_PACKAGE_SALES, type Subscription } from '../src/services/packages/sale/package-sale-catalogue.js';
import { writeAgentKey, writeAgentCap, agentKeyRecord } from '../src/services/agent-ai-keys.js';
import { deleteOwnerAiProvider, persistHealth } from '../src/services/ai/provider-store.js';
import { PROVIDER_PREFIX } from '../src/services/ai/providers.js';
import { registerOperatorConfigTools } from '../src/mcp/operator-config.js';
import { agentSessionCaller } from '../src/services/caller-context.js';
import { updateRecord } from '../src/services/record-cas.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { registerOwner } from './helpers/owner-login.js';

const PORT = parseInt(process.env.E2E_ATOMIC_MONEY_PORT ?? '40473', 10);
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) } });
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = { _raw: text }; }
    return { status: res.status, body };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

process.env.AIMEAT_PORT = String(PORT);
process.env.AIMEAT_DEV_MODE = 'true';
process.env.AIMEAT_TEST_MODE = 'true';
process.env.AIMEAT_BASE_URL = BASE;
const adminPw = randomBytes(16).toString('base64url');
process.env.AIMEAT_ADMIN_PASSWORD = adminPw;
const { config } = loadConfig({});
Object.assign(config, {
    port: PORT, baseUrl: BASE, devMode: true, testMode: true, adminPassword: adminPw, commerceEnabled: true,
    encryptionKey: randomBytes(32).toString('hex'),
    ...(await ownNodeDb('atomic-money', { memory: true })).config,
});
const { app, storage } = await createServer(config);
const server = await new Promise<Server>((resolve) => { const s = app.listen(PORT, '127.0.0.1', () => resolve(s)); });

/**
 * Run `run`; right after its first read of (owner, key) returns, run `between` to its end on the
 * real storage, then hand `run` the copy it read. Answers what `run` answers.
 */
async function afterRead<T>(owner: string, key: string, between: () => Promise<unknown>, run: () => Promise<T>): Promise<T> {
    const s = storage as unknown as Record<string, unknown>;
    const own = Object.getOwnPropertyDescriptor(s, 'getMemory');
    const original = storage.getMemory;
    const restore = () => { if (own) Object.defineProperty(s, 'getMemory', own); else delete s.getMemory; };
    let fired = false;
    s.getMemory = async (o: string, k: string, ...rest: unknown[]) => {
        const read = await (original as (...a: unknown[]) => Promise<MemoryRecord | null>).call(storage, o, k, ...rest);
        if (!fired && o === owner && k === key) { fired = true; restore(); await between(); }
        return read;
    };
    try { return await run(); } finally { if (!fired) restore(); }
}

/** How many writes of (owner, key) landed while `run` ran. */
async function writesDuring<T>(owner: string, key: string, run: () => Promise<T>): Promise<{ result: T; writes: number }> {
    const s = storage as unknown as Record<string, unknown>;
    const names = ['setMemory', 'setMemoryIfVersion', 'createMemoryIfAbsent'] as const;
    const saved = names.map(n => [n, Object.getOwnPropertyDescriptor(s, n), storage[n as keyof typeof storage]] as const);
    let writes = 0;
    // A provider's conditional write may call its own setMemory; only the outermost call counts.
    let depth = 0;
    for (const [n, , fn] of saved) {
        if (typeof fn !== 'function') continue;
        s[n] = async (rec: MemoryRecord, ...rest: unknown[]) => {
            depth++;
            try {
                const out = await (fn as (...a: unknown[]) => Promise<unknown>).call(storage, rec, ...rest);
                if (depth === 1 && out && rec.ownerGaii === owner && rec.key === key) writes++;
                return out;
            } finally { depth--; }
        };
    }
    try { return { result: await run(), writes }; }
    finally { for (const [n, desc] of saved) { if (desc) Object.defineProperty(s, n, desc); else delete s[n]; } }
}

async function put(owner: string, key: string, value: unknown): Promise<void> {
    const now = new Date().toISOString();
    const prev = await storage.getMemory(owner, key);
    await storage.setMemory({ key, ownerGaii: owner, value: value as Record<string, unknown>, visibility: 'owner', tags: [], ttlHours: null,
        version: (prev?.version ?? 0) + 1, createdAt: now, updatedAt: now });
}
const valueOf = async <T>(owner: string, key: string): Promise<T> => (await storage.getMemory(owner, key))?.value as T;

console.log('\n=== Two writers of one record at the same moment (commerce, UCP, package sales, AI settings) ===\n');

const stamp = Date.now().toString(36).slice(-6);
await registerOwner(BASE, `atomop${stamp}`);   // the first owner on a fresh node is its operator
const owner = await registerOwner(BASE, `atomown${stamp}`);
const seller = await registerOwner(BASE, `atomsel${stamp}`);
const P1 = `prov1@${config.nodeId}`;
const P2 = `prov2@${config.nodeId}`;

// ── The beneficiary book and the payable book ─────────────────────────────────────────────────

const line = (ghii: string, amount: number) => ({ ghii, amount, weight: 1, kind: 'static' as const, note: '' });
const benefit = (code: string) => `commerce.benefit.${code}`;

await test('A share booked twice at the same moment is booked once', async () => {
    const code = `tc_book_${stamp}`;
    const args = { lines: [line(owner.ghii, 1000)], trackingCode: code, fromGhii: P1, currency: 'EUR' };
    let between = 0;
    const run = await afterRead(owner.ghii, benefit(code), async () => { between = await bookBeneficiaryShares(storage, args); },
        () => bookBeneficiaryShares(storage, args));
    const items = (await valueOf<{ items: BeneficiaryEntry[] }>(owner.ghii, benefit(code))).items;
    assert(run + between === 1 && items.length === 1, `booked ${run} + ${between}, ${items.length} entries`);
});

await test('Two providers booking a share under one tracking code at the same moment both persist', async () => {
    const code = `tc_two_${stamp}`;
    await afterRead(owner.ghii, benefit(code),
        () => bookBeneficiaryShares(storage, { lines: [line(owner.ghii, 500)], trackingCode: code, fromGhii: P2, currency: 'EUR' }),
        () => bookBeneficiaryShares(storage, { lines: [line(owner.ghii, 700)], trackingCode: code, fromGhii: P1, currency: 'EUR' }));
    const items = (await valueOf<{ items: BeneficiaryEntry[] }>(owner.ghii, benefit(code))).items;
    assert(items.length === 2 && items.some(i => i.fromGhii === P1) && items.some(i => i.fromGhii === P2), `entries: ${JSON.stringify(items.map(i => i.fromGhii))}`);
});

await test('Two releases of one accrued share at the same moment: one changes it, the other finds nothing to change', async () => {
    const code = `tc_rel_${stamp}`;
    await bookBeneficiaryShares(storage, { lines: [line(owner.ghii, 900)], trackingCode: code, fromGhii: P1, currency: 'EUR' });
    const release = () => settleEntryStatus(storage, { beneficiaryGhii: owner.ghii, trackingCode: code, fromGhii: P1, to: 'released' });
    let other: unknown = null;
    const mine = await afterRead(owner.ghii, benefit(code), async () => { other = await release(); }, release);
    assert([mine, other].filter(Boolean).length === 1, `changed by ${[mine, other].filter(Boolean).length} callers`);
});

await test('A payout confirmation beside a release under the same tracking code: both status changes persist', async () => {
    const code = `tc_paid_${stamp}`;
    await bookBeneficiaryShares(storage, { lines: [line(owner.ghii, 300)], trackingCode: code, fromGhii: P1, currency: 'EUR' });
    await bookBeneficiaryShares(storage, { lines: [line(owner.ghii, 400)], trackingCode: code, fromGhii: P2, currency: 'EUR' });
    await settleEntryStatus(storage, { beneficiaryGhii: owner.ghii, trackingCode: code, fromGhii: P1, to: 'released' });
    const changed = await afterRead(owner.ghii, benefit(code),
        () => settleEntryStatus(storage, { beneficiaryGhii: owner.ghii, trackingCode: code, fromGhii: P2, to: 'released' }),
        () => markEntriesPaid(storage, { beneficiaryGhii: owner.ghii, fromGhii: P1, trackingCodes: [code], rail: 'invoice', reference: 'INV-1' }));
    const items = (await valueOf<{ items: BeneficiaryEntry[] }>(owner.ghii, benefit(code))).items;
    const status = Object.fromEntries(items.map(i => [i.fromGhii, i.status]));
    assert(changed === 1 && status[P1] === 'paid' && status[P2] === 'released', `changed ${changed}, statuses ${JSON.stringify(status)}`);
});

await test('Two payables booked under one tracking code at the same moment both persist', async () => {
    const code = `tc_pay_${stamp}`;
    const ctx = { config, storage };
    const entry = (amount: number) => ({ fromGhii: P1, amount, currency: 'EUR', method: 'invoice', status: 'pending' as const });
    await afterRead(seller.ghii, `commerce.payable.${code}`, () => bookPayable(ctx, seller.ghii, code, entry(11)), () => bookPayable(ctx, seller.ghii, code, entry(22)));
    const items = (await valueOf<{ items: Array<{ amount: number }> }>(seller.ghii, `commerce.payable.${code}`)).items;
    assert(items.length === 2 && items.map(i => i.amount).sort().join() === '11,22', `payables: ${JSON.stringify(items)}`);
});

// ── Checkout sessions ─────────────────────────────────────────────────────────────────────────

await test('Two reads of an overdue checkout at the same moment write it expired once', async () => {
    const id = `cs_atomic_${stamp}`;
    const key = `commerce.session.${id}`;
    const past = new Date(Date.now() - 60_000).toISOString();
    await put(owner.ghii, key, { id, status: 'open', buyerGhii: owner.ghii, sellerGhii: seller.ghii, items: [], currency: 'EUR', total: 0,
        attribution: { channel: 'ai', family: 'claude', via: 'agent' }, createdAt: past, updatedAt: past, expiresAt: past });
    const { result, writes } = await writesDuring(owner.ghii, key, () =>
        afterRead(owner.ghii, key, () => getSession(storage, owner.ghii, id, config), () => getSession(storage, owner.ghii, id, config)));
    assert(result?.status === 'expired' && writes === 1, `status ${result?.status}, written ${writes} times`);
});

// The stand-in UCP platform: a profile naming an order webhook, which counts what it is sent and
// answers with `hookStatus`, after `hold` when one is set.
let hookStatus = 500;
let hooks = 0;
let hold: Promise<void> | null = null;
const platform = createHttpServer((req, res) => {
    req.resume();
    req.on('end', async () => {
        if (req.url === '/.well-known/ucp') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ucp: { version: '2026-08-25', capabilities: { 'dev.ucp.shopping.order': [{ version: '2026-08-25',
                config: { webhook_url: `http://localhost:${(platform.address() as AddressInfo).port}/hooks` } }] } }, keys: [] }));
            return;
        }
        if (req.url === '/hooks') { hooks++; if (hold) await hold; res.statusCode = hookStatus; res.end('{}'); return; }
        res.statusCode = 404; res.end();
    });
});
await new Promise<void>((r) => platform.listen(0, '127.0.0.1', () => r()));
const PROFILE = `http://localhost:${(platform.address() as AddressInfo).port}/.well-known/ucp`;
const ucsId = () => `ucs_${Buffer.from(seller.name, 'utf8').toString('base64url')}_${randomBytes(16).toString('hex')}`;

await test('A guest checkout read at its expiry beside a completion claim keeps the claim', async () => {
    const id = ucsId();
    const key = `commerce.ucp.session.${id}`;
    const past = new Date(Date.now() - 60_000).toISOString();
    await put(seller.ghii, key, { id, status: 'ready_for_complete', platformProfile: PROFILE, platformFamily: 'other', sellerGhii: seller.ghii,
        sellerOwner: seller.name, currency: 'USD', lines: [], buyer: { email: 'pat@example.com' }, orderId: null, lastError: null,
        createdAt: past, updatedAt: past, expiresAt: past });
    const claim = () => updateRecord(storage, seller.ghii, key, v => v as { status: string }, cur => ({ ...cur, status: 'complete_in_progress' }), { tag: 'ucp', visibility: 'owner' });
    const read = await afterRead(seller.ghii, key, claim, () => readGuestCheckout(storage, config, id, PROFILE));
    const stored = await valueOf<{ status: string }>(seller.ghii, key);
    assert(stored.status === 'complete_in_progress' && read.status === 'complete_in_progress', `stored ${stored.status}, read ${read.status}`);
});

function ucpOrder(orderId: string, profileUrl: string) {
    const now = new Date().toISOString();
    const item = (n: number) => ({ kind: 'offer', agent: seller.ghii, offerId: `o${n}`, quantity: 1, title: `Line ${n}`, unitPrice: 1_000_000 });
    return {
        id: orderId, status: 'completed', buyerOwner: '', buyerGhii: '', buyerIdentity: 'A platform for pat', sellerOwner: seller.name, sellerGhii: seller.ghii,
        items: [item(1), item(2)], currency: 'USD', total: 2_000_000, fulfillment: { taskIds: ['task-a', 'task-b'] },
        guest: { source: 'ucp', platform: 'other', email: 'pat@example.com', name: null, profileUrl },
        ucpOrder: { checkoutId: 'ucs_x', lineIds: ['li_1', 'li_2'], itemIds: ['i1', 'i2'], events: [{ id: 'ev0', occurred_at: now, type: 'processing', line_items: [] }], fulfilled: {} },
        createdAt: now, updatedAt: now, expiresAt: now,
    };
}
const doneTask = (id: string, orderId: string) => ({ id, ownerGaii: seller.ghii, scope: [{ name: 'commerce_session', value: orderId }] }) as never;

await test('Two fulfilment tasks of one order finishing at the same moment both mark their line delivered', async () => {
    const orderId = `uco_${ucsId().slice(4)}`;
    const key = `commerce.order.${orderId}`;
    await put(seller.ghii, key, ucpOrder(orderId, 'http://localhost:1/none'));
    await afterRead(seller.ghii, key, () => onUcpTaskDone(storage, config, doneTask('task-b', orderId)), () => onUcpTaskDone(storage, config, doneTask('task-a', orderId)));
    const order = await valueOf<ReturnType<typeof ucpOrder>>(seller.ghii, key);
    const delivered = order.ucpOrder.events.filter(e => e.type === 'delivered').length;
    assert(order.ucpOrder.fulfilled['li_1' as never] === 1 && order.ucpOrder.fulfilled['li_2' as never] === 1 && delivered === 2,
        `fulfilled ${JSON.stringify(order.ucpOrder.fulfilled)}, delivered events ${delivered}`);
});

await test('One order webhook delivered twice at the same moment is sent once, and its failed try is counted once', async () => {
    const orderId = `uco_${ucsId().slice(4)}`;
    const pending = `commerce.ucp.pending.${orderId}`;
    await put(seller.ghii, `commerce.order.${orderId}`, ucpOrder(orderId, PROFILE));
    await put(seller.ghii, pending, { orderId, attempts: 0, nextAt: new Date().toISOString(), lastStatus: null });
    hookStatus = 500; hooks = 0;
    let release: () => void = () => undefined;
    hold = new Promise<void>(r => { release = r; });
    const both = Promise.all([deliverOrderWebhook(storage, config, seller.ghii, orderId), deliverOrderWebhook(storage, config, seller.ghii, orderId)]);
    await new Promise(r => setTimeout(r, 300));
    release(); hold = null;
    await both;
    const after = await valueOf<{ attempts: number }>(seller.ghii, pending);
    assert(hooks === 1 && after?.attempts === 1, `sent ${hooks} times, attempts ${after?.attempts}`);
});

await test('One order webhook delivered alone is sent once and its pending record goes (unchanged single delivery)', async () => {
    const orderId = `uco_${ucsId().slice(4)}`;
    const pending = `commerce.ucp.pending.${orderId}`;
    await put(seller.ghii, `commerce.order.${orderId}`, ucpOrder(orderId, PROFILE));
    await put(seller.ghii, pending, { orderId, attempts: 0, nextAt: new Date().toISOString(), lastStatus: null });
    hookStatus = 200; hooks = 0;
    const ok = await deliverOrderWebhook(storage, config, seller.ghii, orderId);
    assert(ok === true && hooks === 1 && !(await storage.getMemory(seller.ghii, pending)), `ok ${ok}, sent ${hooks}`);
});

// ── The package sales catalogue ───────────────────────────────────────────────────────────────

const REPO = 'repo-node-atomic';
const pkg = (n: number) => `pkg${n}${stamp}::author`;

await test('Two catalogue entries set at the same moment both persist', async () => {
    await afterRead(NS_PACKAGE_SALES, 'catalogue',
        () => setCatalogueEntry(storage, { owner: 'op' }, { repository: REPO, group_id: pkg(2), price: { amount: 2_000_000, currency: 'EUR' } }),
        () => setCatalogueEntry(storage, { owner: 'op' }, { repository: REPO, group_id: pkg(1), price: { amount: 1_000_000, currency: 'EUR' } }));
    const groups = (await readCatalogue(storage)).map(e => e.group_id);
    assert(groups.includes(pkg(1)) && groups.includes(pkg(2)), `catalogue: ${JSON.stringify(groups)}`);
});

await test('A review and a price change in the catalogue at the same moment both persist', async () => {
    const reviewed = { version: '1.0.0', capabilities_hash: 'h1', at: new Date().toISOString(), by: 'op' };
    const out = await afterRead(NS_PACKAGE_SALES, 'catalogue',
        () => setCatalogueEntry(storage, { owner: 'op' }, { repository: REPO, group_id: pkg(2), price: { amount: 2_500_000, currency: 'EUR' } }),
        () => recordReview(storage, REPO, pkg(1), reviewed));
    const entries = await readCatalogue(storage);
    const one = entries.find(e => e.group_id === pkg(1));
    const two = entries.find(e => e.group_id === pkg(2));
    assert(out.ok && one?.reviewed?.capabilities_hash === 'h1' && two?.price?.amount === 2_500_000,
        `reviewed ${JSON.stringify(one?.reviewed)}, price ${two?.price?.amount}`);
});

await test('Two subscriptions of one buyer written at the same moment both persist', async () => {
    const now = new Date().toISOString();
    const sub = (node: string): Subscription => ({ repository: REPO, group_id: pkg(1), node_id: node, buyer: owner.ghii, terms_id: null, renewal: null,
        updates_until: null, auto_renew: false, last_order: `ord-${node}`, createdAt: now, updatedAt: now });
    await afterRead(NS_PACKAGE_SALES, `subscriptions.${owner.ghii}`, () => putSubscription(storage, sub('node-b')), () => putSubscription(storage, sub('node-a')));
    const nodes = (await subscriptionsOf(storage, owner.ghii)).map(s => s.node_id).sort();
    assert(nodes.join() === 'node-a,node-b', `subscriptions: ${JSON.stringify(nodes)}`);
});

// ── The owner's AI settings record and the agent keys ─────────────────────────────────────────

const SETTINGS = 'openrouter.settings';
type Prefs = { daily_budget_usd?: number; app_allowlist?: string[]; agent_quotas?: Record<string, { daily_usd: number }>; provider?: string; baseUrl?: string; model?: string };

await test('POST /v1/ai/settings beside an agent cap written at the same moment: both persist', async () => {
    const r = await afterRead(owner.ghii, SETTINGS, () => writeAgentCap(storage, owner.ghii, 'capone', 2),
        () => json('/v1/ai/settings', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ daily_budget_usd: 7 }) }));
    const prefs = await valueOf<Prefs>(owner.ghii, SETTINGS);
    assert(r.status === 200 && prefs.daily_budget_usd === 7 && prefs.agent_quotas?.capone?.daily_usd === 2, `${r.status} ${JSON.stringify(prefs)}`);
});

await test('Two agent caps set at the same moment both persist', async () => {
    await afterRead(owner.ghii, SETTINGS, () => writeAgentCap(storage, owner.ghii, 'captwo', 3), () => writeAgentCap(storage, owner.ghii, 'capthree', 4));
    const q = (await valueOf<Prefs>(owner.ghii, SETTINGS)).agent_quotas ?? {};
    assert(q.captwo?.daily_usd === 3 && q.capthree?.daily_usd === 4 && q.capone?.daily_usd === 2, `quotas ${JSON.stringify(q)}`);
});

await test('aimeat_operator_ai_config applied beside an agent cap written at the same moment: both persist', async () => {
    const reg = await json('/v1/agents', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ name: 'opcfg', owner: owner.name, capabilities: ['actions'] }) });
    assert(reg.status === 201, `agent ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const agentGaii = `opcfg#${owner.ghii}`;
    const scopes = ['memory:read', 'memory:write', 'memory:write-reserved', 'memory:write-as-owner'];
    const handlers: Record<string, (a: any) => Promise<any>> = {};
    const mock = { registerTool: (name: string, _config: unknown, h: (a: any) => Promise<any>) => { handlers[name] = h; } } as unknown as McpServer;
    registerOperatorConfigTools(mock, storage, config, () => agentGaii, () => undefined, () => undefined, scopes,
        () => agentSessionCaller(agentGaii, owner.name, scopes, config.nodeId, storage));
    const proposal = JSON.parse((await handlers.aimeat_operator_ai_config!({ daily_budget_usd: 9 })).content[0].text);
    assert(typeof proposal.confirm_token === 'string', `proposal: ${JSON.stringify(proposal)}`);
    const applied = await afterRead(owner.ghii, SETTINGS, () => writeAgentCap(storage, owner.ghii, 'capfour', 5),
        () => handlers.aimeat_operator_ai_config!({ daily_budget_usd: 9, confirm_token: proposal.confirm_token }));
    const prefs = await valueOf<Prefs>(owner.ghii, SETTINGS);
    assert(!applied.isError && prefs.daily_budget_usd === 9 && prefs.agent_quotas?.capfour?.daily_usd === 5,
        `${applied.content[0].text.slice(0, 200)} ${JSON.stringify(prefs)}`);
});

await test('aimeat_operator_ai_config is refused to an agent without memory:write-reserved, and the settings stay', async () => {
    const agentGaii = `opcfg#${owner.ghii}`;
    const scopes = ['memory:read', 'memory:write', 'memory:write-as-owner'];
    const handlers: Record<string, (a: any) => Promise<any>> = {};
    const mock = { registerTool: (name: string, _config: unknown, h: (a: any) => Promise<any>) => { handlers[name] = h; } } as unknown as McpServer;
    registerOperatorConfigTools(mock, storage, config, () => agentGaii, () => undefined, () => undefined, scopes,
        () => agentSessionCaller(agentGaii, owner.name, scopes, config.nodeId, storage));
    const before = await storage.getMemory(owner.ghii, SETTINGS);
    const res = await handlers.aimeat_operator_ai_config!({ daily_budget_usd: 11 });
    const after = await storage.getMemory(owner.ghii, SETTINGS);
    assert(res.isError === true && after?.version === before?.version, `refused: ${res.isError} ${String(res.content?.[0]?.text).slice(0, 120)}`);
});

await test('An agent key and its environment name set at the same moment both persist', async () => {
    const key = agentKeyRecord('openrouter', 'keyed');
    await afterRead(owner.ghii, key, () => writeAgentKey(storage, config, owner.ghii, 'keyed', 'openrouter', { env: 'KEYED_API_KEY' }),
        () => writeAgentKey(storage, config, owner.ghii, 'keyed', 'openrouter', { apiKey: 'sk-or-atomic-0001' }));
    const v = await valueOf<{ encrypted?: string; env?: string }>(owner.ghii, key);
    assert(typeof v?.encrypted === 'string' && v.env === 'KEYED_API_KEY', `record: ${JSON.stringify({ encrypted: !!v?.encrypted, env: v?.env })}`);
});

await test('A provider deleted beside an agent cap written at the same moment: the cap persists and the address is reset', async () => {
    await put(owner.ghii, `${PROVIDER_PREFIX}custom`, { spec: 'aimeat.ai-provider/v1', id: 'custom', type: 'custom', baseUrl: 'https://llm.example.com/v1',
        auth: { type: 'none' }, capabilities: {}, legacy: { settingsVersion: null, keyVersion: null, provider: 'custom' }, updatedAt: new Date().toISOString() });
    const cur = await valueOf<Prefs>(owner.ghii, SETTINGS);
    await put(owner.ghii, SETTINGS, { ...cur, provider: 'custom', baseUrl: 'https://llm.example.com/v1' });
    const gone = await afterRead(owner.ghii, SETTINGS, () => writeAgentCap(storage, owner.ghii, 'capfive', 6),
        () => deleteOwnerAiProvider(storage, config, owner.ghii, 'custom'));
    const prefs = await valueOf<Prefs>(owner.ghii, SETTINGS);
    assert(gone && prefs.provider === 'openrouter' && prefs.baseUrl === '' && prefs.agent_quotas?.capfive?.daily_usd === 6, `${gone} ${JSON.stringify(prefs)}`);
});

await test('Two capabilities of one provider writing their health at the same moment both persist', async () => {
    const key = `${PROVIDER_PREFIX}healthy`;
    await put(owner.ghii, key, { spec: 'aimeat.ai-provider/v1', id: 'healthy', type: 'custom', baseUrl: 'https://llm.example.com/v1', auth: { type: 'none' },
        capabilities: {}, health: { byCapability: {} }, updatedAt: new Date().toISOString() });
    const at = new Date().toISOString();
    await afterRead(owner.ghii, key, () => persistHealth(storage, owner.ghii, 'healthy', 'vision', { status: 'ok', lastOkAt: at }),
        () => persistHealth(storage, owner.ghii, 'healthy', 'text', { status: 'ok', lastOkAt: at }));
    const by = (await valueOf<{ health: { byCapability: Record<string, unknown> } }>(owner.ghii, key)).health.byCapability;
    assert(by.text && by.vision, `health: ${JSON.stringify(Object.keys(by))}`);
});

platform.close();
server.close();
console.log(`\n═══ ${passed} passed, ${failed} failed ═══`);
process.exit(failed > 0 ? 1 : 0);
