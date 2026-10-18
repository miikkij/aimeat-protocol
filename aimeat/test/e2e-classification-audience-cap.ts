/**
 * @file test/e2e-classification-audience-cap.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for a label's audience cap (plan doc-mvdipuyqraas, L3): a classification names the
 *   widest audience its content may have (`maxAudience`), and every place that sets who may read
 *   content or a container refuses a wider level with 409 LABEL_CAPS_AUDIENCE. Asserted over REST and
 *   the node MCP:
 *     - tighten-only: the owner's layer narrows the node's cap and is refused widening it (400
 *       POLICY_DILUTES);
 *     - the refusal at a representative point of each kind: a memory write (POST, PATCH, the bulk
 *       write, aimeat_memory_write), a stored file's visibility, a workspace share opened to the link,
 *       a board made public, an app listed, an organism made public; each stores nothing;
 *     - the override: the owner in person makes an 'audience' exception with a reason, it is on the
 *       exceptions list and in the audit log, and the record may then be public; without a reason it
 *       is refused (400 JUSTIFICATION_REQUIRED), and the owner's agent is refused (403 PERSON_REQUIRED);
 *     - a publish request filed before the label rose is not applied on approval: 409
 *       LABEL_CAPS_AUDIENCE, and the record stays private;
 *     - a label that rises over a public record lowers it at once and the owner gets a notification;
 *       a container's label that rises lowers the container (a public board becomes private).
 *   The operator (the suite's first account) sets the caps on the node's labels, turns classification
 *   on for every owner, and turns it off and restores the policy at the end.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=classification-audience-cap
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvdipuyqraas, L3).
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpAgent, type McpSession } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40252';
const stamp = Date.now();

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
/** One request. `method` is always written out by the caller, so a refusal test names what it refuses. */
async function call(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, token?: string, body?: unknown): Promise<{ status: number; body: Body }> {
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
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const CONF = 'luottamuksellinen';
const HIGH = 'erittain-luottamuksellinen';
const capped = (r: { status: number; body: Body }, what: string) =>
    assert(r.status === 409 && r.body?.error?.code === 'LABEL_CAPS_AUDIENCE', `${what}: ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data)}`);
const setLabel = (token: string, target: Record<string, string>, label: string) =>
    call('PUT', '/v1/classification/label', token, { ...target, label });
const html = (s: string) => `<!DOCTYPE html><html><head><title>${s}</title></head><body><p>${s}</p></body></html>`;

console.log('\n=== The audience cap of a classification (plan doc-mvdipuyqraas, L3) ===\n');

let op!: RegisteredOwner, alice!: RegisteredOwner;
let bot!: McpAgent, botMcp!: McpSession;
let nodePolicyBefore: Body | null = null;
let orgId = '', ws = '';
const setSwitch = (mode: string) => call('PUT', '/v1/admin/config', op.token, { changes: [{ path: 'classification.mode', value: mode }] });
const setGate = (value: string) => call('PUT', '/v1/admin/config', op.token, { changes: [{ path: 'visibility.publish_gate', value }] });
const write = (token: string, key: string, visibility: string) => call('POST', '/v1/memory', token, { key, value: { text: key }, visibility });
const visibilityOf = async (key: string): Promise<string> => {
    const r = await call('GET', `/v1/memory/${encodeURIComponent(alice.ghii)}/${encodeURIComponent(key)}`, alice.token);
    assert(r.status === 200, `read ${key}: ${r.status} ${JSON.stringify(r.body?.error)}`);
    return r.body.data.visibility as string;
};

await test('Setup: the operator caps Confidential at signed-in and Highly confidential at organism, and turns classification on', async () => {
    op = await registerOwner(BASE, `cacop${stamp}`);
    alice = await registerOwner(BASE, `cacalice${stamp}`);
    const now = await call('GET', `/v1/classification/policy?${q({ level: 'node' })}`, op.token);
    assert(now.status === 200, `node policy: ${now.status} ${JSON.stringify(now.body?.error)}`);
    nodePolicyBefore = now.body.data.effective;
    const labels = (nodePolicyBefore!.labels as Body[]).map(l => (l.id === CONF ? { ...l, maxAudience: 'signed-in' } : l.id === HIGH ? { ...l, maxAudience: 'organism' } : l));
    const put = await call('PUT', '/v1/classification/policy', op.token, { level: 'node', policy: { ...nodePolicyBefore, labels } });
    assert(put.status === 200 && put.body.data.applied === true, `node caps: ${put.status} ${JSON.stringify(put.body?.error ?? put.body?.data)}`);
    const on = await setSwitch('all');
    assert(on.status === 200, `switch all: ${on.status} ${JSON.stringify(on.body?.error)}`);
    bot = await makeAgent(BASE, alice, ['memory:read', 'memory:write'], `cacbot${stamp % 100000}`);
    botMcp = await openSession(BASE, bot.token, 'classification audience cap');
});

// ─── 1. The cap in the policy ───
console.log('\nThe cap in the policy: a lower level only narrows it');

await test('TIGHTEN-ONLY: alice\'s layer narrows Confidential to organism; widening it to public is refused, naming the label', async () => {
    const wide = await call('PUT', '/v1/classification/policy', alice.token, { level: 'owner', policy: { enabled: true, labels: [{ id: CONF, maxAudience: 'public' }] } });
    assert(wide.status === 400 && wide.body?.error?.code === 'POLICY_DILUTES' && String(wide.body.error.message).includes(CONF),
        `widen: ${wide.status} ${JSON.stringify(wide.body?.error)}`);
    const narrow = await call('PUT', '/v1/classification/policy', alice.token, { level: 'owner', policy: { enabled: true, labels: [{ id: CONF, maxAudience: 'organism' }] } });
    assert(narrow.status === 200 && narrow.body.data.applied === true, `narrow: ${narrow.status} ${JSON.stringify(narrow.body?.error ?? narrow.body?.data)}`);
    const read = await call('GET', `/v1/classification/policy?${q({ level: 'owner' })}`, alice.token);
    const conf = (read.body?.data?.effective?.labels as Body[] | undefined)?.find(l => l.id === CONF);
    assert(conf?.maxAudience === 'organism', `alice's effective cap: ${JSON.stringify(conf)}`);
});

// ─── 2. The refusal, one representative point of each kind ───
console.log('\nThe refusal: a wider level than the label allows stores nothing');

const k1 = `cac.secret.${stamp}`;
await test('MEMORY: POST, PATCH and the bulk write refuse a Confidential record a wider level (409); the record stays private', async () => {
    const w = await write(alice.token, k1, 'private');
    assert(w.status === 201, `write: ${w.status} ${JSON.stringify(w.body?.error)}`);
    const l = await setLabel(alice.token, { kind: 'memory', key: k1 }, CONF);
    assert(l.status === 200 && l.body.data.applied === true, `label: ${l.status} ${JSON.stringify(l.body?.error ?? l.body?.data)}`);
    capped(await write(alice.token, k1, 'public'), 'POST public');
    // alice's own layer caps Confidential at organism, so signed-in is over it too.
    capped(await write(alice.token, k1, 'members'), 'POST members');
    capped(await call('PATCH', `/v1/memory/${encodeURIComponent(k1)}`, alice.token, { patch: { more: 1 }, visibility: 'public' }), 'PATCH public');
    const bulk = await call('POST', '/v1/memory/bulk', alice.token, { entries: [{ key: k1, value: { n: 3 }, visibility: 'public' }] });
    const failedRow = (bulk.body?.data?.failed as Body[] | undefined)?.find(f => f.key === k1);
    assert(failedRow && String(failedRow.reason).startsWith('LABEL_CAPS_AUDIENCE'), `bulk: ${bulk.status} ${JSON.stringify(bulk.body?.data ?? bulk.body?.error)}`);
    assert(await visibilityOf(k1) === 'private', 'the record is no longer private');
});

const agentKey = `cac.agent.${stamp}`;
await test('MEMORY by the agent: aimeat_memory_write and POST /v1/memory are refused with LABEL_CAPS_AUDIENCE', async () => {
    const w = await write(bot.token, agentKey, 'private');
    assert(w.status === 201, `write: ${w.status} ${JSON.stringify(w.body?.error)}`);
    const l = await setLabel(alice.token, { kind: 'memory', key: agentKey, owner: bot.gaii }, CONF);
    assert(l.status === 200 && l.body.data.applied === true, `label: ${l.status} ${JSON.stringify(l.body?.error ?? l.body?.data)}`);
    const r = await callTool(botMcp, 'aimeat_memory_write', { key: agentKey, value: { n: 1 }, visibility: 'public' });
    assert(r.isError && r.text.includes('LABEL_CAPS_AUDIENCE'), `MCP write: ${r.text.slice(0, 300)}`);
    capped(await write(bot.token, agentKey, 'public'), 'REST write by the agent');
    const read = await call('GET', `/v1/memory/${encodeURIComponent(bot.gaii)}/${encodeURIComponent(agentKey)}`, alice.token);
    assert(read.status === 200 && read.body.data.visibility === 'private', `the record after: ${read.status} ${JSON.stringify(read.body?.data?.visibility ?? read.body?.error)}`);
});

await test('FILE: PATCH /v1/storage/{key}/visibility refuses a Highly confidential file public (409)', async () => {
    const key = `cacfile${stamp}.txt`;
    const up = await call('POST', '/v1/storage', alice.token, { key, data: b64('secret'), mime_type: 'text/plain', visibility: 'private' });
    assert(up.status === 201 || up.status === 200, `upload: ${up.status} ${JSON.stringify(up.body?.error)}`);
    const l = await setLabel(alice.token, { kind: 'file', key }, HIGH);
    assert(l.status === 200 && l.body.data.applied === true, `label: ${l.status} ${JSON.stringify(l.body?.error ?? l.body?.data)}`);
    capped(await call('PATCH', `/v1/storage/${encodeURIComponent(key)}/visibility`, alice.token, { visibility: 'public' }), 'file public');
});

await test('WORKSPACE SHARE: a Confidential workspace cannot be opened to the link (409); a share for signed-in accounts is allowed', async () => {
    const o = await call('POST', '/v1/organisms', alice.token, { name: `Cap org ${stamp}`, type: 'project', join_policy: 'invite', visibility: 'private' });
    assert(o.status === 201, `organism: ${o.status} ${JSON.stringify(o.body?.error)}`);
    orgId = o.body.data.organism.id;
    const w = await call('POST', `/v1/organisms/${orgId}/workspaces`, alice.token, { name: 'Plans', manifest: {
        manifestVersion: '1', name: 'Plans', kind: 'project',
        objectTypes: [{ name: 'item', namespace: 'shared.items', mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: 'schema:item@1' }],
    } });
    assert(w.status === 201 && typeof w.body?.data?.ws === 'string', `workspace: ${w.status} ${JSON.stringify(w.body?.error)}`);
    ws = w.body.data.ws;
    const l = await setLabel(alice.token, { kind: 'workspace', organism_id: orgId, ws }, CONF);
    assert(l.status === 200 && l.body.data.applied === true, `label: ${l.status} ${JSON.stringify(l.body?.error ?? l.body?.data)}`);
    capped(await call('PUT', `/v1/organisms/${orgId}/workspace/share?${q({ ws })}`, alice.token, { public: true, access: 'open' }), 'share open');
    const acct = await call('PUT', `/v1/organisms/${orgId}/workspace/share?${q({ ws })}`, alice.token, { public: true, access: 'account' });
    assert(acct.status === 200, `share to signed-in accounts: ${acct.status} ${JSON.stringify(acct.body?.error)}`);
});

await test('BOARD: a Highly confidential board cannot be made public (409); it stays shared', async () => {
    const b = await call('POST', '/v1/boards', alice.token, { name: `Cap board ${stamp}`, visibility: 'shared' });
    assert(b.status === 201, `board: ${b.status} ${JSON.stringify(b.body?.error)}`);
    const id = b.body.data.id as string;
    const l = await setLabel(alice.token, { kind: 'board', board_id: id }, HIGH);
    assert(l.status === 200 && l.body.data.applied === true, `label: ${l.status} ${JSON.stringify(l.body?.error ?? l.body?.data)}`);
    capped(await call('PATCH', `/v1/boards/${id}/visibility`, alice.token, { visibility: 'public' }), 'board public');
    const anon = await call('GET', '/v1/boards');
    assert(anon.status === 200 && !((anon.body.data?.boards as Body[] | undefined) ?? []).some(x => x.id === id), 'a stranger lists the board');
});

await test('APP: a Highly confidential app cannot be listed (409); narrowing it is allowed', async () => {
    const filename = `cacapp${stamp}.html`;
    const p = await call('POST', '/v1/apps', alice.token, { filename, content: b64(html('cap')), mime_type: 'text/html', description: 'Audience cap fixture' });
    assert(p.status === 201 || p.status === 200, `publish: ${p.status} ${JSON.stringify(p.body?.error)}`);
    const unlisted = await call('PATCH', `/v1/apps/${encodeURIComponent(filename)}`, alice.token, { listing: 'unlisted', access_code: `code${stamp}` });
    assert(unlisted.status === 200, `narrow first: ${unlisted.status} ${JSON.stringify(unlisted.body?.error)}`);
    const l = await setLabel(alice.token, { kind: 'app', app: filename }, HIGH);
    assert(l.status === 200 && l.body.data.applied === true, `label: ${l.status} ${JSON.stringify(l.body?.error ?? l.body?.data)}`);
    capped(await call('PATCH', `/v1/apps/${encodeURIComponent(filename)}`, alice.token, { listing: 'listed', access_code: '' }), 'app public');
    const keep = await call('PATCH', `/v1/apps/${encodeURIComponent(filename)}`, alice.token, { listing: 'community' });
    assert(keep.status === 200, `a change that stays behind the code: ${keep.status} ${JSON.stringify(keep.body?.error)}`);
});

await test('ORGANISM: a Confidential organism cannot be made public (409); it stays private', async () => {
    const l = await setLabel(alice.token, { kind: 'organism', organism_id: orgId }, CONF);
    assert(l.status === 200 && l.body.data.applied === true, `label: ${l.status} ${JSON.stringify(l.body?.error ?? l.body?.data)}`);
    capped(await call('PUT', `/v1/organisms/${orgId}`, alice.token, { visibility: 'public' }), 'organism public');
    const read = await call('GET', `/v1/organisms/${orgId}`, alice.token);
    assert(read.body?.data?.organism?.visibility === 'private' || read.body?.data?.visibility === 'private', `organism after: ${JSON.stringify(read.body?.data?.organism?.visibility ?? read.body?.data)}`);
});

// ─── 3. The owner's override ───
console.log('\nThe override: the owner in person, with a reason');

await test('OVERRIDE: without a reason the owner is refused (400 JUSTIFICATION_REQUIRED); the owner\'s agent is refused (403 PERSON_REQUIRED)', async () => {
    const none = await call('POST', '/v1/classification/exceptions', alice.token, { kind: 'memory', key: k1, action: 'audience' });
    assert(none.status === 400 && none.body?.error?.code === 'JUSTIFICATION_REQUIRED', `no reason: ${none.status} ${JSON.stringify(none.body?.error)}`);
    const agent = await call('POST', '/v1/classification/exceptions', bot.token, { kind: 'memory', key: agentKey, action: 'audience', reason: 'the agent wants it out' });
    assert(agent.status === 403 && agent.body?.error?.code === 'PERSON_REQUIRED', `agent: ${agent.status} ${JSON.stringify(agent.body?.error)}`);
    const viaMcp = await callTool(botMcp, 'aimeat_classification', { action: 'exception_set', key: agentKey, exception_action: 'audience', reason: 'the agent wants it out' });
    assert(viaMcp.isError && viaMcp.text.includes('PERSON_REQUIRED'), `agent over MCP: ${viaMcp.text.slice(0, 300)}`);
    capped(await write(bot.token, agentKey, 'public'), 'the agent still cannot make its record public');
});

await test('OVERRIDE: the owner makes an audience exception with a reason; it is listed and audited, and the record may be public', async () => {
    const reason = `press release ${stamp}`;
    const made = await call('POST', '/v1/classification/exceptions', alice.token, { kind: 'memory', key: k1, action: 'audience', reason });
    assert(made.status === 201 && made.body.data.action === 'audience' && made.body.data.label === CONF, `exception: ${made.status} ${JSON.stringify(made.body?.error ?? made.body?.data)}`);
    const list = await call('GET', `/v1/classification/exceptions?${q({ level: 'owner', action: 'audience' })}`, alice.token);
    assert(list.status === 200 && (list.body.data.exceptions as Body[]).some(e => e.reason === reason), `listed: ${JSON.stringify(list.body?.data ?? list.body?.error)}`);
    const w = await write(alice.token, k1, 'public');
    assert((w.status === 200 || w.status === 201) && w.body.data.visibility === 'public', `public with the exception: ${w.status} ${JSON.stringify(w.body?.error ?? w.body?.data?.visibility)}`);
    const audit = await call('GET', `/v1/classification/audit?${q({ level: 'owner', action: 'exception' })}`, alice.token);
    const rows = (audit.body?.data?.rows as Body[] | undefined) ?? [];
    assert(rows.some(r => String(r.purpose).includes('audience') && String(r.purpose).includes(reason)), `audit rows: ${JSON.stringify(rows.map(r => r.purpose))}`);
    assert(rows.some(r => String(r.purpose).startsWith('used')), `the use is audited: ${JSON.stringify(rows.map(r => r.purpose))}`);
});

// ─── 4. A publish request is held to the cap again ───
console.log('\nA publish request never carries content past the cap');

await test('PUBLISH REQUEST: approving a request filed before the label rose answers 409 LABEL_CAPS_AUDIENCE; the record stays private', async () => {
    const g = await setGate('agents-and-apps');
    assert(g.status === 200, `gate: ${g.status} ${JSON.stringify(g.body?.error)}`);
    try {
        const key = `cac.asked.${stamp}`;
        const asked = await write(bot.token, key, 'public');
        assert(asked.status === 202 && asked.body.data.publish_request?.request_id, `ask: ${asked.status} ${JSON.stringify(asked.body?.error ?? asked.body?.data)}`);
        const id = asked.body.data.publish_request.request_id as string;
        const l = await setLabel(alice.token, { kind: 'memory', key, owner: bot.gaii }, CONF);
        assert(l.status === 200 && l.body.data.applied === true, `label: ${l.status} ${JSON.stringify(l.body?.error ?? l.body?.data)}`);
        capped(await call('POST', `/v1/publish-requests/${id}/decision`, alice.token, { decision: 'approve' }), 'approve');
        const r = await call('GET', `/v1/memory/${encodeURIComponent(bot.gaii)}/${encodeURIComponent(key)}`, alice.token);
        assert(r.status === 200 && r.body.data.visibility === 'private', `the record after: ${r.status} ${JSON.stringify(r.body?.data?.visibility ?? r.body?.error)}`);
        const req = await call('GET', `/v1/publish-requests/${id}`, alice.token);
        assert(req.body?.data?.request?.state === 'outdated', `request state: ${JSON.stringify(req.body?.data?.request?.state ?? req.body?.error)}`);
    } finally {
        await setGate('off');
    }
});

// ─── 5. A label that rises ───
console.log('\nA label that rises lowers what is already wider, and tells the owner');

await test('RISE: a public record whose label rises to Confidential is made private at once, and alice is notified', async () => {
    const key = `cac.rise.${stamp}`;
    const w = await write(alice.token, key, 'public');
    assert(w.status === 201 && w.body.data.visibility === 'public', `public write: ${w.status} ${JSON.stringify(w.body?.error ?? w.body?.data?.visibility)}`);
    const anonBefore = await call('GET', `/v1/memory/${encodeURIComponent(alice.ghii)}/${encodeURIComponent(key)}`);
    assert(anonBefore.status === 200, `POSITIVE CONTROL: a stranger reads it before: ${anonBefore.status}`);
    const l = await setLabel(alice.token, { kind: 'memory', key }, CONF);
    assert(l.status === 200 && l.body.data.applied === true, `label: ${l.status} ${JSON.stringify(l.body?.error ?? l.body?.data)}`);
    // alice's layer caps Confidential at organism; a personal record has no organism, so it is private.
    assert(await visibilityOf(key) === 'private', 'the record was not lowered');
    const anon = await call('GET', `/v1/memory/${encodeURIComponent(alice.ghii)}/${encodeURIComponent(key)}`);
    assert(anon.status !== 200, `a stranger still reads it: ${anon.status}`);
    let note: Body | undefined;
    for (let i = 0; i < 30 && !note; i++) {
        const n = await call('GET', '/v1/notifications', alice.token);
        note = (n.body?.data?.notifications as Body[] | undefined)?.find(x => x.type === 'classification_audience_lowered' && String(x.title).includes(key));
        if (!note) await new Promise(r => setTimeout(r, 100));
    }
    assert(note, 'no classification_audience_lowered notification');
    assert(note.i18n?.key === 'audience_lowered', `the notification's words: ${JSON.stringify(note.i18n)}`);
});

await test('RISE on a container: a public board labelled Highly confidential is made private at once', async () => {
    const b = await call('POST', '/v1/boards', alice.token, { name: `Rise board ${stamp}`, visibility: 'public' });
    assert(b.status === 201 && b.body.data.visibility === 'public', `board: ${b.status} ${JSON.stringify(b.body?.error ?? b.body?.data?.visibility)}`);
    const id = b.body.data.id as string;
    const listed = async () => (((await call('GET', '/v1/boards')).body.data?.boards as Body[] | undefined) ?? []).some(x => x.id === id);
    assert(await listed(), 'POSITIVE CONTROL: a stranger lists the public board before');
    const l = await setLabel(alice.token, { kind: 'board', board_id: id }, HIGH);
    assert(l.status === 200 && l.body.data.applied === true, `label: ${l.status} ${JSON.stringify(l.body?.error ?? l.body?.data)}`);
    assert(!(await listed()), 'a stranger still lists the board');
});

await test('Cleanup: the operator turns classification off and restores the node policy', async () => {
    const off = await setSwitch('off');
    assert(off.status === 200, `switch off: ${off.status} ${JSON.stringify(off.body?.error)}`);
    if (nodePolicyBefore) {
        const back = await call('PUT', '/v1/classification/policy', op.token, { level: 'node', policy: nodePolicyBefore });
        assert(back.status === 200, `restore: ${back.status} ${JSON.stringify(back.body?.error)}`);
    }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
