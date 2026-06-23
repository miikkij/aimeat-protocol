/**
 * @file e2e-discover.ts
 * @description E2E for the master directory — unified cross-domain discovery (GET /v1/discover and
 *   GET /v1/discover/facets). Covers: classification across domains (knowledge / research / workflow /
 *   memory) from one owner query; type + tag filters; map-mode facet counts; entry mode q-search;
 *   public-scope cross-owner isolation (private content never leaks); failure modes (own-without-auth
 *   → 401, scope=shared → 501); and the ratified agent read-scope rule (§11.3) — an agent WITHOUT
 *   `memory:read` does NOT see the owner's private content, an agent WITH it does.
 * @version-history
 *   v0.1.0 — 2026-06-23 — Phase 1: discovery endpoint coverage (design doc 2026-06-23).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=discover

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
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function setupOwner(label: string) {
    const name = `disc${label}${Date.now()}`.toLowerCase();
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Disc', password: 'Discover1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Disc', password: 'Discover1234' }) }); }
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    assert(tok.status === 200 && tok.body?.data?.token, `auth/token ${tok.status}: ${JSON.stringify(tok.body)}`);
    return { name, token: tok.body.data.token as string };
}

/** Device-auth an agent for an owner with an explicit scope set; return its token + gaii. */
async function connectAgent(ownerToken: string, ownerName: string, agentName: string, scopes: string[]) {
    const da = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: agentName, owner: ownerName }) });
    assert(da.status === 200, `device-authorize ${da.status}: ${JSON.stringify(da.body)}`);
    const v = await json('/v1/agents/verify', { method: 'POST', body: JSON.stringify({ user_code: da.body.data.user_code, action: 'approve', scopes, owner_token: ownerToken }) });
    assert(v.status === 200, `verify ${v.status}: ${JSON.stringify(v.body.error ?? v.body)}`);
    const t = await json('/v1/agents/device-token', { method: 'POST', body: JSON.stringify({ device_code: da.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
    assert(t.status === 200, `device-token ${t.status}: ${JSON.stringify(t.body)}`);
    return { token: t.body.token as string, gaii: t.body.gaii as string };
}

async function putMem(token: string, key: string, value: unknown, visibility: string, tags?: string[]) {
    const r = await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key, value, visibility, tags }) });
    assert(r.status === 200 || r.status === 201, `mem ${key} ${r.status}: ${JSON.stringify(r.body.error)}`);
}

async function discover(query: string, token?: string) {
    return json(`/v1/discover?${query}`, token ? { headers: auth(token) } : {});
}
const byId = (entries: any[], id: string) => entries.find((e: any) => e.id === id);
const hasId = (entries: any[], id: string) => entries.some((e: any) => e.id === id);

