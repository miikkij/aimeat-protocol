/**
 * @file e2e-rows-schema.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E: a workspace ROW space's JSON Schema belongs to the space and binds every writer
 *   (developer ruling 2026-11-07: "muoto kuuluu rivitilalle ja koskee kaikkia kirjoittajia").
 *
 *   The schema is the same lock a records space carries, set in `schemas` on the workspace create
 *   and on PUT /v1/organisms/:id/workspace, and read back in `schemas` of the workspace read.
 *   services/workspace-rows/row-schema.ts checks every row of an append against it before anything
 *   is written.
 *
 *   What it proves:
 *     - the workspace read returns the row space's schema in `schemas`;
 *     - a row that does not match is refused (422 SCHEMA_VALIDATION_FAILED) with the row index and
 *       the field path named, from the owner, from a member in person, from a member's agent over
 *       REST and over MCP, and from an app on the app path; nothing is written (read back: 404);
 *     - a strict lock refuses a field the schema does not declare;
 *     - a batch with one bad row writes none of its rows;
 *     - a row that matches is written on every one of those paths;
 *     - a row space with no schema accepts any body, as before;
 *     - changing the schema keeps the rows already stored, and binds the next write;
 *     - only the workspace creator or an organism admin changes it: a non-member and a plain member
 *       (with a contributor grant) are refused on the workspace update and on the lock route, and
 *       the schema is unchanged after both.
 *
 *   Runs against a live server (E2E_BASE, default http://localhost:40251).
 * @version-history
 *   2026-11-07 — Initial (developer ruling 2026-11-07).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=rows-schema
import { createHash, randomBytes } from 'node:crypto';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpSession } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const FILENAME = 'rows-schema.html';
const REDIRECT = 'http://localhost:9922/callback';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, body: ct.includes('json') ? await res.json() as any : { _raw: await res.text() } };
}
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
/** JSON with sorted keys: Postgres stores a schema as jsonb, which does not keep the key order. */
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.keys(x).sort().map(k => [k, (x as Record<string, unknown>)[k]])) : x));
const same = (a: unknown, b: unknown): boolean => canon(a) === canon(b);
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

async function setupOwner(label: string) {
    const name = `rowsch${label}${Date.now() % 100000}`;
    const owner = await registerOwner(BASE, name);
    return { name, token: owner.token };
}

/** The full app-grant flow, as a person approving `scopes` for the app `owner/FILENAME`. */
async function grantApp(personToken: string, appOwner: string, scopes: string[]): Promise<string> {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const q = new URLSearchParams({
        app: `${appOwner}/${FILENAME}`, response_type: 'code', scope: scopes.join(' '),
        redirect_uri: REDIRECT, state: 'x', code_challenge: challenge, code_challenge_method: 'S256',
    });
    const auth = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    assert(auth.status === 302, `authorize: ${auth.status}`);
    const rid = decodeURIComponent(/req=([^&]+)/.exec(auth.headers.get('location') ?? '')![1]);
    const con = await json('/v1/app-grants/authorize-consent', {
        method: 'POST', headers: bearer(personToken), body: JSON.stringify({ request_id: rid }),
    });
    assert(con.status === 200 && con.body.ok, `consent: ${con.status} ${JSON.stringify(con.body)}`);
    const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
    const tok = await json('/v1/app-grants/token', {
        method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT }),
    });
    assert(tok.status === 200 && tok.body.ok, `token: ${tok.status} ${JSON.stringify(tok.body)}`);
    return tok.body.data.access_token as string;
}

const LEDGER_NS = 'books.ledger';
const LEDGER_SCHEMA = {
    type: 'object',
    required: ['account', 'amount'],
    properties: { account: { type: 'string' }, amount: { type: 'number' }, memo: { type: 'string' } },
};
/** The schema after the change: `currency` becomes required. */
const LEDGER_SCHEMA_V2 = {
    type: 'object',
    required: ['account', 'amount', 'currency'],
    properties: { account: { type: 'string' }, amount: { type: 'number' }, currency: { type: 'string' }, memo: { type: 'string' } },
};

