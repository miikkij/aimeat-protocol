/**
 * @file test/e2e-regulated-ai-modes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for what an AI model outside this server gets of a regulated data domain (plan
 *   doc-mwnnp9xz9814, feature audit item 1.3). alice keeps an organism with a Patients workspace that a
 *   health register names, and a Plain workspace that no register names. Two of her agents read them:
 *   `far` runs its model elsewhere, `near` reports a local model.
 *     - notify (the default): far reads the record as before, and a `regulated` mark is written;
 *     - protect: far reads the record with the name, the phone number, the identity code and the
 *       e-mail address replaced by stand-ins, the same stand-in on every read; alice reads it whole;
 *     - local: far does not get it, near does; an AI job over it is refused; alice's 'ai-send'
 *       exception opens it for far, and the use is recorded;
 *     - block: neither agent gets it, and the exception does not open it: the attempt is marked as
 *       exceptional; alice still reads it on her own screen;
 *     - a register can tighten (block over the operator's notify) and never loosen;
 *     - an owner who does not run the node cannot set the modes, and another owner cannot change a register;
 *     - an agent cannot loosen the operator's setting (PERSON_REQUIRED), a person can;
 *     - the Plain workspace is never touched; the compliance report lists the marks;
 *     - the mode holds with classification off too.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-regulated-ai-modes
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (plan doc-mwnnp9xz9814, feature audit item 1.3).
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpAgent, type McpSession } from './helpers/mcp-session.js';
import { takeOffAudienceCaps } from './helpers/classification-caps.js';
import { startFakeAiProvider, chatJson, type FakeAiProvider } from './helpers/fake-ai-provider.js';
import { BASE, assert, expectRefusal, finish, test } from './helpers/harness.js';

const stamp = Date.now();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
async function call(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, token?: string, body?: unknown): Promise<{ status: number; body: Body }> {
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(90_000),
    });
    const text = await res.text();
    return { status: res.status, body: (res.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) as Body : { _raw: text } };
}
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

console.log('\n=== Regulated data domains and AI models outside this server (feature audit item 1.3) ===\n');

let op!: RegisteredOwner, alice!: RegisteredOwner;
// The model: its answer is the prompt, so what reached it can be read back.
const fake: FakeAiProvider = await startFakeAiProvider(0);
fake.setDefault('chat', (req) => chatJson(((req.json?.messages as Array<{ content: unknown }>) ?? [])
    .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n')));
const lastPrompt = (): string => {
    const all = fake.requestsFor('chat');
    return all.length ? all[all.length - 1]!.body : '';
};
let far!: McpAgent, near!: McpAgent, farMcp!: McpSession;
let orgId = '', patients = '', plain = '';
const NOTE = 'Soita 040 123 4567, hetu 010190-123A, maija.meikalainen@example.com';
const NAME = 'Maija Meikäläinen';
const ORG = () => ({ scope: 'organism', organism_id: orgId });
const KEY = (ws: string, id: string) => `organism.${orgId}.w.${ws}.shared.items.${id}`;
/** The stored key of a published record: the `latest` copy (workspace/public-collectors.ts). */
const LATEST = (ws: string, id: string) => `${KEY(ws, id)}.latest`;
const MANIFEST = (name: string) => ({
    manifestVersion: '1', name, kind: 'project',
    objectTypes: [{ name: 'item', namespace: 'shared.items', mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: 'schema:item@1' }],
});
const setConfig = (token: string, path: string, value: unknown) => call('PUT', '/v1/admin/config', token, { changes: [{ path, value }] });
const setModes = (modes: string[]) => setConfig(op.token, 'compliance.regulated_ai_modes', modes);
const register = (aiMode?: string) => call('PUT', `/v1/compliance/docs/registers?${q(ORG())}`, alice.token, {
    items: [{ id: 'patients', title: 'Patients', type: 'personal', purpose: 'patient', legalBasis: ['contract'], specialBasis: 'health-care',
        domains: ['health'], containers: [{ kind: 'workspace', organism_id: orgId, ws: patients }], retentionMonths: 120, ...(aiMode ? { aiMode } : {}) }],
});
/** The records of a workspace as this token reads them, by id. */
async function records(token: string, ws: string): Promise<Map<string, Body>> {
    const r = await call('GET', `/v1/organisms/${orgId}/workspace/records?${q({ ws, space: 'item' })}`, token);
    assert(r.status === 200, `records of ${ws}: ${r.status} ${JSON.stringify(r.body?.error)}`);
    return new Map((r.body.data.records as Body[]).map(x => [x.id as string, x]));
}
/** The audit rows of alice's content with this action, newest first, polled while the buffer flushes. */
async function marks(action: string, match: (r: Body) => boolean): Promise<Body[]> {
    let rows: Body[] = [];
    for (let i = 0; i < 12; i++) {
        const r = await call('GET', `/v1/classification/audit?${q({ level: 'organism', organism_id: orgId, action })}`, alice.token);
        assert(r.status === 200, `audit: ${r.status} ${JSON.stringify(r.body?.error)}`);
        rows = (r.body.data.rows as Body[]).filter(match);
        if (rows.length) return rows;
        await sleep(250);
    }
    return rows;
}
const regulatedRow = (r: Body) => String(r.purpose ?? '').startsWith('regulated health');
/** An AI job over the record: what the classification check answers before any model is called. */
const aiJob = (token: string, key: string) => call('POST', '/v1/schedules', token, {
    kind: 'ai', cron: '0 6 1 1 *', display_name: `reg${Math.random().toString(36).slice(2, 7)}`, prompt: 'Summarise the input.',
    input_keys: [key], output_key: `reg.out.${stamp}.${Math.random().toString(36).slice(2, 7)}`,
});
async function fire(token: string, key: string): Promise<{ outcome: string; reason: string }> {
    const s = await aiJob(token, key);
    assert(s.status === 201, `schedule: ${s.status} ${JSON.stringify(s.body?.error)}`);
    const id = s.body.data.schedule.id as string;
    const run = await call('POST', `/v1/schedules/${encodeURIComponent(id)}/trigger`, alice.token);
    await call('DELETE', `/v1/schedules/${encodeURIComponent(id)}`, alice.token);
    assert(run.status === 200, `trigger: ${run.status} ${JSON.stringify(run.body?.error)}`);
    return { outcome: String(run.body.data.outcome), reason: String(run.body.data.reason ?? '') };
}

