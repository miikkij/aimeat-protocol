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

console.log('\nPhase 5 — a finding is not a fact');

// The workspace the app builds at setup, built here directly so the schema can be exercised
// server-side. Only the two spaces this phase needs; the app's manifest carries six.
let org = '';
let ws = '';
const NS_FACT = 'brain.fact';
const NS_FINDING = 'brain.finding';
const draftKey = (namespace: string, id: string): string => `organism.${org}.w.${ws}.${namespace}.${id}.draft`;

await test('18. the workspace locks a schema that refuses a claim with no address', async () => {
  const made = await json('/v1/organisms', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ name: 'Brain org', visibility: 'private' }),
  });
  assert(made.status === 201 || made.status === 200, `organism failed: ${made.status} ${JSON.stringify(made.body).slice(0, 200)}`);
  org = made.body.data?.id ?? made.body.data?.organism?.id;
  assert(org, `no organism id in ${JSON.stringify(made.body).slice(0, 200)}`);

  const wsRes = await json(`/v1/organisms/${encodeURIComponent(org)}/workspaces`, {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({
      name: 'Brain',
      manifest: {
        manifestVersion: '1.0', id: 'brain', name: 'Brain', kind: 'project', status: 'active',
        objectTypes: [
          { name: 'fact', namespace: NS_FACT, schemaRef: 'brain.fact', backing: 'memory', writeRole: 'member', mode: 'records', contract: 'brain' },
          { name: 'finding', namespace: NS_FINDING, schemaRef: 'brain.finding', backing: 'memory', writeRole: 'member', mode: 'records' },
        ],
      },
      schemas: {
        [NS_FACT]: {
          type: 'object', additionalProperties: true, required: ['id', 'claim', 'kind', 'as_of'],
          properties: {
            id: { type: 'string' }, claim: { type: 'string' },
            kind: { type: 'string', enum: ['anchored', 'observed'] },
            source_ref: { type: 'string' }, as_of: { type: 'string' }, review_after: { type: 'string' },
            note: { type: 'string' },
          },
        },
        [NS_FINDING]: {
          type: 'object', additionalProperties: true, required: ['id', 'claim', 'source_url', 'accessed'],
          properties: {
            id: { type: 'string' }, claim: { type: 'string' },
            source_url: { type: 'string' }, accessed: { type: 'string' },
            found_by: { type: 'string' }, status: { type: 'string', enum: ['new', 'promoted', 'discarded'] },
          },
        },
      },
    }),
  });
  assert(wsRes.status === 200 || wsRes.status === 201, `workspace failed: ${wsRes.status} ${JSON.stringify(wsRes.body).slice(0, 300)}`);
  ws = wsRes.body.data?.ws ?? wsRes.body.data?.id;
  assert(ws, `no ws id in ${JSON.stringify(wsRes.body).slice(0, 200)}`);
});

await test('19. a claim with no address is REFUSED, which is the whole point of the space', async () => {
  // The counter-example this schema was written against is the house's own market-scan: four
  // thousand words, no per-claim sources, one wrong price, published as settled. A research
  // agent that cannot say where something came from is producing that, and this refuses to
  // store it rather than storing it and hoping somebody notices.
  const r = await json('/v1/memory', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({
      key: draftKey(NS_FINDING, 'finding-bare'), visibility: 'private',
      value: { id: 'finding-bare', claim: 'Everyone is switching to weekly billing', accessed: '2026-08-23' },
    }),
  });
  assert(r.status === 400 || r.body?.ok === false,
    `a finding with no source_url must be refused, got ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
});

await test('20. a finding WITH an address is accepted, and it lands as a draft', async () => {
  const r = await json('/v1/memory', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({
      key: draftKey(NS_FINDING, 'finding-1'), visibility: 'private',
      value: {
        id: 'finding-1', claim: 'Villa Textiles moved to weekly billing in June',
        source_url: 'https://example.test/villa/pricing', accessed: '2026-08-23',
        found_by: 'research agent', status: 'new',
      },
    }),
  });
  assert(r.status === 200 || r.status === 201, `accepted finding refused: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  // A DRAFT, deliberately. An agent that could publish straight into what the company knows would
  // be deciding what is true on the owner's behalf.
  const read = await json(`/v1/memory/${encodeURIComponent(draftKey(NS_FINDING, 'finding-1'))}`, { headers: authed(A.token) });
  assert(read.status === 200, `the draft must be readable by its owner, got ${read.status}`);
});

