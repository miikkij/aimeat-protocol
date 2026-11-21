/**
 * @file e2e-no-silent-drops.ts
 * @description E2E for three routes that took part of a request, dropped it without a word and
 *   answered success (pitfall analysis 2026-11-21, registry cluster "silent drops"):
 *   - POST /v1/agents/:name/tasks with a field a task does not take (`tags`): 201, and the answer
 *     names it in `ignored_fields`;
 *   - POST /v1/organisms/:id/workspaces with a records space whose `schemaRef` has no schema under
 *     `schemas`: 201, nothing is locked, and `ignored_fields` names the schemaRef;
 *   - POST /v1/organisms/:id/workspace/records/publish into a space whose strict lock closes a schema
 *     that says additionalProperties: true: the extra field is refused and the refusal says the
 *     strict lock closed it (services/organism/gate.ts, the batch publish).
 *   Each with the case where nothing was dropped, which must carry no `ignored_fields`.
 *   Seen red first: before the change neither answer had `ignored_fields` and the batch refusal had
 *   no word about the lock.
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=no-silent-drops

import { registerOwner } from './helpers/owner-login.js';
import { connectAgentByDevice } from './helpers/agent-device.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
const short = (b: any) => (b === undefined ? '' : String(JSON.stringify(b)).slice(0, 400));
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

console.log('\n=== AIMEAT No Silent Drops E2E ===\n');

const stamp = Date.now();
const ownerName = `drops${stamp}`;
const AGENT = 'dropper';
let ownerTok = '';
let org = '';

await test('Setup: an owner, one of their agents and an organism', async () => {
    const owner = await registerOwner(BASE, ownerName);
    ownerTok = owner.token;
    await connectAgentByDevice(BASE, { owner: ownerName, ownerToken: ownerTok, name: AGENT, scopes: ['memory:read'] });
    const made = await json('/v1/organisms', { method: 'POST', headers: auth(ownerTok), body: JSON.stringify({ name: 'Drops org', visibility: 'private' }) });
    assert(made.status === 201, `organism: ${made.status} ${short(made.body)}`);
    org = made.body.data?.id ?? made.body.data?.organism?.id;
    assert(!!org, `no organism id: ${short(made.body)}`);
});

await test('A task create names a field the task does not take', async () => {
    const r = await json(`/v1/agents/${AGENT}/tasks`, {
        method: 'POST', headers: auth(ownerTok),
        body: JSON.stringify({ title: `Sort the inbox ${stamp}`, description: 'by sender', tags: ['inbox'], status: 'draft' }),
    });
    assert(r.status === 201, `create: ${r.status} ${short(r.body)}`);
    assert(JSON.stringify(r.body.data?.ignored_fields) === JSON.stringify(['tags']), `ignored_fields: ${short(r.body.data?.ignored_fields)}`);
    assert(!('tags' in (r.body.data?.task ?? {})), 'the task should not claim to hold tags');
});

await test('A task create whose every field is taken carries no ignored_fields', async () => {
    const r = await json(`/v1/agents/${AGENT}/tasks`, {
        method: 'POST', headers: auth(ownerTok),
        body: JSON.stringify({ title: `File the receipts ${stamp}`, description: 'monthly', rules: ['be brief'], status: 'draft' }),
    });
    assert(r.status === 201, `create: ${r.status} ${short(r.body)}`);
    assert(!('ignored_fields' in r.body.data), `unexpected ignored_fields: ${short(r.body.data?.ignored_fields)}`);
});

let ws = '';
await test('A workspace create names a schemaRef that locked nothing, and locks the schema it was given', async () => {
    const r = await json(`/v1/organisms/${encodeURIComponent(org)}/workspaces`, {
        method: 'POST', headers: auth(ownerTok),
        body: JSON.stringify({
            name: 'Drops',
            manifest: { objectTypes: [
                { name: 'deal', namespace: 'deals', schemaRef: 'schema:deal@1', mode: 'records' },
                { name: 'lead', namespace: 'leads', schemaRef: 'schema:lead@1', mode: 'records' },
            ] },
            schemas: { deals: { type: 'object', additionalProperties: true, properties: { id: { type: 'string' }, title: { type: 'string' } } } },
        }),
    });
    assert(r.status === 201, `create: ${r.status} ${short(r.body)}`);
    ws = r.body.data.ws;
    const ignored = (r.body.data.ignored_fields ?? []).map((f: any) => f.field);
    assert(JSON.stringify(ignored) === JSON.stringify(['manifest.objectTypes[1].schemaRef']), `ignored_fields: ${short(r.body.data.ignored_fields)}`);
    assert(JSON.stringify(r.body.data.schemas_locked) === JSON.stringify(['deals']), `schemas_locked: ${short(r.body.data.schemas_locked)}`);
});

await test('A batch publish under the strict lock refuses the extra field and says the lock closed it', async () => {
    const r = await json(`/v1/organisms/${encodeURIComponent(org)}/workspace/records/publish`, {
        method: 'POST', headers: auth(ownerTok),
        body: JSON.stringify({ ws, namespace: 'deals', records: [
            { id: 'd1', value: { id: 'd1', title: 'Listed only' } },
            { id: 'd2', value: { id: 'd2', title: 'With an extra', colour: 'red' } },
        ] }),
    });
    const results: any[] = r.body.data?.results ?? r.body.error?.details?.results ?? [];
    const ok = results.find(x => x.instance === 'd1');
    const refused = results.find(x => x.instance === 'd2');
    assert(ok?.ok === true, `d1 should publish: ${short(r.body)}`);
    assert(refused?.ok === false && refused.code === 'INVALID', `d2 should be refused: ${short(refused)}`);
    const msg = String(refused.violations?.[0]?.message ?? '');
    assert(msg.includes('"colour"') && msg.includes('strict'), `the refusal should name the field and the strict lock: ${msg}`);
});

await test('Cleanup: the owner this suite made is gone', async () => {
    const r = await json(`/v1/owners/${ownerName}`, { method: 'DELETE', headers: auth(ownerTok) });
    assert(r.status === 200, `delete: ${r.status} ${short(r.body)}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
