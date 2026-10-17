/**
 * @file test/e2e-html-pages.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description HTML pages in workspaces (wish-kevyet-html-esitykset-ilman-sovellusta-eristetty-html-sivu-j):
 *   a page written into a document space whose schema is locked strict, its text written by the
 *   node, its version window, sharing it with its end date over REST and over the MCP tool
 *   aimeat_workspace_share, the public read with its frame address, the page host (the holder, the
 *   page, its files, every refusal), a member's frame address and an outsider's 404, the in-place
 *   edit refusal, the day it was last opened, and the pictures of a shared Markdown page for an
 *   outsider. The shared E2E server runs the page host at pages.localhost (test/run-e2e-server.ts).
 *
 *   What the browser itself enforces inside the frame (an opaque origin, connect-src, img-src,
 *   form-action, the holder's frame-src against a navigation) was proven in a real browser on the
 *   sandbox and is not repeated here; this suite asserts the headers that make the browser do it.
 * @version-history
 *   v1.3.0 — 2026-10-17 — Sharing one HTML page answers `window_url` (viewer_url + &view=page); a
 *     Markdown page answers none.
 *   v1.2.0 — 2026-10-17 — A page file carries CORP cross-origin and ACAO *, the page CORP same-origin:
 *     the browser had refused every file of every page, which a status check from Node cannot see.
 *   v1.1.0 — 2026-10-16 — The frame and opened routes refuse an agent without organism:read (403) and
 *     an anonymous caller (401) (check:denial-coverage).
 *   v1.0.0 — 2026-10-16 — Initial.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-html-pages
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';
import { hostRequest } from './helpers/host-request.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const PORT = new URL(BASE).port;
const PAGE_HOST = `pages.localhost:${PORT}`;
const PAGE_ORIGIN = `http://${PAGE_HOST}`;
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
async function call(path: string, opts: { token?: string; body?: unknown; method?: string; headers?: Record<string, string> } = {}): Promise<{ status: number; body: Body; headers: Headers }> {
  const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), ...(opts.headers ?? {}) },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    signal: AbortSignal.timeout(30_000),
  });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() as Body : { _raw: await res.text() };
  return { status: res.status, body, headers: res.headers };
}
const page = (path: string, dest?: string) => hostRequest(BASE, path, PAGE_HOST, { headers: dest ? { 'sec-fetch-dest': dest } : {} });

const PAGE_HTML = `<!doctype html><html><head><title>Q4</title></head><body><h1>Kvartaali 4</h1><p>Myynti kasvoi &amp; kasvaa.</p><script>document.body.dataset.ran = '1';</script><img src="kuva.png"></body></html>`;
// A 1x1 PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

console.log('\n=== HTML pages in workspaces ===\n');

let A!: Awaited<ReturnType<typeof registerOwner>>;
let B!: Awaited<ReturnType<typeof registerOwner>>;
let orgId = '';
let ws = '';
let pageId = '';
let mdId = '';
let frameUrl = '';
let imageUrl = '';

await test('setup: owner A with an organism and a document space whose schema is locked strict, owner B outside', async () => {
  A = await registerOwner(BASE, `hpa${stamp}`);
  B = await registerOwner(BASE, `hpb${stamp}`);
  const o = await call('/v1/organisms', { token: A.token, body: { name: `Pages ${stamp}`, description: 'x', type: 'project', join_policy: 'approval_required', visibility: 'private' } });
  assert(o.status === 201, `organism: ${o.status} ${JSON.stringify(o.body.error)}`);
  orgId = o.body.data.organism.id;
  const w = await call(`/v1/organisms/${orgId}/workspaces`, { token: A.token, body: {
    name: 'Esitykset',
    manifest: { manifestVersion: '1', name: 'Esitykset', kind: 'project', objectTypes: [
      { name: 'pages', namespace: 'shared.pages', schemaRef: 'schema:page@1', mode: 'document', backing: 'memory', writeRole: 'member' },
    ] },
    schemas: { 'shared.pages': { type: 'object', required: ['title', 'markdown'], properties: { id: { type: 'string' }, title: { type: 'string' }, markdown: { type: 'string' } } } },
  } });
  assert(w.status === 201, `workspace: ${w.status} ${JSON.stringify(w.body.error)}`);
  ws = w.body.data.ws;
  const up = await call('/v1/storage', { token: A.token, body: { key: `pages-${stamp}/kuva.png`, data: PNG, mime_type: 'image/png', visibility: 'private' } });
  assert(up.status === 201, `upload: ${up.status} ${JSON.stringify(up.body.error)}`);
  imageUrl = up.body.data.embed_url;
});

console.log('\nWriting a page');

await test('an HTML page lands in a strict { title, markdown } space, and the node writes its text', async () => {
  const w = await call(`/v1/organisms/${orgId}/workspace/drafts`, { token: A.token, body: { ws, space: 'pages', value: { title: 'Esitys', html: PAGE_HTML, files: { 'kuva.png': imageUrl } } } });
  assert(w.status === 200, `write: ${w.status} ${JSON.stringify(w.body.error)}`);
  pageId = w.body.data.id;
  const r = await call(`/v1/organisms/${orgId}/workspace/index?ws=${ws}&ids=${pageId}`, { token: A.token });
  const draft = r.body.data?.items?.[0]?.draft ?? r.body.data?.items?.[0]?.value;
  assert(draft && typeof draft.html === 'string', `the draft keeps its html: ${JSON.stringify(r.body.data).slice(0, 300)}`);
  assert(/# Kvartaali 4/.test(draft.markdown) && /Myynti kasvoi & kasvaa\./.test(draft.markdown), `text written from the html: ${JSON.stringify(draft.markdown)}`);
  assert(!/document\.body/.test(draft.markdown), `a script is not text: ${JSON.stringify(draft.markdown)}`);
});

await test('an empty page and a file name that climbs out are refused, and nothing is written', async () => {
  const empty = await call(`/v1/organisms/${orgId}/workspace/drafts`, { token: A.token, body: { ws, space: 'pages', value: { title: 'x', html: '  ' } } });
  assert(empty.status === 400 && empty.body.error?.code === 'INVALID_INPUT', `empty: ${empty.status} ${JSON.stringify(empty.body.error)}`);
  const climb = await call(`/v1/organisms/${orgId}/workspace/drafts`, { token: A.token, body: { ws, space: 'pages', value: { title: 'x', html: '<p>x</p>', files: { '../etc/passwd': 'k' } } } });
  assert(climb.status === 400 && climb.body.error?.code === 'INVALID_INPUT', `climb: ${climb.status} ${JSON.stringify(climb.body.error)}`);
});

await test('a page keeps at most five published versions', async () => {
  for (let i = 0; i < 7; i++) {
    if (i > 0) {
      const w = await call(`/v1/organisms/${orgId}/workspace/drafts`, { token: A.token, body: { ws, space: 'pages', id: pageId, value: { title: 'Esitys', html: PAGE_HTML.replace('Q4', `Q4 v${i}`), files: { 'kuva.png': imageUrl } } } });
      assert(w.status === 200, `rewrite ${i}: ${w.status}`);
    }
    const p = await call(`/v1/organisms/${orgId}/publish`, { token: A.token, body: { ws, namespace: 'shared.pages', id: pageId } });
    assert(p.status === 200, `publish ${i}: ${p.status} ${JSON.stringify(p.body.error)}`);
  }
  const list = await call(`/v1/memory?prefix=${encodeURIComponent(`organism.${orgId}.w.${ws}.shared.pages.${pageId}.version.`)}&owner_scope=true&limit=50`, { token: A.token });
  const items = (list.body.data?.items ?? list.body.data?.entries ?? []) as Array<{ key: string }>;
  assert(list.status === 200 && items.length > 0 && items.length <= 5, `version rows: ${list.status} ${items.length}`);
});

await test('the workspace index marks the page as an HTML page', async () => {
  const r = await call(`/v1/organisms/${orgId}/workspace/index?ws=${ws}`, { token: A.token });
  const entry = (r.body.data?.index?.pages ?? []).find((e: Body) => e.id === pageId);
  assert(entry?.kind === 'html', `index entry: ${JSON.stringify(entry)}`);
});

await test('an in-place edit of an HTML page\'s text is refused', async () => {
  const r = await call(`/v1/organisms/${orgId}/workspace/documents/pages/${pageId}/append?ws=${ws}`, { token: A.token, body: { markdown: '\n\nmore' } });
  assert(r.status === 422 && r.body.error?.code === 'NOT_A_MARKDOWN_PAGE', `append: ${r.status} ${JSON.stringify(r.body.error)}`);
});

console.log('\nSharing a page');

await test('sharing an HTML page with no end gives it 90 days; a Markdown page gets none', async () => {
  const md = await call(`/v1/organisms/${orgId}/workspace/drafts`, { token: A.token, body: { ws, space: 'pages', value: { title: 'Kuvallinen', markdown: `# Kuva\n\n![kuva](${imageUrl})\n` } } });
  assert(md.status === 200, `md: ${md.status}`);
  mdId = md.body.data.id;
  assert((await call(`/v1/organisms/${orgId}/publish`, { token: A.token, body: { ws, namespace: 'shared.pages', id: mdId } })).status === 200, 'md publish');
  const s = await call(`/v1/organisms/${orgId}/workspace/share?ws=${ws}`, { token: A.token, method: 'PUT', body: { docs: { [`pages/${pageId}`]: true, [`pages/${mdId}`]: true } } });
  assert(s.status === 200, `share: ${s.status} ${JSON.stringify(s.body.error)}`);
  const end = Date.parse(s.body.data.share.until[`pages/${pageId}`]);
  const days = (end - Date.now()) / 86_400_000;
  assert(days > 89 && days <= 90, `html page end: ${s.body.data.share.until[`pages/${pageId}`]}`);
  assert(!(`pages/${mdId}` in s.body.data.share.until), `markdown page end: ${JSON.stringify(s.body.data.share.until)}`);
});

await test('an end date in the past is refused, and a target that is not one is refused', async () => {
  const past = await call(`/v1/organisms/${orgId}/workspace/share?ws=${ws}`, { token: A.token, method: 'PUT', body: { until: { [`pages/${pageId}`]: '2020-01-01' } } });
  assert(past.status === 400 && past.body.error?.code === 'INVALID_INPUT', `past: ${past.status}`);
  const bad = await call(`/v1/organisms/${orgId}/workspace/share?ws=${ws}`, { token: A.token, method: 'PUT', body: { until: { 'no target here': '2099-01-01' } } });
  assert(bad.status === 400, `bad target: ${bad.status}`);
});

await test('only the workspace creator or an admin may share: an outsider is refused', async () => {
  const r = await call(`/v1/organisms/${orgId}/workspace/share?ws=${ws}`, { token: B.token, method: 'PUT', body: { public: true } });
  assert(r.status === 403, `outsider share: ${r.status}`);
});

await test('the public read hands out the page with its frame address and its text, never its namespace', async () => {
  const one = await call(`/v1/organisms/${orgId}/workspace/public/document?ws=${ws}&type=pages&id=${pageId}`);
  assert(one.status === 200, `public doc: ${one.status}`);
  const d = one.body.data.document;
  assert(d.kind === 'html' && typeof d.html === 'string' && /Kvartaali 4/.test(d.markdown), `doc: ${JSON.stringify(d).slice(0, 200)}`);
  assert(typeof d.frame_url === 'string' && d.frame_url.startsWith(`${PAGE_ORIGIN}/p/`) && d.frame_url.endsWith('/'), `frame_url: ${d.frame_url}`);
  assert(!('namespace' in d), 'the namespace stays on the server');
  frameUrl = d.frame_url;
  const all = await call(`/v1/organisms/${orgId}/workspace/public/documents?ws=${ws}`);
  const listed = (all.body.data.documents as Body[]).find(x => x.id === pageId);
  assert(listed && listed.frame_url && !('html' in listed), `listed: ${JSON.stringify(listed).slice(0, 200)}`);
});

console.log('\nThe page host');

await test('the holder answers into a frame, framing the page host alone, framed by the node alone', async () => {
  const r = await page(new URL(frameUrl).pathname, 'iframe');
  assert(r.status === 200, `holder: ${r.status} ${r.body.slice(0, 80)}`);
  const csp = r.header('content-security-policy') ?? '';
  assert(csp.includes(`frame-src ${PAGE_ORIGIN}`) && !/frame-src[^;]*\*/.test(csp), `holder frame-src: ${csp}`);
  assert(csp.includes(`frame-ancestors ${new URL(BASE).origin}`), `holder frame-ancestors: ${csp}`);
  assert(r.body.includes('src="index.html"') && r.header('x-frame-options') === null, 'holder frames index.html, no X-Frame-Options');
  const js = await page('/p/_/holder.js', 'script');
  assert(js.status === 200 && /aimeat_page_open/.test(js.body), `holder.js: ${js.status}`);
});

