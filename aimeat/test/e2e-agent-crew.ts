// E2E Tests for the Crew tab's routes — /v1/agents/:name/crew (read, draft, validate, try,
// publish, restore). The agent's "runtime" is the tunnel test harness answering `invoke` frames,
// which is exactly what a crewaimeat JSON runtime does behind the serve daemon.
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-crew
//
// Covers: offline refusals (409, nothing written), a validator verdict returned verbatim, publish
// refused on a dirty verdict (422, nothing written), publish writing the live key + a .version.N
// copy + waking the runtime, restore going through the validator again, draft save/discard,
// the trial's start+poll shape, cross-owner → 403, and the window prune.
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { TunnelClient } from './helpers/tunnel-harness.js';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() : { _raw: await res.text() };
  return { status: res.status, body };
}
async function signMsg(privB64: string, message: string): Promise<string> {
  const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
  return Buffer.from(sig).toString('base64');
}
async function getToken(idOrOwner: string, priv: string, isAgent: boolean): Promise<string> {
  const ts = new Date().toISOString();
  const message = isAgent ? idOrOwner + ts : idOrOwner + NODE_ID + ts;
  const signature = await signMsg(priv, message);
  const payload = isAgent ? { gaii: idOrOwner, timestamp: ts, signature } : { owner: idOrOwner, timestamp: ts, signature };
  const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify(payload) });
  assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
  return body.data.token;
}

// ─── State ───
const stamp = Date.now();
const ownerName = `crewowner${stamp}`;
const otherName = `crewother${stamp}`;
const agentName = 'crewbot';
let ownerToken = '';
let otherToken = '';
let agentToken = '';
let agentGaii = '';
const auth = (tok: string) => ({ Authorization: `Bearer ${tok}` });
const crew = (path = '') => `/v1/agents/${agentName}/crew${path}`;

const goodDoc = {
  agent_name: agentName,
  agents: [{ name: 'r', role: 'Researcher', goal: 'Find', backstory: 'Reads', tools: ['web'], allow_delegation: false }],
  tasks: [{ id: 'research', description: 'Do this: {{ctx.prompt}}', expected_output: 'A brief', agent: 'r', context: [], async: false }],
};
const badDoc = { ...goodDoc, agents: [{ ...goodDoc.agents[0], tools: ['taikasauva'] }], temperature: 7 };
const BAD_ERRORS = [
  'temperature: must be a number in [0, 2]',
  "agents[0] (r): unknown tool 'taikasauva' (known: app_build, article_fetch, web)",
];

/** A runtime that answers like crewaimeat: validate by looking at the doc, try by echoing. */
function runtimeReply(f: any): { ok: boolean; result: unknown } {
  const doc = f.input?.doc ?? {};
  if (f.capability === 'crew.validate') {
    const unknown = (doc.agents ?? []).flatMap((a: any) => (a.tools ?? []).filter((t: string) => t === 'taikasauva'));
    const errors: string[] = [];
    if (typeof doc.temperature === 'number' && doc.temperature > 2) errors.push(BAD_ERRORS[0]);
    if (unknown.length) errors.push(BAD_ERRORS[1]);
    return { ok: true, result: { errors } };
  }
  if (f.capability === 'crew.try') {
    return { ok: true, result: { output: `ran once with: ${f.input?.prompt}`, duration_ms: 12 } };
  }
  return { ok: false, result: { code: 'UNSUPPORTED', message: `no ${f.capability}` } };
}

console.log('\n=== AIMEAT Crew tab routes — E2E ===\n');

console.log('Setup');
await test('Register owner, agent and a second owner', async () => {
  let r = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }) });
  assert(r.status === 201, `owner ${r.status}: ${JSON.stringify(r.body)}`);
  ownerToken = await getToken(ownerName, r.body.data.private_key, false);
  r = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: otherName, public_key: 'placeholder' }) });
  assert(r.status === 201, `other ${r.status}`);
  otherToken = await getToken(otherName, r.body.data.private_key, false);
  r = await json('/v1/agents', { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ name: agentName, owner: ownerName, capabilities: ['memory'], scopes: ['*'] }) });
  assert(r.status === 201, `agent ${r.status}: ${JSON.stringify(r.body)}`);
  agentGaii = r.body.data.agent.gaii;
  agentToken = await getToken(agentGaii, r.body.data.private_key, true);
});

