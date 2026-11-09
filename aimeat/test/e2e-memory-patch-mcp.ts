/**
 * @file e2e-memory-patch-mcp.ts
 * @description aimeat_memory_write with `patch` changes only what it names, on every shape of data,
 *   and breaks nothing when the call is wrong, raced, too large or not allowed.
 *
 *   The patch runs services/memory-patch/patch.ts, the same code PATCH /v1/memory/:key runs. The
 *   claims, each separate:
 *     Shapes
 *       1. A changed field changes; every other field, the visibility and the tags stay.
 *       2. A nested object merges: the named nested field changes, its siblings stay.
 *       3. A list is replaced whole, never merged element by element.
 *       4. null removes a field, at the top and nested.
 *       5. Text survives byte for byte: Finnish letters, emoji, right-to-left script, quotes,
 *          backslashes, newlines, a NUL-free control character.
 *       6. Numbers and booleans survive: 0, -1, 0.1, 2^53-1, false; a false or 0 is never dropped.
 *       7. An empty patch changes no field.
 *       8. A deep new path is created; an object replaces a scalar and a scalar an object.
 *       9. A patch on a missing key creates it; expected_version 0 asserts it is missing.
 *     What must not happen
 *      10. A record holding a string, a list or a number is not merged into: NOT_AN_OBJECT, on MCP and
 *          REST, and the record is unchanged (it used to be replaced by the patch).
 *      11. A patch that is not an object, value and patch together, neither, a patch with group_id:
 *          refused, nothing written.
 *      12. A stale expected_version: VERSION_CONFLICT, unchanged.
 *      13. Twelve patches of different fields at once, from separate sessions: all land, none lost.
 *      14. A patch that would make the record pass the size limit: refused, unchanged.
 *      15. A patch that breaks the key's schema lock: SCHEMA_VALIDATION_FAILED, unchanged.
 *      16. A credential record and an organism the agent is not in: refused, nothing written.
 *     Who
 *      17. With owner_scope and memory:write-as-owner the patch lands in the person's context, and the
 *          context keeps the version it replaced.
 *      18. Without memory:write-as-owner: SCOPE_DENIED, the person's record unchanged (cross-scope).
 *      19. An agent without memory:write is refused (cross-scope).
 *      20. Another person's agent patching the same key reaches only its own person's namespace,
 *          never this person's record (cross-owner).
 *     Answer and parity
 *      21. The MCP answer does not carry the merged value back: a 600 kB record answers in under 2 kB.
 *      22. The same patches through REST and MCP give the same record.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=memory-patch-mcp
 * @version-history
 *   v1.0.0 — 2026-11-09 — Initial.
 */
import * as ed from '@noble/ed25519';
import { registerOwner } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const owner = `mpat${Date.now() % 100000}`;
const stranger = `mpas${Date.now() % 100000}`;

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
/** Equal as JSON, whatever the key order: PostgreSQL's jsonb hands keys back in its own order. */
const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon((v as Record<string, unknown>)[k])])) : v;
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
const auth = (token: string, opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${token}` } });

let rpcId = 0;
async function mcp(token: string, session: string | null, method: string, params: unknown) {
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${token}`, ...(session ? { 'mcp-session-id': session } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    });
    const text = await res.text();
    const line = text.split('\n').find(l => l.startsWith('data: '));
    let msg: any = null;
    try { msg = JSON.parse(line ? line.slice(6) : text); } catch { /* an error body may be empty */ }
    return { status: res.status, session: res.headers.get('mcp-session-id'), msg };
}
const sessions = new Map<string, string>();
async function session(token: string, fresh = false): Promise<string> {
    if (!fresh && sessions.has(token)) return sessions.get(token)!;
    const init = await mcp(token, null, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e-memory-patch', version: '1' } });
    assert(init.status === 200 && !!init.session, `initialize ${init.status}`);
    await mcp(token, init.session, 'notifications/initialized', {});
    if (!fresh) sessions.set(token, init.session!);
    return init.session!;
}
async function call(token: string, args: Record<string, unknown>, fresh = false) {
    const r = await mcp(token, await session(token, fresh), 'tools/call', { name: 'aimeat_memory_write', arguments: args });
    const text = String(r.msg?.result?.content?.[0]?.text ?? JSON.stringify(r.msg?.error ?? ''));
    return { error: r.msg?.result?.isError === true || !!r.msg?.error, text };
}

async function agentOf(who: string, ownerTok: string, name: string, scopes: string[]): Promise<string> {
    const c = await json('/v1/agents', auth(ownerTok, { method: 'POST', body: JSON.stringify({ name, owner: who, capabilities: ['memory'] }) }));
    assert(c.status === 201, `create ${name} ${c.status}: ${JSON.stringify(c.body.error)}`);
    const gaii = c.body.data.agent.gaii;
    const p = await json(`/v1/agents/${name}/scopes`, auth(ownerTok, { method: 'PATCH', body: JSON.stringify({ scopes }) }));
    assert(p.status === 200, `scopes ${name} ${p.status}: ${JSON.stringify(p.body.error)}`);
    const ts = new Date().toISOString();
    const sig = await ed.signAsync(new TextEncoder().encode(gaii + ts), Buffer.from(c.body.data.private_key, 'base64'));
    const t = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: Buffer.from(sig).toString('base64') }) });
    assert(!!t.body?.data?.token, `token ${name} ${t.status}: ${JSON.stringify(t.body?.error)}`);
    return t.body.data.token;
}