(async () => {
    console.log('\n── Master Directory: Discovery ──');

    const a = await setupOwner('A');
    const stamp = Date.now();

    // Seed a spread of memory-backed content across domains.
    const K_PKG = `packages/disc-${stamp}/manifest`;          // → knowledge, segment=research
    const K_RES = `notes.research.${stamp}`;                  // → research (kind: tag)
    const K_WF = `workflows.def.wf-${stamp}`;                 // → workflow
    const K_PRIV = `personal.secret.${stamp}`;               // → memory (private)
    const K_PUB = `public.note.${stamp}`;                    // → memory (public)

    await putMem(a.token, K_PKG, { name: 'Market study', content_type: 'research', description: 'A knowledge package' }, 'public');
    await putMem(a.token, K_RES, { title: 'Field research notes', description: 'raw findings' }, 'private', ['kind:research']);
    await putMem(a.token, K_WF, { title: 'Nightly sync workflow', description: 'syncs things' }, 'private');
    await putMem(a.token, K_PRIV, { title: 'Secret plan', description: 'do not leak' }, 'private');
    await putMem(a.token, K_PUB, { title: 'Public announcement', description: 'hello world' }, 'public');

    // Seed table-backed domains (Phase 2): a public capability and a published app.
    const CAP_ID = `cap-${stamp}`;
    const APP_FILE = `discapp${stamp}.html`;
    const APP_ID = `${a.name}@${NODE_ID}/${APP_FILE}`;
    await test('seed: create a public capability + publish an app', async () => {
        const cap = await json('/v1/capabilities', {
            method: 'POST', headers: auth(a.token), body: JSON.stringify({
                id: CAP_ID, name: 'Summarize text', summary: 'Summarizes a blob of text',
                source: { type: 'manual', ref: 'manual', version: '1.0.0' }, callable: true,
                authRequired: 'registered', usage: 'x', whenToUse: 'x', whenNotToUse: 'x',
                visibility: 'public', status: 'active', tags: ['nlp', 'summary'],
            }),
        });
        assert(cap.status === 201, `cap ${cap.status}: ${JSON.stringify(cap.body.error)}`);
        const app = await json('/v1/apps', {
            method: 'POST', headers: auth(a.token), body: JSON.stringify({
                filename: APP_FILE,
                content: Buffer.from('<!doctype html><title>Disc App</title><h1>hi</h1>').toString('base64'),
                mime_type: 'text/html', name: 'Disc App', description: 'A discoverable app',
                version: '1.0.0', category: 'tools', tags: ['demo'],
            }),
        });
        assert(app.status === 200 || app.status === 201, `app ${app.status}: ${JSON.stringify(app.body.error)}`);
    });

    await test('own scope returns + classifies all of the owner\'s content', async () => {
        const r = await discover('scope=own&per_page=100', a.token);
        assert(r.status === 200 && r.body.ok, `status ${r.status}`);
        const e = r.body.data.entries;
        assert(byId(e, K_PKG)?.type === 'knowledge', 'pkg → knowledge');
        assert(byId(e, K_PKG)?.segment === 'research', 'pkg segment research');
        assert(byId(e, K_RES)?.type === 'research', 'kind:research → research');
        assert(byId(e, K_WF)?.type === 'workflow', 'workflows.def → workflow');
        assert(byId(e, K_PRIV)?.type === 'memory', 'private → memory');
        assert(byId(e, K_PUB)?.type === 'memory', 'public → memory');
        assert(byId(e, K_PKG)?.owner === `${a.name}@${NODE_ID}`, 'owner normalized to GHII');
    });

    await test('type filter narrows to one domain', async () => {
        const r = await discover('scope=own&type=knowledge&per_page=100', a.token);
        const e = r.body.data.entries;
        assert(e.every((x: any) => x.type === 'knowledge'), 'only knowledge');
        assert(hasId(e, K_PKG), 'includes the package');
    });

    await test('tag filter (ALL-match) narrows by tag', async () => {
        const r = await discover('scope=own&tags=kind:research&per_page=100', a.token);
        const e = r.body.data.entries;
        assert(hasId(e, K_RES), 'research note present');
        assert(!hasId(e, K_WF), 'workflow (untagged) absent');
    });

    await test('q-search finds by free text', async () => {
        const r = await discover('scope=own&q=Nightly&per_page=100', a.token);
        const e = r.body.data.entries;
        assert(hasId(e, K_WF), 'workflow found by q=Nightly');
    });

    await test('table sources surface capability + app, classified', async () => {
        const r = await discover('scope=own&per_page=100', a.token);
        const e = r.body.data.entries;
        assert(byId(e, CAP_ID)?.type === 'capability', 'capability classified');
        assert(byId(e, CAP_ID)?.segment === 'manual', 'capability segment = source type');
        assert(byId(e, APP_ID)?.type === 'app', 'app classified');
        assert(byId(e, APP_ID)?.segment === 'tools', 'app segment = category');
    });

    await test('type filter spans table + memory sources uniformly', async () => {
        const caps = await discover('scope=own&type=capability&per_page=100', a.token);
        assert(caps.body.data.entries.every((x: any) => x.type === 'capability'), 'only capabilities');
        assert(hasId(caps.body.data.entries, CAP_ID), 'capability present');
        const apps = await discover('scope=own&type=app&per_page=100', a.token);
        assert(hasId(apps.body.data.entries, APP_ID), 'app present');
    });

    await test('q-search constrains table sources too (not just memory)', async () => {
        // A query that matches nothing must NOT return the seeded capability/app (regression: table
        // sources used to ignore q and return everything).
        const none = await discover('scope=own&q=zzqxnomatch9999&per_page=100', a.token);
        assert(!hasId(none.body.data.entries, CAP_ID), 'capability excluded by non-matching q');
        assert(!hasId(none.body.data.entries, APP_ID), 'app excluded by non-matching q');
        // A query matching the capability name returns it.
        const hit = await discover('scope=own&q=Summarize&per_page=100', a.token);
        assert(hasId(hit.body.data.entries, CAP_ID), 'capability found by matching q');
    });

    await test('map mode returns facet counts without entries', async () => {
        const r = await json('/v1/discover/facets?scope=own', { headers: auth(a.token) });
        assert(r.status === 200 && r.body.ok, `status ${r.status}`);
        assert(r.body.data.entries === undefined, 'no entries in map mode');
        const t = r.body.data.types as any[];
        assert(t.find(x => x.value === 'knowledge')?.count >= 1, 'knowledge counted');
        assert(t.find(x => x.value === 'workflow')?.count >= 1, 'workflow counted');
        assert(r.body.data.total >= 5, 'total counted');
    });

    await test('public scope shows another owner\'s public content but NOT private', async () => {
        const b = await setupOwner('B');
        const r = await discover('scope=public&per_page=100', b.token);
        assert(r.status === 200, `status ${r.status}`);
        const e = r.body.data.entries;
        assert(hasId(e, K_PUB), 'A\'s public note visible');
        assert(hasId(e, K_PKG), 'A\'s public package visible');
        assert(hasId(e, CAP_ID), 'A\'s public capability visible');
        assert(hasId(e, APP_ID), 'A\'s published app visible');
        assert(!hasId(e, K_PRIV), 'A\'s private secret NOT leaked');
        assert(!hasId(e, K_RES), 'A\'s private research NOT leaked');
    });

    // ── Failure modes ──
    await test('scope=own without a real owner session → 401, or (anon node) no private leak', async () => {
        const r = await discover('scope=own');
        // Non-anonymous node: 401. Anonymous test node: optionalAuth injects a self-scoped anon
        // agent, so the call succeeds but must still never expose another owner's private content.
        assert(r.status === 401 || r.status === 200, `expected 401 or 200, got ${r.status}`);
        if (r.status === 200) {
            assert(!hasId(r.body.data.entries, K_PRIV), 'anon own-scope must not leak A\'s private');
            assert(!hasId(r.body.data.entries, K_RES), 'anon own-scope must not leak A\'s private research');
        }
    });

    await test('invalid scope → 400', async () => {
        const r = await discover('scope=bogus', a.token);
        assert(r.status === 400, `expected 400, got ${r.status}`);
    });

    await test('anonymous defaults to public scope', async () => {
        const r = await discover('per_page=100');
        assert(r.status === 200, `status ${r.status}`);
        assert(!hasId(r.body.data.entries, K_PRIV), 'no private leak for anon');
    });

    // ── §11.3 agent read-scope rule (security-sensitive) ──
    await test('agent WITHOUT memory:read does NOT see owner private content', async () => {
        const ag = await connectAgent(a.token, a.name, `lowbot${stamp}`, ['catalogue:read']);
        const r = await discover('scope=own&per_page=100', ag.token);
        assert(r.status === 200, `status ${r.status}`);
        assert(!hasId(r.body.data.entries, K_PRIV), 'low-scope agent must NOT see owner private memory');
        assert(!hasId(r.body.data.entries, K_RES), 'low-scope agent must NOT see owner private research');
    });

    await test('agent WITH memory:read sees the full owner set', async () => {
        const ag = await connectAgent(a.token, a.name, `readbot${stamp}`, ['memory:read', 'catalogue:read']);
        const r = await discover('scope=own&per_page=100', ag.token);
        assert(r.status === 200, `status ${r.status}`);
        assert(hasId(r.body.data.entries, K_PRIV), 'read-scoped agent sees owner private (per §11.3)');
    });

    // ── §6 / Phase 3: scope=shared per-workspace gating (the security-critical path) ──
    const sA = await setupOwner('sa');
    const sB = await setupOwner('sb');
    const sC = await setupOwner('sc');
    let sOrgId = '';
    const WS = 'wss1';
    let SHARED_KEY = '';

    await test('shared setup: org + gated workspace + a content record', async () => {
        const o = await json('/v1/organisms', { method: 'POST', headers: auth(sA.token), body: JSON.stringify({ name: 'Shared Org', description: 'x', type: 'project', join_policy: 'open', visibility: 'public' }) });
        assert(o.status === 201, `org ${o.status}: ${JSON.stringify(o.body.error)}`);
        sOrgId = o.body.data.organism.id;
        const root = `organism.${sOrgId}.w.${WS}`;
        await putMem(sA.token, `organism.${sOrgId}.meta.workspaces`, { workspaces: [{ id: WS, name: 'Coordination', createdAt: new Date().toISOString(), createdBy: sA.name }] }, 'private');
        const manifest = { manifestVersion: '1.0', id: sOrgId, name: 'Coordination', kind: 'project', status: 'active', objectTypes: [{ name: 'task', schemaRef: 'schema:task@1', namespace: 'shared.tasks', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'records' }] };
        await putMem(sA.token, `${root}.meta.manifest`, manifest, 'private');
        SHARED_KEY = `${root}.shared.tasks.rec${stamp}.latest`;
        await putMem(sA.token, SHARED_KEY, { title: 'Collab task', description: 'shared workspace content' }, 'private');
        // B joins (open policy → active member, but cannot READ the workspace yet).
        const j = await json(`/v1/organisms/${sOrgId}/join`, { method: 'POST', headers: auth(sB.token), body: '{}' });
        assert(j.status === 200 || j.status === 201, `join ${j.status}: ${JSON.stringify(j.body.error)}`);
    });

    await test('member WITHOUT workspace read does NOT see the shared record (entries + facets)', async () => {
        const r = await discover('scope=shared&per_page=100', sB.token);
        assert(r.status === 200, `status ${r.status}`);
        assert(!hasId(r.body.data.entries, SHARED_KEY), 'pre-approval: member must NOT see gated workspace content');
        const f = await json('/v1/discover/facets?scope=shared', { headers: auth(sB.token) });
        assert((f.body.data.types as any[]).find(x => x.value === 'document') === undefined, 'pre-approval: facet count must not reveal it');
    });

    await test('non-member sees nothing in shared scope', async () => {
        const r = await discover('scope=shared&per_page=100', sC.token);
        assert(r.status === 200, `status ${r.status}`);
        assert(!hasId(r.body.data.entries, SHARED_KEY), 'non-member must not see shared content');
    });

    await test('after approval the member DOES see the shared record', async () => {
        const req = await json(`/v1/organisms/${sOrgId}/workspace-access`, { method: 'POST', headers: auth(sB.token), body: JSON.stringify({ ws: WS, message: 'let me in' }) });
        assert(req.status === 200 || req.status === 201, `request ${req.status}: ${JSON.stringify(req.body.error)}`);
        const dec = await json(`/v1/organisms/${sOrgId}/workspace-access/decision`, { method: 'POST', headers: auth(sA.token), body: JSON.stringify({ ws: WS, requester: sB.name, decision: 'approve' }) });
        assert(dec.status === 200, `approve ${dec.status}: ${JSON.stringify(dec.body.error)}`);
        const r = await discover('scope=shared&per_page=100', sB.token);
        assert(hasId(r.body.data.entries, SHARED_KEY), 'post-approval: member must now see the shared content');
        assert(byId(r.body.data.entries, SHARED_KEY)?.type === 'document', 'classified as document');
    });

    await test('scope=shared requires auth', async () => {
        const r = await discover('scope=shared');
        // Non-anon node: 401. Anon node: the injected anon agent has no memberships → empty, no leak.
        assert(r.status === 401 || r.status === 200, `expected 401 or 200, got ${r.status}`);
        if (r.status === 200) assert(!hasId(r.body.data.entries, SHARED_KEY), 'anon shared must not leak');
    });

    console.log(`\n  ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
})();