await test('the page is sandboxed without its own origin and has no network exit', async () => {
  const r = await page(`${new URL(frameUrl).pathname}index.html`, 'iframe');
  assert(r.status === 200 && r.body.includes('Kvartaali 4') && r.body.includes('data-aimeat-page-support'), `page: ${r.status}`);
  const csp = r.header('content-security-policy') ?? '';
  assert(/^sandbox allow-scripts allow-forms allow-modals;/.test(csp) && !csp.includes('allow-same-origin') && !csp.includes('allow-popups') && !csp.includes('allow-top-navigation'), `sandbox: ${csp}`);
  for (const d of ["connect-src 'none'", "form-action 'none'", "frame-src 'none'", `img-src ${PAGE_ORIGIN} data: blob:`]) assert(csp.includes(d), `missing ${d}: ${csp}`);
  assert(r.header('referrer-policy') === 'no-referrer' && /camera=\(\)/.test(r.header('permissions-policy') ?? ''), 'referrer and permissions policy');
  assert(csp.length < 1200, `the policy is one fixed string, not a list that grows: ${csp.length}`);
  assert(r.header('cross-origin-resource-policy') === 'same-origin', `the page itself stays same-origin: ${r.header('cross-origin-resource-policy')}`);
});

await test('the page\'s mapped file is served beside it; an unmapped name is 404', async () => {
  const f = await page(`${new URL(frameUrl).pathname}kuva.png`, 'image');
  assert(f.status === 200 && f.header('content-type') === 'image/png', `file: ${f.status} ${f.header('content-type')}`);
  // The page runs in an opaque origin, so its own file is cross-origin to it: with CORP same-origin
  // the browser refused every picture, stylesheet and script of every page (aimeat.io, 2026-10-17).
  assert(f.header('cross-origin-resource-policy') === 'cross-origin', `a page file loads into the page's opaque origin: CORP ${f.header('cross-origin-resource-policy')}`);
  assert(f.header('access-control-allow-origin') === '*', `a font file loads in cors mode from the opaque origin: ACAO ${f.header('access-control-allow-origin')}`);
  assert(/^sandbox /.test(f.header('content-security-policy') ?? ''), 'a file the frame navigates to is as sandboxed as the page');
  const none = await page(`${new URL(frameUrl).pathname}other.png`, 'image');
  assert(none.status === 404, `unmapped: ${none.status}`);
});

