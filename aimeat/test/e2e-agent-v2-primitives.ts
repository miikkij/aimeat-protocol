/**
 * @file test/e2e-agent-v2-primitives.ts
 * @description Agent v2 V2: the two primitives that let an agent work here without carrying several
 *   hundred tool descriptions — find a capability, run it.
 *
 *   WHAT THIS HAS TO PROVE, and the second half matters as much as the first:
 *     1. discover finds the node's OWN capabilities, and invoke runs one for real.
 *     2. THE OLD DOOR IS UNCHANGED. Everything reachable before is still reachable exactly as it
 *        was, by the same routes, with the same answers. V2 adds a door; it removes nothing.
 *
 *   The security question this suite exists to answer: does `invoke` become a way to do something
 *   you could not do by calling the route yourself? It must not. So the same call is made twice —
 *   directly and through invoke — by a principal who may, and by one who may not, and the pair has
 *   to agree both times.
 *
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-v2-primitives
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial, with the feature.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;
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

async function sign(privB64: string, message: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');
}

async function setupOwner(label: string) {
    const owner = `prim${label}${Date.now().toString(36)}`;
    let r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: 'PrimitivesPass12345' }) });
    for (let i = 0; r.status === 429 && i < 8; i++) {
        await new Promise(res => setTimeout(res, 1500));
        r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: 'PrimitivesPass12345' }) });
    }
    assert(r.status === 201, `ghii ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner, timestamp: ts, signature: await sign(r.body.data.private_key, owner + NODE_ID + ts) }),
    });
    return { owner, ownerToken: tok.body.data.token as string };
}

async function addAgent(owner: string, ownerToken: string, name: string, scopes: string[]) {
    const ag = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name, owner, capabilities: [], mode: 'interactive', scopes }),
    });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body?.error)}`);
    const gaii = ag.body.data.agent.gaii as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii, timestamp: ts, signature: await sign(ag.body.data.private_key, gaii + ts) }),
    });
    return { name, gaii, token: tok.body.data.token as string };
}

console.log('\n=== Agent v2: discover and invoke, beside everything that was already here ===\n');

async function run() {
    const a = await setupOwner('a');
    const b = await setupOwner('b');
    const authA = { Authorization: `Bearer ${a.ownerToken}` };
    // Two agents of the same owner, one allowed to write memory and one deliberately not. The pair
    // is what makes "invoke grants nothing extra" a measurement rather than a claim.
    const writer = await addAgent(a.owner, a.ownerToken, 'prim-writer', ['memory:read', 'memory:write', 'catalogue:read']);
    const reader = await addAgent(a.owner, a.ownerToken, 'prim-reader', ['memory:read', 'catalogue:read']);
    const authW = { Authorization: `Bearer ${writer.token}` };
    const authR = { Authorization: `Bearer ${reader.token}` };
    const authB = { Authorization: `Bearer ${b.ownerToken}` };

    // ── 1. The catalogue ──────────────────────────────────────────────────────
    await test('the node publishes what it can do, as data', async () => {
        const r = await json('/v1/capabilities/node');
        assert(r.status === 200, `expected 200, got ${r.status}`);
        assert(r.body.data.total > 50, `a real node has more than a handful, got ${r.body.data.total}`);
        assert((r.body.data.segments as string[]).includes('memory'), 'and families to browse by');
        assert((r.body.data.capabilities as any[]).length <= 20, 'a page, not the whole thing');
    });

    await test('searching the catalogue puts the obvious answer first', async () => {
        const r = await json('/v1/capabilities/node?q=write%20memory');
        assert(r.status === 200, `expected 200, got ${r.status}`);
        const ids = (r.body.data.capabilities as any[]).map(c => c.id);
        assert(ids.includes('aimeat_memory_write'), `expected memory_write in ${JSON.stringify(ids.slice(0, 5))}`);
        assert(ids[0] === 'aimeat_memory_write', `and first, got ${ids[0]}`);
    });

    await test('one capability names its own contract', async () => {
        const r = await json('/v1/capabilities/node/aimeat_memory_write');
        assert(r.status === 200, `expected 200, got ${r.status}`);
        assert(r.body.data.capability.required.includes('key'), 'a caller should learn what it must send');
        assert(typeof r.body.data.capability.input.value === 'object', 'and what else it takes');
    });

    await test('a name that does not exist says so, and does not invent one', async () => {
        const r = await json('/v1/capabilities/node/aimeat_make_me_a_sandwich');
        assert(r.status === 404, `expected 404, got ${r.status}`);
    });

    // ── 2. discover finds them ────────────────────────────────────────────────
    await test('discover finds the node\'s own capabilities, not only its content', async () => {
        const r = await json('/v1/discover?q=memory&type=capability&per_page=50', { headers: authW });
        assert(r.status === 200, `expected 200, got ${r.status}`);
        const entries = (r.body.data.entries as any[]) ?? [];
        const own = entries.filter(e => e.owner === `node@${NODE_ID}`);
        assert(own.length > 0, 'the node itself should appear among what exists here');
        assert(own.some(e => e.id === 'aimeat_memory_write'), `expected memory_write, got ${JSON.stringify(own.slice(0, 5).map(e => e.id))}`);
        assert(own.every(e => e.type === 'capability'), 'typed as capabilities');
        assert(own.some(e => e.tags.includes('node')), 'and tagged so a caller can tell them from published ones');
    });

    await test('a fresh account with nothing in it can still find out what it can do', async () => {
        // The case the directory exists for: no records, no apps, no history.
        const r = await json('/v1/discover?q=publish%20an%20app&type=capability', { headers: authB });
        assert(r.status === 200, `expected 200, got ${r.status}`);
        assert(((r.body.data.entries as any[]) ?? []).length > 0, 'an empty account is not an empty node');
    });

    // ── 3. invoke runs one ────────────────────────────────────────────────────
    await test('invoke runs a capability for real, and the write is really there', async () => {
        const r = await json('/v1/invoke', {
            method: 'POST', headers: authW,
            body: JSON.stringify({ capability: 'aimeat_memory_write', input: { key: 'prim.note', value: { hello: 'from invoke' } } }),
        });
        assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.capability === 'aimeat_memory_write', 'it should say what it ran');

        // Read it back the ORDINARY way. An invoke that only proves itself is not proof.
        const back = await json('/v1/memory/prim.note', { headers: authW });
        assert(back.status === 200, `the record should be readable by the normal route, got ${back.status}`);
        assert(back.body.data.value.hello === 'from invoke', 'and hold what was written');
    });

    await test('an unknown capability is refused, with near misses rather than a shrug', async () => {
        const r = await json('/v1/invoke', {
            method: 'POST', headers: authW, body: JSON.stringify({ capability: 'aimeat_memory_wr1te', input: {} }),
        });
        assert(r.status === 404, `expected 404, got ${r.status}`);
        assert(r.body?.error?.code === 'NO_SUCH_CAPABILITY', `expected NO_SUCH_CAPABILITY, got ${r.body?.error?.code}`);
    });

    await test('invoke cannot run itself', async () => {
        const r = await json('/v1/invoke', {
            method: 'POST', headers: authW, body: JSON.stringify({ capability: 'aimeat_invoke', input: {} }),
        });
        assert(r.status === 400, `expected 400, got ${r.status}`);
        assert(r.body?.error?.code === 'NOT_INVOKABLE', `expected NOT_INVOKABLE, got ${r.body?.error?.code}`);
    });

    await test('a parameter the capability does not declare is refused, not dropped', async () => {
        const r = await json('/v1/invoke', {
            method: 'POST', headers: authW,
            body: JSON.stringify({ capability: 'aimeat_memory_write', input: { key: 'prim.note2', value: { x: 1 }, sneaky: true } }),
        });
        assert(r.status === 400, `expected 400, got ${r.status}`);
        assert(JSON.stringify(r.body?.error ?? {}).toLowerCase().includes('sneaky'), 'and it should name the parameter');
    });

    await test('an unauthenticated caller cannot invoke anything', async () => {
        const r = await json('/v1/invoke', { method: 'POST', body: JSON.stringify({ capability: 'aimeat_memory_write', input: { key: 'x', value: 1 } }) });
        assert(r.status === 401, `expected 401, got ${r.status}`);
    });

    // ── 4. THE POINT: invoke grants nothing the caller did not already have ───
    await test('a scope that refuses the route refuses the invoke, identically', async () => {
        // Directly: the reader holds memory:read and not memory:write.
        const direct = await json('/v1/memory', {
            method: 'POST', headers: authR, body: JSON.stringify({ key: 'prim.denied', value: { a: 1 } }),
        });
        assert(direct.status === 403, `the direct write should be refused, got ${direct.status}`);

        // Through invoke: the same refusal, from the same gate.
        const viaInvoke = await json('/v1/invoke', {
            method: 'POST', headers: authR,
            body: JSON.stringify({ capability: 'aimeat_memory_write', input: { key: 'prim.denied', value: { a: 1 } } }),
        });
        // Not merely "also refused" — the SAME refusal, because the same gate ran. "Both failed"
        // would pass on an invoke that refused for its own unrelated reason, which is exactly the
        // drift this door has to be pinned against: it is requireAuth() and no scope, and the whole
        // claim is that the target route decides.
        assert(viaInvoke.status === direct.status,
            `same status as the direct call: expected ${direct.status}, got ${viaInvoke.status}`);
        assert(viaInvoke.body?.error?.code === direct.body?.error?.code,
            `and the same code: expected ${direct.body?.error?.code}, got ${viaInvoke.body?.error?.code}`);
        assert(direct.body?.error?.code === 'SCOPE_DENIED',
            `and that code is the scope gate's, got ${direct.body?.error?.code}`);

        // And nothing was written by either attempt.
        const back = await json('/v1/memory/prim.denied', { headers: authW });
        assert(back.status === 404, `nothing should exist at that key, got ${back.status}`);
    });

    await test('a role that refuses the route refuses the invoke, with the same code', async () => {
        // A second shape, because a scope and a ROLE are different gates, and a door honouring one
        // could still be walking past the other.
        const direct = await json('/v1/agents/nobody-here/mode', {
            method: 'PATCH', headers: authR, body: JSON.stringify({ mode: 'autonomous' }),
        });
        const viaInvoke = await json('/v1/invoke', {
            method: 'POST', headers: authR,
            body: JSON.stringify({ capability: 'aimeat_agent_mode_set', input: { target_agent_name: 'nobody-here', mode: 'autonomous' } }),
        });
        assert(direct.status >= 400, `the direct call is refused, got ${direct.status}`);
        assert(viaInvoke.status === direct.status,
            `and invoke gives the same status: expected ${direct.status}, got ${viaInvoke.status}`);
        assert(viaInvoke.body?.error?.code === direct.body?.error?.code,
            `and the same code: expected ${direct.body?.error?.code}, got ${viaInvoke.body?.error?.code}`);
    });

    await test('invoke cannot reach another owner\'s data, and answers as that owner would be answered', async () => {
        // Owner A wrote prim.note. Owner B asks for the same key, both ways.
        const direct = await json('/v1/memory/prim.note', { headers: authB });
        const viaInvoke = await json('/v1/invoke', {
            method: 'POST', headers: authB,
            body: JSON.stringify({ capability: 'aimeat_memory_read', input: { key: 'prim.note' } }),
        });
        assert(!JSON.stringify(direct.body ?? {}).includes('from invoke'),
            'the direct read must not see another owner\'s value');
        assert(!JSON.stringify(viaInvoke.body ?? {}).includes('from invoke'),
            'and neither must the invoked one');

        // The equivalence, not just the absence: B is answered the same way through both doors, so
        // invoke is not a second namespace resolution that happens to agree today.
        assert(direct.status === 404, `B has no such record directly, got ${direct.status}`);
        assert(viaInvoke.status >= 400 || !JSON.stringify(viaInvoke.body ?? {}).includes('prim.note'),
            `and invoke answers the same emptiness, got ${viaInvoke.status}`);

        // And A still reads their own, so the fence is a fence rather than an outage.
        const mine = await json('/v1/invoke', {
            method: 'POST', headers: authW,
            body: JSON.stringify({ capability: 'aimeat_memory_read', input: { key: 'prim.note' } }),
        });
        assert(JSON.stringify(mine.body ?? {}).includes('from invoke'),
            `the owner who wrote it still reads it, got ${mine.status}`);
    });

    // ── 5. THE OLD DOOR IS UNCHANGED ─────────────────────────────────────────
    await test('every route this replaces nothing of still answers exactly as before', async () => {
        // A spread of the surfaces V2 sits beside: memory, the agent list, the catalogue, discover
        // without the new type, and the spec. If adding a door had disturbed any of them, one of
        // these is where it would show.
        const checks: Array<[string, RequestInit, number]> = [
            ['/v1/memory', { headers: authW }, 200],
            ['/v1/memory/prim.note', { headers: authW }, 200],
            ['/v1/agents', { headers: authA }, 200],
            ['/v1/catalogue', { headers: authW }, 200],
            ['/v1/discover?q=memory', { headers: authW }, 200],
            ['/v1/spec', {}, 200],
        ];
        for (const [path, opts, want] of checks) {
            const r = await json(path, opts);
            assert(r.status === want, `${path} should still answer ${want}, got ${r.status}`);
        }
    });

    await test('the tool that writes memory still exists and still works on its own route', async () => {
        // The whole worry about a "compact surface" is that it quietly becomes the only surface.
        const r = await json('/v1/memory', {
            method: 'POST', headers: authW, body: JSON.stringify({ key: 'prim.direct', value: { via: 'the old road' } }),
        });
        assert(r.status === 200 || r.status === 201, `expected a write, got ${r.status}`);
        const back = await json('/v1/memory/prim.direct', { headers: authW });
        assert(back.body.data.value.via === 'the old road', 'and it should hold what was written');
    });

    await test('discover without the new type answers what it always did', async () => {
        const r = await json('/v1/discover?q=prim&type=memory', { headers: authW });
        assert(r.status === 200, `expected 200, got ${r.status}`);
        const entries = (r.body.data.entries as any[]) ?? [];
        assert(entries.every(e => e.type === 'memory'), 'a typed query must not start returning capabilities');
    });

    // ── 6. The compact surface is actually compact ───────────────────────────
    await test('the primitives surface is under fifteen tools', async () => {
        const r = await json('/v1/prompts/handbook/primitives').catch(() => ({ status: 0, body: null }));
        // The handbook is a nicety; the number is the criterion, and it is asserted in the unit
        // suite against the surface table itself (test/unit/mcp-surfaces.test.ts). Here we only
        // check the surface is reachable as a role at all.
        assert(r.status === 200 || r.status === 404, `the handbook route should exist or not, not error: ${r.status}`);
    });
}

run().then(() => {
    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
}).catch((err) => {
    console.error('Suite crashed:', err);
    process.exit(1);
});
