// E2E test — Reference "B2B Sales Hub" use-case template (Secretary P5 — epic capstone)
//
// The end-to-end proof of the whole epic: load the reference template DATA from disk
// (docs/templates/b2b-sales-hub/template-meta.json), build the sales organism skeleton it describes,
// EXPORT it as a use-case template, then INSTANTIATE it and verify the chain:
//   sales organism + its (empty) workspaces materialize, the sdr + meeting-prep SPECIALISTS are
//   provisioned with their own brains, and the Vainu/Alma CONNECTOR deps surface as UNMET — each with
//   a self-heal build prompt — until the connectors are built.
//
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=b2b-sales-hub-template

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
  return { status: res.status, body };
}
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string) {
  return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

// The reference template, loaded as DATA from the repo (cwd = aimeat → repo root is ..).
const META = JSON.parse(readFileSync(resolve(process.cwd(), '../docs/templates/b2b-sales-hub/template-meta.json'), 'utf8'));

console.log('\n=== AIMEAT B2B Sales Hub reference template E2E (epic capstone) ===\n');

let token = '', ownerName = '', orgId = '';

await test('Setup owner + build the sales organism skeleton from the reference template', async () => {
  ownerName = `b2bowner${Date.now()}`;
  const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: ownerName, display_name: 'B2B Owner', password: 'B2bOwner1234' }) });
  assert(reg.status === 201, `ghii ${reg.status}`);
  const ts = new Date().toISOString();
  const tk = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: ownerName, timestamp: ts, signature: await sign(reg.body.data.private_key, ownerName + NODE_ID + ts) }) });
  token = tk.body.data.token;
  const o = await json('/v1/organisms', { method: 'POST', headers: auth(token), body: JSON.stringify({ name: META.organism.name, type: META.organism.type, join_policy: META.organism.join_policy, visibility: META.organism.visibility }) });
  assert(o.status === 201, `org ${o.status}: ${JSON.stringify(o.body.error)}`);
  orgId = o.body.data.organism.id;

  // Register all workspaces, then write each one's manifest + readme + locked schema (per the meta).
  await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({
    key: `organism.${orgId}.meta.workspaces`,
    value: { workspaces: META.workspaces.map((w: any) => ({ id: w.id, name: w.name, createdAt: ts, createdBy: ownerName })) },
    visibility: 'private',
  }) });
  for (const w of META.workspaces) {
    const manifest = { manifestVersion: '1.0', id: orgId, name: w.name, kind: 'project', status: 'active', objectTypes: [
      { name: w.objectType.name, schemaRef: `schema:${w.objectType.name}@1`, namespace: w.objectType.namespace, backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'records' },
    ] };
    await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: `organism.${orgId}.w.${w.id}.meta.manifest`, value: manifest, visibility: 'private' }) });
    await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: `organism.${orgId}.w.${w.id}.meta.readme`, value: w.readme, visibility: 'private' }) });
    const sr = await json(`/v1/memory/${encodeURIComponent(`organism.${orgId}.w.${w.id}.${w.objectType.namespace}`)}/schema`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ schema: w.schema, apply_to: 'prefix', schema_mode: 'strict' }) });
    assert(sr.status === 200 || sr.status === 201, `schema ${w.id} ${sr.status}`);
  }
  // one lead record — proves the exported template is content-free.
  await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: `organism.${orgId}.w.leads.shared.leads.l1.latest`, value: { id: 'l1', company: 'Acme Oy', country: 'FI', status: 'qualified' }, visibility: 'private' }) });
});

let zipB64 = '';
await test('export the sales organism as the B2B Sales Hub template (skeleton + template.json)', async () => {
  const { status, body } = await json('/v1/organism-templates/export', {
    method: 'POST', headers: auth(token),
    body: JSON.stringify({
      org_id: orgId, title: META.title, description: META.description, tags: META.tags,
      specialists: META.specialists, extensions: META.extensions, scopePresets: META.scopePresets,
    }),
  });
  assert(status === 200, `export ${status}: ${JSON.stringify(body.error)}`);
  assert(body.data?.workspaces >= 2, `>=2 workspaces in the template (${body.data?.workspaces})`);
  zipB64 = body.data?.zip_base64;
  assert(typeof zipB64 === 'string' && zipB64.length > 0, 'zip_base64 present');
});

let newOrgId = '';
await test('instantiate → sales organism + the two specialists materialize; Vainu/Alma deps unmet w/ build prompts', async () => {
  const { status, body } = await json('/v1/organism-templates/instantiate', { method: 'POST', headers: auth(token), body: JSON.stringify({ zip_base64: zipB64 }) });
  assert(status === 201, `instantiate ${status}: ${JSON.stringify(body.error)}`);
  newOrgId = body.data?.organism_id;
  assert(typeof newOrgId === 'string' && newOrgId !== orgId, 'a new sales organism');
  assert(body.data?.name === META.organism.name, `organism name "${META.organism.name}"`);
  assert((body.data?.workspaces || []).length >= 2, `both workspaces restored (${body.data?.workspaces?.length})`);

  // both specialists materialize
  const specs = (body.data?.specialists || []).map((s: any) => s.name).sort();
  assert(specs.join(',') === 'meeting-prep,sdr', `sdr + meeting-prep materialized: ${specs.join(',')}`);

  // Vainu + Alma deps surface as unmet, each with a build prompt naming the connector + the install tool.
  const unmet = (body.data?.unmet_extensions || []);
  const unmetNames = unmet.map((e: any) => e.name).sort();
  assert(unmetNames.join(',') === 'alma-connector,vainu-connector', `both connectors unmet: ${unmetNames.join(',')}`);
  for (const e of unmet) {
    assert(typeof e.build_prompt === 'string' && e.build_prompt.includes(e.name), `${e.name}: build prompt names the connector`);
    assert(/aimeat_extension_install/.test(e.build_prompt), `${e.name}: build prompt references the install tool`);
  }
});

await test('the SDR specialist has the brain from the reference template', async () => {
  const { status, body } = await json('/v1/specialists/sdr', { headers: auth(token) });
  assert(status === 200, `specialist ${status}`);
  assert(body.data?.specialist?.role === 'sdr', 'role sdr');
  assert(/qualify/i.test(body.data?.specialist?.brain?.purpose || ''), 'brain purpose from the template');
  assert((body.data?.specialist?.brain?.rules || []).some((r: any) => r.id === 'scout-first'), 'scout-first rule present');
});

await test('the new sales organism workspaces are content-free', async () => {
  const reg = await json(`/v1/memory/${encodeURIComponent(`organism.${newOrgId}.meta.workspaces`)}`, { headers: auth(token) });
  const wss = reg.body?.data?.value?.workspaces || [];
  assert(wss.length >= 2, 'both workspaces registered');
  const leadsWs = wss.find((w: any) => w.name === 'Leads') || wss[0];
  const r = await json(`/v1/organisms/${newOrgId}/workspace?ws=${leadsWs.id}`, { headers: auth(token) });
  assert(r.status === 200, `workspace read ${r.status}`);
  assert(r.body.data?.manifest?.name === 'Leads', 'Leads manifest restored');
  assert((r.body.data?.objects?.lead || []).length === 0, 'no lead records (content-free)');
});

await test('Cleanup', async () => { await json(`/v1/owners/${ownerName}`, { method: 'DELETE', headers: auth(token) }); });

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
process.exit(failed > 0 ? 1 : 0);
