/**
 * @file e2e-agent-refusals.ts
 * @description A refusal of an agent is kept where the owner, the task and the agent can see it.
 *
 *   Measured 2026-09-29 on a sold seat: a crew ran to exit 0 while the node refused its writes with
 *   SCOPE_DENIED. The customer's task stayed queued, and one `[scope-denied]` line in the node log
 *   was the only trace (wish-agentin-ajo-onnistuu-vaikka-node-kielt-sen-kirjoitukset-scop).
 *
 *   The claims, each separate:
 *     1. The approval keeps what the agent asked for beside what it was granted (the agent list).
 *     2. A refused call shows on the owner's agent list with the permission and the route.
 *     3. The agent reads the same refusal itself, and `since` after it hides it (the run window).
 *     4. The agent's open task carries a `scope_denied` event naming the permission.
 *     5. An agent cannot forge a `scope_denied` event, and another owner reads nothing.
 *     6. The owner declines: the refusal leaves the owner's list and the agent still reads it,
 *        flagged; the agent cannot decline for its owner.
 *     7. Granting the permission closes the refusal; deleting the agent removes its records.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=agent-refusals
 * @version-history
 *   v1.1.0 — 2026-09-30 — The owner's decline (POST /v1/agents/:name/refusals/decline).
 *   v1.0.0 — 2026-09-30 — Initial, with the feature.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const owner = `rfs${Date.now() % 100000}`;
const stranger = `rfx${Date.now() % 100000}`;
const AGENT = 'refused-runner';
/** A task runner's set with no agent:write, the permission PATCH /v1/agents/:name/tags needs. */
const WANTED = ['task:read', 'task:write', 'memory:read', 'memory:write'];

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

const sorted = (xs: string[] | undefined | null) => [...(xs ?? [])].sort().join(' ');

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body };
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

const auth = (token: string, opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${token}` } });

async function registerOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name} ${reg.status}: ${JSON.stringify(reg.body)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ name, owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }),
    });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}

/** The note is written after the 403 is sent, off the request, so a read polls briefly for it. */
async function eventually<T>(read: () => Promise<T>, ok: (v: T) => boolean, what: string): Promise<T> {
    let last: T | undefined;
    for (let i = 0; i < 40; i++) {
        last = await read();
        if (ok(last)) return last;
        await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`${what}: never true, last read ${JSON.stringify(last)}`);
}

let ownerToken = '';
let strangerToken = '';
let agentToken = '';
let taskId = '';

async function listedAgent(): Promise<any> {
    const r = await json('/v1/agents', auth(ownerToken));
    assert(r.status === 200, `list agents ${r.status}: ${JSON.stringify(r.body.error)}`);
    return (r.body.data.agents as any[]).find(x => x.name === AGENT);
}

console.log('\n=== Agent refusals E2E Tests ===\n');

await test('Register the owner and an unrelated second owner', async () => {
    ownerToken = await registerOwner(owner);
    strangerToken = await registerOwner(stranger);
    assert(ownerToken.length > 0 && strangerToken.length > 0, 'no owner tokens');
});

console.log('\nPhase 1: the approval keeps what was asked for');

await test('Connect an agent that asks for a task runner\'s set without agent:write', async () => {
    const a = await json('/v1/agents/device-authorize', {
        method: 'POST',
        body: JSON.stringify({ agent_name: AGENT, owner, mode: 'interactive', scopes: WANTED }),
    });
    assert(a.status === 200, `authorize ${a.status}: ${JSON.stringify(a.body.error)}`);
    const v = await json('/v1/agents/verify', {
        method: 'POST',
        body: JSON.stringify({ user_code: a.body.data.user_code, action: 'approve', owner_token: ownerToken }),
    });
    assert(v.status === 200, `verify ${v.status}: ${JSON.stringify(v.body.error)}`);
    const t = await json('/v1/agents/device-token', {
        method: 'POST',
        body: JSON.stringify({ device_code: a.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    agentToken = (t.body.access_token ?? t.body.token) as string;
    assert(typeof agentToken === 'string' && agentToken.split('.').length === 3, `no agent token: ${JSON.stringify(t.body)}`);
});

await test('The owner\'s agent list says what the agent asked for and what it got', async () => {
    const a = await listedAgent();
    assert(!!a, 'the agent is not in the owner\'s list');
    assert(a.scope_request && sorted(a.scope_request.requested) === sorted(WANTED),
        `scope_request.requested: ${JSON.stringify(a.scope_request)}`);
    assert(sorted(a.scope_request.granted) === sorted(WANTED), `scope_request.granted: ${JSON.stringify(a.scope_request)}`);
    assert(Array.isArray(a.refusals) && a.refusals.length === 0, `a new agent has no refusals: ${JSON.stringify(a.refusals)}`);
});

await test('The owner gives the agent a task, which waits on the agent', async () => {
    const r = await json(`/v1/agents/${AGENT}/tasks`, auth(ownerToken, {
        method: 'POST', body: JSON.stringify({ title: 'Tag yourself', description: 'Set your own tags.' }),
    }));
    assert(r.status === 201, `create task ${r.status}: ${JSON.stringify(r.body.error)}`);
    taskId = r.body.data.task?.id as string;
    assert(typeof taskId === 'string' && taskId.length > 0, `no task id: ${JSON.stringify(r.body.data)}`);
});

console.log('\nPhase 2: a refused call is kept');

const since = new Date(Date.now() - 1000).toISOString();

await test('The agent\'s write that needs agent:write is refused with SCOPE_DENIED', async () => {
    const r = await json(`/v1/agents/${AGENT}/tags`, auth(agentToken, { method: 'PATCH', body: JSON.stringify({ tags: ['x'] }) }));
    assert(r.status === 403 && r.body.error?.code === 'SCOPE_DENIED', `expected 403 SCOPE_DENIED, got ${r.status} ${JSON.stringify(r.body.error)}`);
});

await test('The owner\'s agent list shows the refusal: the permission and the route', async () => {
    const a = await eventually(listedAgent, (x) => (x?.refusals?.length ?? 0) > 0, 'refusal on the agent list');
    const f = a.refusals[0];
    assert(sorted(f.needed) === 'agent:write', `needed: ${JSON.stringify(f)}`);
    assert(f.call === 'PATCH /v1/agents/:name/tags', `call: ${JSON.stringify(f)}`);
    assert(f.count === 1 && f.any_of === false, `count/any_of: ${JSON.stringify(f)}`);
});

await test('The agent reads the same refusal itself, and a later `since` hides it', async () => {
    const r = await json(`/v1/agents/${AGENT}/refusals?since=${encodeURIComponent(since)}`, auth(agentToken));
    assert(r.status === 200, `refusals ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.refusals.length === 1 && r.body.data.refusals[0].needed[0] === 'agent:write',
        `refusals: ${JSON.stringify(r.body.data.refusals)}`);
    assert(sorted(r.body.data.granted_scopes) === sorted(WANTED), `granted: ${JSON.stringify(r.body.data.granted_scopes)}`);
    const later = new Date(Date.now() + 60_000).toISOString();
    const r2 = await json(`/v1/agents/${AGENT}/refusals?since=${encodeURIComponent(later)}`, auth(agentToken));
    assert(r2.status === 200 && r2.body.data.refusals.length === 0, `since after the refusal: ${JSON.stringify(r2.body.data)}`);
});

