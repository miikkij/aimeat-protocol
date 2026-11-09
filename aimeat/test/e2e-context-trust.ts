/**
 * @file e2e-context-trust.ts
 * @description A context can be trusted: its earlier versions are kept and can be put back, and a
 *   machine check says what in it no longer stands.
 *
 *   The claims, each separate:
 *     1. A write to a context keeps the version it replaces; GET /v1/memory/history/:key lists the
 *        kept versions newest first, each with what that write changed (records matched by identity).
 *     2. ?version= gives one old version whole; writing it back with expected_version restores it,
 *        and the version the restore replaced is kept in turn.
 *     3. A key outside contexts and ontologies keeps no history.
 *     4. The person's agent holding memory:read-as-owner reads the history over MCP
 *        (aimeat_memory_history with owner_scope).
 *     5. An agent of the same person without memory:read-as-owner is refused the history with
 *        SCOPE_DENIED, and no old value leaks (cross-scope).
 *     6. An agent without memory:read is refused both doors over REST (cross-scope).
 *     7. Another person reads neither this person's history nor its check: 404, no content
 *        (cross-owner).
 *     8. The check passes a sound context, and names a reference that no longer opens, a source
 *        quote no longer in its record, an ontology id that names nothing, and a context named in
 *        `excludes` that does not exist.
 *     9. The agent runs the check over MCP (aimeat_context_check).
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=context-trust
 * @version-history
 *   v1.0.0 — 2026-11-09 — Initial (wish-oma-konteksti-muoto-syntyy-k-yt-ss-n-kym-pyynn-st).
 */
import * as ed from '@noble/ed25519';
import { registerOwner } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const owner = `ctxt${Date.now() % 100000}`;
const stranger = `ctxs${Date.now() % 100000}`;
const TYPE = 'aimeat.context/v1';

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

