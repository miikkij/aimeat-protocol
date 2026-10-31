/**
 * @file test/e2e-overview.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The account's overview, end to end: GET /v1/overview and aimeat_overview. The owner
 *   reads machines, agents, apps, knowledge and offerings with their use and the lines between them;
 *   an agent's writes into a workspace count, and draw its line; focus and limit cut the answer.
 *
 *   THE REFUSALS ARE HALF OF IT. The answer lists a person's agents, apps and organisms, so another
 *   owner never sees them, an agent without agent:read is refused on both REST and MCP, and an agent
 *   without organism:read sees the organisms but not the workspace names inside them.
 * @usage pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=overview
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (wish-kokonaiskuva-koneet-agentit-sovellukset-tieto-ja-tarjoukset-).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { ownerSignIn } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (err) { failed++; console.log(`  ✗ ${name}\n      ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
const auth = (tok: string) => ({ Authorization: `Bearer ${tok}` });

interface Owner { name: string; token: string }

async function setupOwner(label: string): Promise<Owner> {
    const name = `ov${label}${Date.now().toString(36)}`;
    const body = JSON.stringify({ username: name, display_name: 'Overview', password: 'OverviewPass12345' });
    let r = await json('/v1/ghii', { method: 'POST', body });
    for (let i = 0; r.status === 429 && i < 8; i++) {
        await new Promise(res => setTimeout(res, 1500));
        r = await json('/v1/ghii', { method: 'POST', body });
    }
    assert(r.status === 201, `ghii ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const tok = await ownerSignIn(BASE, name, 'OverviewPass12345');
    assert(tok.status === 200 && tok.body?.data?.token, `ghii/login ${tok.status}`);
    return { name, token: tok.body.data.token as string };
}

/** An agent of `o` with exactly `scopes`, and a token of its own. */
async function agentWith(o: Owner, name: string, scopes: string[]) {
    const ag = await json('/v1/agents', {
        method: 'POST', headers: auth(o.token),
        body: JSON.stringify({ name, owner: o.name, capabilities: [], mode: 'interactive', scopes }),
    });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body?.error)}`);
    const gaii = ag.body.data.agent.gaii as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: await sign(ag.body.data.private_key, gaii + ts) }),
    });
    assert(tok.status === 200, `agent token ${tok.status}`);
    return { name, gaii, token: tok.body.data.token as string };
}

async function mcpSession(token: string) {
    let sid: string | undefined;
    let id = 0;
    const rpc = async (method: string, params: Record<string, unknown> = {}) => {
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`,
                ...(sid ? { 'mcp-session-id': sid, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
        });
        sid = res.headers.get('mcp-session-id') ?? sid;
        const text = await res.text();
        const line = text.split('\n').find(l => l.startsWith('data: '));
        return JSON.parse(line ? line.slice(6) : text);
    };
    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'e2e-overview', version: '1' } });
    return async (name: string, args: Record<string, unknown>) => {
        const body = await rpc('tools/call', { name, arguments: args });
        const t = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body);
        return { isError: body?.result?.isError === true || !!body?.error, text: t as string };
    };
}

const overview = (tok: string, q = '') => json(`/v1/overview${q}`, { headers: auth(tok) });

