// E2E: a code-backed agent can carry a run mode, and can say what code runs it.
//
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-runtime-source
//
// WHY BOTH ARE HERE. crewaimeat measured, on a real 68-agent fleet, that `run_mode` was null on
// every one and that a Python crew could never carry it. Half of that turned out to be true in a
// way nobody had named: the ROUTE never needed a definition, but there was no door an AGENT could
// reach — `mode` had a tool on all three surfaces and `run_mode` had none, so an owner in a browser
// was the only party who could set it. The other half is that a code-backed run could not say what
// it was: a JSON crew's definition is versioned on this node, and a Python crew's is not here at
// all, so "what was running when this ran" had no answer.
//
// The refusals matter as much as the writes. Both fields are same-owner gated, and both are
// DECLARED rather than enforced — so what must be proven is that the node records them, serves them
// back, and refuses another owner.

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

ed.hashes.sha512 = (m: Uint8Array) =>
  new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, body: ct.includes('json') ? await res.json() : { _raw: await res.text() } };
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

const stamp = Date.now();
const ownerA = `rsa${stamp}`;
const ownerB = `rsb${stamp}`;
let tokA = '';
let tokB = '';
let codeBacked = '';       // an agent with no crew definition — the case that was said to be locked out
let codeBackedTok = '';
let othersAgent = '';

console.log('\n=== AIMEAT: run mode and runtime source on a code-backed agent ===\n');

console.log('Setup');
await test('Two owners and their agents', async () => {
  const a = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: ownerA, public_key: 'placeholder' }) });
  assert(a.status === 201, `owner A: ${JSON.stringify(a.body)}`);
  tokA = await getToken(ownerA, a.body.data.private_key, false);
  const b = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: ownerB, public_key: 'placeholder' }) });
  assert(b.status === 201, `owner B: ${JSON.stringify(b.body)}`);
  tokB = await getToken(ownerB, b.body.data.private_key, false);

  // Deliberately NO crew definition and no run_mode: this is `web-researcher` and its 57 siblings.
  const mk = await json('/v1/agents', {
    method: 'POST', headers: { Authorization: `Bearer ${tokA}` },
    body: JSON.stringify({ name: 'webresearcher', owner: ownerA, capabilities: ['memory'], scopes: ['*'] }),
  });
  assert(mk.status === 201, `agent: ${JSON.stringify(mk.body)}`);
  codeBacked = mk.body.data.agent.gaii;
  codeBackedTok = await getToken(codeBacked, mk.body.data.private_key, true);

  const other = await json('/v1/agents', {
    method: 'POST', headers: { Authorization: `Bearer ${tokB}` },
    body: JSON.stringify({ name: 'stranger', owner: ownerB, capabilities: ['memory'], scopes: ['*'] }),
  });
  othersAgent = other.body.data.agent.gaii;
});

console.log('\nRun mode on an agent with no definition');

await test('1. It starts null — which is not the same as spawn', async () => {
  const { body } = await json('/v1/agents', { headers: { Authorization: `Bearer ${tokA}` } });
  const row = body.data.agents.find((a: any) => a.gaii === codeBacked);
  assert(!!row, 'the agent is listed');
  assert(row.run_mode === null, `run_mode starts null, got ${JSON.stringify(row.run_mode)}`);
});

await test('2. The owner can set it, and the agent then appears on the spawner roster', async () => {
  const set = await json(`/v1/agents/webresearcher/run-mode`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${tokA}` }, body: JSON.stringify({ run_mode: 'spawn' }),
  });
  assert(set.status === 200, `set: ${set.status} ${JSON.stringify(set.body)}`);
  assert(set.body.data.run_mode === 'spawn', `echoed: ${set.body.data.run_mode}`);
  // The roster is the whole point: without this the fleet is outside the spawn path however it is written.
  const roster = await json('/v1/agents?run_mode=spawn', { headers: { Authorization: `Bearer ${tokA}` } });
  assert(roster.body.data.agents.some((a: any) => a.gaii === codeBacked),
    'the agent is on the ?run_mode=spawn roster');
});

await test('3. The AGENT can set its own — the door that did not exist', async () => {
  // This is the half that was actually missing. `mode` had a tool on all three surfaces and this
  // had none, so a fleet runtime could not put its own agents on the roster.
  const set = await json(`/v1/agents/webresearcher/run-mode`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${codeBackedTok}` }, body: JSON.stringify({ run_mode: 'resident' }),
  });
  assert(set.status === 200, `agent self-set: ${set.status} ${JSON.stringify(set.body)}`);
  assert(set.body.data.run_mode === 'resident', `echoed: ${set.body.data.run_mode}`);
});

