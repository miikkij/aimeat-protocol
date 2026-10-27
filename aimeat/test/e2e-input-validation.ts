/**
 * @file e2e-input-validation.ts
 * @description The node refuses input it should not keep, and says which field and why: a value past
 *   its length limit, a control character in a name, a name of spaces only, a NUL character and a
 *   broken (lone surrogate) character anywhere in a body, the query or the path, on REST and on MCP.
 *   Each refusal is a 400 VALIDATION_ERROR whose `details` name the field, its code and its limit,
 *   in the caller's language. A valid write still works, and a second owner is still refused on
 *   another owner's organism (wish wish-sy-tteiden-validointi-pituusrajat-ja-roskan-torjunta-palveli).
 *   Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=input-validation
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial. Seen red on origin/main 8d3a2c696 (SQLite): 10 of 13 failed, the
 *     three positive controls passed; a 201-character name, a control character, a lone surrogate
 *     and NUL in the query were all stored or answered 200/201.
 */
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

/** `raw` sends the body text as given, so a lone surrogate escape reaches the server as written. */
async function call(path: string, opts: { method?: string; body?: unknown; raw?: string; headers?: Record<string, string> } = {}, retries = 5): Promise<{ status: number; body: any }> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      ...(opts.raw !== undefined ? { body: opts.raw } : opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    if (res.status === 429 && attempt < retries) { await sleep(2000); continue; }
    return { status: res.status, body };
  }
  throw new Error('unreachable');
}

/** The detail for `path` in a VALIDATION_ERROR answer. */
function detail(r: { body: any }, path: string): any {
  return (r.body?.error?.details ?? []).find((d: any) => d.path === path);
}

