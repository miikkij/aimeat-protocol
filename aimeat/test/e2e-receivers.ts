/**
 * @file e2e-receivers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for receivers (services/receivers/): an address and a key an owner gives an outside
 *   program, which writes into exactly ONE place of the owner's data over plain REST. Owners A and B,
 *   an operator, and agents of A with chosen scopes. Every refusal reads back that nothing was written.
 *     Designed use: a key receiver (the key once, no-store, never in a read; the program's write lands
 *       under A with a provenance record at level `machine` naming the receiver principal), a prefix
 *       receiver (the last part names the key; _self; dry_run), a row-space receiver (a row appended;
 *       an Idempotency-Key retry replaces it).
 *     Shape: a CSM receiver refuses a missing or wrong-typed field (422 SCHEMA_VALIDATION_FAILED,
 *       details.fields); without a CSM any JSON is taken; a CSM A cannot read is CSM_NOT_FOUND; a CSM a
 *       receiver uses is not deleted (409 IN_USE); a row space's own schema lock binds a receiver too.
 *     Target: INVALID_SUB, a key receiver given a last part, RESERVED_TARGET, PREFIX_FULL, a row space
 *       of an organism A is not a member of.
 *     Key: no key, a wrong key, another receiver's key, a PAT, an agent JWT and a missing receiver are
 *       the same 401; a receiver key on any other route is 401; ?key= is 400; rotation with and without
 *       overlap.
 *     Lifecycle: pause and resume; operator stop, the owner cannot resume, operator start; delete.
 *     Verbs: VERB_NOT_ALLOWED, PATCH merge with re-validation, GET of own rows only, 415, 413, 429.
 *     Permissions: receivers:read, the proposal and the owner's in-person approval, `*` outside,
 *       receivers:manage, cross-owner, the operator routes.
 *     Mode: operator (awaiting_operator, NOT_APPROVED until decided) and off (403 / 503), restored.
 *     MCP: aimeat_receiver list and propose, aimeat_admin_receivers list.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=receivers
 * @version-history
 *   v1.1.0 — 2026-11-08 — A receiver whose owner is a member writes at organism:<id> (the membership is
 *     the owner's, not the receiver principal's); one writing for an organism its owner is not in is
 *     still refused with NOT_ORGANISM_MEMBER and stores nothing.
 *   v1.0.0 — 2026-11-07 — Initial (wish-vastaanottimet-receivers-ulkopuolinen-ohjelma-kirjoittaa-yht).
 */
import { request as httpRequest } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { registerOwner, setupOperator } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';
let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
interface Answer { status: number; body: Body; text: string; headers: Headers }
interface CallOpts { token?: string; body?: unknown; raw?: string; method?: string; contentType?: string; headers?: Record<string, string> }
async function call(path: string, opts: CallOpts = {}): Promise<Answer> {
    const method = opts.method ?? (opts.body === undefined && opts.raw === undefined ? 'GET' : 'POST');
    const payload = opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
    const res = await fetch(BASE + path, {
        method,
        headers: {
            ...(payload !== undefined ? { 'Content-Type': opts.contentType ?? 'application/json' } : {}),
            ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
            ...(opts.headers ?? {}),
        },
        ...(payload === undefined ? {} : { body: payload }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let body: Body = { _raw: text };
    try { body = JSON.parse(text) as Body; } catch { /* a non-JSON body stays raw */ }
    return { status: res.status, body, text, headers: res.headers };
}
/** A request whose path is sent exactly as written: fetch would resolve a `..` segment away. */
function rawCall(method: string, path: string, token: string, body: unknown): Promise<{ status: number; body: Body }> {
    const url = new URL(BASE);
    const payload = JSON.stringify(body);
    return new Promise((resolve, reject) => {
        const req = httpRequest({
            host: url.hostname, port: url.port, method, path,
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), Authorization: `Bearer ${token}` },
        }, res => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', c => { text += c; });
            res.on('end', () => { let b: Body = { _raw: text }; try { b = JSON.parse(text); } catch { /* raw */ } resolve({ status: res.statusCode ?? 0, body: b }); });
        });
        req.on('error', reject);
        req.end(payload);
    });
}
const show = (r: { status: number; text?: string; body?: Body }) => `${r.status} ${(r.text ?? JSON.stringify(r.body)).slice(0, 400)}`;
const codeOf = (r: { body: Body }) => r.body?.error?.code;
const stamp = Date.now() % 10_000_000;
const sha256hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const sha256b64url = (s: string) => createHash('sha256').update(s, 'utf8').digest('base64url');

console.log('\n=== AIMEAT receivers E2E ===\n');
let A = { name: '', token: '', ghii: '' }, B = { name: '', token: '', ghii: '' }, OP = { name: '', token: '' };
let node = '';
let orgId = '', WS = '', bOrgId = '', bWS = '';
let csmName = '';

const receiveUrl = (owner: string, name: string, sub?: string, query = '') => `/v1/receive/${owner}/${name}${sub ? `/${sub}` : ''}${query}`;
const send = (owner: string, name: string, key: string | undefined, body: unknown, opts: { sub?: string; query?: string; method?: string; headers?: Record<string, string> } = {}) =>
    call(receiveUrl(owner, name, opts.sub, opts.query), { ...(key ? { token: key } : {}), body, method: opts.method ?? 'POST', ...(opts.headers ? { headers: opts.headers } : {}) });
/** Make a receiver as `token` (A by default); asserts 201 and answers the receiver and its key. */
async function make(body: Body, token = A.token): Promise<{ receiver: Body; key: string; answer: Answer }> {
    const r = await call('/v1/receivers', { token, body });
    assert(r.status === 201, `create ${body.name}: ${show(r)}`);
    return { receiver: r.body.data.receiver, key: r.body.data.key, answer: r };
}
/** The memory record A holds at `key`, or null. */
async function readMemory(key: string, token = A.token): Promise<Body | null> {
    const r = await call(`/v1/memory/${encodeURIComponent(key)}`, { token });
    if (r.status === 404) return null;
    assert(r.status === 200, `read ${key}: ${show(r)}`);
    return r.body.data.exists === false ? null : r.body.data;
}
const rowsUrl = (org: string, ws: string, space: string, suffix = '') => `/v1/organisms/${org}/workspace/rows/${space}${suffix}?ws=${ws}`;
async function rowCount(space: string): Promise<number> {
    const s = await call(rowsUrl(orgId, WS, space, '/stats'), { token: A.token });
    assert(s.status === 200, `stats ${space}: ${show(s)}`);
    return s.body.data.stats.rows as number;
}
async function setMode(value: string): Promise<void> {
    const r = await call('/v1/admin/config', { token: OP.token, method: 'PUT', body: { changes: [{ path: 'visibility.receivers_mode', value }] } });
    assert(r.status === 200 && !(r.body.data?.errors ?? []).length, `receivers_mode ${value}: ${show(r)}`);
}

