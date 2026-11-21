/**
 * @file e2e-mcp-appdev-pitfalls.ts
 * @description E2E for the learned appdev-pitfall KB MCP tools (AppDev KB Phase 4):
 *   aimeat_appdev_pitfall_report (upsert + mandatory model + share opt-in),
 *   aimeat_appdev_pitfall_list (own/platform/all merge with curated registry, pagination,
 *   facets, outdated filtering), aimeat_appdev_pitfall_delete (entry + manifest cleanup),
 *   the reserved-package guard on aimeat_knowledge_contribute, and cross-owner isolation
 *   (owner B sees A's SHARED entries in platform scope, never A's private ones).
 * @usage registered in test/run-e2e-ci.ts; run via the e2e harness
 *   (cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-appdev-pitfalls).
 * @version-history
 *   2026-11-21 — A free-text category files under the nearest fixed one with a tag and a warning,
 *     instead of a 400 (an earlier client's report keeps working).
 *   2026-11-15 — Audit M064, M065: owner B cannot delete A's shared entry; share=false withdraws it from B's platform list.
 *   v1.3.0 — 2026-11-08 — Every row's `open` is the call that opens it: the shared row's
 *     read_public with its owner, the own row's aimeat_memory_read (which then opens it), and the
 *     curated row's GET address.
 *   v1.2.0 — 2026-10-20 — The owner-scope learned entries read as the caller may: on
 *     aimeat_appdev_pitfall_list, GET /v1/appdev/pitfalls/index and /learned an agent without
 *     memory:read-as-owner lists no private entry of its owner or a sibling and keeps the sibling's
 *     owner-visibility one; an agent with the word and the owner in person list every entry
 *     (secaudit 2026-10, the v56 shape).
 *   v1.1.0 — 2026-09-13 — The list's hint names a door that opens a shared entry, the row carries the
 *     owner that door needs, and B reads A's shared body through it. A report and its list row carry
 *     verified_at / verified_version.
 *   v1.0.0 — 2026-07-19 — initial (AppDev KB Phase 4).
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

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

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { authorizeParams, mcpPkce, tokenParams } from './helpers/mcp-oauth-pkce.js';
import { ownerSignIn, registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession as openAgentSession, callTool as callAgentTool, type McpAgent } from './helpers/mcp-session.js';
import { PITFALL_CATEGORIES } from '../src/services/appdev/kb-quality.js';
const PITFALL_LIST_TEXT = PITFALL_CATEGORIES.join(', ');
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

function parseSSE(text: string): any[] {
    const messages: any[] = [];
    for (const evt of text.split('\n\n')) {
        let data = '';
        for (const line of evt.trim().split('\n')) {
            if (line.startsWith('data: ')) data += line.slice(6);
        }
        if (data) { try { messages.push(JSON.parse(data)); } catch { /* skip */ } }
    }
    return messages;
}

/** One MCP session (token + session id) so two owners can act independently. */
class McpSession {
    token = '';
    sessionId = '';
    private nextId = 1;

    async rpc(method: string, params: Record<string, any> = {}) {
        const id = this.nextId++;
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
                ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
                ...(this.sessionId ? { 'mcp-session-id': this.sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        });
        const sid = res.headers.get('mcp-session-id');
        if (sid) this.sessionId = sid;
        const ct = res.headers.get('content-type') ?? '';
        let body: any;
        if (ct.includes('text/event-stream')) {
            const messages = parseSSE(await res.text());
            body = messages.find(m => m.id === id) ?? messages[0] ?? {};
        } else {
            body = await res.json() as any;
        }
        return { status: res.status, body };
    }

    async call(name: string, args: Record<string, any>) {
        const { body } = await this.rpc('tools/call', { name, arguments: args });
        return body;
    }
}

/** Register owner + agent + mint an MCP OAuth token; returns a ready session. */
async function setupOwnerAgentSession(ownerName: string, agentName: string): Promise<McpSession> {
    const { status: gs, body: gb } = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: ownerName, display_name: ownerName, password: 'PitfallKb1!' }),
    });
    assert(gs === 201, `ghii ${gs}: ${JSON.stringify(gb).slice(0, 150)}`);

    const { body: tb } = await ownerSignIn(BASE, ownerName, 'PitfallKb1!');
    const ownerToken = tb.data.token;

    const { status: as, body: ab } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: agentName, owner: ownerName, capabilities: ['appdev'] }),
    });
    assert(as === 201, `agent ${as}: ${JSON.stringify(ab).slice(0, 150)}`);
    const agentGaii = ab.data.agent.gaii;
    const agentPrivKey = ab.data.private_key;

    const { body: reg } = await json('/v1/mcp/register', {
        method: 'POST',
        body: JSON.stringify({ client_name: `${ownerName} pitfall client`, redirect_uris: [] }),
    });
    const ts2 = new Date().toISOString();
    const pkce = mcpPkce(BASE);
    const params = new URLSearchParams({
        response_type: 'code', client_id: reg.client_id, gaii: agentGaii,
        signature: await signMsg(agentPrivKey, agentGaii + NODE_ID + ts2), timestamp: ts2,
        ...authorizeParams(pkce),
    });
    const { body: auth } = await json(`/v1/mcp/authorize?${params}`);
    const { body: tok } = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({ grant_type: 'authorization_code', code: auth.code, client_id: reg.client_id, client_secret: reg.client_secret, ...tokenParams(pkce) }),
    });
    const session = new McpSession();
    session.token = tok.access_token;
    await session.rpc('initialize', {
        protocolVersion: '2025-03-26', capabilities: {},
        clientInfo: { name: 'AppDev Pitfalls E2E', version: '1.0.0' },
    });
    return session;
}