async function session(token: string): Promise<string> {
    const init = await mcp(token, null, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e-context-trust', version: '1' } });
    assert(init.status === 200 && !!init.session, `initialize ${init.status}`);
    await mcp(token, init.session, 'notifications/initialized', {});
    return init.session!;
}

async function call(token: string, name: string, args: Record<string, unknown>) {
    const r = await mcp(token, await session(token), 'tools/call', { name, arguments: args });
    return { error: r.msg?.result?.isError === true || !!r.msg?.error, text: String(r.msg?.result?.content?.[0]?.text ?? JSON.stringify(r.msg?.error ?? '')) };
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

async function put(token: string, key: string, value: unknown, extra: Record<string, unknown> = {}) {
    const r = await json('/v1/memory', auth(token, { method: 'POST', body: JSON.stringify({ key, value, visibility: 'owner', ...extra }) }));
    assert(r.status < 300, `write ${key} ${r.status}: ${JSON.stringify(r.body.error)}`);
    return r.body.data;
}

const now = new Date().toISOString();
const trip = (core: string, refs: Array<Record<string, string>>) => ({
    type: TYPE, name: 'Lisbon trip', summary: 'Family week in Lisbon.', core, references: refs,
    lifecycle: { createdAt: now, shapedAt: now },
});
const REF_FLIGHTS = { ref: 'memory:trip.flights', what: 'flight times', openWhen: 'flights come up' };
const REF_HOTEL = { ref: 'memory:trip.hotel', what: 'the hotel', openWhen: 'the hotel comes up' };

let ownerToken = '';
let strangerToken = '';
let asOwner = '';
let plain = '';
let blind = '';

console.log('\n=== Context trust E2E Tests ===\n');

await test('Two people, three agents, a context written three times', async () => {
    ownerToken = (await registerOwner(BASE, owner)).token;
    strangerToken = (await registerOwner(BASE, stranger)).token;
    asOwner = await agentOf(owner, ownerToken, 'trust-asowner', ['memory:read', 'memory:write', 'memory:read-as-owner', 'memory:write-as-owner']);
    plain = await agentOf(owner, ownerToken, 'trust-plain', ['memory:read', 'memory:write']);
    blind = await agentOf(owner, ownerToken, 'trust-blind', ['catalogue:read']);
    await put(ownerToken, 'trip.flights', { text: 'TP 1234 leaves at 07:40 on Friday.' });
    await put(ownerToken, 'trip.hotel', { text: 'Hotel Alfama, three nights.' });
    await put(ownerToken, 'context.trip', trip('Flights booked.', [REF_FLIGHTS]));
    await put(ownerToken, 'context.trip', trip('Flights and hotel booked.', [REF_FLIGHTS, REF_HOTEL]));
    await put(ownerToken, 'context.trip', trip('SECRET-OLD gone.', [REF_HOTEL]));
});

console.log('\nPhase 1: the history');

let v1 = 0;
await test('The kept versions are listed newest first, each with what its write changed', async () => {
    const r = await json('/v1/memory/history/context.trip', auth(ownerToken));
    assert(r.status === 200, `history ${r.status}: ${JSON.stringify(r.body.error)}`);
    const d = r.body.data;
    assert(d.keeps_history === true && d.kept === 2, `kept ${d.kept}, keeps_history ${d.keeps_history}`);
    const [cur, mid, old] = d.versions;
    assert(cur.current && cur.version === d.current_version, 'the first entry is not the current version');
    const curPaths = cur.changes.map((c: any) => `${c.op} ${c.path}`);
    assert(curPaths.includes('changed core') && curPaths.includes('removed references[ref=memory:trip.flights]'), `current changes: ${curPaths.join('; ')}`);
    assert(mid.changes.some((c: any) => c.op === 'added' && c.path === 'references[ref=memory:trip.hotel]'), 'the hotel reference was not matched by identity');
    assert(old.changes === null, 'the oldest kept version has a predecessor');
    v1 = old.version;
});

await test('One old version is read whole, and writing it back restores it and keeps what it replaced', async () => {
    const r = await json(`/v1/memory/history/context.trip?version=${v1}`, auth(ownerToken));
    assert(r.status === 200 && r.body.data.value.core === 'Flights booked.', `version ${v1}: ${r.status} ${JSON.stringify(r.body.data?.value?.core)}`);
    const cur = r.body.data.current_version;
    await put(ownerToken, 'context.trip', r.body.data.value, { expected_version: cur });
    const now2 = await json('/v1/memory/context.trip', auth(ownerToken));
    assert(now2.body.data.value.core === 'Flights booked.', 'the restore did not land');
    const h = await json('/v1/memory/history/context.trip', auth(ownerToken));
    assert(h.body.data.versions.some((v: any) => v.version === cur && !v.current), 'the version the restore replaced was not kept');
    const missing = await json('/v1/memory/history/context.trip?version=999', auth(ownerToken));
    assert(missing.status === 404, `a version never kept answered ${missing.status}`);
});

await test('A key outside contexts and ontologies keeps no history', async () => {
    await put(ownerToken, 'trip.notes', { a: 1 });
    await put(ownerToken, 'trip.notes', { a: 2 });
    const r = await json('/v1/memory/history/trip.notes', auth(ownerToken));
    assert(r.status === 200 && r.body.data.kept === 0 && r.body.data.keeps_history === false, `plain key: ${JSON.stringify(r.body.data)}`);
});

await test('The agent that reads as the owner reads the history over MCP', async () => {
    const r = await call(asOwner, 'aimeat_memory_history', { key: 'context.trip', owner_scope: true });
    assert(!r.error && r.text.includes('"keeps_history": true') && r.text.includes('references[ref=memory:trip.hotel]'), `MCP history: ${r.text.slice(0, 300)}`);
    const one = await call(asOwner, 'aimeat_memory_history', { key: 'context.trip', owner_scope: true, version: v1 });
    assert(!one.error && one.text.includes('Flights booked.'), `MCP one version: ${one.text.slice(0, 200)}`);
});

console.log('\nPhase 2: who reads no history');

await test('An agent without memory:read-as-owner is refused with SCOPE_DENIED, and nothing old leaks (cross-scope)', async () => {
    const r = await call(plain, 'aimeat_memory_history', { key: 'context.trip', owner_scope: true });
    assert(r.error && r.text.startsWith('SCOPE_DENIED'), `expected SCOPE_DENIED, got: ${r.text.slice(0, 200)}`);
    assert(!r.text.includes('SECRET-OLD'), 'an old version leaked');
    const rest = await json('/v1/memory/history/context.trip?owner_scope=true', auth(plain));
    assert(rest.status === 403 && rest.body.error?.code === 'SCOPE_DENIED', `REST answered ${rest.status} ${rest.body.error?.code}`);
});

await test('An agent without memory:read is refused both doors (cross-scope)', async () => {
    const h = await json('/v1/memory/history/context.trip?owner_scope=true', auth(blind));
    const c = await json('/v1/memory/context-check/trip', auth(blind));
    assert(h.status === 403 && c.status === 403, `history ${h.status}, check ${c.status}`);
});

await test('Another person reads neither the history nor the check (cross-owner)', async () => {
    const h = await json('/v1/memory/history/context.trip?owner_scope=true', auth(strangerToken));
    const c = await json('/v1/memory/context-check/trip', auth(strangerToken));
    assert(h.status === 404 && c.status === 404, `history ${h.status}, check ${c.status}`);
    assert(!JSON.stringify([h.body, c.body]).includes('Flights'), 'content leaked across owners');
});

console.log('\nPhase 3: the check');

await test('A sound context passes the check', async () => {
    const r = await json('/v1/memory/context-check/trip', auth(ownerToken));
    assert(r.status === 200, `check ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.healthy === true, `findings: ${JSON.stringify(r.body.data.findings)}`);
    assert(r.body.data.counts.references.checked === 1, `references checked: ${JSON.stringify(r.body.data.counts.references)}`);
});

await test('The check names a dead reference, a lost quote, a dangling id and a missing excluded context', async () => {
    await put(ownerToken, 'notes.call', { text: 'Dan said the budget is 40 000 euros, signed on Monday.' });
    await put(ownerToken, 'vocab.ctx.deal', { concepts: [
        { '@id': 'vocab:ctx.deal/price/budget', 'skos:broader': 'vocab:ctx.deal/class/Price',
            'prov:wasDerivedFrom': [{ 'dcterms:source': 'memory:notes.call', 'prov:value': 'the budget is **40 000** euros' }] },
        { '@id': 'vocab:ctx.deal/decision/old', 'aimeat:status': 'vocab:ctx.deal/State/superseded',
            'prov:wasDerivedFrom': [{ 'dcterms:source': 'memory:notes.call', 'prov:value': 'the budget is 50 000 euros' }] },
        { '@id': 'vocab:ctx.deal/class/Price', '@type': 'rdfs:Class' },
        { '@id': 'vocab:ctx.deal/State/superseded', '@type': 'rdfs:Class' },
    ] });
    await put(ownerToken, 'context.deal', {
        type: TYPE, name: 'The deal', summary: 'Dan\'s deal.', core: 'Budget agreed.', module: 'vocab.ctx.deal',
        references: [{ ref: 'memory:notes.gone', what: 'deleted notes', openWhen: 'never' }],
        excludes: ['context:nothing-here'],
        lifecycle: { createdAt: now, shapedAt: now },
    });
    const r = await json('/v1/memory/context-check/deal', auth(ownerToken));
    assert(r.status === 200, `check ${r.status}`);
    const kinds = r.body.data.findings.map((f: any) => `${f.kind} ${f.where}`);
    const want = [
        'reference-missing references[0] memory:notes.gone',
        'context-missing excludes context:nothing-here',
        'quote-not-found vocab:ctx.deal/decision/old',
        'superseded-without-replacement vocab:ctx.deal/decision/old',
    ];
    for (const w of want) assert(kinds.includes(w), `missing finding "${w}" in ${JSON.stringify(kinds)}`);
    assert(!kinds.some((k: string) => k.startsWith('quote-not-found vocab:ctx.deal/price/budget')), 'a quote that stands (Markdown aside) was reported');
    assert(r.body.data.healthy === false && r.body.data.counts.ontology.quotesChecked === 2, `counts: ${JSON.stringify(r.body.data.counts.ontology)}`);
    // A dangling id: the module names a concept it does not hold.
    await put(ownerToken, 'vocab.ctx.deal', { concepts: [
        { '@id': 'vocab:ctx.deal/price/budget', 'skos:related': 'vocab:ctx.deal/person/nobody',
            'prov:wasDerivedFrom': [{ 'dcterms:source': 'memory:notes.call', 'prov:value': 'signed on Monday' }] },
    ] });
    const r2 = await json('/v1/memory/context-check/deal', auth(ownerToken));
    assert(r2.body.data.findings.some((f: any) => f.kind === 'dangling-id' && f.message.includes('vocab:ctx.deal/person/nobody')), `no dangling id: ${JSON.stringify(r2.body.data.findings)}`);
});

await test('The agent runs the check over MCP', async () => {
    const r = await call(plain, 'aimeat_context_check', { context: 'context.trip' });
    assert(!r.error && r.text.includes('"healthy": true'), `MCP check: ${r.text.slice(0, 300)}`);
});

console.log(`\n=== Context trust: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
