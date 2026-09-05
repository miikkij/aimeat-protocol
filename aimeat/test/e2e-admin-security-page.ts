/**
 * @file e2e-admin-security-page.ts
 * @description E2E for the Security page's one read (GET /v1/admin/security/overview) and the
 *   incident actions behind it. Makes real refusals (an anonymous knock and a non-operator knock on
 *   the overview door itself), a real refused-and-kept incident (a non-ZIP body at the workspace
 *   import door), then asserts the operator sees all of it in one read — the knocks grouped by door
 *   and credential kind and listed newest first, the incident open with the status word "open" —
 *   and that resolving and deleting go through the same service the MCP tool calls.
 * @version-history
 *   v1.0.0 -- 2026-09-05 -- Initial: the overview's gate and shape, the incident lifecycle.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=admin-security-page

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0, failed = 0;
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
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

async function registerAndToken(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status}`);
    const priv = reg.body.data.private_key;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(priv, name + NODE_ID + ts) }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token;
}

async function overview(token: string) {
    const r = await json('/v1/admin/security/overview', { headers: auth(token) });
    assert(r.status === 200, `overview status ${r.status}: ${JSON.stringify(r.body.error)}`);
    return r.body.data;
}

console.log('\n=== AIMEAT Admin Security Page E2E ===\n');

const opName = `secop${Date.now()}`;
const nonOpName = `secnon${Date.now()}`;
let opToken = '';
let nonOpToken = '';
let orgId = '';
let incidentId = '';

await test('Setup: first owner is auto-operator; a second is not', async () => {
    opToken = await registerAndToken(opName);
    nonOpToken = await registerAndToken(nonOpName);
});

await test('The overview door refuses a stranger (401) and a non-operator (403)', async () => {
    const anon = await json('/v1/admin/security/overview');
    assert(anon.status === 401, `anonymous expected 401, got ${anon.status}`);
    const nonOp = await json('/v1/admin/security/overview', { headers: auth(nonOpToken) });
    assert(nonOp.status === 403, `non-operator expected 403, got ${nonOp.status}`);
});

await test('The operator reads the page in one call, with every part present', async () => {
    const d = await overview(opToken);
    assert(['quiet', 'watch', 'open'].includes(d.now.status), `status word ${d.now.status}`);
    for (const k of ['refusals', 'sources', 'rate_limit_hits', 'scope_denials', 'open_incidents']) {
        assert(typeof d.now[k].value === 'number', `now.${k}.value is a number`);
        assert(['healthy', 'watch', 'critical'].includes(d.now[k].zone), `now.${k}.zone is a zone, got ${d.now[k].zone}`);
    }
    assert(d.now.refusals.window_hours === 24, 'the window is 24 hours');
    assert(d.now.log.enabled === true, 'the refusal log is on under the runner');
    assert(typeof d.now.log.path === 'string' && d.now.log.path.length > 0, 'the log line names the file');
    assert(Array.isArray(d.refusals.tail) && Array.isArray(d.refusals.by_door), 'refusals carry the tail and the groupings');
    assert(typeof d.incidents.open === 'number' && Array.isArray(d.incidents.items), 'incidents carry items and the open count');
    assert(d.accounts.operators.includes(opName), `operators list names the operator, got ${JSON.stringify(d.accounts.operators)}`);
    assert(d.accounts.owners_total >= 2, `owners_total counts both accounts, got ${d.accounts.owners_total}`);
    assert(typeof d.accounts.two_step_on === 'number', 'two_step_on is a count');
    assert(typeof d.settings.login_rate_limit.max === 'number', 'settings carry the sign-in rate limit');
    assert(typeof d.settings.tarpit.enabled === 'boolean', 'settings carry the tarpit');
    assert(typeof d.settings.auth_log.path === 'string', 'settings name the log file');
});

await test('The two knocks above are in the last 24 hours, grouped by door and by credential, newest first', async () => {
    const d = await overview(opToken);
    const door = d.refusals.by_door.find((x: any) => x.key === 'GET /v1/admin/security/overview');
    assert(!!door && door.count >= 2, `the overview door counts both knocks, got ${JSON.stringify(d.refusals.by_door)}`);
    const kinds = d.refusals.by_credential.map((x: any) => x.key);
    assert(kinds.includes('none'), `a knock with nothing presented is counted as "none", got ${JSON.stringify(kinds)}`);
    assert(kinds.some((k: string) => k.includes('jwt')), `the non-operator's token counts as a jwt kind, got ${JSON.stringify(kinds)}`);
    const tail = d.refusals.tail as Array<Record<string, unknown>>;
    for (let i = 1; i < tail.length; i++) assert(String(tail[i - 1].ts) >= String(tail[i].ts), 'the tail is newest first');
    const line403 = tail.find(l => l.status === 403 && String(l.path).includes('/v1/admin/security/overview'));
    assert(!!line403, 'the non-operator knock is in the tail');
    assert(!JSON.stringify(tail).includes(nonOpToken), 'the tail never carries the credential itself');
    assert(d.refusals.in_window >= 2, `in_window counts the knocks, got ${d.refusals.in_window}`);
});

await test('A refused upload becomes an open incident, and the page says so', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(opToken), body: JSON.stringify({ name: 'SecPage Org', type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(o.status === 201, `organism ${o.status}: ${JSON.stringify(o.body.error)}`);
    orgId = o.body.data.organism.id;
    const before = await overview(opToken);
    const seen = new Set<string>(before.incidents.items.map((i: any) => i.id));
    const res = await fetch(`${BASE}/v1/organisms/${orgId}/workspace/import`, { method: 'POST', headers: { ...auth(opToken), 'Content-Type': 'application/zip' }, body: Buffer.from('this is definitely not a zip archive') });
    assert(res.status === 422, `expected 422 for a non-zip body, got ${res.status}`);
    const d = await overview(opToken);
    const fresh = d.incidents.items.filter((i: any) => !seen.has(i.id));
    assert(fresh.length >= 1, 'the refusal was kept as an incident');
    incidentId = fresh[0].id;
    assert(fresh[0].status === 'open', `the new incident is open, got ${fresh[0].status}`);
    assert(fresh[0].actor_name === opName, `the incident names who tried, got ${fresh[0].actor_name}`);
    assert(d.incidents.open >= 1, 'the open count includes it');
    assert(d.now.open_incidents.zone === 'critical', `an open incident is critical, got ${d.now.open_incidents.zone}`);
    assert(d.now.status === 'open', `the status word is open, got ${d.now.status}`);
});

await test('Resolving closes it through the service; an unknown id is 404', async () => {
    const r = await json(`/v1/admin/security/incidents/${encodeURIComponent(incidentId)}/resolve`, { method: 'POST', headers: auth(opToken) });
    assert(r.status === 200 && r.body.data.resolved === true, `resolve ${r.status}: ${JSON.stringify(r.body)}`);
    assert(typeof r.body.data.resolved_at === 'string', 'the answer says when');
    const d = await overview(opToken);
    const it = d.incidents.items.find((i: any) => i.id === incidentId);
    assert(!!it && it.status === 'resolved' && typeof it.resolvedAt === 'string', `the incident reads resolved, got ${JSON.stringify(it)}`);
    const missing = await json('/v1/admin/security/incidents/no-such-incident/resolve', { method: 'POST', headers: auth(opToken) });
    assert(missing.status === 404, `unknown id expected 404, got ${missing.status}`);
    const nonOp = await json(`/v1/admin/security/incidents/${encodeURIComponent(incidentId)}/resolve`, { method: 'POST', headers: auth(nonOpToken) });
    assert(nonOp.status === 403, `non-operator resolve expected 403, got ${nonOp.status}`);
});

await test('Deleting drops it; an unknown id is 404', async () => {
    const r = await json(`/v1/admin/security/incidents/${encodeURIComponent(incidentId)}`, { method: 'DELETE', headers: auth(opToken) });
    assert(r.status === 200 && r.body.data.deleted === true, `delete ${r.status}: ${JSON.stringify(r.body)}`);
    const d = await overview(opToken);
    assert(!d.incidents.items.some((i: any) => i.id === incidentId), 'the incident is gone from the page');
    const missing = await json('/v1/admin/security/incidents/no-such-incident', { method: 'DELETE', headers: auth(opToken) });
    assert(missing.status === 404, `unknown id expected 404, got ${missing.status}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
