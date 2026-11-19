/**
 * @file test/e2e-cross-owner-roster.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The organism member list says which admitted agent may write an app's fenced spaces
 *   directly (`writes_past_app_rules`: the agent's grant covers organism:direct, organism:* or *),
 *   on GET /v1/organisms/:id/members and aimeat_organism_members alike (services/organism/privacy.ts
 *   writesPastAppRules). What must not change: an agent without the word reads false, a caller who is
 *   not a member is told no agent at all, and an agent the organism does not admit is not named.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=cross-owner-roster
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial.
 */
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';
import { BASE, assert, auth, harness, json } from './helpers/purpose-kit.js';

const h = harness('Who may write past an app\'s rules, on the organism member list');
const STAMP = Date.now().toString(36);

const owner = await registerOwner(BASE, `xorown${STAMP}`);    // owns the organism
const member = await registerOwner(BASE, `xormem${STAMP}`);   // another account, with three agents
const outsider = await registerOwner(BASE, `xorout${STAMP}`); // not a member
let orgId = '';
let direct: Awaited<ReturnType<typeof makeAgent>>, plain: Awaited<ReturnType<typeof makeAgent>>, star: Awaited<ReturnType<typeof makeAgent>>;

const membersOf = (token: string) => json(`/v1/organisms/${orgId}/members`, { headers: auth(token) });
const agentsOfMember = (body: any) => (body?.data?.members ?? []).find((m: any) => m.ghii === member.name)?.agents ?? null;

await h.test('setup: an invite_only organism, a member of another account, and three agents of that member', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ name: `Shared Room ${STAMP}`, type: 'team', join_policy: 'invite_only', visibility: 'private' }) });
    assert(o.status === 201, `organism ${o.status} ${JSON.stringify(o.body?.error)}`);
    orgId = o.body.data.organism.id;
    const m = await json(`/v1/organisms/${orgId}/members`, { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ ghii: member.name }) });
    assert(m.status === 201, `add member ${m.status} ${JSON.stringify(m.body?.error)}`);
    direct = await makeAgent(BASE, member, ['organism:read', 'organism:direct'], `xordirect${STAMP}`);
    plain = await makeAgent(BASE, member, ['organism:read', 'organism:write'], `xorplain${STAMP}`);
    star = await makeAgent(BASE, member, ['*'], `xorstar${STAMP}`);
});

await h.test('1. the owner reads each agent of the other account with writes_past_app_rules: direct and * true, the plain one false', async () => {
    const r = await membersOf(owner.token);
    assert(r.status === 200 && r.body.data.agents_included === true, `members ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data?.agents_included)}`);
    const agents = agentsOfMember(r.body);
    const flag = (gaii: string) => agents?.find((a: any) => a.gaii === gaii)?.writes_past_app_rules;
    assert(flag(direct.gaii) === true, `organism:direct: ${JSON.stringify(agents)}`);
    assert(flag(star.gaii) === true, `*: ${JSON.stringify(agents)}`);
    assert(flag(plain.gaii) === false, `organism:write alone: ${JSON.stringify(agents)}`);
});

await h.test('2. aimeat_organism_members answers the same flags', async () => {
    const ownerAgent = await makeAgent(BASE, owner, ['organism:read'], `xorownbot${STAMP}`);
    const s = await openSession(BASE, ownerAgent.token, 'e2e-cross-owner-roster');
    const t = await callTool(s, 'aimeat_organism_members', { organism_id: orgId });
    assert(!t.isError, `tool ${t.text}`);
    const rows = Array.isArray(t.data) ? t.data : (t.data?.members ?? []);
    const agents = rows.find((m: any) => m.ghii === member.name)?.agents ?? [];
    const flag = (gaii: string) => agents.find((a: any) => a.gaii === gaii)?.writes_past_app_rules;
    assert(flag(direct.gaii) === true && flag(star.gaii) === true && flag(plain.gaii) === false, `MCP agents: ${JSON.stringify(agents)}`);
});

await h.test('3. a caller who is not a member is told no agent at all', async () => {
    const r = await membersOf(outsider.token);
    assert(r.status === 404 || agentsOfMember(r.body) === null, `outsider sees agents: ${r.status} ${String(JSON.stringify(r.body?.data)).slice(0, 300)}`);
});

await h.test('4. with agent_access listed, an agent not on the list is not named, flag or no flag', async () => {
    const put = await json(`/v1/organisms/${orgId}`, { method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ agent_access: 'listed' }) });
    assert(put.status === 200, `agent_access ${put.status} ${JSON.stringify(put.body?.error)}`);
    const attach = await json(`/v1/organisms/${orgId}/agents`, { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ agent_gaii: plain.gaii }) });
    assert(attach.status === 201, `attach ${attach.status} ${JSON.stringify(attach.body?.error)}`);
    const agents = agentsOfMember((await membersOf(owner.token)).body) ?? [];
    assert(agents.length === 1 && agents[0].gaii === plain.gaii && agents[0].writes_past_app_rules === false, `listed: ${JSON.stringify(agents)}`);
});

h.finish();
