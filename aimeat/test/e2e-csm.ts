/**
 * @file e2e-csm.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the CSM (Community Service Manifest) ruling of 2026-11-07, on /v1/csm and the MCP
 *   tool aimeat_csm. Owners A and B, anonymous callers, and agents of A with and without csm:write.
 *   1 A new name gets the owner's prefix and the answer says the final name; version 1; public by default.
 *   2 A public CSM is read with no sign-in, its compiled schema and hash included.
 *   3 B cannot update, set the visibility of or delete A's CSM (403 while B may read it, 404 when not).
 *   4 private hides it from B and from an anonymous caller (404); members hides it from anonymous only.
 *   5 PUT raises the version, keeps the history, takes If-Match, and a stale version answers 409.
 *   6 The draft from a sample stores nothing.
 *   7 An agent without csm:write is refused; with it, or with '*', it registers in its owner's account;
 *     the same over MCP aimeat_csm.
 *   8 Delete removes it. The in-use refusal (409 IN_USE) needs a check registered inside the node,
 *     which a suite cannot reach: test/unit/csm-service.test.ts proves it.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=csm
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial (CSM owner prefix, visibility, versions, csm:write, draft; Jouni, 2026-11-07).
 */
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
interface Answer { status: number; body: Body; text: string }
async function call(path: string, opts: { token?: string; body?: unknown; method?: string; yaml?: string; headers?: Record<string, string> } = {}): Promise<Answer> {
    const method = opts.method ?? (opts.body === undefined && opts.yaml === undefined ? 'GET' : 'POST');
    const res = await fetch(BASE + path, {
        method,
        headers: {
            'Content-Type': opts.yaml !== undefined ? 'text/yaml' : 'application/json',
            ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
            ...(opts.headers ?? {}),
        },
        ...(opts.yaml !== undefined ? { body: opts.yaml } : opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let body: Body = { _raw: text };
    try { body = JSON.parse(text) as Body; } catch { /* a non-JSON body stays raw */ }
    return { status: res.status, body, text };
}
const show = (r: Answer) => `${r.status} ${r.text.slice(0, 400)}`;
const codeOf = (r: Answer) => r.body?.error?.code ?? r.body?.error;
const stamp = Date.now() % 10_000_000;
const enc = encodeURIComponent;

const YAML = (name: string, extraOptional = '') => `csm: "1.0"
service:
  name: ${name}
  type: data
  description: Sensor rows sent by a program
data_schema:
  required:
    temperature: { type: number }
    measured_at: { type: string, format: date-time }
${extraOptional ? `  optional:\n${extraOptional}\n` : ''}`;

console.log('\n=== AIMEAT CSM E2E ===\n');
let A = { name: '', token: '' }, B = { name: '', token: '' };
let SENSOR = '';

await test('Setup: owners A and B', async () => {
    const a = await registerOwner(BASE, `csma${stamp}`);
    const b = await registerOwner(BASE, `csmb${stamp}`);
    A = { name: a.name, token: a.token }; B = { name: b.name, token: b.token };
    assert(A.token && B.token && A.name !== B.name, 'two owners with tokens');
});

await test('1 A registers "sensor": 201, the name gets A\'s prefix, version 1, public by default', async () => {
    const r = await call('/v1/csm', { token: A.token, yaml: YAML('sensor') });
    assert(r.status === 201, `create: ${show(r)}`);
    SENSOR = r.body.data.csm.name;
    assert(SENSOR === `${A.name}.sensor`, `final name: ${SENSOR}`);
    assert(r.body.data.csm.version === 1, `version: ${r.body.data.csm.version}`);
    assert(r.body.data.csm.visibility === 'public', `visibility: ${r.body.data.csm.visibility}`);
    assert(r.body.data.csm.registered_by === A.name, `registered_by: ${r.body.data.csm.registered_by}`);
    const prefixed = await call('/v1/csm', { token: A.token, body: { yaml: YAML(`${A.name}.sensor`) } });
    assert(prefixed.status === 409 && codeOf(prefixed) === 'CSM_NAME_TAKEN', `an already prefixed name is not prefixed twice: ${show(prefixed)}`);
    const anon = await call('/v1/csm', { yaml: YAML('anon') });
    assert(anon.status === 401, `anonymous create: ${show(anon)}`);
});

await test('2 a public CSM is read with no sign-in, with its compiled schema and hash', async () => {
    const list = await call('/v1/csm');
    assert(list.status === 200 && list.body.data.services.some((s: Body) => s.name === SENSOR), `anonymous list: ${show(list)}`);
    const one = await call(`/v1/csm/${enc(SENSOR)}`);
    assert(one.status === 200, `anonymous get: ${show(one)}`);
    assert(one.body.data.csm.json_schema?.required?.includes('temperature'), `json_schema: ${JSON.stringify(one.body.data.csm.json_schema)}`);
    assert(/^[0-9a-f]{64}$/.test(one.body.data.csm.schema_hash), `schema_hash: ${one.body.data.csm.schema_hash}`);
});

await test('3 B cannot update, re-scope or delete A\'s public CSM: 403', async () => {
    const put = await call(`/v1/csm/${enc(SENSOR)}`, { token: B.token, method: 'PUT', body: { yaml: YAML(SENSOR), expected_version: 1 } });
    assert(put.status === 403, `B PUT: ${show(put)}`);
    const patch = await call(`/v1/csm/${enc(SENSOR)}`, { token: B.token, method: 'PATCH', body: { visibility: 'private' } });
    assert(patch.status === 403, `B PATCH: ${show(patch)}`);
    const del = await call(`/v1/csm/${enc(SENSOR)}`, { token: B.token, method: 'DELETE' });
    assert(del.status === 403, `B DELETE: ${show(del)}`);
    assert((await call(`/v1/csm/${enc(SENSOR)}`)).status === 200, 'still there');
});

await test('4 private hides it from B and anonymous (404); members hides it from anonymous only', async () => {
    const patch = await call(`/v1/csm/${enc(SENSOR)}`, { token: A.token, method: 'PATCH', body: { visibility: 'private' } });
    assert(patch.status === 200 && patch.body.data.visibility === 'private', `A PATCH private: ${show(patch)}`);
    assert((await call(`/v1/csm/${enc(SENSOR)}`)).status === 404, 'anonymous get of private');
    assert((await call(`/v1/csm/${enc(SENSOR)}`, { token: B.token })).status === 404, 'B get of private');
    assert((await call(`/v1/csm/${enc(SENSOR)}/versions`, { token: B.token })).status === 404, 'B versions of private');
    const bList = await call('/v1/csm', { token: B.token });
    assert(!bList.body.data.services.some((s: Body) => s.name === SENSOR), 'B list leaves it out');
    const aGet = await call(`/v1/csm/${enc(SENSOR)}`, { token: A.token });
    assert(aGet.status === 200 && aGet.body.data.csm.visibility === 'private', `A reads its own: ${show(aGet)}`);
    // A private CSM the caller may not read answers as a missing one, on the writes too.
    const bPut = await call(`/v1/csm/${enc(SENSOR)}`, { token: B.token, method: 'PUT', body: { yaml: YAML(SENSOR), expected_version: 1 } });
    assert(bPut.status === 404, `B PUT of private: ${show(bPut)}`);
    const bDel = await call(`/v1/csm/${enc(SENSOR)}`, { token: B.token, method: 'DELETE' });
    assert(bDel.status === 404, `B DELETE of private: ${show(bDel)}`);
    const bad = await call(`/v1/csm/${enc(SENSOR)}`, { token: A.token, method: 'PATCH', body: { visibility: 'everyone' } });
    assert(bad.status === 400, `an unknown visibility: ${show(bad)}`);

    const mem = await call('/v1/csm', { token: A.token, body: { yaml: YAML('members-only'), visibility: 'members' } });
    assert(mem.status === 201 && mem.body.data.csm.visibility === 'members', `members create: ${show(mem)}`);
    const memName = mem.body.data.csm.name;
    assert((await call(`/v1/csm/${enc(memName)}`)).status === 404, 'anonymous get of members');
    assert(!(await call('/v1/csm')).body.data.services.some((s: Body) => s.name === memName), 'anonymous list leaves it out');
    assert((await call(`/v1/csm/${enc(memName)}`, { token: B.token })).status === 200, 'B reads a members CSM');
});

await test('5 PUT raises the version and keeps the history; If-Match works; a stale version is 409', async () => {
    const next = YAML(SENSOR, '    humidity: { type: integer }');
    const none = await call(`/v1/csm/${enc(SENSOR)}`, { token: A.token, method: 'PUT', body: { yaml: next } });
    assert(none.status === 400, `no expected version: ${show(none)}`);
    const v2 = await call(`/v1/csm/${enc(SENSOR)}`, { token: A.token, method: 'PUT', body: { yaml: next, expected_version: 1 } });
    assert(v2.status === 200 && v2.body.data.csm.version === 2, `PUT v2: ${show(v2)}`);
    assert(v2.body.data.csm.json_schema.properties.humidity?.type === 'integer', 'the new schema is compiled');
    const stale = await call(`/v1/csm/${enc(SENSOR)}`, { token: A.token, method: 'PUT', body: { yaml: next, expected_version: 1 } });
    assert(stale.status === 409 && codeOf(stale) === 'VERSION_CONFLICT', `stale PUT: ${show(stale)}`);
    const v3 = await call(`/v1/csm/${enc(SENSOR)}`, { token: A.token, method: 'PUT', yaml: YAML('sensor'), headers: { 'If-Match': '"2"' } });
    assert(v3.status === 200 && v3.body.data.csm.version === 3, `PUT with If-Match and the unprefixed name: ${show(v3)}`);
    const renamed = await call(`/v1/csm/${enc(SENSOR)}`, { token: A.token, method: 'PUT', body: { yaml: YAML('another'), expected_version: 3 } });
    assert(renamed.status === 400, `a different service.name: ${show(renamed)}`);
    const versions = await call(`/v1/csm/${enc(SENSOR)}/versions`, { token: A.token });
    assert(versions.status === 200, `versions: ${show(versions)}`);
    assert(JSON.stringify(versions.body.data.versions.map((v: Body) => [v.version, v.current])) === '[[1,false],[2,false],[3,true]]',
        `version list: ${JSON.stringify(versions.body.data.versions)}`);
    const one = await call(`/v1/csm/${enc(SENSOR)}/versions/2`, { token: A.token });
    assert(one.status === 200 && one.body.data.json_schema.properties.humidity, `version 2: ${show(one)}`);
    assert((await call(`/v1/csm/${enc(SENSOR)}/versions/9`, { token: A.token })).status === 404, 'a version that does not exist');
});

await test('6 the draft from a sample answers YAML and a schema and stores nothing', async () => {
    const r = await call('/v1/csm/draft', { token: A.token, body: { name: 'drafty', sample: { temperature: 21.5, count: 3, ok: true, at: '2026-11-07T10:00:00Z' } } });
    assert(r.status === 200, `draft: ${show(r)}`);
    assert(r.body.data.name === `${A.name}.drafty` && r.body.data.stored === false, `draft name: ${r.body.data.name}`);
    assert(typeof r.body.data.yaml === 'string' && r.body.data.json_schema.properties.count.type === 'integer', 'yaml and schema');
    assert(r.body.data.json_schema.properties.at.format === 'date-time', 'a date-time is recognised');
    assert((await call(`/v1/csm/${enc(`${A.name}.drafty`)}`, { token: A.token })).status === 404, 'nothing stored');
    const bad = await call('/v1/csm/draft', { token: A.token, body: { name: 'x', sample: [1, 2] } });
    assert(bad.status === 400, `a sample that is not an object: ${show(bad)}`);
    const created = await call('/v1/csm', { token: A.token, body: { definition: r.body.data.definition } });
    assert(created.status === 201 && created.body.data.csm.name === `${A.name}.drafty`, `the draft registers as it is: ${show(created)}`);
});

await test('7 an agent without csm:write is refused; with it, or with *, it writes in its owner\'s account', async () => {
    const none = await makeAgent(BASE, A, ['memory:read']);
    const word = await makeAgent(BASE, A, ['csm:write']);
    const star = await makeAgent(BASE, A, ['*']);
    const refused = await call('/v1/csm', { method: 'POST', token: none.token, yaml: YAML('by-none') });
    assert(refused.status === 403, `no word: ${show(refused)}`);
    const refusedDraft = await call('/v1/csm/draft', { method: 'POST', token: none.token, body: { name: 'd', sample: { a: 1 } } });
    assert(refusedDraft.status === 403, `no word, draft: ${show(refusedDraft)}`);
    const ok = await call('/v1/csm', { token: word.token, yaml: YAML('by-agent') });
    assert(ok.status === 201 && ok.body.data.csm.name === `${A.name}.by-agent` && ok.body.data.csm.registered_by === A.name, `with the word: ${show(ok)}`);
    const okStar = await call('/v1/csm', { token: star.token, yaml: YAML('by-star') });
    assert(okStar.status === 201, `with *: ${show(okStar)}`);
    // The agent may change its owner's CSM, not B's.
    const bCsm = await call('/v1/csm', { token: B.token, yaml: YAML('of-b') });
    assert(bCsm.status === 201, `B create: ${show(bCsm)}`);
    const cross = await call(`/v1/csm/${enc(bCsm.body.data.csm.name)}`, { token: word.token, method: 'DELETE' });
    assert(cross.status === 403, `A's agent deletes B's CSM: ${show(cross)}`);
    const own = await call(`/v1/csm/${enc(`${A.name}.by-agent`)}`, { token: word.token, method: 'PATCH', body: { visibility: 'members' } });
    assert(own.status === 200, `A's agent sets its owner's visibility: ${show(own)}`);
});

await test('7 MCP aimeat_csm: the agent with csm:write drafts, creates and reads; one without is refused the writes', async () => {
    const has = await makeAgent(BASE, A, ['csm:write']);
    const s = await openSession(BASE, has.token, 'csm-mcp');
    const draft = await callTool(s, 'aimeat_csm', { action: 'from_sample', name: 'mcp-sensor', sample: { temperature: 20.1 } });
    assert(!draft.isError && draft.data?.name === `${A.name}.mcp-sensor`, `from_sample: ${draft.text.slice(0, 300)}`);
    const made = await callTool(s, 'aimeat_csm', { action: 'create', definition: draft.data.definition });
    assert(!made.isError && made.data?.csm?.name === `${A.name}.mcp-sensor`, `create: ${made.text.slice(0, 300)}`);
    const got = await callTool(s, 'aimeat_csm', { action: 'get', name: `${A.name}.mcp-sensor` });
    assert(!got.isError && got.data?.csm?.version === 1, `get: ${got.text.slice(0, 300)}`);
    const foreign = await callTool(s, 'aimeat_csm', { action: 'get', name: `${A.name}.mcp-sensor`, sample: {} });
    assert(foreign.isError && /INVALID_INPUT/.test(foreign.text), `a field the action does not take: ${foreign.text.slice(0, 300)}`);
    const without = await makeAgent(BASE, A, ['memory:read']);
    const s2 = await openSession(BASE, without.token, 'csm-mcp-none');
    const list = await callTool(s2, 'aimeat_csm', { action: 'list' });
    assert(!list.isError && Array.isArray(list.data?.services), `list without the word: ${list.text.slice(0, 300)}`);
    const refused = await callTool(s2, 'aimeat_csm', { action: 'create', yaml: YAML('mcp-none') });
    assert(refused.isError && /SCOPE_DENIED/.test(refused.text), `create without the word: ${refused.text.slice(0, 300)}`);
});

await test('8 A deletes its CSM: 200, then 404', async () => {
    const del = await call(`/v1/csm/${enc(SENSOR)}`, { token: A.token, method: 'DELETE' });
    assert(del.status === 200 && del.body.data.deleted === true, `delete: ${show(del)}`);
    assert((await call(`/v1/csm/${enc(SENSOR)}`, { token: A.token })).status === 404, 'gone');
    assert((await call(`/v1/csm/${enc(SENSOR)}/versions`, { token: A.token })).status === 404, 'its versions gone');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
