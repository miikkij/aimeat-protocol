/**
 * @file e2e-company-brain.ts
 * @description E2E for the COMPANY BRAIN package (TARGET-071): installing it, and the caretaker
 *   that keeps its source register honest.
 *
 *   WHAT THIS PROVES THAT A UNIT TEST CANNOT. The package is three components that only mean
 *   anything once the installer has registered them under one owner and rewritten the app's short
 *   names to the per-instance ones. So every assertion here runs against a real install: the
 *   extension is invoked over its own HTTP action route, the way the cortex lib invokes it from a
 *   browser, and the app's content is read back from the app catalogue the way a visitor is served.
 *
 *   THE CARETAKER COSTS NOTHING, AND THAT IS TESTABLE. Its sweep is a `kind: extension` action with
 *   no model call in it, so this suite runs the same code the weekly schedule runs and asserts the
 *   verdicts rather than trusting the description. A source that has never delivered is late; one
 *   carrying an error is broken; a one-off import is neither, forever.
 *
 *   TWO COMPANIES, TWO BRAINS is asserted by installing twice and comparing the registered names.
 *   That is the claim the whole package shape rests on, and it costs one extra install to prove.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=company-brain
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial (TARGET-071).
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const GROUP = 'company-brain::system';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); passed++; console.log(`✅ ${name}`); }
  catch (e) { failed++; console.log(`❌ ${name}: ${(e as Error).message}`); }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    });
    if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1200)); continue; }
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = { _raw: text }; }
    return { status: res.status, body };
  }
}

(ed as any).hashes.sha512 = (...msgs: Uint8Array[]) => {
  const h = createHash('sha512');
  for (const m of msgs) h.update(m);
  return new Uint8Array(h.digest());
};
async function signMsg(privB64: string, msg: string): Promise<string> {
  const sig = await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'));
  return Buffer.from(sig).toString('base64');
}

const authed = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

async function makeOwner(name: string): Promise<{ token: string; owner: string }> {
  const owner = `${name}${Date.now().toString(36).slice(-6)}`;
  for (let attempt = 0; ; attempt++) {
    const reg = await json('/v1/ghii', {
      method: 'POST',
      body: JSON.stringify({ username: owner, display_name: owner, password: 'BrainTest1234' }),
    });
    if (reg.status === 429 && attempt < 8) { await new Promise((r) => setTimeout(r, 1500)); continue; }
    assert(reg.status === 201, `registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
    const privKey = reg.body.data.private_key as string;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(privKey, owner + NODE_ID + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner, timestamp, signature }) });
    assert(tok.status === 200, `token failed: ${tok.status}`);
    return { token: tok.body.data.token as string, owner };
  }
}

/** An agent token carrying exactly the scopes named, for the fences at the end. */
async function makeAgent(ownerCtx: { token: string; owner: string }, scopes: string[]): Promise<string> {
  const name = `brainag${Date.now().toString(36).slice(-5)}`;
  const reg = await json('/v1/agents', {
    method: 'POST', headers: authed(ownerCtx.token),
    body: JSON.stringify({ name, owner: ownerCtx.owner, scopes }),
  });
  assert(reg.status === 201, `agent registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
  const gaii = reg.body.data.agent.gaii as string;
  const privKey = reg.body.data.private_key as string;
  const timestamp = new Date().toISOString();
  const signature = await signMsg(privKey, gaii + timestamp);
  const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature }) });
  assert(tok.status === 200, `agent token failed: ${tok.status}`);
  return tok.body.data.token as string;
}

console.log('═══ E2E: company brain package ═══');
console.log(`Base: ${BASE}`);

const A = await makeOwner('brain');
const B = await makeOwner('brainb');

let extName = '';
let appName = '';
let cortexName = '';
let firstComponents: string[] = [];

/** POST one action on the installed caretaker, the way the cortex lib does from a browser. */
async function callBrain(token: string, body: Record<string, unknown>): Promise<any> {
  const r = await json(`/v1/ext/${encodeURIComponent(extName)}/admin`, {
    method: 'POST', headers: authed(token), body: JSON.stringify(body),
  });
  const data = r.body?.data ?? r.body;
  return (data && typeof data === 'object' && 'result' in data) ? data.result : data;
}

console.log('\nPhase 1 — the package ships with the node');

await test('1. company-brain is in the catalogue, seeded at boot, published', async () => {
  const r = await json(`/v1/packages/${encodeURIComponent(GROUP)}`, { headers: authed(A.token) });
  assert(r.status === 200, `not in the catalogue: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  assert(r.body.data?.status === 'published', `expected published, got ${r.body.data?.status}`);
  const ids = (r.body.data?.components ?? []).map((c: any) => c.id).sort();
  assert(JSON.stringify(ids) === JSON.stringify(['app-brain.html', 'cortex-brain', 'ext-brain']),
    `unexpected components: ${JSON.stringify(ids)}`);
});

