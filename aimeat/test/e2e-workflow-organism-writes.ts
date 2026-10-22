/**
 * @file test/e2e-workflow-organism-writes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A workflow step's answer to an `organism.*` key meets the organism namespace rule the
 *   memory route meets.
 *
 *   WHY THIS SUITE EXISTS. The memory route and the AI job start refuse an owner who is not a member of
 *   an organism a write to that organism's workspace record. The three workflow writers (a human-input
 *   step's answer_to_key, an extension step's and an ai step's result_to_key) stored the value with a
 *   raw storage write, and the workspace read chooses among the per-owner copies of a key by version
 *   and time. A non-member saved a one-step workflow whose answer_to_key named a published record,
 *   answered it, and the creator's workspace read showed the non-member's value in place of the
 *   record (secaudit 2026-10, r66).
 *
 *   WHAT IS PROVEN. The refusal, against the memory route's control: the non-member's human answer
 *   and extension result do not reach the workspace, the run keeps the answer and turns the step red,
 *   and the creator's read is unchanged. And the uses that must not change: the workspace creator's
 *   own workflow, and a member holding the contributor role, deliver into the workspace through the
 *   same step, and the creator's read shows it; a workflow writing the owner's own keys is unchanged.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-workflow-organism-writes
 * @version-history
 *   2026-10-22 — Initial (secaudit 2026-10, r66).
 */
import { registerOwner } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const STAMP = Date.now().toString(36).slice(-6);

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const short = (v: unknown): string => String(JSON.stringify(v) ?? v).slice(0, 400);
const bearer = (t: string): Record<string, string> => ({ Authorization: `Bearer ${t}` });
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    for (let attempt = 0; attempt < 6; attempt++) {
        const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
        const ct = res.headers.get('content-type') ?? '';
        const body = res.status === 204 ? null : ct.includes('json') ? await res.json() : { _raw: await res.text() };
        if (res.status === 429) { await sleep(2000); continue; }
        return { status: res.status, body };
    }
    throw new Error(`rate limited: ${path}`);
}

let A = { name: '', token: '' };
let B = { name: '', token: '' };
let C = { name: '', token: '' };
let orgId = '';
let ws = '';
const keyOf = (id: string, space = 'notes') => `organism.${orgId}.w.${ws}.${space}.${id}.latest`;

/** The creator's view of the records with this id in the workspace (more than one is a forged copy). */
async function readNote(id: string): Promise<any[]> {
    const r = await json(`/v1/organisms/${orgId}/workspace/records?ws=${ws}`, { headers: bearer(A.token) });
    assert(r.status === 200, `records ${r.status}: ${short(r.body)}`);
    return (r.body.data?.records ?? []).filter((x: any) => x.id === id);
}
async function settle(token: string, wfId: string, runId: string): Promise<any> {
    for (let i = 0; i < 60; i++) {
        const { body } = await json(`/v1/workflows/${wfId}/runs/${runId}`, { headers: bearer(token) });
        const run = body.data?.run ?? body.data;
        if (run && !['running', 'waiting-step'].includes(run.status)) return run;
        await sleep(250);
    }
    const { body } = await json(`/v1/workflows/${wfId}/runs/${runId}`, { headers: bearer(token) });
    return body.data?.run ?? body.data;
}
const humanDef = (key: string) => ({
    title: { en_US: 'answer into a workspace' }, description: { en_US: 'r66' },
    trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect',
    steps: [{ id: 'gate', description: { en_US: 'answer' }, required_to_function: 'none',
        action: { kind: 'human-input', question: { header: 'Q', prompt: 'Pick', options: [{ id: 'yes', label: 'Yes' }] }, answer_to_key: key } }],
});
/** Save, run and answer a one-step human-input workflow as `who`; the run after the answer. */
async function answerInto(who: { token: string }, wfId: string, key: string, other: string): Promise<{ answer: number; run: any }> {
    const save = await json(`/v1/workflows/${wfId}`, { method: 'PUT', headers: bearer(who.token), body: JSON.stringify(humanDef(key)) });
    assert(save.status === 200, `save ${save.status}: ${short(save.body?.data?.errors ?? save.body?.error)}`);
    const run = await json(`/v1/workflows/${wfId}/run`, { method: 'POST', headers: bearer(who.token), body: JSON.stringify({ mode: 'full', target: 'live' }) });
    assert(run.status === 200, `run ${run.status}: ${short(run.body)}`);
    const runId = run.body.data.run?.runId ?? run.body.data.runId;
    await sleep(500);
    const ans = await json(`/v1/workflows/${wfId}/runs/${runId}/steps/gate/answer`, { method: 'POST', headers: bearer(who.token), body: JSON.stringify({ picks: ['yes'], other }) });
    await sleep(300);
    return { answer: ans.status, run: await settle(who.token, wfId, runId) };
}

