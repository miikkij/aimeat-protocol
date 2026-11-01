/**
 * @file e2e-datapackage-audience-fixes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for three defects in data packages (plan doc-mvwxcas3dom3, D0.1, D0.3, D0.4; D0.2
 *   is asserted in e2e-exposure-report.ts). Owner A makes an organism, B joins it, C does not.
 *
 *   D0.1 The ODPS sheet tells the real access. GET /v1/datapackages/{owner}/{name} names `odps_url`,
 *     and the sheet there is projected at read time from the version's audience: a public package says
 *     visibility public and authenticationMethod none; a members, organism or private package says
 *     dataspace, organisation or private, authenticationMethod Token, the AIMEAT audience under
 *     x-aimeat.audience, and no "No authentication" text. The sheet's stored address under /v1/pub
 *     answers the same projection. A reader the audience does not admit gets 404.
 *   D0.3 A package is withdrawn with DELETE /v1/datapackages/{owner}/{name}: anonymous 401, another
 *     owner 403, the owner's agent without storage:write 403, all before any write. After it the
 *     descriptor, the rows, the versions, the OData feed and the /v1/pub files answer 410 to a reader
 *     the audience admits, the package leaves the public catalogue, the owner's list says withdrawn,
 *     and a new publish restores it. `?purge=true` deletes the files and the pointer. The MCP tool
 *     aimeat_datapackage_withdraw withdraws as the route does.
 *   D0.4 An organism package is read through /v1/pub as a Frictionless client reads it: B (a member)
 *     reads the descriptor and then the CSV at the path the descriptor names; C and the anonymous
 *     caller are refused.
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D0.1, D0.3, D0.4).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=datapackage-audience-fixes

import { parse as parseYaml } from 'yaml';
import { ownerSignIn } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpAgent } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
async function call(path: string, opts: { token?: string; body?: unknown; method?: string; redirect?: RequestRedirect } = {}): Promise<{ status: number; body: Body; text: string; type: string }> {
    const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
    const res = await fetch(BASE + path, {
        method, redirect: opts.redirect ?? 'follow',
        headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    const type = res.headers.get('content-type') ?? '';
    let body: Body = { _raw: text };
    if (type.includes('json')) { try { body = JSON.parse(text) as Body; } catch { /* a non-JSON body stays raw */ } }
    return { status: res.status, body, text, type };
}
const show = (r: { status: number; text: string }) => `${r.status} ${r.text.slice(0, 300)}`;
/** The path part of an absolute address the node answered, so the request goes to this test's server. */
const pathOf = (url: string) => { const u = new URL(url); return u.pathname + u.search; };
const stamp = Date.now() % 10_000_000;

async function mkOwner(label: string) {
    const name = `dfx${label}${stamp}`;
    let reg = await call('/v1/ghii', { body: { username: name, display_name: name, password: 'Dfx12345!' } });
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await call('/v1/ghii', { body: { username: name, display_name: name, password: 'Dfx12345!' } }); }
    assert(reg.status === 201, `ghii ${name}: ${show(reg)}`);
    const tk = await ownerSignIn(BASE, name, 'Dfx12345!');
    return { name, token: tk.body.data.token as string };
}
const publishData = (token: string, name: string, visibility: string, label = 'one') => call('/v1/datapackages', {
    token, body: { name, changes: `first ${label}`, visibility, resources: [{ name: 'items', rows: [{ id: 1, label }, { id: 2, label: 'two' }] }] },
});

console.log('\n=== AIMEAT data package audience fixes E2E ===\n');
let A = { name: '', token: '' }, B = { name: '', token: '' }, C = { name: '', token: '' };
let orgId = '';
let readAgent!: McpAgent, writeAgent!: McpAgent;
const P = {
    pub: `dfxpub${stamp}`, members: `dfxmem${stamp}`, org: `dfxorg${stamp}`, priv: `dfxpriv${stamp}`,
    gone: `dfxgone${stamp}`, purge: `dfxpurge${stamp}`, mcp: `dfxmcp${stamp}`,
};
const descriptorUrls: Record<string, string> = {};