console.log('\n=== AIMEAT MCP AppDev Pitfalls E2E Test ===\n');

const stamp = Date.now().toString().slice(-7);
let A: McpSession;
let B: McpSession;

await test('Setup: two owners with agents + MCP sessions', async () => {
    A = await setupOwnerAgentSession(`pfowna${stamp}`, 'pfagenta');
    B = await setupOwnerAgentSession(`pfownb${stamp}`, 'pfagentb');
});

await test('tools/list exposes the three pitfall tools', async () => {
    const { body } = await A.rpc('tools/list', {});
    const names = (body.result?.tools ?? []).map((t: any) => t.name);
    for (const n of ['aimeat_appdev_pitfall_report', 'aimeat_appdev_pitfall_list', 'aimeat_appdev_pitfall_delete']) {
        assert(names.includes(n), `${n} missing from tools/list`);
    }
});

await test('report: happy path creates a private entry with model attribution', async () => {
    const body = await A.call('aimeat_appdev_pitfall_report', {
        model: 'Claude-Haiku-4.5',
        category: 'auth',
        title: 'Silent login returns null on app origins',
        symptom: 'Custom sign-in button calling login() does nothing when SSO fails',
        resolution: 'Delegate the click to the mounted login bar button',
        applies_to: ['auth', 'app'],
        severity: 'critical',
    });
    assert(!body.result?.isError, `unexpected error: ${JSON.stringify(body).slice(0, 200)}`);
    const out = JSON.parse(body.result.content[0].text);
    assert(out.key === 'packages/appdev-pitfalls/auth/silent-login-returns-null-on-app-origins', `key: ${out.key}`);
    assert(out.shared === false && out.visibility === 'owner', 'entry should default private');
    assert(out.version === 1, `version: ${out.version}`);
    // A report is the check as well: it says when, and against which node version.
    assert(typeof out.verified_at === 'string' && typeof out.verified_version === 'string' && out.verified_version.length > 0,
        `report carries no verification stamp: ${JSON.stringify(out)}`);
    const listed = await A.call('aimeat_appdev_pitfall_list', { scope: 'own' });
    const row = JSON.parse(listed.result.content[0].text).pitfalls.find((p: any) => p.key === out.key);
    assert(row && row.verified_at === out.verified_at && row.verified_version === out.verified_version, `list row lacks the stamp: ${JSON.stringify(row)}`);
});

await test('report: missing model is rejected', async () => {
    const body = await A.call('aimeat_appdev_pitfall_report', {
        category: 'auth', title: 'No model here', symptom: 'something happened', resolution: 'do the thing',
    });
    assert(body.error !== undefined || body.result?.isError, `expected validation error, got: ${JSON.stringify(body).slice(0, 200)}`);
});

await test('report: upsert with explicit slug replaces the entry (version bumps)', async () => {
    const first = await A.call('aimeat_appdev_pitfall_report', {
        model: 'kimi-k2.6', category: 'realtime', slug: 'batching',
        title: 'Realtime WS rate limit', symptom: 'notes stop after a while', resolution: 'send one frame per event',
    });
    assert(JSON.parse(first.result.content[0].text).version === 1, 'v1 expected');
    const second = await A.call('aimeat_appdev_pitfall_report', {
        model: 'kimi-k2.6', category: 'realtime', slug: 'batching',
        title: 'Realtime WS rate limit — batch per tick', symptom: 'notes stop after a while',
        resolution: 'send ONE batched message per tick carrying all notes',
    });
    const out = JSON.parse(second.result.content[0].text);
    assert(out.updated === true && out.version === 2, `upsert failed: ${JSON.stringify(out)}`);
});

await test('list scope=own shows both entries with model facets', async () => {
    const body = await A.call('aimeat_appdev_pitfall_list', { scope: 'own' });
    const out = JSON.parse(body.result.content[0].text);
    assert(out.total === 2, `total: ${out.total}`);
    assert(out.facets.model['claude-haiku-4.5'] === 1 && out.facets.model['kimi-k2.6'] === 1, `facets: ${JSON.stringify(out.facets.model)}`);
    const titles = out.pitfalls.map((p: any) => p.title).join('|');
    assert(/batch per tick/.test(titles), 'upserted title not reflected');
});

await test('list ?model= filters learned entries', async () => {
    const body = await A.call('aimeat_appdev_pitfall_list', { scope: 'own', model: 'kimi-k2.6' });
    const out = JSON.parse(body.result.content[0].text);
    assert(out.total === 1 && out.pitfalls[0].model === 'kimi-k2.6', `model filter broke: ${JSON.stringify(out.pitfalls)}`);
});

await test('list scope=platform includes the curated registry', async () => {
    const body = await A.call('aimeat_appdev_pitfall_list', { scope: 'platform', limit: 100 });
    const out = JSON.parse(body.result.content[0].text);
    const curated = out.pitfalls.filter((p: any) => p.source === 'curated');
    assert(curated.length >= 20, `curated entries missing: ${curated.length}`);
    assert(curated.some((p: any) => p.id === 'login-is-silent-only'), 'known curated id missing');
    assert(out.facets.source.curated >= 20, 'source facet missing');
});

await test('knowledge_get reads the reserved package; knowledge_contribute to it is redirected', async () => {
    const get = await A.call('aimeat_knowledge_get', { package_id: 'appdev-pitfalls' });
    const pkg = JSON.parse(get.result.content[0].text);
    assert(pkg.entries.length === 2, `knowledge_get entries: ${pkg.entries.length}`);
    const contribute = await A.call('aimeat_knowledge_contribute', {
        package_id: 'appdev-pitfalls', entry_key: 'rogue', content: 'schema-less blob',
    });
    assert(contribute.result?.isError === true, 'reserved-package guard missing');
    assert(/aimeat_appdev_pitfall_report/.test(contribute.result.content[0].text), 'guard should redirect to the dedicated tool');
});