console.log('\n=== A workflow\'s answer into a workspace meets the organism rule ===\n');

await test('setup: a creator, a contributor member and an outsider; a private organism with a published record', async () => {
    const a = await registerOwner(BASE, `wfoa${STAMP}`);
    const b = await registerOwner(BASE, `wfob${STAMP}`);
    const c = await registerOwner(BASE, `wfoc${STAMP}`);
    A = { name: a.name, token: a.token }; B = { name: b.name, token: b.token }; C = { name: c.name, token: c.token };
    const org = await json('/v1/organisms', { method: 'POST', headers: bearer(A.token), body: JSON.stringify({ name: `wfo-${STAMP}`, description: 'r66', type: 'team', visibility: 'private' }) });
    assert(org.status === 201, `organism ${org.status}: ${short(org.body)}`);
    orgId = org.body.data.organism.id;
    const w = await json(`/v1/organisms/${orgId}/workspaces`, {
        method: 'POST', headers: bearer(A.token), body: JSON.stringify({
            name: 'wfo-ws',
            manifest: { objectTypes: [
                { name: 'notes', schemaRef: 'schema:notes@1', namespace: 'notes', backing: 'memory', writeRole: 'member', mode: 'records' },
                // A space whose schema takes a human-input answer, so a member's workflow may deliver one.
                { name: 'answers', schemaRef: 'schema:answers@1', namespace: 'answers', backing: 'memory', writeRole: 'member', mode: 'records' },
            ] },
            schemas: {
                notes: { type: 'object', properties: { text: { type: 'string' } } },
                answers: { type: 'object', properties: {
                    picks: { type: 'array', items: { type: 'string' } }, pick: { type: 'string' }, other: { type: 'string' },
                    by: { type: 'string' }, byIsHuman: { type: 'boolean' }, answeredAt: { type: 'string' },
                } },
            },
        }),
    });
    assert(w.status === 201, `workspace ${w.status}: ${short(w.body)}`);
    ws = w.body.data.ws;
    const pub = await json(`/v1/organisms/${orgId}/workspace/records/publish`, { method: 'POST', headers: bearer(A.token), body: JSON.stringify({ ws, namespace: 'notes', records: [{ id: 'r1', value: { text: 'written by A' } }] }) });
    assert(pub.status === 200, `publish ${pub.status}: ${short(pub.body)}`);
    const add = await json(`/v1/organisms/${orgId}/members`, { method: 'POST', headers: bearer(A.token), body: JSON.stringify({ ghii: B.name }) });
    assert(add.status === 201, `add member ${add.status}: ${short(add.body)}`);
    const grant = await json(`/v1/organisms/${orgId}/workspace-access/grant`, { method: 'POST', headers: bearer(A.token), body: JSON.stringify({ ws, grantee: B.name, role: 'contributor' }) });
    assert(grant.status === 200, `grant ${grant.status}: ${short(grant.body)}`);
    const before = await readNote('r1');
    assert(before.length === 1 && before[0].value?.text === 'written by A', `the record before: ${short(before)}`);
});

await test('control: the memory route refuses the outsider for the record\'s key', async () => {
    const r = await json('/v1/memory', { method: 'POST', headers: bearer(C.token), body: JSON.stringify({ key: keyOf('r1'), value: { text: 'C' }, visibility: 'private' }) });
    assert(r.status === 403, `the memory route let the outsider write: ${r.status} ${short(r.body)}`);
});

await test('the outsider\'s human answer does not reach the workspace; the run keeps it and the step is red', async () => {
    // The answers space takes the answer's shape, so only the organism rule can refuse it there.
    const { answer, run } = await answerInto(C, `wfo-c-${STAMP}`, keyOf('r1'), 'INJECTED BY C');
    const intoAnswers = await answerInto(C, `wfo-c2-${STAMP}`, keyOf('r9', 'answers'), 'INJECTED BY C');
    assert(intoAnswers.run.steps.gate.state === 'output-red', `the answers space took the outsider's answer: ${short(intoAnswers.run.steps.gate)}`);
    assert((await readNote('r9')).length === 0, `the creator reads the outsider's answer: ${short(await readNote('r9'))}`);
    assert(answer === 200, `the answer itself was refused: ${answer}`);
    assert(run.steps.gate.state === 'output-red', `the step is ${run.steps.gate.state}, not red: ${short(run.steps.gate)}`);
    assert(run.steps.gate.human?.answer?.other === 'INJECTED BY C', `the answer was not kept in the run: ${short(run.steps.gate.human)}`);
    const after = await readNote('r1');
    assert(after.length === 1 && after[0].value?.text === 'written by A', `the creator now reads: ${short(after)}`);
    const own = await json(`/v1/memory/${encodeURIComponent(keyOf('r1'))}`, { headers: bearer(C.token) });
    assert(own.status !== 200, `the outsider holds a copy of the key: ${own.status} ${short(own.body?.data?.value)}`);
});

