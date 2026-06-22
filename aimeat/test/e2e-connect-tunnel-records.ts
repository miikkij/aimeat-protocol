// E2E Tests for the Connector Forward Tunnel — P1 workspace record push
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=connect-tunnel-records
//
// Covers: subscribe → record write → `deliver{workspace.record}` push (happy path, incl. the
// multi-segment namespace `shared.tasks`); created-vs-updated op; drafts/version writes do NOT push;
// and the SECURITY invariant — an agent that cannot READ the workspace (member but no read grant on a
// private workspace) is REJECTED at subscribe and receives NO record push (push == REST-read access).

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { TunnelClient } from './helpers/tunnel-harness.js';

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
  const body = ct.includes('json') ? await res.json() : { _raw: await res.text() };
  return { status: res.status, body };
}
async function signMsg(privB64: string, message: string): Promise<string> {
  const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
  return Buffer.from(sig).toString('base64');
}
async function ownerToken(name: string, priv: string): Promise<string> {
  const ts = new Date().toISOString();
  const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(priv, name + NODE_ID + ts) }) });
  assert(body.ok === true, `owner token: ${JSON.stringify(body.error)}`);
  return body.data.token;
}
async function agentToken(gaii: string, priv: string): Promise<string> {
  const ts = new Date().toISOString();
  const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: await signMsg(priv, gaii + ts) }) });
  assert(body.ok === true, `agent token: ${JSON.stringify(body.error)}`);
  return body.data.token;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function setupOwner(prefix: string) {
  const name = `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
  assert(reg.status === 201, `register owner ${reg.status}: ${JSON.stringify(reg.body)}`);
  return { name, token: await ownerToken(name, reg.body.data.private_key) };
}
async function setupAgent(ownerName: string, ownerTok: string, agentName: string) {
  const reg = await json('/v1/agents', {
    method: 'POST', headers: auth(ownerTok),
    body: JSON.stringify({ name: agentName, owner: ownerName, capabilities: ['memory'], scopes: ['*'] }),
  });
  assert(reg.status === 201, `register agent ${reg.status}: ${JSON.stringify(reg.body)}`);
  return { gaii: reg.body.data.agent.gaii as string, token: await agentToken(reg.body.data.agent.gaii, reg.body.data.private_key) };
}

// ─── State ───
let A: Awaited<ReturnType<typeof setupOwner>>;
let B: Awaited<ReturnType<typeof setupOwner>>;
let aAgent: Awaited<ReturnType<typeof setupAgent>>;
let bAgent: Awaited<ReturnType<typeof setupAgent>>;
let orgId = '';
const WS = 'ws-rec1';
const SPACE = 'shared.tasks';  // multi-segment namespace — exercises prefix matching
const root = () => `organism.${orgId}.w.${WS}`;

async function writeRecord(tok: string, instanceSuffix: string, value: any): Promise<{ status: number; body: any }> {
  return json('/v1/memory', { method: 'POST', headers: auth(tok), body: JSON.stringify({ key: `${root()}.${SPACE}.${instanceSuffix}`, value, visibility: 'private' }) });
}

console.log('\n=== AIMEAT Connector Forward Tunnel — Workspace Record Push E2E (P1) ===\n');

console.log('Setup — Owners, agents, organism, workspace');
await test('Register owner A + agent, owner B + agent', async () => {
  A = await setupOwner('reca');
  B = await setupOwner('recb');
  aAgent = await setupAgent(A.name, A.token, 'recbota');
  bAgent = await setupAgent(B.name, B.token, 'recbotb');
});
await test('A creates an OPEN organism + a PRIVATE workspace (manifest gate)', async () => {
  const o = await json('/v1/organisms', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'Rec Org', description: 'x', type: 'project', join_policy: 'open', visibility: 'public' }) });
  assert(o.status === 201, `org ${o.status}: ${JSON.stringify(o.body)}`);
  orgId = o.body.data.organism.id;
  await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Coordination', createdAt: new Date().toISOString(), createdBy: A.name }] }, visibility: 'private' }) });
  const manifest = { manifestVersion: '1.0', id: orgId, name: 'Coordination', kind: 'project', status: 'active', objectTypes: [{ name: 'task', schemaRef: 'schema:task@1', namespace: SPACE, backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'records' }] };
  const mr = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' }) });
  assert(mr.status === 201 || mr.status === 200, `manifest ${mr.status}: ${JSON.stringify(mr.body.error)}`);
});

// ─── Happy path: A's agent (same owner ⇒ may read the workspace) ───
console.log("\nPhase 1 — Record push to the workspace owner's agent");

await test('1. Subscribe accepted for a readable space', async () => {
  const t = await TunnelClient.connect(BASE, aAgent.token);
  await t.waitForBacklog(1000);
  t.subscribe([{ organism_id: orgId, ws: WS, space: SPACE }]);
  const ack = await t.waitForSubscribed(2000);
  assert(ack !== null, 'received a subscribed ack');
  assert((ack!.payload as any)?.accepted?.length === 1, `accepted 1, got ${JSON.stringify(ack!.payload)}`);
  assert(((ack!.payload as any)?.rejected ?? []).length === 0, 'nothing rejected');
  await t.close();
});

await test('2. A record CREATE pushes deliver{workspace.record, op:created}', async () => {
  const t = await TunnelClient.connect(BASE, aAgent.token);
  await t.waitForBacklog(1000);
  t.subscribe([{ organism_id: orgId, ws: WS, space: SPACE }]);
  assert((await t.waitForSubscribed(2000)) !== null, 'subscribed');
  const w = await writeRecord(A.token, 'rec1', { id: 'rec1', title: 'First' });
  assert(w.status === 201, `record write ${w.status}: ${JSON.stringify(w.body.error)}`);
  const d = await t.waitForDeliver(2000);
  assert(d !== null, 'received a record deliver');
  assert(d!.kind === 'workspace.record', `kind ${d!.kind}`);
  const p = d!.payload as any;
  assert(p?.type === 'workspace.record', 'payload type');
  assert(p?.organism_id === orgId && p?.ws === WS && p?.space === SPACE, `coords ${JSON.stringify(p)}`);
  assert(p?.id === 'rec1', `instance id ${p?.id}`);
  assert(p?.op === 'created', `op ${p?.op}`);
  await t.close();
});

await test('3. A record UPDATE pushes op:updated; a DRAFT write pushes nothing', async () => {
  const t = await TunnelClient.connect(BASE, aAgent.token);
  await t.waitForBacklog(1000);
  t.subscribe([{ organism_id: orgId, ws: WS, space: SPACE }]);
  assert((await t.waitForSubscribed(2000)) !== null, 'subscribed');

  // Update the existing record → op:updated.
  const u = await writeRecord(A.token, 'rec1', { id: 'rec1', title: 'First (edited)' });
  assert(u.status === 200, `update status ${u.status}`);
  const d = await t.waitForDeliver(2000);
  assert(d !== null && (d!.payload as any)?.op === 'updated', `expected op:updated, got ${JSON.stringify(d?.payload)}`);

  // A DRAFT write must NOT push (drafts are working copies, not contract triggers).
  const dr = await writeRecord(A.token, 'rec2.draft', { id: 'rec2', title: 'Draft only' });
  assert(dr.status === 201, `draft write ${dr.status}`);
  const none = await t.waitForDeliver(800);
  assert(none === null, `draft must not push, but got ${JSON.stringify(none?.payload)}`);
  await t.close();
});

// ─── Security: B's agent is a member but cannot READ the private workspace ───
console.log('\nPhase 2 — Read-consent parity (no read ⇒ no push)');

await test('4. B joins the org (member, but no workspace read grant)', async () => {
  const j = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: auth(B.token), body: '{}' });
  assert(j.status === 200 || j.status === 201, `join ${j.status}: ${JSON.stringify(j.body)}`);
});

await test("5. B's agent subscribe is REJECTED (access_denied) for the private workspace", async () => {
  const t = await TunnelClient.connect(BASE, bAgent.token);
  await t.waitForBacklog(1000);
  t.subscribe([{ organism_id: orgId, ws: WS, space: SPACE }]);
  const ack = await t.waitForSubscribed(2000);
  assert(ack !== null, 'received a subscribed ack');
  assert(((ack!.payload as any)?.accepted ?? []).length === 0, `expected 0 accepted, got ${JSON.stringify(ack!.payload)}`);
  const rejected = (ack!.payload as any)?.rejected ?? [];
  assert(rejected.length === 1 && rejected[0]?.reason === 'access_denied', `expected access_denied, got ${JSON.stringify(rejected)}`);
  await t.close();
});

await test("6. A write produces NO record push to B's agent (no read ⇒ no push)", async () => {
  const t = await TunnelClient.connect(BASE, bAgent.token);
  await t.waitForBacklog(1000);
  t.subscribe([{ organism_id: orgId, ws: WS, space: SPACE }]);
  await t.waitForSubscribed(2000);  // rejected, but drains the ack
  const w = await writeRecord(A.token, 'rec3', { id: 'rec3', title: 'Owner-only' });
  assert(w.status === 201, `write ${w.status}`);
  const leaked = await t.waitForDeliver(1000);
  assert(leaked === null, `B's agent must receive NO record push, but got ${JSON.stringify(leaked?.payload)}`);
  await t.close();
});