await test('share=true publishes an entry platform-wide; owner B sees it (and ONLY it)', async () => {
    const shared = await A.call('aimeat_appdev_pitfall_report', {
        model: 'claude-haiku-4.5', category: 'mobile', slug: 'keyboard-gap',
        title: 'Keyboard height double-counted', symptom: 'dead gap above keyboard',
        resolution: 'dvh already excludes the keyboard with resizes-content — never subtract it again',
        share: true,
    });
    const sharedOut = JSON.parse(shared.result.content[0].text);
    assert(sharedOut.shared === true && sharedOut.visibility === 'public', `share failed: ${JSON.stringify(sharedOut)}`);

    // B's own bubble is empty
    const own = await B.call('aimeat_appdev_pitfall_list', { scope: 'own' });
    assert(JSON.parse(own.result.content[0].text).total === 0, 'cross-owner leak into B own scope');

    // B's platform scope contains A's SHARED entry but not A's private ones
    const plat = await B.call('aimeat_appdev_pitfall_list', { scope: 'platform', limit: 100 });
    const platOut = JSON.parse(plat.result.content[0].text);
    const learnedShared = platOut.pitfalls.filter((p: any) => p.source === 'learned-shared');
    assert(learnedShared.some((p: any) => p.slug === 'keyboard-gap'), 'shared entry not visible to B');
    assert(!platOut.pitfalls.some((p: any) => p.slug === 'batching'), 'A private entry leaked to B');

    // The hint names the door that opens a shared entry, and the row carries what that door needs.
    assert(!/knowledge_get/.test(platOut.hint), `hint still names aimeat_knowledge_get: ${platOut.hint}`);
    const row = learnedShared.find((p: any) => p.slug === 'keyboard-gap');
    assert(typeof row.owner === 'string' && row.owner.length > 0, `shared row carries no owner: ${JSON.stringify(row)}`);
    const body = await B.call('aimeat_memory_read_public', { gaii: row.owner, key: row.key });
    const text = body.result?.content?.[0]?.text ?? '';
    assert(body.result?.isError !== true && /dvh already excludes the keyboard/.test(text),
        `the hinted door did not open the shared entry: ${text.slice(0, 200)}`);

    // Every row names the call that opens it (2026-11-08: a build read its OWN entry with the
    // shared-entry tool and got "not found", because the hint named both rules and no row said which).
    const sharedArgs = JSON.parse(String(row.open).replace(/^aimeat_memory_read_public /, ''));
    assert(String(row.open).startsWith('aimeat_memory_read_public ') && sharedArgs.gaii === row.owner && sharedArgs.key === row.key,
        `shared row's open is not its read_public call: ${row.open}`);
    const ownList = JSON.parse((await A.call('aimeat_appdev_pitfall_list', { scope: 'own', status: 'all', limit: 100 })).result.content[0].text);
    const ownRow = ownList.pitfalls.find((p: any) => p.source === 'learned');
    assert(ownRow && String(ownRow.open).startsWith('aimeat_memory_read '), `own row's open is not aimeat_memory_read: ${JSON.stringify(ownRow)}`);
    const ownBody = await A.call('aimeat_memory_read', JSON.parse(String(ownRow.open).replace(/^aimeat_memory_read /, '')));
    assert(ownBody.result?.isError !== true, `the own row's open call did not open it: ${ownBody.result?.content?.[0]?.text?.slice(0, 200)}`);
    const curated = platOut.pitfalls.find((p: any) => p.source === 'curated');
    assert(curated && /^GET https?:\/\/\S+\/v1\/appdev\/pitfalls\//.test(String(curated.open)), `curated row's open is not a GET address: ${JSON.stringify(curated)}`);
});

await test('owner B cannot delete the entry A shared, though B can read it', async () => {
    const del = await B.call('aimeat_appdev_pitfall_delete', { category: 'mobile', slug: 'keyboard-gap' });
    assert(del.result?.isError === true, `B deleted A's shared entry: ${JSON.stringify(del.result).slice(0, 200)}`);
    const own = JSON.parse((await A.call('aimeat_appdev_pitfall_list', { scope: 'own', status: 'all', limit: 100 })).result.content[0].text);
    assert(own.pitfalls.some((p: any) => p.slug === 'keyboard-gap'), 'A\'s shared entry is gone after B\'s delete');
});

await test('share=false withdraws the shared entry: gone from B\'s platform list, owner-only for A', async () => {
    const r = await A.call('aimeat_appdev_pitfall_report', {
        model: 'claude-haiku-4.5', category: 'mobile', slug: 'keyboard-gap',
        title: 'Keyboard height double-counted', symptom: 'dead gap above keyboard',
        resolution: 'dvh already excludes the keyboard with resizes-content — never subtract it again',
        share: false,
    });
    assert(r.result?.isError !== true, `re-report failed: ${r.result?.content?.[0]?.text?.slice(0, 200)}`);
    const plat = JSON.parse((await B.call('aimeat_appdev_pitfall_list', { scope: 'platform', limit: 100 })).result.content[0].text);
    assert(!plat.pitfalls.some((p: any) => p.slug === 'keyboard-gap'), 'the withdrawn entry is still in B\'s platform list');
    const own = JSON.parse((await A.call('aimeat_appdev_pitfall_list', { scope: 'own', status: 'all', limit: 100 })).result.content[0].text);
    const row = own.pitfalls.find((p: any) => p.slug === 'keyboard-gap');
    assert(row && row.source === 'learned' && row.shared === false, `A's own row: ${JSON.stringify(row)}`);
});

await test('status=outdated hides an entry from default lists (kept, retrievable)', async () => {
    await A.call('aimeat_appdev_pitfall_report', {
        model: 'kimi-k2.6', category: 'realtime', slug: 'batching',
        title: 'Realtime WS rate limit — batch per tick', symptom: 'notes stop after a while',
        resolution: 'send ONE batched message per tick carrying all notes',
        status: 'outdated',
    });
    const def = await A.call('aimeat_appdev_pitfall_list', { scope: 'own' });
    const defOut = JSON.parse(def.result.content[0].text);
    assert(!defOut.pitfalls.some((p: any) => p.slug === 'batching'), 'outdated entry still in default list');
    const all = await A.call('aimeat_appdev_pitfall_list', { scope: 'own', status: 'all' });
    assert(JSON.parse(all.result.content[0].text).pitfalls.some((p: any) => p.slug === 'batching'), 'outdated entry lost');
});

await test('pagination: limit/offset slice with stable total', async () => {
    const p1 = await A.call('aimeat_appdev_pitfall_list', { scope: 'all', limit: 2, offset: 0 });
    const p2 = await A.call('aimeat_appdev_pitfall_list', { scope: 'all', limit: 2, offset: 2 });
    const o1 = JSON.parse(p1.result.content[0].text);
    const o2 = JSON.parse(p2.result.content[0].text);
    assert(o1.pitfalls.length === 2 && o2.pitfalls.length === 2, 'page sizes wrong');
    assert(o1.total === o2.total && o1.total >= 20, `totals: ${o1.total}/${o2.total}`);
    const k1 = new Set(o1.pitfalls.map((p: any) => p.id ?? p.key));
    assert(o2.pitfalls.every((p: any) => !k1.has(p.id ?? p.key)), 'pages overlap');
});

await test('delete removes the entry and its manifest reference', async () => {
    const del = await A.call('aimeat_appdev_pitfall_delete', { category: 'auth', slug: 'silent-login-returns-null-on-app-origins' });
    assert(!del.result?.isError, `delete failed: ${JSON.stringify(del).slice(0, 200)}`);
    const own = await A.call('aimeat_appdev_pitfall_list', { scope: 'own', status: 'all' });
    assert(!JSON.parse(own.result.content[0].text).pitfalls.some((p: any) => p.category === 'auth'), 'entry still listed after delete');
    const pkg = await A.call('aimeat_knowledge_get', { package_id: 'appdev-pitfalls' });
    const manifest = JSON.parse(pkg.result.content[0].text).manifest;
    assert(!(manifest.entries ?? []).some((e: any) => e.key.includes('/auth/')), 'manifest ref not cleaned');
});

await test('aimeat_appdev_overview merges learned pitfalls + curated + packs in one call', async () => {
    const body = await A.call('aimeat_appdev_overview', { model: 'claude-haiku-4.5' });
    assert(!body.result?.isError, `overview errored: ${JSON.stringify(body).slice(0, 200)}`);
    const out = JSON.parse(body.result.content[0].text);
    assert(out.model === 'claude-haiku-4.5', 'model echo missing');
    assert(out.pitfalls_learned.items.some((p: any) => p.model === 'claude-haiku-4.5'), 'learned entry missing from overview');
    assert(out.pitfalls_learned.model_facets['claude-haiku-4.5'] >= 1, 'model facet missing');
    assert(out.pitfalls_curated.total >= 20, 'curated index missing');
    assert(/aimeat-app-builder/.test(out.skills.builder_skill), 'builder skill pointer missing');
});

await test('delete of a missing entry errors cleanly', async () => {
    const del = await A.call('aimeat_appdev_pitfall_delete', { category: 'nope', slug: 'missing' });
    assert(del.result?.isError === true, 'expected isError for missing entry');
});

// ── The owner-scope learned entries read as the caller may (secaudit 2026-10, the v56 shape) ──
// The index (MCP aimeat_appdev_pitfall_list, GET /v1/appdev/pitfalls/index) and the learned page
// (GET /v1/appdev/pitfalls/learned) read the owner's GHII and every agent of the owner with no
// visibility rule, so an agent without memory:read-as-owner listed its owner's and its siblings'
// private entries. Since 2026-10-15 those cost memory:read-as-owner.
const VS = `pfview${stamp}`;
const viewKeys = {
    ownerPriv: `packages/appdev-pitfalls/data/${VS}-owner-priv`,
    sibPriv: `packages/appdev-pitfalls/data/${VS}-sib-priv`,
    sibOwner: `packages/appdev-pitfalls/data/${VS}-sib-owner`,
};
let viewOwner: { name: string; token: string };
let viewPlain: McpAgent;
let viewAsOwner: McpAgent;

await test('Setup (view): the owner and a sibling keep private and owner-visibility learned entries', async () => {
    viewOwner = await registerOwner(BASE, `pfview${stamp}`);
    const sibling = await makeAgent(BASE, viewOwner, ['memory:read', 'memory:write'], `pfsib${stamp}`);
    viewPlain = await makeAgent(BASE, viewOwner, ['memory:read'], `pfplain${stamp}`);
    viewAsOwner = await makeAgent(BASE, viewOwner, ['memory:read', 'memory:read-as-owner'], `pfasown${stamp}`);
    const entry = (slug: string) => ({
        title: `View ${slug}`, symptom: `symptom of ${slug}`, resolution: `resolution of ${slug}`,
        model: 'goose', category: 'data', slug, applies_to: ['app'], severity: 'critical', status: 'active',
        reported_by: 'pitfall-view-e2e', created: new Date().toISOString(), updated: new Date().toISOString(),
    });
    const write = async (token: string, key: string, visibility: string) => {
        const { status, body } = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${token}` },
            body: JSON.stringify({ key, value: entry(key.split('/').pop()!), visibility, tags: ['knowledge-entry', 'pitfall', 'model:goose'] }),
        });
        // Every key here is new, so the write creates it.
        assert(status === 201, `seed ${key}: ${status} ${JSON.stringify(body?.error)}`);
    };
    await write(viewOwner.token, viewKeys.ownerPriv, 'private');
    await write(sibling.token, viewKeys.sibPriv, 'private');
    await write(sibling.token, viewKeys.sibOwner, 'owner');
});

const indexKeys = (d: any): string[] => (d?.pitfalls ?? []).map((p: any) => p.key).filter(Boolean);
const restIndex = async (token: string) => {
    const r = await json('/v1/appdev/pitfalls/index?scope=own&limit=100', { headers: { Authorization: `Bearer ${token}` } });
    assert(r.status === 200, `index ${r.status}: ${JSON.stringify(r.body?.error)}`);
    return indexKeys(r.body.data);
};
const restLearned = async (token: string) => {
    const r = await json('/v1/appdev/pitfalls/learned?limit=100', { headers: { Authorization: `Bearer ${token}` } });
    assert(r.status === 200, `learned ${r.status}: ${JSON.stringify(r.body?.error)}`);
    return indexKeys(r.body.data);
};
const mcpIndex = async (agent: McpAgent) => {
    const s = await openAgentSession(BASE, agent.token, 'pf-view');
    const r = await callAgentTool(s, 'aimeat_appdev_pitfall_list', { scope: 'own', limit: 100 });
    assert(!r.isError, `aimeat_appdev_pitfall_list: ${r.text.slice(0, 300)}`);
    return indexKeys(r.data);
};

await test('An agent without memory:read-as-owner lists no private entry of its owner or a sibling (MCP, /index, /learned)', async () => {
    for (const [door, keys] of [['MCP list', await mcpIndex(viewPlain)], ['GET /index', await restIndex(viewPlain.token)], ['GET /learned', await restLearned(viewPlain.token)]] as const) {
        assert(!keys.includes(viewKeys.ownerPriv) && !keys.includes(viewKeys.sibPriv), `${door} handed a plain agent a private entry: ${JSON.stringify(keys)}`);
        // A filter, not a ban: the sibling's owner-visibility entry stays.
        assert(keys.includes(viewKeys.sibOwner), `${door} lost the sibling's owner-visibility entry: ${JSON.stringify(keys)}`);
    }
});

await test('An agent holding memory:read-as-owner, and the owner in person, list every entry', async () => {
    const all = Object.values(viewKeys);
    for (const [who, keys] of [
        ['read-as-owner MCP', await mcpIndex(viewAsOwner)], ['read-as-owner /index', await restIndex(viewAsOwner.token)],
        ['read-as-owner /learned', await restLearned(viewAsOwner.token)],
        ['owner /index', await restIndex(viewOwner.token)], ['owner /learned', await restLearned(viewOwner.token)],
    ] as const) {
        for (const k of all) assert(keys.includes(k), `${who} lost ${k}: ${JSON.stringify(keys)}`);
    }
});

// ── The knowledge base stops only growing (services/appdev/kb-report.ts, kb-quality.ts, 2026-11-21) ──
// A report was matched to an existing entry only by its exact {category, slug}, so the production
// knowledge base held ten near-duplicate pairs and re-reports of retired entries; categories were free
// text; any reporter could file critical; one app's bugs sat in the shared list.

const reportText = (body: any): string => body.result?.content?.[0]?.text ?? JSON.stringify(body.error ?? body);
const reportOut = (body: any) => JSON.parse(body.result.content[0].text);

await test('report: a NEW entry close to an own one is refused with the match; confirm_new files it', async () => {
    const close = {
        model: 'claude-haiku-4.5', category: 'mobile', slug: 'keyboard-gap-again',
        title: 'Keyboard height double-counted on a phone', symptom: 'a dead gap above the keyboard',
        resolution: 'dvh already excludes the keyboard, so subtract nothing',
    };
    const refused = await A.call('aimeat_appdev_pitfall_report', close);
    const text = reportText(refused);
    assert(refused.result?.isError === true && /^SIMILAR_ENTRY:/.test(text), `expected SIMILAR_ENTRY, got: ${text.slice(0, 300)}`);
    assert(text.includes('packages/appdev-pitfalls/mobile/keyboard-gap'), `the match is not named: ${text.slice(0, 400)}`);
    assert(/"open": "aimeat_memory_read /.test(text), `the match carries no open call: ${text.slice(0, 600)}`);
    // Nothing was written by the refusal.
    const own = JSON.parse((await A.call('aimeat_appdev_pitfall_list', { scope: 'own', status: 'all', limit: 100 })).result.content[0].text);
    assert(!own.pitfalls.some((p: any) => p.slug === 'keyboard-gap-again'), 'a refused report was written');

    const filed = await A.call('aimeat_appdev_pitfall_report', { ...close, confirm_new: true });
    assert(filed.result?.isError !== true, `confirm_new was refused: ${reportText(filed).slice(0, 300)}`);
    assert(reportOut(filed).key === 'packages/appdev-pitfalls/mobile/keyboard-gap-again', 'confirm_new wrote the wrong key');
    // Updating that entry by its own {category, slug} is not a new entry and is not compared.
    const again = await A.call('aimeat_appdev_pitfall_report', { ...close, resolution: 'reworded resolution text' });
    assert(again.result?.isError !== true && reportOut(again).version === 2, `an update by its own slug was refused: ${reportText(again).slice(0, 300)}`);
});

await test('report: retired_by on outdated; supersedes the retired entry brings it back with a note', async () => {
    const retire = await A.call('aimeat_appdev_pitfall_report', {
        model: 'kimi-k2.6', category: 'realtime', slug: 'batching',
        title: 'Realtime WS rate limit — batch per tick', symptom: 'notes stop after a while',
        resolution: 'send ONE batched message per tick carrying all notes',
        status: 'outdated', retired_by: 'aimeat-realtime 2.4.0',
    });
    assert(retire.result?.isError !== true, `retire: ${reportText(retire).slice(0, 300)}`);
    const all = JSON.parse((await A.call('aimeat_appdev_pitfall_list', { scope: 'own', status: 'all', limit: 100 })).result.content[0].text);
    const row = all.pitfalls.find((p: any) => p.slug === 'batching');
    assert(row?.status === 'outdated' && row.retired_by === 'aimeat-realtime 2.4.0', `retired_by not on the row: ${JSON.stringify(row)}`);

    // A re-report of the retired entry without retired_by keeps what retired it (edge).
    const noReason = await A.call('aimeat_appdev_pitfall_report', {
        model: 'kimi-k2.6', category: 'realtime', slug: 'batching',
        title: 'Realtime WS rate limit — batch per tick', symptom: 'notes stop after a while',
        resolution: 'send ONE batched message per tick carrying all notes', status: 'outdated',
    });
    assert(!reportOut(noReason).warnings.some((w: string) => /retired_by/.test(w)), `retired_by lost on a re-report: ${reportText(noReason).slice(0, 300)}`);
    // Retiring an active entry without retired_by is answered with the question.
    const asked = await A.call('aimeat_appdev_pitfall_report', {
        model: 'claude-haiku-4.5', category: 'mobile', slug: 'keyboard-gap-again',
        title: 'Keyboard height double-counted on a phone', symptom: 'a dead gap above the keyboard',
        resolution: 'reworded resolution text', status: 'outdated',
    });
    assert(reportOut(asked).warnings.some((w: string) => /retired_by/.test(w)), `no retired_by warning: ${reportText(asked).slice(0, 300)}`);

    const back = await A.call('aimeat_appdev_pitfall_report', {
        model: 'kimi-k2.6', category: 'realtime', slug: 'rate-limit-returns',
        title: 'The realtime rate limit still drops notes', symptom: 'notes stop after a while on a busy board',
        resolution: 'batch per tick still', supersedes: 'realtime/batching',
        evidence: 'steps: open two tabs, play 40 notes a second', seen_version: '4.3.1',
    });
    assert(back.result?.isError !== true, `supersedes: ${reportText(back).slice(0, 300)}`);
    const out = reportOut(back);
    assert(out.key === 'packages/appdev-pitfalls/realtime/batching' && out.updated === true, `an own entry is updated in place: ${JSON.stringify(out)}`);
    assert(out.reactivated === true && out.warnings.some((w: string) => /outdated \(retired by aimeat-realtime 2\.4\.0\)/.test(w)), `no reactivation note: ${JSON.stringify(out)}`);
    assert(!out.warnings.some((w: string) => /^Add (evidence|seen_version)/.test(w)), `evidence was given and still asked for: ${JSON.stringify(out.warnings)}`);

    const missing = await A.call('aimeat_appdev_pitfall_report', {
        model: 'kimi-k2.6', category: 'realtime', title: 'Anything at all here', symptom: 'some symptom', resolution: 'some fix',
        supersedes: 'realtime/no-such-entry',
    });
    assert(missing.result?.isError === true && /^NOT_FOUND:/.test(reportText(missing)), `unknown supersedes: ${reportText(missing).slice(0, 200)}`);
});

await test('report: category from the fixed list; critical waits for a curator; evidence is asked for', async () => {
    const free = await A.call('aimeat_appdev_pitfall_report', {
        model: 'gpt-6', category: 'three-world', slug: 'orbit-free-text', title: 'Pointer lock waits for a click', symptom: 'requestPointerLock throws at load', resolution: 'ask for it inside the click handler',
    });
    // A free-text category files under the nearest fixed one; the word becomes a tag and the answer
    // names the fixed list.
    assert(free.result?.isError !== true, `free-text category: ${reportText(free).slice(0, 300)}`);
    const freeOut = reportOut(free);
    assert(freeOut.category === 'games' && freeOut.key.endsWith('/games/orbit-free-text'), `filed under: ${JSON.stringify(freeOut)}`);
    assert(freeOut.warnings.some((w: string) => /"three-world"/.test(w) && w.includes(PITFALL_LIST_TEXT) && /tags/.test(w)), `category warning: ${JSON.stringify(freeOut.warnings)}`);
    const freeBody = await A.call('aimeat_memory_read', { key: freeOut.key, owner_scope: true });
    assert(/"three-world"/.test(reportText(freeBody)), `the word is not a tag: ${reportText(freeBody).slice(0, 300)}`);

    const crit = await A.call('aimeat_appdev_pitfall_report', {
        model: 'gpt-6', category: 'games', title: 'Orbit controls are not bundled', symptom: 'import of OrbitControls fails', resolution: 'write the orbit yourself',
        severity: 'critical', tags: ['Three World', 'orbit'],
    });
    assert(crit.result?.isError !== true, `games report: ${reportText(crit).slice(0, 300)}`);
    const out = reportOut(crit);
    assert(out.severity === 'warn' && out.requested_severity === 'critical', `an agent's critical was stored: ${JSON.stringify(out)}`);
    assert(out.warnings.some((w: string) => /evidence/.test(w)) && out.warnings.some((w: string) => /seen_version/.test(w)), `evidence not asked for: ${JSON.stringify(out.warnings)}`);
    const body = await A.call('aimeat_memory_read', { key: out.key, owner_scope: true });
    assert(/"three-world"/.test(reportText(body)) && /"orbit"/.test(reportText(body)), `tags not stored: ${reportText(body).slice(0, 300)}`);
});

await test('report: an entry about one app stays private and points to App Development Notes; shared with one is refused', async () => {
    const shared = await A.call('aimeat_appdev_pitfall_report', {
        model: 'claude-haiku-4.5', category: 'data', title: 'Notes app list record grows forever', symptom: 'the list record passes 900 kB',
        resolution: 'move old rows to a per-month record', app_ref: 'alice/notes', share: true,
    });
    assert(shared.result?.isError === true && /names no app/.test(reportText(shared)), `share with app_ref: ${reportText(shared).slice(0, 300)}`);
    const kept = await A.call('aimeat_appdev_pitfall_report', {
        model: 'claude-haiku-4.5', category: 'data', title: 'Notes app list record grows forever', symptom: 'the list record passes 900 kB in alice/notes.html',
        resolution: 'move old rows to a per-month record',
    });
    assert(kept.result?.isError !== true, `private app entry: ${reportText(kept).slice(0, 300)}`);
    const out = reportOut(kept);
    assert(out.visibility === 'owner' && out.notes.some((n: string) => /App Development Notes/.test(n)), `app entry: ${JSON.stringify(out)}`);
});

await test('report: kind platform-defect answers with a ready wish text', async () => {
    const r = await A.call('aimeat_appdev_pitfall_report', {
        model: 'claude-haiku-4.5', category: 'publish', title: 'Upload publish ignores the page version comment',
        symptom: 'the catalogue keeps the previous version label', resolution: 'pass version on every publish call',
        kind: 'platform-defect', evidence: 'services/app/publish.ts reads no manifest comment', seen_version: '4.3.1',
    });
    assert(r.result?.isError !== true, `platform-defect: ${reportText(r).slice(0, 300)}`);
    const pd = reportOut(r).platform_defect;
    assert(pd && /Platform defect: Upload publish ignores/.test(pd.wish_text) && /Evidence: services\/app\/publish.ts/.test(pd.wish_text), `wish text: ${JSON.stringify(pd)}`);
    assert(/wish/.test(pd.how) && typeof pd.operators_told === 'boolean', `how: ${JSON.stringify(pd)}`);
});

await test('REST: the same refusals on POST /learned (409 with details.matches, 400 for a category)', async () => {
    const tok = viewOwner.token;
    const h = { Authorization: `Bearer ${tok}` };
    const first = await json('/v1/appdev/pitfalls/learned', { method: 'POST', headers: h, body: JSON.stringify({
        model: 'goose', category: 'ui', slug: 'toast-stack', title: 'Toasts stack over the bottom bar', symptom: 'two toasts cover the phone bar buttons', resolution: 'cap toasts at one',
    }) });
    assert(first.status === 201, `first: ${first.status} ${JSON.stringify(first.body?.error)}`);
    const close = await json('/v1/appdev/pitfalls/learned', { method: 'POST', headers: h, body: JSON.stringify({
        model: 'goose', category: 'ui', slug: 'toast-stack-two', title: 'Toasts stack over the phone bottom bar', symptom: 'two toasts cover the bar buttons', resolution: 'show one toast',
    }) });
    assert(close.status === 409 && close.body.error.code === 'SIMILAR_ENTRY', `close: ${close.status} ${JSON.stringify(close.body?.error)}`);
    assert(close.body.error.details.matches.some((m: any) => m.ref.endsWith('/ui/toast-stack') && m.source === 'own'), `details: ${JSON.stringify(close.body.error.details)}`);
    const cat = await json('/v1/appdev/pitfalls/learned', { method: 'POST', headers: h, body: JSON.stringify({
        model: 'goose', category: 'rendering', title: 'Canvas blurs on a retina screen', symptom: 'lines look soft', resolution: 'scale by devicePixelRatio',
    }) });
    // A free-text category from an earlier client files under the nearest fixed one, keeps the word
    // as a tag, and the answer names the list.
    assert(cat.status === 201 && cat.body.data.category === 'games' && cat.body.data.key.endsWith('/games/canvas-blurs-on-a-retina-screen'), `category: ${cat.status} ${JSON.stringify(cat.body?.error ?? cat.body?.data)}`);
    assert((cat.body.data.warnings as string[]).some(w => /"rendering"/.test(w) && w.includes(PITFALL_LIST_TEXT)), `category warning: ${JSON.stringify(cat.body.data.warnings)}`);
    const catRead = await json(`/v1/memory/${encodeURIComponent(cat.body.data.key)}?owner_scope=true`, { headers: h });
    assert(catRead.status === 200 && (catRead.body.data?.value?.tags ?? []).includes('rendering'), `the word is a tag: ${catRead.status} ${JSON.stringify(catRead.body.data?.value?.tags ?? catRead.body?.error)}`);
    const badType = await json('/v1/appdev/pitfalls/learned', { method: 'POST', headers: h, body: JSON.stringify({
        model: 'goose', category: 'ui', title: 'Something else entirely here', symptom: 'some symptom', resolution: 'some fix', confirm_new: 'yes',
    }) });
    assert(badType.status === 400, `confirm_new as a string: ${badType.status}`);
    // PATCH: critical from a non-curator waits; retired_by lands with outdated.
    const crit = await json('/v1/appdev/pitfalls/learned/ui/toast-stack', { method: 'PATCH', headers: h, body: JSON.stringify({ severity: 'critical' }) });
    assert(crit.status === 200 && crit.body.data.pitfall.severity === 'warn' && crit.body.data.pitfall.requested_severity === 'critical', `PATCH critical by a non-operator: ${JSON.stringify(crit.body)}`);
    const patched = await json('/v1/appdev/pitfalls/learned/ui/toast-stack', { method: 'PATCH', headers: h, body: JSON.stringify({ status: 'outdated', retired_by: 'lint toast-cap' }) });
    assert(patched.status === 200 && patched.body.data.pitfall.retired_by === 'lint toast-cap', `PATCH retired_by: ${JSON.stringify(patched.body)}`);
    const badSev = await json('/v1/appdev/pitfalls/learned/ui/toast-stack', { method: 'PATCH', headers: h, body: JSON.stringify({ severity: 'urgent' }) });
    assert(badSev.status === 400, `PATCH an unknown severity: ${badSev.status}`);
});

await test('a node operator in person is the curator: PATCH critical raises an entry', async () => {
    // The first owner registered on a cleared database is the operator; a run that reuses a
    // database may have another one, so the suite asks the node which this owner is.
    const { body: signed } = await ownerSignIn(BASE, `pfowna${stamp}`, 'PitfallKb1!');
    const h = { Authorization: `Bearer ${signed.data.token}` };
    const isOperator = (await json('/v1/admin/ghii', { headers: h })).status === 200;
    console.log(`     (owner A is ${isOperator ? '' : 'not '}this node's operator in this run)`);
    const r = await json('/v1/appdev/pitfalls/learned/games/orbit-controls-are-not-bundled', { method: 'PATCH', headers: h, body: JSON.stringify({ severity: 'critical' }) });
    assert(r.status === 200, `PATCH as owner A: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const p = r.body.data.pitfall;
    // The operator's critical lands; anyone else's waits as requested_severity.
    const want = isOperator ? { severity: 'critical', requested: undefined } : { severity: 'warn', requested: 'critical' };
    assert(p.severity === want.severity && p.requested_severity === want.requested,
        `owner A (operator: ${isOperator}) PATCH critical: ${JSON.stringify(p)}`);
});

await test('overview: areas narrow both pitfall sections; a stale entry leaves the list and is counted', async () => {
    const h = { Authorization: `Bearer ${viewOwner.token}` };
    const staleKey = `packages/appdev-pitfalls/auth/${VS}-stale`;
    const freshKey = `packages/appdev-pitfalls/auth/${VS}-fresh`;
    const now = new Date().toISOString();
    for (const [key, ver] of [[staleKey, '1.0.0'], [freshKey, undefined]] as const) {
        const { status } = await json('/v1/memory', { method: 'POST', headers: h, body: JSON.stringify({
            key, visibility: 'owner', tags: ['knowledge-entry', 'pitfall', 'model:goose'],
            value: { title: `Entry ${key}`, symptom: 's', resolution: 'r', model: 'goose', category: 'auth', slug: key.split('/').pop(),
                applies_to: ['auth'], severity: 'warn', status: 'active', reported_by: 'e2e', created: now, updated: now,
                ...(ver ? { verified_version: ver, verified_at: now } : {}) },
        }) });
        assert(status === 201, `seed ${key}: ${status}`);
    }
    const { body } = await json('/v1/appdev/overview?sections=pitfalls_learned,pitfalls_curated&areas=auth', { headers: h });
    const learned = body.data.pitfalls_learned;
    const keys = learned.items.map((p: any) => p.key);
    assert(keys.includes(freshKey) && !keys.includes(staleKey), `stale entry listed or fresh one lost: ${JSON.stringify(keys)}`);
    assert(learned.needs_recheck.count >= 1 && learned.needs_recheck.own.includes(staleKey) && /verified/.test(learned.needs_recheck.recheck), `needs_recheck: ${JSON.stringify(learned.needs_recheck)}`);
    assert(!keys.includes(viewKeys.ownerPriv), `areas=auth kept a data entry: ${JSON.stringify(keys)}`);
    assert(body.data.pitfalls_curated.items.length > 0 && body.data.pitfalls_curated.items.every((p: any) => p.appliesTo.includes('auth')), 'curated not narrowed to auth');
    // Without areas the data entry is back; the index row says needs_recheck.
    const { body: wide } = await json('/v1/appdev/overview?sections=pitfalls_learned', { headers: h });
    assert(wide.data.pitfalls_learned.items.some((p: any) => p.key === viewKeys.ownerPriv), 'without areas the data entry is missing');
    const idx = await json('/v1/appdev/pitfalls/index?scope=own&status=all&limit=100&areas=auth', { headers: h });
    const staleRow = idx.body.data.pitfalls.find((p: any) => p.key === staleKey);
    assert(staleRow?.needs_recheck === true && !idx.body.data.pitfalls.some((p: any) => p.key === viewKeys.ownerPriv), `index: ${JSON.stringify(idx.body.data.pitfalls.map((p: any) => [p.key, p.needs_recheck]))}`);
});

console.log('\n' + '─'.repeat(40));
console.log(`MCP appdev-pitfalls E2E: ${passed} passed, ${failed} failed of ${passed + failed}`);
if (failed > 0) process.exit(1);
console.log('✅ All MCP appdev-pitfall tests passed!\n');