await test('Setup: owners A and B, an operator, an organism and workspace of A with two row spaces, one of B, a CSM of A', async () => {
    const a = await registerOwner(BASE, `rcva${stamp}`);
    const b = await registerOwner(BASE, `rcvb${stamp}`);
    const op = await setupOperator(BASE, ADMIN_PW, `rcvop${stamp}`);
    A = { name: a.name, token: a.token, ghii: a.ghii }; B = { name: b.name, token: b.token, ghii: b.ghii }; OP = { name: op.name, token: op.token };
    node = a.ghii.split('@')[1]!;
    const mkOrg = async (token: string, label: string) => {
        const o = await call('/v1/organisms', { token, body: { name: `Rcv ${label} ${stamp}`, description: 'x', type: 'project', join_policy: 'invite_only', visibility: 'private' } });
        assert(o.status === 201, `organism ${label}: ${show(o)}`);
        const id = o.body.data.organism.id as string;
        const w = await call(`/v1/organisms/${id}/workspaces`, {
            token, body: {
                name: 'Sensors',
                manifest: { objectTypes: [
                    { name: 'readings', schemaRef: 'schema:readings@1', namespace: 'sensors.readings', backing: 'rows', writeRole: 'member' },
                    { name: 'locked', schemaRef: 'schema:locked@1', namespace: 'sensors.locked', backing: 'rows', writeRole: 'member' },
                ] },
                schemas: { 'sensors.locked': { type: 'object', required: ['celsius'], properties: { celsius: { type: 'number' } } } },
            },
        });
        assert(w.status === 201, `workspace ${label}: ${show(w)}`);
        return { id, ws: w.body.data.ws as string };
    };
    ({ id: orgId, ws: WS } = await mkOrg(A.token, 'a'));
    ({ id: bOrgId, ws: bWS } = await mkOrg(B.token, 'b'));
    const draft = await call('/v1/csm/draft', { token: A.token, body: { name: `rcvview${stamp}`, sample: { temperature: 21.5, humidity: 40 } } });
    assert(draft.status === 200 && typeof draft.body.data.yaml === 'string', `CSM draft: ${show(draft)}`);
    const csm = await call('/v1/csm', { token: A.token, body: { yaml: draft.body.data.yaml, visibility: 'private' } });
    assert(csm.status === 201, `CSM create: ${show(csm)}`);
    csmName = csm.body.data.csm.name;
    assert(csmName.startsWith(`${A.name}.`), `the CSM name carries the account: ${csmName}`);
});

// ── Designed use ─────────────────────────────────────────────────────────────

let homeKey = '';
await test('Designed: A makes a key receiver; the key once with Cache-Control no-store; the reads never carry the key or a hash', async () => {
    const { receiver, key, answer } = await make({ name: 'home', target: { key: 'home.sensor' } });
    homeKey = key;
    assert(typeof key === 'string' && key.startsWith('aimeat_rcv_'), `key: ${key}`);
    assert(/no-store/.test(answer.headers.get('cache-control') ?? ''), `Cache-Control: ${answer.headers.get('cache-control')}`);
    assert(receiver.principal === `receiver:${A.name}/home@${node}`, `principal: ${receiver.principal}`);
    assert(receiver.state === 'active' && receiver.has_key === true, `state: ${JSON.stringify(receiver)}`);
    for (const path of ['/v1/receivers', '/v1/receivers/home']) {
        const r = await call(path, { token: A.token });
        assert(r.status === 200, `${path}: ${show(r)}`);
        assert(!r.text.includes(key), `${path} carries the key`);
        assert(!/keyHash|key_hash/.test(r.text) && !r.text.includes(sha256hex(key)) && !r.text.includes(sha256b64url(key)), `${path} carries a key hash`);
    }
    const again = await call('/v1/receivers', { token: A.token, body: { name: 'home', target: { key: 'home.other' } } });
    assert(again.status === 409 && codeOf(again) === 'NAME_TAKEN', `a second "home": ${show(again)}`);
});

await test('Designed: the program POSTs JSON → 201; A reads it under A\'s own identity', async () => {
    const r = await send(A.name, 'home', homeKey, { temperature: 21.5, room: 'olohuone' });
    assert(r.status === 201 && r.body.data.key === 'home.sensor', `write: ${show(r)}`);
    const rec = await readMemory('home.sensor');
    assert(rec && rec.value.temperature === 21.5 && rec.value.room === 'olohuone', `read back: ${JSON.stringify(rec)}`);
    const list = await call('/v1/memory?prefix=home.', { token: A.token });
    const item = (list.body.data?.items ?? []).find((x: Body) => x.key === 'home.sensor');
    assert(item && item.owner_gaii === A.ghii, `listed under A: ${show(list)}`);
});

await test('Designed: the record\'s provenance is level machine, naming the receiver principal', async () => {
    const rec = await readMemory('home.sensor');
    const id = rec?.ai_provenance_id;
    assert(typeof id === 'string' && id.length > 0, `ai_provenance_id: ${JSON.stringify(rec)}`);
    const p = await call(`/v1/provenance/${id}`, { token: A.token });
    assert(p.status === 200, `provenance: ${show(p)}`);
    const prov = p.body.data.provenance;
    assert(prov.level === 'machine', `level: ${prov.level}`);
    assert(prov.generator?.principal === `receiver:${A.name}/home@${node}`, `principal: ${JSON.stringify(prov.generator)}`);
    assert(prov.attestation?.stampedBy === 'node' && prov.attestation?.observed === false, `attestation: ${JSON.stringify(prov.attestation)}`);
});

let roomsKey = '';
await test('Designed: a prefix receiver writes <prefix>.<last part>; _self describes it; dry_run writes nothing', async () => {
    const { key } = await make({ name: 'rooms', target: { prefix: 'ruuvit' } });
    roomsKey = key;
    const w = await send(A.name, 'rooms', key, { t: 20 }, { sub: 'olohuone' });
    assert(w.status === 201 && w.body.data.key === 'ruuvit.olohuone', `write: ${show(w)}`);
    assert((await readMemory('ruuvit.olohuone'))?.value?.t === 20, 'ruuvit.olohuone holds the value');
    const self = await call(receiveUrl(A.name, 'rooms', '_self'), { token: key });
    assert(self.status === 200 && self.body.data.receiver === `${A.name}/rooms` && self.body.data.target.prefix === 'ruuvit', `_self: ${show(self)}`);
    const dry = await send(A.name, 'rooms', key, { t: 99 }, { sub: 'keittio', query: '?dry_run=true' });
    assert(dry.status === 200 && dry.body.data.dry_run === true, `dry run: ${show(dry)}`);
    assert((await readMemory('ruuvit.keittio')) === null, 'the dry run wrote nothing');
});

