/**
 * @file test/e2e-operator-override.ts
 * @description One operator check on both surfaces (secaudit 2026-10, C2). A REST route that serves a
 *   thing's own owner or the operator admits the operator's agent holding operator:admin, as the MCP
 *   tools do, refuses the operator's agent without it, and writes the operator trail in the other
 *   person's account feed when the operator acts there. The board rules route stands for every route
 *   moved to services/operator-override.ts.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-operator-override
 * @version-history
 *   v1.1.0 — 2026-10-10 — An operator's schema write refused for its semantic context leaves no
 *     operator trail (secaudit 2026-10-10 I8).
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, C2).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`✅ ${name}`); }
    catch (e) { failed++; console.log(`❌ ${name}: ${(e as Error).message}`); }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
        });
        if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1200)); continue; }
        const text = await res.text();
        let body: any;
        try { body = JSON.parse(text); } catch { body = { _raw: text }; }
        return { status: res.status, body };
    }
}

(ed as any).hashes.sha512 = (...msgs: Uint8Array[]) => {
    const h = createHash('sha512');
    for (const m of msgs) h.update(m);
    return new Uint8Array(h.digest());
};
async function signMsg(privB64: string, msg: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

const authed = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

async function makeOwner(name: string): Promise<{ token: string; owner: string }> {
    const owner = `${name}${Date.now().toString(36).slice(-6)}`;
    for (let attempt = 0; ; attempt++) {
        const reg = await json('/v1/ghii', {
            method: 'POST',
            body: JSON.stringify({ username: owner, display_name: owner, password: 'OperatorOverride1234' }),
        });
        if (reg.status === 429 && attempt < 8) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        assert(reg.status === 201, `registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
        const privKey = reg.body.data.private_key as string;
        const timestamp = new Date().toISOString();
        const signature = await signMsg(privKey, owner + NODE_ID + timestamp);
        const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner, timestamp, signature }) });
        assert(tok.status === 200, `token failed: ${tok.status}`);
        return { token: tok.body.data.token as string, owner };
    }
}

async function makeAgent(ownerCtx: { token: string; owner: string }, scopes: string[]): Promise<string> {
    const name = `oo${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1000)}`;
    const reg = await json('/v1/agents', {
        method: 'POST', headers: authed(ownerCtx.token),
        body: JSON.stringify({ name, owner: ownerCtx.owner, scopes }),
    });
    assert(reg.status === 201, `agent registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const privKey = reg.body.data.private_key as string;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(privKey, gaii + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature }) });
    assert(tok.status === 200, `agent token failed: ${tok.status}`);
    return tok.body.data.token as string;
}

async function operatorTrail(token: string): Promise<any[]> {
    const r = await json('/v1/account/events?limit=200', { headers: authed(token) });
    assert(r.status === 200, `account events: ${r.status} ${JSON.stringify(r.body)}`);
    return (r.body.data.events as any[]).filter((e) => e.kind === 'operator_acted');
}

console.log('═══ E2E: one operator check on REST and MCP (C2) ═══');
console.log(`Base: ${BASE}`);

// The first owner on the runner's emptied database is the operator.
const OP = await makeOwner('ooop');
const B = await makeOwner('ooother');
const plainAgent = await makeAgent(OP, ['social:read', 'social:write']);
const opAgent = await makeAgent(OP, ['social:read', 'social:write', 'operator:admin']);
let boardId = '';

await test('Setup: another person keeps a board', async () => {
    const r = await json('/v1/boards', {
        method: 'POST', headers: authed(B.token),
        body: JSON.stringify({ name: `oo-${Date.now().toString(36)}`, visibility: 'private' }),
    });
    assert(r.status === 201, `board create: ${r.status} ${JSON.stringify(r.body)}`);
    boardId = r.body.data.id ?? r.body.data.board?.id;
    assert(boardId, `board id in ${JSON.stringify(r.body.data)}`);
});

await test('FAILURE: the operator\'s agent without operator:admin cannot set another person\'s board rules', async () => {
    const r = await json(`/v1/boards/${boardId}/rules`, {
        method: 'PATCH', headers: authed(plainAgent), body: JSON.stringify({ rules: { posting: 'owner' } }),
    });
    assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body)}`);
    assert((await operatorTrail(B.token)).length === 0, 'a refused attempt wrote an operator trail');
});

await test('The operator\'s agent holding operator:admin sets them on REST, as it may on MCP', async () => {
    const r = await json(`/v1/boards/${boardId}/rules`, {
        method: 'PATCH', headers: authed(opAgent), body: JSON.stringify({ rules: { posting: 'owner' } }),
    });
    assert(r.status === 200, `expected 200, got ${r.status} ${JSON.stringify(r.body)}`);
    assert(r.body.data.rules?.posting === 'owner', `rules echoed: ${JSON.stringify(r.body.data)}`);
});

await test('The person reads in their account feed that the operator acted on their board', async () => {
    const acted = (await operatorTrail(B.token)).filter((e) => e.data?.area === 'board');
    assert(acted.length === 1, `one operator_acted event for the board, got ${acted.length}`);
    assert(acted[0].data.action === 'rules', `action: ${JSON.stringify(acted[0].data)}`);
});

await test('The operator in person still passes, and the trail names that act too', async () => {
    const r = await json(`/v1/boards/${boardId}/rules`, {
        method: 'PATCH', headers: authed(OP.token), body: JSON.stringify({ rules: null }),
    });
    assert(r.status === 200, `expected 200, got ${r.status} ${JSON.stringify(r.body)}`);
    assert((await operatorTrail(B.token)).filter((e) => e.data?.area === 'board').length === 2, 'the second act is in the feed');
});

await test('A board of the operator\'s own leaves no trail', async () => {
    const c = await json('/v1/boards', {
        method: 'POST', headers: authed(opAgent),
        body: JSON.stringify({ name: `oo-own-${Date.now().toString(36)}`, visibility: 'private' }),
    });
    assert(c.status === 201, `own board: ${c.status} ${JSON.stringify(c.body)}`);
    const id = c.body.data.id ?? c.body.data.board?.id;
    const r = await json(`/v1/boards/${id}/rules`, {
        method: 'PATCH', headers: authed(opAgent), body: JSON.stringify({ rules: { posting: 'owner' } }),
    });
    assert(r.status === 200, `own rules: ${r.status} ${JSON.stringify(r.body)}`);
    assert((await operatorTrail(OP.token)).length === 0, 'the operator\'s own board wrote an operator trail');
});

await test('FAILURE: the operator\'s schema write refused for its semantic context leaves no trail (secaudit 2026-10-10 I8)', async () => {
    const key = `oo-schema-${Date.now().toString(36)}`;
    const schema = { type: 'object', properties: { temperature: { type: 'number' } } };
    const own = await json(`/v1/memory/${encodeURIComponent(key)}/schema`, {
        method: 'PUT', headers: authed(B.token), body: JSON.stringify({ schema, apply_to: 'exact', schema_mode: 'open' }),
    });
    assert(own.status === 200, `the person locks a schema: ${own.status} ${JSON.stringify(own.body)}`);
    const r = await json(`/v1/memory/${encodeURIComponent(key)}/schema`, {
        method: 'PUT', headers: authed(OP.token),
        body: JSON.stringify({ schema, apply_to: 'exact', schema_mode: 'open', semantic_context: { '@type': 'weather:Reading' } }),
    });
    assert(r.status === 400, `expected 400, got ${r.status} ${JSON.stringify(r.body)}`);
    assert(r.body.error?.code === 'INVALID_SEMANTIC_CONTEXT', `code: ${r.body.error?.code}`);
    const trail = (await operatorTrail(B.token)).filter((e) => e.data?.area === 'schema');
    assert(trail.length === 0, `a refused schema write wrote an operator trail: ${trail.length}`);
});

await test('An operator route (requireOperator) admits the operator\'s agent on operator:admin and refuses it without', async () => {
    const yes = await json('/v1/admin/stats', { headers: authed(opAgent) });
    assert(yes.status === 200, `with operator:admin: expected 200, got ${yes.status} ${JSON.stringify(yes.body)}`);
    const no = await json('/v1/admin/stats', { headers: authed(plainAgent) });
    assert(no.status === 403, `without operator:admin: expected 403, got ${no.status}`);
    const other = await json('/v1/admin/stats', { headers: authed(B.token) });
    assert(other.status === 403, `another owner: expected 403, got ${other.status}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