// ─── P2: token-revocation push ───
console.log('\nPhase 3 — Token-revocation push (P2)');

await test("7. Revoking an agent's token pushes auth_revoked + closes its tunnel", async () => {
  const t = await TunnelClient.connect(BASE, aAgent.token);
  await t.waitForBacklog(1000);
  // Revoke the very token this socket is pinned to.
  const r = await json('/v1/auth/revoke', { method: 'POST', headers: auth(aAgent.token), body: '{}' });
  assert(r.status === 200, `revoke status ${r.status}: ${JSON.stringify(r.body)}`);
  const rev = await t.waitForAuthRevoked(2000);
  assert(rev !== null, 'received an auth_revoked frame');
  assert(rev!.type === 'auth_revoked', `frame type ${rev!.type}`);
  await t.close();
});

// ─── P3: task-cancellation push ───
console.log('\nPhase 4 — Task-cancellation push (P3)');

await test('8. Writing a cancel marker pushes task.cancelled to the task\'s agent', async () => {
  // A task owned by A's agent (name "recbota", from setupAgent above).
  const ct = await json('/v1/agents/recbota/tasks', {
    method: 'POST', headers: auth(A.token),
    body: JSON.stringify({ title: 'Cancellable', description: 'x', status: 'queued' }),
  });
  assert(ct.status === 201, `create task ${ct.status}: ${JSON.stringify(ct.body)}`);
  const taskId = ct.body.data.task.id;

  const t = await TunnelClient.connect(BASE, aAgent.token);
  await t.waitForBacklog(1000);
  // Owner writes the cancel marker (value = task id list), as the cortex cancelTask lib does.
  const w = await json('/v1/memory', {
    method: 'POST', headers: auth(A.token),
    body: JSON.stringify({ key: `agents.cancel.task.${taskId}`, value: [taskId], visibility: 'owner' }),
  });
  assert(w.status === 201 || w.status === 200, `cancel marker write ${w.status}`);
  const d = await t.waitForDeliver(2000);
  assert(d !== null && d!.kind === 'task.cancelled', `expected task.cancelled, got ${JSON.stringify(d)}`);
  assert((d!.payload as any)?.id === taskId, `cancelled id ${(d!.payload as any)?.id} != ${taskId}`);
  await t.close();
});