await test('Setup: A makes an organism, B joins it, C stays outside; A publishes a package at each audience', async () => {
    A = await mkOwner('a'); B = await mkOwner('b'); C = await mkOwner('c');
    const org = await call('/v1/organisms', { token: A.token, body: { name: `Dfx Org ${stamp}`, type: 'project', join_policy: 'open', visibility: 'public' } });
    assert(org.status === 201, `organism: ${show(org)}`);
    orgId = org.body.data.organism.id;
    const j = await call(`/v1/organisms/${orgId}/join`, { token: B.token, body: {} });
    assert(j.status === 200 || j.status === 201, `join: ${show(j)}`);
    for (const [name, visibility] of [
        [P.pub, 'public'], [P.members, 'members'], [P.org, `organism:${orgId}`], [P.priv, 'private'],
        [P.gone, 'public'], [P.purge, 'members'], [P.mcp, `organism:${orgId}`],
    ] as const) {
        const r = await publishData(A.token, name, visibility);
        assert(r.status === 201, `publish ${name}: ${show(r)}`);
        descriptorUrls[name] = r.body.data.descriptor_url;
    }
    readAgent = await makeAgent(BASE, A, ['storage:read']);
    writeAgent = await makeAgent(BASE, A, ['storage:read', 'storage:write']);
});

// ── D0.1 The ODPS sheet tells the real access ──────────────────────────────────────────────────────
console.log('\nD0.1 The ODPS sheet');

/** The sheet of one package as `token` reads it, through the odps_url the descriptor read names. */
async function sheetOf(name: string, token?: string): Promise<{ doc: Body; yaml: string }> {
    const d = await call(`/v1/datapackages/${A.name}/${name}`, { token });
    assert(d.status === 200, `descriptor ${name}: ${show(d)}`);
    const url = d.body.data.odps_url;
    assert(typeof url === 'string' && url.includes('/odps'), `the descriptor read names no odps_url: ${show(d)}`);
    const s = await call(pathOf(url), { token });
    assert(s.status === 200, `sheet ${name}: ${show(s)}`);
    assert(s.type.includes('yaml'), `the sheet is not YAML: ${s.type}`);
    return { doc: parseYaml(s.text) as Body, yaml: s.text };
}
const ports = (doc: Body) => Object.values(doc.product.dataAccess) as Body[];

await test('D0.1a A public package\'s sheet says public and no authentication', async () => {
    const { doc } = await sheetOf(P.pub);
    assert(doc.product.details.en.visibility === 'public', `visibility ${doc.product.details.en.visibility}`);
    assert(ports(doc).every(p => p.authenticationMethod === 'none'), `ports ${JSON.stringify(ports(doc))}`);
    assert(doc.product['x-aimeat'].audience === 'public', `x-aimeat.audience ${doc.product['x-aimeat'].audience}`);
});

await test('D0.1b A members, an organism and a private package\'s sheet each say who reads it and that a token is needed', async () => {
    for (const [name, token, visibility, audience] of [
        [P.members, C.token, 'dataspace', 'members'],
        [P.org, B.token, 'organisation', `organism:${orgId}`],
        [P.priv, A.token, 'private', 'private'],
    ] as const) {
        const { doc, yaml } = await sheetOf(name, token);
        assert(doc.product.details.en.visibility === visibility, `${name}: visibility ${doc.product.details.en.visibility}, expected ${visibility}`);
        assert(ports(doc).every(p => p.authenticationMethod === 'Token'), `${name}: ports ${JSON.stringify(ports(doc))}`);
        assert(doc.product['x-aimeat'].audience === audience, `${name}: x-aimeat.audience ${doc.product['x-aimeat'].audience}`);
        assert(!/No authentication/i.test(yaml), `${name}: the sheet still says "No authentication"`);
    }
});