let A!: Awaited<ReturnType<typeof setupOwner>>;   // creator
let B!: Awaited<ReturnType<typeof setupOwner>>;   // not a member
let M!: Awaited<ReturnType<typeof setupOwner>>;   // plain member, contributor grant
let G!: Awaited<ReturnType<typeof setupOwner>>;   // organism admin
let orgId = '';
let WS = '';
let agentToken = '';
let agentSession!: McpSession;
let appToken = '';

const rowsUrl = (space: string, suffix = '') => `/v1/organisms/${orgId}/workspace/rows/${space}${suffix}?ws=${WS}`;
const append = (headers: Record<string, string>, space: string, payload: unknown) =>
    json(rowsUrl(space), { method: 'POST', headers, body: JSON.stringify(payload) });
const rowStatus = async (space: string, rowId: string) =>
    (await json(rowsUrl(space, `/${encodeURIComponent(rowId)}`), { headers: bearer(A.token) })).status;
const rowCount = async (space: string): Promise<number> => {
    const s = await json(rowsUrl(space, '/stats'), { headers: bearer(A.token) });
    assert(s.status === 200, `stats ${s.status}: ${JSON.stringify(s.body.error ?? s.body)}`);
    return s.body.data.stats.rows as number;
};
const currentSchemas = async (): Promise<Record<string, any>> => {
    const r = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, { headers: bearer(A.token) });
    assert(r.status === 200, `workspace read ${r.status}: ${JSON.stringify(r.body.error ?? r.body)}`);
    return r.body.data.schemas ?? {};
};
/** A 422 schema refusal over REST, naming the row index and the field path. */
function assertSchemaRefusal(r: { status: number; body: any }, row: number, field: string, who: string) {
    assert(r.status === 422, `${who}: expected 422, got ${r.status}: ${JSON.stringify(r.body.error ?? r.body)}`);
    assert(r.body.error?.code === 'SCHEMA_VALIDATION_FAILED', `${who}: code ${r.body.error?.code}`);
    const msg = String(r.body.error.message);
    assert(msg.includes(`rows[${row}]`) && msg.includes(field), `${who}: the message names rows[${row}] and ${field}: ${msg}`);
    const rows = r.body.error.details?.rows ?? [];
    const hit = rows.find((x: any) => x.row === row);
    assert(hit && hit.violations.some((v: any) => v.field === field), `${who}: details name ${field} on row ${row}: ${JSON.stringify(r.body.error.details)}`);
}

console.log('\n=== Row space schema binds every writer E2E ===\n');

