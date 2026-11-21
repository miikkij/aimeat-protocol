/**
 * @file test/e2e-skill-bound-public.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A NEW user skill bound to an app (metadata.binding) and published without a
 *   visibility is public, on POST /v1/skills and over MCP (aimeat_skill_publish), so whoever uses the
 *   app, and that person's AI, can read the app's operating guide. A skill bound to an app is
 *   written for the app's users; published at `owner` by default it answered 404 to every one of
 *   them until the author remembered to make it public.
 *
 *   What stays as it was: an explicit visibility wins, a skill already in the registry keeps the
 *   level it has when republished without one, and a skill bound to no app is `owner`. Another
 *   owner cannot read a bound skill the author kept at `owner`.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=skill-bound-public
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (pitfall round B5).
 */
import { randomBytes } from 'node:crypto';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';
import { BASE, assert, expectRefusal, finish, json, test } from './helpers/harness.js';

const stamp = Date.now().toString(36) + randomBytes(2).toString('hex');
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

console.log('\n=== A skill bound to an app is public by default ===\n');

const alice = await registerOwner(BASE, `sbpa${stamp}`);
const bob = await registerOwner(BASE, `sbpb${stamp}`);
const agent = await makeAgent(BASE, alice, ['memory:read', 'memory:write']);

const md = (name: string, bound: boolean) => [
  '---', `name: ${name}`, 'description: How to use the quiz app. Use when working inside it.',
  ...(bound ? ['metadata:', `  binding: "app:${alice.name}/quiz-${stamp}.html"`] : []),
  '---', '', '# Quiz', '', 'Open a round and press start.', '',
].join('\n');
const publish = (body: Record<string, unknown>) =>
  json('/v1/skills', { method: 'POST', headers: auth(alice.token), body: JSON.stringify(body) });
/** The skill as a caller sees it: no token reads as a signed-out visitor. */
const read = (name: string, token?: string) =>
  json(`/v1/skills/${name}?scope=user&owner=${alice.name}&manifest_only=true`, { headers: token ? auth(token) : {} });

await test('POSITIVE: a new bound skill published with no visibility is public, and a signed-out caller reads it', async () => {
  const name = `quiz-guide-${stamp}`;
  const r = await publish({ skill_md: md(name, true) });
  assert(r.status === 201 && r.body.data.skill.visibility === 'public', `publish ${r.status}: ${JSON.stringify(r.body.data?.skill?.visibility ?? r.body?.error)}`);
  assert(typeof r.body.data.visibility_default === 'string' && /public/.test(r.body.data.visibility_default), `the answer says why: ${JSON.stringify(r.body.data.visibility_default)}`);
  const out = await read(name);
  assert(out.status === 200 && out.body.data.skill?.name === name, `signed-out read ${out.status}`);
});

await test('POSITIVE (MCP): an agent publishing a new bound skill with no visibility gets it public too', async () => {
  const name = `quiz-mcp-${stamp}`;
  const s = await openSession(BASE, agent.token, 'skill-bound-public');
  const r = await callTool(s, 'aimeat_skill_publish', { skill_md: md(name, true) });
  assert(!r.isError && r.data.skill?.visibility === 'public', `MCP publish: ${r.text.slice(0, 300)}`);
  assert(typeof r.data.visibility_default === 'string', `the answer says why: ${r.text.slice(0, 300)}`);
  assert((await read(name)).status === 200, 'a signed-out caller reads the MCP-published guide');
});

await test('FAILURE CASE: an explicit visibility wins, and another owner cannot read a bound skill kept at owner', async () => {
  const name = `quiz-private-${stamp}`;
  const r = await publish({ skill_md: md(name, true), visibility: 'owner' });
  assert(r.status === 201 && r.body.data.skill.visibility === 'owner' && r.body.data.visibility_default === undefined,
    `explicit owner: ${JSON.stringify(r.body.data?.skill?.visibility)} ${JSON.stringify(r.body.data?.visibility_default)}`);
  expectRefusal(await read(name, bob.token), 403, 'FORBIDDEN');
  expectRefusal(await read(name), 403, 'FORBIDDEN');
  assert((await read(name, alice.token)).status === 200, 'the author still reads their own skill');
});

await test('EDGE: a skill already in the registry keeps its level on a republish with no visibility', async () => {
  const name = `quiz-private-${stamp}`;
  const r = await publish({ skill_md: md(name, true).replace('press start', 'press start, then read the score') });
  assert(r.status === 201 && r.body.data.skill.visibility === 'owner' && r.body.data.visibility_default === undefined,
    `republish: ${JSON.stringify(r.body.data?.skill?.visibility)}`);
  expectRefusal(await read(name, bob.token), 403, 'FORBIDDEN');
});

await test('EDGE: a skill bound to no app stays at owner when no visibility is named', async () => {
  const name = `free-guide-${stamp}`;
  const r = await publish({ skill_md: md(name, false) });
  assert(r.status === 201 && r.body.data.skill.visibility === 'owner' && r.body.data.visibility_default === undefined,
    `unbound: ${JSON.stringify(r.body.data?.skill?.visibility)}`);
  expectRefusal(await read(name, bob.token), 403, 'FORBIDDEN');
});

finish();
