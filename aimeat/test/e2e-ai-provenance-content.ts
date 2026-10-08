/**
 * @file e2e-ai-provenance-content.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description AI provenance on the content surfaces (aiprov workstream E, 2026-10-08): memory,
 *   workspaces and their shares, the Design Book, knowledge packages, skills, site passages and
 *   comments. Each fix has its happy path and a failure mode, over real HTTP:
 *     E1  an open workspace share serves each item's record, sends the headers on one page, and the
 *         record resolves anonymously and by hash; a document the share keeps back stays 404
 *     E2  a Design Book part keeps its record when its status changes
 *     E3  the batch records publish stamps an agent's records and takes a record's own declaration
 *     E4  a memory object's record is found by the hash of its canonical JSON, and a backup restores
 *         its record although the store reordered the keys (the Postgres case)
 *     E5  an agent's PATCH into its owner's records (owner_scope) is stamped as the agent's
 *     E6  an owner's PUT over its agent's record is a person's writing and is not stamped
 *     E7  POST /v1/memory takes the declaration inline, owner_scope included, and refuses one the
 *         caller may not make before anything is stored
 *     E8  a REST comment is stamped, takes a declaration, and the thread names each record
 *     E9  a portal passage's record resolves for a visitor; one id for two passages is refused
 *     E10 a knowledge import stamps the manifest and every entry
 *     E11 an in-place edit that mixes a person's text and a model's is `assisted`
 *     E12 a skill publish records how SKILL.md was written
 *     E13 a workspace document's record describes its markdown
 *     E14 memory list and search name each item's record; a company description is minted for the
 *         owner's surface
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (aiprov workstream E).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-ai-provenance-content
import { createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const stamp = Date.now();

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  PASS ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
async function call(path: string, opts: { token?: string; body?: unknown; method?: string } = {}): Promise<{ status: number; body: Body; headers: Headers }> {
  const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    signal: AbortSignal.timeout(30_000),
  });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() as Body : { _raw: await res.text() };
  return { status: res.status, body, headers: res.headers };
}
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

async function sign(priv: string, message: string): Promise<string> {
  return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(priv, 'base64'))).toString('base64');
}
async function owner(label: string): Promise<{ name: string; token: string; ghii: string }> {
  const name = `prov${label}${stamp}`;
  const reg = await call('/v1/ghii', { body: { username: name, display_name: name, password: 'ProvContent1234' } });
  assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body.error)}`);
  const ts = new Date().toISOString();
  const tok = await call('/v1/auth/token', { body: { owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE + ts) } });
  assert(tok.status === 200, `token ${name}: ${tok.status}`);
  return { name, token: tok.body.data.token, ghii: `${name}@${NODE}` };
}
async function agent(o: { name: string; token: string }, name: string, scopes: string[]): Promise<{ gaii: string; token: string }> {
  const a = await call('/v1/agents', { token: o.token, body: { owner: o.name, name, capabilities: ['memory'], scopes } });
  assert(a.status === 201, `agent ${name}: ${a.status} ${JSON.stringify(a.body.error)}`);
  const gaii = a.body.data.agent.gaii as string;
  const ts = new Date().toISOString();
  const tok = await call('/v1/auth/token', { body: { gaii, timestamp: ts, signature: await sign(a.body.data.private_key, gaii + ts) } });
  assert(tok.status === 200, `agent token ${name}: ${tok.status}`);
  return { gaii, token: tok.body.data.token };
}
/** The owner's newest records (GET /v1/ai-transparency/mine), the newest first. */
async function mine(token: string): Promise<Body[]> {
  const r = await call('/v1/ai-transparency/mine', { token });
  assert(r.status === 200, `mine: ${r.status}`);
  return r.body.data.recent.items as Body[];
}
async function record(id: string, token?: string): Promise<{ status: number; body: Body }> {
  return call(`/v1/provenance/${id}`, { token });
}

console.log('\n=== AI provenance on the content surfaces (workstream E) ===\n');

let op!: Awaited<ReturnType<typeof owner>>;
let A!: Awaited<ReturnType<typeof owner>>;
let B!: Awaited<ReturnType<typeof owner>>;
let plain!: { gaii: string; token: string };     // no provenance:write
let declarer!: { gaii: string; token: string };  // holds provenance:write
const BASE_SCOPES = ['memory:read', 'memory:write', 'memory:write-as-owner', 'organism:read', 'organism:write', 'company:read', 'company:write'];

await test('setup: the operator (first account), owner A with two agents, owner B', async () => {
  op = await owner('op');
  A = await owner('a');
  B = await owner('b');
  plain = await agent(A, 'plainbot', BASE_SCOPES);
  declarer = await agent(A, 'declarebot', [...BASE_SCOPES, 'provenance:write']);
});

// ── E4: the canonical hash ───────────────────────────────────────────────────────────────────────
console.log('\nE4 — a memory object is found by the hash of its canonical JSON');
const written = { zebra: 1, alpha: { yak: 2, bee: [1, { z: 0, a: 1 }] } };
const canonical = '{"alpha":{"bee":[1,{"a":1,"z":0}],"yak":2},"zebra":1}';