await test('4. Another owner is refused', async () => {
  const denied = await json(`/v1/agents/${encodeURIComponent(codeBacked)}/run-mode`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${tokB}` }, body: JSON.stringify({ run_mode: 'spawn' }),
  });
  assert(denied.status === 403 || denied.status === 404, `cross-owner set must be refused, got ${denied.status}`);
});

await test('5. A value that is neither is refused', async () => {
  const bad = await json(`/v1/agents/webresearcher/run-mode`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${tokA}` }, body: JSON.stringify({ run_mode: 'sometimes' }),
  });
  assert(bad.status === 400, `expected 400, got ${bad.status}`);
});

console.log('\nWhat was running when this ran');

await test('6. A Python crew can say what backs it, in the shape crewaimeat proposed', async () => {
  const src = {
    kind: 'python',
    file: 'crews/web_researcher_crew.py',
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    commit: '9f2c1ab',
    runtime: 'crewaimeat 0.7.0',
  };
  const set = await json(`/v1/agents/webresearcher/runtime-source`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${codeBackedTok}` }, body: JSON.stringify({ runtime_source: src }),
  });
  assert(set.status === 200, `report: ${set.status} ${JSON.stringify(set.body)}`);
  const got = set.body.data.runtime_source;
  for (const [k, v] of Object.entries(src)) assert(got[k] === v, `${k}: ${got[k]}`);
  // The one field that is the NODE's, and the reason the record is worth anything.
  assert(typeof got.reportedAt === 'string' && got.reportedAt.length > 0, `reportedAt stamped: ${got.reportedAt}`);
});

await test('7. It is served back on the agent listing', async () => {
  const { body } = await json('/v1/agents', { headers: { Authorization: `Bearer ${tokA}` } });
  const row = body.data.agents.find((a: any) => a.gaii === codeBacked);
  assert(row.runtime_source?.kind === 'python', `kind: ${JSON.stringify(row.runtime_source)}`);
  assert(row.runtime_source?.file === 'crews/web_researcher_crew.py', `file: ${row.runtime_source?.file}`);
});

await test('8. A JSON crew answers the same question with a revision', async () => {
  const set = await json(`/v1/agents/webresearcher/runtime-source`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${tokA}` },
    body: JSON.stringify({ runtime_source: { kind: 'crew-def', definition_revision: 7 } }),
  });
  assert(set.status === 200, `report: ${set.status}`);
  assert(set.body.data.runtime_source.definitionRevision === 7, `revision: ${JSON.stringify(set.body.data.runtime_source)}`);
  // Replacing it drops the previous claim rather than merging — a half-old report is worse than none.
  assert(set.body.data.runtime_source.file === undefined, 'the previous file is gone, not merged');
});

await test('9. null clears it', async () => {
  const cleared = await json(`/v1/agents/webresearcher/runtime-source`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${tokA}` }, body: JSON.stringify({ runtime_source: null }),
  });
  assert(cleared.status === 200, `clear: ${cleared.status}`);
  assert(cleared.body.data.runtime_source === null, `cleared: ${JSON.stringify(cleared.body.data.runtime_source)}`);
});

await test('10. Something with no kind is refused', async () => {
  const bad = await json(`/v1/agents/webresearcher/runtime-source`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${tokA}` }, body: JSON.stringify({ runtime_source: { file: 'x.py' } }),
  });
  assert(bad.status === 400, `expected 400, got ${bad.status}`);
});

await test('11. Another owner cannot report on your agent', async () => {
  const denied = await json(`/v1/agents/${encodeURIComponent(codeBacked)}/runtime-source`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${tokB}` },
    body: JSON.stringify({ runtime_source: { kind: 'python', file: 'evil.py' } }),
  });
  assert(denied.status === 403 || denied.status === 404, `cross-owner report must be refused, got ${denied.status}`);
  assert(othersAgent !== codeBacked, 'the two owners really do have different agents');
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);
