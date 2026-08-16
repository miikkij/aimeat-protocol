/**
 * @file e2e-ecosystem-events.ts
 * @description E2E for ecosystem events & triggers (chunk 2). Covers: INBOUND — a GEAI POSTs an event
 *   to /v1/ecosystem/events and a matching `ecosystem.event` workflow trigger starts a run; the
 *   version fail-safe (major mismatch does NOT fire) and the match filter; the per-GEAI inbound audit
 *   log. OUTBOUND — an owner subscribes a GEAI to memory.write, the GEAI holds a tunnel, an owner
 *   memory write delivers a `deliver` frame to the GEAI (best-effort), and a non-matching write does
 *   not. Plus scope enforcement (events:emit) on the inbound route.
 *   Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=ecosystem-events
 * @version-history
 *   v1.1.0 — 2026-08-16 — August 2026 test-quality audit (e2e-ecosystem-events:116): one owner in the
 *     suite, so nothing distinguished "my connector fired my workflow" from "any connector fires
 *     every matching workflow on the node". A second owner now holds a WORD-FOR-WORD identical
 *     trigger; A's connector emits; A's workflow runs and B's does not, checked from both sides
 *     (B's run list, and A's run list for B's workflow id).
 *     NOT PROVED RED-FIRST, and the reason is worth the line: with the owner term deleted from the
 *     trigger filter (services/workflow/engine.ts:530) the suite stays green, because startRun
 *     resolves the workflow DEFINITION under the emitter's owner — B's definition is not there, so
 *     the run never starts. The isolation has a second, independent guard, which the audit's
 *     "would fire every other owner's workflow" did not account for.
 *   v1.0.0 — 2026-06-14 — Initial creation (ecosystem events & triggers, chunk 2).
 */
import { TunnelClient } from './helpers/tunnel-harness.js';

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

async function json(path: string, opts: RequestInit = {}, retries = 5): Promise<{ status: number; body: any }> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    if (res.status === 429 && attempt < retries) { await sleep(2000); continue; }
    return { status: res.status, body };
  }
  throw new Error('unreachable');
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

async function getOwnerToken(owner: string, privKey: string): Promise<string> {
  const timestamp = new Date().toISOString();
  const sig = Buffer.from(await ed.signAsync(new TextEncoder().encode(owner + NODE_ID + timestamp), Buffer.from(privKey, 'base64'))).toString('base64');
  const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner, timestamp, signature: sig }) });
  assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
  return body.data.token;
}

const GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const ownerName = `ecoevowner${Date.now()}`;
const agentName = 'eco-step-bot';
let ownerToken = '';
let auth: Record<string, string> = {};

/** Run the chunk-1 hello → approve → token handshake; return the GEAI id + its token. */
async function connectGeai(app: string, scopes: string[]): Promise<{ geai: string; token: string }> {
  const pub = Buffer.from(`verify-key-${app}`).toString('base64');
  const hello = await json('/v1/ecosystem-apps/hello', { method: 'POST', body: JSON.stringify({ owner: ownerName, app, public_key: pub, scopes }) });
  assert(hello.body.ok === true, `hello ${app}: ${JSON.stringify(hello.body.error)}`);
  const { user_code, device_code } = hello.body.data;
  const approve = await json(`/v1/ecosystem-apps/${user_code}/approve`, { method: 'POST', headers: auth, body: JSON.stringify({ action: 'approve', scopes }) });
  assert(approve.body.data?.status === 'approved', `approve ${app}: ${JSON.stringify(approve.body)}`);
  const geai = approve.body.data.geai;
  const tok = await json('/v1/ecosystem-apps/token', { method: 'POST', body: JSON.stringify({ device_code, grant_type: GRANT }) });
  assert(typeof tok.body.access_token === 'string', `token ${app}: ${JSON.stringify(tok.body)}`);
  return { geai, token: tok.body.access_token };
}

const OFFER = {
  id: 'fetch', title: 'Fetch', ask: 'fetch',
  deliverable: { format: 'document', location: { key: 'eco.raw' } },
  required_to_function: { kind: 'deterministic', key: 'config.enabled', op: 'exists' },
  success_signal: { kind: 'deterministic', key: 'eco.raw', op: 'nonempty' },
};
const stepFetch = { id: 'fetch', agent: agentName, offer: 'fetch', description: { en_US: 'Fetch' }, required_to_function: 'none', timeout_min: 10 };