await test('D0.1c The sheet\'s stored address under /v1/pub answers the same projection, not the publish-time file', async () => {
    const odpsPath = pathOf(descriptorUrls[P.org]).replace(/datapackage\.json$/, 'odps.yaml');
    const s = await call(odpsPath, { token: B.token });
    assert(s.status === 200, `B reads the sheet at its file address: ${show(s)}`);
    const doc = parseYaml(s.text) as Body;
    assert(doc.product.details.en.visibility === 'organisation', `visibility at the file address: ${doc.product.details.en.visibility}`);
    assert(!/No authentication/i.test(s.text), 'the file address still says "No authentication"');
});

await test('D0.1d A reader the audience does not admit gets 404 for the sheet', async () => {
    const d = await call(`/v1/datapackages/${A.name}/${P.org}`, { token: B.token });
    const url = d.body.data?.odps_url as string;
    assert(url, `no odps_url: ${show(d)}`);
    const c = await call(pathOf(url), { token: C.token });
    assert(c.status === 404, `C reads the organism sheet: ${show(c)}`);
    const anon = await call(pathOf(url));
    assert(anon.status === 404, `anonymous reads the organism sheet: ${show(anon)}`);
});

// ── D0.4 An organism package through /v1/pub ───────────────────────────────────────────────────────
console.log('\nD0.4 An organism package through /v1/pub');

await test('D0.4a B (a member) reads the descriptor at /v1/pub and the CSV at the path the descriptor names', async () => {
    const dPath = pathOf(descriptorUrls[P.org]);
    const d = await call(dPath, { token: B.token });
    assert(d.status === 200, `B descriptor at /v1/pub: ${show(d)}`);
    const descriptor = JSON.parse(d.text) as Body;
    const csvPath = dPath.replace(/datapackage\.json$/, '') + descriptor.resources[0].path;
    const csv = await call(csvPath, { token: B.token });
    assert(csv.status === 200 && csv.text.includes('one'), `B CSV at /v1/pub: ${show(csv)}`);
});

await test('D0.4b C (outside the organism) and the anonymous caller are refused the descriptor and the CSV', async () => {
    const dPath = pathOf(descriptorUrls[P.org]);
    const csvPath = dPath.replace(/datapackage\.json$/, 'data/items.csv');
    for (const p of [dPath, csvPath]) {
        const c = await call(p, { token: C.token });
        assert(c.status === 403 || c.status === 404, `C reads ${p}: ${show(c)}`);
        assert(!c.text.includes('"label"') && !c.text.includes(',one'), `C got bytes of ${p}`);
        const anon = await call(p);
        assert(anon.status === 404, `anonymous reads ${p}: ${show(anon)}`);
    }
});

await test('D0.4c A members package\'s CSV opens for another account through /v1/pub and not for the anonymous caller', async () => {
    const csvPath = pathOf(descriptorUrls[P.members]).replace(/datapackage\.json$/, 'data/items.csv');
    const c = await call(csvPath, { token: C.token });
    assert(c.status === 200 && c.text.includes('one'), `C reads the members CSV: ${show(c)}`);
    const anon = await call(csvPath);
    assert(anon.status === 404, `anonymous reads the members CSV: ${show(anon)}`);
});

await test('D0.4d A private file the owner put by hand inside an organism package\'s folder stays closed to the members', async () => {
    const dPath = pathOf(descriptorUrls[P.org]);
    const ownerSeg = dPath.split('/')[3];
    const key = decodeURIComponent(dPath.split('/').slice(4).join('/')).replace(/datapackage\.json$/, 'notes.txt');
    const up = await call('/v1/storage', { token: A.token, body: { key, data: Buffer.from('hand-placed secret').toString('base64'), mime_type: 'text/plain', visibility: 'private' } });
    assert(up.status === 201, `upload: ${show(up)}`);
    const b = await call(`/v1/pub/${ownerSeg}/${key}`, { token: B.token });
    assert(b.status === 403 && !b.text.includes('hand-placed secret'), `a member read a file the package did not publish: ${show(b)}`);
    await call(`/v1/storage/${key}`, { method: 'DELETE', token: A.token });
});

