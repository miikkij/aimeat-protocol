/**
 * @file test/e2e-ext-person-decision.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An extension action the manifest marks `decision: person` is the person's own
 *   decision (services/extension/person-decision.ts).
 *
 *   WHAT IT PROVES. An agent holding ext:invoke could make a person's decision (a moderation act, a
 *   sale accept) through such an action, directly or through an app tool bound to it (incident
 *   mwqdmtk8). Now: the person signed in, and an app the person uses, run it as before; an agent's
 *   call, on REST and over MCP, runs nothing and files one approval request; only the person in person
 *   allows it, and the node then runs it as the person with the agent's input; a changed action runs
 *   nothing; an app tool manifest that binds it is refused on REST and over MCP; an app tool written
 *   before the mark still cannot make the decision; a schedule is refused; an action without the mark
 *   is unchanged; a manifest with another value of `decision` is refused.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=ext-person-decision
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (incident mwqdmtk8).
 */
import { createHash, randomBytes } from 'node:crypto';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) } });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { _raw: text }; }
  return { status: res.status, body };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const stamp = Date.now().toString(36) + randomBytes(2).toString('hex');
const EXT = `persondec${stamp}`;
// Every action records who ran it and with what, in a private log the `log` action reads back.
const record = (kind: string) => `export default async function(ctx, input){
  const log = (await ctx.memory.get('log')) || [];
  log.push({ kind: '${kind}', by: ctx.caller.gaii, roles: ctx.caller.roles, input: input });
  await ctx.memory.set('log', log, { visibility: 'private' });
  return { done: '${kind}', by: ctx.caller.gaii };
}`;
const SCRIPTS: Record<string, string> = {
  moderate: record('moderate'),
  later: record('later'),
  draft: record('draft'),
  log: `export default async function(ctx){ return { log: (await ctx.memory.get('log')) || [] }; }`,
};
type ActionSpec = { id: string; script: string; decision?: unknown };
const manifest = (actions: ActionSpec[], version = '1.0.0') => JSON.stringify({
  metadata: { name: EXT, version, description: 'person decision e2e', author: 'e2e' },
  actions: actions.map(a => ({ id: a.id, method: 'POST', path: `/${a.id}`, script: a.script, ...(a.decision !== undefined ? { decision: a.decision } : {}) })),
  limits: { timeout_ms: 5000, max_api_calls: 20 },
}, null, 2);
const ACTIONS: ActionSpec[] = [
  { id: 'moderate', script: 'moderate', decision: 'person' },
  { id: 'later', script: 'later' },
  { id: 'draft', script: 'draft' },
  { id: 'log', script: 'log' },
];

console.log('\n=== Extension actions that are the person\'s own decision (incident mwqdmtk8) ===\n');

const owner = await registerOwner(BASE, `pdown${stamp}`);
const agent = await makeAgent(BASE, owner, ['ext:invoke', 'exchange:invoke', 'memory:read', 'memory:write', 'commerce:sell']);
const ghii = (await json('/v1/ghii/me', { headers: auth(owner.token) })).body?.data?.gaii as string | undefined;

async function log(): Promise<Array<{ kind: string; by: string; roles: string[]; input: any }>> {
  const r = await json(`/v1/ext/${EXT}/log`, { method: 'POST', headers: auth(owner.token), body: '{}' });
  assert(r.status === 200, `log ${r.status}: ${JSON.stringify(r.body?.error)}`);
  return r.body.data.log;
}
const asAgent = (action: string, input: Record<string, unknown>) =>
  json(`/v1/ext/${EXT}/${action}`, { method: 'POST', headers: auth(agent.token), body: JSON.stringify(input) });
const decide = (token: string, id: string, decision: 'approve' | 'decline') =>
  json(`/v1/publish-requests/${encodeURIComponent(id)}/decision`, { method: 'POST', headers: auth(token), body: JSON.stringify({ decision }) });