function refusedOn(r: { status: number; body: any }, path: string, code: string): any {
  assert(r.status === 400, `expected 400, got ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
  assert(r.body?.error?.code === 'VALIDATION_ERROR', `expected VALIDATION_ERROR, got ${r.body?.error?.code}`);
  const d = detail(r, path);
  assert(!!d, `no detail for "${path}": ${JSON.stringify(r.body?.error?.details)}`);
  assert(d.code === code, `"${path}" should be ${code}, got ${d.code}`);
  return d;
}

const stamp = Date.now();
let alice = { name: '', token: '' };
let bob = { name: '', token: '' };
const asAlice = () => ({ Authorization: `Bearer ${alice.token}` });
const asBob = () => ({ Authorization: `Bearer ${bob.token}` });
let orgId = '';

async function run() {
  console.log('\n=== AIMEAT Input Validation E2E ===\n');

  await test('Register two owners', async () => {
    const a = await registerOwner(BASE, `inval${stamp}a`);
    const b = await registerOwner(BASE, `inval${stamp}b`);
    alice = { name: a.name, token: a.token };
    bob = { name: b.name, token: b.token };
    assert(!!alice.token && !!bob.token, 'both owners should have a token');
  });

  await test('A name one character past its limit is refused, and the detail names the field and the limit', async () => {
    const r = await call('/v1/organisms', { method: 'POST', headers: asAlice(), body: { name: 'n'.repeat(201), visibility: 'private' } });
    const d = refusedOn(r, 'name', 'too_long');
    assert(d.max === 200, `the limit should be 200, got ${d.max}`);
    assert(typeof d.message === 'string' && d.message.includes('200'), `the message should say the limit: ${d.message}`);
  });

  await test('The same refusal reads in Finnish for a Finnish caller', async () => {
    const r = await call('/v1/organisms', { method: 'POST', headers: { ...asAlice(), Cookie: 'aimeat-lang=fi' }, body: { name: 'n'.repeat(201), visibility: 'private' } });
    const d = refusedOn(r, 'name', 'too_long');
    assert(d.message === 'Liian pitkä: enintään 200 merkkiä.', `Finnish message expected, got: ${d.message}`);
  });

  await test('A control character and a name of spaces only are refused by code', async () => {
    refusedOn(await call('/v1/organisms', { method: 'POST', headers: asAlice(), body: { name: 'bell\u0007name', visibility: 'private' } }), 'name', 'control_char');
    refusedOn(await call('/v1/organisms', { method: 'POST', headers: asAlice(), body: { name: '    ', visibility: 'private' } }), 'name', 'blank');
  });

  await test('A valid organism is created, as before', async () => {
    const r = await call('/v1/organisms', { method: 'POST', headers: asAlice(), body: { name: `Valid org ${stamp}`, description: 'Line one\nLine two\twith a tab', visibility: 'private' } });
    assert(r.status === 201 || r.status === 202, `create should succeed, got ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
    orgId = r.body.data?.organism?.id;
    assert(!!orgId, 'the answer should carry the organism id');
  });

  await test('An update with a too-long description is refused; a valid one is saved', async () => {
    refusedOn(await call(`/v1/organisms/${orgId}`, { method: 'PUT', headers: asAlice(), body: { description: 'd'.repeat(10_001) } }), 'description', 'too_long');
    const ok = await call(`/v1/organisms/${orgId}`, { method: 'PUT', headers: asAlice(), body: { description: 'A short description.' } });
    assert(ok.status === 200, `a valid update should be 200, got ${ok.status}: ${JSON.stringify(ok.body).slice(0, 300)}`);
  });

  await test('Another owner is still refused on the organism with a valid body', async () => {
    const r = await call(`/v1/organisms/${orgId}`, { method: 'PUT', headers: asBob(), body: { description: 'Not mine to change.' } });
    assert(r.status === 403, `another owner should get 403, got ${r.status}`);
  });

  await test('A NUL in a workspace draft write is a 400 naming the field, not a 500', async () => {
    const r = await call(`/v1/organisms/${orgId}/workspace/drafts`, { method: 'POST', headers: asAlice(), body: { ws: 'ws-x', items: [{ space: 'notes', value: { title: 'a\u0000b', markdown: 'x' } }] } });
    refusedOn(r, 'items.0.value.title', 'nul_byte');
  });

  await test('A lone surrogate in a body is refused as a broken character', async () => {
    const r = await call('/v1/organisms', { method: 'POST', headers: asAlice(), raw: '{"name":"broken \\ud800 name","visibility":"private"}' });
    refusedOn(r, 'name', 'invalid_unicode');
  });

  await test('A NUL in the query or the path is refused before any route runs', async () => {
    refusedOn(await call('/v1/organisms?type=%00', { headers: asAlice() }), 'query.type', 'nul_byte');
    refusedOn(await call('/v1/memory/abc%00def', { headers: asAlice() }), '', 'nul_byte');
  });

  await test('A profile with a too-long display name is refused; a valid one is saved', async () => {
    refusedOn(await call('/v1/ghii', { method: 'PUT', headers: asAlice(), body: { display_name: 'x'.repeat(201) } }), 'display_name', 'too_long');
    const ok = await call('/v1/ghii', { method: 'PUT', headers: asAlice(), body: { display_name: 'Alice Valid' } });
    assert(ok.status === 200, `a valid profile save should be 200, got ${ok.status}: ${JSON.stringify(ok.body).slice(0, 300)}`);
  });

  await test('A contact with a control character in its note is refused', async () => {
    const r = await call('/v1/contacts', { method: 'POST', headers: asAlice(), body: { name: 'Carol', email: `carol${stamp}@example.com`, note: 'esc\u001b[31m' } });
    refusedOn(r, 'note', 'control_char');
  });

  await test('MCP: a too-long name and a NUL are refused; a valid call works', async () => {
    const agent = await makeAgent(BASE, alice, ['organism:read', 'organism:write']);
    const s = await openSession(BASE, agent.token, 'e2e-input-validation');
    const long = await callTool(s, 'aimeat_organism_create', { name: 'n'.repeat(201), visibility: 'private' });
    assert(long.isError, `a 201-character name should be refused over MCP: ${long.text.slice(0, 300)}`);
    const nul = await callTool(s, 'aimeat_organism_create', { name: 'a\u0000b', visibility: 'private' });
    assert(nul.isError, `a NUL should be refused over MCP: ${nul.text.slice(0, 300)}`);
    assert(nul.text.includes('nul_byte'), `the refusal should name the reason: ${nul.text.slice(0, 300)}`);
    const ok = await callTool(s, 'aimeat_organism_create', { name: `MCP org ${stamp}`, visibility: 'private' });
    assert(!ok.isError, `a valid create over MCP should work: ${ok.text.slice(0, 300)}`);
  });

  console.log('\n' + '─'.repeat(48));
  console.log(`Input Validation E2E: ${passed} passed, ${failed} failed of ${passed + failed}`);
  if (failed > 0) process.exit(1);
  console.log('✅ All tests passed!\n');
}

run().catch(err => { console.error(err); process.exit(1); });
