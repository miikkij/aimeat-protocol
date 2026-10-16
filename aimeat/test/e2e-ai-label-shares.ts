/**
 * @file test/e2e-ai-label-shares.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The AI label of what a workspace share serves (wish-teko-lymerkint-kaikille-julkisille-
 *   sivuille-ja-jaetut-sivut-, brief doc-mvbd0gwl5749). An item an open share serves was decided as
 *   private, so its served disclosure said "no label owed" on the share while GET /v1/provenance/:id
 *   called it public; nothing counted it in the compliance report either. This suite asserts the
 *   decision where each reader meets it:
 *     - the share's list and one page: `disclosure.required` true for an agent's page on an open
 *       share, and the Markdown face carries the provenance note in its body;
 *     - the member read: `_aiProvenance` decided as public while the page is on an open share, and
 *       as private once the share needs a password; `_writtenBy` names the account that holds the
 *       page, and the record the agent that wrote it;
 *     - an HTML page on the page host: the AI-Disclosure header and the document's marks;
 *     - the owner's compliance report: the shared pages counted public, the rule stated
 *       (`shares-open-only`), and another owner's report not counting them;
 *     - the front page's layout read carries `freeform_provenance`; a Design Book part its record.
 *   A non-member is refused the member read (403).
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (the AI label on every public page).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-ai-label-shares
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent } from './helpers/mcp-session.js';
import { hostRequest } from './helpers/host-request.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const PORT = new URL(BASE).port;
const PAGE_HOST = `pages.localhost:${PORT}`;
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
async function call(path: string, opts: { token?: string; body?: unknown; method?: string } = {}): Promise<{ status: number; body: Body; headers: Headers; text: string }> {
  const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let body: Body = {};
  if ((res.headers.get('content-type') ?? '').includes('json')) body = JSON.parse(text) as Body;
  return { status: res.status, body, headers: res.headers, text };
}

const PAGE_HTML = `<!doctype html><html><head><title>Kvartaali</title></head><body><h1>Kvartaali ${stamp}</h1><p>Malli kirjoitti tämän.</p></body></html>`;

console.log('\n=== The AI label of what a workspace share serves ===\n');

let A!: Awaited<ReturnType<typeof registerOwner>>;
let B!: Awaited<ReturnType<typeof registerOwner>>;
let agentGaii = '';
let agentToken = '';
let orgId = '';
let ws = '';
let mdId = '';
let htmlId = '';

const memberDoc = async (id: string): Promise<Body | undefined> => {
  const r = await call(`/v1/organisms/${orgId}/workspace?ws=${ws}`, { token: A.token });
  return (r.body.data?.objects?.pages as Body[] | undefined)?.find(d => d.id === id);
};

await test('setup: owner A with an agent and a document space, owner B outside', async () => {
  A = await registerOwner(BASE, `ala${stamp}`);
  B = await registerOwner(BASE, `alb${stamp}`);
  const agent = await makeAgent(BASE, A, ['memory:read', 'memory:write', 'organism:read', 'organism:write']);
  agentGaii = agent.gaii;
  agentToken = agent.token;
  const o = await call('/v1/organisms', { token: A.token, body: { name: `Labels ${stamp}`, description: 'x', type: 'project', join_policy: 'approval_required', visibility: 'private' } });
  assert(o.status === 201, `organism: ${o.status} ${JSON.stringify(o.body.error)}`);
  orgId = o.body.data.organism.id;
  const w = await call(`/v1/organisms/${orgId}/workspaces`, { token: A.token, body: {
    name: 'Julkaisut',
    manifest: { manifestVersion: '1', name: 'Julkaisut', kind: 'project', objectTypes: [
      { name: 'pages', namespace: 'shared.pages', schemaRef: 'schema:page@1', mode: 'document', backing: 'memory', writeRole: 'member' },
    ] },
  } });
  assert(w.status === 201, `workspace: ${w.status} ${JSON.stringify(w.body.error)}`);
  ws = w.body.data.ws;
  // The agent writes both pages, with no declaration: the node records them as model-written.
  const md = await call(`/v1/organisms/${orgId}/workspace/drafts`, { token: agentToken, body: { ws, space: 'pages', value: { title: 'Katsaus', markdown: `# Katsaus ${stamp}\n\nMalli kirjoitti tämän sivun.` } } });
  assert(md.status === 200, `markdown draft: ${md.status} ${JSON.stringify(md.body.error)}`);
  mdId = md.body.data.id;
  const hp = await call(`/v1/organisms/${orgId}/workspace/drafts`, { token: agentToken, body: { ws, space: 'pages', value: { title: 'Kvartaali', html: PAGE_HTML } } });
  assert(hp.status === 200, `html draft: ${hp.status} ${JSON.stringify(hp.body.error)}`);
  htmlId = hp.body.data.id;
  for (const id of [mdId, htmlId]) {
    const p = await call(`/v1/organisms/${orgId}/publish`, { token: A.token, body: { ws, namespace: 'shared.pages', id } });
    assert(p.status === 200, `publish ${id}: ${p.status} ${JSON.stringify(p.body.error)}`);
  }
});

await test('before it is shared, the member read decides the agent\'s page as private and names who stored each copy', async () => {
  const d = await memberDoc(mdId);
  assert(d?._aiProvenance?.level === 'ai-generated', `no record on the page: ${JSON.stringify(d).slice(0, 300)}`);
  assert(d._aiProvenance.disclosure?.required === false, `a private page owes a label: ${JSON.stringify(d._aiProvenance.disclosure)}`);
  // The page is stored in the owner's name, and its record names the agent that wrote it: a member
  // reads the second (components/HtmlPageFrame.js), the first when there is no record.
  assert(d._writtenBy === A.ghii, `the stored copy's account: ${d._writtenBy}`);
  assert(d._aiProvenance.generator?.principal === agentGaii, `the record's writer: ${JSON.stringify(d._aiProvenance.generator)}`);
});

console.log('\nAn open share');

await test('on an open share the page owes the label in the share\'s list, on its own and in its Markdown', async () => {
  const s = await call(`/v1/organisms/${orgId}/workspace/share?ws=${ws}`, { token: A.token, method: 'PUT', body: { docs: { [`pages/${mdId}`]: true, [`pages/${htmlId}`]: true } } });
  assert(s.status === 200, `share: ${s.status} ${JSON.stringify(s.body.error)}`);
  const list = await call(`/v1/organisms/${orgId}/workspace/public/documents?ws=${ws}`);
  const doc = (list.body.data?.documents as Body[] | undefined)?.find(d => d.id === mdId);
  assert(doc?.ai_provenance?.record?.disclosure?.required === true, `the list's page owes no label: ${JSON.stringify(doc?.ai_provenance?.record?.disclosure)}`);
  const one = await call(`/v1/organisms/${orgId}/workspace/public/document?ws=${ws}&type=pages&id=${mdId}`);
  assert(one.body.data?.document?.ai_provenance?.record?.disclosure?.required === true && one.body.meta?.provenance?.record?.disclosure?.required === true,
    `one page owes no label: ${JSON.stringify(one.body.meta?.provenance?.record?.disclosure)}`);
  const md = await call(`/v1/organisms/${orgId}/workspace/public/document?ws=${ws}&type=pages&id=${mdId}&format=md`);
  assert(md.text.includes('> **AI provenance**') && md.text.includes('/v1/provenance/'), `the Markdown carries no note: ${md.text.slice(0, 300)}`);
  const all = await call(`/v1/organisms/${orgId}/workspace/public/documents?ws=${ws}&format=md`);
  assert(all.text.includes('> **AI provenance**'), `the workspace Markdown carries no note: ${all.text.slice(0, 300)}`);
});

await test('the member read decides the shared page as public, as its viewers see it', async () => {
  const d = await memberDoc(mdId);
  assert(d?._aiProvenance?.disclosure?.required === true, `the member read: ${JSON.stringify(d?._aiProvenance?.disclosure)}`);
});

await test('an HTML page carries its record on the page host: the header and the document\'s marks', async () => {
  const one = await call(`/v1/organisms/${orgId}/workspace/public/document?ws=${ws}&type=pages&id=${htmlId}`);
  const frame = one.body.data?.document?.frame_url as string | undefined;
  assert(frame, `no frame address: ${JSON.stringify(one.body.data).slice(0, 300)}`);
  assert(one.body.data.document.ai_provenance?.record?.disclosure?.required === true, 'the HTML page owes no label on the share');
  const r = await hostRequest(BASE, `${new URL(frame).pathname}index.html`, PAGE_HOST, { headers: { 'sec-fetch-dest': 'iframe' } });
  assert(r.status === 200, `page: ${r.status}`);
  assert(r.header('ai-disclosure'), 'the page host sent no AI-Disclosure header');
  assert((r.header('link') ?? '').includes('rel="ai-provenance"'), `no provenance Link: ${r.header('link')}`);
  assert(r.body.includes('id="aimeat-ai-provenance"'), 'the page carries no provenance marks');
});

console.log('\nThe compliance counts');

await test('the owner\'s report counts the shared pages as public and states which shares count', async () => {
  const r = await call('/v1/compliance/report/mine', { token: A.token });
  assert(r.status === 200, `report: ${r.status} ${JSON.stringify(r.body.error)}`);
  const tr = r.body.data?.derived?.ai_transparency;
  assert(tr?.public_total >= 2 && tr?.labelled >= 2, `public ${tr?.public_total}, labelled ${tr?.labelled}`);
  const codes = (r.body.data.not_covered as Body[]).map(l => l.code);
  assert(codes.includes('shares-open-only'), `limits: ${codes.join(', ')}`);
});

await test('another owner\'s report counts none of them, and a non-member is refused the member read', async () => {
  const r = await call('/v1/compliance/report/mine', { token: B.token });
  assert(r.status === 200 && r.body.data?.derived?.ai_transparency?.public_total === 0, `B's report: ${JSON.stringify(r.body.data?.derived?.ai_transparency)}`);
  const read = await call(`/v1/organisms/${orgId}/workspace?ws=${ws}`, { token: B.token });
  assert(read.status === 403, `non-member read: ${read.status}`);
});

console.log('\nA share behind a password');

await test('behind a password the page is not public: no label is owed and the report stops counting it', async () => {
  const s = await call(`/v1/organisms/${orgId}/workspace/share?ws=${ws}`, { token: A.token, method: 'PUT', body: { access: 'password', password: 'salasana-1' } });
  assert(s.status === 200, `password share: ${s.status} ${JSON.stringify(s.body.error)}`);
  const d = await memberDoc(mdId);
  assert(d?._aiProvenance?.disclosure?.required === false, `behind a password the page still owes a label: ${JSON.stringify(d?._aiProvenance?.disclosure)}`);
  const r = await call('/v1/compliance/report/mine', { token: A.token });
  assert(r.body.data?.derived?.ai_transparency?.public_total === 0, `public after the password: ${r.body.data?.derived?.ai_transparency?.public_total}`);
});

console.log('\nThe other reads that carry a record');

await test('the front page\'s layout read carries freeform_provenance, and Design Book parts their records', async () => {
  const l = await call('/v1/site/layout/portal');
  assert(l.status === 200 && l.body.data?.freeform_provenance && typeof l.body.data.freeform_provenance === 'object', `layout: ${JSON.stringify(l.body.data).slice(0, 200)}`);
  const book = await call('/v1/designbook');
  assert(book.status === 200 && Array.isArray(book.body.data?.parts), `designbook: ${book.status}`);
  for (const p of book.body.data.parts as Body[]) {
    if (p.ai_provenance) assert(typeof p.ai_provenance.record_url === 'string' && p.ai_provenance.record?.spec === 'aimeat.provenance/v1', `part ${p.id}: ${JSON.stringify(p.ai_provenance)}`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