// ── D0.3 Withdrawing a package ─────────────────────────────────────────────────────────────────────
console.log('\nD0.3 Withdrawing a package');

await test('D0.3a The refusals come before any write: anonymous 401, another owner 403, the owner\'s agent without storage:write 403', async () => {
    const anon = await call(`/v1/datapackages/${A.name}/${P.gone}`, { method: 'DELETE' });
    assert(anon.status === 401, `anonymous: ${show(anon)}`);
    const c = await call(`/v1/datapackages/${A.name}/${P.gone}`, { method: 'DELETE', token: C.token });
    assert(c.status === 403, `another owner: ${show(c)}`);
    const ag = await call(`/v1/datapackages/${A.name}/${P.gone}`, { method: 'DELETE', token: readAgent.token });
    assert(ag.status === 403 && ag.body.error?.code === 'SCOPE_DENIED', `agent without storage:write: ${show(ag)}`);
    const still = await call(`/v1/datapackages/${A.name}/${P.gone}`);
    assert(still.status === 200, `the package was touched by a refused withdrawal: ${show(still)}`);
    const missing = await call(`/v1/datapackages/${A.name}/dfxnosuch${stamp}`, { method: 'DELETE', token: A.token });
    assert(missing.status === 404, `a missing package: ${show(missing)}`);
});

await test('D0.3b The public package is in the public catalogue before the withdrawal (the control)', async () => {
    const cat = await call(`/v1/catalogue/knowledge?tags=${P.gone}&limit=50`);
    assert(cat.status === 200, `catalogue: ${show(cat)}`);
    const items = cat.body.data.items ?? cat.body.data.packages ?? [];
    assert(items.length === 1, `the public package is not listed: ${JSON.stringify(items)}`);
});

await test('D0.3c The owner\'s agent with storage:write withdraws it; every read answers 410 and the catalogue no longer lists it', async () => {
    const w = await call(`/v1/datapackages/${A.name}/${P.gone}`, { method: 'DELETE', token: writeAgent.token });
    assert(w.status === 200, `withdraw: ${show(w)}`);
    assert(w.body.data.status === 'withdrawn' && typeof w.body.data.withdrawn_at === 'string' && w.body.data.purged === false, `answer: ${show(w)}`);
    for (const p of [
        `/v1/datapackages/${A.name}/${P.gone}`, `/v1/datapackages/${A.name}/${P.gone}/rows/items`,
        `/v1/datapackages/${A.name}/${P.gone}/versions`, `/v1/datapackages/${A.name}/${P.gone}/odps`,
        `/v1/odata/${A.name}/${P.gone}`, `/v1/odata/${A.name}/${P.gone}/items`,
        pathOf(descriptorUrls[P.gone]), pathOf(descriptorUrls[P.gone]).replace(/datapackage\.json$/, 'data/items.csv'),
    ]) {
        const r = await call(p);
        assert(r.status === 410, `${p}: expected 410, got ${show(r)}`);
        assert(!r.text.includes(',one'), `${p}: the rows came back`);
    }
    const cat = await call(`/v1/catalogue/knowledge?tags=${P.gone}&limit=50`);
    const items = cat.body.data.items ?? cat.body.data.packages ?? [];
    assert(items.length === 0, `the withdrawn package is still in the catalogue: ${JSON.stringify(items)}`);
    const mine = await call('/v1/datapackages', { token: A.token });
    const entry = (mine.body.data.packages as Body[]).find(p => p.name === P.gone);
    assert(entry?.status === 'withdrawn' && entry.withdrawnAt, `the owner's list: ${JSON.stringify(entry)}`);
});