// ─── Federated DM push (event-based, no poll) ───
console.log('\nPhase 5 — Federated DM addressed to the agent pushes deliver{dm.inbound}');
await test('A federated DM to the agent pushes deliver{dm.inbound} with the record-shaped payload', async () => {
  const t = await TunnelClient.connect(BASE, aAgent.token);
  await t.waitForBacklog(1000);
  // Owner B sends a DM to A's agent (first contact; the wake fires regardless of the request gate).
  const send = await json('/v1/messages', {
    method: 'POST', headers: auth(B.token),
    body: JSON.stringify({ to: aAgent.gaii, body: 'Hei agentti — tunnel-push testi.', subject: 'Push' }),
  });
  assert(send.status === 201, `dm send ${send.status}: ${JSON.stringify(send.body)}`);
  const d = await t.waitForDeliver(2000);
  assert(d !== null, 'received a dm deliver');
  assert(d!.kind === 'dm.inbound', `kind ${d!.kind}`);
  const p = d!.payload as any;
  assert(p?.id === send.body.data.message.id, `message id ${p?.id}`);
  assert(p?.conversationId === send.body.data.message.conversationId, `conversationId ${p?.conversationId}`);
  assert(p?.senderGhii === `${B.name}@${NODE_ID}`, `senderGhii ${p?.senderGhii}`);
  assert(p?.subject === 'Push', `subject ${p?.subject}`);
  await t.close();
});

// ─── Cleanup ───
console.log('\nCleanup');
await test('Cascade-delete owners', async () => {
  await json(`/v1/owners/${encodeURIComponent(A.name)}`, { method: 'DELETE', headers: auth(A.token) });
  await json(`/v1/owners/${encodeURIComponent(B.name)}`, { method: 'DELETE', headers: auth(B.token) });
});

// ─── Summary ───
console.log(`\n${'='.repeat(50)}`);
console.log(`Connector Tunnel Record Push E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
