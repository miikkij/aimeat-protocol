// E2E Tests for the Connector Forward Tunnel — Phase 2 (reverse delivery + push)
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=connect-tunnel-delivery
//
// Covers: push-latency invariant (connected agent receives deliver{task_assigned}
// on queue within a tight bound), no-loss-on-disconnect invariant (task queued
// while offline arrives via backlog exactly once on reconnect), id-dedup (live
// deliver id == backlog task id), and ack-drops-from-next-backlog.
// 2026-10-02: the delivery id is the transition's own (`<task id>:<status>:<time>`); the task id
// rides in the payload, which is what the connector dedups on. Test 8 is the hosted-places case:
// the create push acknowledged, a plan proposed, then Start, which the tunnel used to drop.

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { TunnelClient } from './helpers/tunnel-harness.js';

ed.hashes.sha512 = (m: Uint8Array) =>
  new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const PUSH_LATENCY_BUDGET_MS = 250;

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
const ownerName = `delowner${Date.now()}`;
let ownerToken = '';
let agentToken = '';
const agentName = 'delbot';

async function createQueuedTask(title: string): Promise<string> {
  const { status, body } = await json(`/v1/agents/${agentName}/tasks`, {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ title, description: title, status: 'queued' }),
  });
  assert(status === 201, `create task status ${status}: ${JSON.stringify(body)}`);
  assert(body.data.task.status === 'queued', `task status: ${body.data.task.status}`);
  return body.data.task.id;
}
function backlogTaskIds(frame: any): string[] {
  return ((frame?.payload?.tasks ?? []) as any[]).map(t => t.id);
}

console.log('\n=== AIMEAT Connector Forward Tunnel — Reverse Delivery E2E (Phase 2) ===\n');

