/**
 * @file e2e-data-share-visitor.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for a named share of a data package to a person on another AIMEAT node (canvas
 *   board Jako, "Toiselta AIMEATilta"; WP9c, plan doc-mvwxcas3dom3 D3). Two home nodes run on loopback
 *   the way test/e2e-federated-namesake.ts serves one: active peers registered through the operator
 *   routes, answering the verify route with a SIGNED attestation. The runner pins
 *   AIMEAT_FEDERATION_AUTH_POLICY=all_peers and private egress.
 *
 *   The owner shares a PRIVATE package with bob of home node one, by his home account. That visitor
 *   reads the descriptor, the rows, the CSV and the OData feed; a visitor bob of home node two gets 403
 *   NOT_SHARED, and the local account bob reaches nothing (the private package answers it as missing);
 *   a members package still admits the local bob and never a visitor; ending the share refuses the
 *   visitor's next read with SHARE_ENDED. Refusals of the share itself: a recipient on this node and a
 *   body with neither name nor recipient. The exposure report and the product list count the share.
 *   Every assertion fails on the code before WP9c: no share named a GHII recipient, and a visitor read
 *   nothing private.
 * @version-history
 *   v1.1.0 — 2026-11-02 — The library's reach "shared" lists the visitor's share and nothing for the
 *     namesake of another home node (WP11).
 *   v1.0.0 — 2026-11-01 — Initial (WP9c).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=data-share-visitor

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';
import { registerOwner } from './helpers/owner-login.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
async function call(path: string, opts: { token?: string; body?: unknown; method?: string } = {}): Promise<{ status: number; body: Body; text: string; type: string }> {
    const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let body: Body = { _raw: text };
    try { body = JSON.parse(text) as Body; } catch { /* a non-JSON body stays raw */ }
    return { status: res.status, body, text, type: res.headers.get('content-type') ?? '' };
}
const show = (r: { status: number; text: string }) => `${r.status} ${r.text.slice(0, 400)}`;
const stamp = Date.now().toString(36);

async function newKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
    const priv = ed.utils.randomSecretKey();
    const pub = await ed.getPublicKeyAsync(priv);
    return { publicKey: Buffer.from(pub).toString('base64'), privateKey: Buffer.from(priv).toString('base64') };
}
function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve) => { let raw = ''; req.on('data', c => { raw += c.toString(); }); req.on('end', () => resolve(raw)); });
}
function send(res: ServerResponse, status: number, payload: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
}

/** A home node on loopback: the signed attestation register-login.ts verifies, for any name asked. */
async function startHome(nodeId: string): Promise<{ server: Server; url: string; keys: { publicKey: string; privateKey: string } }> {
    const keys = await newKeyPair();
    let url = '';
    const server = createServer((req, res) => {
        void (async () => {
            if (req.method === 'POST' && req.url === '/v1/federation/auth/verify') {
                const who = /"username"\s*:\s*"([^"]+)"/.exec(await readBody(req))?.[1] ?? 'nobody';
                const payload = { verified: true, ghii: `${who}@${nodeId}`, display_name: `${who} at home`, home_node: nodeId, home_url: url, scopes: ['memory:read'] };
                const sig = await ed.signAsync(new TextEncoder().encode(JSON.stringify(payload)), Buffer.from(keys.privateKey, 'base64'));
                send(res, 200, { ok: true, data: { ...payload, signature: Buffer.from(sig).toString('base64') } });
                return;
            }
            send(res, 404, { ok: false, error: { code: 'NOT_FOUND' } });
        })();
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { server, url, keys };
}

const H1 = `aimeat-fake-home-one-${stamp}`;
const H2 = `aimeat-fake-home-two-${stamp}`;
const bobName = `dsvbob${stamp}`;
const PKG = `dsv-towns-${stamp}`;
const MEMBERS_PKG = `dsv-members-${stamp}`;
const homes: Server[] = [];

console.log('\n=== A data package shared with a person on another AIMEAT node ===\n');
let op = { token: '' }, alice = { name: '', token: '' }, localBob = { token: '' };
let visitorOne = '', visitorTwo = '', shareId = '';

async function loginVisitor(account: string): Promise<string> {
    const r = await call('/v1/ghii/login', { body: { username: account, password: 'the-home-node-decides' } });
    assert(r.status === 200, `federated login ${account}: ${show(r)}`);
    const token = r.body.data.token as string;
    const c = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as Body;
    assert(c.federated === true && c.owner === account, `a visitor session: ${JSON.stringify({ federated: c.federated, owner: c.owner, roles: c.roles })}`);
    return token;
}

