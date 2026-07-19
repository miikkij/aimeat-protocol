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
 * @version-history v1.0.0 — 2026-07-19 — initial (AppDev KB Phase 4).
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
    const ownerPrivKey = gb.data.private_key;

    const ts1 = new Date().toISOString();
    const { body: tb } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: ownerName, timestamp: ts1, signature: await signMsg(ownerPrivKey, ownerName + NODE_ID + ts1) }),
    });
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
    const params = new URLSearchParams({
        response_type: 'code', client_id: reg.client_id, gaii: agentGaii,
        signature: await signMsg(agentPrivKey, agentGaii + NODE_ID + ts2), timestamp: ts2,
    });
    const { body: auth } = await json(`/v1/mcp/authorize?${params}`);
    const { body: tok } = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({ grant_type: 'authorization_code', code: auth.code, client_id: reg.client_id, client_secret: reg.client_secret }),
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

console.log('\n' + '─'.repeat(40));
console.log(`MCP appdev-pitfalls E2E: ${passed} passed, ${failed} failed of ${passed + failed}`);
if (failed > 0) process.exit(1);
console.log('✅ All MCP appdev-pitfall tests passed!\n');
