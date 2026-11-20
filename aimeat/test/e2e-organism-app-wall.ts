/**
 * @file test/e2e-organism-app-wall.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for an organism's own app wall (GET /v1/organisms/:id/apps, aimeat_organism_apps,
 *   services/app/organism-wall.ts) and for the new entry (/v1/goal-start, skill aimeat-goal-recipes).
 *   Asserted:
 *     - a member sees the apps two members opened to the organism, newest first, with name, address,
 *       author, opens and today's opens as counts, and capabilities; a public app and an app opened to
 *       another organism are not on it, nor one its owner made unlisted;
 *     - an open of an app shows in its counts;
 *     - DENIAL: an outsider is refused (403 ACCESS_DENIED), an unknown organism is 404, no token 401;
 *     - a member's agent reads the same over MCP;
 *     - the entry page is served as a page, and the skill it names is served.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=organism-app-wall
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-organisaation-oma-appisein-kollegoiden-apit-n-kyviin-eri-kul,
 *     wish-uusi-sis-ntulo-perusteet-opitaan-isoa-tavoitetta-rakentaessa).
 */
import { BASE, assert, expectRefusal, finish, json, test } from './helpers/harness.js';
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const STAMP = Date.now().toString(36);
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
type Body = Record<string, any>;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const wallOf = (org: string, token: string) => json<Body>(`/v1/organisms/${org}/apps?lang=fi`, { headers: auth(token) });

let alice!: RegisteredOwner, bob!: RegisteredOwner, carol!: RegisteredOwner;
let orgId = '', otherOrg = '';
const A_APP = `walla-${STAMP}.html`, B_APP = `wallb-${STAMP}.html`, HIDDEN = `wallh-${STAMP}.html`, PUBLIC = `wallp-${STAMP}.html`, ELSEWHERE = `walle-${STAMP}.html`;

async function publish(owner: RegisteredOwner, file: string, name: string, extra = '') {
  const r = await json<Body>('/v1/apps', { method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({ filename: file, content: b64(`<!DOCTYPE html><html><head>${extra}</head><body><h1>${name}</h1></body></html>`), name, description: `${name} does one job`, category: 'utility', tags: [] }) });
  assert(r.status === 201, `publish ${file}: ${r.status} ${JSON.stringify(r.body?.error)}`);
}
async function openTo(owner: RegisteredOwner, file: string, org: string) {
  const r = await json<Body>(`/v1/apps/${file}`, { method: 'PATCH', headers: auth(owner.token), body: JSON.stringify({ open_to: `organism:${org}` }) });
  assert(r.status === 200, `open_to ${file}: ${r.status} ${JSON.stringify(r.body?.error)}`);
}

console.log('\n=== An organism\'s own app wall, and the new entry ===\n');

await test('Setup: alice\'s organism with bob as a member, apps opened to it, and apps that must not show', async () => {
  alice = await registerOwner(BASE, `wala${STAMP}`);
  bob = await registerOwner(BASE, `walb${STAMP}`);
  carol = await registerOwner(BASE, `walc${STAMP}`);
  const o = await json<Body>('/v1/organisms', { method: 'POST', headers: auth(alice.token), body: JSON.stringify({ name: `Training ${STAMP}`, type: 'team', join_policy: 'invite_only', visibility: 'private' }) });
  assert(o.status === 201, `organism ${o.status} ${JSON.stringify(o.body?.error)}`);
  orgId = o.body.data.organism.id;
  const m = await json<Body>(`/v1/organisms/${orgId}/members`, { method: 'POST', headers: auth(alice.token), body: JSON.stringify({ ghii: bob.name }) });
  assert(m.status === 201, `member ${m.status} ${JSON.stringify(m.body?.error)}`);
  const other = await json<Body>('/v1/organisms', { method: 'POST', headers: auth(carol.token), body: JSON.stringify({ name: `Elsewhere ${STAMP}`, type: 'team', join_policy: 'invite_only', visibility: 'private' }) });
  assert(other.status === 201, `other organism ${other.status}`);
  otherOrg = other.body.data.organism.id;
  await publish(alice, A_APP, `Restock ${STAMP}`, '<script src="/v1/libs/aimeat-calendar.js"></script>');
  await openTo(alice, A_APP, orgId);
  await publish(bob, B_APP, `Decisions ${STAMP}`);
  await openTo(bob, B_APP, orgId);
  await publish(alice, HIDDEN, `Hidden ${STAMP}`);
  await openTo(alice, HIDDEN, orgId);
  const unlisted = await json<Body>(`/v1/apps/${HIDDEN}`, { method: 'PATCH', headers: auth(alice.token), body: JSON.stringify({ listing: 'unlisted' }) });
  assert(unlisted.status === 200, `unlisted ${unlisted.status} ${JSON.stringify(unlisted.body?.error)}`);
  await publish(carol, PUBLIC, `Public ${STAMP}`);
  await publish(carol, ELSEWHERE, `Elsewhere ${STAMP}`);
  await openTo(carol, ELSEWHERE, otherOrg);
});