await test('2. there is no memory component, so a second install cannot overwrite the first', async () => {
  const r = await json(`/v1/packages/${encodeURIComponent(GROUP)}`, { headers: authed(A.token) });
  const types = (r.body.data?.components ?? []).map((c: any) => c.type);
  assert(!types.includes('memory'),
    'a memory component writes to author-chosen keys with no per-instance id in them, so two installs would collide');
});

console.log('\nPhase 2 — installing gives the owner their own copy');

await test('3. a dry run says what it would register and registers nothing', async () => {
  const r = await json(`/v1/packages/${encodeURIComponent(GROUP)}/install`, {
    method: 'POST', headers: authed(A.token), body: JSON.stringify({ label: 'Dry', dry_run: true }),
  });
  assert(r.status === 200, `dry run failed: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  assert(Array.isArray(r.body.data?.installOrder), 'expected an install order');
  const list = await json('/v1/instances', { headers: authed(A.token) });
  assert(!(list.body.data?.instances ?? []).some((i: any) => i.label === 'Dry'), 'a dry run must leave nothing behind');
});

await test('4. installing registers all three under the owner', async () => {
  const r = await json(`/v1/packages/${encodeURIComponent(GROUP)}/install`, {
    method: 'POST', headers: authed(A.token), body: JSON.stringify({ label: 'Acme brain' }),
  });
  assert(r.status === 201, `install failed: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  const comps = r.body.data?.installedComponents ?? [];
  assert(comps.length === 3, `expected 3 components, got ${comps.length}`);
  firstComponents = comps.map((c: any) => c.registeredAs).sort();
  extName = comps.find((c: any) => c.type === 'extension')?.registeredAs ?? '';
  appName = comps.find((c: any) => c.type === 'app')?.registeredAs ?? '';
  cortexName = comps.find((c: any) => c.type === 'cortex')?.registeredAs ?? '';
  assert(extName && appName && cortexName, `missing a registered name in ${JSON.stringify(comps)}`);
});

await test('5. the app installs under a filename an app origin recognises', async () => {
  // Two other gates decide "is this an app" by looking for .html on the filename: the publish-time
  // subdomain provisioning and the app-host path form. Without it the brain has no address at all.
  assert(appName.endsWith('.html'), `an app component must end in .html, got ${appName}`);
  const r = await json(`/v1/apps/${encodeURIComponent(A.owner)}/${encodeURIComponent(appName)}`, { headers: authed(A.token) });
  assert(r.status === 200, `the installed app must be readable: ${r.status}`);
});

await test('6. the app was rewritten to its own instance names, not the author’s short ones', async () => {
  // Served as HTML, not as a JSON envelope: this is the same road a browser takes.
  const res = await fetch(`${BASE}/v1/apps/${encodeURIComponent(A.owner)}/${encodeURIComponent(appName)}`);
  const html = await res.text();
  assert(res.status === 200, `expected 200 serving the brain app, got ${res.status}`);
  assert(html.includes(`/v1/cortex/${cortexName}/`),
    `the app does not point at this instance's cortex (${cortexName})`);
  // The author's short name would 404 for every installer but the author, and it would do it
  // silently: the page renders and AIMEAT.brain is simply undefined.
  assert(!html.includes('/v1/cortex/company-brain/libs/'),
    'the author short name survived the rewrite');
});

await test('7. a second install is a separate brain, sharing nothing with the first', async () => {
  const r = await json(`/v1/packages/${encodeURIComponent(GROUP)}/install`, {
    method: 'POST', headers: authed(A.token), body: JSON.stringify({ label: 'Second company brain' }),
  });
  assert(r.status === 201, `second install failed: ${r.status}`);
  const second = (r.body.data?.installedComponents ?? []).map((c: any) => c.registeredAs).sort();
  assert(second.length === 3, `expected 3 components, got ${second.length}`);
  for (const name of second) {
    assert(!firstComponents.includes(name),
      `the two installs share a component name (${name}) — one company would overwrite the other`);
  }
});

console.log('\nPhase 3 — the caretaker, at zero tokens');

await test('8. the register starts empty and readable, not missing', async () => {
  const out = await callBrain(A.token, { op: 'state' });
  assert(out?.ok === true, `state refused: ${JSON.stringify(out).slice(0, 200)}`);
  assert(Array.isArray(out.sources) && out.sources.length === 0, `expected an empty register, got ${JSON.stringify(out.sources)}`);
  assert(out.report === null, 'nothing has been checked yet, so there is no report');
});

await test('9. a source keeps what it does not cover, and that field survives a round trip', async () => {
  const put = await callBrain(A.token, {
    op: 'put_source',
    source: {
      id: 'bank-statements', kind: 'upload', ref: 'camt.053',
      feeds: 'What money moved, and to whom.',
      coverage_note: 'Says nothing about why, or about anything unpaid.',
      cadence_days: 30,
    },
  });
  assert(put?.ok === true, `put_source refused: ${JSON.stringify(put).slice(0, 200)}`);
  const out = await callBrain(A.token, { op: 'state' });
  const s = (out.sources ?? []).find((x: any) => x.id === 'bank-statements');
  assert(s, 'the source is not in the register');
  assert(s.coverage_note.includes('unpaid'), `the coverage note was lost: ${JSON.stringify(s)}`);
});

await test('10. a source that has never delivered is late, and the report says which one', async () => {
  const out = await callBrain(A.token, { op: 'sweep' });
  assert(out?.ok === true, `sweep refused: ${JSON.stringify(out).slice(0, 200)}`);
  assert(out.report.late === 1, `expected one quiet source, got ${JSON.stringify(out.report)}`);
  assert(out.report.lines.some((l: string) => l.includes('bank-statements')),
    `the report must name the source, not just count it: ${JSON.stringify(out.report.lines)}`);
});

await test('11. delivering restarts the clock, and the next check is quiet about it', async () => {
  const touched = await callBrain(A.token, { op: 'touch_source', id: 'bank-statements' });
  assert(touched?.ok === true, `touch refused: ${JSON.stringify(touched).slice(0, 200)}`);
  const out = await callBrain(A.token, { op: 'sweep' });
  assert(out.report.late === 0 && out.report.broken === 0, `expected all clear, got ${JSON.stringify(out.report)}`);
});

await test('12. a failure is broken rather than late, and it is named', async () => {
  await callBrain(A.token, { op: 'touch_source', id: 'bank-statements', error: 'the bank refused the login' });
  const out = await callBrain(A.token, { op: 'sweep' });
  assert(out.report.broken === 1, `expected one broken source, got ${JSON.stringify(out.report)}`);
  assert(out.report.lines.some((l: string) => l.includes('refused the login')),
    `the reason must survive into the report: ${JSON.stringify(out.report.lines)}`);
});

await test('13. a one-off import is never late, however long ago it was', async () => {
  await callBrain(A.token, {
    op: 'put_source',
    source: { id: 'founding-documents', kind: 'upload', cadence_days: 0, coverage_note: 'Only what was true at founding.' },
  });
  const out = await callBrain(A.token, { op: 'sweep' });
  const s = (await callBrain(A.token, { op: 'state' })).sources.find((x: any) => x.id === 'founding-documents');
  assert(s.status === 'ok', `a source that does not repeat cannot be overdue, got ${s.status}`);
  assert(out.report.checked === 2, `expected both sources looked at, got ${out.report.checked}`);
});

await test('14. a source with no coverage note is named, not silently accepted', async () => {
  await callBrain(A.token, { op: 'put_source', source: { id: 'hearsay', kind: 'chat', cadence_days: 0 } });
  const out = await callBrain(A.token, { op: 'sweep' });
  assert(out.report.lines.some((l: string) => l.includes('no coverage note') && l.includes('hearsay')),
    `an unwritten limit is how one source becomes "everything we know": ${JSON.stringify(out.report.lines)}`);
  await callBrain(A.token, { op: 'remove_source', id: 'hearsay' });
});

console.log('\nPhase 4 — the fences');

await test('15. another owner cannot read or touch this brain', async () => {
  const read = await callBrain(B.token, { op: 'state' });
  assert(read?.ok === false, `a stranger must be refused, got ${JSON.stringify(read).slice(0, 200)}`);
  const write = await callBrain(B.token, { op: 'put_source', source: { id: 'theirs', kind: 'web' } });
  assert(write?.ok === false, 'a stranger must not be able to write the register');
  const still = await callBrain(A.token, { op: 'state' });
  assert(!(still.sources ?? []).some((s: any) => s.id === 'theirs'), 'the stranger’s write landed anyway');
});

await test('16. the register is private, so the ext namespace does not leak it', async () => {
  // An `ext:` namespace is world-readable by default. A company's list of what it does not know is
  // not a public document, so every record this extension writes asks for private explicitly.
  const r = await json(`/v1/memory/public/${encodeURIComponent('ext:' + extName)}/sources`);
  assert(r.status === 404 || r.body?.ok === false,
    `the source register must not be readable without a session, got ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
});

await test('17. the caretaker is unreachable without a session, and installing needs its own word', async () => {
  // No session at all. A brain reachable anonymously would hand a passer-by the list of what a
  // company does not know, which is the one part of this nobody would publish on purpose.
  const anon = await json(`/v1/ext/${encodeURIComponent(extName)}/admin`, {
    method: 'POST', body: JSON.stringify({ op: 'state' }),
  });
  assert(anon.status === 401, `an anonymous caller must get 401, got ${anon.status}`);

  // A session, but not this permission. Installing registers an app, a cortex, an extension and any
  // cron the manifest declares, all under the owner's identity, so it asks for `packages:write` by
  // name rather than riding whatever scope the owner happened to approve.
  const narrow = await makeAgent(A, ['memory:read']);
  const r = await json(`/v1/packages/${encodeURIComponent(GROUP)}/install`, {
    method: 'POST', headers: authed(narrow), body: JSON.stringify({ label: 'Should not exist' }),
  });
  assert(r.status === 403, `an agent without packages:write must get 403, got ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  const list = await json('/v1/instances', { headers: authed(A.token) });
  assert(!(list.body.data?.instances ?? []).some((i: any) => i.label === 'Should not exist'),
    'the refused install left an instance behind');
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);