await test('The agent\'s open task carries a scope_denied event naming the permission', async () => {
    const events = await eventually(async () => {
        const r = await json(`/v1/agents/${AGENT}/tasks/${taskId}/events`, auth(ownerToken));
        assert(r.status === 200, `events ${r.status}: ${JSON.stringify(r.body.error)}`);
        return (r.body.data.events ?? []) as any[];
    }, (evs) => evs.some(e => e.type === 'scope_denied'), 'scope_denied event on the task');
    const e = events.find(x => x.type === 'scope_denied');
    assert(JSON.stringify(e.details?.needed) === '["agent:write"]', `details: ${JSON.stringify(e.details)}`);
    assert(String(e.message).includes('agent:write'), `message: ${e.message}`);
});

console.log('\nPhase 3: the boundaries');

await test('The agent cannot write a scope_denied event of its own', async () => {
    // Make the task active first: the event route takes events only on an active task, and a
    // refusal there must be for the type, not for the state. An interactive agent's task waits
    // queued for the owner's start, so this start moves it.
    const s = await json(`/v1/agents/${AGENT}/tasks/${taskId}/start`, auth(ownerToken, { method: 'POST', body: '{}' }));
    assert(s.status === 200, `start ${s.status}: ${JSON.stringify(s.body.error)}`);
    const r = await json(`/v1/agents/${AGENT}/tasks/${taskId}/event`, auth(agentToken, {
        method: 'POST', body: JSON.stringify({ type: 'scope_denied', message: 'forged' }),
    }));
    assert(r.status === 400, `a forged scope_denied must be refused, got ${r.status} ${JSON.stringify(r.body)}`);
});