await test('opened in a tab of its own, the page goes to its viewer; with no fetch metadata it is refused', async () => {
  const tab = await page(new URL(frameUrl).pathname, 'document');
  assert(tab.status === 302 && (tab.header('location') ?? '').includes(`/v1/publicworkspaceviewer?org=${orgId}`), `tab: ${tab.status} ${tab.header('location')}`);
  const bare = await page(`${new URL(frameUrl).pathname}index.html`);
  assert(bare.status === 403, `no metadata: ${bare.status}`);
});

await test('a forged token is 404, and the page host answers nothing but the frame', async () => {
  const bad = await page('/p/not.a.token/', 'iframe');
  assert(bad.status === 404, `forged: ${bad.status}`);
  const api = await page('/v1/memory', 'empty');
  assert(api.status === 404, `api on the page host: ${api.status}`);
  const root = await page('/', 'document');
  assert(root.status === 302 && root.header('location') === `${new URL(BASE).origin}/`, `root: ${root.status} ${root.header('location')}`);
});

console.log('\nMembers and outsiders');

await test('a member gets a frame address for the draft or the published page; an outsider gets 404', async () => {
  const mine = await call(`/v1/organisms/${orgId}/workspace/documents/pages/${pageId}/frame?ws=${ws}`, { token: A.token, body: { version: 'latest' } });
  assert(mine.status === 200 && typeof mine.body.data.frame_url === 'string', `member: ${mine.status} ${JSON.stringify(mine.body.error)}`);
  const loaded = await page(`${new URL(mine.body.data.frame_url).pathname}index.html`, 'iframe');
  assert(loaded.status === 200, `member frame: ${loaded.status}`);
  const theirs = await call(`/v1/organisms/${orgId}/workspace/documents/pages/${pageId}/frame?ws=${ws}`, { token: B.token, body: { version: 'latest' } });
  assert(theirs.status === 404, `outsider: ${theirs.status}`);
  const md = await call(`/v1/organisms/${orgId}/workspace/documents/pages/${mdId}/frame?ws=${ws}`, { token: A.token, body: {} });
  assert(md.status === 404 && md.body.error?.code === 'NOT_AN_HTML_PAGE', `markdown page frame: ${md.status} ${JSON.stringify(md.body.error)}`);
});