async function emitEvent(geaiToken: string, event: string, version: number, data: Record<string, unknown>) {
  return json('/v1/ecosystem/events', { method: 'POST', headers: { Authorization: `Bearer ${geaiToken}` }, body: JSON.stringify({ event, version, data }) });
}
async function runCount(wfId: string): Promise<number> {
  const r = await json(`/v1/workflows/${wfId}/runs`, { headers: auth });
  return r.body.data?.count ?? 0;
}

async function run() {
  console.log('\n=== AIMEAT Ecosystem Events & Triggers E2E ===\n');
  console.log(`Base: ${BASE}\nNode: ${NODE_ID}\n`);

  // ── Setup ──
  console.log('Setup — Owner + agent + offer');
  await test('Register owner', async () => {
    const { status, body } = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }) });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    ownerToken = await getOwnerToken(ownerName, body.data.private_key);
    auth = { Authorization: `Bearer ${ownerToken}` };
  });
  await test('Register agent + publish offer', async () => {
    const a = await json('/v1/agents', { method: 'POST', headers: auth, body: JSON.stringify({ name: agentName, owner: ownerName, capabilities: ['memory'] }) });
    assert(a.status === 201, `agent ${a.status}`);
    const o = await json(`/v1/agents/${agentName}/offers`, { method: 'PUT', headers: auth, body: JSON.stringify({ offers: [OFFER] }) });
    assert(o.status === 200, `offers ${o.status}: ${JSON.stringify(o.body)}`);
  });

  let geai = '';
  let geaiToken = '';
  await test('Connect a GEAI with events:emit + memory scopes', async () => {
    const g = await connectGeai('zendesk', ['memory:read', 'memory:write', 'events:emit', 'events:subscribe']);
    geai = g.geai; geaiToken = g.token;
    assert(geai === `eco:zendesk#${ownerName}@${NODE_ID}`, `geai: ${geai}`);
  });

  // ── Phase 1: inbound event → ecosystem.event trigger fires ──
  console.log('\nPhase 1 — Inbound ecosystem.event trigger');
  await test('A matching inbound event starts a workflow run', async () => {
    const wf = {
      title: { en_US: 'Distill tickets' }, description: { en_US: 'fires on ticket.resolved' },
      trigger: { kind: 'ecosystem.event', app: 'zendesk', on: 'ticket.resolved', version: 1, match: { status: 'closed' } },
      vars: [], on_step_fail: 'inspect', steps: [stepFetch],
    };
    const put = await json('/v1/workflows/eco-wf', { method: 'PUT', headers: auth, body: JSON.stringify(wf) });
    assert(put.status === 200, `put eco-wf ${put.status}: ${JSON.stringify(put.body)}`);
    assert((await runCount('eco-wf')) === 0, 'no runs before the event');

    const r = await emitEvent(geaiToken, 'ticket.resolved', 1, { ticket_id: 't1', status: 'closed' });
    assert(r.status === 200 && r.body.data?.accepted === true, `emit: ${r.status} ${JSON.stringify(r.body)}`);
    await sleep(900);
    assert((await runCount('eco-wf')) >= 1, 'expected a run after the matching event');
  });

  // The trigger filter matches on app + event + version, and the OWNER is the fourth term. With one
  // owner in the suite nothing distinguished "my zendesk fired my workflow" from "any zendesk fires
  // every matching workflow on the node" — which would run a stranger's agents and spend their
  // morsels on a payload they never saw.
  await test('A SECOND owner\'s identically-triggered workflow does NOT fire on A\'s event', async () => {
    const otherName = `ecoevother${Date.now()}`;
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: otherName, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register second owner: ${reg.status} ${JSON.stringify(reg.body)}`);
    const otherAuth = { Authorization: `Bearer ${await getOwnerToken(otherName, reg.body.data.private_key)}` };

    // B needs their own agent + offer, because the workflow step names one.
    const ag = await json('/v1/agents', { method: 'POST', headers: otherAuth, body: JSON.stringify({ name: agentName, owner: otherName, capabilities: ['memory'] }) });
    assert(ag.status === 201, `B's agent: ${ag.status}`);
    const off = await json(`/v1/agents/${agentName}/offers`, { method: 'PUT', headers: otherAuth, body: JSON.stringify({ offers: [OFFER] }) });
    assert(off.status === 200, `B's offers: ${off.status}`);

    // The SAME trigger, word for word, under a different account.
    const wf = {
      title: { en_US: 'Distill tickets (B)' }, description: { en_US: 'same trigger, other owner' },
      trigger: { kind: 'ecosystem.event', app: 'zendesk', on: 'ticket.crossed', version: 1, match: { status: 'closed' } },
      vars: [], on_step_fail: 'inspect', steps: [stepFetch],
    };
    const put = await json('/v1/workflows/eco-wf-b', { method: 'PUT', headers: otherAuth, body: JSON.stringify(wf) });
    assert(put.status === 200, `put eco-wf-b ${put.status}: ${JSON.stringify(put.body)}`);

    // A holds the same rule under their own account: the positive control for this event name.
    const wfA = { ...wf, title: { en_US: 'Distill tickets (A)' } };
    const putA = await json('/v1/workflows/eco-wf-x', { method: 'PUT', headers: auth, body: JSON.stringify(wfA) });
    assert(putA.status === 200, `put eco-wf-x ${putA.status}: ${JSON.stringify(putA.body)}`);

    const countB = async () => {
      const r = await json('/v1/workflows/eco-wf-b/runs', { headers: otherAuth });
      return r.body.data?.count ?? 0;
    };
    assert((await countB()) === 0, 'B has no runs before the event');
    assert((await runCount('eco-wf-x')) === 0, 'A has no runs before the event either');

    // A's connector emits. A's own workflow must fire; B's identical one must not.
    const r = await emitEvent(geaiToken, 'ticket.crossed', 1, { ticket_id: 't-cross', status: 'closed' });
    assert(r.status === 200 && r.body.data?.accepted === true, `emit: ${r.status} ${JSON.stringify(r.body)}`);
    await sleep(1200);
    assert((await runCount('eco-wf-x')) >= 1, 'A\'s own workflow must fire (the positive control)');
    assert((await countB()) === 0, 'a stranger\'s workflow must not run on somebody else\'s connector event');
    // …and it must not run under A's account either: startRun takes the EMITTER's owner, so a trigger
    // list that forgot the owner term would start B's workflow filed under A — B's own run list would
    // stay at zero and the leak would be invisible from B's side.
    assert((await runCount('eco-wf-b')) === 0, 'B\'s workflow must not have been started under A\'s account');
  });

  await test('Inbound event is recorded in the GEAI audit log', async () => {
    const r = await json(`/v1/memory/${encodeURIComponent('ecosystem.inbound.log')}`, { headers: { Authorization: `Bearer ${geaiToken}` } });
    assert(r.status === 200, `audit log read ${r.status}: ${JSON.stringify(r.body)}`);
    const entries = r.body.data?.value as any[];
    assert(Array.isArray(entries) && entries.some(e => e.event === 'ticket.resolved'), 'audit log has ticket.resolved');
  });

  // ── Phase 2: version fail-safe + match filter ──
  console.log('\nPhase 2 — Version fail-safe + match filter');
  await test('Major-version mismatch does NOT fire (fail-safe), correct version does', async () => {
    const wf = {
      title: { en_US: 'Versioned' }, description: { en_US: 'pins version 1' },
      trigger: { kind: 'ecosystem.event', app: 'zendesk', on: 'feedback.received', version: 1 },
      vars: [], on_step_fail: 'inspect', steps: [stepFetch],
    };
    assert((await json('/v1/workflows/eco-wf-v', { method: 'PUT', headers: auth, body: JSON.stringify(wf) })).status === 200, 'put eco-wf-v');

    await emitEvent(geaiToken, 'feedback.received', 2, { feedback_id: 'f1' });   // wrong MAJOR
    await sleep(700);
    assert((await runCount('eco-wf-v')) === 0, 'a major-version mismatch must not fire the trigger');

    await emitEvent(geaiToken, 'feedback.received', 1, { feedback_id: 'f2' });   // correct MAJOR
    await sleep(900);
    assert((await runCount('eco-wf-v')) >= 1, 'the correct major version must fire the trigger');
  });

  await test('Non-matching payload does NOT fire; matching payload does', async () => {
    const wf = {
      title: { en_US: 'Matched' }, description: { en_US: 'match status=closed' },
      trigger: { kind: 'ecosystem.event', app: 'zendesk', on: 'csat.dropped', version: 1, match: { status: 'closed' } },
      vars: [], on_step_fail: 'inspect', steps: [stepFetch],
    };
    assert((await json('/v1/workflows/eco-wf-m', { method: 'PUT', headers: auth, body: JSON.stringify(wf) })).status === 200, 'put eco-wf-m');

    await emitEvent(geaiToken, 'csat.dropped', 1, { status: 'open' });           // match fails
    await sleep(700);
    assert((await runCount('eco-wf-m')) === 0, 'a non-matching payload must not fire');

    await emitEvent(geaiToken, 'csat.dropped', 1, { status: 'closed' });         // match passes
    await sleep(900);
    assert((await runCount('eco-wf-m')) >= 1, 'a matching payload must fire');
  });

  // ── Phase 3: outbound subscription → tunnel delivery ──
  console.log('\nPhase 3 — Outbound subscription + best-effort tunnel delivery');
  await test('Owner subscribes the GEAI to memory.write', async () => {
    const r = await json('/v1/ecosystem/subscriptions', { method: 'POST', headers: auth, body: JSON.stringify({ app: 'zendesk', event: 'memory.write', match: { key: 'service.zendesk.*' } }) });
    assert(r.status === 200 && r.body.data?.subscription?.geai === geai, `subscribe: ${r.status} ${JSON.stringify(r.body)}`);
    const list = await json('/v1/ecosystem/subscriptions', { headers: auth });
    assert((list.body.data?.subscriptions ?? []).some((s: any) => s.event === 'memory.write'), 'subscription listed');
  });

  await test('A matching owner write delivers a memory.write event to the GEAI tunnel', async () => {
    const tunnel = await TunnelClient.connect(BASE, geaiToken);
    try {
      await json('/v1/memory', { method: 'POST', headers: auth, body: JSON.stringify({ key: 'service.zendesk.ticketX', value: { x: 1 }, visibility: 'private' }) });
      const frame = await tunnel.waitForDeliver(2000);
      assert(!!frame, 'expected a deliver frame for the matching write');
      assert(frame!.kind === 'memory.write', `deliver kind: ${frame!.kind}`);
      const payload = frame!.payload as any;
      assert(payload?.event === 'memory.write' && payload?.geai === geai && payload?.data?.key === 'service.zendesk.ticketX', `payload: ${JSON.stringify(payload)}`);

      // A non-matching write must NOT deliver.
      await json('/v1/memory', { method: 'POST', headers: auth, body: JSON.stringify({ key: 'unrelated.key', value: { y: 2 }, visibility: 'private' }) });
      const none = await tunnel.waitForDeliver(800);
      assert(none === null, `a non-matching write must not deliver (got ${JSON.stringify(none)})`);
    } finally {
      await tunnel.close();
    }
  });

  // ── Phase 4: scope enforcement ──
  console.log('\nPhase 4 — Scope enforcement');
  await test('A GEAI without events:emit is denied the inbound route (403)', async () => {
    const g = await connectGeai('airtable', ['memory:read', 'memory:write']); // no events:emit
    const r = await emitEvent(g.token, 'table.updated', 1, { table_id: 'tbl1' });
    assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.error?.code === 'SCOPE_DENIED', `expected SCOPE_DENIED, got ${r.body.error?.code}`);
  });

  // ── Summary ──
  console.log('\n' + '─'.repeat(48));
  console.log(`Ecosystem Events & Triggers E2E: ${passed} passed, ${failed} failed of ${passed + failed}`);
  if (failed > 0) process.exit(1);
  console.log('✅ All tests passed!\n');
}

run().catch(err => { console.error(err); process.exit(1); });
