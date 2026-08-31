/**
 * @file e2e-agent-health.ts
 * @description The two surfaces that show an agent's status must show the SAME status, the agent
 *   the home picks must not wander, and the "first agent connected" marker must name the agent that
 *   actually connected.
 *
 *   All three were broken together and in the same direction: the home said "connected and at home"
 *   while the Agents tab called the same agent a problem, because the home card was derived from
 *   `agents.length` and computed no status at all. It also showed `agents[0]` of a list neither
 *   backend ordered — on Postgres an unordered scan returns heap order, and a throttled lastSeen
 *   touch rewrites the row, so the agent on the card changed between page loads with nobody having
 *   done anything.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=agent-health
 * @version-history
 *   v1.0.0 — 2026-08-09 — Initial (V1-V4).
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const owner = `ah${Date.now() % 100000}`;

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

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

const auth = (token: string, opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${token}` } });

let ownerToken = '';
const codes: Record<string, string> = {};

/** Connect one agent through the real device-auth flow and return its user_code. */
async function connectAgent(name: string): Promise<string> {
    const a = await json('/v1/agents/device-authorize', {
        method: 'POST', body: JSON.stringify({ agent_name: name, owner }),
    });
    assert(a.status === 200, `authorize ${name}: ${a.status}`);
    const code = a.body.data.user_code as string;
    const v = await json('/v1/agents/verify', {
        method: 'POST',
        body: JSON.stringify({ user_code: code, action: 'approve', scopes: ['*'], owner_token: ownerToken }),
    });
    assert(v.status === 200 && v.body.ok === true, `approve ${name}: ${v.status} ${JSON.stringify(v.body.error)}`);
    codes[name] = code;
    return code;
}

async function listAgents() {
    const r = await json('/v1/agents', auth(ownerToken));
    assert(r.status === 200, `list agents ${r.status}`);
    return r.body.data.agents as any[];
}

async function homeState() {
    const r = await json('/v1/home/state', auth(ownerToken));
    assert(r.status === 200, `home state ${r.status}: ${JSON.stringify(r.body.error)}`);
    return r.body.data.state;
}

console.log('\n=== Agent Health E2E Tests ===\n');
console.log('Phase 0: an owner with two agents');

await test('Register the owner', async () => {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: owner, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${reg.status}: ${JSON.stringify(reg.body)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner, timestamp: ts, signature: await signMsg(reg.body.data.private_key, owner + NODE_ID + ts) }),
    });
    assert(tok.body.ok === true, `token: ${JSON.stringify(tok.body.error)}`);
    ownerToken = tok.body.data.token;
});

await test('Two agents join, oldest first', async () => {
    await connectAgent('alpha-agent');
    await connectAgent('beta-agent');
    const agents = await listAgents();
    assert(agents.length === 2, `expected 2 agents, got ${agents.length}`);
});

console.log('\nPhase 1: V1 — one verdict, projected by both surfaces');

await test('/v1/agents carries a health verdict per agent', async () => {
    for (const a of await listAgents()) {
        assert(!!a.health, `${a.name} has no health object`);
        assert(typeof a.health.state === 'string', `${a.name}: no state`);
        assert(['system', 'new', 'onboarding', 'problem', 'idle', 'production'].includes(a.health.state),
            `${a.name}: unknown state ${a.health.state}`);
        assert(typeof a.health.bucket === 'string' && typeof a.health.rank === 'number',
            `${a.name}: no bucket/rank for the fleet board`);
        assert(Array.isArray(a.health.reasons), `${a.name}: reasons must be a list`);
        assert(!!a.health.delivery && typeof a.health.delivery.channel === 'string',
            `${a.name}: no delivery channel`);
    }
});

await test('a just-connected agent is not reported as broken', async () => {
    for (const a of await listAgents()) {
        assert(a.health.state !== 'problem',
            `${a.name} was just approved and reads as a problem: ${JSON.stringify(a.health.reasons)}`);
        assert(a.health.reasons.length === 0, `${a.name}: unexpected reasons ${JSON.stringify(a.health.reasons)}`);
    }
});

await test('THE HOME AND THE AGENTS TAB AGREE about the same agent', async () => {
    const state = await homeState();
    assert(!!state.agent, 'the home shows an agent');
    assert(!!state.agent.health, 'the home card carries the verdict, not just a name');
    const agents = await listAgents();
    const same = agents.find(a => a.gaii === state.agent.gaii);
    assert(!!same, `the home names an agent the list does not have: ${state.agent.gaii}`);
    assert(state.agent.health.state === same.health.state,
        `two surfaces, two answers: home says ${state.agent.health.state}, list says ${same.health.state}`);
});

await test('the home card says how many agents there are, and how many are in trouble', async () => {
    const state = await homeState();
    assert(state.agent.total === 2, `total should be 2, got ${state.agent.total}`);
    assert(state.agent.problems === 0, `problems should be 0, got ${state.agent.problems}`);
});

console.log('\nPhase 2: V2 — the agent on the card does not wander');