await test('Setup: classification on; alice keeps Patients (a health register names it) and Plain; two agents, one reports a local model', async () => {
    op = await registerOwner(BASE, `regop${stamp}`);
    alice = await registerOwner(BASE, `regalice${stamp}`);
    const on = await setConfig(op.token, 'classification.mode', 'all');
    assert(on.status === 200, `switch all: ${on.status} ${JSON.stringify(on.body?.error)}`);
    await takeOffAudienceCaps(BASE, op.token);
    const o = await call('POST', '/v1/organisms', alice.token, { name: `Reg Modes ${stamp}`, type: 'project', join_policy: 'invite' });
    assert(o.status === 201, `organism: ${o.status} ${JSON.stringify(o.body?.error)}`);
    orgId = o.body.data.organism.id;
    for (const [name, set] of [['Patients', (w: string) => { patients = w; }], ['Plain', (w: string) => { plain = w; }]] as const) {
        const w = await call('POST', `/v1/organisms/${orgId}/workspaces`, alice.token, { name, manifest: MANIFEST(name) });
        assert(w.status === 201, `workspace ${name}: ${w.status} ${JSON.stringify(w.body?.error)}`);
        set(w.body.data.ws);
    }
    for (const ws of [patients, plain]) {
        const p = await call('POST', `/v1/organisms/${orgId}/workspace/records/publish`, alice.token, { ws, namespace: 'shared.items', records: [{ id: 'r1', value: { name: NAME, note: NOTE } }] });
        assert(p.status === 200 && p.body.data.published === 1, `publish in ${ws}: ${p.status} ${JSON.stringify(p.body?.data ?? p.body?.error)}`);
    }
    const reg = await register();
    assert(reg.status === 200 && reg.body.data.stored === true, `register: ${reg.status} ${JSON.stringify(reg.body?.error)}`);
    const settings = await call('POST', '/v1/memory', alice.token, { key: 'openrouter.settings', visibility: 'private',
        value: { provider: 'custom', baseUrl: fake.baseUrl, model: 'stub/reg-model', daily_budget_usd: 50 } });
    assert(settings.status === 201, `alice's model settings: ${settings.status} ${JSON.stringify(settings.body?.error)}`);
    far = await makeAgent(BASE, alice, ['*'], `regfar${stamp % 100000}`);
    near = await makeAgent(BASE, alice, ['*'], `regnear${stamp % 100000}`);
    farMcp = await openSession(BASE, far.token, 'regulated domains, a model elsewhere');
    const rep = await call('PATCH', `/v1/agents/${encodeURIComponent(near.name)}/runtime-source`, near.token, { runtime_source: { kind: 'python', llm: 'local' } });
    assert(rep.status === 200, `near reports a local model: ${rep.status} ${JSON.stringify(rep.body?.error)}`);
});