/** `who` installs an extension whose one action returns `{ text }`, and runs a workflow writing it to `key`. */
async function extensionInto(who: { token: string }, tag: string, key: string, text: string): Promise<any> {
    const ext = `wfoext${tag}${STAMP}`;
    const manifest = JSON.stringify({
        metadata: { name: ext, version: '1.0.0', description: 'r66', author: 'e2e' },
        actions: [{ id: 'note', method: 'POST', path: '/note', script: 'note' }],
        limits: { timeout_ms: 8000, max_api_calls: 2 },
    });
    const scripts = { note: `export default async function(){ return { text: ${JSON.stringify(text)} }; }` };
    const inst = await json('/v1/extensions', { method: 'POST', headers: bearer(who.token), body: JSON.stringify({ manifest, scripts }) });
    assert(inst.status === 201, `install ${inst.status}: ${short(inst.body?.error)}`);
    const act = await json(`/v1/extensions/${ext}/activate`, { method: 'POST', headers: bearer(who.token) });
    assert(act.status === 200, `activate ${act.status}`);
    const wf = `wfo-x${tag}-${STAMP}`;
    const def = {
        title: { en_US: 'result into a workspace' }, description: { en_US: 'r66' }, trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect',
        steps: [{ id: 'produce', description: { en_US: 'p' }, required_to_function: 'none', action: { kind: 'extension', extension: ext, action: 'note', result_to_key: key } }],
    };
    const save = await json(`/v1/workflows/${wf}`, { method: 'PUT', headers: bearer(who.token), body: JSON.stringify(def) });
    assert(save.status === 200, `save ${save.status}: ${short(save.body?.data?.errors ?? save.body?.error)}`);
    const r = await json(`/v1/workflows/${wf}/run`, { method: 'POST', headers: bearer(who.token), body: JSON.stringify({ mode: 'full', target: 'live' }) });
    assert(r.status === 200, `run ${r.status}`);
    return settle(who.token, wf, r.body.data.run?.runId ?? r.body.data.runId);
}

await test('the outsider\'s extension result does not reach the workspace', async () => {
    const run = await extensionInto(C, 'c', keyOf('r1'), 'INJECTED BY C THROUGH AN EXTENSION');
    assert(run.steps.produce.state !== 'green', `the step is green: ${short(run.steps.produce)}`);
    const after = await readNote('r1');
    assert(after.length === 1 && after[0].value?.text === 'written by A', `the creator now reads: ${short(after)}`);
});

await test('kept: a contributor member\'s extension result lands in the workspace', async () => {
    const run = await extensionInto(B, 'b', keyOf('r5'), 'from the contributor\'s extension');
    assert(run.steps.produce.state === 'green', `the step is ${run.steps.produce.state}: ${short(run.steps.produce)}`);
    const r5 = await readNote('r5');
    assert(r5.length === 1 && r5[0].value?.text === 'from the contributor\'s extension', `the creator does not read it: ${short(r5)}`);
});

await test('kept: the workspace creator\'s own workflow delivers into the workspace', async () => {
    const { answer, run } = await answerInto(A, `wfo-a-${STAMP}`, keyOf('r2', 'answers'), 'from the creator');
    assert(answer === 200 && run.steps.gate.state === 'green', `creator: ${answer} ${short(run.steps.gate)}`);
    const r2 = await readNote('r2');
    assert(r2.length === 1 && r2[0].value?.other === 'from the creator', `the creator does not read their answer: ${short(r2)}`);
});

await test('kept: a member with the contributor role delivers into the workspace through the same step', async () => {
    const { answer, run } = await answerInto(B, `wfo-b-${STAMP}`, keyOf('r3', 'answers'), 'from the contributor');
    assert(answer === 200 && run.steps.gate.state === 'green', `contributor: ${answer} ${short(run.steps.gate)}`);
    const r3 = await readNote('r3');
    assert(r3.length === 1 && r3[0].value?.other === 'from the contributor', `the creator does not read the contributor's answer: ${short(r3)}`);
});

await test('kept: the outsider\'s workflow writing its own key is unchanged', async () => {
    const { answer, run } = await answerInto(C, `wfo-own-${STAMP}`, `wfo.${STAMP}.decision`, 'mine');
    assert(answer === 200 && run.steps.gate.state === 'green', `own key: ${answer} ${short(run.steps.gate)}`);
    const own = await json(`/v1/memory/${encodeURIComponent(`wfo.${STAMP}.decision`)}`, { headers: bearer(C.token) });
    assert(own.status === 200 && own.body.data?.value?.other === 'mine', `own key: ${own.status} ${short(own.body?.data)}`);
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