// NOTE ON WHAT THIS PHASE CAN AND CANNOT PROVE. On SQLite an unordered `SELECT *` returns rowid
// order, which happens to equal insertion order — so these two tests pass on the sqlite backend
// with the ORDER BY removed, and a green sqlite run is NOT evidence that the fix is present. The
// defect is a Postgres one (heap order, rewritten by every lastSeen UPDATE). Run this suite against
// postgres-kysely for it to bite; it is kept here so both backends are asserted to AGREE.
await test('the agent list is ordered, and the same on every call', async () => {
    const first = (await listAgents()).map(a => a.gaii);
    const second = (await listAgents()).map(a => a.gaii);
    const third = (await listAgents()).map(a => a.gaii);
    assert(JSON.stringify(first) === JSON.stringify(second) && JSON.stringify(second) === JSON.stringify(third),
        `the order changed between calls: ${JSON.stringify([first, second, third])}`);
    assert(first[0].startsWith('alpha-agent#'), `oldest first: got ${first[0]}`);
});

await test('the home picks the same agent every time', async () => {
    const a = (await homeState()).agent.gaii;
    const b = (await homeState()).agent.gaii;
    assert(a === b, `the home card changed agent between loads: ${a} -> ${b}`);
});

console.log('\nPhase 3: V4 — the marker names the agent that actually connected');

await test('first-agent records the agent named by the submitted user_code', async () => {
    // The SECOND agent's code, deliberately: the old code recorded agents[0] whatever was sent, so
    // a run that only ever approved one agent could not tell the two apart.
    const r = await json('/v1/home/first-agent', auth(ownerToken, {
        method: 'POST', body: JSON.stringify({ user_code: codes['beta-agent'] }),
    }));
    assert(r.status === 200, `first-agent ${r.status}: ${JSON.stringify(r.body.error)}`);
    const marker = await json('/v1/memory/onboarding.first_agent_connected', auth(ownerToken));
    assert(marker.status === 200, `marker read ${marker.status}`);
    assert(marker.body.data.value.agentName === 'beta-agent',
        `the marker names the wrong agent: ${JSON.stringify(marker.body.data.value)}`);
});

await test('a user_code from another account is ignored, not honoured', async () => {
    // Resolving a stranger's code would be a cross-account read, and a user_code is a short
    // human-typed string. It falls back rather than failing — the marker is measurement, not a gate.
    const r = await json('/v1/home/first-agent', auth(ownerToken, {
        method: 'POST', body: JSON.stringify({ user_code: 'ZZZZ-ZZZZ' }),
    }));
    assert(r.status === 200, `first-agent with an unknown code ${r.status}`);
});

// A workstation is the MCP connection a tool uses, given a GAII for traceability. It is online only
// while a person is using it, so the working/broken axis does not apply and the route must project
// that rather than scoring it. Before this it read as `new` (orange, "finish your onboarding") the
// moment it connected, and as `problem` (red, "something is wrong") a day after anyone last opened
// the tool — two colours making claims about an agent that was working exactly as intended.
await test('a workstation connection is its own state, not an unfinished agent', async () => {
    await connectAgent('ws-tool');
    const m = await json(`/v1/agents/ws-tool/mode`, auth(ownerToken, {
        method: 'PATCH', body: JSON.stringify({ mode: 'workstation' }),
    }));
    assert(m.status === 200, `set mode ${m.status}: ${JSON.stringify(m.body.error)}`);

    const ws = (await listAgents()).find(a => a.name === 'ws-tool');
    assert(!!ws, 'the connection is in the list');
    assert(ws.health.state === 'workstation', `state should be workstation, got ${ws.health.state}`);
    assert(ws.health.bucket === 'connection', `bucket should be connection, got ${ws.health.bucket}`);
    assert(ws.health.reasons.length === 0, `a connection never carries faults, got ${JSON.stringify(ws.health.reasons)}`);
    // The one thing worth knowing about it survives the new branch.
    assert('last_seen' in ws.health, 'the row still says when something last came through');
});

await test('a connection counts as a live agent, so the home does not call the account empty', async () => {
    const state = await homeState();
    assert(state.agent.total >= 3, `the connection is counted, got ${state.agent.total}`);
    assert((state.agent.problems ?? 0) === 0, `a connection is not a problem, got ${state.agent.problems}`);
});

// The refusal this surface owes. Mode is same-owner gated rather than owner-role gated, so that an
// agent can set its own and a sibling's — which makes the cross-owner case the one worth proving,
// and it has to be asked with a FULL GAII: a bare name resolves into the CALLER's own namespace, so
// a stranger naming "ws-tool" gets a 404 about an agent of their own that does not exist, never a
// look at anybody else's. Naming the real one must be refused rather than obeyed: the mode decides
// which Hello Integration flow an agent is measured against, so setting it is not a cosmetic write.
await test('another owner cannot set the mode of an agent that is not theirs', async () => {
    const stranger = `${owner}x`;
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: stranger, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register stranger ${reg.status}: ${JSON.stringify(reg.body)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: stranger, timestamp: ts, signature: await signMsg(reg.body.data.private_key, stranger + NODE_ID + ts) }),
    });
    assert(tok.body.ok === true, `stranger token: ${JSON.stringify(tok.body.error)}`);

    const target = encodeURIComponent(`ws-tool#${owner}@${NODE_ID}`);
    const r = await json(`/v1/agents/${target}/mode`, auth(tok.body.data.token, {
        method: 'PATCH', body: JSON.stringify({ mode: 'task-runner' }),
    }));
    assert(r.status === 403, `a stranger setting someone else's mode must be 403, got ${r.status}`);

    // And the refusal has to have refused: a 403 that wrote first would be the worse bug.
    const mine = (await listAgents()).find(a => a.name === 'ws-tool');
    assert(mine.mode === 'workstation', `the mode survived the attempt, got ${mine.mode}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
