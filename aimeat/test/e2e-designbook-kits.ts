/**
 * @file test/e2e-designbook-kits.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Design Book's style kits (services/design-book/kit.ts, kit-defaults.ts;
 *   wish-omat-tyylipohjat-yrityksen-ja-k-ytt-j-n-jaettavissa). This suite holds:
 *     1. a kit for its proposer alone lands published and private: its proposer reads, lists, previews
 *        and takes it; another person, a visitor and the generic memory read meet a missing part;
 *        a body outside the bench is refused in words;
 *     2. a kit for an organism is proposed by an active member and read by every member, and by
 *        nobody outside it;
 *     3. an organism's default is chosen by its owners and admins only, and only a kit its members
 *        can read; the kit in force is the organism's for a member, refused for a non-member, and the
 *        person's own otherwise;
 *     4. a kit for the whole node with no app behind it waits for the operator, and nobody else takes
 *        it meanwhile; an id held by a narrower kit is refused without naming its proposer;
 *     5. the two MCP tools answer and refuse as the routes do.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=designbook-kits
 * @version-history
 *   v1.0.0 — 2026-10-30 — Initial (wish-omat-tyylipohjat-yrityksen-ja-k-ytt-j-n-jaettavissa).
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, body: ct.includes('json') ? await res.json() : { _raw: await res.text() } };
}
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const propose = (token: string, part: unknown) => json('/v1/designbook', { method: 'POST', headers: auth(token), body: JSON.stringify({ part }) });

const stamp = Date.now().toString(36);
const A: RegisteredOwner = await registerOwner(BASE, `kita${stamp}`);
const B: RegisteredOwner = await registerOwner(BASE, `kitb${stamp}`);
const C: RegisteredOwner = await registerOwner(BASE, `kitc${stamp}`);
const OWN = `kit-own-${stamp}`;
const ORG = `kit-org-${stamp}`;
const NODE = `kit-node-${stamp}`;
let orgId = '';

const ownBody = {
  reach: 'own', look: 'editorial', genre: 'genre-pressdrop',
  tokens: { '--ak-accent': '#1d4ed8/#93c5fd', '--ak-radius': '2px' },
  ornament: { set: 'art-deco', palette: 'look' },
};

console.log('\n1. A kit for its proposer alone');
await test('Setup: A makes an organism and B joins it; C stays outside', async () => {
  const org = await json('/v1/organisms', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: `Kit Org ${stamp}`, type: 'project', join_policy: 'open', visibility: 'public' }) });
  assert(org.status === 201, `organism ${org.status}: ${JSON.stringify(org.body?.error)}`);
  orgId = org.body.data.organism.id;
  const j = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: auth(B.token), body: '{}' });
  assert(j.status === 201, `join ${j.status}: ${JSON.stringify(j.body?.error)}`);
});
await test('A proposes a kit for themselves alone: it lands published, with its checks', async () => {
  const r = await propose(A.token, { id: OWN, kind: 'kit', title: 'My own style', summary: 'Ink blue on paper, sharp corners, art deco ornaments.', body: ownBody });
  assert(r.status === 201 && r.body.data?.status === 'published', `propose ${r.status}: ${JSON.stringify(r.body?.data ?? r.body?.error)}`);
  const one = await json(`/v1/designbook/${OWN}`, { headers: auth(A.token) });
  assert(one.status === 200 && one.body.data.part.body.reach === 'own', `read ${one.status}`);
  assert(one.body.data.part.bench.checks.includes('kit-valid') && one.body.data.part.bench.checks.includes('contrast-matrix'), `checks ${JSON.stringify(one.body.data.part.bench.checks)}`);
});
await test('Another person, a visitor and the generic public read meet a missing part', async () => {
  const b = await json(`/v1/designbook/${OWN}`, { headers: auth(B.token) });
  assert(b.status === 404, `B reads it: ${b.status}`);
  const anon = await json(`/v1/designbook/${OWN}`);
  assert(anon.status === 404, `a visitor reads it: ${anon.status}`);
  const list = await json('/v1/designbook?kind=kit', { headers: auth(B.token) });
  assert(!(list.body.data?.parts ?? []).some((p: any) => p.id === OWN), 'B\'s list holds it');
  const prev = await fetch(`${BASE}/v1/designbook/${OWN}/preview`);
  assert(prev.status === 404, `a visitor previews it: ${prev.status}`);
  const adopt = await json(`/v1/designbook/${OWN}/adopt`, { method: 'POST', headers: auth(B.token), body: JSON.stringify({ filename: 'x.html' }) });
  assert(adopt.status === 404, `B takes it: ${adopt.status}`);
  // The generic public memory read of the stored record, as B and with no session: refused, none of the kit.
  const system = `system@${A.ghii.slice(A.ghii.indexOf('@') + 1)}`;
  const raw = `/v1/memory/${encodeURIComponent(system)}/${encodeURIComponent(`atelier.book.part.${OWN}`)}`;
  for (const headers of [auth(B.token), {}]) {
    const r = await json(raw, { headers });
    assert(r.status >= 400 && !JSON.stringify(r.body).includes('#1d4ed8'), `the public memory read: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  }
});
await test('Its proposer lists it, previews it through the list\'s address and takes it', async () => {
  const list = await json('/v1/designbook?kind=kit', { headers: auth(A.token) });
  const row = (list.body.data?.parts ?? []).find((p: any) => p.id === OWN);
  assert(row && String(row.preview_url).includes('?t='), `listed with a token: ${JSON.stringify(row)}`);
  assert(row.reach === 'own' && row.organism === undefined, `the row says its reach: ${JSON.stringify(row)}`);
  const prev = await fetch(`${BASE}${row.preview_url}`);
  const page = await prev.text();
  assert(prev.status === 200 && page.includes('data-ak-look="editorial"'), `preview ${prev.status}`);
  // The kit's own page: its bar, its values on the body that wears the look, and its ornament set.
  assert(page.includes('class="kit-bar"') && page.includes('body[data-ak-look] { --ak-accent: #1d4ed8;') && page.includes('"set":"art-deco"'), 'the preview is the kit\'s own page');
  const adopt = await json(`/v1/designbook/${OWN}/adopt`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ filename: 'new-app.html' }) });
  const kit = adopt.body.data?.kit;
  assert(adopt.status === 200 && kit, `adopt ${adopt.status}: ${JSON.stringify(adopt.body?.error)}`);
  assert(kit.app.includes("look: 'editorial'") && kit.fork === '/v1/app-templates/genre-pressdrop', `app line and fork: ${JSON.stringify(kit)}`);
  assert(kit.css.includes('--ak-accent: #1d4ed8') && kit.css.includes(':root[data-theme="dark"] { --ak-accent: #93c5fd; }'), `css: ${kit.css}`);
  assert(kit.ornament.includes("ornamentSet('art-deco'") && kit.ornament.includes("palette: 'look'"), `ornament: ${kit.ornament}`);
});
await test('A body outside the bench is refused in words', async () => {
  const look = await propose(A.token, { id: `${OWN}-x`, kind: 'kit', title: 'x', summary: 'x', body: { ...ownBody, look: 'neon-nowhere' } });
  assert(look.status === 422 && /looks it has/.test(look.body.error?.message), `unknown look: ${look.status} ${look.body.error?.message}`);
  const org = await propose(A.token, { id: `${OWN}-x`, kind: 'kit', title: 'x', summary: 'x', body: { ...ownBody, organism: orgId } });
  assert(org.status === 422 && /organism/.test(org.body.error?.message), `organism on an own kit: ${org.status}`);
  const set = await propose(A.token, { id: `${OWN}-x`, kind: 'kit', title: 'x', summary: 'x', body: { ...ownBody, ornament: { set: 'baroque' } } });
  assert(set.status === 422 && /ornament/.test(set.body.error?.message), `unknown set: ${set.status}`);
  const genre = await propose(A.token, { id: `${OWN}-x`, kind: 'kit', title: 'x', summary: 'x', body: { ...ownBody, genre: 'genre-nowhere' } });
  assert(genre.status === 422 && /genre/.test(genre.body.error?.message), `unknown genre: ${genre.status}`);
});

console.log('\n2. A kit for an organism');
await test('A member proposes a kit for the organism; somebody outside it is refused', async () => {
  const r = await propose(B.token, { id: ORG, kind: 'kit', title: 'The team style', summary: 'The team\'s colours for every new app.', body: { reach: 'organism', organism: orgId, look: 'editorial', tokens: { '--ak-accent': '#0f766e/#5eead4' } } });
  assert(r.status === 201 && r.body.data?.status === 'published', `propose ${r.status}: ${JSON.stringify(r.body?.data ?? r.body?.error)}`);
  const c = await propose(C.token, { id: `${ORG}-c`, kind: 'kit', title: 'x', summary: 'x', body: { reach: 'organism', organism: orgId, look: 'editorial' } });
  assert(c.status === 403 && c.body.error?.code === 'NOT_A_MEMBER', `C proposes for it: ${c.status} ${c.body.error?.code}`);
});
await test('Every member reads it, and nobody outside the organism does', async () => {
  const a = await json(`/v1/designbook/${ORG}`, { headers: auth(A.token) });
  assert(a.status === 200, `A, the organism's creator, reads it: ${a.status}`);
  const row = ((await json('/v1/designbook?kind=kit', { headers: auth(A.token) })).body.data?.parts ?? []).find((p: any) => p.id === ORG);
  assert(row?.reach === 'organism' && row?.organism === orgId, `A's list row says the organism: ${JSON.stringify(row)}`);
  const c = await json(`/v1/designbook/${ORG}`, { headers: auth(C.token) });
  assert(c.status === 404, `C reads it: ${c.status}`);
});

console.log('\n3. Defaults, and the kit in force');
await test('Only the organism\'s owners and admins choose its default, and only a kit its members read', async () => {
  const b = await json('/v1/designbook/kits/default', { method: 'PUT', headers: auth(B.token), body: JSON.stringify({ organism: orgId, kit: ORG }) });
  assert(b.status === 403 && b.body.error?.code === 'NOT_ALLOWED', `B, a member, chooses it: ${b.status} ${b.body.error?.code}`);
  const own = await json('/v1/designbook/kits/default', { method: 'PUT', headers: auth(A.token), body: JSON.stringify({ organism: orgId, kit: OWN }) });
  assert(own.status === 409 && own.body.error?.code === 'NOT_FOR_THIS_ORGANISM', `A's own kit as the organism's: ${own.status} ${own.body.error?.code}`);
  const ok = await json('/v1/designbook/kits/default', { method: 'PUT', headers: auth(A.token), body: JSON.stringify({ organism: orgId, kit: ORG }) });
  assert(ok.status === 200 && ok.body.data?.kit === ORG, `A chooses it: ${ok.status} ${JSON.stringify(ok.body?.error)}`);
});
await test('A member building for the organism gets its kit; a non-member is refused', async () => {
  const b = await json(`/v1/designbook/kits/in-force?organism=${orgId}`, { headers: auth(B.token) });
  assert(b.status === 200 && b.body.data?.source === 'organism' && b.body.data?.kit?.id === ORG, `B: ${b.status} ${JSON.stringify(b.body.data ?? b.body.error)}`);
  assert(String(b.body.data.apply?.app).includes("look: 'editorial'"), 'apply carries the app line');
  const c = await json(`/v1/designbook/kits/in-force?organism=${orgId}`, { headers: auth(C.token) });
  assert(c.status === 403 && c.body.error?.code === 'NOT_A_MEMBER', `C: ${c.status} ${c.body.error?.code}`);
});
await test('Without an organism the person\'s own default answers, and none answers as none', async () => {
  const none = await json('/v1/designbook/kits/in-force', { headers: auth(B.token) });
  assert(none.status === 200 && none.body.data?.kit === null && none.body.data?.source === null, `B, no default: ${JSON.stringify(none.body.data)}`);
  const set = await json('/v1/designbook/kits/default', { method: 'PUT', headers: auth(A.token), body: JSON.stringify({ kit: OWN }) });
  assert(set.status === 200 && set.body.data?.subject === 'own', `A's own default: ${set.status}`);
  const a = await json('/v1/designbook/kits/in-force', { headers: auth(A.token) });
  assert(a.status === 200 && a.body.data?.source === 'own' && a.body.data?.kit?.id === OWN, `A: ${JSON.stringify(a.body.data)}`);
  const anon = await json('/v1/designbook/kits/in-force');
  assert(anon.status === 401, `a visitor: ${anon.status}`);
});
await test('B cannot make A\'s own kit B\'s default', async () => {
  const r = await json('/v1/designbook/kits/default', { method: 'PUT', headers: auth(B.token), body: JSON.stringify({ kit: OWN }) });
  assert(r.status === 404, `B chooses A's own kit: ${r.status}`);
});

console.log('\n4. A kit for the whole node');
await test('A node kit with no app behind it waits for the operator; nobody else takes it meanwhile', async () => {
  const r = await propose(A.token, { id: NODE, kind: 'kit', title: 'A style for everyone', summary: 'Ink blue on paper.', body: { ...ownBody, reach: 'node' } });
  assert(r.status === 201 && r.body.data?.status === 'proposed' && /from_app/.test(r.body.data?.publishing?.why ?? ''), `propose ${r.status}: ${JSON.stringify(r.body?.data)}`);
  const c = await json(`/v1/designbook/${NODE}/adopt`, { method: 'POST', headers: auth(C.token), body: JSON.stringify({ filename: 'x.html' }) });
  assert(c.status === 403 && c.body.error?.code === 'NOT_PUBLISHED', `C takes it: ${c.status} ${c.body.error?.code}`);
});
await test('An id a narrower kit holds is refused without naming its proposer', async () => {
  const r = await propose(C.token, { id: OWN, kind: 'kit', title: 'x', summary: 'x', body: { reach: 'own', look: 'editorial' } });
  assert(r.status === 409 && r.body.error?.code === 'ID_TAKEN' && !String(r.body.error?.message).includes(A.name), `C under A's id: ${r.status} ${r.body.error?.message}`);
});

console.log('\n5. The MCP tools');
await test('aimeat_designbook_kit answers the organism\'s kit for a member\'s agent and refuses a non-member\'s', async () => {
  const agentB = await makeAgent(BASE, B, ['memory:read', 'memory:write']);
  const sb = await openSession(BASE, agentB.token);
  const ok = await callTool(sb, 'aimeat_designbook_kit', { organism: orgId });
  assert(!ok.isError && ok.data?.source === 'organism' && ok.data?.kit?.id === ORG, `B's agent: ${ok.text.slice(0, 300)}`);
  const agentC = await makeAgent(BASE, C, ['memory:read', 'memory:write']);
  const sc = await openSession(BASE, agentC.token);
  const no = await callTool(sc, 'aimeat_designbook_kit', { organism: orgId });
  assert(no.isError && no.text.includes('NOT_A_MEMBER'), `C's agent: ${no.text.slice(0, 300)}`);
});
await test('aimeat_designbook_kit_default chooses the person\'s own kit, clears it, and refuses a member\'s choice for the organism', async () => {
  const agentA = await makeAgent(BASE, A, ['memory:read', 'memory:write']);
  const sa = await openSession(BASE, agentA.token);
  const clear = await callTool(sa, 'aimeat_designbook_kit_default', { clear: true });
  assert(!clear.isError && clear.data?.kit === null, `clear: ${clear.text.slice(0, 300)}`);
  const none = await json('/v1/designbook/kits/in-force', { headers: auth(A.token) });
  assert(none.body.data?.kit === null, `cleared: ${JSON.stringify(none.body.data)}`);
  const set = await callTool(sa, 'aimeat_designbook_kit_default', { kit: OWN });
  assert(!set.isError && set.data?.kit === OWN, `set: ${set.text.slice(0, 300)}`);
  const agentB = await makeAgent(BASE, B, ['memory:read', 'memory:write']);
  const sb = await openSession(BASE, agentB.token);
  const no = await callTool(sb, 'aimeat_designbook_kit_default', { organism: orgId, kit: ORG });
  assert(no.isError && no.text.includes('NOT_ALLOWED'), `B's agent for the organism: ${no.text.slice(0, 300)}`);
});

await test('Cleanup: the kits and the defaults go', async () => {
  await json('/v1/designbook/kits/default', { method: 'PUT', headers: auth(A.token), body: JSON.stringify({ kit: null }) });
  await json('/v1/designbook/kits/default', { method: 'PUT', headers: auth(A.token), body: JSON.stringify({ organism: orgId, kit: null }) });
  for (const [id, token] of [[OWN, A.token], [NODE, A.token], [ORG, B.token]] as const) {
    const d = await json(`/v1/designbook/${id}`, { method: 'DELETE', headers: auth(token) });
    // The own kit was taken once, so it is retired instead of deleted.
    assert(d.status === 200 || (d.status === 409 && d.body.error?.code === 'PART_IN_USE'), `delete ${id}: ${d.status} ${d.body.error?.code}`);
  }
});

console.log(`\n  Total: ${passed} passed, ${failed} failed, 0 skipped out of ${passed + failed}`);
process.exit(failed ? 1 : 0);