await test('E4 an agent\'s public object value is found anonymously by the hash of its canonical JSON', async () => {
  const w = await call('/v1/memory', { token: plain.token, body: { key: 'e4.obj', value: written, visibility: 'public' } });
  assert(w.status === 201, `write: ${w.status} ${JSON.stringify(w.body.error)}`);
  const id = w.body.data.ai_provenance_id as string;
  assert(typeof id === 'string' && id, `the write names no record: ${JSON.stringify(w.body.data)}`);
  const found = await call(`/v1/provenance/by-hash/${sha(canonical)}`);
  assert(found.status === 200, `by-hash: ${found.status}`);
  assert((found.body.data.records as Body[]).some(r => r.id === id),
    `the canonical hash does not find the record: ${JSON.stringify(found.body.data)}`);
});

await test('E4 a backup restores its record although the store handed the keys back in its own order', async () => {
  const exp = await call('/v1/memory/export?prefix=e4.obj', { token: plain.token });
  assert(exp.status === 200, `export: ${exp.status}`);
  const entry = (exp.body.data.entries as Body[]).find(e => e.key === 'e4.obj');
  assert(entry?.ai_provenance_id, `export carries no record: ${JSON.stringify(exp.body.data.entries)}`);
  const imp = await call('/v1/memory/import', { token: plain.token, body: { mode: 'overwrite', entries: [{ key: 'e4.restored', value: entry.value, ai_provenance_id: entry.ai_provenance_id }] } });
  assert(imp.status === 200, `import: ${imp.status} ${JSON.stringify(imp.body.error)}`);
  const back = await call('/v1/memory/e4.restored', { token: plain.token });
  assert(back.body.data.ai_provenance_id === entry.ai_provenance_id,
    `the restore lost its record (${back.body.data.ai_provenance_id} vs ${entry.ai_provenance_id})`);
});

await test('E4 a record minted with the as-written hash still restores (old records keep working)', async () => {
  const asWritten = JSON.stringify(written);
  const dec = await call('/v1/provenance', { token: A.token, body: { level: 'ai-generated', humanInvolvement: 'none', content: asWritten } });
  assert(dec.status === 201, `declare: ${dec.status} ${JSON.stringify(dec.body.error)}`);
  const imp = await call('/v1/memory/import', { token: A.token, body: { mode: 'overwrite', entries: [{ key: 'e4.legacy', value: written, ai_provenance_id: dec.body.data.id }] } });
  assert(imp.status === 200, `import: ${imp.status}`);
  const back = await call('/v1/memory/e4.legacy', { token: A.token });
  assert(back.body.data.ai_provenance_id === dec.body.data.id, `the legacy hash no longer matches: ${back.body.data.ai_provenance_id}`);
});

await test('E4 → a record about different content is not restored onto a value', async () => {
  const exp = await call('/v1/memory/export?prefix=e4.obj', { token: plain.token });
  const entry = (exp.body.data.entries as Body[]).find(e => e.key === 'e4.obj')!;
  await call('/v1/memory/import', { token: plain.token, body: { mode: 'overwrite', entries: [{ key: 'e4.other', value: { zebra: 2 }, ai_provenance_id: entry.ai_provenance_id }] } });
  const back = await call('/v1/memory/e4.other', { token: plain.token });
  assert(back.status === 200 && back.body.data.ai_provenance_id !== entry.ai_provenance_id, 'a record about other bytes was attached');
});

// ── E5 / E6 / E7: the writer, not the namespace ──────────────────────────────────────────────────
console.log('\nE5–E7 — the record names who wrote, wherever it lands');

await test('E5 an agent\'s owner_scope PATCH is stamped as the agent\'s', async () => {
  const p = await call('/v1/memory/e5.patched', { token: plain.token, method: 'PATCH', body: { patch: { note: 'from the agent' }, owner_scope: true } });
  // The key is absent, so the PATCH creates it: 201.
  assert(p.status === 201, `patch: ${p.status} ${JSON.stringify(p.body.error)}`);
  const r = await call('/v1/memory/e5.patched', { token: A.token });
  assert(r.status === 200, `owner read: ${r.status}`);
  const rec = r.body.meta?.provenance?.record;
  assert(rec?.level === 'ai-generated' && rec?.generator?.principal === plain.gaii,
    `the owner-scope patch carries no agent stamp: ${JSON.stringify(r.body.meta?.provenance ?? null)}`);
});

await test('E5 → the owner\'s own PATCH is a person\'s writing: no record', async () => {
  const p = await call('/v1/memory/e5.owner', { token: A.token, method: 'PATCH', body: { patch: { note: 'mine' } } });
  assert(p.status === 201, `patch: ${p.status}`);
  const r = await call('/v1/memory/e5.owner', { token: A.token });
  assert(!r.body.data.ai_provenance_id, `an owner's patch was stamped: ${r.body.data.ai_provenance_id}`);
});

