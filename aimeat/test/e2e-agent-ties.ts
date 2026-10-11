/**
 * @file test/e2e-agent-ties.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an agent's work is tied to, end to end: the apps whose data map names the
 *   agent, the workspace its finished work is shared with, the first run a new agent gets, and the
 *   build instructions about one agent.
 *
 *   THE REFUSALS ARE HALF OF IT. A tie is a statement about one person's app and one person's
 *   agent, so every write is tried from a second account as well: another owner cannot tie an app
 *   that is not theirs, cannot name an agent that is not theirs, cannot say where another person's
 *   agent sends its work, and cannot read the build instructions about it.
 * @usage pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-ties
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial (wish-agentista-sovellukseen-sovelluksen-teko-agentin-j-lkeen-ja-a).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

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
    const name = `tie${label}${Date.now().toString(36)}`;
    let r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Ties', password: 'AgentTiesPass12345' }) });
    for (let i = 0; r.status === 429 && i < 8; i++) {
        await new Promise(res => setTimeout(res, 1500));
        r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Ties', password: 'AgentTiesPass12345' }) });
    }
    assert(r.status === 201, `ghii ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(r.body.data.private_key, name + NODE_ID + ts) }),
    });
    assert(tok.status === 200 && tok.body?.data?.token, `auth/token ${tok.status}`);
    return { name, token: tok.body.data.token as string };
}

/** An agent with a key and a token of its own, which can write the result of a task. */
async function keyedAgent(o: Owner, name: string) {
    const ag = await json('/v1/agents', {
        method: 'POST', headers: auth(o.token),
        body: JSON.stringify({ name, owner: o.name, capabilities: [], mode: 'interactive', scopes: ['*'] }),
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

/** One session on the node's own MCP server: initialize once, then tools/call. */
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
    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'e2e-agent-ties', version: '1' } });
    return async (name: string, args: Record<string, unknown>) => {
        const body = await rpc('tools/call', { name, arguments: args });
        const t = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body);
        return { isError: body?.result?.isError === true || !!body?.error, text: t as string };
    };
}

async function until(what: string, cond: () => Promise<boolean>, ms = 15_000) {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await cond()) return; await new Promise(r => setTimeout(r, 250)); }
    throw new Error(`timed out waiting for ${what}`);
}