await test('NOTIFY (the default): far reads the Patients record as before, and a mark names the domain', async () => {
    const r = (await records(far.token, patients)).get('r1');
    assert(r?.value?.name === NAME && r.value.note === NOTE, `far reads it whole: ${JSON.stringify(r?.value)}`);
    const rows = await marks('regulated', regulatedRow);
    assert(rows.some(x => String(x.purpose).includes('(notify)') && x.label === 'domain:health'), `a notify mark: ${JSON.stringify(rows).slice(0, 500)}`);
});

await test('WHO: alice, who does not run the node, cannot set the modes (403); bob cannot change her register\'s mode (404)', async () => {
    const bob = await registerOwner(BASE, `regbob${stamp}`);
    const notOperator = await setConfig(alice.token, 'compliance.regulated_ai_modes', ['health=notify']);
    expectRefusal(notOperator, 403);
    const r = await call('PUT', `/v1/compliance/docs/registers?${q(ORG())}`, bob.token, { items: [] });
    expectRefusal(r, 404);
    const kept = await call('GET', `/v1/compliance/docs/registers?${q(ORG())}`, alice.token);
    assert(kept.status === 200 && kept.body.data.items.length === 1, `POSITIVE CONTROL, alice's register stays: ${JSON.stringify(kept.body?.data?.items?.length ?? kept.body?.error)}`);
});

await test('SETTING: an unknown domain or mode is refused (400); an agent cannot loosen it (403 PERSON_REQUIRED), a person can', async () => {
    expectRefusal(await setModes(['health=nothing']), 400);
    expectRefusal(await setModes(['nowhere=block']), 400);
    const opAgent = await makeAgent(BASE, op, ['*', 'operator:admin'], `regopa${stamp % 100000}`);
    const tighter = await setConfig(opAgent.token, 'compliance.regulated_ai_modes', ['health=local']);
    assert(tighter.status === 200, `an agent tightens: ${tighter.status} ${JSON.stringify(tighter.body?.error)}`);
    const looser = await setConfig(opAgent.token, 'compliance.regulated_ai_modes', ['health=protect']);
    expectRefusal(looser, 403, 'PERSON_REQUIRED');
    const person = await setModes(['health=protect']);
    assert(person.status === 200, `the operator in person loosens: ${person.status} ${JSON.stringify(person.body?.error)}`);
});