await test('E6 the owner\'s PUT over its agent\'s record is not stamped as the agent\'s', async () => {
  const w = await call('/v1/memory', { token: plain.token, body: { key: 'e6.rec', value: { by: 'agent' } } });
  assert(w.status === 201, `agent write: ${w.status}`);
  const u = await call('/v1/memory/e6.rec', { token: A.token, method: 'PUT', body: { value: { by: 'the person' }, version: w.body.data.version } });
  assert(u.status === 200, `owner put: ${u.status} ${JSON.stringify(u.body.error)}`);
  const r = await call('/v1/memory/e6.rec', { token: plain.token });
  assert(r.body.data.value?.by === 'the person', `the edit did not land: ${JSON.stringify(r.body.data.value)}`);
  assert(!r.body.data.ai_provenance_id, `the owner's words carry a record: ${JSON.stringify(r.body.meta?.provenance?.record?.generator ?? null)}`);
});

await test('E6 → the agent\'s own PUT is still stamped as the agent\'s', async () => {
  const cur = await call('/v1/memory/e6.rec', { token: plain.token });
  const u = await call('/v1/memory/e6.rec', { token: plain.token, method: 'PUT', body: { value: { by: 'agent again' }, version: cur.body.data.version } });
  assert(u.status === 200, `agent put: ${u.status}`);
  const r = await call('/v1/memory/e6.rec', { token: plain.token });
  assert(r.body.meta?.provenance?.record?.generator?.principal === plain.gaii, 'the agent edit lost its stamp');
});

await test('E7 POST /v1/memory records an inline declaration on an owner_scope write', async () => {
  const w = await call('/v1/memory', { token: declarer.token, body: {
    key: 'e7.relayed', value: { brief: 'A person wrote this.' }, owner_scope: true,
    ai_provenance: { level: 'original', human_involvement: 'full-human' },
  } });
  assert(w.status === 201, `write: ${w.status} ${JSON.stringify(w.body.error)}`);
  assert(w.body.data.owner_gaii === A.ghii, `landed under ${w.body.data.owner_gaii}`);
  const echo = w.body.data.ai_provenance;
  assert(echo?.recorded === true && echo.level === 'original' && echo.principal === declarer.gaii,
    `the answer does not say what was recorded: ${JSON.stringify(echo ?? w.body.data)}`);
  const r = await call('/v1/memory/e7.relayed', { token: A.token });
  assert(r.body.meta?.provenance?.record?.level === 'original', `stored: ${JSON.stringify(r.body.meta?.provenance ?? null)}`);
});

await test('E7 → a declaration the caller may not make is refused 403 and nothing is stored', async () => {
  const w = await call('/v1/memory', { token: plain.token, body: {
    key: 'e7.refused', value: { x: 1 }, ai_provenance: { level: 'original', human_involvement: 'full-human' },
  } });
  assert(w.status === 403 && w.body.error?.code === 'SCOPE_DENIED', `expected 403 SCOPE_DENIED, got ${w.status} ${JSON.stringify(w.body.error)}`);
  assert((await call('/v1/memory/e7.refused', { token: plain.token })).status === 404, 'the refused write was stored');
  const bad = await call('/v1/memory', { token: declarer.token, body: { key: 'e7.bad', value: 1, ai_provenance: { level: 'hand-made-by-elves' } } });
  assert(bad.status === 400, `a malformed block answered ${bad.status}`);
});

await test('E7 → another owner\'s record id is not attached, and the answer says so', async () => {
  const dec = await call('/v1/provenance', { token: B.token, body: { level: 'ai-generated', humanInvolvement: 'none', content: 'B\'s text' } });
  assert(dec.status === 201, `B declares: ${dec.status}`);
  const w = await call('/v1/memory', { token: declarer.token, body: { key: 'e7.foreign', value: 'B\'s text', ai_provenance_id: dec.body.data.id } });
  assert(w.status === 201, `write: ${w.status}`);
  assert(w.body.data.ai_provenance_id !== dec.body.data.id, 'another owner\'s record was attached');
  assert(w.body.data.ai_provenance?.recorded === false, `the answer claims it attached: ${JSON.stringify(w.body.data.ai_provenance)}`);
});

// ── E14: per-item ids on list and search, the company surface ────────────────────────────────────
console.log('\nE14 — list and search name each record; a company description is minted for its owner');

await test('E14 GET /v1/memory and /v1/memory/search name each item\'s record (null when unstated)', async () => {
  await call('/v1/memory', { token: A.token, body: { key: 'e14.plain', value: 'searchable e14 person text' } });
  const list = await call('/v1/memory?prefix=e7.relayed', { token: A.token });
  const item = (list.body.data.items as Body[]).find(i => i.key === 'e7.relayed');
  assert(typeof item?.ai_provenance_id === 'string', `the listing names no record: ${JSON.stringify(item)}`);
  const meta = await call('/v1/memory?prefix=e14.&include=meta', { token: A.token });
  const plainItem = (meta.body.data.items as Body[]).find(i => i.key === 'e14.plain');
  assert(plainItem && plainItem.ai_provenance_id === null, `an unstated item must say null: ${JSON.stringify(plainItem)}`);
  const found = await call('/v1/memory/search?q=e14', { token: A.token });
  const hit = (found.body.data.results as Body[]).find(r => r.key === 'e14.plain');
  assert(hit && 'ai_provenance_id' in hit, `the search hit names nothing: ${JSON.stringify(hit)}`);
});