console.log('\nPhase 1 — nothing yet, agent offline');
await test('1. Empty state reads as empty and offline', async () => {
  const { status, body } = await json(crew(), { headers: auth(ownerToken) });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data.online === false, 'offline');
  assert(body.data.published === null, 'no live def');
  assert(body.data.draft === null, 'no draft');
  assert(Array.isArray(body.data.versions) && body.data.versions.length === 0, 'no versions');
  assert(body.data.key === `crews.registry.${agentName}`, `key ${body.data.key}`);
});
await test('2. Validate while offline → 409 AGENT_OFFLINE, no guess', async () => {
  const { status, body } = await json(crew('/validate'), { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ doc: goodDoc }) });
  assert(status === 409, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'AGENT_OFFLINE', `code ${body.error?.code}`);
});
await test('3. Publish while offline → 409 and the live key stays empty', async () => {
  const { status, body } = await json(crew('/publish'), { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ doc: goodDoc }) });
  assert(status === 409, `status ${status}: ${JSON.stringify(body)}`);
  const mem = await json(`/v1/memory/${encodeURIComponent(agentGaii)}/crews.registry.${agentName}`, { headers: auth(ownerToken) });
  assert(mem.status === 404, `live key must not exist, got ${mem.status}`);
});
await test('4. Try while offline → 409', async () => {
  const { status } = await json(crew('/try'), { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ doc: goodDoc, prompt: 'hello' }) });
  assert(status === 409, `status ${status}`);
});
await test('5. Draft save + read + discard work without the agent', async () => {
  let r = await json(crew('/draft'), { method: 'PUT', headers: auth(ownerToken), body: JSON.stringify({ doc: badDoc }) });
  assert(r.status === 200 && r.body.data.saved === true, `save ${r.status}: ${JSON.stringify(r.body)}`);
  r = await json(crew(), { headers: auth(ownerToken) });
  assert(r.body.data.draft?.doc?.temperature === 7, 'draft round-trips');
  r = await json(crew('/draft'), { method: 'DELETE', headers: auth(ownerToken) });
  assert(r.status === 200 && r.body.data.discarded === true, `discard ${r.status}`);
  r = await json(crew(), { headers: auth(ownerToken) });
  assert(r.body.data.draft === null, 'draft gone');
});