/** Write a whole value (REST) as `token`. */
async function put(token: string, key: string, value: unknown, extra: Record<string, unknown> = {}) {
    const r = await json('/v1/memory', auth(token, { method: 'POST', body: JSON.stringify({ key, value, visibility: 'owner', ...extra }) }));
    assert(r.status < 300, `write ${key} ${r.status}: ${JSON.stringify(r.body.error)}`);
}
/** Read a record (REST) as `token`: value, version, visibility, tags. */
async function read(token: string, key: string, ownerScope = false) {
    const r = await json(`/v1/memory/${encodeURIComponent(key)}${ownerScope ? '?owner_scope=true' : ''}`, auth(token));
    return r.status === 200 ? r.body.data : null;
}

let ownerToken = '';
let strangerToken = '';
let agent = '';      // memory read/write, own namespace and the person's
let plainAgent = ''; // memory read/write, own namespace only
let blind = '';      // no memory:write
let foreign = '';    // another person's agent with write-as-owner

const BASE_DOC = () => ({
    type: 'aimeat.context/v1', name: 'Trip', summary: 'S', core: 'old core',
    lifecycle: { createdAt: '2026-01-01', shapedAt: '2026-01-02' },
    concepts: [{ term: 'a', means: 'A' }, { term: 'b', means: 'B' }],
    flags: { done: false, count: 0 },
});

console.log('\n=== Memory patch over MCP E2E Tests ===\n');

await test('Two people and four agents', async () => {
    ownerToken = (await registerOwner(BASE, owner)).token;
    strangerToken = (await registerOwner(BASE, stranger)).token;
    agent = await agentOf(owner, ownerToken, 'patch-agent', ['memory:read', 'memory:write', 'memory:read-as-owner', 'memory:write-as-owner']);
    plainAgent = await agentOf(owner, ownerToken, 'patch-plain', ['memory:read', 'memory:write']);
    blind = await agentOf(owner, ownerToken, 'patch-blind', ['memory:read']);
    foreign = await agentOf(stranger, strangerToken, 'patch-foreign', ['memory:read', 'memory:write', 'memory:read-as-owner', 'memory:write-as-owner']);
});

console.log('\nPhase 1: shapes');

await test('1. A changed field changes; the rest, the visibility and the tags stay', async () => {
    await put(agent, 'doc.one', BASE_DOC(), { tags: ['keep-me'] });
    const before = await read(agent, 'doc.one');
    const r = await call(agent, { key: 'doc.one', patch: { core: 'new core' } });
    assert(!r.error, r.text);
    const after = await read(agent, 'doc.one');
    assert(after.value.core === 'new core', 'core did not change');
    assert(same({ ...after.value, core: 'old core' }, before.value), 'another field changed');
    assert(after.visibility === 'owner' && same(after.tags, ['keep-me']), `visibility ${after.visibility}, tags ${JSON.stringify(after.tags)}`);
    assert(after.version === before.version + 1, 'version did not move by one');
});