await test('21. promoting writes an OBSERVED fact whose source is the address it came from', async () => {
  // What the app's promote button does, asserted at the level that survives a redesign: the claim
  // carries over, the address becomes the fact's source, the kind is observed (never anchored —
  // anchored means a document the owner holds), and it carries a date to look again.
  const factId = 'fact-from-finding';
  const wrote = await json('/v1/memory', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({
      key: draftKey(NS_FACT, factId), visibility: 'private',
      value: {
        id: factId, claim: 'Villa Textiles moved to weekly billing in June', kind: 'observed',
        source_ref: 'https://example.test/villa/pricing', as_of: '2026-08-23', review_after: '2027-02-19',
      },
    }),
  });
  assert(wrote.status === 200 || wrote.status === 201, `the promoted fact was refused: ${wrote.status} ${JSON.stringify(wrote.body).slice(0, 200)}`);

  const read = await json(`/v1/memory/${encodeURIComponent(draftKey(NS_FACT, factId))}`, { headers: authed(A.token) });
  const v = read.body.data?.value ?? read.body.data;
  assert(v?.kind === 'observed', `a promoted finding must never be anchored, got ${v?.kind}`);
  assert(v?.source_ref === 'https://example.test/villa/pricing', `the address did not carry over: ${v?.source_ref}`);
  assert(v?.review_after, 'an observed fact with no review date is one nobody set a life span for');
});

await test('22. an ANCHORED fact claiming a web address is still storable, and that is a judgement call the schema leaves open', async () => {
  // Deliberately not enforced. The schema cannot tell a URL the owner controls from one they do
  // not, and a rule that guessed would refuse somebody's own published price list. The promote
  // path is where the decision is made, and it always writes observed.
  const r = await json('/v1/memory', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({
      key: draftKey(NS_FACT, 'fact-anchored-url'), visibility: 'private',
      value: { id: 'fact-anchored-url', claim: 'Our own price list', kind: 'anchored', source_ref: 'https://example.test/us/prices', as_of: '2026-08-23' },
    }),
  });
  assert(r.status === 200 || r.status === 201, `the schema should allow this: ${r.status}`);
});

await test('23. a stranger cannot read this brain’s findings', async () => {
  const r = await json(`/v1/memory/${encodeURIComponent(draftKey(NS_FINDING, 'finding-1'))}`, { headers: authed(B.token) });
  assert(r.status === 403 || r.status === 404,
    `another owner must not read the findings, got ${r.status} ${JSON.stringify(r.body).slice(0, 150)}`);
});

console.log('\nPhase 5b — an agent proposes, the owner decides, and the queue empties');

await test('23b. an AGENT’s draft is consumed when its OWNER publishes the record', async () => {
  // THE DOCUMENTED PATTERN, end to end: an agent writes findings as drafts and the owner decides.
  // A draft is stored under whoever WROTE it, so this record has an agent-owned draft; the owner
  // then edits it (marking it promoted) and publishes. Until 2026-08-23 the publish consumed only
  // the freshest draft, the agent's survived, and a workspace read renders `draft || latest` — so
  // the record kept showing the agent's PRE-DECISION value with an undecided badge for good. The
  // owner's queue never emptied, however many times they decided.
  const agentTok = await makeAgent(A, ['memory:read', 'memory:write', 'organism:read']);
  const id = 'finding-two-drafts';

  const byAgent = await json('/v1/memory', {
    method: 'POST', headers: authed(agentTok),
    body: JSON.stringify({
      key: draftKey(NS_FINDING, id), visibility: 'private',
      value: { id, claim: 'Weekly billing is spreading', source_url: 'https://example.test/billing', accessed: '2026-08-23', status: 'new' },
    }),
  });
  assert(byAgent.status === 200 || byAgent.status === 201, `the agent could not propose: ${byAgent.status} ${JSON.stringify(byAgent.body).slice(0, 200)}`);

  // The owner decides: same record, now marked promoted, written under the OWNER's identity.
  const byOwner = await json('/v1/memory', {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({
      key: draftKey(NS_FINDING, id), visibility: 'private',
      value: { id, claim: 'Weekly billing is spreading', source_url: 'https://example.test/billing', accessed: '2026-08-23', status: 'promoted' },
    }),
  });
  assert(byOwner.status === 200 || byOwner.status === 201, `the owner could not decide: ${byOwner.status}`);

  const pub = await json(`/v1/organisms/${encodeURIComponent(org)}/publish`, {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ ws, namespace: NS_FINDING, id }),
  });
  assert(pub.status === 200, `publish failed: ${pub.status} ${JSON.stringify(pub.body).slice(0, 200)}`);

  // NO DRAFT LEFT ANYWHERE. Counted across the owner's own identities, which is where the second
  // copy lived and where a per-identity delete could not see it.
  const drafts = await json(`/v1/memory?include=meta&owner_scope=true&prefix=${encodeURIComponent(draftKey(NS_FINDING, id))}`,
    { headers: authed(A.token) });
  const left = (drafts.body.data?.items ?? []).length;
  assert(left === 0, `the owner decided and ${left} draft copy/copies survived — the queue never empties`);

  // …and what the record now SAYS is the decision, not the proposal.
  const latest = await json(`/v1/memory/${encodeURIComponent(`organism.${org}.w.${ws}.${NS_FINDING}.${id}.latest`)}`, { headers: authed(A.token) });
  const v = latest.body.data?.value ?? latest.body.data;
  assert(v?.status === 'promoted', `the published record must carry the decision, got ${JSON.stringify(v?.status)}`);
});