await test('Designed: a receiver whose owner is a member writes a record visible to that organism (the membership is the owner\'s)', async () => {
    const { key } = await make({ name: 'family', target: { prefix: 'perhe' }, visibility: `organism:${orgId}` });
    const w = await send(A.name, 'family', key, { t: 19 }, { sub: 'olohuone' });
    assert(w.status === 201 && w.body.data.key === 'perhe.olohuone', `write: ${show(w)}`);
    const rec = await readMemory('perhe.olohuone');
    assert(rec?.value?.t === 19 && rec.visibility === `organism:${orgId}`, `stored for the organism: ${JSON.stringify(rec)}`);
});

await test('Refusal: a receiver writing for an organism its owner is not a member of → 400 NOT_ORGANISM_MEMBER; nothing stored', async () => {
    const { key } = await make({ name: 'notfamily', target: { prefix: 'vieras' }, visibility: `organism:${bOrgId}` });
    const w = await send(A.name, 'notfamily', key, { t: 5 }, { sub: 'olohuone' });
    assert(w.status === 400 && codeOf(w) === 'NOT_ORGANISM_MEMBER', `write: ${show(w)}`);
    assert((await readMemory('vieras.olohuone')) === null, 'nothing stored');
});

let rowsKey = '';
await test('Designed: a row-space receiver appends a row; a retry with the same Idempotency-Key adds no second row', async () => {
    const { key } = await make({ name: 'rows', target: { organism_id: orgId, ws: WS, space: 'readings' }, verbs: ['read'] });
    rowsKey = key;
    const before = await rowCount('readings');
    // The node's idempotency layer takes a UUID; the receiver derives the row id from it.
    const headers = { 'Idempotency-Key': randomUUID() };
    const first = await send(A.name, 'rows', key, { celsius: 4 }, { headers });
    assert(first.status === 201 && first.body.data.written === 1, `append: ${show(first)}`);
    const rowId = first.body.data.row_ids[0];
    assert(await rowCount('readings') === before + 1, 'one row more');
    const retry = await send(A.name, 'rows', key, { celsius: 4 }, { headers });
    assert(retry.status === 201 && retry.body.data.row_ids[0] === rowId, `retry: ${show(retry)}`);
    assert(await rowCount('readings') === before + 1, 'the retry added no row');
    // The node-wide idempotency cache keys on the address, so another query string reaches the
    // receiver itself: the same Idempotency-Key names the same row (receive.ts rowIdOf).
    const direct = await call(receiveUrl(A.name, 'rows', undefined, '?attempt=2'), { token: key, body: { celsius: 5 }, headers });
    assert(direct.status === 201 && direct.body.data.row_ids[0] === rowId, `retry past the cache: ${show(direct)}`);
    assert(await rowCount('readings') === before + 1, 'the retry past the cache replaced the row');
    const row = await call(rowsUrl(orgId, WS, 'readings', `/${rowId}`), { token: A.token });
    assert(row.status === 200 && JSON.stringify(row.text).includes(`receiver:${A.name}/rows@${node}`), `the row names the receiver: ${show(row)}`);
});

// Regression (found by this suite on 2026-11-07, fixed in src/middleware/idempotency.ts): the node-wide
// idempotency cache ran before the receiver's key check and keyed every program as 'anon'.
await test('Idempotency: a request with no key and the program\'s Idempotency-Key gets 401, never the program\'s cached answer', async () => {
    const headers = { 'Idempotency-Key': randomUUID() };
    const first = await send(A.name, 'rows', rowsKey, { celsius: 6 }, { headers });
    assert(first.status === 201, `the program's write: ${show(first)}`);
    const keyless = await call(receiveUrl(A.name, 'rows'), { body: { celsius: 6 }, headers });
    assert(keyless.status === 401 && codeOf(keyless) === 'UNAUTHORIZED', `keyless replay: ${show(keyless)}`);
    assert(!keyless.text.includes('row_ids'), 'the keyless caller saw nothing of the program\'s answer');
});

await test('Idempotency: a refusal is not replayed to the program\'s correct retry; a key that is not a UUID is taken', async () => {
    const headers = { 'Idempotency-Key': `reading-${randomUUID()}` };
    const pause = await call('/v1/receivers/rows/pause', { token: A.token, body: {} });
    assert(pause.status === 200, `pause: ${show(pause)}`);
    const refused = await send(A.name, 'rows', rowsKey, { celsius: 7 }, { headers });
    assert(refused.status === 403 && codeOf(refused) === 'PAUSED', `while paused: ${show(refused)}`);
    const resume = await call('/v1/receivers/rows/resume', { token: A.token, body: {} });
    assert(resume.status === 200, `resume: ${show(resume)}`);
    const retry = await send(A.name, 'rows', rowsKey, { celsius: 7 }, { headers });
    assert(retry.status === 201, `the same retry after resume: ${show(retry)}`);
    // A refusal made at the key check (paused) is in the owner's delivery log with its reason.
    const log = await call('/v1/receivers/rows/deliveries?refused=true', { token: A.token });
    assert(log.status === 200 && (log.body.data.deliveries ?? []).some((d: Body) => d.code === 'PAUSED'), `the pause is logged: ${show(log)}`);
});

// ── Shape ────────────────────────────────────────────────────────────────────

let viewKey = '';
await test('Shape: with a CSM, a missing or wrong-typed field → 422 SCHEMA_VALIDATION_FAILED with details.fields; nothing written', async () => {
    const { receiver, key } = await make({ name: 'view', target: { key: 'ruuvi.view' }, csm: csmName, verbs: ['merge'] });
    viewKey = key;
    assert(receiver.schema?.csm === csmName && receiver.schema?.version === 1, `schema: ${JSON.stringify(receiver.schema)}`);
    for (const [label, bad] of [['missing humidity', { temperature: 21 }], ['wrong type', { temperature: 'hot', humidity: 40 }]] as const) {
        const r = await send(A.name, 'view', key, bad);
        assert(r.status === 422 && codeOf(r) === 'SCHEMA_VALIDATION_FAILED', `${label}: ${show(r)}`);
        assert(Array.isArray(r.body.error.details?.fields) && r.body.error.details.fields.length >= 1, `${label} fields: ${show(r)}`);
        assert((await readMemory('ruuvi.view')) === null, `${label}: nothing written`);
    }
    const ok = await send(A.name, 'view', key, { temperature: 21.5, humidity: 40 });
    assert(ok.status === 201, `a matching message: ${show(ok)}`);
});