console.log('Setup — Owner & Agent');
await test('Register owner', async () => {
  const { status, body } = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }) });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  ownerToken = await getToken(ownerName, body.data.private_key, false);
});
await test('Register agent (interactive)', async () => {
  const { status, body } = await json('/v1/agents', {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ name: agentName, owner: ownerName, capabilities: ['memory', 'actions'], scopes: ['*'] }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  agentToken = await getToken(body.data.agent.gaii, body.data.private_key, true);
});

// ─── Phase 1: realtime push to a connected agent ───
console.log('\nPhase 1 — Realtime push (connected)');

let pushTaskId = '';
await test('1. Push-latency invariant — queued task delivered within budget', async () => {
  const t = await TunnelClient.connect(BASE, agentToken);
  await t.waitForBacklog(1000);  // drain the initial (empty) backlog snapshot
  const t0 = Date.now();
  pushTaskId = await createQueuedTask('Push latency task');
  const d = await t.waitForDeliver(1000);
  const latency = Date.now() - t0;
  assert(d !== null, 'received a deliver frame on queue');
  assert(d!.kind === 'task_assigned', `kind: ${d!.kind}`);
  assert((d!.payload as any)?.id === pushTaskId, `deliver payload id ${(d!.payload as any)?.id} != ${pushTaskId}`);
  assert((d!.payload as any)?.title === 'Push latency task', 'full task payload delivered');
  assert(d!.id.startsWith(`${pushTaskId}:`), `deliver frame id names the task: ${d!.id}`);
  assert(latency < PUSH_LATENCY_BUDGET_MS, `push latency ${latency}ms exceeds ${PUSH_LATENCY_BUDGET_MS}ms budget`);
  await t.close();
});

await test('2. id-dedup — same id surfaces once in the reconnect backlog', async () => {
  // pushTaskId is still queued + unacked → it must reappear via backlog under the
  // SAME id the live deliver used, so the connector dedups live+backlog by id.
  const t = await TunnelClient.connect(BASE, agentToken);
  const bl = await t.waitForBacklog(1500);
  assert(bl !== null, 'received backlog on reconnect');
  const occurrences = backlogTaskIds(bl).filter(id => id === pushTaskId).length;
  assert(occurrences === 1, `expected pushTaskId once in backlog, got ${occurrences}`);
  await t.close();
});

// ─── Phase 2: no-loss across a disconnect ───
console.log('\nPhase 2 — No-loss on disconnect');

let offlineTaskId = '';
await test('3. No-loss invariant — task queued while offline arrives via backlog exactly once', async () => {
  // No socket open for this agent right now.
  offlineTaskId = await createQueuedTask('Offline-queued task');
  const t = await TunnelClient.connect(BASE, agentToken);
  const bl = await t.waitForBacklog(1500);
  assert(bl !== null, 'received backlog on reconnect');
  const occurrences = backlogTaskIds(bl).filter(id => id === offlineTaskId).length;
  assert(occurrences === 1, `offline task must appear exactly once, got ${occurrences}`);
  const task = (bl!.payload as any).tasks.find((x: any) => x.id === offlineTaskId);
  assert(task?.title === 'Offline-queued task', 'full task object present in backlog');
  await t.close();
});

await test('4. ack does NOT drop a still-queued task (no-loss is storage truth)', async () => {
  // ack means "I received the push", NOT "the task is done". A still-queued task
  // must reappear in the backlog on reconnect even after an ack — otherwise an
  // agent that acked then crashed mid-work would never re-learn it.
  const t = await TunnelClient.connect(BASE, agentToken);
  const bl = await t.waitForBacklog(1500);
  assert(backlogTaskIds(bl).includes(offlineTaskId), 'task present before ack');
  t.ack(offlineTaskId);
  await sleep(150);  // let the server record the ack
  await t.close();

  const t2 = await TunnelClient.connect(BASE, agentToken);
  const bl2 = await t2.waitForBacklog(1500);
  assert(bl2 !== null, 'received backlog after ack');
  assert(backlogTaskIds(bl2).includes(offlineTaskId), 'still-queued task remains in backlog after ack');
  await t2.close();
});

await test('5. A status change (done) is what removes a task from the backlog', async () => {
  // Drive offlineTaskId through its lifecycle: queued → active (owner start) →
  // done (agent complete). Only then should it leave the backlog.
  const start = await json(`/v1/agents/${agentName}/tasks/${offlineTaskId}/start`, { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` } });
  assert(start.status === 200, `start status ${start.status}: ${JSON.stringify(start.body)}`);
  const complete = await json(`/v1/agents/${agentName}/tasks/${offlineTaskId}/complete`, {
    method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
    body: JSON.stringify({ message: 'done' }),
  });
  assert(complete.status === 200, `complete status ${complete.status}: ${JSON.stringify(complete.body)}`);
  const t = await TunnelClient.connect(BASE, agentToken);
  const bl = await t.waitForBacklog(1500);
  assert(bl !== null, 'received backlog after completion');
  assert(!backlogTaskIds(bl).includes(offlineTaskId), 'completed task is gone from the backlog');
  await t.close();
});

await test('6. Offline agent gets no live deliver; only backlog carries it', async () => {
  // A fresh queued task created with NO socket open produces no deliver frame
  // (nothing to push to); it surfaces only on the next connect via backlog.
  const lateTaskId = await createQueuedTask('Late offline task');
  const t = await TunnelClient.connect(BASE, agentToken);
  const bl = await t.waitForBacklog(1500);
  assert(backlogTaskIds(bl).includes(lateTaskId), 'late task delivered via backlog');
  // No live deliver should have fired for it (it was queued before connect).
  const liveForLate = t.delivers.some(d => d.id === lateTaskId);
  assert(!liveForLate, 'no spurious live deliver for an offline-queued task');
  await t.close();
});

// ─── Phase 3: owner approval pushes the EXECUTE wake ───
console.log('\nPhase 3 — Owner approval (queued → active) push');

await test('7. Owner /start pushes a live task_assigned to a connected agent', async () => {
  // Regression for the "waits for polling" gap: a queued task approved by the owner
  // (queued -> active) must push the SAME task_assigned wake as create-time auto-activation,
  // so a tunnel-parked daemon runs EXECUTE immediately instead of on its ~5-min safety-net re-list.
  // Queue the task with NO socket open, so the ONLY live deliver can come from /start (test 6 proves
  // an offline-queued task produces no deliver on connect — only backlog).
  const startTaskId = await createQueuedTask('Approval push task');
  const t = await TunnelClient.connect(BASE, agentToken);
  await t.waitForBacklog(1500);   // drain the backlog snapshot (carries the queued task)
  const t0 = Date.now();
  const start = await json(`/v1/agents/${agentName}/tasks/${startTaskId}/start`, { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` } });
  assert(start.status === 200, `start status ${start.status}: ${JSON.stringify(start.body)}`);
  const d = await t.waitForDeliver(1000);
  const latency = Date.now() - t0;
  assert(d !== null, 'received a deliver frame on owner approval');
  assert(d!.kind === 'task_assigned', `kind: ${d!.kind}`);
  assert((d!.payload as any)?.id === startTaskId, `deliver payload id ${(d!.payload as any)?.id} != ${startTaskId}`);
  assert((d!.payload as any)?.status === 'active', `approved task delivered as active, got ${(d!.payload as any)?.status}`);
  assert(latency < PUSH_LATENCY_BUDGET_MS, `approval push latency ${latency}ms exceeds ${PUSH_LATENCY_BUDGET_MS}ms budget`);
  await t.close();
});