console.log('\nPhase 2 — agent connected, answering invokes');
let tunnel: TunnelClient | null = null;
await test('6. Agent on the tunnel reads as online', async () => {
  tunnel = await TunnelClient.connect(BASE, agentToken);
  await tunnel.waitForBacklog(1000);
  tunnel.onInvoke(runtimeReply);
  const { body } = await json(crew(), { headers: auth(ownerToken) });
  assert(body.data.online === true, 'online');
});
await test('7. Validate returns the runtime\'s messages verbatim', async () => {
  const { status, body } = await json(crew('/validate'), { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ doc: badDoc }) });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data.valid === false, 'invalid');
  assert(JSON.stringify(body.data.errors) === JSON.stringify(BAD_ERRORS), `errors verbatim: ${JSON.stringify(body.data.errors)}`);
  const inv = await tunnel!.waitForInvoke(500);
  assert(inv?.capability === 'crew.validate', 'the invoke frame carried crew.validate');
  assert(typeof inv?.timeout_ms === 'number' && inv.timeout_ms > 0, 'timeout_ms travels with the invoke');
  assert(inv?.caller === `${ownerName}@${NODE_ID}`, `caller is the owner GHII: ${inv?.caller}`);
});
await test('8. Validate a good doc → valid, no errors, nothing written', async () => {
  const { status, body } = await json(crew('/validate'), { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ doc: goodDoc }) });
  assert(status === 200 && body.data.valid === true && body.data.errors.length === 0, `verdict ${JSON.stringify(body.data)}`);
  const mem = await json(`/v1/memory/${encodeURIComponent(agentGaii)}/crews.registry.${agentName}`, { headers: auth(ownerToken) });
  assert(mem.status === 404, 'validate stores nothing');
});
await test('9. Publish a bad doc → 422 CREW_INVALID with the messages, nothing written', async () => {
  const { status, body } = await json(crew('/publish'), { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ doc: badDoc }) });
  assert(status === 422, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.error?.code === 'CREW_INVALID', `code ${body.error?.code}`);
  assert(JSON.stringify(body.error?.details?.errors) === JSON.stringify(BAD_ERRORS), 'details carry the verbatim errors');
  const mem = await json(`/v1/memory/${encodeURIComponent(agentGaii)}/crews.registry.${agentName}`, { headers: auth(ownerToken) });
  assert(mem.status === 404, 'nothing published');
});
await test('10. Publish a good doc → revision 1 live, .version.1 kept, runtime woken', async () => {
  await tunnel!.waitForDeliver(50); // drain anything pending
  const { status, body } = await json(crew('/publish'), { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ doc: goodDoc }) });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data.revision === 1, `revision ${body.data.revision}`);
  const state = await json(crew(), { headers: auth(ownerToken) });
  assert(state.body.data.published?.revision === 1, 'live revision 1');
  assert(state.body.data.published?.doc?.agent_name === agentName, 'doc in envelope');
  assert(state.body.data.published?.publishedBy === `${ownerName}@${NODE_ID}`, `publishedBy ${state.body.data.published?.publishedBy}`);
  assert(state.body.data.versions.length === 1 && state.body.data.versions[0].revision === 1, 'one kept version');
  const live = await json(`/v1/memory/${encodeURIComponent(agentGaii)}/crews.registry.${agentName}`, { headers: auth(ownerToken) });
  assert(live.status === 200 && live.body.data?.value?.doc?.agent_name === agentName, `live key readable: ${live.status}`);
  const d = await tunnel!.waitForDeliver(1500);
  assert(d?.kind === 'crew.def_updated', `runtime woken with crew.def_updated, got ${d?.kind}`);
  assert((d?.payload as any)?.revision === 1, 'wake carries the revision');
});
await test('11. The agent itself reads its live key under its own token (crew_registry.py path)', async () => {
  const r = await tunnel!.request('GET', `/v1/memory/crews.registry.${agentName}`);
  assert(r.status === 200, `agent read ${r.status}: ${JSON.stringify(r.body)}`);
  assert((r.body as any).data?.value?.doc?.agent_name === agentName, 'same doc');
});
await test('12. A second publish removes the draft and becomes revision 2', async () => {
  const doc2 = { ...goodDoc, tags: ['v2'] };
  let r = await json(crew('/draft'), { method: 'PUT', headers: auth(ownerToken), body: JSON.stringify({ doc: doc2 }) });
  assert(r.status === 200, 'draft saved');
  r = await json(crew('/publish'), { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ doc: doc2 }) });
  assert(r.status === 200 && r.body.data.revision === 2, `revision ${r.body.data?.revision}`);
  const state = await json(crew(), { headers: auth(ownerToken) });
  assert(state.body.data.draft === null, 'draft consumed');
  assert(state.body.data.versions.map((v: any) => v.revision).join(',') === '2,1', `versions newest first: ${JSON.stringify(state.body.data.versions)}`);
  assert(state.body.data.published.doc.tags?.[0] === 'v2', 'live is v2');
});
await test('13. Restore revision 1 → goes through the validator, becomes revision 3', async () => {
  const { status, body } = await json(crew('/restore'), { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ revision: 1 }) });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.data.revision === 3, `revision ${body.data.revision}`);
  const inv = await tunnel!.waitForInvoke(500);
  assert(inv?.capability === 'crew.validate', 'restore asked the validator');
  const state = await json(crew(), { headers: auth(ownerToken) });
  assert(state.body.data.published.revision === 3 && !state.body.data.published.doc.tags?.length, 'live is revision 1\'s doc again');
});
await test('14. Restore an unknown revision → 404 REVISION_NOT_FOUND', async () => {
  const { status, body } = await json(crew('/restore'), { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ revision: 99 }) });
  assert(status === 404 && body.error?.code === 'REVISION_NOT_FOUND', `status ${status} ${body.error?.code}`);
});
async function crewKeyNames(): Promise<string[]> {
  const keys = await json(`/v1/memory?agent=${encodeURIComponent(agentGaii)}&prefix=crews.&per_page=100`, { headers: auth(ownerToken) });
  return ((keys.body.data?.items ?? keys.body.data?.memories ?? []) as any[]).map(m => m.key).sort();
}
await test('15. Try → 202 with an id, then done with the runtime\'s output; nothing stored', async () => {
  const before = await crewKeyNames();
  const start = await json(crew('/try'), { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ doc: goodDoc, prompt: 'kissoista' }) });
  assert(start.status === 202, `status ${start.status}: ${JSON.stringify(start.body)}`);
  const id = start.body.data.try_id;
  let done: any = null;
  for (let i = 0; i < 20 && !done; i++) {
    await sleep(100);
    const poll = await json(crew(`/try/${id}`), { headers: auth(ownerToken) });
    if (poll.body.data?.status !== 'running') done = poll.body.data;
  }
  assert(done?.status === 'done', `trial ended: ${JSON.stringify(done)}`);
  assert(done.result?.output === 'ran once with: kissoista', `output ${JSON.stringify(done.result)}`);
  const after = await crewKeyNames();
  assert(before.length > 0, `the live key and its versions are listed: ${before.join(', ')}`);
  assert(JSON.stringify(after) === JSON.stringify(before), `a trial writes no key: before ${before.join(', ')} / after ${after.join(', ')}`);
  // Earlier validates left unread invoke frames in the harness buffer; read forward to the try.
  let inv: any = null;
  for (let i = 0; i < 20; i++) {
    inv = await tunnel!.waitForInvoke(300);
    if (!inv || inv.capability === 'crew.try') break;
  }
  assert(inv?.capability === 'crew.try' && inv?.input?.prompt === 'kissoista', `the invoke carried crew.try with the prompt: ${JSON.stringify(inv)}`);
});
await test('16. Unknown trial id → 404', async () => {
  const { status } = await json(crew('/try/nope'), { headers: auth(ownerToken) });
  assert(status === 404, `status ${status}`);
});
await test('17. Runtime that does not answer this call → 409 CREW_RUNTIME_MISSING', async () => {
  tunnel!.onInvoke(() => ({ ok: false, result: { code: 'NO_HANDLER', message: 'nobody polling' } }));
  const { status, body } = await json(crew('/validate'), { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ doc: goodDoc }) });
  assert(status === 409 && body.error?.code === 'CREW_RUNTIME_MISSING', `status ${status} ${body.error?.code}`);
  tunnel!.onInvoke(runtimeReply);
});