console.log('\nPhase 6 — the key budget, at the size the design says production reaches');

/** Publish a whole space in ONE request, the way an import does. */
async function bulkPublish(namespace: string, records: Array<{ id: string; value: unknown }>): Promise<number> {
  const r = await json(`/v1/organisms/${encodeURIComponent(org)}/workspace/records/publish`, {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ ws, namespace, records }),
  });
  assert(r.status === 200 || r.status === 201, `bulk publish failed: ${r.status} ${JSON.stringify(r.body).slice(0, 250)}`);
  return r.body.data?.published ?? records.length;
}

/**
 * How many keys this owner actually holds under one prefix.
 *
 * NO `count=true`, deliberately. That branch is CACHED for sixty seconds and it runs BEFORE the
 * meta branch, so `include=meta&count=true` is cached too — a before-and-after inside one test run
 * reads the same number twice and reports a growth of zero. This test printed exactly that, twice,
 * and it was believable both times: a budget measurement that cannot see the writes it just made
 * is the shape of check that certifies a store nobody looked at. `include=meta` alone returns
 * `total` from a live listing.
 */
async function keyCount(prefix?: string): Promise<number> {
  const qs = `?include=meta&owner_scope=true${prefix ? `&prefix=${encodeURIComponent(prefix)}` : ''}`;
  const r = await json(`/v1/memory${qs}`, { headers: authed(A.token) });
  const d = r.body.data ?? r.body;
  return Number(d?.total ?? (Array.isArray(d?.items) ? d.items.length : 0));
}