await test('E14 a company description\'s record is minted for the owner\'s surface, and it stays private', async () => {
  const c = await call('/v1/companies', { token: A.token, body: {
    name: `Prov Co ${stamp}`, description: 'A model wrote this description.',
    ai_provenance: { level: 'ai-generated', model: 'test/model' },
  } });
  assert(c.status === 201, `company: ${c.status} ${JSON.stringify(c.body.error)}`);
  const id = c.body.data.company.descriptionProvenanceId as string;
  assert(typeof id === 'string' && id.length > 0, `no record: ${JSON.stringify(c.body.data.company)}`);
  const own = await record(id, A.token);
  assert(own.status === 200, `owner resolve: ${own.status}`);
  assert(own.body.data.provenance.disclosure?.required === false,
    `minted as if public: ${JSON.stringify(own.body.data.provenance.disclosure)}`);
  assert((await record(id)).status === 404, 'a company description record resolves for a visitor');
});

// ── E2: the Design Book status change ─────────────────────────────────────────────────────────────
console.log('\nE2 — a Design Book part keeps its record across a status change');
const PART = `prov-part-${stamp}`;
const GOOD_BODY = {
  v: 1, look: 'editorial',
  blocks: [
    { id: 'top', component: 'hero', props: { title: '<App name>', sub: '<One line on what it is>' } },
    { id: 'items', component: 'list', props: { source: '<prefix>.items' }, span: 'main' },
  ],
};
let partRecord = '';

await test('E2 an agent\'s part is stamped and its record resolves while the part is public', async () => {
  const p = await call('/v1/designbook', { token: plain.token, body: { part: { id: PART, kind: 'fill', title: 'Prov fill', summary: 'A cover over a list, proposed by an agent.', body: GOOD_BODY } } });
  assert(p.status === 201, `propose: ${p.status} ${JSON.stringify(p.body.error)}`);
  partRecord = (await mine(A.token)).find(r => r.pipeline === 'design-book.propose')?.id ?? '';
  assert(partRecord.length > 0, 'the propose minted no record');
  assert((await record(partRecord)).status === 200, 'the public part\'s record does not resolve');
});

await test('E2 retiring the part keeps its record', async () => {
  const s = await call(`/v1/designbook/${PART}/status`, { token: plain.token, body: { status: 'retired' } });
  assert(s.status === 200, `retire: ${s.status} ${JSON.stringify(s.body.error)}`);
  assert((await record(partRecord)).status === 200, 'the status change erased the part\'s record');
});

await test('E2 → another owner cannot change the part\'s status (403), and the record stays', async () => {
  const s = await call(`/v1/designbook/${PART}/status`, { token: B.token, body: { status: 'retired' } });
  assert(s.status === 403, `another owner: ${s.status}`);
  assert((await record(partRecord)).status === 200, 'the record went away');
});

// ── A workspace for E1, E3, E8, E11, E13 ──────────────────────────────────────────────────────────
let orgId = '';
let ws = '';
const pageKey = (id: string, role: string) => `organism.${orgId}.w.${ws}.shared.pages.${id}.${role}`;
await test('setup: an organism of A with a document space and a records space', async () => {
  const o = await call('/v1/organisms', { token: A.token, body: { name: `Prov Org ${stamp}`, description: 'x', type: 'project', join_policy: 'approval_required', visibility: 'private' } });
  assert(o.status === 201, `organism: ${o.status} ${JSON.stringify(o.body.error)}`);
  orgId = o.body.data.organism.id;
  const w = await call(`/v1/organisms/${orgId}/workspaces`, { token: A.token, body: { name: 'Handbook', manifest: {
    manifestVersion: '1', name: 'Handbook', kind: 'project',
    objectTypes: [
      { name: 'page', namespace: 'shared.pages', mode: 'document', backing: 'memory', writeRole: 'member', schemaRef: 'schema:page@1' },
      { name: 'item', namespace: 'shared.items', mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: 'schema:item@1' },
    ],
  } } });
  assert(w.status === 201, `workspace: ${w.status} ${JSON.stringify(w.body.error)}`);
  ws = w.body.data.ws;
});

// ── E13 + E1 ─────────────────────────────────────────────────────────────────────────────────────
console.log('\nE13 + E1 — a shared document, its markdown hash and its record');
const MARKDOWN = `# Shared page ${stamp}\n\nA model drafted this page.`;
let pageRecord = '';
let keptRecord = '';