await test('8. Start on a task the agent already took and proposed for wakes it at once', async () => {
  // The hosted-places measurement (2026-10-01): the create push went down the socket and was
  // acknowledged, the agent proposed its plan, the owner pressed Start, and nothing arrived: the
  // tunnel skipped the Start push because it reused the task id the agent had already acknowledged.
  // The runtime found the task on its own re-list about 90 s later.
  const t = await TunnelClient.connect(BASE, agentToken);
  await t.waitForBacklog(1500);
  const taskId = await createQueuedTask('Proposed then started');
  const first = await t.waitForDeliver(1000);
  assert(first !== null && (first.payload as any)?.id === taskId, 'the create push arrived');
  t.ack(first!.id!);
  await sleep(100);
  const propose = await json(`/v1/agents/${agentName}/tasks/${taskId}/propose-todos`, {
    method: 'POST', headers: { Authorization: `Bearer ${agentToken}` },
    body: JSON.stringify({ todos: [{ title: 'Do it' }] }),
  });
  assert(propose.status === 200, `propose status ${propose.status}: ${JSON.stringify(propose.body)}`);
  assert(propose.body.data.task.status === 'queued', `an interactive agent's task waits, got ${propose.body.data.task.status}`);
  const t0 = Date.now();
  const start = await json(`/v1/agents/${agentName}/tasks/${taskId}/start`, { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` } });
  assert(start.status === 200, `start status ${start.status}: ${JSON.stringify(start.body)}`);
  const d = await t.waitForDeliver(1000);
  const latency = Date.now() - t0;
  assert(d !== null, 'Start pushed a second deliver after the first was acknowledged');
  assert((d!.payload as any)?.id === taskId && (d!.payload as any)?.status === 'active', 'the active task arrived');
  assert(d!.id !== first!.id, 'the second push has its own delivery id');
  assert(latency < PUSH_LATENCY_BUDGET_MS, `Start push latency ${latency}ms exceeds ${PUSH_LATENCY_BUDGET_MS}ms budget`);
  await t.close();
});

await test('9. Another owner cannot start this agent\'s task, and nothing is pushed for it', async () => {
  // The fence beside the wake: a second account's session is refused, and the agent's socket hears
  // nothing, so a refused Start can never wake somebody else's agent.
  const strangerName = `delstranger${Date.now()}`;
  const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: strangerName, public_key: 'placeholder' }) });
  assert(reg.status === 201, `stranger ${reg.status}`);
  const strangerToken = await getToken(strangerName, reg.body.data.private_key, false);
  const taskId = await createQueuedTask('Not the stranger\'s to start');
  const t = await TunnelClient.connect(BASE, agentToken);
  await t.waitForBacklog(1500);
  const r = await json(`/v1/agents/${agentName}/tasks/${taskId}/start`, { method: 'POST', headers: { Authorization: `Bearer ${strangerToken}` } });
  assert(r.status === 403, `a second owner is refused, got ${r.status}`);
  const d = await t.waitForDeliver(500);
  assert(d === null, `nothing is pushed for a refused Start, got ${JSON.stringify(d)}`);
  await t.close();
  await json(`/v1/owners/${encodeURIComponent(strangerName)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${strangerToken}` } });
});

// ─── Cleanup ───
console.log('\nCleanup');
await test('Cascade-delete owner', async () => {
  const { status } = await json(`/v1/owners/${encodeURIComponent(ownerName)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${ownerToken}` } });
  assert(status === 200, `status ${status}`);
});

// ─── Summary ───
console.log(`\n${'='.repeat(50)}`);
console.log(`Connector Tunnel Reverse Delivery E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