async function main() {
    await test('setup: the operator, two home nodes as peers, the owner, the local namesake, a private and a members package', async () => {
        const o = await registerOwner(BASE, `dsvop${stamp}`);
        assert(o.roles.includes('operator'), 'this suite needs to be the first owner on a freshly deleted database');
        op = o;
        for (const id of [H1, H2]) {
            const h = await startHome(id);
            homes.push(h.server);
            const reg = await call('/v1/federation/peers', { token: op.token, body: { node_id: id, url: h.url, public_key: h.keys.publicKey } });
            assert(reg.status === 201, `peer ${id}: ${show(reg)}`);
            const act = await call(`/v1/federation/peers/${id}`, { token: op.token, method: 'PUT', body: { status: 'active' } });
            assert(act.status === 200, `activate ${id}: ${show(act)}`);
        }
        const a = await registerOwner(BASE, `dsvalice${stamp}`);
        alice = { name: a.name, token: a.token };
        localBob = await registerOwner(BASE, bobName);
        assert((await call('/v1/memory', { token: alice.token, body: { key: 'dsv.towns', value: [{ town: 'Oulu', n: 1 }, { town: 'Kemi', n: 2 }], visibility: 'private' } })).status === 201, 'memory');
        assert((await call('/v1/memory', { token: alice.token, body: { key: 'dsv.members', value: [{ town: 'Oulu', n: 1 }], visibility: 'members' } })).status === 201, 'members memory');
        for (const [name, visibility, key] of [[PKG, 'private', 'dsv.towns'], [MEMBERS_PKG, 'members', 'dsv.members']] as const) {
            const d = await call(`/v1/dataproducts/${name}`, { token: alice.token, method: 'PUT', body: { title: `Towns ${visibility}`, sources: [{ kind: 'memory', key }], visibility } });
            assert(d.status === 201, `define ${name}: ${show(d)}`);
            const r = await call(`/v1/dataproducts/${name}/run`, { token: alice.token, body: {} });
            assert(r.status === 201, `run ${name}: ${show(r)}`);
        }
        visitorOne = await loginVisitor(`${bobName}@${H1}`);
        visitorTwo = await loginVisitor(`${bobName}@${H2}`);
    });

    await test('the share refuses a recipient on this node and a body that names neither a party nor a recipient', async () => {
        const local = await call('/v1/parties/share', { token: alice.token, body: { recipient: `${bobName}@${NODE_ID}`, package: PKG, purpose: 'Planning', days: 30 } });
        assert(local.status === 400 && local.body.error?.code === 'INVALID_RECIPIENT', `a local account: ${show(local)}`);
        const consent = await call('/v1/consent', { token: alice.token, body: { recipient: `${bobName}@${NODE_ID}`, data_pattern: `datapkg:${PKG}`, purpose: 'Planning' } });
        assert(consent.status === 400 && consent.body.error?.code === 'INVALID_RECIPIENT', `the consent route too: ${show(consent)}`);
        const neither = await call('/v1/parties/share', { token: alice.token, body: { package: PKG, purpose: 'Planning' } });
        assert(neither.status === 400, `neither name nor recipient: ${show(neither)}`);
    });

    await test('before any share, the visitor gets 403 NOT_SHARED on the private package', async () => {
        const r = await call(`/v1/datapackages/${alice.name}/${PKG}`, { token: visitorOne });
        assert(r.status === 403 && r.body.error?.code === 'NOT_SHARED', `no share yet: ${show(r)}`);
    });

    await test('the owner shares the private package with bob of home node one, by his home account', async () => {
        const r = await call('/v1/parties/share', { token: alice.token, body: { recipient: `${bobName}@${H1}`, display_name: 'Bob', package: PKG, purpose: 'Planning the routes', days: 30 } });
        assert(r.status === 201, `share: ${show(r)}`);
        const d = r.body.data;
        assert(d.recipient_kind === 'visitor' && d.recipient === `${bobName}@${H1}` && d.sign_in === 'ready' && d.key_shown === false, `answer: ${JSON.stringify({ k: d.recipient_kind, s: d.sign_in, key: d.key_shown })}`);
        assert(d.package_title === 'Towns private' && typeof d.say === 'string' && d.read?.odata_url?.includes(`/v1/odata/${alice.name}/${PKG}`), `facts: ${JSON.stringify(d.read)}`);
        assert(!('connection' in d) && !('party' in d), 'no party and no key file for a visitor');
        shareId = d.share.id;
        assert(d.share.recipient === `${bobName}@${H1}` && d.share.terms_required === false, `share view: ${JSON.stringify(d.share)}`);
    });

    await test('the visitor of home node one reads the descriptor, the rows, the CSV and the OData feed', async () => {
        const desc = await call(`/v1/datapackages/${alice.name}/${PKG}`, { token: visitorOne });
        assert(desc.status === 200 && desc.body.data?.descriptor?.name === PKG, `descriptor: ${show(desc)}`);
        const rows = await call(`/v1/datapackages/${alice.name}/${PKG}/rows/rows?limit=10`, { token: visitorOne });
        assert(rows.status === 200 && (rows.body.data?.rows ?? []).some((x: Body) => x.town === 'Kemi'), `rows: ${show(rows)}`);
        const csv = await call(`/v1/datapackages/${alice.name}/${PKG}/rows/rows?format=csv`, { token: visitorOne });
        assert(csv.status === 200 && /csv/.test(csv.type) && csv.text.includes('Kemi'), `csv: ${csv.status} ${csv.type}`);
        const feed = await call(`/v1/odata/${alice.name}/${PKG}/rows`, { token: visitorOne });
        assert(feed.status === 200 && (feed.body.value ?? []).some((x: Body) => x.town === 'Oulu'), `odata: ${show(feed)}`);
    });

    await test('a visitor of the same name from home node two gets 403 NOT_SHARED on every read', async () => {
        for (const path of [`/v1/datapackages/${alice.name}/${PKG}`, `/v1/datapackages/${alice.name}/${PKG}/rows/rows`, `/v1/odata/${alice.name}/${PKG}/rows`]) {
            const r = await call(path, { token: visitorTwo });
            const code = r.body.error?.code;
            assert(r.status === 403 && code === 'NOT_SHARED', `${path}: ${show(r)}`);
            assert(!r.text.includes('Kemi'), `no rows reached the other visitor at ${path}`);
        }
    });

    await test('the local account of the same name reaches nothing of the private package', async () => {
        for (const path of [`/v1/datapackages/${alice.name}/${PKG}`, `/v1/datapackages/${alice.name}/${PKG}/rows/rows`]) {
            const r = await call(path, { token: localBob.token });
            assert((r.status === 403 || r.status === 404) && !r.text.includes('Kemi'), `${path}: ${show(r)}`);
        }
    });

    await test('a members package admits the local account and never a visitor, shared nothing', async () => {
        const local = await call(`/v1/datapackages/${alice.name}/${MEMBERS_PKG}`, { token: localBob.token });
        assert(local.status === 200, `local member reads: ${show(local)}`);
        const visitor = await call(`/v1/datapackages/${alice.name}/${MEMBERS_PKG}`, { token: visitorOne });
        assert(visitor.status === 403 && visitor.body.error?.code === 'NOT_SHARED', `the visitor is no member: ${show(visitor)}`);
    });

    await test('the owner sees the share: in What others can see as a visitor share, and in the product list', async () => {
        const ex = await call('/v1/exposure/mine', { token: alice.token });
        const item = (ex.body.data?.items ?? []).find((i: Body) => i.kind === 'named_share' && i.id === shareId);
        assert(item?.share?.party_kind === 'visitor' && item.share.party === `${bobName}@${H1}` && item.share.party_name === 'Bob', `exposure: ${JSON.stringify(item)}`);
        const list = await call('/v1/dataproducts', { token: alice.token });
        const row = (list.body.data?.products ?? []).find((p: Body) => p.name === PKG);
        assert(row?.shares === 1, `list counts it: ${JSON.stringify(row)}`);
        const one = await call(`/v1/dataproducts/${PKG}`, { token: alice.token });
        const vs = one.body.data?.visitor_shares ?? [];
        assert(vs.length === 1 && vs[0].recipient === `${bobName}@${H1}` && vs[0].display_name === 'Bob' && vs[0].reads_7d >= 0, `the product's page lists it: ${JSON.stringify(vs)}`);
    });

    await test('the library: the visitor\'s "Shared with you" lists exactly the shared package; the namesake of home node two sees none (WP11)', async () => {
        const one = await call('/v1/catalogue/knowledge?reach=shared', { token: visitorOne });
        assert(one.status === 200, `visitor one: ${show(one)}`);
        const names = (one.body.data?.packages ?? []).map((p: Body) => p.datapackage?.name);
        assert(names.length === 1 && names[0] === PKG, `visitor one lists only the shared package: ${JSON.stringify(names)}`);
        const row = one.body.data.packages[0];
        assert(row.why?.kind === 'share' && row.why.share_id === shareId && row.why.by === alice.name && typeof row.why.expires === 'string', `the row says why: ${JSON.stringify(row.why)}`);
        assert(!names.includes(MEMBERS_PKG), 'a members package is never shared with a visitor');
        const two = await call('/v1/catalogue/knowledge?reach=shared', { token: visitorTwo });
        assert(two.status === 200 && (two.body.data?.packages ?? []).length === 0, `visitor two lists nothing: ${show(two)}`);
    });

    await test('ending the share refuses the visitor\'s next read with SHARE_ENDED', async () => {
        const del = await call(`/v1/consent/${shareId}`, { token: alice.token, method: 'DELETE' });
        assert(del.status === 200, `revoke: ${show(del)}`);
        const r = await call(`/v1/datapackages/${alice.name}/${PKG}/rows/rows`, { token: visitorOne });
        assert(r.status === 403 && r.body.error?.code === 'SHARE_ENDED', `after the end: ${show(r)}`);
    });
}

await main();
for (const h of homes) h.close();
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