await test('PROTECT: far reads the record with the name, phone, identity code and e-mail replaced, the same stand-ins twice; alice reads it whole', async () => {
    const r = (await records(far.token, patients)).get('r1');
    const v = r?.value ?? {};
    assert(typeof v.name === 'string' && /^\[name-[0-9a-f]{8}\]$/.test(v.name), `the name: ${JSON.stringify(v)}`);
    for (const plainText of ['040 123 4567', '010190-123A', 'maija.meikalainen@example.com']) assert(!String(v.note).includes(plainText), `${plainText} left in: ${v.note}`);
    assert(/\[phone-[0-9a-f]{8}\]/.test(v.note) && /\[person-id-[0-9a-f]{8}\]/.test(v.note) && /\[email-[0-9a-f]{8}\]/.test(v.note), `the stand-ins: ${v.note}`);
    assert(String(v.note).startsWith('Soita '), `the rest of the text stays: ${v.note}`);
    const again = (await records(far.token, patients)).get('r1');
    assert(JSON.stringify(again?.value) === JSON.stringify(v), `stable: ${JSON.stringify(again?.value)} vs ${JSON.stringify(v)}`);
    const own = (await records(alice.token, patients)).get('r1');
    assert(own?.value?.name === NAME && own.value.note === NOTE, `POSITIVE CONTROL, alice on her own screen: ${JSON.stringify(own?.value)}`);
    const other = (await records(far.token, plain)).get('r1');
    assert(other?.value?.name === NAME && other.value.note === NOTE, `POSITIVE CONTROL, Plain is not regulated: ${JSON.stringify(other?.value)}`);
    const rows = await marks('regulated', x => regulatedRow(x) && String(x.purpose).includes('(protect)'));
    assert(rows.some(x => /name \d/.test(String(x.purpose)) && /phone \d/.test(String(x.purpose)) && /person-id \d/.test(String(x.purpose))), `the mark counts what was replaced: ${JSON.stringify(rows).slice(0, 500)}`);
});

await test('PROTECT: an AI job over the record hands the model the stand-ins, never the details', async () => {
    const run = await fire(alice.token, LATEST(patients, 'r1'));
    const prompt = lastPrompt();
    assert(prompt.includes('Soita'), `the model got the record: ${JSON.stringify(run)} ${prompt.slice(0, 300)}`);
    for (const detail of ['040 123 4567', '010190-123A', 'maija.meikalainen@example.com', 'Meikäläinen']) assert(!prompt.includes(detail), `${detail} reached the model: ${prompt.slice(0, 400)}`);
    assert(/\[phone-[0-9a-f]{8}\]/.test(prompt), `the stand-in reached it: ${prompt.slice(0, 400)}`);
});

await test('LOCAL: far does not get the record (REST and MCP), near does; Plain is untouched', async () => {
    assert((await setModes(['health=local'])).status === 200, 'set local');
    assert(!(await records(far.token, patients)).has('r1'), 'far gets the record');
    const m = await callTool(farMcp, 'aimeat_workspace_read', { organism_id: orgId, ws: patients, ids: ['r1'] });
    assert(!m.text.includes('Meikäläinen'), `far over MCP: ${m.text.slice(0, 300)}`);
    const n = (await records(near.token, patients)).get('r1');
    assert(n?.value?.name === NAME, `near, a local model, reads it: ${JSON.stringify(n?.value)}`);
    assert((await records(far.token, plain)).has('r1'), 'POSITIVE CONTROL, far reads Plain');
    const held = await marks('refused', x => regulatedRow(x) && String(x.purpose).includes('(local)'));
    assert(held.length > 0, 'a held-back mark');
});

await test('LOCAL: an AI job over the record is refused before any model is called, and the refusal says what to do', async () => {
    const run = await fire(alice.token, LATEST(patients, 'r1'));
    assert(run.outcome === 'error' && /regulated data domain health/.test(run.reason) && /local: model/.test(run.reason), `refused: ${JSON.stringify(run)}`);
    const control = await fire(alice.token, LATEST(plain, 'r1'));
    assert(!/regulated data domain/.test(control.reason), `POSITIVE CONTROL, Plain is not refused for its domain: ${JSON.stringify(control)}`);
});