await test('2. A nested object merges: the named field changes, its siblings stay', async () => {
    const r = await call(agent, { key: 'doc.one', patch: { lifecycle: { shapedAt: '2026-11-09' } } });
    assert(!r.error, r.text);
    const v = (await read(agent, 'doc.one')).value;
    assert(v.lifecycle.shapedAt === '2026-11-09' && v.lifecycle.createdAt === '2026-01-01', JSON.stringify(v.lifecycle));
});

await test('3. A list is replaced whole, not merged element by element', async () => {
    const r = await call(agent, { key: 'doc.one', patch: { concepts: [{ term: 'c', means: 'C' }] } });
    assert(!r.error, r.text);
    const v = (await read(agent, 'doc.one')).value;
    assert(same(v.concepts, [{ term: 'c', means: 'C' }]), JSON.stringify(v.concepts));
});

await test('4. null removes a field, at the top and nested', async () => {
    const r = await call(agent, { key: 'doc.one', patch: { summary: null, flags: { count: null } } });
    assert(!r.error, r.text);
    const v = (await read(agent, 'doc.one')).value;
    assert(!('summary' in v) && !('count' in v.flags) && v.flags.done === false, JSON.stringify(v));
});

await test('5. Text survives byte for byte', async () => {
    const text = 'Äänekoski, öljy, Å — 🦊🇫🇮 עברית "lainaus" \'yksi\' \\ back\\slash\nrivi 2\ttab \u0007bell';
    const r = await call(agent, { key: 'doc.one', patch: { core: text, nested: { t: text } } });
    assert(!r.error, r.text);
    const v = (await read(agent, 'doc.one')).value;
    assert(v.core === text && v.nested.t === text, `got ${JSON.stringify(v.core)}`);
});

await test('6. Numbers and booleans survive; false and 0 are never dropped', async () => {
    const nums = { zero: 0, neg: -1, frac: 0.1, big: 9007199254740991, no: false, yes: true };
    const r = await call(agent, { key: 'doc.one', patch: { nums } });
    assert(!r.error, r.text);
    const got = (await read(agent, 'doc.one')).value.nums;
    for (const [k, v] of Object.entries(nums)) assert(got[k] === v, `${k}: sent ${JSON.stringify(v)}, stored ${JSON.stringify(got[k])}`);
});

await test('7. An empty patch changes no field', async () => {
    const before = (await read(agent, 'doc.one')).value;
    const r = await call(agent, { key: 'doc.one', patch: {} });
    assert(!r.error, r.text);
    assert(same((await read(agent, 'doc.one')).value, before), 'an empty patch changed the record');
});

await test('8. A deep new path is created; object over scalar and scalar over object', async () => {
    let r = await call(agent, { key: 'doc.one', patch: { a: { b: { c: { d: 1 } } } } });
    assert(!r.error, r.text);
    r = await call(agent, { key: 'doc.one', patch: { core: { now: 'object' }, a: 5 } });
    assert(!r.error, r.text);
    const v = (await read(agent, 'doc.one')).value;
    assert(same(v.core, { now: 'object' }) && v.a === 5, JSON.stringify({ core: v.core, a: v.a }));
});

await test('9. A patch on a missing key creates it; expected_version 0 asserts it is missing', async () => {
    let r = await call(agent, { key: 'doc.new', patch: { x: 1, gone: null }, expected_version: 0 });
    assert(!r.error, r.text);
    const v = await read(agent, 'doc.new');
    assert(same(v.value, { x: 1 }), JSON.stringify(v.value));
    r = await call(agent, { key: 'doc.new', patch: { x: 2 }, expected_version: 0 });
    assert(r.error && r.text.startsWith('VERSION_CONFLICT'), `second create: ${r.text.slice(0, 120)}`);
    assert((await read(agent, 'doc.new')).value.x === 1, 'the second create landed');
});

console.log('\nPhase 2: what must not happen');

await test('10. A string, list or number record is not merged into, on MCP and REST', async () => {
    for (const [k, v] of [['doc.str', 'just text'], ['doc.list', [1, 2, 3]], ['doc.num', 42]] as const) {
        await put(agent, k, v);
        const r = await call(agent, { key: k, patch: { a: 1 } });
        assert(r.error && r.text.startsWith('NOT_AN_OBJECT'), `${k} over MCP: ${r.text.slice(0, 120)}`);
        const rest = await json(`/v1/memory/${k}`, auth(agent, { method: 'PATCH', body: JSON.stringify({ patch: { a: 1 } }) }));
        assert(rest.status === 409 && rest.body.error?.code === 'NOT_AN_OBJECT', `${k} over REST: ${rest.status}`);
        assert(same((await read(agent, k)).value, v), `${k} changed`);
    }
});

