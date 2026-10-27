/**
 * @file e2e-ecosystem-capabilities.ts
 * @description E2E for ecosystem capability & data-access (chunk 3). Covers: (1) an agent/owner
 *   invoking a GEAI capability (source.type:'ecosystem') OVER THE TUNNEL via the new server→client
 *   invoke/invoke_result frame, incl. offline→502; (2) the workflow step kinds trigger-geai (invoke a
 *   GEAI capability) and export-out (push owner data to a GEAI), completing on the reply; (3) the
 *   data-area allowlist enforced on a GEAI's organism-workspace deposit; (4) read-through references;
 *   (5) the data-area READ allowlist (model A / strict) — an organism read needs a matching 'read'
 *   grant, a write-only GEAI is denied, and a GEAI's own flat namespace stays free.
 *   Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=ecosystem-capabilities
 * @version-history
 *   v1.0.0 — 2026-06-14 — Initial creation (ecosystem capability & data-access, chunk 3).
 *   v1.1.0 — 2026-07-02 — Phase 6: data-area READ allowlist (ecoMayReadKey, model A / strict).
 *   v1.2.0 — 2026-10-22 — Phase 7: another account's capability over the caller's own outside app is
 *     refused on the app tool's REST, MCP and checkout paths until the caller's app declares the
 *     action and the account holder allows it with one press; then all three run, and the
 *     registrant's own use never asks (secaudit 2026-10, capability-invoke.ts ecosystem source).
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

import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

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
    ownerToken = (await registerOwner(BASE, ownerName)).token;
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

  await test('A STRANGER cannot invoke this private ecosystem capability', async () => {
    // The capability is registered `visibility: 'private'`, and this suite has exactly one owner, so
    // the invoke route is only ever called by the capability's own owner. Delete the owner/visibility
    // check and any account invokes a stranger's private ecosystem capability OVER THAT STRANGER'S
    // TUNNEL — arbitrary calls into somebody else's connected app.
    const strangerName = `ecocapx${Date.now()}`;
    const strangerAuth = { Authorization: `Bearer ${(await registerOwner(BASE, strangerName)).token}` };

    // A live tunnel, so a missing one cannot be the reason for the refusal.
    const g = await connectGeai('billing', ['memory:read']);
    const tunnel = await TunnelClient.connect(BASE, g.token);
    let reached = false;
    tunnel.onInvoke(f => { reached = true; return { ok: true, result: { echoed: f.input } }; });
    try {
      const r = await json(`/v1/capabilities/${capId}/invoke`, {
        method: 'POST', headers: strangerAuth, body: JSON.stringify({ input: { x: 1 } }),
      });
      assert(r.status === 403 || r.status === 404,
        `a stranger invoked a private ecosystem capability: ${r.status} ${JSON.stringify(r.body?.data ?? r.body?.error)}`);
      assert(!reached, 'and the call reached the owner\'s connected app');

      // The control: the owner's own invoke still works over the same tunnel.
      const mine = await json(`/v1/capabilities/${capId}/invoke`, {
        method: 'POST', headers: auth, body: JSON.stringify({ input: { x: 2 } }),
      });
      assert(mine.status === 200, `the owner's own invoke broke: ${mine.status} ${JSON.stringify(mine.body?.error)}`);
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

  await test('The grant PATTERN is a boundary: a second organism is not covered', async () => {
    // Phases 4 and 6 claim to prove the data-area allowlist, but only ONE organism exists in the whole
    // suite, so the grant's `pattern` is never a boundary — every case flips only the `rights` array.
    // Drop the consentMatchPattern clause from grantsCover (services/ecosystem-access.ts) and a GEAI
    // granted `organism.<A>.**` reads and writes EVERY organism on the node, with all four data-area
    // tests green.
    const o2 = await json('/v1/organisms', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Eco Org Two', description: 'x', type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(o2.status === 200 || o2.status === 201, `second org ${o2.status}: ${JSON.stringify(o2.body)}`);
    const otherOrgId = (o2.body.data.id ?? o2.body.data.organism?.id) as string;
    assert(!!otherOrgId && otherOrgId !== orgId, `a genuinely different organism: ${otherOrgId}`);

    // The SAME grant as the deposit test above: scoped to the first organism only.
    const g = await connectGeai('patternapp', ['memory:read', 'memory:write'], [{ area: 'organisms', pattern: `organism.${orgId}.**`, rights: ['write'] }]);
    const hdr = { Authorization: `Bearer ${g.token}` };

    const inside = await json('/v1/memory', {
      method: 'POST', headers: hdr,
      body: JSON.stringify({ key: `organism.${orgId}.w.${WS}.covered`, value: { ok: 1 }, visibility: 'owner' }),
    });
    assert(inside.status === 200 || inside.status === 201,
      `the granted organism is still writable: ${inside.status} ${JSON.stringify(inside.body?.error)}`);

    const outside = await json('/v1/memory', {
      method: 'POST', headers: hdr,
      body: JSON.stringify({ key: `organism.${otherOrgId}.w.${WS}.escaped`, value: { bad: 1 }, visibility: 'owner' }),
    });
    assert(outside.status === 403,
      `the grant reached another organism: ${outside.status} ${JSON.stringify(outside.body?.data ?? outside.body?.error)}`);
    assert(outside.body.error?.code === 'DATA_AREA_DENIED',
      `refused, but not as a data-area denial: ${outside.body.error?.code}`);
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

  // secaudit2026oct26, ecosystem-read-through:ref-target-unbound-to-writer. A reference an
  // ecosystem app wrote reads through that app; one naming another app is answered from its cached
  // metadata, and the other app hears nothing.
  await test('A reference one app wrote that names another app does not invoke the other app', async () => {
    const writer = await connectGeai('refwriter', ['memory:read', 'memory:write']);
    const target = await connectGeai('reftarget', ['memory:read']);
    const w = await json('/v1/memory', { method: 'POST', headers: { Authorization: `Bearer ${writer.token}` },
      body: JSON.stringify({ key: 'refs.crossapp', value: { _type: 'ecosystem_ref', app: 'reftarget', remoteId: 'x', readCapability: 'purge', title: 'cross' }, visibility: 'private' }) });
    assert(w.status === 200 || w.status === 201, `the app writes its reference: ${w.status} ${JSON.stringify(w.body?.error)}`);
    const frames: any[] = [];
    const tunnel = await TunnelClient.connect(BASE, target.token);
    tunnel.onInvoke(f => { frames.push(f); return { ok: true, result: { body: 'done' } }; });
    try {
      const r = await json('/v1/ecosystem/read-through', { method: 'POST', headers: auth, body: JSON.stringify({ key: 'refs.crossapp' }) });
      assert(r.status === 200, `read-through ${r.status}: ${JSON.stringify(r.body)}`);
      assert(frames.length === 0, `the other app was invoked: ${JSON.stringify(frames.map(f => ({ capability: f.capability, caller: f.caller })))}`);
      assert(r.body.data?.read_through_unavailable === true && r.body.data?.cached?.title === 'cross', `answered from the cached metadata: ${JSON.stringify(r.body.data)}`);
    } finally { await tunnel.close(); }
  });

  await test('A reference an app wrote about itself still reads through that app', async () => {
    const self = await connectGeai('refself', ['memory:read', 'memory:write']);
    const w = await json('/v1/memory', { method: 'POST', headers: { Authorization: `Bearer ${self.token}` },
      body: JSON.stringify({ key: 'refs.selfapp', value: { _type: 'ecosystem_ref', app: 'refself', remoteId: 's1', title: 'mine' }, visibility: 'private' }) });
    assert(w.status === 200 || w.status === 201, `the app writes its reference: ${w.status}`);
    const tunnel = await TunnelClient.connect(BASE, self.token);
    tunnel.onInvoke(f => ({ ok: true, result: { body: `live:${(f.input as any)?.remoteId}` } }));
    try {
      const r = await json('/v1/ecosystem/read-through', { method: 'POST', headers: auth, body: JSON.stringify({ key: 'refs.selfapp' }) });
      assert(r.status === 200 && r.body.data?.content?.body === 'live:s1', `live content through the writing app: ${JSON.stringify(r.body.data)}`);
    } finally { await tunnel.close(); }
  });

  // ── Phase 6: data-area READ allowlist (model A / strict) ──
  console.log('\nPhase 6 — Data-area READ allowlist on an organism key');
  await test('A GEAI WITH a read grant may read back its organism deposit', async () => {
    const g = await connectGeai('readapp', ['memory:read', 'memory:write'], [{ area: 'organisms', pattern: `organism.${orgId}.**`, rights: ['read', 'write'] }]);
    const auth2 = { Authorization: `Bearer ${g.token}` };
    const key = `organism.${orgId}.w.${WS}.mine`;
    const w = await json('/v1/memory', { method: 'POST', headers: auth2, body: JSON.stringify({ key, value: { ok: 1 }, visibility: 'owner' }) });
    assert(w.status === 200 || w.status === 201, `deposit ${w.status}: ${JSON.stringify(w.body)}`);
    const r = await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: auth2 });
    assert(r.status === 200, `read should succeed, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data?.value?.ok === 1, `expected value back, got ${JSON.stringify(r.body.data)}`);
  });

  await test('A write-only GEAI is denied the read (DATA_AREA_DENIED)', async () => {
    const g = await connectGeai('writeonlyreadapp', ['memory:read', 'memory:write'], [{ area: 'organisms', pattern: `organism.${orgId}.**`, rights: ['write'] }]);
    const auth2 = { Authorization: `Bearer ${g.token}` };
    const key = `organism.${orgId}.w.${WS}.mine2`;
    const w = await json('/v1/memory', { method: 'POST', headers: auth2, body: JSON.stringify({ key, value: { ok: 2 }, visibility: 'owner' }) });
    assert(w.status === 200 || w.status === 201, `deposit should still succeed (has write), got ${w.status}: ${JSON.stringify(w.body)}`);
    const r = await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: auth2 });
    assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.error?.code === 'DATA_AREA_DENIED', `expected DATA_AREA_DENIED, got ${r.body.error?.code}`);
  });

  await test('A GEAI reads its OWN flat (eco:) namespace without any data-area grant', async () => {
    const g = await connectGeai('flatreadapp', ['memory:read', 'memory:write']); // no dataAreas
    const auth2 = { Authorization: `Bearer ${g.token}` };
    const key = 'workspace.notes';
    const w = await json('/v1/memory', { method: 'POST', headers: auth2, body: JSON.stringify({ key, value: { n: 1 }, visibility: 'private' }) });
    assert(w.status === 200 || w.status === 201, `flat deposit ${w.status}: ${JSON.stringify(w.body)}`);
    const r = await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: auth2 });
    assert(r.status === 200 && r.body.data?.value?.n === 1, `flat read should succeed, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await phaseCrossOwner();

  console.log('\n' + '─'.repeat(48));
  console.log(`Ecosystem Capability & Data-Access E2E: ${passed} passed, ${failed} failed of ${passed + failed}`);
  if (failed > 0) process.exit(1);
  console.log('✅ All tests passed!\n');
}

// ── Phase 7: another account's capability over the caller's own outside app ──
//
// secaudit 2026-10, capability-invoke.ts:ecosystem-source:app-slug-resolved-in-caller-reach. A
// capability `eco:{app}:{action}` runs over the CALLER's connected app. The suite's first owner (the
// registrant, M, the operator on this fresh database) binds such a capability in its own public
// app-tool manifest with lockedInput; a second owner (V) who calls that tool must not have their own
// app run M's chosen action until V allowed it once with one press. M's own use stays as it was.
async function connectGeaiFor(owner: string, ownerAuth: Record<string, string>, app: string, declared: string[]): Promise<{ geai: string; token: string }> {
  const pub = Buffer.from(`vk-${owner}-${app}`).toString('base64');
  const scopes = ['memory:read'];
  const manifest = declared.length ? { app, scopes, capabilities: declared.map(id => ({ id })) } : undefined;
  const hello = await json('/v1/ecosystem-apps/hello', { method: 'POST', body: JSON.stringify({ owner, app, public_key: pub, scopes, ...(manifest ? { manifest } : {}) }) });
  assert(hello.body.ok === true, `hello ${app}: ${JSON.stringify(hello.body.error)}`);
  const { user_code, device_code } = hello.body.data;
  const approve = await json(`/v1/ecosystem-apps/${user_code}/approve`, { method: 'POST', headers: ownerAuth, body: JSON.stringify({ action: 'approve', scopes }) });
  assert(approve.body.data?.status === 'approved', `approve ${app}: ${JSON.stringify(approve.body)}`);
  const tok = await json('/v1/ecosystem-apps/token', { method: 'POST', body: JSON.stringify({ device_code, grant_type: GRANT }) });
  return { geai: approve.body.data.geai, token: tok.body.access_token };
}

async function phaseCrossOwner(): Promise<void> {
  console.log('\nPhase 7 — Another account\'s capability over the caller\'s own outside app');
  const FILE = 'eco-tools.html';
  const VAPP = 'vaultdesk';
  const victimName = `ecocapv${Date.now()}`;
  let victimAuth: Record<string, string> = {};
  let victimToken = '';
  let vTunnel: TunnelClient | null = null;
  let mTunnel: TunnelClient | null = null;
  let declaredCap = '';
  let undeclaredCap = '';
  let allowEndpoint = '';
  let allowBody: Record<string, unknown> = {};
  const tool = (who: Record<string, string>, name: string) =>
    json(`/v1/apps/${ownerName}/${FILE}/webmcp/tools/${name}`, { method: 'POST', headers: who, body: JSON.stringify({ input: {} }) });
  const framesToV = () => vTunnel?.invokes.length ?? 0;

  try {
    await test('Setup: V connects an outside app that declares one action; M binds capabilities over it in a public app tool', async () => {
      victimToken = (await registerOwner(BASE, victimName)).token;
      victimAuth = { Authorization: `Bearer ${victimToken}` };
      const g = await connectGeaiFor(victimName, victimAuth, VAPP, ['dangerousAction']);
      vTunnel = await TunnelClient.connect(BASE, g.token);
      vTunnel.onInvoke(f => ({ ok: true, result: { stub_saw: { capability: f.capability, input: f.input, caller: f.caller } } }));
      const reg = async (ref: string) => {
        const r = await json('/v1/capabilities', { method: 'POST', headers: auth, body: JSON.stringify({
          name: `Probe ${ref}`, summary: 'cross-owner probe', callable: true, visibility: 'private',
          source: { type: 'ecosystem', ref, version: '1.0.0' }, inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
        }) });
        assert(r.status === 201, `register ${ref}: ${r.status} ${JSON.stringify(r.body.error)}`);
        return r.body.data.id as string;
      };
      declaredCap = await reg(`eco:${VAPP}:dangerousAction`);
      undeclaredCap = await reg(`eco:${VAPP}:secretWipe`);
      const m = await json('/v1/memory', { method: 'POST', headers: auth, body: JSON.stringify({
        key: `apps.${FILE}.tools`, visibility: 'public',
        value: { version: 1, tools: [
          { name: 't', description: 'Locked call', action_id: declaredCap, lockedInput: { marker: 'from-M' } },
          { name: 'u', description: 'Undeclared action', action_id: undeclaredCap },
          { name: 'paid', description: 'Paced, bought at checkout', action_id: declaredCap, tollMorsels: 2, lockedInput: { marker: 'from-M' } },
        ] },
      }) });
      assert(m.status === 200 || m.status === 201, `manifest ${m.status}: ${JSON.stringify(m.body.error)}`);
    });

    await test('REFUSED: V calling M\'s tool does not run M\'s chosen action on V\'s app; the refusal names the one-press page', async () => {
      const r = await tool(victimAuth, 't');
      assert(r.status === 403 && r.body.error?.code === 'ECOSYSTEM_CAPABILITY_NEEDS_APPROVAL',
        `expected 403 ECOSYSTEM_CAPABILITY_NEEDS_APPROVAL, got ${r.status} ${JSON.stringify(r.body.error ?? r.body.data)}`);
      const msg = String(r.body.error?.message ?? '');
      assert(msg.includes(`/v1/eco-capability-allow?app=${VAPP}&capability=${declaredCap}`), `no allow page in: ${msg}`);
      await sleep(150);
      assert(framesToV() === 0, `V's app received ${framesToV()} frame(s): ${JSON.stringify(vTunnel?.invokes)}`);
    });

    await test('REFUSED: the MCP twin (aimeat_app_tool_invoke) by V\'s own agent', async () => {
      const agent = await makeAgent(BASE, { name: victimName, token: victimToken }, ['exchange:write', 'ext:invoke', 'memory:read']);
      const s = await openSession(BASE, agent.token);
      const r = await callTool(s, 'aimeat_app_tool_invoke', { owner: ownerName, app: FILE, tool: 't', input: {} });
      assert(r.offered && r.isError && (r.text.includes('ECOSYSTEM_CAPABILITY_NEEDS_APPROVAL') || r.text.includes('/v1/eco-capability-allow')),
        `MCP twin not refused with the approval: ${r.text.slice(0, 400)}`);
      assert(framesToV() === 0, `V's app received a frame over MCP: ${JSON.stringify(vTunnel?.invokes)}`);
    });

    await test('REFUSED: a checkout of the paced tool runs nothing on V\'s app, and the session stays open', async () => {
      const create = await json('/v1/commerce/checkout-sessions', { method: 'POST', headers: victimAuth,
        body: JSON.stringify({ items: [{ kind: 'app-tool', app: `${ownerName}/${FILE}`, tool: 'paid', input: {} }] }) });
      assert(create.status === 201, `create ${create.status}: ${JSON.stringify(create.body.error)}`);
      const id = create.body.data.session.id;
      const done = await json(`/v1/commerce/checkout-sessions/${id}/complete`, { method: 'POST', headers: victimAuth, body: JSON.stringify({}) });
      assert(done.status !== 200, `checkout completed: ${JSON.stringify(done.body.data?.session?.fulfillment)}`);
      const back = await json(`/v1/commerce/checkout-sessions/${id}`, { headers: victimAuth });
      assert(back.body.data?.session?.status === 'open', `session ${back.body.data?.session?.status}`);
      assert(framesToV() === 0, `V's app received a frame from the checkout: ${JSON.stringify(vTunnel?.invokes)}`);
    });

    await test('REFUSED: an action V\'s app does not declare cannot be allowed at all (ECOSYSTEM_CAPABILITY_NOT_YOURS)', async () => {
      const r = await tool(victimAuth, 'u');
      assert(r.status === 403 && r.body.error?.code === 'ECOSYSTEM_CAPABILITY_NOT_YOURS', `got ${r.status} ${JSON.stringify(r.body.error)}`);
      assert(framesToV() === 0, 'V\'s app received the undeclared action');
    });

    await test('REFUSED: an account with no such app connected (ECO_APP_NOT_FOUND)', async () => {
      const w = await registerOwner(BASE, `ecocapw${Date.now()}`);
      const r = await tool({ Authorization: `Bearer ${w.token}` }, 't');
      assert(r.status === 404 && r.body.error?.code === 'ECO_APP_NOT_FOUND', `got ${r.status} ${JSON.stringify(r.body.error)}`);
    });

    await test('V hears it in the bell, with Allow on the notice', async () => {
      const n = await json('/v1/notifications', { headers: victimAuth });
      const ask = (n.body?.data?.notifications ?? []).filter((x: any) => x.type === 'eco_capability_ask');
      assert(ask.length === 1, `expected one notice (the question is filed once), got ${ask.length}`);
      const allow = (ask[0].actions ?? []).find((a: any) => a.id === 'allow');
      assert(!!allow && String(allow.endpoint) === `/v1/ecosystem-apps/${VAPP}/capability-approvals` && allow.body?.capability === declaredCap,
        `no Allow: ${JSON.stringify(ask[0].actions)}`);
      allowEndpoint = allow.endpoint; allowBody = allow.body;
    });

    await test('The notice also carries Don\'t allow, aimed at the same question', async () => {
      const n = await json('/v1/notifications', { headers: victimAuth });
      const ask = (n.body?.data?.notifications ?? []).filter((x: any) => x.type === 'eco_capability_ask');
      const deny = (ask[0]?.actions ?? []).find((a: any) => a.id === 'deny');
      assert(!!deny && String(deny.endpoint) === `/v1/ecosystem-apps/${VAPP}/capability-approvals/decline` && deny.body?.capability === declaredCap,
        `no Don't allow: ${JSON.stringify(ask[0]?.actions)}`);
    });

    await test('Only V in person reads and answers the question: not V\'s agent, not M', async () => {
      const agent = await makeAgent(BASE, { name: victimName, token: victimToken }, ['memory:read', 'memory:write']);
      const agentAuth = { Authorization: `Bearer ${agent.token}` };
      const q = `/v1/ecosystem-apps/${VAPP}/capability-approval?capability=${encodeURIComponent(declaredCap)}`;
      const asAgent = await json(q, { headers: agentAuth });
      assert(asAgent.status === 403, `an agent read the question: ${asAgent.status}`);
      const agentAllow = await json(`/v1/ecosystem-apps/${VAPP}/capability-approvals`, { method: 'POST', headers: agentAuth, body: JSON.stringify(allowBody) });
      assert(agentAllow.status === 403, `an agent allowed it: ${agentAllow.status}`);
      const agentNo = await json(`/v1/ecosystem-apps/${VAPP}/capability-approvals/decline`, { method: 'POST', headers: agentAuth, body: JSON.stringify(allowBody) });
      assert(agentNo.status === 403, `an agent answered no: ${agentNo.status}`);
      const mAllow = await json(`/v1/ecosystem-apps/${VAPP}/capability-approvals`, { method: 'POST', headers: auth, body: JSON.stringify(allowBody) });
      assert(mAllow.status === 404, `the registrant answered on V's app: ${mAllow.status} ${JSON.stringify(mAllow.body.error)}`);
      const view = await json(q, { headers: victimAuth });
      const d = view.body.data ?? {};
      assert(view.status === 200 && d.registrant === ownerName && d.action === 'dangerousAction' && d.approved_at === null
        && d.still_asks === true && d.action_declared === true && String(d.input).includes('from-M'), `view: ${view.status} ${JSON.stringify(view.body)}`);
      assert(framesToV() === 0, 'a frame reached V\'s app before the answer');
    });

    await test('KEEPS WORKING: after V\'s one press, M\'s tool runs on V\'s app over REST, MCP and the checkout', async () => {
      const ok = await json(allowEndpoint, { method: 'POST', headers: victimAuth, body: JSON.stringify(allowBody) });
      assert(ok.status === 200 && typeof ok.body.data?.approval?.approvedAt === 'string', `allow: ${ok.status} ${JSON.stringify(ok.body)}`);
      const r = await tool(victimAuth, 't');
      assert(r.status === 200 && r.body.data?.result?.stub_saw?.capability === 'dangerousAction'
        && r.body.data.result.stub_saw.input?.marker === 'from-M', `REST after the press: ${r.status} ${JSON.stringify(r.body.error ?? r.body.data)}`);
      const agent = await makeAgent(BASE, { name: victimName, token: victimToken }, ['exchange:write', 'ext:invoke', 'memory:read']);
      const viaMcp = await callTool(await openSession(BASE, agent.token), 'aimeat_app_tool_invoke', { owner: ownerName, app: FILE, tool: 't', input: {} });
      assert(!viaMcp.isError, `MCP after the press: ${viaMcp.text.slice(0, 300)}`);
      const create = await json('/v1/commerce/checkout-sessions', { method: 'POST', headers: victimAuth,
        body: JSON.stringify({ items: [{ kind: 'app-tool', app: `${ownerName}/${FILE}`, tool: 'paid', input: {} }] }) });
      const done = await json(`/v1/commerce/checkout-sessions/${create.body.data.session.id}/complete`, { method: 'POST', headers: victimAuth, body: JSON.stringify({}) });
      assert(done.status === 200 && done.body.data.session.status === 'completed', `checkout after the press: ${done.status} ${JSON.stringify(done.body.error)}`);
      assert(framesToV() === 3, `V's app received ${framesToV()} frames, expected 3`);
      const listed = await json('/v1/ecosystem-apps', { headers: victimAuth });
      const app = (listed.body.data?.ecosystem_apps ?? []).find((a: any) => a.app === VAPP);
      assert((app?.capability_approvals ?? []).some((a: any) => a.capability === declaredCap && a.approvedAt), `listing: ${JSON.stringify(app?.capability_approvals)}`);
    });

    await test('KEEPS WORKING: M\'s own tool over M\'s own app needs no declaration and no press', async () => {
      const g = await connectGeaiFor(ownerName, auth, 'mydesk', []);
      mTunnel = await TunnelClient.connect(BASE, g.token);
      mTunnel.onInvoke(f => ({ ok: true, result: { own: f.capability } }));
      const reg = await json('/v1/capabilities', { method: 'POST', headers: auth, body: JSON.stringify({
        name: 'Own desk', summary: 'own app', callable: true, visibility: 'private',
        source: { type: 'ecosystem', ref: 'eco:mydesk:anything', version: '1.0.0' }, inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
      }) });
      assert(reg.status === 201, `register own: ${reg.status}`);
      const FILE2 = 'own-tools.html';
      const m = await json('/v1/memory', { method: 'POST', headers: auth, body: JSON.stringify({
        key: `apps.${FILE2}.tools`, visibility: 'public', value: { version: 1, tools: [{ name: 'own', description: 'Own', action_id: reg.body.data.id }] } }) });
      assert(m.status === 200 || m.status === 201, `own manifest ${m.status}`);
      const r = await json(`/v1/apps/${ownerName}/${FILE2}/webmcp/tools/own`, { method: 'POST', headers: auth, body: JSON.stringify({ input: {} }) });
      assert(r.status === 200 && r.body.data?.result?.own === 'anything', `own tool: ${r.status} ${JSON.stringify(r.body.error ?? r.body.data)}`);
    });

    await test('A changed capability is a new question; Don\'t allow and withdraw both leave V\'s app untouched', async () => {
      const patched = await json(`/v1/capabilities/${declaredCap}`, { method: 'PUT', headers: auth,
        body: JSON.stringify({ source: { type: 'ecosystem', ref: `eco:${VAPP}:dangerousAction2`, version: '1.0.1' } }) });
      assert(patched.status === 200, `patch: ${patched.status} ${JSON.stringify(patched.body.error)}`);
      const before = framesToV();
      const r = await tool(victimAuth, 't');
      // dangerousAction2 is not declared by V's app, so it is refused outright, never on the old press.
      assert(r.status === 403 && r.body.error?.code === 'ECOSYSTEM_CAPABILITY_NOT_YOURS', `changed action: ${r.status} ${JSON.stringify(r.body.error)}`);
      const back = await json(`/v1/capabilities/${declaredCap}`, { method: 'PUT', headers: auth,
        body: JSON.stringify({ source: { type: 'ecosystem', ref: `eco:${VAPP}:dangerousAction`, version: '1.0.2' } }) });
      assert(back.status === 200, `patch back: ${back.status}`);
      const w = await json(`/v1/ecosystem-apps/${VAPP}/capability-approvals?capability=${encodeURIComponent(declaredCap)}`, { method: 'DELETE', headers: victimAuth });
      assert(w.status === 200 && w.body.data?.withdrawn === true, `withdraw: ${w.status} ${JSON.stringify(w.body)}`);
      const again = await tool(victimAuth, 't');
      assert(again.status === 403 && again.body.error?.code === 'ECOSYSTEM_CAPABILITY_NEEDS_APPROVAL', `after withdraw: ${again.status} ${again.body.error?.code}`);
      const no = await json(`/v1/ecosystem-apps/${VAPP}/capability-approvals/decline`, { method: 'POST', headers: victimAuth, body: JSON.stringify({ capability: declaredCap }) });
      assert(no.status === 200 && no.body.data?.declined === true, `decline: ${no.status} ${JSON.stringify(no.body)}`);
      const gone = await json(allowEndpoint, { method: 'POST', headers: victimAuth, body: JSON.stringify(allowBody) });
      assert(gone.status === 404 && gone.body.error?.code === 'APPROVAL_NOT_FOUND', `a declined question was allowed: ${gone.status}`);
      assert(framesToV() === before, `V's app received ${framesToV() - before} frame(s) after the change`);
    });
  } finally {
    // A test of its own and the file's last block, so check:denial-coverage does not read the call
    // that starts the suite, at the end of the file, as part of a block that asserts a refusal
    // (scripts/lib/route-refusals.ts reads a block up to the next test).
    await test('Phase 7 cleanup: both outside apps disconnect from the tunnel', async () => {
      await (vTunnel as TunnelClient | null)?.close();
      await (mTunnel as TunnelClient | null)?.close();
    });
  }
}

run().catch(err => { console.error(err); process.exit(1); });