await test('E13 an agent\'s document draft is recorded against its markdown, and the owner publishes it', async () => {
  for (const [id, md] of [['d1', MARKDOWN], ['d2', `# Kept back ${stamp}\n\nNot shared.`]] as const) {
    const d = await call(`/v1/organisms/${orgId}/workspace/drafts`, { token: plain.token, body: { ws, space: 'page', id, value: { title: id, markdown: md } } });
    assert(d.status === 200, `draft ${id}: ${d.status} ${JSON.stringify(d.body.error)}`);
    const p = await call(`/v1/organisms/${orgId}/publish`, { token: A.token, body: { ws, namespace: 'shared.pages', id } });
    assert(p.status === 200, `publish ${id}: ${p.status} ${JSON.stringify(p.body.error)}`);
  }
  const latest = await call(`/v1/memory/${encodeURIComponent(pageKey('d1', 'latest'))}`, { token: A.token });
  pageRecord = latest.body.data.ai_provenance_id;
  keptRecord = (await call(`/v1/memory/${encodeURIComponent(pageKey('d2', 'latest'))}`, { token: A.token })).body.data.ai_provenance_id;
  assert(pageRecord && keptRecord, `published pages carry no record: ${JSON.stringify(latest.body.data)}`);
  const own = await record(pageRecord, A.token);
  assert(own.body.data.content_hash === `sha256:${sha(MARKDOWN)}`, `the record describes ${own.body.data.content_hash}, not the markdown`);
});

await test('E1 → before anything is shared, the page\'s record is 404 for a visitor', async () => {
  assert((await record(pageRecord)).status === 404, 'a private page\'s record resolves');
});

await test('E1 an open share serves the page with its record, headers on one page, and the record resolves', async () => {
  const s = await call(`/v1/organisms/${orgId}/workspace/share?ws=${ws}`, { token: A.token, method: 'PUT', body: { spaces: { page: true }, docs: { 'page/d2': false } } });
  assert(s.status === 200, `share: ${s.status} ${JSON.stringify(s.body.error)}`);
  const list = await call(`/v1/organisms/${orgId}/workspace/public/documents?ws=${ws}`);
  assert(list.status === 200, `public documents: ${list.status}`);
  const doc = (list.body.data.documents as Body[]).find(d => d.id === 'd1');
  assert(doc?.ai_provenance?.id === pageRecord && doc.ai_provenance.record?.spec === 'aimeat.provenance/v1',
    `the shared page carries no record: ${JSON.stringify(doc)}`);
  assert(!('aiProvenanceId' in doc), 'the internal field leaked into the answer');
  const one = await call(`/v1/organisms/${orgId}/workspace/public/document?ws=${ws}&type=page&id=d1`);
  assert(one.status === 200, `public document: ${one.status}`);
  assert((one.headers.get('link') ?? '').includes(`/v1/provenance/${pageRecord}`), `no Link header: ${one.headers.get('link')}`);
  assert(one.headers.get('ai-disclosure'), 'no AI-Disclosure header');
  assert(one.body.meta?.provenance?.id === pageRecord, 'no meta.provenance');
  const md = await fetch(`${BASE}/v1/organisms/${orgId}/workspace/public/document?ws=${ws}&type=page&id=d1&format=md`);
  assert((md.headers.get('link') ?? '').includes(pageRecord), 'the markdown format sends no Link header');
  assert((await record(pageRecord)).status === 200, 'the shared page\'s record does not resolve for a visitor');
  const byHash = await call(`/v1/provenance/by-hash/${sha(MARKDOWN)}`);
  assert((byHash.body.data.records as Body[]).some(r => r.id === pageRecord), `by-hash does not find the shared page: ${JSON.stringify(byHash.body.data)}`);
});

await test('E1 → a page the share keeps back stays 404, and so does a share behind a password', async () => {
  assert((await record(keptRecord)).status === 404, 'the kept-back page\'s record resolves');
  const s = await call(`/v1/organisms/${orgId}/workspace/share?ws=${ws}`, { token: A.token, method: 'PUT', body: { access: 'password', password: 'secret-pass' } });
  assert(s.status === 200, `password share: ${s.status}`);
  assert((await record(pageRecord)).status === 404, 'a password share made the record public');
  const back = await call(`/v1/organisms/${orgId}/workspace/share?ws=${ws}`, { token: A.token, method: 'PUT', body: { access: 'open' } });
  assert(back.status === 200, `reopen: ${back.status}`);
});

// ── E8: comments ─────────────────────────────────────────────────────────────────────────────────
console.log('\nE8 — a REST comment carries a record');

await test('E8 an agent\'s REST comment is stamped and the thread names the record', async () => {
  const c = await call(`/v1/organisms/${orgId}/comments`, { token: plain.token, body: { ws, space: 'page', instance_id: 'd1', body: 'An agent comment.' } });
  assert(c.status === 201, `comment: ${c.status} ${JSON.stringify(c.body.error)}`);
  const id = c.body.data.ai_provenance_id;
  assert(typeof id === 'string' && id, `the comment names no record: ${JSON.stringify(c.body.data)}`);
  const thread = await call(`/v1/organisms/${orgId}/comments?ws=${ws}&space=page&instance_id=d1`, { token: A.token });
  const listed = JSON.stringify(thread.body.data);
  assert(listed.includes(id), `the thread does not name the record: ${listed.slice(0, 400)}`);
});