await test('Shape: without a CSM any JSON is taken', async () => {
    const r = await send(A.name, 'home', homeKey, { anything: [1, 2, { deep: true }], at: 'now' });
    assert(r.status === 200, `overwrite with any JSON: ${show(r)}`);
    assert((await readMemory('home.sensor'))?.value?.anything?.[2]?.deep === true, 'stored');
});

await test('Shape: a CSM A cannot read (B\'s private one, or none) → 404 CSM_NOT_FOUND at create; no receiver made', async () => {
    const d = await call('/v1/csm/draft', { token: B.token, body: { name: `bview${stamp}`, sample: { x: 1 } } });
    const bc = await call('/v1/csm', { token: B.token, body: { yaml: d.body.data.yaml, visibility: 'private' } });
    assert(bc.status === 201 && bc.body.data.csm.visibility === 'private', `B's private CSM: ${show(bc)}`);
    // The CSM layer's own answer first, so a failure below says which layer let A read it.
    const asA = await call(`/v1/csm/${encodeURIComponent(bc.body.data.csm.name)}`, { token: A.token });
    assert(asA.status === 404, `A reads B's private CSM on GET /v1/csm/{name}: ${show(asA)}`);
    for (const csm of [bc.body.data.csm.name, `nosuchcsm${stamp}`]) {
        const r = await call('/v1/receivers', { token: A.token, body: { name: 'nocsm', target: { key: 'x.y' }, csm } });
        assert(r.status === 404 && codeOf(r) === 'CSM_NOT_FOUND', `${csm}: ${show(r)}`);
    }
    assert((await call('/v1/receivers/nocsm', { token: A.token })).status === 404, 'no receiver was made');
});

await test('Shape: DELETE of a CSM a receiver uses → 409 IN_USE; the CSM stays', async () => {
    const r = await call(`/v1/csm/${encodeURIComponent(csmName)}`, { token: A.token, method: 'DELETE' });
    assert(r.status === 409 && codeOf(r) === 'IN_USE', `delete: ${show(r)}`);
    assert((await call(`/v1/csm/${encodeURIComponent(csmName)}`, { token: A.token })).status === 200, 'the CSM is still there');
});

await test('Shape: a row space\'s own schema lock binds a receiver: 422 SCHEMA_VALIDATION_FAILED, no row', async () => {
    const { key } = await make({ name: 'locked', target: { organism_id: orgId, ws: WS, space: 'locked' } });
    const before = await rowCount('locked');
    const bad = await send(A.name, 'locked', key, { celsius: 'cold' });
    assert(bad.status === 422 && codeOf(bad) === 'SCHEMA_VALIDATION_FAILED', `bad row: ${show(bad)}`);
    assert(await rowCount('locked') === before, 'no row written');
    const ok = await send(A.name, 'locked', key, { celsius: -3 });
    assert(ok.status === 201 && await rowCount('locked') === before + 1, `good row: ${show(ok)}`);
});

// ── Target ───────────────────────────────────────────────────────────────────

await test('Target: a last part with a dot, "..", or uppercase → 400 INVALID_SUB; nothing written', async () => {
    for (const sub of ['a.b', 'Olohuone']) {
        const r = await send(A.name, 'rooms', roomsKey, { t: 1 }, { sub });
        assert(r.status === 400 && codeOf(r) === 'INVALID_SUB', `${sub}: ${show(r)}`);
    }
    const dots = await rawCall('POST', `/v1/receive/${A.name}/rooms/..`, roomsKey, { t: 1 });
    assert(dots.status === 400 && dots.body?.error?.code === 'INVALID_SUB', `"..": ${dots.status} ${JSON.stringify(dots.body).slice(0, 300)}`);
    const keys = await call('/v1/memory?prefix=ruuvit.', { token: A.token });
    const names = (keys.body.data?.items ?? []).map((x: Body) => x.key);
    assert(names.length === 1 && names[0] === 'ruuvit.olohuone', `only ruuvit.olohuone: ${JSON.stringify(names)}`);
    assert((await readMemory('ruuvit.a.b')) === null && (await readMemory('ruuvit.Olohuone')) === null, 'nothing written');
});

await test('Target: a key receiver given a last part → 404; nothing written', async () => {
    const r = await send(A.name, 'home', homeKey, { x: 1 }, { sub: 'extra' });
    assert(r.status === 404 && codeOf(r) === 'NOT_FOUND', `with a last part: ${show(r)}`);
    assert((await readMemory('home.sensor.extra')) === null, 'nothing at home.sensor.extra');
});

await test('Target: a reserved key (openrouter.apikey, profile.something, parties) → 422 RESERVED_TARGET; no receiver made', async () => {
    for (const [i, target] of [{ key: 'openrouter.apikey' }, { key: 'profile.something' }, { key: 'parties' }, { prefix: 'profile' }].entries()) {
        const r = await call('/v1/receivers', { token: A.token, body: { name: `reserved${i}`, target } });
        assert(r.status === 422 && codeOf(r) === 'RESERVED_TARGET', `${JSON.stringify(target)}: ${show(r)}`);
        assert((await call(`/v1/receivers/reserved${i}`, { token: A.token })).status === 404, `reserved${i} not made`);
    }
});

await test('Target: a prefix at max_keys → 409 PREFIX_FULL; the key is not written; an existing key still takes writes', async () => {
    const { key } = await make({ name: 'small', target: { prefix: 'small', max_keys: 2 } });
    assert((await send(A.name, 'small', key, { n: 1 }, { sub: 'a' })).status === 201, 'small.a');
    assert((await send(A.name, 'small', key, { n: 2 }, { sub: 'b' })).status === 201, 'small.b');
    const full = await send(A.name, 'small', key, { n: 3 }, { sub: 'c' });
    assert(full.status === 409 && codeOf(full) === 'PREFIX_FULL', `third key: ${show(full)}`);
    assert((await readMemory('small.c')) === null, 'small.c not written');
    assert((await send(A.name, 'small', key, { n: 4 }, { sub: 'a' })).status === 200, 'an existing key is overwritten');
});

await test('Target: a row space of an organism A is not a member of → 403 at create; no receiver made', async () => {
    const r = await call('/v1/receivers', { token: A.token, body: { name: 'notmine', target: { organism_id: bOrgId, ws: bWS, space: 'readings' } } });
    assert(r.status === 403 && codeOf(r) === 'NOT_A_MEMBER', `create: ${show(r)}`);
    assert((await call('/v1/receivers/notmine', { token: A.token })).status === 404, 'not made');
});

// ── Key ──────────────────────────────────────────────────────────────────────

