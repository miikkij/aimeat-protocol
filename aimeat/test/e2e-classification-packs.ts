/**
 * @file test/e2e-classification-packs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the TL and NATO label packs and a label that refuses an outside model (plan
 *   doc-mvlftkh9zmc9, C3, decisions 10.4, 10.5 and 10.8):
 *     - the operator switches a pack on up to a class; a top class needs the acknowledgement that
 *       this node is not accredited (400 without it); another owner switches nothing (403);
 *     - an upper-case marking ("TL III", "NATO SECRET") raises the record it is in, the word
 *       "salainen" in lower case does not, and a marking above what is on raises to the highest on;
 *     - such a record is absent for an agent whose model runs elsewhere, on REST and the node MCP,
 *       and readable for one whose runtime report says llm "local";
 *     - a top class on is a gap in the node's compliance gaps;
 *     - switching a pack off keeps every record as protected as it was.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-classification-packs
 * @version-history
 *   v1.0.0 — 2026-10-23 — Initial (plan doc-mvlftkh9zmc9, C3).
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpAgent, type McpSession } from './helpers/mcp-session.js';
import { takeOffAudienceCaps } from './helpers/classification-caps.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now();

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
async function call(method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, token?: string, body?: unknown): Promise<{ status: number; body: Body }> {
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    return { status: res.status, body: (res.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) as Body : { _raw: text } };
}
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

console.log('\n=== TL and NATO label packs, and content only a local model reads (plan doc-mvlftkh9zmc9, C3) ===\n');

let op!: RegisteredOwner, alice!: RegisteredOwner;
let far!: McpAgent, near!: McpAgent, farMcp!: McpSession;
const setSwitch = (mode: string) => call('PUT', '/v1/admin/config', op.token, { changes: [{ path: 'classification.mode', value: mode }] });
const packs = async () => (await call('GET', '/v1/classification/packs', op.token)).body.data.packs as Body[];
const packOf = async (id: string) => (await packs()).find(p => p.id === id)!;

/** An agent writes a record of its own; the label is read by its owner, polled while the rule runs. */
async function writeAndLabel(agent: McpAgent, key: string, text: string, want: string): Promise<Body> {
    const w = await call('POST', '/v1/memory', agent.token, { key, value: { text }, visibility: 'private' });
    assert(w.status === 200 || w.status === 201, `write ${key}: ${w.status} ${JSON.stringify(w.body?.error)}`);
    let view: Body = {};
    for (let i = 0; i < 24; i++) {
        view = (await call('GET', `/v1/classification/label?${q({ kind: 'memory', key, owner: agent.gaii })}`, alice.token)).body;
        if (view?.data?.label === want) break;
        await sleep(250);
    }
    return view;
}

await test('Setup: the operator turns classification on; alice has two agents', async () => {
    op = await registerOwner(BASE, `pkop${stamp}`);
    alice = await registerOwner(BASE, `pkalice${stamp}`);
    const on = await setSwitch('all');
    assert(on.status === 200, `switch all: ${on.status} ${JSON.stringify(on.body?.error)}`);
    await takeOffAudienceCaps(BASE, op.token);
    far = await makeAgent(BASE, alice, ['*'], `pkfar${stamp % 100000}`);
    near = await makeAgent(BASE, alice, ['*'], `pknear${stamp % 100000}`);
    farMcp = await openSession(BASE, far.token, 'packs, a model elsewhere');
});

await test('PACKS: both are off; another owner switches nothing (403)', async () => {
    const list = await packs();
    assert(list.length === 2 && list.every(p => p.on === false), `packs: ${JSON.stringify(list)}`);
    const r = await call('PUT', '/v1/classification/packs', alice.token, { pack: 'tl', on: true });
    assert(r.status === 403, `alice: ${r.status} ${JSON.stringify(r.body?.error)}`);
    assert((await packOf('tl')).on === false, 'POSITIVE CONTROL, still off');
});

await test('TL ON: by default up to TL III; up to TL I is refused without the acknowledgement (400)', async () => {
    const r = await call('PUT', '/v1/classification/packs', op.token, { pack: 'tl', on: true });
    assert(r.status === 200 && r.body.data.pack.upTo === 'tl-iii' && r.body.data.pack.top === false, `on: ${r.status} ${JSON.stringify(r.body?.data?.pack ?? r.body?.error)}`);
    const top = await call('PUT', '/v1/classification/packs', op.token, { pack: 'tl', on: true, upTo: 'tl-i' });
    assert(top.status === 400 && top.body.error.code === 'ACKNOWLEDGEMENT_REQUIRED', `top: ${top.status} ${JSON.stringify(top.body?.error)}`);
    assert((await packOf('tl')).upTo === 'tl-iii', 'POSITIVE CONTROL, still up to TL III');
});