await test('14b. A definition published from the crewaimeat CLI (old envelope, no revision) reads as unnumbered and the next tab publish numbers on', async () => {
  // crew_registry.publish_crew_def writes { version, publishedAt, agent_name, doc } under the agent's
  // own token, with capabilities.technical as {name, type} objects. The tab must show it, not "0".
  const cliDoc = { ...goodDoc, capabilities: { technical: [{ name: 'web-search', type: 'tool' }], domain: ['news'], languages: ['fi'] } };
  const w = await tunnel!.request('POST', '/v1/memory', { body: { key: `crews.registry.${agentName}`, value: { version: 1, publishedAt: new Date().toISOString(), agent_name: agentName, doc: cliDoc }, visibility: 'owner' } });
  assert(w.status === 201 || w.status === 200, `cli-style write ${w.status}: ${JSON.stringify(w.body)}`);
  const state = await json(crew(), { headers: auth(ownerToken) });
  assert(state.body.data.published !== null, 'the CLI-published definition is the live one');
  assert(state.body.data.published.revision === 0, `no revision number on a CLI publish: ${state.body.data.published.revision}`);
  assert(state.body.data.published.doc.capabilities.technical[0].type === 'tool', 'objects survive the read untouched');
  const r = await json(crew('/publish'), { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ doc: cliDoc }) });
  assert(r.status === 200 && r.body.data.revision === 4, `next tab publish numbers on from the kept history (expected 4): ${r.status} ${r.body.data?.revision}`);
});

console.log('\nPhase 3 — isolation');
await test('18. Another owner cannot read, validate or publish this agent\'s crew → 403/404', async () => {
  const r1 = await json(crew(), { headers: auth(otherToken) });
  assert(r1.status === 403 || r1.status === 404, `read ${r1.status}`);
  const r2 = await json(crew('/publish'), { method: 'POST', headers: auth(otherToken), body: JSON.stringify({ doc: goodDoc }) });
  assert(r2.status === 403 || r2.status === 404, `publish ${r2.status}`);
  const state = await json(crew(), { headers: auth(ownerToken) });
  assert(state.body.data.published.revision === 4, 'unchanged');
});
await test('19. The agent\'s own token cannot publish through this door (owner principal only)', async () => {
  const r = await tunnel!.request('POST', crew('/publish'), { body: { doc: goodDoc } });
  assert(r.status === 403, `agent publish ${r.status}: ${JSON.stringify(r.body)}`);
});
await test('20. Unauthenticated → 401', async () => {
  const { status } = await json(crew());
  assert(status === 401, `status ${status}`);
});

console.log('\nPhase 4 — the window');
await test('21. Twelve publishes keep the last ten revisions', async () => {
  for (let i = 5; i <= 12; i++) {
    const r = await json(crew('/publish'), { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ doc: { ...goodDoc, tags: [`r${i}`] } }) });
    assert(r.status === 200 && r.body.data.revision === i, `publish ${i}: ${r.status} ${r.body.data?.revision}`);
  }
  const state = await json(crew(), { headers: auth(ownerToken) });
  const revs = state.body.data.versions.map((v: any) => v.revision);
  assert(revs.length === 10, `kept ${revs.length}: ${revs.join(',')}`);
  assert(revs[0] === 12 && revs[9] === 3, `window 3..12, got ${revs.join(',')}`);
  const pruned = await json(`/v1/memory/${encodeURIComponent(agentGaii)}/crews.registry.${agentName}.version.1`, { headers: auth(ownerToken) });
  assert(pruned.status === 404, 'revision 1 pruned');
});

await test('Teardown — close tunnel', async () => { await tunnel?.close(); });

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