await test('a frame address and an opened mark need a signed-in caller who may read organisms', async () => {
  const narrow = await makeAgent(BASE, A, ['memory:read']);
  const frameNarrow = await call(`/v1/organisms/${orgId}/workspace/documents/pages/${pageId}/frame?ws=${ws}`, { method: 'POST', token: narrow.token, body: {} });
  assert(frameNarrow.status === 403, `frame, agent without organism:read: ${frameNarrow.status}`);
  const openedNarrow = await call(`/v1/organisms/${orgId}/workspace/documents/pages/${pageId}/opened?ws=${ws}`, { method: 'POST', token: narrow.token, body: {} });
  assert(openedNarrow.status === 403, `opened, agent without organism:read: ${openedNarrow.status}`);
  const frameAnon = await call(`/v1/organisms/${orgId}/workspace/documents/pages/${pageId}/frame?ws=${ws}`, { method: 'POST', body: {} });
  assert(frameAnon.status === 401, `frame, anonymous: ${frameAnon.status}`);
  const openedAnon = await call(`/v1/organisms/${orgId}/workspace/documents/pages/${pageId}/opened?ws=${ws}`, { method: 'POST', body: {} });
  assert(openedAnon.status === 401, `opened, anonymous: ${openedAnon.status}`);
});

await test('the day a page was opened is recorded, and the workspace read and index carry it', async () => {
  const day = new Date().toISOString().slice(0, 10);
  const o = await call(`/v1/organisms/${orgId}/workspace/documents/pages/${mdId}/opened?ws=${ws}`, { token: A.token, body: {} });
  assert(o.status === 200 && o.body.data.day === day, `opened: ${o.status}`);
  const w = await call(`/v1/organisms/${orgId}/workspace?ws=${ws}`, { token: A.token });
  assert(w.body.data?.opened?.[`pages/${mdId}`] === day && w.body.data?.opened?.[`pages/${pageId}`] === day, `opened map: ${JSON.stringify(w.body.data?.opened)}`);
  const idx = await call(`/v1/organisms/${orgId}/workspace/index?ws=${ws}`, { token: A.token });
  const entry = (idx.body.data?.index?.pages ?? []).find((e: Body) => e.id === mdId);
  assert(entry?.last_opened === day && !entry?.stale, `index entry: ${JSON.stringify(entry)}`);
  const outsider = await call(`/v1/organisms/${orgId}/workspace/documents/pages/${mdId}/opened?ws=${ws}`, { token: B.token, body: {} });
  assert(outsider.status === 404, `outsider opened: ${outsider.status}`);
});