await test('Another owner reads none of it', async () => {
    // The name is read under the caller's own account, so another owner asks about an agent they do
    // not have: 404, and nothing of this agent's in the body.
    const r = await json(`/v1/agents/${AGENT}/refusals`, auth(strangerToken));
    assert(r.status === 404, `another owner: ${r.status} ${JSON.stringify(r.body)}`);
    const l = await json('/v1/agents', auth(strangerToken));
    assert(!(l.body.data.agents as any[]).some(x => x.name === AGENT), 'another owner\'s list carried the agent');
});

console.log('\nPhase 4: the owner declines');

await test('A second refusal, for a permission the owner will not give, joins the first', async () => {
    const r = await json('/v1/ai-transparency/mine', auth(agentToken));
    assert(r.status === 403 && r.body.error?.code === 'SCOPE_DENIED', `expected 403 SCOPE_DENIED, got ${r.status} ${JSON.stringify(r.body.error)}`);
    const a = await eventually(listedAgent, (x) => (x?.refusals?.length ?? 0) === 2, 'two refusals on the agent list');
    assert(a.refusals.some((f: any) => f.needed[0] === 'wallet:read'), `refusals: ${JSON.stringify(a.refusals)}`);
});

await test('The agent cannot decline its own refusals', async () => {
    const r = await json(`/v1/agents/${AGENT}/refusals/decline`, auth(agentToken, { method: 'POST', body: '{}' }));
    assert(r.status === 403, `an agent declining for its owner: ${r.status} ${JSON.stringify(r.body)}`);
});

await test('The owner declines one permission: it leaves the list, the agent is still told', async () => {
    const d = await json(`/v1/agents/${AGENT}/refusals/decline`, auth(ownerToken, { method: 'POST', body: JSON.stringify({ needed: ['wallet:read'] }) }));
    assert(d.status === 200 && d.body.data.declined === 1, `decline: ${d.status} ${JSON.stringify(d.body)}`);
    const a = await listedAgent();
    assert(a.refusals.length === 1 && a.refusals[0].needed[0] === 'agent:write', `owner list after decline: ${JSON.stringify(a.refusals)}`);
    const r = await json(`/v1/agents/${AGENT}/refusals`, auth(agentToken));
    const w = (r.body.data.refusals as any[]).find(f => f.needed[0] === 'wallet:read');
    assert(w && w.declined === true, `the agent's own read: ${JSON.stringify(r.body.data.refusals)}`);
});

await test('A declined permission stays declined when the agent tries it on another route', async () => {
    const r = await json('/v1/app-store/purchases', auth(agentToken));
    assert(r.status === 403 && r.body.error?.code === 'SCOPE_DENIED', `expected 403 SCOPE_DENIED, got ${r.status} ${JSON.stringify(r.body.error)}`);
    // The agent's own read shows the new call, declined; the owner's list still has only agent:write.
    const own = await eventually(async () => {
        const x = await json(`/v1/agents/${AGENT}/refusals`, auth(agentToken));
        return (x.body.data.refusals ?? []) as any[];
    }, (list) => list.some(f => f.call === 'GET /v1/app-store/purchases'), 'the second wallet:read call on the agent\'s own read');
    assert(own.find(f => f.call === 'GET /v1/app-store/purchases').declined === true, `not declined: ${JSON.stringify(own)}`);
    const a = await listedAgent();
    assert(a.refusals.length === 1 && a.refusals[0].needed[0] === 'agent:write', `owner list: ${JSON.stringify(a.refusals)}`);
});

console.log('\nPhase 5: how it goes stale');

await test('Granting the permission closes the refusal on the next read', async () => {
    const g = await json(`/v1/agents/${AGENT}/scopes`, auth(ownerToken, {
        method: 'PATCH', body: JSON.stringify({ scopes: [...WANTED, 'agent:write'] }),
    }));
    assert(g.status === 200, `grant ${g.status}: ${JSON.stringify(g.body.error)}`);
    const a = await listedAgent();
    assert(Array.isArray(a.refusals) && a.refusals.length === 0, `still refused after the grant: ${JSON.stringify(a.refusals)}`);
});

await test('Deleting the agent removes its refusal and approval records', async () => {
    const d = await json(`/v1/agents/${AGENT}`, auth(ownerToken, { method: 'DELETE' }));
    assert(d.status === 200, `delete ${d.status}: ${JSON.stringify(d.body.error)}`);
    const m = await json(`/v1/memory?prefix=${encodeURIComponent(`audit.agents.${AGENT}.`)}`, auth(ownerToken));
    assert(m.status === 200, `memory list ${m.status}: ${JSON.stringify(m.body.error)}`);
    const items = (m.body.data.items ?? m.body.data.memories ?? m.body.data ?? []) as any[];
    assert(Array.isArray(items) && items.length === 0, `records left behind: ${JSON.stringify(items).slice(0, 300)}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