await test('11. A wrong call is refused and writes nothing', async () => {
    const before = await read(agent, 'doc.one');
    const cases: Array<Record<string, unknown>> = [
        { key: 'doc.one', patch: ['not', 'an', 'object'] },
        { key: 'doc.one', patch: 'text' },
        { key: 'doc.one', value: { a: 1 }, patch: { a: 2 } },
        { key: 'doc.one' },
        { key: 'doc.one', patch: { a: 1 }, group_id: 'g1' },
    ];
    for (const args of cases) {
        const r = await call(agent, args);
        assert(r.error, `accepted: ${JSON.stringify(args)}`);
    }
    const after = await read(agent, 'doc.one');
    assert(after.version === before.version && same(after.value, before.value), 'a refused call wrote');
});

await test('12. A stale expected_version is refused and writes nothing', async () => {
    const before = await read(agent, 'doc.one');
    const r = await call(agent, { key: 'doc.one', patch: { core: 'late' }, expected_version: before.version - 1 });
    assert(r.error && r.text.startsWith('VERSION_CONFLICT'), r.text.slice(0, 120));
    assert(same((await read(agent, 'doc.one')).value, before.value), 'the stale patch landed');
    const ok = await call(agent, { key: 'doc.one', patch: { core: 'on time' }, expected_version: before.version });
    assert(!ok.error, ok.text);
});

await test('13. Twelve patches of different fields at once all land', async () => {
    await put(agent, 'doc.race', { start: true });
    const before = await read(agent, 'doc.race');
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => call(agent, { key: 'doc.race', patch: { [`f${i}`]: i } }, true)));
    const bad = results.filter(r => r.error);
    assert(!bad.length, `${bad.length} refused: ${bad[0]?.text.slice(0, 160)}`);
    const after = await read(agent, 'doc.race');
    for (let i = 0; i < 12; i++) assert(after.value[`f${i}`] === i, `f${i} lost: ${JSON.stringify(after.value)}`);
    assert(after.value.start === true && after.version === before.version + 12, `version ${after.version}, expected ${before.version + 12}`);
});

await test('14. A patch past the size limit is refused and writes nothing', async () => {
    await put(agent, 'doc.big', { keep: 'x'.repeat(600_000) });
    const before = await read(agent, 'doc.big');
    const r = await call(agent, { key: 'doc.big', patch: { more: 'y'.repeat(500_000) } });
    assert(r.error, 'a patch past the limit was accepted');
    const after = await read(agent, 'doc.big');
    assert(after.version === before.version && !('more' in after.value), 'the oversize patch landed');
});

await test('15. A patch that breaks the schema lock is refused and writes nothing', async () => {
    await put(ownerToken, 'doc.locked', { core: 'text' });
    const lock = await json(`/v1/memory/${encodeURIComponent('doc.locked')}/schema`, auth(ownerToken, { method: 'PUT', body: JSON.stringify({ schema: { type: 'object', properties: { core: { type: 'string' } } }, apply_to: 'exact' }) }));
    assert(lock.status < 300, `lock ${lock.status}: ${JSON.stringify(lock.body.error)}`);
    const own = await agentOf(owner, ownerToken, 'patch-locker', ['memory:read', 'memory:write', 'memory:read-as-owner', 'memory:write-as-owner']);
    const r = await call(own, { key: 'doc.locked', patch: { core: 5 }, owner_scope: true });
    assert(r.error && r.text.startsWith('SCHEMA_VALIDATION_FAILED'), r.text.slice(0, 160));
    assert((await read(ownerToken, 'doc.locked')).value.core === 'text', 'the invalid patch landed');
    const ok = await call(own, { key: 'doc.locked', patch: { core: 'still text' }, owner_scope: true });
    assert(!ok.error, ok.text);
});