await test('Setup: the owner installs and activates an extension whose `moderate` action is the person\'s decision', async () => {
  const inst = await json('/v1/extensions', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ manifest: manifest(ACTIONS), scripts: SCRIPTS }) });
  assert(inst.status === 201, `install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
  const act = await json(`/v1/extensions/${EXT}/activate`, { method: 'POST', headers: auth(owner.token) });
  assert(act.status === 200, `activate ${act.status}: ${JSON.stringify(act.body?.error)}`);
});

await test('1. A manifest whose `decision` is anything but "person" is refused at install', async () => {
  const bad = manifest([{ id: 'moderate', script: 'moderate', decision: 'robot' }]).replace(EXT, `${EXT}x`);
  const r = await json('/v1/extensions', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ manifest: bad, scripts: SCRIPTS }) });
  assert(r.status === 400 && r.body.error?.code === 'INVALID_MANIFEST' && /decision must be "person"/.test(r.body.error.message),
    `expected 400 INVALID_MANIFEST, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
});

await test('2. The owner in person runs the marked action as before', async () => {
  const r = await json(`/v1/ext/${EXT}/moderate`, { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ post: 'p0', verdict: 'approve' }) });
  assert(r.status === 200 && r.body.data?.done === 'moderate', `expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
  const l = await log();
  assert(l.length === 1 && l[0].input.post === 'p0' && l[0].roles.includes('owner'), `the owner's run is recorded: ${JSON.stringify(l)}`);
});

await test('3. An action without the mark runs for the agent as before', async () => {
  const r = await asAgent('draft', { post: 'p1', note: 'looks fine' });
  assert(r.status === 200 && r.body.data?.done === 'draft' && r.body.data?.by === agent.gaii, `expected 200 as the agent, got ${r.status}: ${JSON.stringify(r.body)}`);
});

let requestId = '';
await test('4. The agent\'s call of the marked action runs nothing and answers 202 with one approval request', async () => {
  const before = (await log()).length;
  const r = await asAgent('moderate', { post: 'p1', verdict: 'reject' });
  const d = r.body.data ?? {};
  assert(r.status === 202 && d.status === 'awaiting_owner' && d.kind === 'extension-decision' && d.decision === 'person',
    `expected 202 awaiting_owner, got ${r.status}: ${JSON.stringify(r.body)}`);
  assert(typeof d.approve_url === 'string' && d.approve_url.length > 0 && typeof d.decide_yourself_at === 'string', `addresses: ${JSON.stringify(d)}`);
  assert(/Do not call the action again/.test(d.next_step), `next_step: ${d.next_step}`);
  requestId = d.request_id;
  assert((await log()).length === before, 'the action did not run');
});

await test('5. The same call again finds the same request waiting, and still runs nothing', async () => {
  const before = (await log()).length;
  const r = await asAgent('moderate', { post: 'p1', verdict: 'reject' });
  assert(r.status === 202 && r.body.data.request_id === requestId && r.body.data.already_waiting === true, `got ${r.status}: ${JSON.stringify(r.body.data)}`);
  assert((await log()).length === before, 'the action did not run');
});