const APP_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="aimeat-scopes" content="memory:read">
<title>Tie probe</title></head><body><h1>Tie probe</h1></body></html>`;

const DEF = {
    agent_name: 'placeholder',
    agents: [{ role: 'Reporter', goal: 'report', backstory: 'You report.', allow_delegation: false, tools: ['memory'] }],
    tasks: [{ id: 'report', description: 'Report on this: {{ctx.prompt}}', expected_output: 'a report', agent: 'Reporter' }],
};

const PURPOSE = 'Reads the morning news and writes a short summary.';
const WS = 'ws-ties';

console.log('\n=== Agent ties: apps, the workplace, the first run, the build instructions ===\n');

(async () => {
    const a = await setupOwner('a');
    const b = await setupOwner('b');
    const authA = auth(a.token);
    const authB = auth(b.token);

    const publish = async (o: Owner, filename: string, name: string) => {
        const r = await json('/v1/apps', {
            method: 'POST', headers: auth(o.token),
            body: JSON.stringify({ filename, content: Buffer.from(APP_HTML).toString('base64'), mime_type: 'text/html', name, description: 'E2E' }),
        });
        assert(r.status === 201, `publish ${filename}: ${r.status} ${JSON.stringify(r.body?.error)}`);
    };
    const propose = (name: string, display: string) => json('/v1/agents/v2/agent-proposals', {
        method: 'POST', headers: authA,
        body: JSON.stringify({ name, display_name: display, purpose: PURPOSE, scopes: ['memory:read'], crew_def: DEF }),
    });
    const approve = (id: string, body: Record<string, unknown> = {}) => json(`/v1/agents/v2/agent-proposals/${id}/approve`, {
        method: 'POST', headers: authA, body: JSON.stringify(body),
    });
    const worker = async (o: Owner, name: string) =>
        ((await json(`/v1/home/agents?agent=${name}`, { headers: auth(o.token) })).body?.data?.workers ?? [])[0];
    const tie = (o: Owner, app: string, agent: string, body: Record<string, unknown> = {}) =>
        json(`/v1/datamap/apps/${app}/agents/${agent}`, { method: 'PUT', headers: auth(o.token), body: JSON.stringify(body) });
    const untie = (o: Owner, app: string, agent: string) =>
        json(`/v1/datamap/apps/${app}/agents/${agent}`, { method: 'DELETE', headers: auth(o.token) });

    // ── 1. The first run ───────────────────────────────────────────────────────
    await test('a new agent gets its work once: the task carries its name and purpose and is marked as the first run', async () => {
        const p = await propose('news', 'Morning news');
        assert(p.status === 201 || p.status === 200, `propose ${p.status}: ${JSON.stringify(p.body?.error)}`);
        const ok = await approve(p.body.data.proposal.id);
        assert(ok.status === 200, `approve ${ok.status}: ${JSON.stringify(ok.body?.error)}`);
        const run = ok.body.data.first_run;
        assert(run && typeof run.task_id === 'string', `first_run: ${JSON.stringify(run)}`);
        const t = await json(`/v1/agents/news/tasks/${run.task_id}`, { headers: authA });
        assert(t.status === 200, `task ${t.status}`);
        const task = t.body.data.task;
        assert(task.title === 'Morning news', `title: ${task.title}`);
        assert(task.description === PURPOSE, `description: ${task.description}`);
        assert((task.scope ?? []).some((s: any) => s.name === 'kind' && s.value === 'first-run'), `scope: ${JSON.stringify(task.scope)}`);
    });

    await test('a caller that asks for no first run gets none', async () => {
        const p = await propose('quiet', 'Quiet one');
        const ok = await approve(p.body.data.proposal.id, { first_run: false });
        assert(ok.status === 200, `approve ${ok.status}`);
        assert(ok.body.data.first_run === null, `first_run: ${JSON.stringify(ok.body.data.first_run)}`);
        const list = await json('/v1/agents/quiet/tasks', { headers: authA });
        assert((list.body?.data?.tasks ?? []).length === 0, `tasks: ${(list.body?.data?.tasks ?? []).length}`);
    });

    // ── 1b. The offer a new agent's definition carries ─────────────────────────
    // The crew runtime publishes a definition's first offer when the agent starts, so the
    // definition has to carry one. What is asserted here is the definition; the publish is the
    // runtime's.
    /** The definition inside a crew read, wherever the answer keeps it. */
    const definitionOf = (data: any): any => {
        const seen = new Set<any>();
        const walk = (v: any): any => {
            if (!v || typeof v !== 'object' || seen.has(v)) return null;
            seen.add(v);
            if (Array.isArray(v.agents) && Array.isArray(v.tasks)) return v;
            for (const child of Object.values(v)) { const hit = walk(child); if (hit) return hit; }
            return null;
        };
        return walk(data);
    };
    const RUNTIME_KEYS = ['id', 'title', 'ask', 'example', 'cost', 'latency', 'repeatability', 'verification', 'consequences'];

    await test('a definition proposed with no offer is seeded with one made from the agent\'s name and purpose', async () => {
        const crew = await json('/v1/agents/news/crew', { headers: authA });
        assert(crew.status === 200, `crew ${crew.status}: ${JSON.stringify(crew.body?.error)}`);
        const def = definitionOf(crew.body.data);
        assert(def, `no definition in the answer: ${JSON.stringify(crew.body.data).slice(0, 300)}`);
        assert(Array.isArray(def.offers) && def.offers.length === 1, `offers: ${JSON.stringify(def.offers)}`);
        const offer = def.offers[0];
        assert(offer.id === 'news' && offer.title === 'Morning news' && offer.ask === PURPOSE, JSON.stringify(offer));
        for (const key of RUNTIME_KEYS) assert(key in offer, `the offer lacks ${key}, which the runtime reads`);
        assert(offer.price === undefined && offer.visibility === undefined, `the offer carries a price or a visibility: ${JSON.stringify(offer)}`);
    });

    await test('an offer the proposer wrote is kept, and only its missing keys are added', async () => {
        const p = await json('/v1/agents/v2/agent-proposals', {
            method: 'POST', headers: authA,
            body: JSON.stringify({
                name: 'digester', display_name: 'Digester', purpose: PURPOSE, scopes: ['memory:read'],
                crew_def: { ...DEF, offers: [{ id: 'daily-digest', title: 'A daily digest', ask: 'Give me a topic and I return what is new on it.' }] },
            }),
        });
        assert(p.status === 201 || p.status === 200, `propose ${p.status}: ${JSON.stringify(p.body?.error)}`);
        const ok = await approve(p.body.data.proposal.id, { first_run: false });
        assert(ok.status === 200, `approve ${ok.status}: ${JSON.stringify(ok.body?.error)}`);
        const crew = await json('/v1/agents/digester/crew', { headers: authA });
        const offer = definitionOf(crew.body.data)?.offers?.[0];
        assert(offer && offer.id === 'daily-digest' && offer.title === 'A daily digest', JSON.stringify(offer));
        assert(offer.ask === 'Give me a topic and I return what is new on it.', `ask: ${offer.ask}`);
        for (const key of RUNTIME_KEYS) assert(key in offer, `the offer lacks ${key}, which the runtime reads`);
    });

    // ── 2. The tie between an app and an agent ─────────────────────────────────
    await publish(a, 'shows.html', 'Shows the news');
    await publish(a, 'digest.html', 'Digest');
    await publish(b, 'theirs.html', 'Theirs');

    await test('an agent with no tie lists no app and no workplace', async () => {
        const w = await worker(a, 'news');
        assert(w, 'no worker');
        assert(Array.isArray(w.apps) && w.apps.length === 0, `apps: ${JSON.stringify(w.apps)}`);
        assert(w.work_goes_to === null, `work_goes_to: ${JSON.stringify(w.work_goes_to)}`);
    });

    await test('tying an app with no map adds one row that names the agent, and leaves the builder\'s sentences blank', async () => {
        const r = await tie(a, `${a.name}/shows.html`, 'news', { made_for: true });
        assert(r.status === 200, `tie ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const held = r.body.data.data_map.held;
        assert(held.length === 1 && held[0].agent === 'news' && held[0].madeFor === true, `held: ${JSON.stringify(held)}`);
        assert(held[0].why === '', `why was invented: ${held[0].why}`);
        assert(r.body.data.data_map.what === '', `purpose was invented: ${r.body.data.data_map.what}`);
        const codes = (r.body.data.findings ?? []).map((f: any) => f.code);
        assert(codes.includes('DATAMAP_NO_PURPOSE') && codes.includes('DATAMAP_ROW_NO_WHY'), `findings: ${codes.join(',')}`);
    });

    await test('the agent\'s page reads the app, with its name, its address and "made for"', async () => {
        const w = await worker(a, 'news');
        assert(w.apps.length === 1, `apps: ${JSON.stringify(w.apps)}`);
        const app = w.apps[0];
        assert(app.filename === 'shows.html' && app.name === 'Shows the news' && app.made_for === true, JSON.stringify(app));
        assert(typeof app.url === 'string' && app.url.length > 0, `url: ${app.url}`);
    });

    await test('a row a builder wrote into a full map ties the app too, and the app made for the agent comes first', async () => {
        const map = {
            spec: 'aimeat.datamap/2', what: 'A digest page.', usedFor: 'Reading several things at once.', form: 'one-person',
            arrangement: 'It reads what agents produce and keeps nothing.', machinery: [], leaves: [], elsewhere: [],
            held: [{
                what: 'news results', holds: 'the newest summary', kind: 'ai-generated', usedFor: 'user-returns-to-read',
                where: 'owner-memory-private', owner: 'person', readers: 'owner-and-their-agents', writers: ['an-agent'],
                shape: 'one-per-thing', keptFor: 'until-deleted', lossRisk: 'only-copy', personalData: 'no',
                why: 'The agent keeps it; the page only shows it.', agent: 'news',
            }],
        };
        const put = await json(`/v1/datamap/apps/${a.name}/digest.html`, { method: 'PUT', headers: authA, body: JSON.stringify(map) });
        assert(put.status === 200, `put ${put.status}: ${JSON.stringify(put.body?.error)}`);
        const w = await worker(a, 'news');
        assert(w.apps.length === 2, `apps: ${JSON.stringify(w.apps)}`);
        assert(w.apps[0].filename === 'shows.html' && w.apps[1].filename === 'digest.html', `order: ${w.apps.map((x: any) => x.filename)}`);
        assert(w.apps[1].made_for === false && w.apps[1].holds === 'the newest summary', JSON.stringify(w.apps[1]));
    });

    await test('a row whose agent cannot be an agent\'s name is a finding, never a refusal, and ties nothing', async () => {
        const read = await json(`/v1/datamap/apps/${a.name}/digest.html`, { headers: authA });
        const map = read.body.data.data_map;
        const bad = { ...map, held: [...map.held, { ...map.held[0], what: 'other', agent: 'Not A Name!' }] };
        const put = await json(`/v1/datamap/apps/${a.name}/digest.html`, { method: 'PUT', headers: authA, body: JSON.stringify(bad) });
        assert(put.status === 200, `put ${put.status}`);
        const codes = (put.body.data.findings ?? []).map((f: any) => f.code);
        assert(codes.includes('DATAMAP_ROW_BAD_AGENT'), `findings: ${codes.join(',')}`);
        const w = await worker(a, 'news');
        assert(w.apps.length === 2, `apps: ${JSON.stringify(w.apps)}`);
    });

    await test('another account cannot tie an app that is not theirs → 403', async () => {
        const r = await tie(b, `${a.name}/shows.html`, 'news', { made_for: true });
        assert(r.status === 403, `status ${r.status}`);
        const r2 = await untie(b, `${a.name}/shows.html`, 'news');
        assert(r2.status === 403, `untie status ${r2.status}`);
    });

    await test('an app cannot be tied to another account\'s agent, or to an agent that does not exist → 404', async () => {
        const r = await tie(b, `${b.name}/theirs.html`, 'news');
        assert(r.status === 404 && r.body.error?.code === 'AGENT_NOT_FOUND', `status ${r.status} ${r.body.error?.code}`);
        const r2 = await tie(a, `${a.name}/shows.html`, 'nobody-here');
        assert(r2.status === 404 && r2.body.error?.code === 'AGENT_NOT_FOUND', `status ${r2.status} ${r2.body.error?.code}`);
        const r3 = await tie(a, `${a.name}/missing.html`, 'news');
        assert(r3.status === 404 && r3.body.error?.code === 'NOT_FOUND', `status ${r3.status} ${r3.body.error?.code}`);
    });

    await test('the tie is public with the map and the home view is not: another account reads no agents of this one', async () => {
        const w = await worker(b, 'news');
        assert(w === undefined, `another account read the worker: ${JSON.stringify(w)}`);
    });

    await test('untying removes the row this route added and keeps the builder\'s row without the agent', async () => {
        const one = await untie(a, `${a.name}/shows.html`, 'news');
        assert(one.status === 200 && one.body.data.data_map.held.length === 0, `shows: ${one.status} ${JSON.stringify(one.body.data?.data_map?.held)}`);
        const two = await untie(a, `${a.name}/digest.html`, 'news');
        assert(two.status === 200, `digest ${two.status}`);
        const kept = two.body.data.data_map.held.find((r: any) => r.what === 'news results');
        assert(kept && kept.agent === undefined && kept.why === 'The agent keeps it; the page only shows it.', JSON.stringify(kept));
        const again = await untie(a, `${a.name}/shows.html`, 'news');
        assert(again.status === 404, `second untie ${again.status}`);
        const w = await worker(a, 'news');
        assert(w.apps.length === 0, `apps: ${JSON.stringify(w.apps)}`);
    });

    await test('a tie goes when its app goes', async () => {
        const r = await tie(a, `${a.name}/shows.html`, 'news', { made_for: true });
        assert(r.status === 200, `tie ${r.status}`);
        assert((await worker(a, 'news')).apps.length === 1, 'tie did not show');
        const del = await json('/v1/apps/shows.html', { method: 'DELETE', headers: authA });
        assert(del.status === 200, `delete ${del.status}: ${JSON.stringify(del.body?.error)}`);
        const w = await worker(a, 'news');
        assert(w.apps.length === 0, `apps after the app was deleted: ${JSON.stringify(w.apps)}`);
    });

    // ── 3. Where the work goes ─────────────────────────────────────────────────
    let orgId = '';
    await test('setup: an organism of A with one workspace', async () => {
        const o = await json('/v1/organisms', { method: 'POST', headers: authA, body: JSON.stringify({ name: 'News desk', description: 'x', type: 'project', join_policy: 'invite', visibility: 'private' }) });
        assert(o.status === 201, `org ${o.status}: ${JSON.stringify(o.body?.error)}`);
        orgId = o.body.data.organism.id;
        const reg = await json('/v1/memory', { method: 'POST', headers: authA, body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Morning', createdAt: new Date().toISOString(), createdBy: a.name }] }, visibility: 'private' }) });
        assert(reg.status === 201 || reg.status === 200, `registry ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    });

    const place = (o: Owner, agent: string, body: Record<string, unknown>) =>
        json(`/v1/agents/${agent}/workplace`, { method: 'PUT', headers: auth(o.token), body: JSON.stringify(body) });

    await test('the owner names a workspace of an organism they are in, and the home reads it with names', async () => {
        const r = await place(a, 'news', { organism_id: orgId, workspace_id: WS });
        assert(r.status === 200, `place ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const w = await worker(a, 'news');
        assert(w.work_goes_to?.organism_id === orgId && w.work_goes_to?.workspace_id === WS, JSON.stringify(w.work_goes_to));
        assert(w.work_goes_to.organism_name === 'News desk' && w.work_goes_to.workspace_name === 'Morning', JSON.stringify(w.work_goes_to));
    });

    await test('a place that does not exist, or one the owner is not in, is refused and changes nothing', async () => {
        const r1 = await place(a, 'news', { organism_id: orgId, workspace_id: 'ws-nope' });
        assert(r1.status === 404, `unknown workspace ${r1.status}`);
        const r2 = await place(a, 'news', { organism_id: 'no-such-organism', workspace_id: WS });
        assert(r2.status === 404, `unknown organism ${r2.status}`);
        const r3 = await place(a, 'news', {});
        assert(r3.status === 400, `empty body ${r3.status}`);
        const w = await worker(a, 'news');
        assert(w.work_goes_to?.workspace_id === WS, `place changed: ${JSON.stringify(w.work_goes_to)}`);
    });

    await test('another account cannot say where this agent\'s work goes, nor share into an organism it is not in', async () => {
        const r1 = await place(b, 'news', { organism_id: orgId, workspace_id: WS });
        assert(r1.status === 404 && r1.body.error?.code === 'AGENT_NOT_FOUND', `status ${r1.status} ${r1.body.error?.code}`);
        const theirs = await keyedAgent(b, 'theirs');
        const r2 = await place(b, theirs.name, { organism_id: orgId, workspace_id: WS });
        assert(r2.status === 404 && r2.body.error?.code === 'NOT_FOUND', `status ${r2.status} ${r2.body.error?.code}`);
        const r3 = await json('/v1/agents/news/workplace', { method: 'DELETE', headers: authB });
        assert(r3.status === 404, `delete by another account ${r3.status}`);
    });

    // An agent with a key of its own writes a result; the owner completes the task.
    const writer = await keyedAgent(a, 'writer');
    const finish = async (title: string, visibility: 'private' | 'public') => {
        const made = await json(`/v1/agents/${writer.name}/tasks`, { method: 'POST', headers: authA, body: JSON.stringify({ title, description: title }) });
        assert(made.status === 201 || made.status === 200, `task ${made.status}: ${JSON.stringify(made.body?.error)}`);
        const id = made.body.data.task.id as string;
        if (made.body.data.task.status !== 'active') {
            const started = await json(`/v1/agents/${writer.name}/tasks/${id}/start`, { method: 'POST', headers: authA });
            assert(started.status === 200, `start ${started.status}: ${JSON.stringify(started.body?.error)}`);
        }
        const key = `results.${id}`;
        const wrote = await json('/v1/memory', { method: 'POST', headers: auth(writer.token), body: JSON.stringify({ key, value: { summary: 'Three things happened.', items: [{ title: 'One', url: 'https://example.test/1' }] }, visibility, tags: [`task:${id}`] }) });
        assert(wrote.status === 201 || wrote.status === 200, `write ${wrote.status}: ${JSON.stringify(wrote.body?.error)}`);
        const done = await json(`/v1/agents/${writer.name}/tasks/${id}/complete`, { method: 'POST', headers: authA, body: JSON.stringify({ message: 'Done.', deliverable_key: key }) });
        assert(done.status === 200, `complete ${done.status}: ${JSON.stringify(done.body?.error)}`);
        return { id, key };
    };
    const record = async (key: string) => {
        const r = await json(`/v1/memory?agent=${encodeURIComponent(writer.gaii)}&prefix=${encodeURIComponent(key)}`, { headers: authA });
        return (r.body?.data?.items ?? []).find((x: any) => x.key === key);
    };

    await test('with no workplace a finished task\'s result stays private', async () => {
        const { id, key } = await finish('Before a place', 'private');
        await new Promise(r => setTimeout(r, 600));
        const rec = await record(key);
        assert(rec && rec.visibility === 'private', `visibility: ${rec?.visibility}`);
        const t = await json(`/v1/agents/${writer.name}/tasks/${id}`, { headers: authA });
        assert(t.body.data.outcome && t.body.data.outcome.shared_with === undefined, `shared_with: ${JSON.stringify(t.body.data.outcome?.shared_with)}`);
    });

    await test('with a workplace a finished task\'s private result is shared with that workspace', async () => {
        const r = await place(a, writer.name, { organism_id: orgId, workspace_id: WS });
        assert(r.status === 200, `place ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const { id, key } = await finish('After a place', 'private');
        await until('the result to be shared', async () => (await record(key))?.visibility === 'workspace');
        const rec = await record(key);
        assert(rec.value?.summary === 'Three things happened.', 'the value changed');
        // The read of that one task says where, by name.
        const t = await json(`/v1/agents/${writer.name}/tasks/${id}`, { headers: authA });
        const shared = t.body.data.outcome?.shared_with;
        assert(Array.isArray(shared) && shared.length === 1, `shared_with: ${JSON.stringify(shared)}`);
        assert(shared[0].organism_id === orgId && shared[0].workspace_id === WS, JSON.stringify(shared[0]));
        assert(shared[0].organism_name === 'News desk' && shared[0].workspace_name === 'Morning', JSON.stringify(shared[0]));
    });

    await test('a result the agent made public is left as the agent wrote it', async () => {
        const { key } = await finish('Already public', 'public');
        await new Promise(r => setTimeout(r, 600));
        const rec = await record(key);
        assert(rec && rec.visibility === 'public', `visibility: ${rec?.visibility}`);
    });

    await test('back to the default: the next result stays private, and what was shared stays shared', async () => {
        const off = await json(`/v1/agents/${writer.name}/workplace`, { method: 'DELETE', headers: authA });
        assert(off.status === 200 && off.body.data.workplace === null, `clear ${off.status}`);
        const { key } = await finish('After the place was taken away', 'private');
        await new Promise(r => setTimeout(r, 600));
        const rec = await record(key);
        assert(rec && rec.visibility === 'private', `visibility: ${rec?.visibility}`);
    });

    // FAILED FIRST, on 2026-10-11: with the prefix only on the reserved-owner list, an agent wrote
    // the record into its own namespace and was answered 201. It is service-owned now.
    await test('the workplace record is the node\'s own: no memory route writes it, for an agent in any namespace or for the owner', async () => {
        const record = { key: `agent-workplace.${writer.name}`, value: { spec: 'aimeat.agent-workplace/1', agentName: writer.name, organismId: orgId, workspaceId: WS }, visibility: 'private' };
        const byAgent = await json('/v1/memory', { method: 'POST', headers: auth(writer.token), body: JSON.stringify(record) });
        assert(byAgent.status >= 400 && byAgent.body.error?.code === 'RESERVED_KEY', `agent, own namespace: ${byAgent.status} ${byAgent.body.error?.code}`);
        const asOwner = await json('/v1/memory', { method: 'POST', headers: auth(writer.token), body: JSON.stringify({ ...record, owner_scope: true }) });
        assert(asOwner.status >= 400, `agent, the owner's namespace: ${asOwner.status}`);
        const byOwner = await json('/v1/memory', { method: 'POST', headers: authA, body: JSON.stringify(record) });
        assert(byOwner.status >= 400 && byOwner.body.error?.code === 'RESERVED_KEY', `owner: ${byOwner.status} ${byOwner.body.error?.code}`);
        assert((await worker(a, 'news')).work_goes_to?.workspace_id === WS, 'the place set through the route changed');
    });

    await test('the choices read lists the places the owner is in and the owner\'s own apps, and nobody else\'s', async () => {
        const mine = await json('/v1/home/agents/choices', { headers: authA });
        assert(mine.status === 200, `status ${mine.status}`);
        const places = mine.body.data.places as any[];
        assert(places.length === 1 && places[0].organism_id === orgId && places[0].workspace_name === 'Morning', JSON.stringify(places));
        const apps = (mine.body.data.apps as any[]).map(x => x.filename);
        assert(apps.includes('digest.html') && !apps.includes('theirs.html') && !apps.includes('shows.html'), `apps: ${apps}`);
        const theirs = await json('/v1/home/agents/choices', { headers: authB });
        assert(theirs.status === 200 && theirs.body.data.places.length === 0, `another account: ${JSON.stringify(theirs.body.data?.places)}`);
        assert((theirs.body.data.apps as any[]).every(x => x.filename !== 'digest.html'), 'another account read this account\'s apps');
        const agentToken = await json('/v1/home/agents/choices', { headers: auth(writer.token) });
        assert(agentToken.status === 403, `an agent token: ${agentToken.status}`);
    });

    await test('MCP: an agent of the owner says where a sibling\'s work goes, and takes it back', async () => {
        const call = await mcpSession(writer.token);
        const set = await call('aimeat_agent_workplace_set', { target_agent_name: 'quiet', organism_id: orgId, workspace_id: WS });
        assert(!set.isError, `set: ${set.text.slice(0, 200)}`);
        assert((await worker(a, 'quiet')).work_goes_to?.workspace_id === WS, 'the place did not show on the home');
        const bad = await call('aimeat_agent_workplace_set', { target_agent_name: 'quiet', organism_id: 'no-such-organism', workspace_id: WS });
        assert(bad.isError && bad.text.includes('NOT_FOUND'), `unknown organism: ${bad.text.slice(0, 200)}`);
        const clear = await call('aimeat_agent_workplace_set', { target_agent_name: 'quiet' });
        assert(!clear.isError, `clear: ${clear.text.slice(0, 200)}`);
        assert((await worker(a, 'quiet')).work_goes_to === null, 'the place was not cleared');
    });

    await test('MCP: an agent of the owner ties an app to an agent and unties it; another account\'s agent cannot', async () => {
        const call = await mcpSession(writer.token);
        const tied = await call('aimeat_app_agent_tie', { app: `${a.name}/digest.html`, target_agent_name: 'quiet', made_for: true });
        assert(!tied.isError, `tie: ${tied.text.slice(0, 200)}`);
        const w = await worker(a, 'quiet');
        assert(w.apps.length === 1 && w.apps[0].filename === 'digest.html' && w.apps[0].made_for === true, JSON.stringify(w.apps));
        const theirs = await keyedAgent(b, 'tier');
        const callB = await mcpSession(theirs.token);
        const not = await callB('aimeat_app_agent_tie', { app: `${a.name}/digest.html`, target_agent_name: 'quiet' });
        assert(not.isError && not.text.includes('FORBIDDEN'), `another account: ${not.text.slice(0, 200)}`);
        const gone = await call('aimeat_app_agent_untie', { app: `${a.name}/digest.html`, target_agent_name: 'quiet' });
        assert(!gone.isError, `untie: ${gone.text.slice(0, 200)}`);
        assert((await worker(a, 'quiet')).apps.length === 0, 'the tie was not removed');
    });

    // ── 4. The build instructions about one agent ──────────────────────────────
    await test('the agent section names the agent, shows its latest result as a structure, and gives the tie row', async () => {
        const r = await json(`/v1/prompts/build-app/agent/${writer.name}?part=context`, { headers: authA });
        assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const text = r.body.data.content as string;
        assert(r.body.data.has_result === true, 'has_result is false');
        assert(text.includes(writer.gaii), 'the agent identity is missing');
        assert(text.includes('"summary"') && text.includes('"items"'), 'the result structure is missing');
        // Structure, never content: the text of the result is not carried into the instructions.
        assert(!text.includes('Three things happened.') && !text.includes('example.test'), 'the result\'s own text is in the section');
        assert(text.includes(`"agent": "${writer.name}"`) && text.includes('"madeFor": true'), 'the tie row is missing');
    });

    await test('the whole prompt is that section in front of the build specification, with the spec token', async () => {
        const r = await json(`/v1/prompts/build-app/agent/${writer.name}?idea=${encodeURIComponent('Show the newest summary')}`, { headers: authA });
        assert(r.status === 200, `status ${r.status}`);
        const prompt = r.body.data.prompt as string;
        assert(prompt.startsWith('## This app shows the work of one agent'), 'the agent section is not first');
        assert(prompt.length > r.body.data.context.length + 10_000, 'the specification is missing');
        assert(typeof r.body.data.spec_token === 'string' && r.body.data.spec_token.length > 0, 'no spec token');
    });

    await test('an agent with no finished work says so instead of a structure', async () => {
        const r = await json('/v1/prompts/build-app/agent/quiet?part=context', { headers: authA });
        assert(r.status === 200 && r.body.data.has_result === false, `status ${r.status} has_result ${r.body.data?.has_result}`);
        assert((r.body.data.content as string).includes('no finished work yet'), 'the section does not say there is no work');
    });

    await test('the section about another account\'s agent is not found, and no token is refused', async () => {
        const other = await json(`/v1/prompts/build-app/agent/${writer.name}?part=context`, { headers: authB });
        assert(other.status === 404 && other.body.error?.code === 'AGENT_NOT_FOUND', `status ${other.status} ${other.body.error?.code}`);
        const anon = await json(`/v1/prompts/build-app/agent/${writer.name}?part=context`);
        assert(anon.status === 401, `no token: ${anon.status}`);
    });

    await test('MCP: the same section through aimeat_handbook_get, for the caller\'s own agent only', async () => {
        const call = await mcpSession(writer.token);
        const own = await call('aimeat_handbook_get', { tier: `build-app/agent/${writer.name}` });
        assert(!own.isError, `own: ${own.text.slice(0, 200)}`);
        assert(own.text.includes(writer.gaii) && own.text.includes('"madeFor": true'), 'the section is not the same text');
        const theirs = await keyedAgent(b, 'reader');
        const callB = await mcpSession(theirs.token);
        const not = await callB('aimeat_handbook_get', { tier: `build-app/agent/${writer.name}` });
        assert(not.isError && not.text.includes('AGENT_NOT_FOUND'), `another account: ${not.text.slice(0, 200)}`);
    });

    console.log(`\n  ${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