await test('Key: no key, a wrong key, another receiver\'s key, a PAT, an agent JWT and a missing receiver → the same 401; nothing written', async () => {
    const pat = await call('/v1/access/tokens', { token: A.token, body: { label: 'rcv-pat', grant_owner: true } });
    assert(pat.status === 201, `PAT: ${show(pat)}`);
    const agent = await makeAgent(BASE, A, ['memory:write', 'memory:read', 'receivers:manage']);
    const before = (await readMemory('home.sensor'))?.version;
    const cases: Array<[string, string, string | undefined]> = [
        ['no key', 'home', undefined],
        ['a wrong key', 'home', `aimeat_rcv_${'x'.repeat(43)}`],
        ['another receiver\'s key', 'home', roomsKey],
        ['a PAT', 'home', pat.body.data.token],
        ['the owner\'s session', 'home', A.token],
        ['an agent JWT', 'home', agent.token],
        ['a missing receiver', `nobody${stamp % 1000}`, homeKey],
    ];
    const messages = new Set<string>();
    for (const [label, name, key] of cases) {
        const r = await send(A.name, name, key, { hijack: label });
        assert(r.status === 401 && codeOf(r) === 'UNAUTHORIZED', `${label}: ${show(r)}`);
        messages.add(r.body.error.message);
    }
    assert(messages.size === 1, `one message for all: ${JSON.stringify([...messages])}`);
    const after = await readMemory('home.sensor');
    assert(after?.version === before && after?.value?.hijack === undefined, 'nothing written');
});

await test('Key: a receiver key on any other route → 401', async () => {
    for (const [path, method, body] of [
        ['/v1/memory', 'GET', undefined], ['/v1/memory/home.sensor', 'GET', undefined], ['/v1/memory', 'POST', { key: 'home.sensor', value: { x: 1 } }],
        ['/v1/receivers', 'GET', undefined], ['/v1/agents', 'GET', undefined], ['/v1/organisms', 'GET', undefined],
    ] as const) {
        const r = await call(path, { token: homeKey, method, ...(body ? { body } : {}) });
        assert(r.status === 401, `${method} ${path}: ${show(r)}`);
    }
    assert((await readMemory('home.sensor'))?.value?.x === undefined, 'the memory write did not land');
});

await test('Key: ?key= in the address → 400 KEY_IN_ADDRESS; nothing written', async () => {
    const r = await send(A.name, 'rooms', roomsKey, { t: 7 }, { sub: 'eteinen', query: `?key=${roomsKey}` });
    assert(r.status === 400 && codeOf(r) === 'KEY_IN_ADDRESS', `?key=: ${show(r)}`);
    assert((await readMemory('ruuvit.eteinen')) === null, 'nothing written');
});

await test('Key: after a rotation the old key works within the overlap; with overlap_minutes 0 the previous key is 401 at once', async () => {
    const { key: k0 } = await make({ name: 'rot', target: { key: 'rot.value' } });
    const r1 = await call('/v1/receivers/rot/rotate', { token: A.token, body: {} });
    assert(r1.status === 200 && typeof r1.body.data.key === 'string' && r1.body.data.key !== k0, `rotate: ${show(r1)}`);
    assert(/no-store/.test(r1.headers.get('cache-control') ?? ''), 'rotate answers no-store');
    const k1 = r1.body.data.key as string;
    assert((await send(A.name, 'rot', k0, { v: 0 })).status === 201, 'the old key within the overlap');
    assert((await send(A.name, 'rot', k1, { v: 1 })).status === 200, 'the new key');
    const r2 = await call('/v1/receivers/rot/rotate', { token: A.token, body: { overlap_minutes: 0 } });
    assert(r2.status === 200, `rotate 0: ${show(r2)}`);
    const k2 = r2.body.data.key as string;
    for (const [label, k] of [['k1', k1], ['k0', k0]] as const) {
        const r = await send(A.name, 'rot', k, { v: label });
        assert(r.status === 401, `${label} after a rotation without overlap: ${show(r)}`);
    }
    assert((await readMemory('rot.value'))?.value?.v === 1, 'the refused keys wrote nothing');
    assert((await send(A.name, 'rot', k2, { v: 2 })).status === 200, 'the newest key');
});

// ── Lifecycle ────────────────────────────────────────────────────────────────

await test('Lifecycle: pause → 403 PAUSED (nothing written); resume → works', async () => {
    const p = await call('/v1/receivers/home/pause', { token: A.token, body: {} });
    assert(p.status === 200 && p.body.data.receiver.state === 'paused', `pause: ${show(p)}`);
    const v = (await readMemory('home.sensor'))?.version;
    const r = await send(A.name, 'home', homeKey, { paused: true });
    assert(r.status === 403 && codeOf(r) === 'PAUSED', `paused write: ${show(r)}`);
    assert((await readMemory('home.sensor'))?.version === v, 'nothing written while paused');
    assert((await call('/v1/receivers/home/resume', { token: A.token, body: {} })).status === 200, 'resume');
    assert((await send(A.name, 'home', homeKey, { resumed: true })).status === 200, 'writes again');
});

await test('Lifecycle: the operator stops → 403 STOPPED; the owner cannot resume (403 STOPPED_BY_OPERATOR); the operator starts it', async () => {
    const noReason = await call(`/v1/admin/receivers/${A.name}/home/stop`, { token: OP.token, body: {} });
    assert(noReason.status === 400, `stop without a reason: ${show(noReason)}`);
    const stop = await call(`/v1/admin/receivers/${A.name}/home/stop`, { token: OP.token, body: { reason: 'too many writes' } });
    assert(stop.status === 200 && stop.body.data.receiver.state === 'stopped' && stop.body.data.receiver.stop_reason === 'too many writes', `stop: ${show(stop)}`);
    const v = (await readMemory('home.sensor'))?.version;
    const r = await send(A.name, 'home', homeKey, { stopped: true });
    assert(r.status === 403 && codeOf(r) === 'STOPPED', `stopped write: ${show(r)}`);
    assert((await readMemory('home.sensor'))?.version === v, 'nothing written while stopped');
    const resume = await call('/v1/receivers/home/resume', { token: A.token, body: {} });
    assert(resume.status === 403 && codeOf(resume) === 'STOPPED_BY_OPERATOR', `owner resume: ${show(resume)}`);
    const start = await call(`/v1/admin/receivers/${A.name}/home/start`, { token: OP.token, body: {} });
    assert(start.status === 200 && start.body.data.receiver.state === 'active', `start: ${show(start)}`);
    assert((await send(A.name, 'home', homeKey, { started: true })).status === 200, 'writes again');
});