await test('E8 a declared comment is recorded as declared', async () => {
  const c = await call(`/v1/organisms/${orgId}/comments`, { token: declarer.token, body: {
    ws, space: 'page', instance_id: 'd1', body: 'Relayed from a person.', ai_provenance: { level: 'original', human_involvement: 'full-human' },
  } });
  assert(c.status === 201, `comment: ${c.status} ${JSON.stringify(c.body.error)}`);
  assert(c.body.data.ai_provenance?.recorded === true && c.body.data.ai_provenance.level === 'original',
    `not recorded as declared: ${JSON.stringify(c.body.data.ai_provenance)}`);
});

await test('E8 → a declaration the agent may not make is 403 and no comment lands; B is refused 403', async () => {
  const c = await call(`/v1/organisms/${orgId}/comments`, { token: plain.token, body: {
    ws, space: 'page', instance_id: 'd1', body: 'REFUSED-E8', ai_provenance: { level: 'original' },
  } });
  assert(c.status === 403, `expected 403, got ${c.status}`);
  const thread = await call(`/v1/organisms/${orgId}/comments?ws=${ws}&space=page&instance_id=d1`, { token: A.token });
  assert(!JSON.stringify(thread.body.data).includes('REFUSED-E8'), 'the refused comment landed');
  const other = await call(`/v1/organisms/${orgId}/comments`, { token: B.token, body: { ws, space: 'page', instance_id: 'd1', body: 'B' } });
  assert(other.status === 403, `another owner commented: ${other.status}`);
});

// ── E11: in-place edits ──────────────────────────────────────────────────────────────────────────
console.log('\nE11 — an edit that mixes a person\'s text with a model\'s is assisted');
async function draftRecord(id: string): Promise<Body | null> {
  const r = await call(`/v1/memory/${encodeURIComponent(pageKey(id, 'draft'))}`, { token: A.token });
  return r.body.meta?.provenance ?? null;
}
async function append(token: string, id: string, markdown: string) {
  const r = await call(`/v1/organisms/${orgId}/workspace/documents/page/${id}/append?ws=${ws}`, { token, body: { markdown } });
  assert(r.status === 200, `append ${id}: ${r.status} ${JSON.stringify(r.body.error)}`);
}

await test('E11 an agent\'s line in a person\'s document makes it assisted, not ai-generated', async () => {
  const d = await call(`/v1/organisms/${orgId}/workspace/drafts`, { token: A.token, body: { ws, space: 'page', id: 'd3', value: { title: 'Mine', markdown: '# Mine\n\nA person wrote this.' } } });
  assert(d.status === 200, `owner draft: ${d.status}`);
  assert(!(await draftRecord('d3')), 'an owner draft was stamped');
  await append(plain.token, 'd3', 'An agent added this line.');
  const p = await draftRecord('d3');
  assert(p?.record?.level === 'assisted', `the whole document reads ${p?.record?.level ?? 'unstated'}`);
});

await test('E11 a person\'s line in an agent\'s document keeps the model\'s part on record (assisted, derived)', async () => {
  const d = await call(`/v1/organisms/${orgId}/workspace/drafts`, { token: plain.token, body: { ws, space: 'page', id: 'd4', value: { title: 'Model', markdown: '# Model\n\nA model wrote this.' } } });
  assert(d.status === 200, `agent draft: ${d.status}`);
  const before = await draftRecord('d4');
  assert(before?.record?.level === 'ai-generated', `agent draft: ${JSON.stringify(before?.record?.level)}`);
  await append(A.token, 'd4', 'A person added this.');
  const after = await draftRecord('d4');
  assert(after?.record?.level === 'assisted' && (after.record.derivedFrom ?? []).includes(before.id),
    `the person's edit dropped the model's record: ${JSON.stringify(after?.record ?? null)}`);
});

await test('E11 → an agent editing its own document stays ai-generated', async () => {
  const d = await call(`/v1/organisms/${orgId}/workspace/drafts`, { token: plain.token, body: { ws, space: 'page', id: 'd6', value: { title: 'Model', markdown: '# Model only' } } });
  assert(d.status === 200, `agent draft: ${d.status}`);
  await append(plain.token, 'd6', 'More from the model.');
  assert((await draftRecord('d6'))?.record?.level === 'ai-generated', 'a model\'s own edit was relabelled');
});

// ── E3: the batch records publish ────────────────────────────────────────────────────────────────
console.log('\nE3 — the batch records publish records provenance');