console.log('\nThe pictures of a shared Markdown page');

await test('a workspace-scoped picture loads for an outsider only with the shared page it is in', async () => {
  const path = new URL(imageUrl, BASE).pathname;
  const ref = (id: string) => encodeURIComponent([orgId, ws, 'pages', id].map(encodeURIComponent).join('/'));
  assert((await call(path)).status === 404, 'without ?share');
  const ok = await fetch(`${BASE}${path}?share=${ref(mdId)}`);
  assert(ok.status === 200 && ok.headers.get('content-type') === 'image/png', `with ?share: ${ok.status}`);
  const other = await fetch(`${BASE}${path}?share=${ref(pageId)}`);
  assert(other.status === 404, `naming a page that does not embed it: ${other.status}`);
});

console.log('\nThe MCP tool');

await test('aimeat_workspace_share stops sharing, and the page host stops serving the page at once', async () => {
  const agent = await makeAgent(BASE, A, ['memory:read', 'memory:write', 'organism:read', 'organism:write']);
  const s = await openSession(BASE, agent.token, 'e2e-html-pages');
  const off = await callTool(s, 'aimeat_workspace_share', { organism_id: orgId, ws, space: 'pages', id: pageId, shared: false });
  assert(!off.isError && off.data?.share?.docs?.[`pages/${pageId}`] === false, `tool: ${off.text.slice(0, 200)}`);
  const gone = await page(`${new URL(frameUrl).pathname}index.html`, 'iframe');
  assert(gone.status === 404, `after unshare: ${gone.status}`);
  const back = await callTool(s, 'aimeat_workspace_share', { organism_id: orgId, ws, space: 'pages', id: pageId, shared: true, until: '2099-12-31' });
  assert(!back.isError && back.data?.viewer_url?.includes(`id=${pageId}`) && back.data?.ends_at?.startsWith('2099-12-31'), `share again: ${back.text.slice(0, 300)}`);
  assert(back.data?.window_url === `${back.data?.viewer_url}&view=page`, `an HTML page answers the page-alone address: ${back.data?.window_url}`);
  const md = await callTool(s, 'aimeat_workspace_share', { organism_id: orgId, ws, space: 'pages', id: mdId, shared: true });
  assert(!md.isError && md.data?.viewer_url?.includes(`id=${mdId}`) && !('window_url' in (md.data ?? {})), `a Markdown page has no page-alone address: ${md.text.slice(0, 300)}`);
  const missing = await callTool(s, 'aimeat_workspace_share', { organism_id: orgId, ws, id: pageId, shared: true });
  assert(missing.isError && /^INVALID_INPUT: /.test(missing.text), `id without space: ${missing.text}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