await test('24. a brain at the design’s stated size stays inside the 1000-key budget', async () => {
  // THE NUMBER THE DESIGN COMMITTED TO: 200 facts, 100 findings and a year of caretaker reports.
  // Measured rather than reasoned about, because the shape rule here has a history: a 941-key
  // article store sat next to a working 448 kB single key in the same namespace, and nobody noticed
  // until somebody counted.
  // Measured per SPACE and summed. The workspace-root prefix answers 5 for a store that holds
  // hundreds, because the owner-scope meta listing does not treat it as a plain string prefix — a
  // shorter prefix returning fewer rows than a longer one is the tell, and a budget measured
  // through it would report a clean bill for a store it never looked at.
  const spaceKeys = async (): Promise<number> =>
    (await keyCount(`organism.${org}.w.${ws}.${NS_FACT}.`)) + (await keyCount(`organism.${org}.w.${ws}.${NS_FINDING}.`));
  const before = await spaceKeys();

  const facts = Array.from({ length: 200 }, (_, i) => ({
    id: `bulk-fact-${i}`,
    value: {
      id: `bulk-fact-${i}`, claim: `Measured claim number ${i}`,
      kind: i % 3 === 0 ? 'observed' : 'anchored', as_of: '2026-08-23',
      ...(i % 3 === 0 ? { review_after: '2027-02-19' } : {}),
    },
  }));
  const findings = Array.from({ length: 100 }, (_, i) => ({
    id: `bulk-finding-${i}`,
    value: {
      id: `bulk-finding-${i}`, claim: `Something found number ${i}`,
      source_url: `https://example.test/found/${i}`, accessed: '2026-08-23', status: 'new',
    },
  }));

  await bulkPublish(NS_FACT, facts);
  await bulkPublish(NS_FINDING, findings);

  const after = await spaceKeys();
  const factKeys = await keyCount(`organism.${org}.w.${ws}.${NS_FACT}.`);
  const perRecord = (after - before) / 300;

  // The records have to BE somewhere. A budget test that measures the wrong keyspace reports a
  // clean bill for a store it never looked at — and the first version of this test did exactly
  // that, printing a growth of zero because the no-prefix owner listing does not include workspace
  // keys at all.
  assert(factKeys >= 200, `the 200 published facts must be keys under this workspace, counted ${factKeys}`);

  console.log(`      before ${before} · after ${after} · 300 records → ${after - before} keys (${perRecord.toFixed(1)} per record) · facts alone ${factKeys}`);

  // TWO KEYS PER PUBLISHED RECORD, not one: the live `.latest` and the `.version.1` beside it. That
  // is the floor, and it is not tunable — maxVersions caps how many versions a record KEEPS, and a
  // record published once already has one. So the design's stated size costs about 700 keys of the
  // default 1000, not 350. It fits, with less room than the plan assumed.
  assert(perRecord <= 2.5, `expected about two keys per published record, measured ${perRecord.toFixed(2)}`);
  assert(after < 1000,
    `a brain this size must fit the default 1000-key ceiling, and it took ${after}. ` +
    'If this fails, the shape is wrong and the per-item keys belong in a per-period record.');
});

await test('24b. settled findings can be cleared, which is what keeps the ceiling reachable', async () => {
  // The one space that grows without an owner deciding anything is findings: an agent that looks
  // every week writes every week. At two keys each they are the fastest road to the ceiling, and a
  // finding that has been promoted or discarded has already done its job — the fact it became
  // carries the address it came from.
  const before = await keyCount(`organism.${org}.w.${ws}.${NS_FINDING}.`);
  const ids = Array.from({ length: 40 }, (_, i) => `bulk-finding-${i}`);
  const r = await json(`/v1/organisms/${encodeURIComponent(org)}/workspace/records/delete`, {
    method: 'POST', headers: authed(A.token),
    body: JSON.stringify({ ws, namespace: NS_FINDING, ids }),
  });
  assert(r.status === 200, `clearing settled findings failed: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  const after = await keyCount(`organism.${org}.w.${ws}.${NS_FINDING}.`);
  const gone = (await json(`/v1/memory/${encodeURIComponent(`organism.${org}.w.${ws}.${NS_FINDING}.bulk-finding-0.latest`)}`, { headers: authed(A.token) })).status;
  console.log(`      cleared 40 findings · finding keys ${before} → ${after} · a cleared one now reads ${gone} · route said ${JSON.stringify(r.body.data ?? r.body).slice(0, 120)}`);
  // The record is GONE from the space, which is the contract that matters: the owner cleared it and
  // it no longer comes back on a read. Whether its version history is reclaimed at the same moment
  // is the version-pruning job's business, not this feature's, so this asserts the read and reports
  // the key count rather than asserting a number this feature does not own.
  assert(gone === 404 || gone === 403, `a cleared finding must stop reading back, got ${gone}`);
});

await test('25. the caretaker’s own records do not grow with time or with the number of sources', async () => {
  // The register is ONE key holding every source, and the report is ONE key overwritten each run.
  // That is the difference between a brain that lasts a year and one that fills its owner's
  // keyspace: a weekly report written as its own key is 52 keys a year, per brain, forever.
  const before = await keyCount(`ext:${extName}`);
  for (let i = 0; i < 12; i++) {
    await callBrain(A.token, {
      op: 'put_source',
      source: { id: `bulk-source-${i}`, kind: 'web', cadence_days: 7, coverage_note: `Only slice ${i}.` },
    });
  }
  for (let i = 0; i < 5; i++) await callBrain(A.token, { op: 'sweep' });
  const after = await keyCount(`ext:${extName}`);
  assert(after === before,
    `twelve more sources and five more weekly checks must add no keys at all, but the count went ${before} -> ${after}`);
  const state = await callBrain(A.token, { op: 'state' });
  assert(state.sources.length >= 12, `the sources are still there: ${state.sources.length}`);
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);