await test('E3 an agent\'s direct records are stamped, and a record\'s own declaration is honoured', async () => {
  const a = await call(`/v1/organisms/${orgId}/workspace/records/publish`, { token: plain.token, body: { ws, namespace: 'shared.items', records: [{ id: 'r1', value: { name: 'from the agent' } }] } });
  assert(a.status === 200 && a.body.data.published === 1, `publish: ${a.status} ${JSON.stringify(a.body.data ?? a.body.error)}`);
  const b = await call(`/v1/organisms/${orgId}/workspace/records/publish`, { token: declarer.token, body: { ws, namespace: 'shared.items', records: [
    { id: 'r2', value: { name: 'typed by a person' }, ai_provenance: { level: 'original', human_involvement: 'full-human' } },
  ] } });
  assert(b.status === 200 && b.body.data.published === 1, `declared publish: ${b.status} ${JSON.stringify(b.body.data ?? b.body.error)}`);
  const read = await call(`/v1/organisms/${orgId}/workspace/records?ws=${ws}&space=item`, { token: A.token });
  assert(read.status === 200, `member read: ${read.status}`);
  const rows = read.body.data.records as Body[];
  const r1 = rows.find(r => r.id === 'r1');
  const r2 = rows.find(r => r.id === 'r2');
  assert(r1?.ai_provenance?.record?.level === 'ai-generated' && r1.ai_provenance.record.generator?.principal === plain.gaii,
    `r1 carries no agent stamp: ${JSON.stringify(r1)}`);
  assert(r2?.ai_provenance?.record?.level === 'original', `r2 is not recorded as declared: ${JSON.stringify(r2)}`);
});

await test('E3 → a declaration the agent may not make refuses the batch 403 and nothing is published', async () => {
  const a = await call(`/v1/organisms/${orgId}/workspace/records/publish`, { token: plain.token, body: { ws, namespace: 'shared.items', records: [
    { id: 'r3', value: { name: 'refused' }, ai_provenance: { level: 'original' } },
  ] } });
  assert(a.status === 403 && a.body.error?.code === 'SCOPE_DENIED', `expected 403 SCOPE_DENIED, got ${a.status} ${JSON.stringify(a.body.error ?? a.body.data)}`);
  const read = await call(`/v1/organisms/${orgId}/workspace/records?ws=${ws}&space=item`, { token: A.token });
  assert(!(read.body.data.records as Body[]).some(r => r.id === 'r3'), 'the refused record was published');
});

// ── E10: knowledge import ────────────────────────────────────────────────────────────────────────
console.log('\nE10 — a knowledge import stamps the manifest and every entry');

await test('E10 an agent\'s import is stamped on the manifest and on each entry', async () => {
  const r = await call('/v1/knowledge/import', { token: plain.token, body: { package: {
    name: `prov-pack-${stamp}`, content_type: 'document',
    synthesis: { level: 'ai-generated', description: 'Summarised by a model.' },
    entries: [{ key: 'facts', title: 'Facts', visibility: 'owner', value: { text: 'A fact.' } }],
  } } });
  assert(r.status === 201, `import: ${r.status} ${JSON.stringify(r.body.error)}`);
  const manifest = await call(`/v1/memory/${encodeURIComponent(r.body.data.manifest_key)}`, { token: plain.token });
  assert(manifest.body.data.ai_provenance_id, 'the manifest carries no record');
  const entry = await call(`/v1/memory/${encodeURIComponent(`packages/${r.body.data.package_id}/facts`)}`, { token: plain.token });
  assert(entry.status === 200, `entry read: ${entry.status}`);
  assert(entry.body.meta?.provenance?.record?.generator?.principal === plain.gaii, `the entry is unstated: ${JSON.stringify(entry.body.meta ?? null)}`);
});

await test('E10 → an explicit declaration the agent may not make is 403 and no package is stored', async () => {
  const before = await call('/v1/memory?prefix=packages/&include=meta', { token: plain.token });
  const r = await call('/v1/knowledge/import', { token: plain.token, body: {
    package: { name: `prov-refused-${stamp}`, content_type: 'document', entries: [{ key: 'x', title: 'X', value: { t: 1 } }] },
    ai_provenance: { level: 'original', human_involvement: 'full-human' },
  } });
  assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body.error)}`);
  const after = await call('/v1/memory?prefix=packages/&include=meta', { token: plain.token });
  assert(after.body.data.total === before.body.data.total, 'the refused import stored records');
});

// ── E12: skills ──────────────────────────────────────────────────────────────────────────────────
console.log('\nE12 — a skill publish records how SKILL.md was written');
const skillMd = (name: string) => `---\nname: ${name}\ndescription: A test skill for the provenance suite. Use when testing.\n---\n\n# ${name}\n\nSteps.\n`;

await test('E12 an agent\'s skill is stamped and the answer names the record', async () => {
  const r = await call('/v1/skills', { token: plain.token, body: { skill_md: skillMd(`prov-skill-${stamp}`) } });
  assert(r.status === 201, `publish: ${r.status} ${JSON.stringify(r.body.error)}`);
  const id = r.body.data.ai_provenance_id;
  assert(typeof id === 'string' && r.body.data.skill?.aiProvenanceId === id, `no record: ${JSON.stringify(r.body.data)}`);
  const own = await record(id, A.token);
  assert(own.body.data.content_hash === `sha256:${sha(skillMd(`prov-skill-${stamp}`))}`, 'the record does not describe SKILL.md');
});

