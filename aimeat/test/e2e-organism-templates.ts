// E2E test — Use-case templates (Secretary P5 / S-B)
//
// Verifies the template format + instantiate flow:
//  - export an organism as a use-case template → a CONTENT-FREE skeleton (workspace structure/schema/
//    purpose, no objects/images) + a top-level template.json (specialists + extension deps);
//  - instantiate the template → a NEW organism + its (empty) workspaces + the specialists materialize;
//  - extension dependencies are checked — installed ones are met, missing ones are REPORTED (not a crash).
//
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=organism-templates

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { unzipBuffer } from '../src/services/workspace-import.js';

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

console.log('\n=== AIMEAT Use-case Templates E2E (S-B) ===\n');

let token = '', ownerName = '', orgId = '';
const WS = 'ws-tpl1';

// ─── Setup: owner + org + a workspace with a manifest, a locked schema, and one record ───
await test('Setup owner + org + workspace (manifest + schema + record)', async () => {
  ownerName = `tplowner${Date.now()}`;
  const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: ownerName, display_name: 'Tpl Owner', password: 'TplOwner1234' }) });
  assert(reg.status === 201, `ghii ${reg.status}`);
  const ts = new Date().toISOString();
  const tk = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: ownerName, timestamp: ts, signature: await sign(reg.body.data.private_key, ownerName + NODE_ID + ts) }) });
  token = tk.body.data.token;
  const o = await json('/v1/organisms', { method: 'POST', headers: auth(token), body: JSON.stringify({ name: 'Sales Hub', type: 'project', join_policy: 'open', visibility: 'public' }) });
  assert(o.status === 201, `org ${o.status}: ${JSON.stringify(o.body.error)}`);
  orgId = o.body.data.organism.id;
  await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Leads', createdAt: ts, createdBy: ownerName }] }, visibility: 'private' }) });
  const manifest = { manifestVersion: '1.0', id: orgId, name: 'Leads', kind: 'project', status: 'active', objectTypes: [
    { name: 'lead', schemaRef: 'schema:lead@1', namespace: 'shared.leads', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'records' },
  ] };
  await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: `organism.${orgId}.w.${WS}.meta.manifest`, value: manifest, visibility: 'private' }) });
  await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: `organism.${orgId}.w.${WS}.meta.readme`, value: '# Leads\nQualify B2B leads here.', visibility: 'private' }) });
  const sr = await json(`/v1/memory/${encodeURIComponent(`organism.${orgId}.w.${WS}.shared.leads`)}/schema`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ schema: { type: 'object', required: ['id', 'company'], properties: { id: { type: 'string' }, company: { type: 'string' } } }, apply_to: 'prefix', schema_mode: 'strict' }) });
  assert(sr.status === 200 || sr.status === 201, `schema ${sr.status}`);
  // one published record — proves the template SKELETON strips content.
  await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: `organism.${orgId}.w.${WS}.shared.leads.l1.latest`, value: { id: 'l1', company: 'Acme Oy' }, visibility: 'private' }) });
});

// ─── Install one extension so the dep-check has a MET dep to distinguish from the unmet one ───
await test('install a "present-ext" extension (a met dependency)', async () => {
  const manifest = [
    'extension: "1.0"', 'metadata:', '  name: present-ext', '  version: "1.0.0"',
    '  description: "present"', '  author: test', 'required_apis:', '  - memory',
    'actions:', '  - id: echo', '    method: POST', '    path: "/v1/ext/present-ext/echo"', '    script: "echo.js"',
    'limits:', '  memory_mb: 16', '  timeout_ms: 2000', '  max_api_calls: 10', 'federation:', '  advertise: false', '',
  ].join('\n');
  const { status } = await json('/v1/extensions', { method: 'POST', headers: auth(token), body: JSON.stringify({ manifest, scripts: { 'echo.js': 'export default async function(ctx,input){ return { ok: true }; }' } }) });
  assert(status === 201, `install present-ext ${status}`);
});

// ─── 1. Export as a template (skeleton + template.json) ───
let zipB64 = '';
await test('POST /v1/organism-templates/export — returns a template ZIP (base64)', async () => {
  const { status, body } = await json('/v1/organism-templates/export', {
    method: 'POST', headers: auth(token),
    body: JSON.stringify({
      org_id: orgId, title: 'B2B Sales Hub', description: 'SDR + meeting-prep sales organism.',
      specialists: [
        { name: 'sdr', role: 'sdr', brain: { purpose: 'Find and qualify B2B leads.', rules: [{ description: 'Scout existing resources before building.' }] } },
        { name: 'meeting-prep', role: 'prep' },
      ],
      extensions: [
        { name: 'present-ext', reason: 'echo' },
        { name: 'vainu-connector', reason: 'Finnish company data' },
      ],
      scopePresets: { sdr: ['social:read'] },
    }),
  });
  assert(status === 200, `export ${status}: ${JSON.stringify(body.error)}`);
  assert(typeof body.data?.zip_base64 === 'string' && body.data.zip_base64.length > 0, 'zip_base64 present');
  assert(body.data?.workspaces >= 1, 'reports >=1 workspace');
  zipB64 = body.data.zip_base64;
});