let exceptionId = '';
await test('LOCAL + EXCEPTION: alice\'s ai-send exception opens the record for far, and the use is recorded', async () => {
    const e = await call('POST', '/v1/classification/exceptions', alice.token, { kind: 'memory', key: KEY(patients, 'r1'), action: 'ai-send', reason: 'My assistant writes the referral letter.' });
    assert(e.status === 201, `exception: ${e.status} ${JSON.stringify(e.body?.error)}`);
    exceptionId = e.body.data.id;
    const r = (await records(far.token, patients)).get('r1');
    assert(r?.value?.name === NAME, `far reads it by the exception: ${JSON.stringify(r?.value)}`);
    const rows = await marks('regulated', x => regulatedRow(x) && String(x.purpose).includes(exceptionId));
    assert(rows.length > 0, 'a mark names the exception');
});

await test('BLOCK: neither agent gets it; the exception does not open it and the attempt is marked as exceptional; alice reads it', async () => {
    assert((await setModes(['health=block'])).status === 200, 'set block');
    assert(!(await records(far.token, patients)).has('r1'), 'far gets the record');
    assert(!(await records(near.token, patients)).has('r1'), 'near, a local model, gets the record');
    const own = (await records(alice.token, patients)).get('r1');
    assert(own?.value?.name === NAME, `POSITIVE CONTROL, alice on her own screen: ${JSON.stringify(own?.value)}`);
    const rows = await marks('exception', x => regulatedRow(x) && String(x.purpose).includes('marked as exceptional'));
    assert(rows.some(x => String(x.purpose).includes(exceptionId)), `the exceptional mark names the exception: ${JSON.stringify(rows).slice(0, 500)}`);
    const run = await fire(alice.token, LATEST(patients, 'r1'));
    assert(run.outcome === 'error' && /every AI model/.test(run.reason), `an AI job is refused: ${JSON.stringify(run)}`);
});

await test('REGISTER: a register\'s own block holds over the operator\'s notify, and it cannot loosen the operator\'s block', async () => {
    await call('DELETE', `/v1/classification/exceptions/${encodeURIComponent(exceptionId)}`, alice.token);
    assert((await setModes([])).status === 200, 'operator back to notify');
    assert((await records(far.token, patients)).has('r1'), 'notify again: far reads it');
    assert((await register('block')).status === 200, 'register says block');
    assert(!(await records(far.token, patients)).has('r1'), 'the register\'s block holds');
    assert((await setModes(['health=block'])).status === 200, 'operator block');
    assert((await register('notify')).status === 200, 'register says notify');
    assert(!(await records(far.token, patients)).has('r1'), 'the register cannot loosen the operator\'s block');
});

await test('REPORT: section 14 lists the mode per domain, the suggestion, and the marks', async () => {
    const r = await call('GET', '/v1/admin/compliance/report', op.token);
    assert(r.status === 200, `report: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const s = r.body.data.regulated_ai;
    assert(s?.setting?.modes?.find((m: Body) => m.domain === 'health')?.mode === 'block', `the mode: ${JSON.stringify(s?.setting?.modes)}`);
    assert((s.setting.suggestions as Body[]).some(x => x.domain === 'biometric-genetic' && x.suggested === 'local'), `suggestions: ${JSON.stringify(s.setting.suggestions)}`);
    assert(s.marks.sent > 0 && s.marks.held > 0 && s.marks.exceptional > 0, `the counts: ${JSON.stringify({ sent: s.marks.sent, held: s.marks.held, exceptional: s.marks.exceptional })}`);
});

await test('CLASSIFICATION OFF: the block still holds; Plain still reads', async () => {
    assert((await setConfig(op.token, 'classification.mode', 'off')).status === 200, 'switch off');
    assert(!(await records(far.token, patients)).has('r1'), 'far gets the record with classification off');
    assert((await records(far.token, plain)).has('r1'), 'POSITIVE CONTROL, Plain');
});

await setModes([]);
await setConfig(op.token, 'classification.mode', 'off');
await fake.close();
finish();
