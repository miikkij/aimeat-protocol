/**
 * @file e2e-extension-rows.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An extension appends to an organism ROW space, also when nobody is present, and an
 *   extension that names its hosts reaches only those. The two core changes the aimeat-soc alert
 *   ingest stands on (wish-ydin-soc-lle-laajennuksen-rivikirjoitus-ajastettuna-mcp-vain).
 *
 *   Rows, the two-hand rule for an extension:
 *     - the space names the extension as installer/name (objectTypes[].extensions) and the manifest declares
 *       workspace.rows → appendRows and readRows work on a call AND on a schedule, and each row
 *       records `ext:<name>` as its writer;
 *     - a repeated rowId replaces the stored row (the ingest's duplicate removal);
 *     - a schedule gets ONLY the row calls: a record write on the same run is PERMISSION;
 *     - a space that names the extension's name under another installer → 403 ACCESS_DENIED;
 *     - an extension whose installer is not a member → 403 ACCESS_DENIED;
 *     - an extension without workspace.rows, although named → 403 PERMISSION.
 *   Hosts, manifest network.hosts:
 *     - a listed host answers; an unlisted one is refused before anything is sent;
 *     - a redirect from a listed host to an unlisted one is refused on the hop;
 *     - a manifest naming a URL instead of a hostname, or hosts without network in capabilities,
 *       is refused at install.
 *   Host fields, manifest network.host_fields, PATCH /v1/extensions/:name/config:
 *     - unset, the extension reaches nothing and the refusal says the field is not set;
 *     - another owner setting it → 404; a URL in place of a host → 400, nothing changed;
 *     - set, ctx.fetch reaches that host and no other; changed, the list moves, same version.
 *   A workflow's extension step, input_from:
 *     - propose → a person approves → act: the act step receives the earlier step's result and the
 *       person's answer as input, and appends the action as a row.
 *
 *   FIRST FAIL. Against the tree before this change, `ctx.workspace` is undefined on a schedule and
 *   has no appendRows on a call, the manifest refuses `workspace.rows` as an unknown field, and
 *   `network:` is ignored, so the unlisted host is reached. Each assertion of the new behaviour is
 *   marked `// HOLE:`.
 * @version-history
 *   v1.1.0 — 2026-10-09 — Host fields (wish-a-package-s-extension-hosts-settable-per-install-the-soc-s-w).
 *   v1.0.0 — 2026-10-08 — Initial (aimeat-soc core).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=extension-rows

import http from 'node:http';
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

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
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}
async function setupOwner(label: string) {
    const name = `exr${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Ext Rows', password: 'ExtRows12345' }) });
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }) });
    assert(tok.body?.ok === true, `token: ${JSON.stringify(tok.body?.error)}`);
    return { name, token: tok.body.data.token as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

console.log('\n=== Extension rows (unattended) and declared hosts E2E ===\n');

// ─── A far side for ctx.fetch: /ok answers, /hop redirects to the same port by IP ───
// Far from the node's port, as e2e-mcp-proxy keeps its upstream: neighbouring sessions run suites.
const FAR_PORT = Number(new URL(BASE).port || '40251') + 230;
const far = http.createServer((req, res) => {
    if (req.url === '/hop') { res.writeHead(302, { Location: `http://127.0.0.1:${FAR_PORT}/ok` }); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('far-ok');
});
// No host: dual-stack, so `localhost` answers whether it resolves to ::1 or 127.0.0.1.
await new Promise<void>(r => far.listen(FAR_PORT, () => r()));

const STAMP = Date.now();
const EXT = `exrows${STAMP}`;        // A's: rows + hosts
const EXT_X = `exrowsx${STAMP}`;     // X's: rows, but X is not a member
const EXT_NR = `exrowsnr${STAMP}`;   // A's: named in the space, no workspace.rows
const WS = 'wssoc';

const ROW_SCRIPTS = {
    ingest: `export default async function(ctx, input){
        var rows = input.ids.map(function(id){ return { rowId: id, occurredAt: '2026-10-08T10:00:00Z', body: { severity: 'high', source: 'wazuh', note: 'alert ' + id } }; });
        return ctx.workspace.appendRows(input.org, input.ws, input.space || 'alert', rows);
    }`,
    read: `export default async function(ctx, input){ return ctx.workspace.readRows(input.org, input.ws, 'alert', { where: { severity: 'high' } }); }`,
    write_record: `export default async function(ctx, input){ return ctx.workspace.write(input.org, input.ws, 'note', 'n1', { title: 'x' }); }`,
    // A workflow's response step: it acts only on what the person picked, and records it as a row.
    propose: `export default async function(ctx, input){ return { action: 'isolate_host', deviceId: 'dev-7' }; }`,
    act: `export default async function(ctx, input){
        if (!input.decision || !input.proposal) throw new Error('NO_INPUT: decision ' + JSON.stringify(input.decision) + ' proposal ' + JSON.stringify(input.proposal));
        var approved = input.decision.pick === 'approve';
        await ctx.workspace.appendRows(input.org, input.ws, 'alert', [{ rowId: 'act-' + input.run, body: { severity: 'info', source: 'soc', note: (approved ? 'done ' : 'skipped ') + input.proposal.action + ' ' + input.proposal.deviceId } }]);
        return { approved: approved, action: input.proposal.action };
    }`,
};
const FETCH_SCRIPTS = {
    fetch_listed: `export default async function(ctx, input){ var r = await ctx.fetch('http://localhost:' + input.port + '/ok'); return { status: r.status, text: r.text }; }`,
    fetch_unlisted: `export default async function(ctx, input){ var r = await ctx.fetch('http://127.0.0.1:' + input.port + '/ok'); return { status: r.status }; }`,
    fetch_hop: `export default async function(ctx, input){ var r = await ctx.fetch('http://localhost:' + input.port + '/hop'); return { status: r.status }; }`,
};
const manifestFor = (name: string, scripts: Record<string, string>, extra: Record<string, unknown>) => JSON.stringify({
    metadata: { name, version: '1.0.0', description: 'extension rows e2e', author: 'e2e' },
    actions: Object.keys(scripts).map(id => ({ id, method: 'POST', path: `/${id}`, script: id })),
    ...extra,
});

let A!: Awaited<ReturnType<typeof setupOwner>>;   // organism creator, installs EXT and EXT_NR
let X!: Awaited<ReturnType<typeof setupOwner>>;   // not a member, installs EXT_X
let orgId = '';
const root = () => `organism.${orgId}.w.${WS}`;
const invoke = (ext: string, action: string, token: string, input: Record<string, unknown> = {}) =>
    json(`/v1/ext/${ext}/${action}`, { method: 'POST', headers: auth(token), body: JSON.stringify({ org: orgId, ws: WS, port: FAR_PORT, ...input }) });
const rows = () => json(`/v1/organisms/${orgId}/workspace/rows/alert?ws=${WS}`, { headers: auth(A.token) });

await test('Setup: two owners, an organism, a workspace whose alert space names the extensions', async () => {
    A = await setupOwner('a'); X = await setupOwner('x');
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'SOC rows e2e', type: 'project', join_policy: 'invite_only', visibility: 'private' }) });
    assert(o.status === 201, `org ${o.status}: ${JSON.stringify(o.body?.error)}`); orgId = o.body.data.organism.id;
    const reg = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'SOC', createdAt: new Date().toISOString(), createdBy: A.name }] }, visibility: 'private' }) });
    assert(reg.status === 201 || reg.status === 200, `registry ${reg.status}`);
    const man = {
        manifestVersion: '1.0', id: orgId, name: 'SOC', kind: 'project', status: 'active',
        objectTypes: [
            { name: 'alert', schemaRef: 'schema:alert@1', namespace: 'soc.alert', backing: 'rows', writeRole: 'member', mode: 'records',
              indexOn: ['severity', 'source'], extensions: [`${A.name}/${EXT}`, `${X.name}/${EXT_X}`, `${A.name}/${EXT_NR}`] },
            // Names EXT under the wrong installer: the name alone must not open the space.
            { name: 'other', schemaRef: 'schema:other@1', namespace: 'soc.other', backing: 'rows', writeRole: 'member', mode: 'records', indexOn: ['severity'],
              extensions: [`${X.name}/${EXT}`] },
            { name: 'note', schemaRef: 'schema:note@1', namespace: 'soc.note', backing: 'memory', writeRole: 'member', mode: 'records' },
        ],
    };
    const mr = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `${root()}.meta.manifest`, value: man, visibility: 'private' }) });
    // HOLE: a strict schema refusing `extensions` would answer 422 here; the open envelope takes it.
    assert(mr.status === 201 || mr.status === 200, `manifest ${mr.status}: ${JSON.stringify(mr.body?.error)}`);
});

await test('Install: rows + hosts (A), rows (X, not a member), named without rows (A)', async () => {
    const installs: Array<[string, typeof A, Record<string, string>, Record<string, unknown>]> = [
        [EXT, A, { ...ROW_SCRIPTS, ...FETCH_SCRIPTS }, { workspace: { rows: true }, capabilities: ['network'], network: { hosts: ['localhost'] } }],
        [EXT_X, X, ROW_SCRIPTS, { workspace: { rows: true } }],
        [EXT_NR, A, ROW_SCRIPTS, { workspace: { read: true } }],
    ];
    for (const [name, who, scripts, extra] of installs) {
        const inst = await json('/v1/extensions', { method: 'POST', headers: auth(who.token), body: JSON.stringify({ manifest: manifestFor(name, scripts, extra), scripts }) });
        // HOLE: before this change `workspace.rows` was refused as an unknown field (400).
        assert(inst.status === 201, `install ${name} ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
        const act = await json(`/v1/extensions/${name}/activate`, { method: 'POST', headers: auth(who.token) });
        assert(act.status === 200, `activate ${name} ${act.status}`);
    }
});

await test('On a call: appendRows writes into the space that names it, as ext:<name>', async () => {
    const r = await invoke(EXT, 'ingest', A.token, { ids: ['a1', 'a2'] });
    // HOLE: 500 EXTENSION_ERROR (appendRows is not a function) before this change.
    assert(r.status === 200, `ingest ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(r.body.data.written === 2, `written: ${JSON.stringify(r.body.data)}`);
    const page = await rows();
    assert(page.status === 200, `rows ${page.status}`);
    const got = page.body.data.rows as Array<{ rowId: string; createdBy: string }>;
    assert(got.length === 2, `two rows: ${got.length}`);
    assert(got.every(x => x.createdBy === `ext:${EXT}`), `writer: ${JSON.stringify(got.map(x => x.createdBy))}`);
});

await test('A repeated rowId replaces the row instead of adding one', async () => {
    const r = await invoke(EXT, 'ingest', A.token, { ids: ['a1', 'a2'] });
    assert(r.status === 200, `ingest again ${r.status}`);
    const page = await rows();
    assert((page.body.data.rows as unknown[]).length === 2, `still two rows: ${(page.body.data.rows as unknown[]).length}`);
});

await test('readRows filters on an indexed field of that space', async () => {
    const r = await invoke(EXT, 'read', A.token);
    assert(r.status === 200, `read ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert((r.body.data.rows as unknown[]).length === 2, `rows: ${JSON.stringify(r.body.data).slice(0, 200)}`);
});

let scheduleId = '';
await test('On a schedule, with nobody present: appendRows works', async () => {
    const mk = await json('/v1/schedules', {
        method: 'POST', headers: auth(A.token),
        body: JSON.stringify({ name: `ingest-${EXT}`, kind: 'extension', cron: '0 6 * * 1', extension_name: EXT, action_id: 'ingest', input: { org: orgId, ws: WS, ids: ['s1'] } }),
    });
    assert(mk.status === 201 || mk.status === 200, `schedule ${mk.status}: ${JSON.stringify(mk.body?.error)}`);
    scheduleId = mk.body.data.schedule?.id ?? mk.body.data.id;
    const t = await json(`/v1/schedules/${scheduleId}/trigger`, { method: 'POST', headers: auth(A.token), body: '{}' });
    assert(t.status === 200, `trigger ${t.status}`);
    // HOLE: 'error' (ctx.workspace is undefined on a schedule) before this change.
    assert(t.body.data.schedule.lastRunResult === 'success', `run: ${t.body.data.schedule.lastRunError ?? ''}`);
    const page = await rows();
    assert((page.body.data.rows as Array<{ rowId: string }>).some(x => x.rowId === 's1'), 'the scheduled row landed');
});

await test('On a schedule, a record write is PERMISSION: only the row calls exist there', async () => {
    const mk = await json('/v1/schedules', {
        method: 'POST', headers: auth(A.token),
        body: JSON.stringify({ name: `write-${EXT}`, kind: 'extension', cron: '0 7 * * 1', extension_name: EXT, action_id: 'write_record', input: { org: orgId, ws: WS } }),
    });
    const id = mk.body.data.schedule?.id ?? mk.body.data.id;
    const t = await json(`/v1/schedules/${id}/trigger`, { method: 'POST', headers: auth(A.token), body: '{}' });
    assert(t.body.data.schedule.lastRunResult === 'error', `the run must fail, got ${t.body.data.schedule.lastRunResult}`);
    assert(/PERMISSION/.test(t.body.data.schedule.lastRunError ?? ''), `with PERMISSION: ${t.body.data.schedule.lastRunError}`);
    await json(`/v1/schedules/${id}`, { method: 'DELETE', headers: auth(A.token) });
});

await test('A space naming the extension under another installer: 403 ACCESS_DENIED, nothing written', async () => {
    const r = await invoke(EXT, 'ingest', A.token, { ids: ['o1'], space: 'other' });
    assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(JSON.stringify(r.body).includes('ACCESS_DENIED'), `code: ${JSON.stringify(r.body?.error)}`);
    const page = await json(`/v1/organisms/${orgId}/workspace/rows/other?ws=${WS}`, { headers: auth(A.token) });
    assert((page.body.data.rows as unknown[]).length === 0, 'nothing in the other space');
});

await test('An extension whose installer is not a member: 403, although the space names it', async () => {
    const r = await invoke(EXT_X, 'ingest', X.token, { ids: ['x1'] });
    assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(/not an active member/.test(JSON.stringify(r.body)), `reason: ${JSON.stringify(r.body?.error)}`);
});

await test('An extension named in the space but without workspace.rows: PERMISSION', async () => {
    const r = await invoke(EXT_NR, 'ingest', A.token, { ids: ['n1'] });
    assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(JSON.stringify(r.body).includes('PERMISSION'), `code: ${JSON.stringify(r.body?.error)}`);
    const page = await rows();
    assert(!(page.body.data.rows as Array<{ rowId: string }>).some(x => x.rowId === 'n1'), 'n1 was not written');
});

await test('Hosts: the listed host answers', async () => {
    const r = await invoke(EXT, 'fetch_listed', A.token);
    assert(r.status === 200, `fetch ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(r.body.data.text === 'far-ok', `answer: ${JSON.stringify(r.body.data)}`);
});

await test('Hosts: an unlisted host is refused before anything is sent', async () => {
    const r = await invoke(EXT, 'fetch_unlisted', A.token);
    // HOLE: 200 before this change, because network: was ignored.
    assert(r.status !== 200, `expected a refusal, got 200: ${JSON.stringify(r.body)}`);
    assert(/not one of the hosts this extension declared/.test(JSON.stringify(r.body)), `reason: ${JSON.stringify(r.body?.error)}`);
});

await test('Hosts: a redirect from a listed host to an unlisted one is refused on the hop', async () => {
    const r = await invoke(EXT, 'fetch_hop', A.token);
    // HOLE: 200 before this change; the hop was followed to 127.0.0.1.
    assert(r.status !== 200, `expected a refusal, got 200: ${JSON.stringify(r.body)}`);
    assert(/redirect named it/.test(JSON.stringify(r.body)), `reason: ${JSON.stringify(r.body?.error)}`);
});

await test('Hosts: a URL in place of a hostname, and hosts without network, are refused at install', async () => {
    const url = await json('/v1/extensions', { method: 'POST', headers: auth(A.token), body: JSON.stringify({
        manifest: manifestFor(`exrowsbad${STAMP}`, FETCH_SCRIPTS, { capabilities: ['network'], network: { hosts: ['https://localhost'] } }), scripts: FETCH_SCRIPTS }) });
    assert(url.status === 400 && /network\.hosts/.test(JSON.stringify(url.body)), `url host: ${url.status} ${JSON.stringify(url.body?.error)}`);
    const nonet = await json('/v1/extensions', { method: 'POST', headers: auth(A.token), body: JSON.stringify({
        manifest: manifestFor(`exrowsbad2${STAMP}`, FETCH_SCRIPTS, { capabilities: ['ai'], network: { hosts: ['localhost'] } }), scripts: FETCH_SCRIPTS }) });
    assert(nonet.status === 400 && /capabilities does not include network/.test(JSON.stringify(nonet.body)), `no network: ${nonet.status} ${JSON.stringify(nonet.body?.error)}`);
});

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function runOf(wf: string, runId: string): Promise<any> {
    const g = await json(`/v1/workflows/${wf}/runs/${runId}`, { headers: auth(A.token) });
    return g.body.data?.run ?? g.body.data;
}

await test('Workflow: an extension step acts on an earlier result and a person\'s answer (input_from)', async () => {
    const wf = `exr-wf-${STAMP}`;
    const def = {
        title: { en_US: 'Propose, decide, act' }, description: { en_US: 'input_from e2e' },
        trigger: { kind: 'manual' }, vars: [{ name: 'run', type: 'string', description: { en_US: 'run tag' }, default: 'r1' }], on_step_fail: 'inspect',
        steps: [
            { id: 'propose', description: { en_US: 'Propose' }, required_to_function: 'none',
              action: { kind: 'extension', extension: EXT, action: 'propose', input: {}, result_to_key: `exr.${STAMP}.{run}.proposal` } },
            { id: 'decide', after: ['propose'], description: { en_US: 'Decide' },
              action: { kind: 'human-input', question: { prompt: 'Isolate dev-7?', options: [{ id: 'approve', label: 'Approve' }, { id: 'reject', label: 'Reject' }] },
                        answer_to_key: `exr.${STAMP}.{run}.decision`, reviews_key: `exr.${STAMP}.{run}.proposal` } },
            { id: 'act', after: ['decide'], description: { en_US: 'Act' },
              action: { kind: 'extension', extension: EXT, action: 'act', input: { org: orgId, ws: WS, run: '{run}' },
                        input_from: { proposal: `exr.${STAMP}.{run}.proposal`, decision: `exr.${STAMP}.{run}.decision` },
                        result_to_key: `exr.${STAMP}.{run}.acted` } },
        ],
    };
    const put = await json(`/v1/workflows/${wf}`, { method: 'PUT', headers: auth(A.token), body: JSON.stringify(def) });
    // Before this change the save passed too: zod strips the unknown key on this lax step kind, and
    // the act step then threw NO_INPUT. The HOLE assertion below is the one that catches it.
    assert(put.status === 200 || put.status === 201, `save ${put.status}: ${JSON.stringify(put.body?.error ?? put.body?.data?.errors)}`);
    const r = await json(`/v1/workflows/${wf}/run`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ mode: 'full' }) });
    const runId = r.body.data.run?.runId ?? r.body.data.runId;
    assert(typeof runId === 'string', `run ${r.status}: ${JSON.stringify(r.body?.error)}`);
    let run: any;
    for (let i = 0; i < 40; i++) { run = await runOf(wf, runId); if (run?.steps?.decide?.state === 'waiting-human') break; await sleep(250); }
    assert(run.steps.decide.state === 'waiting-human', `decide waits, got ${run.steps.decide.state} (propose ${run.steps.propose.state})`);
    const ans = await json(`/v1/workflows/${wf}/runs/${runId}/steps/decide/answer`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ picks: ['approve'] }) });
    assert(ans.status === 200, `answer ${ans.status}: ${JSON.stringify(ans.body?.error)}`);
    for (let i = 0; i < 40; i++) { run = await runOf(wf, runId); if (run && !['running', 'waiting-step'].includes(run.status)) break; await sleep(250); }
    // HOLE: before this change the act step threw NO_INPUT and went red.
    assert(run.steps.act.state === 'green', `act ${run.steps.act.state}: ${JSON.stringify(run.steps.act.error ?? run.steps.act.outputObserved ?? '')}`);
    const acted = await json(`/v1/memory/${encodeURIComponent(`exr.${STAMP}.r1.acted`)}`, { headers: auth(A.token) });
    assert(acted.body.data?.value?.approved === true && acted.body.data.value.action === 'isolate_host', `acted: ${JSON.stringify(acted.body.data?.value)}`);
    const page = await rows();
    assert((page.body.data.rows as Array<{ rowId: string; body: { note: string } }>).some(x => x.rowId === 'act-r1' && x.body.note === 'done isolate_host dev-7'), 'the action row landed');
    await json(`/v1/workflows/${wf}`, { method: 'DELETE', headers: auth(A.token) });
});

await test('Workflow: a missing input_from key arrives as null, and the act step goes red instead of acting', async () => {
    const wf = `exr-wf-miss-${STAMP}`;
    const def = {
        title: { en_US: 'Act without a decision' }, description: { en_US: 'input_from missing key' },
        trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect',
        steps: [{ id: 'act', description: { en_US: 'Act' }, required_to_function: 'none',
            action: { kind: 'extension', extension: EXT, action: 'act', input: { org: orgId, ws: WS, run: 'miss' },
                      input_from: { proposal: `exr.${STAMP}.nothing.proposal`, decision: `exr.${STAMP}.nothing.decision` },
                      result_to_key: `exr.${STAMP}.miss.acted` } }],
    };
    const put = await json(`/v1/workflows/${wf}`, { method: 'PUT', headers: auth(A.token), body: JSON.stringify(def) });
    assert(put.status === 200 || put.status === 201, `save ${put.status}`);
    const r = await json(`/v1/workflows/${wf}/run`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ mode: 'full' }) });
    const runId = r.body.data.run?.runId ?? r.body.data.runId;
    let run: any;
    for (let i = 0; i < 40; i++) { run = await runOf(wf, runId); if (run && !['running', 'waiting-step'].includes(run.status)) break; await sleep(250); }
    assert(run.steps.act.state !== 'green', `act must not green on null input, got ${run.steps.act.state}`);
    const page = await rows();
    assert(!(page.body.data.rows as Array<{ rowId: string }>).some(x => x.rowId === 'act-miss'), 'nothing was recorded');
    await json(`/v1/workflows/${wf}`, { method: 'DELETE', headers: auth(A.token) });
});

await test('Workflow: input_from is a read, so an agent with workflow:write and no memory:read is refused the save', async () => {
    const da = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: `exrwf${STAMP % 100000}`, owner: A.name }) });
    await json('/v1/agents/verify', { method: 'POST', body: JSON.stringify({ user_code: da.body.data.user_code, action: 'approve', scopes: ['workflow:write', 'workflow:read', 'ext:invoke'], owner_token: A.token }) });
    const tok = await json('/v1/agents/device-token', { method: 'POST', body: JSON.stringify({ device_code: da.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
    assert(typeof tok.body?.token === 'string', `agent token ${tok.status}`);
    const def = {
        title: { en_US: 'Read by input_from' }, description: { en_US: 'authority' },
        trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect',
        steps: [{ id: 'act', description: { en_US: 'Act' }, required_to_function: 'none',
            action: { kind: 'extension', extension: EXT, action: 'propose', input: {}, input_from: { secret: 'some.private.key' }, result_to_key: `exr.${STAMP}.auth` } }],
    };
    const put = await json(`/v1/workflows/exr-wf-auth-${STAMP}`, { method: 'PUT', headers: auth(tok.body.token), body: JSON.stringify(def) });
    // GUARD, not hole: a valid extension step already needs result_to_key or a signal, and both are
    // reads, so memory:read was asked before input_from existed. step-authority.ts counts input_from
    // as a read too, so the rule holds if that validation ever loosens.
    assert(put.status === 403, `expected 403, got ${put.status}: ${JSON.stringify(put.body?.error)}`);
    assert(/memory:read/.test(JSON.stringify(put.body)), `names the permission: ${JSON.stringify(put.body?.error)}`);
});

// ─── Host fields: a host the installer sets, changed by the owner without a reinstall ───
const EXT_H = `exrowsh${STAMP}`;
const setHost = (token: string, value: string) => json(`/v1/extensions/${EXT_H}/config`, {
    method: 'PATCH', headers: auth(token), body: JSON.stringify({ config: { FAR_HOST: value } }) });

await test('Host field: installed with no value, the extension reaches nothing and says the field is not set', async () => {
    const inst = await json('/v1/extensions', { method: 'POST', headers: auth(A.token), body: JSON.stringify({
        manifest: manifestFor(EXT_H, FETCH_SCRIPTS, { capabilities: ['network'], network: { host_fields: { FAR_HOST: 'optional' } },
            config: { FAR_HOST: { description: 'The far side' } } }), scripts: FETCH_SCRIPTS }) });
    // HOLE: 400 before this change: network had to be a non-empty hosts list and nothing else.
    assert(inst.status === 201, `install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
    const act = await json(`/v1/extensions/${EXT_H}/activate`, { method: 'POST', headers: auth(A.token) });
    assert(act.status === 200, `activate ${act.status}`);
    const r = await invoke(EXT_H, 'fetch_listed', A.token);
    assert(r.status !== 200 && /has not set the host field FAR_HOST/.test(JSON.stringify(r.body)), `expected the not-set refusal, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
});

await test('Host field: another owner cannot set it, and a URL in place of a host is refused', async () => {
    const other = await setHost(X.token, 'localhost');
    assert(other.status === 404, `other owner: expected 404, got ${other.status}`);
    const url = await setHost(A.token, 'https://localhost');
    assert(url.status === 400 && /FAR_HOST is a host field/.test(JSON.stringify(url.body)), `url: ${url.status} ${JSON.stringify(url.body?.error)}`);
    const still = await invoke(EXT_H, 'fetch_listed', A.token);
    assert(still.status !== 200, `nothing changed, got ${still.status}`);
});

await test('Host field: the owner sets it, and ctx.fetch reaches that host and no other', async () => {
    const set = await setHost(A.token, 'LocalHost');
    // HOLE: 404 before this change; the route did not exist.
    assert(set.status === 200, `set ${set.status}: ${JSON.stringify(set.body?.error)}`);
    assert(JSON.stringify(set.body.data.network_hosts) === '["localhost"]', `hosts: ${JSON.stringify(set.body.data)}`);
    const ok = await invoke(EXT_H, 'fetch_listed', A.token);
    assert(ok.status === 200 && ok.body.data.text === 'far-ok', `listed ${ok.status}: ${JSON.stringify(ok.body?.error ?? ok.body.data)}`);
    const no = await invoke(EXT_H, 'fetch_unlisted', A.token);
    assert(no.status !== 200 && /not one of the hosts this extension declared/.test(JSON.stringify(no.body)), `unlisted ${no.status}`);
});

await test('Host field: changing it moves the allowlist with no new version', async () => {
    const set = await setHost(A.token, '127.0.0.1');
    assert(set.status === 200, `set ${set.status}: ${JSON.stringify(set.body?.error)}`);
    const now = await invoke(EXT_H, 'fetch_unlisted', A.token);
    assert(now.status === 200, `127.0.0.1 now ${now.status}: ${JSON.stringify(now.body?.error)}`);
    const before = await invoke(EXT_H, 'fetch_listed', A.token);
    assert(before.status !== 200, `localhost is no longer listed, got ${before.status}`);
    const got = await json(`/v1/extensions/${EXT_H}`, { headers: auth(A.token) });
    assert(got.body.data?.version === '1.0.0' || got.body.data?.extension?.version === '1.0.0', `version: ${JSON.stringify(got.body.data?.version ?? got.body.data?.extension?.version)}`);
});

// ─── Cleanup ───
await test('Cleanup: schedule, extensions, rows', async () => {
    if (scheduleId) await json(`/v1/schedules/${scheduleId}`, { method: 'DELETE', headers: auth(A.token) });
    for (const [name, who] of [[EXT, A], [EXT_X, X], [EXT_NR, A], [EXT_H, A]] as const) {
        await json(`/v1/extensions/${name}`, { method: 'DELETE', headers: auth(who.token) });
    }
    await json(`/v1/organisms/${orgId}/workspace/rows/alert?ws=${WS}&before=2100-01-01T00:00:00Z`, { method: 'DELETE', headers: auth(A.token) });
});

far.close();
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