await test('Lifecycle: delete → the key is 401 and the record it wrote stays', async () => {
    const { key } = await make({ name: 'gone', target: { key: 'gone.value' } });
    assert((await send(A.name, 'gone', key, { kept: true })).status === 201, 'a write before the delete');
    const d = await call('/v1/receivers/gone', { token: A.token, method: 'DELETE' });
    assert(d.status === 200 && d.body.data.deleted === true, `delete: ${show(d)}`);
    const r = await send(A.name, 'gone', key, { after: true });
    assert(r.status === 401, `the key after the delete: ${show(r)}`);
    const rec = await readMemory('gone.value');
    assert(rec?.value?.kept === true && rec?.value?.after === undefined, `the record stays: ${JSON.stringify(rec)}`);
    assert((await call('/v1/receivers/gone', { token: A.token })).status === 404, 'the receiver is gone');
});

// ── Verbs ────────────────────────────────────────────────────────────────────

await test('Verbs: PATCH, GET and DELETE without the verb → 403 VERB_NOT_ALLOWED; the record stays', async () => {
    for (const method of ['PATCH', 'GET', 'DELETE']) {
        const r = method === 'PATCH'
            ? await send(A.name, 'home', homeKey, { patched: true }, { method })
            : await call(receiveUrl(A.name, 'home'), { token: homeKey, method });
        assert(r.status === 403 && codeOf(r) === 'VERB_NOT_ALLOWED', `${method}: ${show(r)}`);
    }
    const rec = await readMemory('home.sensor');
    assert(rec && rec.value.patched === undefined, 'the record stays as it was');
});

await test('Verbs: with "merge", PATCH merges (JSON Merge Patch) and re-validates against the CSM', async () => {
    const m = await send(A.name, 'view', viewKey, { humidity: 55 }, { method: 'PATCH' });
    assert(m.status === 200, `merge: ${show(m)}`);
    const rec = await readMemory('ruuvi.view');
    assert(rec?.value?.temperature === 21.5 && rec?.value?.humidity === 55, `merged: ${JSON.stringify(rec?.value)}`);
    const bad = await send(A.name, 'view', viewKey, { temperature: 'warm' }, { method: 'PATCH' });
    assert(bad.status === 422 && codeOf(bad) === 'SCHEMA_VALIDATION_FAILED', `merge that breaks the shape: ${show(bad)}`);
    const removed = await send(A.name, 'view', viewKey, { humidity: null }, { method: 'PATCH' });
    assert(removed.status === 422, `merge that removes a required field: ${show(removed)}`);
    const after = await readMemory('ruuvi.view');
    assert(after?.value?.temperature === 21.5 && after?.value?.humidity === 55 && after?.version === rec?.version, 'the refused merges wrote nothing');
});

await test('Verbs: GET on a row space returns only the rows this receiver wrote', async () => {
    const own = await call(rowsUrl(orgId, WS, 'readings'), { token: A.token, body: { row_id: `owner-${stamp}`, body: { celsius: 99 } } });
    assert(own.status === 200 && own.body.data.written === 1, `the owner's own row: ${show(own)}`);
    const r = await call(receiveUrl(A.name, 'rows'), { token: rowsKey });
    assert(r.status === 200 && Array.isArray(r.body.data.rows), `GET: ${show(r)}`);
    assert(r.body.data.rows.length >= 1, 'the receiver\'s own row is listed');
    assert(r.body.data.rows.every((x: Body) => x.createdBy === `receiver:${A.name}/rows@${node}`), `only its own rows: ${JSON.stringify(r.body.data.rows.map((x: Body) => x.createdBy))}`);
    assert(!r.text.includes(`owner-${stamp}`), 'the owner\'s row is not shown');
});

await test('Verbs: a non-JSON content type → 415; a body over max_bytes → 413; nothing written', async () => {
    const { key } = await make({ name: 'tiny', target: { key: 'tiny.value' }, limits: { max_bytes: 100 } });
    const text = await call(receiveUrl(A.name, 'tiny'), { token: key, raw: 'temperature=21', contentType: 'text/plain' });
    assert(text.status === 415 && codeOf(text) === 'UNSUPPORTED_MEDIA_TYPE', `text/plain: ${show(text)}`);
    const big = await send(A.name, 'tiny', key, { pad: 'x'.repeat(300) });
    assert(big.status === 413 && codeOf(big) === 'TOO_LARGE', `300 bytes: ${show(big)}`);
    assert((await readMemory('tiny.value')) === null, 'nothing written');
    assert((await send(A.name, 'tiny', key, { ok: 1 })).status === 201, 'a small JSON body is taken');
});

await test('Verbs: over per_minute → 429 with Retry-After; nothing written', async () => {
    const { key } = await make({ name: 'slow', target: { prefix: 'slow' }, limits: { per_minute: 2 } });
    assert((await send(A.name, 'slow', key, { n: 1 }, { sub: 'a' })).status === 201, 'first');
    assert((await send(A.name, 'slow', key, { n: 2 }, { sub: 'b' })).status === 201, 'second');
    const third = await send(A.name, 'slow', key, { n: 3 }, { sub: 'c' });
    assert(third.status === 429 && codeOf(third) === 'RATE_LIMITED', `third: ${show(third)}`);
    assert(Number(third.headers.get('retry-after')) > 0, `Retry-After: ${third.headers.get('retry-after')}`);
    assert((await readMemory('slow.c')) === null, 'nothing written');
});

// ── Permissions ──────────────────────────────────────────────────────────────

await test('Permissions: an agent without receivers:read → 403 on GET /v1/receivers', async () => {
    const ag = await makeAgent(BASE, A, ['memory:read']);
    const r = await call('/v1/receivers', { token: ag.token });
    assert(r.status === 403, `list: ${show(r)}`);
});

