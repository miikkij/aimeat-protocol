/**
 * @file e2e-ecosystem-capabilities.ts
 * @description E2E for ecosystem capability & data-access (chunk 3). Covers: (1) an agent/owner
 *   invoking a GEAI capability (source.type:'ecosystem') OVER THE TUNNEL via the new server→client
 *   invoke/invoke_result frame, incl. offline→502; (2) the workflow step kinds trigger-geai (invoke a
 *   GEAI capability) and export-out (push owner data to a GEAI), completing on the reply; (3) the
 *   data-area allowlist enforced on a GEAI's organism-workspace deposit; (4) read-through references.
 *   Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=ecosystem-capabilities
 * @version-history
 *   v1.0.0 — 2026-06-14 — Initial creation (ecosystem capability & data-access, chunk 3).
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
  const ts = new Date().toISOString();
  const sig = Buffer.from(await ed.signAsync(new TextEncoder().encode(owner + NODE_ID + ts), Buffer.from(privKey, 'base64'))).toString('base64');
  const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner, timestamp: ts, signature: sig }) });
  assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
  return body.data.token;
}

const GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const ownerName = `ecocapowner${Date.now()}`;
let ownerToken = '';
let auth: Record<string, string> = {};

async function connectGeai(app: string, scopes: string[], dataAreas?: unknown[]): Promise<{ geai: string; token: string }> {
  const pub = Buffer.from(`vk-${app}`).toString('base64');
  const hello = await json('/v1/ecosystem-apps/hello', { method: 'POST', body: JSON.stringify({ owner: ownerName, app, public_key: pub, scopes, data_areas: dataAreas }) });
  assert(hello.body.ok === true, `hello ${app}: ${JSON.stringify(hello.body.error)}`);
  const { user_code, device_code } = hello.body.data;
  const approve = await json(`/v1/ecosystem-apps/${user_code}/approve`, { method: 'POST', headers: auth, body: JSON.stringify({ action: 'approve', scopes, data_areas: dataAreas }) });
  assert(approve.body.data?.status === 'approved', `approve ${app}: ${JSON.stringify(approve.body)}`);
  const tok = await json('/v1/ecosystem-apps/token', { method: 'POST', body: JSON.stringify({ device_code, grant_type: GRANT }) });
  return { geai: approve.body.data.geai, token: tok.body.access_token };
}

async function run() {
  console.log('\n=== AIMEAT Ecosystem Capability & Data-Access E2E ===\n');
  console.log(`Base: ${BASE}\nNode: ${NODE_ID}\n`);

  console.log('Setup — Owner');
  await test('Register owner', async () => {
    const { status, body } = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }) });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    ownerToken = await getOwnerToken(ownerName, body.data.private_key);
    auth = { Authorization: `Bearer ${ownerToken}` };
  });

  // ── Phase 1: invoke a GEAI capability over the tunnel ──
  console.log('\nPhase 1 — Invoke a GEAI capability over the tunnel');
  let capId = '';
  await test('Register an ecosystem-source capability', async () => {
    const r = await json('/v1/capabilities', { method: 'POST', headers: auth, body: JSON.stringify({
      name: 'Billing Reply', summary: 'reply via the billing app', callable: true, visibility: 'private',
      source: { type: 'ecosystem', ref: 'eco:billing:reply', version: '1.0.0' },
      inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
    }) });
    assert(r.status === 201, `register ${r.status}: ${JSON.stringify(r.body)}`);
    capId = r.body.data.id;
    assert(r.body.data.source.type === 'ecosystem', 'source type ecosystem stored');
  });

  await test('Discovery filter ?source_type=ecosystem returns it', async () => {
    const r = await json('/v1/capabilities?source_type=ecosystem', { headers: auth });
    assert(r.status === 200, `list ${r.status}`);
    const items = r.body.data.items ?? r.body.data.capabilities ?? [];
    assert(items.some((c: any) => c.id === capId), 'ecosystem capability is discoverable by filter');
  });

  await test('Invoking it forwards over the tunnel and returns the GEAI reply', async () => {
    const g = await connectGeai('billing', ['memory:read']);
    const tunnel = await TunnelClient.connect(BASE, g.token);
    tunnel.onInvoke(f => ({ ok: true, result: { echoed: f.input, cap: f.capability } }));
    try {
      const r = await json(`/v1/capabilities/${capId}/invoke`, { method: 'POST', headers: auth, body: JSON.stringify({ input: { x: 42 } }) });
      assert(r.status === 200, `invoke ${r.status}: ${JSON.stringify(r.body)}`);
      assert(r.body.data?.result?.echoed?.x === 42, `result echoed: ${JSON.stringify(r.body.data?.result)}`);
      assert(r.body.data?.result?.cap === 'reply', `capability forwarded: ${r.body.data?.result?.cap}`);
      const inv = await tunnel.waitForInvoke(500);
      assert(!!inv && inv.caller?.startsWith(ownerName), `GEAI received the invoke with caller (${inv?.caller})`);
    } finally { await tunnel.close(); }
  });

  await test('Invoking an offline GEAI capability → 502 ECOSYSTEM_OFFLINE', async () => {
    // No tunnel held for 'billing' now (closed above).
    const r = await json(`/v1/capabilities/${capId}/invoke`, { method: 'POST', headers: auth, body: JSON.stringify({ input: {} }) });
    assert(r.status === 502, `expected 502, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.error?.code === 'ECOSYSTEM_OFFLINE', `expected ECOSYSTEM_OFFLINE, got ${r.body.error?.code}`);
  });

  // ── Phase 2: workflow trigger-geai step ──
  console.log('\nPhase 2 — Workflow trigger-geai step');
  await test('A trigger-geai step invokes the GEAI and the run completes', async () => {
    const g = await connectGeai('crew', ['memory:read']);
    const tunnel = await TunnelClient.connect(BASE, g.token);
    tunnel.onInvoke(() => ({ ok: true, result: { done: true } }));
    try {
      const wf = {
        title: { en_US: 'Trigger crew' }, description: { en_US: 'invoke a GEAI capability' },
        trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect',
        steps: [{ id: 'call', description: { en_US: 'Call crew' }, required_to_function: 'none',
          action: { kind: 'trigger-geai', geai: g.geai, capability: 'do', input: { a: 1 } } }],
      };
      const put = await json('/v1/workflows/eco-trig', { method: 'PUT', headers: auth, body: JSON.stringify(wf) });
      assert(put.status === 200, `put ${put.status}: ${JSON.stringify(put.body)}`);
      const runR = await json('/v1/workflows/eco-trig/run', { method: 'POST', headers: auth, body: JSON.stringify({ mode: 'full' }) });
      const runId = runR.body.data.runId;
      let status = '';
      for (let i = 0; i < 20; i++) {
        const rr = await json(`/v1/workflows/eco-trig/runs/${runId}`, { headers: auth });
        status = rr.body.data?.run?.status ?? rr.body.data?.status;
        if (status === 'done' || status === 'partial') break;
        await sleep(200);
      }
      assert(status === 'done', `run should complete done, got ${status}`);
      assert(tunnel.invokes.length >= 1, 'the GEAI received the trigger-geai invoke');
    } finally { await tunnel.close(); }
  });

  await test('A trigger-geai step whose GEAI refuses → partial run', async () => {
    const g = await connectGeai('crewfail', ['memory:read']);
    const tunnel = await TunnelClient.connect(BASE, g.token);
    tunnel.onInvoke(() => ({ ok: false, result: { error: 'refused' } }));
    try {
      const wf = {
        title: { en_US: 'Trigger fail' }, description: { en_US: 'GEAI refuses' },
        trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect',
        steps: [{ id: 'call', description: { en_US: 'Call' }, required_to_function: 'none',
          action: { kind: 'trigger-geai', geai: g.geai, capability: 'do' } }],
      };
      assert((await json('/v1/workflows/eco-trig-f', { method: 'PUT', headers: auth, body: JSON.stringify(wf) })).status === 200, 'put');
      const runR = await json('/v1/workflows/eco-trig-f/run', { method: 'POST', headers: auth, body: JSON.stringify({ mode: 'full' }) });
      const runId = runR.body.data.runId;
      let status = '';
      for (let i = 0; i < 20; i++) {
        const rr = await json(`/v1/workflows/eco-trig-f/runs/${runId}`, { headers: auth });
        status = rr.body.data?.run?.status ?? rr.body.data?.status;
        if (status === 'done' || status === 'partial') break;
        await sleep(200);
      }
      assert(status === 'partial', `run should be partial on refusal, got ${status}`);
    } finally { await tunnel.close(); }
  });

  // ── Phase 3: workflow export-out step ──
  console.log('\nPhase 3 — Workflow export-out step');
  await test('An export-out step pushes owner data to the GEAI', async () => {
    await json('/v1/memory', { method: 'POST', headers: auth, body: JSON.stringify({ key: 'export.src', value: { hello: 'world' }, visibility: 'private' }) });
    const g = await connectGeai('sink', ['memory:read']);
    const tunnel = await TunnelClient.connect(BASE, g.token);
    let pushed: any = null;
    tunnel.onInvoke(f => { pushed = f.input; return { ok: true, result: { stored: true } }; });
    try {
      const wf = {
        title: { en_US: 'Export' }, description: { en_US: 'push to sink' },
        trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect',
        steps: [{ id: 'push', description: { en_US: 'Push' }, required_to_function: 'none',
          action: { kind: 'export-out', geai: g.geai, from: 'export.src' } }],
      };
      assert((await json('/v1/workflows/eco-exp', { method: 'PUT', headers: auth, body: JSON.stringify(wf) })).status === 200, 'put');
      const runR = await json('/v1/workflows/eco-exp/run', { method: 'POST', headers: auth, body: JSON.stringify({ mode: 'full' }) });
      const runId = runR.body.data.runId;
      let status = '';
      for (let i = 0; i < 20; i++) {
        const rr = await json(`/v1/workflows/eco-exp/runs/${runId}`, { headers: auth });
        status = rr.body.data?.run?.status ?? rr.body.data?.status;
        if (status === 'done' || status === 'partial') break;
        await sleep(200);
      }
      assert(status === 'done', `export run should complete, got ${status}`);
      assert(pushed?.data?.hello === 'world', `GEAI received the owner data: ${JSON.stringify(pushed)}`);
    } finally { await tunnel.close(); }
  });

  // ── Phase 4: data-area allowlist on an organism deposit ──
  console.log('\nPhase 4 — Data-area allowlist on organism deposit');
  let orgId = '';
  const WS = 'wsA';
  await test('Owner creates organism + workspace registry', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Eco Org', description: 'x', type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(o.status === 200 || o.status === 201, `org ${o.status}: ${JSON.stringify(o.body)}`);
    orgId = o.body.data.id ?? o.body.data.organism?.id;
    assert(!!orgId, `got orgId: ${JSON.stringify(o.body.data)}`);
    const reg = await json('/v1/memory', { method: 'POST', headers: auth, body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'WS', createdAt: new Date().toISOString(), createdBy: ownerName }] }, visibility: 'private' }) });
    assert(reg.status === 200 || reg.status === 201, `registry ${reg.status}`);
  });

  await test('A GEAI WITH an organisms grant may deposit into the workspace', async () => {
    const g = await connectGeai('depositapp', ['memory:read', 'memory:write'], [{ area: 'organisms', pattern: `organism.${orgId}.**`, rights: ['write'] }]);
    const r = await json('/v1/memory', { method: 'POST', headers: { Authorization: `Bearer ${g.token}` }, body: JSON.stringify({ key: `organism.${orgId}.w.${WS}.refined`, value: { ok: 1 }, visibility: 'owner' }) });
    assert(r.status === 200 || r.status === 201, `deposit should succeed, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await test('A GEAI WITHOUT the grant is denied (DATA_AREA_DENIED)', async () => {
    const g = await connectGeai('noaccessapp', ['memory:read', 'memory:write']); // no dataAreas
    const r = await json('/v1/memory', { method: 'POST', headers: { Authorization: `Bearer ${g.token}` }, body: JSON.stringify({ key: `organism.${orgId}.w.${WS}.sneaky`, value: { bad: 1 }, visibility: 'owner' }) });
    assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.error?.code === 'DATA_AREA_DENIED', `expected DATA_AREA_DENIED, got ${r.body.error?.code}`);
  });

  // ── Phase 5: read-through reference ──
  console.log('\nPhase 5 — Read-through reference');
  await test('Read-through fetches live content via the GEAI; offline returns cached', async () => {
    await json('/v1/memory', { method: 'POST', headers: auth, body: JSON.stringify({ key: 'refs.doc1', value: { _type: 'ecosystem_ref', app: 'livedocs', remoteId: 'r1', title: 'Q3', schema: { type: 'object' } }, visibility: 'private' }) });
    const g = await connectGeai('livedocs', ['memory:read']);
    const tunnel = await TunnelClient.connect(BASE, g.token);
    tunnel.onInvoke(f => ({ ok: true, result: { body: `live:${(f.input as any)?.remoteId}` } }));
    try {
      const r = await json('/v1/ecosystem/read-through', { method: 'POST', headers: auth, body: JSON.stringify({ key: 'refs.doc1' }) });
      assert(r.status === 200, `read-through ${r.status}: ${JSON.stringify(r.body)}`);
      assert(r.body.data?.content?.body === 'live:r1', `live content returned: ${JSON.stringify(r.body.data)}`);
    } finally { await tunnel.close(); }
    // Offline: the GEAI tunnel is closed → graceful cached fallback.
    const r2 = await json('/v1/ecosystem/read-through', { method: 'POST', headers: auth, body: JSON.stringify({ key: 'refs.doc1' }) });
    assert(r2.status === 200 && r2.body.data?.read_through_unavailable === true, `offline should return cached marker: ${JSON.stringify(r2.body.data)}`);
    assert(r2.body.data?.cached?.title === 'Q3', 'cached metadata is returned when offline');
  });

  console.log('\n' + '─'.repeat(48));
  console.log(`Ecosystem Capability & Data-Access E2E: ${passed} passed, ${failed} failed of ${passed + failed}`);
  if (failed > 0) process.exit(1);
  console.log('✅ All tests passed!\n');
}

run().catch(err => { console.error(err); process.exit(1); });