// ─── 2. Inspect the ZIP — content-free skeleton + template.json ───
await test('template ZIP is a content-free skeleton + template.json', async () => {
  const files = await unzipBuffer(Buffer.from(zipB64, 'base64'));
  assert(files.has('organism.json'), 'organism.json present');
  assert(files.has('template.json'), 'template.json present');
  const orgJson = JSON.parse(files.get('organism.json')!.toString('utf8'));
  assert(orgJson.skeleton === true, 'organism.json marked skeleton');
  // workspace.json: structure kept (manifest + schemas), content stripped (objects/images empty).
  const wsEntry = [...files.keys()].find(k => /^workspaces\/.+\/workspace\.json$/.test(k));
  assert(!!wsEntry, 'a workspace.json is present');
  const wsJson = JSON.parse(files.get(wsEntry!)!.toString('utf8'));
  assert(Array.isArray(wsJson.objects) && wsJson.objects.length === 0, `objects stripped (got ${wsJson.objects?.length})`);
  assert(Array.isArray(wsJson.images) && wsJson.images.length === 0, `images stripped (got ${wsJson.images?.length})`);
  assert(!!wsJson.manifest, 'manifest kept (structure)');
  assert(Object.keys(wsJson.schemas || {}).length >= 1, 'locked schema kept');
  // No image binary entries at all (safe to publish).
  assert(![...files.keys()].some(k => /\/images\//.test(k)), 'no image binaries in the ZIP');
  // template.json carries the specialists + extension deps.
  const tpl = JSON.parse(files.get('template.json')!.toString('utf8'));
  assert(tpl.aimeatTemplate === '1.0', 'template version');
  assert((tpl.specialists || []).map((s: any) => s.name).sort().join(',') === 'meeting-prep,sdr', 'specialists carried');
  assert((tpl.extensions || []).map((e: any) => e.name).includes('vainu-connector'), 'extension dep carried');
});

// ─── 3. Instantiate → new org + workspaces + specialists; unmet dep reported ───
let newOrgId = '';
await test('POST /v1/organism-templates/instantiate — org + workspaces + specialists materialize', async () => {
  const { status, body } = await json('/v1/organism-templates/instantiate', {
    method: 'POST', headers: auth(token), body: JSON.stringify({ zip_base64: zipB64 }),
  });
  assert(status === 201, `instantiate ${status}: ${JSON.stringify(body.error)}`);
  newOrgId = body.data?.organism_id;
  assert(typeof newOrgId === 'string' && newOrgId !== orgId, 'new org id, different from source');
  assert((body.data?.workspaces || []).length >= 1, `>=1 workspace restored (${body.data?.workspaces?.length})`);
  const specList = (body.data?.specialists || []);
  const specNames = specList.map((s: any) => s.name).sort();
  assert(specNames.join(',') === 'meeting-prep,sdr', `both specialists materialized: ${specNames.join(',')}`);
  // (e) scope-consent: a template never grants requested EXTRAS silently. sdr's role declares extras
  // (workflow:write, social:read) → they are REPORTED (requested_scopes) but NOT in the granted scopes.
  const sdrSpec = specList.find((s: any) => s.name === 'sdr');
  assert(Array.isArray(sdrSpec?.scopes) && !sdrSpec.scopes.includes('workflow:write') && !sdrSpec.scopes.includes('social:read'),
    `sdr provisioned conservatively (no extras granted): ${JSON.stringify(sdrSpec?.scopes)}`);
  const reqScopes = (sdrSpec?.requested_scopes || []).map((x: any) => x.scope).sort();
  assert(reqScopes.includes('workflow:write') && reqScopes.includes('social:read'),
    `sdr's requested extras reported for consent: ${JSON.stringify(sdrSpec?.requested_scopes)}`);
  assert((sdrSpec?.requested_scopes || []).every((x: any) => typeof x.description === 'string' && x.description.length > 0),
    'each requested extra carries a plain-language description');
  // dep-check: the missing connector is REPORTED, the installed one is NOT (and it did not crash).
  const unmet = (body.data?.unmet_extensions || []);
  const unmetNames = unmet.map((e: any) => e.name);
  assert(unmetNames.includes('vainu-connector'), 'missing connector reported as unmet');
  assert(!unmetNames.includes('present-ext'), 'installed extension is met (not reported)');
  assert(JSON.stringify(body.data?.scope_presets) === JSON.stringify({ sdr: ['social:read'] }), 'scope presets carried through');
  // S-D: every unmet dep carries a self-heal BUILD PROMPT (paste to Claude Code → builds + installs it).
  const vainu = unmet.find((e: any) => e.name === 'vainu-connector');
  assert(typeof vainu?.build_prompt === 'string' && vainu.build_prompt.length > 80, 'unmet dep carries a build prompt');
  assert(vainu.build_prompt.includes('vainu-connector'), 'build prompt names the connector');
  assert(/aimeat_extension_install/.test(vainu.build_prompt), 'build prompt references the appdev MCP install tool');
  assert(/type:\s*secret/.test(vainu.build_prompt), 'build prompt encodes the secret-config pattern');
});

await test('the instantiated organism has the (empty) workspace with its manifest', async () => {
  const insp = await json(`/v1/organisms/${newOrgId}/workspace?ws=`, { headers: auth(token) });
  // /workspace needs a ws id — get it from the instantiate result via a fresh list of the org's workspaces.
  const reg = await json(`/v1/memory/${encodeURIComponent(`organism.${newOrgId}.meta.workspaces`)}`, { headers: auth(token) });
  const wss = reg.body?.data?.value?.workspaces || [];
  assert(wss.length >= 1, 'workspace registered in the new org');
  const r = await json(`/v1/organisms/${newOrgId}/workspace?ws=${wss[0].id}`, { headers: auth(token) });
  assert(r.status === 200, `workspace read ${r.status}`);
  assert(r.body.data?.manifest?.name === 'Leads', 'manifest restored (structure)');
  const leads = r.body.data?.objects?.lead || [];
  assert(leads.length === 0, `workspace is content-free (got ${leads.length} records)`);
  void insp;
});

await test('the SDR specialist materialized with its own brain', async () => {
  const { status, body } = await json('/v1/specialists/sdr', { headers: auth(token) });
  assert(status === 200, `specialist get ${status}`);
  assert(body.data?.specialist?.role === 'sdr', 'role sdr');
  assert(body.data?.specialist?.brain?.purpose === 'Find and qualify B2B leads.', 'brain from template');
});

// ─── 4. S-D: publish the template → it is discoverable via /v1/discover ───
await test('S-D: publish template + it appears in /v1/discover (type "template")', async () => {
  const exp = await json('/v1/organism-templates/export', {
    method: 'POST', headers: auth(token),
    body: JSON.stringify({
      org_id: orgId, title: 'B2B Sales Hub', description: 'SDR + meeting-prep sales organism.',
      specialists: [{ name: 'sdr', role: 'sdr' }, { name: 'meeting-prep', role: 'prep' }],
      extensions: [{ name: 'vainu-connector', reason: 'Finnish company data' }],
      tags: ['sales', 'b2b'], publish: true,
    }),
  });
  assert(exp.status === 200, `export+publish ${exp.status}: ${JSON.stringify(exp.body.error)}`);
  assert(typeof exp.body.data?.published?.key === 'string' && exp.body.data.published.key.startsWith('template.catalog.'), 'published to catalog');

  // public scope surfaces it as a 'template'
  const pub = await json('/v1/discover?scope=public&type=template&per_page=100', { headers: auth(token) });
  assert(pub.status === 200, `discover ${pub.status}`);
  const hit = (pub.body.data?.entries || []).find((e: any) => e.title === 'B2B Sales Hub');
  assert(!!hit, 'published template appears in /v1/discover (public scope)');
  assert(hit.type === 'template', `classified as template, got ${hit?.type}`);
  assert((hit.tags || []).includes('sales'), 'tags carried into discovery');

  // free-text query also finds it
  const q = await json('/v1/discover?scope=public&q=Sales%20Hub&per_page=100', { headers: auth(token) });
  assert((q.body.data?.entries || []).some((e: any) => e.title === 'B2B Sales Hub'), 'found by free-text query');

  // owner's own scope sees their published template too
  const own = await json('/v1/discover?scope=own&type=template&per_page=100', { headers: auth(token) });
  assert((own.body.data?.entries || []).some((e: any) => e.title === 'B2B Sales Hub'), 'appears in own scope');
});

// ─── 5. Failure mode: a non-ZIP / empty body is rejected, not a crash ───
await test('instantiate with no body → 400 (not a crash)', async () => {
  const { status } = await json('/v1/organism-templates/instantiate', { method: 'POST', headers: auth(token), body: JSON.stringify({}) });
  assert(status === 400, `status ${status}`);
});

await test('Cleanup', async () => { await json(`/v1/owners/${ownerName}`, { method: 'DELETE', headers: auth(token) }); });

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
process.exit(failed > 0 ? 1 : 0);