await test('D0.3d A withdrawn organism package answers 410 to a member and 404 to an outsider, so its existence does not leak', async () => {
    const w = await call(`/v1/datapackages/${A.name}/${P.org}`, { method: 'DELETE', token: A.token });
    assert(w.status === 200, `withdraw: ${show(w)}`);
    const b = await call(`/v1/datapackages/${A.name}/${P.org}`, { token: B.token });
    assert(b.status === 410 && b.body.error?.code === 'GONE', `member: ${show(b)}`);
    const c = await call(`/v1/datapackages/${A.name}/${P.org}`, { token: C.token });
    assert(c.status === 404, `outsider: ${show(c)}`);
    const anonPub = await call(pathOf(descriptorUrls[P.org]));
    assert(anonPub.status === 404, `anonymous at /v1/pub: ${show(anonPub)}`);
});

await test('D0.3e A new publish restores a withdrawn package', async () => {
    const r = await publishData(A.token, P.gone, 'public', 'again');
    assert(r.status === 201, `republish: ${show(r)}`);
    const d = await call(`/v1/datapackages/${A.name}/${P.gone}`);
    assert(d.status === 200, `read after republish: ${show(d)}`);
    const cat = await call(`/v1/catalogue/knowledge?tags=${P.gone}&limit=50`);
    assert((cat.body.data.items ?? cat.body.data.packages ?? []).length === 1, `the restored package is not in the catalogue: ${show(cat)}`);
});

await test('D0.3f ?purge=true deletes the files and the pointer', async () => {
    const w = await call(`/v1/datapackages/${A.name}/${P.purge}?purge=true`, { method: 'DELETE', token: A.token });
    assert(w.status === 200 && w.body.data.purged === true && w.body.data.files_deleted >= 3, `purge: ${show(w)}`);
    const d = await call(`/v1/datapackages/${A.name}/${P.purge}`, { token: A.token });
    assert(d.status === 404, `read after purge: ${show(d)}`);
    const f = await call(pathOf(descriptorUrls[P.purge]), { token: A.token });
    assert(f.status === 404, `file after purge: ${show(f)}`);
    const mine = await call('/v1/datapackages', { token: A.token });
    assert(!(mine.body.data.packages as Body[]).some(p => p.name === P.purge), 'the purged package is still in the owner\'s list');
});

await test('D0.3g aimeat_datapackage_withdraw withdraws as the route does; an agent without storage:write is refused', async () => {
    const weak = await openSession(BASE, readAgent.token, 'e2e-dfx-weak');
    const refused = await callTool(weak, 'aimeat_datapackage_withdraw', { ref: `pkg:${A.name}/${P.mcp}` });
    assert(refused.isError, `the agent without storage:write withdrew: ${refused.text.slice(0, 300)}`);
    const still = await call(`/v1/datapackages/${A.name}/${P.mcp}`, { token: B.token });
    assert(still.status === 200, `the refused call touched the package: ${show(still)}`);
    const session = await openSession(BASE, writeAgent.token, 'e2e-dfx');
    const r = await callTool(session, 'aimeat_datapackage_withdraw', { ref: `pkg:${A.name}/${P.mcp}` });
    assert(r.offered && !r.isError, `the tool refused: ${r.text.slice(0, 300)}`);
    assert(r.data.status === 'withdrawn', `tool answer: ${r.text.slice(0, 300)}`);
    const b = await call(`/v1/datapackages/${A.name}/${P.mcp}`, { token: B.token });
    assert(b.status === 410, `after the tool: ${show(b)}`);
    const exp = await callTool(session, 'aimeat_datapackage_export', { ref: `pkg:${A.name}/${P.mcp}`, resource: 'items', format: 'json' });
    assert(exp.isError && /GONE|withdrawn/i.test(exp.text), `export of a withdrawn package: ${exp.text.slice(0, 300)}`);
});

await test('Cleanup', async () => {
    for (const name of Object.values(P)) await call(`/v1/datapackages/${A.name}/${name}?purge=true`, { method: 'DELETE', token: A.token });
    if (orgId) await call(`/v1/organisms/${orgId}`, { method: 'DELETE', token: A.token });
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