await test('Permissions: an agent with receivers:read proposes (no key, an approve_url) but cannot create or approve; A in person approves and gets the key', async () => {
    const ag = await makeAgent(BASE, A, ['receivers:read']);
    const list = await call('/v1/receivers', { token: ag.token });
    assert(list.status === 200 && list.body.data.total >= 1, `list: ${show(list)}`);
    assert(!list.text.includes(homeKey), 'the list carries no key');
    const create = await call('/v1/receivers', { token: ag.token, body: { name: 'byreader', target: { key: 'agent.made' } } });
    assert(create.status === 403 && codeOf(create) === 'SCOPE_DENIED', `create: ${show(create)}`);
    assert((await call('/v1/receivers/byreader', { token: A.token })).status === 404, 'not made');
    const prop = await call('/v1/receivers/proposals', { token: ag.token, body: { name: 'proposed', target: { key: 'agent.proposed' } } });
    assert(prop.status === 201, `propose: ${show(prop)}`);
    assert(prop.body.data.key === undefined && !/aimeat_rcv_/.test(prop.text), 'a proposal carries no key');
    assert(typeof prop.body.data.approve_url === 'string' && prop.body.data.approve_url.includes('proposed'), `approve_url: ${prop.body.data.approve_url}`);
    assert(prop.body.data.receiver.state === 'proposed' && prop.body.data.receiver.has_key === false, `state: ${JSON.stringify(prop.body.data.receiver)}`);
    const decide = await call('/v1/receivers/proposed/decide', { token: ag.token, body: { decision: 'approve' } });
    // The route refuses a non-owner principal first (requireOwnerPrincipal, ACCESS_DENIED); the
    // service's own OWNER_ONLY stays for a caller that reaches it without the route.
    assert(decide.status === 403 && codeOf(decide) === 'ACCESS_DENIED', `agent approves: ${show(decide)}`);
    const nokey = await send(A.name, 'proposed', `aimeat_rcv_${'y'.repeat(43)}`, { x: 1 });
    assert(nokey.status === 401, `a proposal takes no key: ${show(nokey)}`);
    const ok = await call('/v1/receivers/proposed/decide', { token: A.token, body: { decision: 'approve' } });
    assert(ok.status === 200 && typeof ok.body.data.key === 'string' && ok.body.data.receiver.state === 'active', `owner approves: ${show(ok)}`);
    assert(/no-store/.test(ok.headers.get('cache-control') ?? ''), 'the approval answers no-store');
    assert((await send(A.name, 'proposed', ok.body.data.key, { approved: true })).status === 201, 'the approved key writes');
});

await test('Permissions: an agent holding "*" reads but cannot create; an agent with receivers:manage creates and gets the key', async () => {
    const star = await makeAgent(BASE, A, ['*']);
    assert((await call('/v1/receivers', { token: star.token })).status === 200, '"*" reads the list');
    const c = await call('/v1/receivers', { token: star.token, body: { name: 'bystar', target: { key: 'agent.star' } } });
    assert(c.status === 403 && codeOf(c) === 'SCOPE_DENIED', `"*" creates: ${show(c)}`);
    assert((await call('/v1/receivers/bystar', { token: A.token })).status === 404, 'not made');
    const mgr = await makeAgent(BASE, A, ['receivers:manage']);
    const m = await call('/v1/receivers', { token: mgr.token, body: { name: 'bymanager', target: { key: 'agent.manager' } } });
    assert(m.status === 201 && typeof m.body.data.key === 'string', `manager creates: ${show(m)}`);
    assert(m.body.data.receiver.created_by === mgr.gaii, `created_by: ${m.body.data.receiver.created_by}`);
    assert((await send(A.name, 'bymanager', m.body.data.key, { v: 1 })).status === 201, 'its key writes');
});

await test('Permissions: B cannot read, change or delete A\'s receiver; B\'s key never writes into A\'s data', async () => {
    assert((await call('/v1/receivers/home', { token: B.token })).status === 404, 'B reads no "home"');
    assert((await call('/v1/receivers/home', { token: B.token, method: 'PATCH', body: { display_name: 'x' } })).status === 404, 'B changes no "home"');
    assert((await call('/v1/receivers/home/pause', { token: B.token, body: {} })).status === 404, 'B pauses no "home"');
    assert((await call('/v1/receivers/home/rotate', { token: B.token, body: {} })).status === 404, 'B rotates no "home"');
    assert((await call('/v1/receivers/home', { token: B.token, method: 'DELETE' })).status === 404, 'B deletes no "home"');
    const mine = await call('/v1/receivers/home', { token: A.token });
    assert(mine.status === 200 && mine.body.data.receiver.state === 'active' && mine.body.data.receiver.display_name === 'home', 'A\'s receiver is untouched');
    const { key: bKey } = await make({ name: 'home', target: { key: 'home.sensor' } }, B.token);
    const v = (await readMemory('home.sensor'))?.version;
    const cross = await send(A.name, 'home', bKey, { fromB: true });
    assert(cross.status === 401, `B's key on A's address: ${show(cross)}`);
    const own = await send(B.name, 'home', bKey, { fromB: true });
    assert(own.status === 201, `B's key on B's address: ${show(own)}`);
    const a = await readMemory('home.sensor');
    assert(a?.version === v && a?.value?.fromB === undefined, 'A\'s record is untouched');
    assert((await readMemory('home.sensor', B.token))?.value?.fromB === true, 'B\'s write landed in B\'s data');
});

await test('Permissions: a non-operator gets 403 on /v1/admin/receivers and its stop, start and decide', async () => {
    const ag = await makeAgent(BASE, A, ['receivers:manage', 'receivers:read']);
    for (const token of [B.token, ag.token]) {
        assert((await call('/v1/admin/receivers', { token })).status === 403, 'list');
        assert((await call(`/v1/admin/receivers/${A.name}/home/stop`, { token, body: { reason: 'nope nope' } })).status === 403, 'stop');
        assert((await call(`/v1/admin/receivers/${A.name}/home/start`, { token, body: {} })).status === 403, 'start');
        assert((await call(`/v1/admin/receivers/${A.name}/home/decide`, { token, body: { decision: 'approve' } })).status === 403, 'decide');
    }
    assert((await call('/v1/receivers/home', { token: A.token })).body.data.receiver.state === 'active', 'still active');
    const op = await call('/v1/admin/receivers', { token: OP.token });
    assert(op.status === 200 && op.body.data.counts.receivers >= 2 && !op.text.includes(homeKey), `operator list: ${show(op)}`);
});

// ── Mode ─────────────────────────────────────────────────────────────────────

await test('Mode: with receivers_mode operator, a new receiver waits (403 NOT_APPROVED) until the operator approves it', async () => {
    await setMode('operator');
    try {
        const { receiver, key } = await make({ name: 'waits', target: { key: 'waits.value' } });
        assert(receiver.state === 'awaiting_operator', `state: ${receiver.state}`);
        const r = await send(A.name, 'waits', key, { early: true });
        assert(r.status === 403 && codeOf(r) === 'NOT_APPROVED', `before the decision: ${show(r)}`);
        assert((await readMemory('waits.value')) === null, 'nothing written');
        const resume = await call('/v1/receivers/waits/resume', { token: A.token, body: {} });
        assert(resume.status === 409, `the owner cannot start it: ${show(resume)}`);
        const d = await call(`/v1/admin/receivers/${A.name}/waits/decide`, { token: OP.token, body: { decision: 'approve' } });
        assert(d.status === 200 && d.body.data.receiver.state === 'active', `decide: ${show(d)}`);
        assert((await send(A.name, 'waits', key, { approved: true })).status === 201, 'writes after the approval');
    } finally { await setMode('auto'); }
});