await test('16. A credential record and a foreign organism are refused, nothing written', async () => {
    const sec = await call(agent, { key: 'openrouter.apikey', patch: { key: 'sk-x' }, owner_scope: true });
    assert(sec.error, 'a credential record was patched');
    const org = await call(agent, { key: 'organism.org-nope-000000.shared.notes', patch: { a: 1 } });
    assert(org.error, 'an organism the agent is not in was patched');
    assert(!(await read(agent, 'organism.org-nope-000000.shared.notes')), 'the organism record was written');
});

console.log('\nPhase 3: who');

await test('17. With write-as-owner the patch lands in the person\'s context, and its history keeps the old version', async () => {
    await put(ownerToken, 'context.trip', BASE_DOC());
    const r = await call(agent, { key: 'context.trip', patch: { core: 'patched by the agent' }, owner_scope: true });
    assert(!r.error, r.text);
    assert((await read(ownerToken, 'context.trip')).value.core === 'patched by the agent', 'the person\'s context did not change');
    const h = await json('/v1/memory/history/context.trip', auth(ownerToken));
    const cur = h.body.data.versions[0];
    assert(h.body.data.kept >= 1 && cur.changes.some((c: any) => c.path === 'core' && c.after === 'patched by the agent'), JSON.stringify(h.body.data).slice(0, 300));
});

await test('18. Without write-as-owner: SCOPE_DENIED, the person\'s record unchanged (cross-scope)', async () => {
    const r = await call(plainAgent, { key: 'context.trip', patch: { core: 'should not land' }, owner_scope: true });
    assert(r.error && r.text.startsWith('SCOPE_DENIED'), r.text.slice(0, 160));
    const rest = await json('/v1/memory/context.trip', auth(plainAgent, { method: 'PATCH', body: JSON.stringify({ patch: { core: 'nor this' }, owner_scope: true }) }));
    assert(rest.status === 403, `REST answered ${rest.status}`);
    assert((await read(ownerToken, 'context.trip')).value.core === 'patched by the agent', 'the record changed');
});

await test('19. An agent without memory:write is refused (cross-scope)', async () => {
    const r = await call(blind, { key: 'doc.blind', patch: { a: 1 } });
    assert(r.error, 'an agent without memory:write patched');
    assert(!(await read(blind, 'doc.blind')), 'the record exists');
});

await test('20. Another person\'s agent reaches only its own person\'s namespace (cross-owner)', async () => {
    const r = await call(foreign, { key: 'context.trip', patch: { core: 'from the stranger' }, owner_scope: true });
    assert(!r.error, r.text);
    assert((await read(ownerToken, 'context.trip')).value.core === 'patched by the agent', 'the stranger changed this person\'s context');
    const theirs = await read(strangerToken, 'context.trip');
    assert(theirs && same(theirs.value, { core: 'from the stranger' }), `the stranger's own record: ${JSON.stringify(theirs?.value)}`);
});

console.log('\nPhase 4: the answer, and parity with REST');

await test('21. The MCP answer does not carry the merged value back', async () => {
    const r = await call(agent, { key: 'doc.big', patch: { note: 'small' } });
    assert(!r.error, r.text);
    assert(r.text.length < 2000, `the answer is ${r.text.length} characters`);
    assert(r.text.includes('"patched": true') && !r.text.includes('xxxxxxxxxx'), r.text.slice(0, 200));
});

await test('22. The same patches through REST and MCP give the same record', async () => {
    const steps = [{ core: 'one' }, { lifecycle: { shapedAt: 'z' } }, { concepts: [] }, { flags: null }, { 'dotted.key': 'ok' }];
    await put(agent, 'doc.rest', BASE_DOC());
    await put(agent, 'doc.mcp', BASE_DOC());
    for (const patch of steps) {
        const rest = await json('/v1/memory/doc.rest', auth(agent, { method: 'PATCH', body: JSON.stringify({ patch }) }));
        assert(rest.status === 200, `REST ${rest.status}`);
        const m = await call(agent, { key: 'doc.mcp', patch });
        assert(!m.error, m.text);
    }
    const a = await read(agent, 'doc.rest');
    const b = await read(agent, 'doc.mcp');
    assert(same(a.value, b.value) && a.visibility === b.visibility, `REST ${JSON.stringify(a.value)} vs MCP ${JSON.stringify(b.value)}`);
});

console.log(`\n=== Memory patch over MCP: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