await test('A member sees the two apps opened to the organism, newest first, and none of the others', async () => {
  const r = await wallOf(orgId, bob.token);
  assert(r.status === 200, `wall ${r.status} ${JSON.stringify(r.body?.error)}`);
  const apps = r.body.data.apps as Body[];
  const files = apps.map(a => a.filename);
  assert(JSON.stringify(files) === JSON.stringify([B_APP, A_APP]), `the wall: ${JSON.stringify(files)}`);
  assert(r.body.data.organism?.name === `Training ${STAMP}`, `the organism: ${JSON.stringify(r.body.data.organism)}`);
  const a = apps.find(x => x.filename === A_APP)!;
  assert(a.owner === alice.name && a.name === `Restock ${STAMP}` && a.description.includes('does one job'), `the app's facts: ${JSON.stringify(a)}`);
  assert(typeof a.url === 'string' && a.url.length > 0 && typeof a.published_at === 'string', `address and date: ${JSON.stringify(a)}`);
  assert(typeof a.opens === 'number' && typeof a.opens_today === 'number' && Array.isArray(a.teams), `counts and teams: ${JSON.stringify(a)}`);
  assert((a.capabilities as Body[]).some(c => c.id === 'aimeat-calendar' && c.kind === 'library' && typeof c.title === 'string'), `the calendar library is named: ${JSON.stringify(a.capabilities)}`);
});

await test('An open of an app shows in its count', async () => {
  const before = ((await wallOf(orgId, bob.token)).body.data.apps as Body[]).find(x => x.filename === B_APP)!.opens;
  const page = await fetch(`${BASE}/v1/apps/${bob.name}/${B_APP}`, { headers: auth(alice.token) });
  assert(page.status === 200, `open the app: ${page.status}`);
  await page.text();
  const after = ((await wallOf(orgId, alice.token)).body.data.apps as Body[]).find(x => x.filename === B_APP)!.opens;
  assert(after === before + 1, `opens ${before} → ${after}`);
});

await test('DENIAL: an outsider is refused, an unknown organism is not found, and no token is not signed in', async () => {
  const outsider = await wallOf(orgId, carol.token);
  expectRefusal(outsider, 403, 'ACCESS_DENIED');
  const unknown = await wallOf(`org-none-${STAMP}`, bob.token);
  expectRefusal(unknown, 404, 'NOT_FOUND');
  const anonymous = await json<Body>(`/v1/organisms/${orgId}/apps`);
  assert(outsider.status === 403 && anonymous.status === 401, `refusals: ${outsider.status}, ${anonymous.status}`);
  assert(!JSON.stringify(outsider.body).includes(A_APP), 'the refusal names no app');
});

await test('A member\'s agent reads the same wall over MCP; an outsider\'s agent is refused', async () => {
  const agent = await makeAgent(BASE, bob, ['*'], `walag${STAMP.slice(-5)}`);
  const s = await openSession(BASE, agent.token, 'org wall reader');
  const t = await callTool(s, 'aimeat_organism_apps', { organism_id: orgId, lang: 'fi' });
  assert(!t.isError && t.text.includes(A_APP) && t.text.includes(B_APP) && !t.text.includes(HIDDEN), `MCP: ${t.text.slice(0, 300)}`);
  const stranger = await makeAgent(BASE, carol, ['*'], `walcg${STAMP.slice(-5)}`);
  const s2 = await openSession(BASE, stranger.token, 'org wall outsider');
  const t2 = await callTool(s2, 'aimeat_organism_apps', { organism_id: orgId });
  assert(t2.isError && t2.text.includes('ACCESS_DENIED'), `outsider over MCP: ${t2.text.slice(0, 200)}`);
});

await test('The entry page is served as a page, and the skill it names is served', async () => {
  const page = await fetch(`${BASE}/v1/goal-start`, { headers: { Accept: 'text/html' } });
  const text = await page.text();
  assert(page.status === 200 && text.includes('<html'), `the page: ${page.status}`);
  const agent = await makeAgent(BASE, alice, ['*'], `walsk${STAMP.slice(-5)}`);
  const s = await openSession(BASE, agent.token, 'goal recipes reader');
  const skill = await callTool(s, 'aimeat_skill_get', { ref: 'node:aimeat-goal-recipes', body_only: true });
  assert(!skill.isError && skill.text.includes('Say the capabilities before doing anything'), `the skill: ${skill.text.slice(0, 200)}`);
});

finish();