await test('Mode: with receivers_mode off, create → 403 RECEIVERS_OFF and a working key → 503; restored, it works again', async () => {
    await setMode('off');
    try {
        const c = await call('/v1/receivers', { token: A.token, body: { name: 'whileoff', target: { key: 'off.value' } } });
        assert(c.status === 403 && codeOf(c) === 'RECEIVERS_OFF', `create: ${show(c)}`);
        const v = (await readMemory('home.sensor'))?.version;
        const r = await send(A.name, 'home', homeKey, { off: true });
        assert(r.status === 503 && codeOf(r) === 'RECEIVERS_OFF', `receive: ${show(r)}`);
        assert((await readMemory('home.sensor'))?.version === v, 'nothing written');
    } finally { await setMode('auto'); }
    assert((await call('/v1/receivers/whileoff', { token: A.token })).status === 404, 'not made');
    assert((await send(A.name, 'home', homeKey, { on: true })).status === 200, 'writes again after the restore');
});

// ── MCP ──────────────────────────────────────────────────────────────────────

await test('MCP: aimeat_receiver list and propose (receivers:read); aimeat_admin_receivers list (operator)', async () => {
    const ag = await makeAgent(BASE, A, ['receivers:read']);
    const s = await openSession(BASE, ag.token, 'receivers-mcp');
    const list = await callTool(s, 'aimeat_receiver', { action: 'list' });
    assert(!list.isError && (list.data?.receivers ?? []).some((r: Body) => r.name === 'home'), `list: ${list.text?.slice(0, 300)}`);
    assert(!list.text.includes(homeKey), 'the list carries no key');
    const prop = await callTool(s, 'aimeat_receiver', { action: 'propose', name: 'mcpprop', target: { prefix: 'mcp' } });
    assert(!prop.isError && prop.data?.approve_url && prop.data?.key === undefined, `propose: ${prop.text?.slice(0, 300)}`);
    const create = await callTool(s, 'aimeat_receiver', { action: 'create', name: 'mcpmade', target: { key: 'mcp.made' } });
    assert(create.isError && !/aimeat_rcv_/.test(create.text), `create without receivers:manage: ${create.text?.slice(0, 300)}`);
    // The node MCP takes an agent's session: the operator's agent holds operator:admin.
    const opAgent = await makeAgent(BASE, OP, ['*', 'operator:admin']);
    const opSession = await openSession(BASE, opAgent.token, 'receivers-mcp-op');
    const admin = await callTool(opSession, 'aimeat_admin_receivers', { action: 'list' });
    assert(!admin.isError && admin.data?.counts?.receivers >= 2, `admin list: ${admin.text?.slice(0, 300)}`);
    assert(!admin.text.includes(homeKey), 'the operator list carries no key');
    const bAgent = await makeAgent(BASE, B, ['*']);
    const bs = await openSession(BASE, bAgent.token, 'receivers-mcp-b');
    const refused = await callTool(bs, 'aimeat_admin_receivers', { action: 'list' });
    assert(refused.isError, `a non-operator: ${refused.text?.slice(0, 300)}`);
});

// ── Every route refuses ──────────────────────────────────────────────────────

/** `call` with the method written before the path, so check:denial-coverage ties each refusal to its route. */
const as = (method: string, path: string, opts: CallOpts = {}) => call(path, { ...opts, method });

await test('Refusal: every receiver address refuses a call with no key (401), whatever the verb', async () => {
    const body = { refused: true };
    assert((await as('POST', `/v1/receive/${A.name}/home`, { body })).status === 401, 'POST');
    assert((await as('PUT', `/v1/receive/${A.name}/home`, { body })).status === 401, 'PUT');
    assert((await as('PATCH', `/v1/receive/${A.name}/home`, { body })).status === 401, 'PATCH');
    assert((await as('DELETE', `/v1/receive/${A.name}/home`)).status === 401, 'DELETE');
    assert((await as('POST', `/v1/receive/${A.name}/rooms/olohuone`, { body })).status === 401, 'POST with a last part');
    assert((await as('PUT', `/v1/receive/${A.name}/rooms/olohuone`, { body })).status === 401, 'PUT with a last part');
    assert((await as('PATCH', `/v1/receive/${A.name}/rooms/olohuone`, { body })).status === 401, 'PATCH with a last part');
    assert((await as('GET', `/v1/receive/${A.name}/rooms/olohuone`)).status === 401, 'GET with a last part');
    assert((await as('DELETE', `/v1/receive/${A.name}/rooms/olohuone`)).status === 401, 'DELETE with a last part');
    assert((await readMemory('home.sensor'))?.value?.refused === undefined, 'nothing written');
});

await test('Refusal: the management routes refuse an agent without the permission (403) and a caller with no sign-in (401)', async () => {
    const ag = await makeAgent(BASE, A, ['memory:read']);
    const t = ag.token;
    assert((await as('GET', '/v1/receivers/home/deliveries', { token: t })).status === 403, 'deliveries without receivers:read');
    assert((await as('POST', '/v1/receivers/proposals', { token: t, body: { name: 'nope', target: { key: 'nope.x' } } })).status === 403, 'propose without receivers:read');
    assert((await as('POST', '/v1/receivers/home/pause', { token: t, body: {} })).status === 403, 'pause without receivers:manage');
    assert((await as('POST', '/v1/receivers/home/resume', { token: t, body: {} })).status === 403, 'resume without receivers:manage');
    assert((await as('POST', '/v1/receivers/home/rotate', { token: t, body: {} })).status === 403, 'rotate without receivers:manage');
    assert((await as('POST', '/v1/receivers/home/decide', { token: t, body: { decision: 'approve' } })).status === 403, 'decide by an agent');
    assert((await as('POST', '/v1/receivers/home/decide', { body: { decision: 'approve' } })).status === 401, 'decide with no sign-in');
    assert((await call('/v1/receivers/home', { token: A.token })).body.data.receiver.state === 'active', 'unchanged');
});

await test('Refusal: the operator routes refuse another owner (403)', async () => {
    const t = B.token;
    assert((await as('POST', `/v1/admin/receivers/${A.name}/home/stop`, { token: t, body: { reason: 'not mine to stop' } })).status === 403, 'stop');
    assert((await as('POST', `/v1/admin/receivers/${A.name}/home/start`, { token: t, body: {} })).status === 403, 'start');
    assert((await as('POST', `/v1/admin/receivers/${A.name}/home/decide`, { token: t, body: { decision: 'approve' } })).status === 403, 'decide');
    assert((await call('/v1/receivers/home', { token: A.token })).body.data.receiver.state === 'active', 'unchanged');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