await test('Setup: four owners, an organism, a workspace with a schema on one row space, an app, an agent', async () => {
    A = await setupOwner('a');
    B = await setupOwner('b');
    M = await setupOwner('m');
    G = await setupOwner('g');
    const o = await json('/v1/organisms', {
        method: 'POST', headers: bearer(A.token),
        body: JSON.stringify({ name: 'Rows Schema Org', description: 'x', type: 'project', join_policy: 'invite_only', visibility: 'private' }),
    });
    assert(o.status === 201, `org ${o.status}: ${JSON.stringify(o.body.error ?? o.body)}`);
    orgId = o.body.data.organism.id;

    const w = await json(`/v1/organisms/${orgId}/workspaces`, {
        method: 'POST', headers: bearer(A.token),
        body: JSON.stringify({
            name: 'Books',
            manifest: { objectTypes: [
                { name: 'ledger', schemaRef: 'schema:ledger@1', namespace: LEDGER_NS, backing: 'rows', writeRole: 'member',
                  indexOn: ['account'], apps: [`${A.name}/${FILENAME}`] },
                { name: 'free', schemaRef: 'schema:free@1', namespace: 'books.free', backing: 'rows', writeRole: 'member' },
            ] },
            schemas: { [LEDGER_NS]: LEDGER_SCHEMA },
        }),
    });
    assert(w.status === 201, `workspace ${w.status}: ${JSON.stringify(w.body.error ?? w.body)}`);
    WS = w.body.data.ws;

    for (const who of [M, G]) {
        const add = await json(`/v1/organisms/${orgId}/members`, { method: 'POST', headers: bearer(A.token), body: JSON.stringify({ ghii: who.name }) });
        assert(add.status === 201, `add ${who.name}: ${add.status} ${JSON.stringify(add.body.error ?? add.body)}`);
    }
    const promoted = await json(`/v1/organisms/${orgId}/admins`, { method: 'POST', headers: bearer(A.token), body: JSON.stringify({ target_ghii: G.name }) });
    assert(promoted.status === 200, `G promoted ${promoted.status}: ${JSON.stringify(promoted.body.error ?? promoted.body)}`);
    const grant = await json(`/v1/organisms/${orgId}/workspace-access/grant`, {
        method: 'POST', headers: bearer(A.token), body: JSON.stringify({ ws: WS, grantee: M.name, role: 'contributor' }),
    });
    assert(grant.status === 200, `M contributor ${grant.status}: ${JSON.stringify(grant.body.error ?? grant.body)}`);

    const pub = await json('/v1/apps', {
        method: 'POST', headers: bearer(A.token),
        body: JSON.stringify({ filename: FILENAME, content: b64('<!DOCTYPE html><html><body>rows schema</body></html>'), name: 'Rows Schema', description: 'rows schema', category: 'utility' }),
    });
    assert(pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body.error ?? pub.body)}`);
    appToken = await grantApp(A.token, A.name, ['memory:read', 'organism:rows']);

    const agent = await makeAgent(BASE, { name: M.name, token: M.token }, ['organism:write', 'organism:read', 'organism:rows', 'memory:read']);
    agentToken = agent.token;
    agentSession = await openSession(BASE, agentToken, 'rows-schema-m');
});

await test('the workspace read returns the row space\'s schema in `schemas`, keyed by namespace', async () => {
    const schemas = await currentSchemas();
    assert(same(schemas[LEDGER_NS], LEDGER_SCHEMA), `schemas: ${JSON.stringify(schemas)}`);
    assert(schemas['books.free'] === undefined, `the space without a schema has none: ${JSON.stringify(schemas)}`);
});

// ── Every writer ─────────────────────────────────────────────────────────────

await test('the owner: a row that matches is written', async () => {
    const r = await append(bearer(A.token), 'ledger', { row_id: 'ok-owner', body: { account: 'a-1', amount: 10 } });
    assert(r.status === 200 && r.body.data.written === 1, `${r.status} ${JSON.stringify(r.body.error ?? r.body.data)}`);
});

await test('the owner: a wrong type is refused with the field named, and nothing is written', async () => {
    const r = await append(bearer(A.token), 'ledger', { row_id: 'bad-owner', body: { account: 'a-1', amount: 'ten' } });
    assertSchemaRefusal(r, 0, '/amount', 'owner');
    assert(await rowStatus('ledger', 'bad-owner') === 404, 'the refused row is not stored');
});

await test('the owner: a missing required field is refused, naming that field', async () => {
    const r = await append(bearer(A.token), 'ledger', { row_id: 'bad-missing', body: { amount: 3 } });
    assertSchemaRefusal(r, 0, '/account', 'owner, missing field');
    assert(await rowStatus('ledger', 'bad-missing') === 404, 'the refused row is not stored');
});

await test('the lock is strict: a field the schema does not declare is refused, naming it', async () => {
    const r = await append(bearer(A.token), 'ledger', { row_id: 'bad-extra', body: { account: 'a-1', amount: 1, extra: true } });
    assertSchemaRefusal(r, 0, '/extra', 'owner, undeclared field');
    assert(await rowStatus('ledger', 'bad-extra') === 404, 'the refused row is not stored');
});

await test('a batch with one bad row writes none of its rows', async () => {
    const before = await rowCount('ledger');
    const r = await append(bearer(A.token), 'ledger', { rows: [
        { row_id: 'batch-0', body: { account: 'a-2', amount: 1 } },
        { row_id: 'batch-1', body: { account: 'a-2', amount: 'two' } },
        { row_id: 'batch-2', body: { account: 'a-2', amount: 3 } },
    ] });
    assertSchemaRefusal(r, 1, '/amount', 'batch');
    assert(!String(r.body.error.message).includes('rows[0]') && !String(r.body.error.message).includes('rows[2]'),
        `only the bad row is named: ${r.body.error.message}`);
    assert(await rowCount('ledger') === before, 'the row count did not move');
    for (const id of ['batch-0', 'batch-1', 'batch-2']) assert(await rowStatus('ledger', id) === 404, `${id} is not stored`);
});

await test('a plain member in person: refused when wrong, written when right', async () => {
    const bad = await append(bearer(M.token), 'ledger', { row_id: 'bad-member', body: { account: 7, amount: 1 } });
    assertSchemaRefusal(bad, 0, '/account', 'member');
    assert(await rowStatus('ledger', 'bad-member') === 404, 'the refused row is not stored');
    const ok = await append(bearer(M.token), 'ledger', { row_id: 'ok-member', body: { account: 'a-3', amount: 2 } });
    assert(ok.status === 200, `member good row ${ok.status}: ${JSON.stringify(ok.body.error ?? ok.body)}`);
});

await test('a member\'s agent over REST: refused when wrong, written when right', async () => {
    const bad = await append(bearer(agentToken), 'ledger', { row_id: 'bad-agent-rest', body: { account: 'a-4' } });
    assertSchemaRefusal(bad, 0, '/amount', 'agent over REST');
    assert(await rowStatus('ledger', 'bad-agent-rest') === 404, 'the refused row is not stored');
    const ok = await append(bearer(agentToken), 'ledger', { row_id: 'ok-agent-rest', body: { account: 'a-4', amount: 4 } });
    assert(ok.status === 200, `agent good row ${ok.status}: ${JSON.stringify(ok.body.error ?? ok.body)}`);
});

await test('the same agent over MCP: refused when wrong with the field named, written when right', async () => {
    const bad = await callTool(agentSession, 'aimeat_workspace_rows_append', {
        organism_id: orgId, ws: WS, space: 'ledger', row_id: 'bad-agent-mcp', body: { account: 'a-5', amount: '5' },
    });
    assert(bad.offered && bad.isError && /^SCHEMA_VALIDATION_FAILED: /.test(bad.text) && bad.text.includes('rows[0]') && bad.text.includes('/amount'),
        `MCP refusal: ${bad.text.slice(0, 300)}`);
    assert(await rowStatus('ledger', 'bad-agent-mcp') === 404, 'the refused row is not stored');
    const ok = await callTool(agentSession, 'aimeat_workspace_rows_append', {
        organism_id: orgId, ws: WS, space: 'ledger', row_id: 'ok-agent-mcp', body: { account: 'a-5', amount: 5 },
    });
    assert(!ok.isError && ok.data.written === 1, `MCP good row: ${ok.text.slice(0, 300)}`);
});

await test('an app on the app path: refused when wrong, written when right', async () => {
    const bad = await append(bearer(appToken), 'ledger', { row_id: 'bad-app', body: { account: 'a-6', amount: 6, note: 'x' } });
    assertSchemaRefusal(bad, 0, '/note', 'app');
    assert(await rowStatus('ledger', 'bad-app') === 404, 'the refused row is not stored');
    const ok = await append(bearer(appToken), 'ledger', { row_id: 'ok-app', body: { account: 'a-6', amount: 6 } });
    assert(ok.status === 200, `app good row ${ok.status}: ${JSON.stringify(ok.body.error ?? ok.body)}`);
});

await test('a row space with no schema accepts any body, as before', async () => {
    const r = await append(bearer(A.token), 'free', { rows: [
        { row_id: 'f-1', body: { anything: 'goes', amount: 'ten' } },
        { row_id: 'f-2', body: { nested: { deep: [1, 2, 3] } } },
    ] });
    assert(r.status === 200 && r.body.data.written === 2, `${r.status} ${JSON.stringify(r.body.error ?? r.body.data)}`);
});

// ── Who changes it, and what a change does ────────────────────────────────────

const putSchemas = (token: string, schemas: Record<string, unknown>) => json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, {
    method: 'PUT', headers: bearer(token), body: JSON.stringify({ schemas }),
});
const putLock = (token: string, schema: Record<string, unknown>) =>
    json(`/v1/memory/${encodeURIComponent(`organism.${orgId}.w.${WS}.${LEDGER_NS}`)}/schema`, {
        method: 'PUT', headers: bearer(token), body: JSON.stringify({ schema, apply_to: 'prefix', schema_mode: 'strict' }),
    });
const OPEN_SCHEMA = { type: 'object' };

await test('a non-member may not change the schema, on the workspace update or the lock route', async () => {
    const upd = await putSchemas(B.token, { [LEDGER_NS]: OPEN_SCHEMA });
    assert(upd.status === 403, `non-member workspace update: ${upd.status} ${JSON.stringify(upd.body.error ?? upd.body)}`);
    const lock = await putLock(B.token, OPEN_SCHEMA);
    assert(lock.status === 403, `non-member lock route: ${lock.status} ${JSON.stringify(lock.body.error ?? lock.body)}`);
    assert(same((await currentSchemas())[LEDGER_NS], LEDGER_SCHEMA), 'the schema is unchanged');
});

await test('a plain member with a contributor grant may not change it either', async () => {
    const upd = await putSchemas(M.token, { [LEDGER_NS]: OPEN_SCHEMA });
    assert(upd.status === 403 && upd.body.error?.code === 'NOT_CREATOR', `member workspace update: ${upd.status} ${JSON.stringify(upd.body.error ?? upd.body)}`);
    const lock = await putLock(M.token, OPEN_SCHEMA);
    assert(lock.status === 403, `member lock route: ${lock.status} ${JSON.stringify(lock.body.error ?? lock.body)}`);
    assert(same((await currentSchemas())[LEDGER_NS], LEDGER_SCHEMA), 'the schema is unchanged');
    // Still bound by it: an open-everything schema did not land, so a bad row is still refused.
    const bad = await append(bearer(M.token), 'ledger', { row_id: 'bad-after-attempt', body: { account: 'a-7', amount: 'x' } });
    assertSchemaRefusal(bad, 0, '/amount', 'member after the refused change');
});

await test('an organism admin changes it; the stored rows are kept, and the next write meets the new schema', async () => {
    const before = await rowCount('ledger');
    const ownerRowBefore = (await json(rowsUrl('ledger', '/ok-owner'), { headers: bearer(A.token) })).body.data.row;
    const upd = await putSchemas(G.token, { [LEDGER_NS]: LEDGER_SCHEMA_V2 });
    assert(upd.status === 200, `admin workspace update: ${upd.status} ${JSON.stringify(upd.body.error ?? upd.body)}`);
    assert(same((await currentSchemas())[LEDGER_NS], LEDGER_SCHEMA_V2), 'the read shows the new schema');

    assert(await rowCount('ledger') === before, `every stored row is still there: ${before}`);
    const ownerRowAfter = (await json(rowsUrl('ledger', '/ok-owner'), { headers: bearer(A.token) })).body.data.row;
    assert(same(ownerRowAfter.body, ownerRowBefore.body) && ownerRowAfter.updatedAt === ownerRowBefore.updatedAt,
        `a row the new schema would refuse is not rewritten: ${JSON.stringify(ownerRowAfter)}`);

    const old = await append(bearer(A.token), 'ledger', { row_id: 'bad-v2', body: { account: 'a-8', amount: 8 } });
    assertSchemaRefusal(old, 0, '/currency', 'owner under the new schema');
    const ok = await append(bearer(A.token), 'ledger', { row_id: 'ok-v2', body: { account: 'a-8', amount: 8, currency: 'EUR' } });
    assert(ok.status === 200, `a row that matches the new schema: ${ok.status} ${JSON.stringify(ok.body.error ?? ok.body)}`);
});

await test('Cleanup', async () => {
    if (orgId) await json(`/v1/organisms/${orgId}`, { method: 'DELETE', headers: bearer(A.token) });
    await json(`/v1/apps/${A.name}/${FILENAME}`, { method: 'DELETE', headers: bearer(A.token) });
    for (const who of [A, B, M, G]) if (who) await json(`/v1/owners/${who.name}`, { method: 'DELETE', headers: bearer(who.token) });
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