(async () => {
    console.log('\n  e2e-overview\n');
    const a = await setupOwner('a');
    const b = await setupOwner('b');
    const authA = auth(a.token);
    let orgId = '';
    let ws = '';
    const writer = await agentWith(a, 'scribe', ['*']);
    const reader = await agentWith(a, 'looker', ['agent:read']);
    const blind = await agentWith(a, 'blind', ['memory:read']);

    await test('setup: an organism of A with one workspace, an app, and a write by A\'s agent', async () => {
        const o = await json('/v1/organisms', { method: 'POST', headers: authA, body: JSON.stringify({ name: 'Map desk', description: 'x', type: 'project', join_policy: 'invite', visibility: 'private' }) });
        assert(o.status === 201, `org ${o.status}: ${JSON.stringify(o.body?.error)}`);
        orgId = o.body.data.organism.id;
        const made = await json(`/v1/organisms/${orgId}/workspaces`, {
            method: 'POST', headers: authA,
            body: JSON.stringify({ name: 'Notes', manifest: { manifestVersion: '1.0', name: 'Notes', kind: 'project', status: 'active', objectTypes: [
                { name: 'notes', schemaRef: 'schema:notes@1', namespace: 'shared.notes', backing: 'memory', writeRole: 'member', mode: 'document' },
            ] } }),
        });
        assert(made.status === 201 && typeof made.body?.data?.ws === 'string', `workspace ${made.status}: ${JSON.stringify(made.body?.error)}`);
        ws = made.body.data.ws;
        const html = Buffer.from('<!doctype html><html><head><meta charset="utf-8"><title>Mapped</title></head><body>m</body></html>').toString('base64');
        const app = await json('/v1/apps', { method: 'POST', headers: authA, body: JSON.stringify({ filename: 'mapped.html', content: html, description: 'An app for the overview suite.' }) });
        assert(app.status === 201 || app.status === 200, `app ${app.status}: ${JSON.stringify(app.body?.error)}`);
        for (const n of ['one', 'two', 'three']) {
            const w = await json('/v1/memory', { method: 'POST', headers: auth(writer.token), body: JSON.stringify({ key: `organism.${orgId}.w.${ws}.shared.notes.${n}`, value: { title: n, markdown: n }, visibility: 'private' }) });
            assert(w.status === 201, `agent write ${n}: ${w.status} ${JSON.stringify(w.body?.error)}`);
        }
    });

    await test('the owner reads every lane: the agents, the app, the organism with its workspace, and whole totals', async () => {
        const r = await overview(a.token);
        assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const v = r.body.data;
        assert(v.range === '7d' && typeof v.since === 'string', `range ${v.range}`);
        const ids = (v.items as any[]).map(i => i.id);
        for (const id of ['agent:scribe', 'agent:looker', 'agent:blind', 'app:mapped.html', `organism:${orgId}`, `workspace:${orgId}/${ws}`]) {
            assert(ids.includes(id), `missing ${id} in ${ids.join(', ')}`);
        }
        assert(v.totals.agents === 3 && v.totals.organisms === 1 && v.totals.apps >= 1, `totals ${JSON.stringify(v.totals)}`);
        assert(v.totals.used && v.totals.quiet_by_lane, 'totals carry used and quiet_by_lane');
        // Every agent sits in a group of the computers lane, and the group's line runs to it.
        const scribe = v.items.find((i: any) => i.id === 'agent:scribe');
        assert(typeof scribe.parent === 'string' && ids.includes(scribe.parent), `agent group ${scribe.parent}`);
        assert(v.edges.some((e: any) => e.from === scribe.parent && e.to === 'agent:scribe' && e.kind === 'runs'), 'no runs line');
    });

    // FAILED FIRST: before storage.listKeyActivity the overview had no writes per workspace at all.
    await test('an agent\'s writes into a workspace are counted, and draw its line to that workspace', async () => {
        const v = (await overview(a.token)).body.data;
        const w = v.items.find((i: any) => i.id === `workspace:${orgId}/${ws}`);
        assert(w.use === 3 && w.unit === 'writes', `workspace use ${w.use} ${w.unit}`);
        const org = v.items.find((i: any) => i.id === `organism:${orgId}`);
        assert(org.use === 3, `organism use ${org.use}`);
        const line = v.edges.find((e: any) => e.from === 'agent:scribe' && e.to === `workspace:${orgId}/${ws}`);
        assert(line && line.kind === 'writes' && line.weight === 3, `line ${JSON.stringify(line)}`);
    });

    await test('focus keeps one item and what is one line away; an unknown item is NOT_FOUND', async () => {
        const f = await overview(a.token, `?focus=${encodeURIComponent('agent:scribe')}`);
        assert(f.status === 200, `focus ${f.status}`);
        const ids = (f.body.data.items as any[]).map(i => i.id);
        assert(ids.includes('agent:scribe') && ids.includes(`workspace:${orgId}/${ws}`), `focus items ${ids.join(', ')}`);
        assert(!ids.includes('agent:blind'), 'an unrelated agent stayed in the focused answer');
        assert(f.body.data.totals.agents === 3, 'focus changed the totals');
        const none = await overview(a.token, '?focus=agent:nobody');
        assert(none.status === 404 && none.body.error?.code === 'NOT_FOUND', `unknown focus ${none.status} ${none.body.error?.code}`);
    });

    await test('limit keeps the busiest of each lane, and a range outside 24h, 7d, 30d is INVALID_INPUT', async () => {
        const l = await overview(a.token, '?limit=1');
        assert(l.status === 200, `limit ${l.status}`);
        assert((l.body.data.items as any[]).filter(i => i.lane === 'agents').length === 1, 'more than one agent kept');
        const bad = await overview(a.token, '?range=1y');
        assert(bad.status === 400 && bad.body.error?.code === 'INVALID_INPUT', `range ${bad.status}`);
        const day = await overview(a.token, '?range=24h');
        assert(day.status === 200 && day.body.data.range === '24h', `24h ${day.status}`);
    });

    await test('another owner sees none of A\'s agents, apps or organisms', async () => {
        const r = await overview(b.token);
        assert(r.status === 200, `status ${r.status}`);
        const text = JSON.stringify(r.body.data);
        assert(!text.includes('scribe') && !text.includes('mapped.html') && !text.includes(orgId), 'A\'s things reached B');
        assert(r.body.data.totals.agents === 0, `B's agents ${r.body.data.totals.agents}`);
        const theirFocus = await overview(b.token, `?focus=${encodeURIComponent(`organism:${orgId}`)}`);
        assert(theirFocus.status === 404, `B focusing on A's organism: ${theirFocus.status}`);
    });

    await test('an agent with agent:read reads its owner\'s overview; without organism:read it sees no workspace names', async () => {
        const r = await overview(reader.token);
        assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const items = r.body.data.items as any[];
        assert(items.some(i => i.id === `organism:${orgId}`), 'the organism is missing');
        assert(!items.some(i => i.kind === 'workspace'), 'a workspace name reached an agent without organism:read');
        assert(r.body.data.edges.some((e: any) => e.from === 'agent:scribe' && e.to === `organism:${orgId}`), 'the write line did not end at the organism');
    });

    await test('an agent without agent:read is refused on REST and on MCP', async () => {
        const r = await overview(blind.token);
        assert(r.status === 403, `REST ${r.status}`);
        const call = await mcpSession(blind.token);
        const m = await call('aimeat_overview', {});
        assert(m.isError, `MCP answered: ${m.text.slice(0, 200)}`);
    });

    await test('MCP: aimeat_overview answers the same account, busiest ten per lane by default, and follows a focus', async () => {
        const call = await mcpSession(writer.token);
        const all = await call('aimeat_overview', {});
        assert(!all.isError, `call: ${all.text.slice(0, 200)}`);
        const v = JSON.parse(all.text);
        assert(v.totals.agents === 3 && v.items.some((i: any) => i.id === 'app:mapped.html'), `MCP totals ${JSON.stringify(v.totals)}`);
        const f = await call('aimeat_overview', { focus: `workspace:${orgId}/${ws}` });
        assert(!f.isError && JSON.parse(f.text).items.some((i: any) => i.id === 'agent:scribe'), `focus: ${f.text.slice(0, 200)}`);
        const nf = await call('aimeat_overview', { focus: 'app:nothing.html' });
        assert(nf.isError && nf.text.includes('NOT_FOUND'), `unknown focus: ${nf.text.slice(0, 200)}`);
    });

    await test('an anonymous caller is refused', async () => {
        const r = await json('/v1/overview');
        assert(r.status === 401, `status ${r.status}`);
    });

    console.log(`\n  ${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