await test('6. The agent cannot allow its own request: only the person in person does', async () => {
  const r = await decide(agent.token, requestId, 'approve');
  assert(r.status === 403 && r.body.error?.code === 'OWNER_IN_PERSON', `expected 403 OWNER_IN_PERSON, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
  const req = await json(`/v1/publish-requests/${encodeURIComponent(requestId)}`, { headers: auth(owner.token) });
  assert(req.body.data?.request?.state === 'awaiting_owner', `still waiting: ${JSON.stringify(req.body.data)}`);
});

await test('7. The person allows it with one press: the action runs once, as the person, with the agent\'s input', async () => {
  const before = (await log()).length;
  const r = await decide(owner.token, requestId, 'approve');
  assert(r.status === 200 && r.body.data?.request?.state === 'approved', `expected approved, got ${r.status}: ${JSON.stringify(r.body)}`);
  const l = await log();
  assert(l.length === before + 1, `ran once: ${l.length - before}`);
  const last = l[l.length - 1];
  assert(last.kind === 'moderate' && last.input.post === 'p1' && last.input.verdict === 'reject', `the agent's input: ${JSON.stringify(last)}`);
  assert(last.roles.includes('owner') && !last.by.includes('#') && (!ghii || last.by === ghii), `run as the person: ${JSON.stringify(last)}`);
});

await test('8. Over MCP, aimeat_extension_invoke of the marked action answers the request and runs nothing', async () => {
  const s = await openSession(BASE, agent.token, 'person-decision');
  const before = (await log()).length;
  const r = await callTool(s, 'aimeat_extension_invoke', { extension_name: EXT, action_id: 'moderate', input: { post: 'p2', verdict: 'approve' } });
  assert(!r.isError && r.data.status === 'awaiting_owner' && r.data.kind === 'extension-decision', `expected the request, got ${r.text}`);
  assert((await log()).length === before, 'the action did not run');
  // Declined: nothing runs.
  const d = await decide(owner.token, r.data.request_id, 'decline');
  assert(d.status === 200 && d.body.data?.request?.state === 'declined', `decline ${d.status}: ${JSON.stringify(d.body)}`);
  assert((await log()).length === before, 'a declined decision runs nothing');
});

await test('9. An app tool manifest that binds the marked action is refused, on REST for the owner and over MCP for the agent', async () => {
  const value = { tools: [{ name: 'approve', description: 'approve a post', action_id: `ext:${EXT}:moderate` }] };
  const r = await json('/v1/memory', { method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({ key: `apps.pd-${stamp}.html.tools`, value, visibility: 'public', tags: ['commerce', 'app-tools'] }) });
  assert(r.status === 422 && r.body.error?.code === 'PERSON_DECIDES' && /prepare a draft or read the status/.test(r.body.error.message),
    `expected 422 PERSON_DECIDES, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
  const s = await openSession(BASE, agent.token, 'person-decision-tools');
  const m = await callTool(s, 'aimeat_app_tools_publish', { app_id: `pd-${stamp}`, tools: value.tools });
  assert(m.isError && /PERSON_DECIDES/.test(m.text), `expected PERSON_DECIDES over MCP, got ${m.text}`);
  const read = await json(`/v1/memory/${encodeURIComponent(`apps.pd-${stamp}.html.tools`)}`, { headers: auth(owner.token) });
  assert(read.status === 404, `nothing was written: ${read.status}`);
});

await test('10. A tool bound to an action without the mark is published as before', async () => {
  const value = { tools: [{ name: 'suggest', description: 'draft a verdict', action_id: `ext:${EXT}:draft` }] };
  const r = await json('/v1/memory', { method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({ key: `apps.pdok-${stamp}.html.tools`, value, visibility: 'public', tags: ['commerce', 'app-tools'] }) });
  assert(r.status === 201, `expected the write, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
});

let laterRequest = '';
await test('11. A tool published before the mark still cannot make the decision: its call waits for the person', async () => {
  const filename = `pdlate-${stamp}.html`;
  const pub = await json('/v1/apps', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({
    filename, name: 'Decision probe', description: 'person decision probe', category: 'tool',
    content: Buffer.from('<!DOCTYPE html><html><body>probe</body></html>', 'utf8').toString('base64') }) });
  assert(pub.status === 201, `publish app ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
  const tools = await json('/v1/memory', { method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({ key: `apps.${filename}.tools`, value: { tools: [{ name: 'close', description: 'close a case', action_id: `ext:${EXT}:later` }] }, visibility: 'public', tags: ['commerce', 'app-tools'] }) });
  assert(tools.status === 201, `tool manifest ${tools.status}: ${JSON.stringify(tools.body?.error)}`);
  // The author marks the action afterwards.
  const upd = await json(`/v1/extensions/${EXT}`, { method: 'PUT', headers: auth(owner.token), body: JSON.stringify({
    manifest: manifest(ACTIONS.map(a => a.id === 'later' ? { ...a, decision: 'person' } : a), '1.1.0'), scripts: SCRIPTS }) });
  assert(upd.status === 200, `update ${upd.status}: ${JSON.stringify(upd.body?.error)}`);
  const before = (await log()).length;
  const r = await json(`/v1/apps/${owner.name}/${filename}/webmcp/tools/close`, { method: 'POST', headers: auth(agent.token), body: JSON.stringify({ case: 'c1' }) });
  assert(r.status === 202 && r.body.error?.code === 'PERSON_DECIDES' && r.body.error?.details?.status === 'awaiting_owner',
    `expected 202 PERSON_DECIDES with the request, got ${r.status}: ${JSON.stringify(r.body)}`);
  laterRequest = r.body.error.details.request_id;
  assert((await log()).length === before, 'the action did not run');
});

await test('12. An action changed after the agent asked runs nothing on approval: the request is settled outdated', async () => {
  assert(laterRequest.length > 0, 'test 11 filed a request');
  const changed = { ...SCRIPTS, later: SCRIPTS.later.replace("kind: 'later'", "kind: 'later-v2'") };
  const upd = await json(`/v1/extensions/${EXT}`, { method: 'PUT', headers: auth(owner.token), body: JSON.stringify({
    manifest: manifest(ACTIONS.map(a => a.id === 'later' ? { ...a, decision: 'person' } : a), '1.2.0'), scripts: changed }) });
  assert(upd.status === 200, `update ${upd.status}: ${JSON.stringify(upd.body?.error)}`);
  const before = (await log()).length;
  const r = await decide(owner.token, laterRequest, 'approve');
  assert(r.status === 409 && r.body.error?.code === 'OUTDATED' && /changed after it was asked/.test(r.body.error.message),
    `expected 409 OUTDATED, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
  assert((await log()).length === before, 'the changed action did not run');
});

await test('13. An app the person signed in to runs the marked action as before (the app\'s own control)', async () => {
  const token = await appGrantToken(['ext:invoke']);
  const before = (await log()).length;
  const r = await json(`/v1/ext/${EXT}/moderate`, { method: 'POST', headers: auth(token), body: JSON.stringify({ post: 'p3', verdict: 'approve' }) });
  assert(r.status === 200 && r.body.data?.done === 'moderate', `expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
  assert((await log()).length === before + 1, 'the app\'s call ran');
});

await test('14. A schedule never makes the decision: the run fails with PERSON_DECIDES and the address', async () => {
  const mk = await json('/v1/schedules', { method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({ name: `pd-${stamp}`, kind: 'extension', cron: '0 7 * * *', extension_name: EXT, action_id: 'moderate' }) });
  assert(mk.status === 201, `schedule ${mk.status}: ${JSON.stringify(mk.body?.error)}`);
  const id = mk.body.data.schedule?.id ?? mk.body.data.id;
  const before = (await log()).length;
  const t = await json(`/v1/schedules/${id}/trigger`, { method: 'POST', headers: auth(owner.token), body: '{}' });
  assert(t.status === 200, `trigger ${t.status}: ${JSON.stringify(t.body?.error)}`);
  const sched = t.body.data.schedule;
  assert(sched.lastRunResult === 'error' && /PERSON_DECIDES/.test(sched.lastRunError ?? '') && /http/.test(sched.lastRunError ?? ''),
    `expected a PERSON_DECIDES failure, got ${sched.lastRunResult}: ${sched.lastRunError}`);
  assert((await log()).length === before, 'the scheduled run did not make the decision');
  await json(`/v1/schedules/${id}`, { method: 'DELETE', headers: auth(owner.token) });
});

/** An app grant of the owner for a probe app of theirs, holding `scopes`: the token an app the person uses calls with. */
async function appGrantToken(scopes: string[]): Promise<string> {
  const filename = `pd-probe-${randomBytes(4).toString('hex')}.html`;
  const redirect = 'http://localhost:9933/callback';
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const pub = await json('/v1/apps', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({
    filename, name: 'Decision app', description: 'app-grant probe', category: 'tool',
    content: Buffer.from('<!DOCTYPE html><html><body>probe</body></html>', 'utf8').toString('base64') }) });
  assert(pub.status === 201, `publish probe app ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
  const q = new URLSearchParams({ app: `${owner.name}/${filename}`, response_type: 'code', scope: scopes.join(' '),
    redirect_uri: redirect, state: 'x', code_challenge: challenge, code_challenge_method: 'S256' });
  const authorize = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
  assert(authorize.status === 302, `authorize ${authorize.status}`);
  const reqId = decodeURIComponent(/req=([^&]+)/.exec(authorize.headers.get('location') ?? '')?.[1] ?? '');
  const consent = await json('/v1/app-grants/authorize-consent', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ request_id: reqId }) });
  assert(consent.status === 200, `consent ${consent.status}: ${JSON.stringify(consent.body?.error)}`);
  const code = new URL(consent.body.data.redirect_url as string).searchParams.get('code') ?? '';
  const tok = await json('/v1/app-grants/token', { method: 'POST',
    body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect }) });
  assert(tok.status === 200, `app token ${tok.status}: ${JSON.stringify(tok.body?.error)}`);
  return tok.body.data.access_token as string;
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