await test('MARKINGS: "TL III" raises a record to TL III; "salainen" in lower case does not; "ERITTÄIN SALAINEN" raises to the highest on', async () => {
    const tl3 = await writeAndLabel(far, `pk.tl3.${stamp}`, 'TL III\nMuistio harjoituksesta', 'tl-iii');
    assert(tl3?.data?.label === 'tl-iii' && tl3.data.source === 'rule', `TL III: ${JSON.stringify(tl3?.data ?? tl3?.error)}`);
    const top = await writeAndLabel(far, `pk.tl1.${stamp}`, 'ERITTÄIN SALAINEN\nSuunnitelma', 'tl-iii');
    assert(top?.data?.label === 'tl-iii', `above what is on: ${JSON.stringify(top?.data ?? top?.error)}`);
    const plain = await call('GET', `/v1/classification/label?${q({ kind: 'memory', key: `pk.tl3.${stamp}`, owner: far.gaii })}`, alice.token);
    assert(plain.body.data.label === 'tl-iii', 'the first one stays');
    const lower = await writeAndLabel(far, `pk.plain.${stamp}`, 'tämä on salainen juttu, ei luokiteltu', 'tl-iii');
    assert(lower?.data?.source === 'default', `lower case stays: ${JSON.stringify(lower?.data)}`);
});

await test('OUTSIDE MODEL: a TL record is absent for an agent whose model runs elsewhere, on REST and MCP; a plain one is not', async () => {
    const r = await call('GET', `/v1/memory/${encodeURIComponent(`pk.tl3.${stamp}`)}`, far.token);
    assert(r.status === 404, `REST: ${r.status}`);
    const m = await callTool(farMcp, 'aimeat_memory_read', { key: `pk.tl3.${stamp}` });
    assert(m.isError && !m.text.includes('Muistio harjoituksesta'), `MCP: ${m.text.slice(0, 200)}`);
    const plain = await call('GET', `/v1/memory/${encodeURIComponent(`pk.plain.${stamp}`)}`, far.token);
    assert(plain.status === 200, `POSITIVE CONTROL, the plain record: ${plain.status}`);
});

await test('LOCAL MODEL: an agent whose runtime report says llm "local" reads a TL record of its own', async () => {
    const w = await call('POST', '/v1/memory', near.token, { key: `pk.near.${stamp}`, value: { text: 'TL IV\nKäyttö rajoitettu' }, visibility: 'private' });
    assert(w.status === 200 || w.status === 201, `write: ${w.status}`);
    for (let i = 0; i < 24; i++) {
        const v = (await call('GET', `/v1/classification/label?${q({ kind: 'memory', key: `pk.near.${stamp}`, owner: near.gaii })}`, alice.token)).body;
        if (v?.data?.label === 'tl-iv') break;
        await sleep(250);
    }
    const before = await call('GET', `/v1/memory/${encodeURIComponent(`pk.near.${stamp}`)}`, near.token);
    assert(before.status === 404, `before the report: ${before.status}`);
    const rep = await call('PATCH', `/v1/agents/${encodeURIComponent(near.name)}/runtime-source`, near.token, { runtime_source: { kind: 'python', llm: 'local' } });
    assert(rep.status === 200 && rep.body.data.runtime_source.llm === 'local', `report: ${rep.status} ${JSON.stringify(rep.body?.error ?? rep.body?.data)}`);
    const after = await call('GET', `/v1/memory/${encodeURIComponent(`pk.near.${stamp}`)}`, near.token);
    assert(after.status === 200, `after the report: ${after.status} ${JSON.stringify(after.body?.error)}`);
});

await test('NATO: up to NATO SECRET with the acknowledgement; the marking raises; the node\'s gaps name the top class', async () => {
    const r = await call('PUT', '/v1/classification/packs', op.token, { pack: 'nato', on: true, upTo: 'nato-secret', acknowledgeNotAccredited: true });
    assert(r.status === 200 && r.body.data.pack.top === true, `on: ${r.status} ${JSON.stringify(r.body?.data?.pack ?? r.body?.error)}`);
    const ns = await writeAndLabel(far, `pk.ns.${stamp}`, 'NATO SECRET\nExercise plan', 'nato-secret');
    assert(ns?.data?.label === 'nato-secret', `NATO SECRET: ${JSON.stringify(ns?.data ?? ns?.error)}`);
    const g = await call('GET', '/v1/compliance/gaps', op.token);
    assert(g.status === 200 && (g.body.data.gaps as Body[]).some(x => x.kind === 'classification-pack-not-accredited' && x.evidence?.pack === 'nato'), `gaps: ${JSON.stringify((g.body?.data?.gaps ?? []).map((x: Body) => x.kind))}`);
});

await test('OFF: switching TL off retires its classes and keeps the records as protected as they were', async () => {
    const r = await call('PUT', '/v1/classification/packs', op.token, { pack: 'tl', on: false });
    assert(r.status === 200 && r.body.data.pack.on === false, `off: ${r.status} ${JSON.stringify(r.body?.data?.pack ?? r.body?.error)}`);
    const label = await call('GET', `/v1/classification/label?${q({ kind: 'memory', key: `pk.tl3.${stamp}`, owner: far.gaii })}`, alice.token);
    assert(label.body.data.label === 'tl-iii', `label kept: ${JSON.stringify(label.body?.data)}`);
    const read = await call('GET', `/v1/memory/${encodeURIComponent(`pk.tl3.${stamp}`)}`, far.token);
    assert(read.status === 404, `still absent for a model elsewhere: ${read.status}`);
});

await setSwitch('off');
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