await test('E12 a declared skill is recorded as declared; an owner\'s is not stamped', async () => {
  const r = await call('/v1/skills', { token: declarer.token, body: { skill_md: skillMd(`prov-decl-${stamp}`), ai_provenance: { level: 'original', human_involvement: 'full-human' } } });
  assert(r.status === 201 && r.body.data.ai_provenance?.level === 'original', `declared: ${r.status} ${JSON.stringify(r.body.data?.ai_provenance ?? r.body.error)}`);
  const o = await call('/v1/skills', { token: A.token, body: { skill_md: skillMd(`prov-own-${stamp}`) } });
  assert(o.status === 201 && o.body.data.ai_provenance_id === null, `an owner's skill: ${JSON.stringify(o.body.data?.ai_provenance_id)}`);
});

await test('E12 → a declaration the agent may not make is 403 and the skill is not stored', async () => {
  const name = `prov-refused-${stamp}`;
  const r = await call('/v1/skills', { token: plain.token, body: { skill_md: skillMd(name), ai_provenance: { level: 'original' } } });
  assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body.error)}`);
  const get = await call(`/v1/skills/${name}?scope=user`, { token: A.token });
  assert(get.status === 404, `the refused skill was stored: ${get.status}`);
});

// ── E9: site passages ────────────────────────────────────────────────────────────────────────────
console.log('\nE9 — a portal passage\'s record resolves for a visitor');

await test('E9 a declared portal passage is stored public, and its record resolves anonymously', async () => {
  const portal = await call('/v1/site/layout/portal');
  assert(portal.status === 200, `portal: ${portal.status}`);
  const blocks = [...(portal.body.data.layout.blocks as Body[]), { id: 'common.freeform', key: 'freeform.prov', body: `## Prov ${stamp}\n\nA model wrote this passage.` }];
  const put = await call('/v1/site/layout/portal', { token: op.token, method: 'PUT', body: { v: 1, blocks, ai_provenance: { level: 'ai-generated', model: 'test/model' } } });
  assert(put.status === 200, `put portal: ${put.status} ${JSON.stringify(put.body.error)}`);
  const rec = (await mine(op.token)).find(r => r.pipeline === 'surface.freeform');
  assert(rec?.id, 'the passage minted no record');
  assert((await record(rec.id)).status === 200, 'the portal passage\'s record does not resolve for a visitor');
});

await test('E9 → one ai_provenance_id for two passages is 422, and a block that does not parse is 400', async () => {
  const portal = await call('/v1/site/layout/portal');
  const base = (portal.body.data.layout.blocks as Body[]).filter(b => b.id !== 'common.freeform');
  const two = [...base,
    { id: 'common.freeform', key: 'freeform.one', body: 'One.' },
    { id: 'common.freeform', key: 'freeform.two', body: 'Two.' }];
  const dec = await call('/v1/provenance', { token: op.token, body: { level: 'ai-generated', humanInvolvement: 'none', content: 'One.' } });
  const amb = await call('/v1/site/layout/portal', { token: op.token, method: 'PUT', body: { v: 1, blocks: two, ai_provenance_id: dec.body.data.id } });
  assert(amb.status === 422 && amb.body.error?.code === 'PROVENANCE_ID_AMBIGUOUS', `expected 422 PROVENANCE_ID_AMBIGUOUS, got ${amb.status} ${JSON.stringify(amb.body.error)}`);
  const bad = await call('/v1/site/layout/portal', { token: op.token, method: 'PUT', body: { v: 1, blocks: base, ai_provenance: { level: 'nonsense' } } });
  assert(bad.status === 400, `a malformed block answered ${bad.status}`);
  const member = await call('/v1/site/layout/portal', { token: A.token, method: 'PUT', body: { v: 1, blocks: base } });
  assert(member.status === 403, `a member set the portal: ${member.status}`);
});

await test('E9 → a member surface\'s passage stays private: its record is 404 for a visitor', async () => {
  const put = await call('/v1/site/layout/home', { token: op.token, method: 'PUT', body: { v: 1, blocks: [
    { id: 'home.nameplate', key: 'home.nameplate' },
    { id: 'common.freeform', key: 'freeform.inside', body: 'For members.' },
  ], ai_provenance: { level: 'ai-generated' } } });
  assert(put.status === 200, `put home: ${put.status} ${JSON.stringify(put.body.error)}`);
  const recs = (await mine(op.token)).filter(r => r.pipeline === 'surface.freeform');
  const inside = recs.find(r => r.content_hash === `sha256:${sha('For members.')}`);
  assert(inside?.id, 'the home passage minted no record');
  assert((await record(inside.id)).status === 404, 'a member surface passage\'s record resolves for a visitor');
  await call('/v1/site/layout/portal', { token: op.token, method: 'DELETE' });
  await call('/v1/site/layout/home', { token: op.token, method: 'DELETE' });
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
