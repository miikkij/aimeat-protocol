/**
 * @file test/e2e-team-governance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How a team is governed, end to end.
 *   T16, the operator's view: GET /v1/admin/teams and aimeat_admin_teams give every team with counts
 *   only and never a record title or the team context; an ordinary owner, an agent without
 *   operator:admin and a caller with no token are refused.
 *   T19, a decision shared with other teams: a dry run first, a copy that names where it came from in
 *   each team the sharer is in, a team the sharer is not in refused with the reason, a copy not shared
 *   on, a withdrawal as a new record through the MCP tool.
 *   T7, the approval gate: an agent's delete in the team and a send by an agent that works for the
 *   team wait for a lead, the approver is recorded and the same call then runs; the person in person
 *   is not held; a lead turns the gate off and on, a member cannot; a declined ask is told back; an
 *   approval is not filed by hand, not edited and not decided by a member.
 * @structure t01..t15 in order; each later test reads what the earlier ones made.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=team-governance
 * @version-history
 *   v1.1.0 — 2026-11-15 — T19 (t05..t09) and T7 (t10..t15); renamed from e2e-team-admin.ts.
 *   v1.0.0 — 2026-11-15 — Initial (wish-tiimipaketti-viisi-syyt-valita-aimeat-nopeasti-k-ytt-n, T16).
 */
import { registerOwner, setupOperator, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'TestAdminPw123!';
let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    for (let i = 0; ; i++) {
        const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
        if (res.status === 429 && i < 5) { await new Promise(r => setTimeout(r, 1000 * (i + 1))); continue; }
        const ct = res.headers.get('content-type') ?? '';
        return { status: res.status, body: ct.includes('json') ? await res.json() as any : { _raw: await res.text() } };
    }
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const stamp = Date.now().toString(36).slice(-5);
console.log('\n=== Teams E2E: the operator\'s view ===\n');

let operator!: RegisteredOwner, lead!: RegisteredOwner, member!: RegisteredOwner;
let teamId = '';
const SECRET_TITLE = `Salainen päätös ${stamp}`;

await test('t01 setup: an operator, a lead with a team and a decision, a member', async () => {
    operator = await setupOperator(BASE, ADMIN_PW, `tadmop${stamp}`);
    lead = await registerOwner(BASE, `tadml${stamp}`, { body: { locale: 'fi' } });
    member = await registerOwner(BASE, `tadmm${stamp}`, { body: { locale: 'en' } });
    const made = await json('/v1/teams/setup', {
        method: 'POST', headers: auth(lead.token),
        body: JSON.stringify({ dry_run: false, teams: [{ name: `Hallitus ${stamp}`, language: 'fi', members: [member.name] }] }),
    });
    assert(made.status === 201, `setup ${made.status} ${JSON.stringify(made.body.error ?? '')}`);
    teamId = made.body.data.teams[0].organism_id;
    // A decision written the way a pasted chat answer writes one (POST /v1/teams/:id/paste).
    const paste = await json(`/v1/teams/${teamId}/paste`, {
        method: 'POST', headers: auth(lead.token), body: JSON.stringify({ text: `DECISION: ${SECRET_TITLE} | budjetti`, dry_run: false }),
    });
    assert(paste.status === 201 && paste.body.data.written === 1, `paste ${paste.status} ${JSON.stringify(paste.body.error ?? paste.body.data)}`);
});

await test('t02 the operator sees the team with counts and no content', async () => {
    const r = await json('/v1/admin/teams', { headers: auth(operator.token) });
    assert(r.status === 200, `status ${r.status}`);
    const row = r.body.data.teams.find((t: any) => t.organism_id === teamId);
    assert(row, 'the team is listed');
    assert(row.leads.includes(lead.name) && row.members === 1, `leads and members: ${JSON.stringify(row)}`);
    assert(row.week.decided === 1, `a decided decision counted: ${JSON.stringify(row.week)}`);
    assert(!JSON.stringify(r.body).includes(SECRET_TITLE), 'no record title in the answer');
});

await test('t03 aimeat_admin_teams answers the same for the operator\'s agent with operator:admin', async () => {
    const agent = await makeAgent(BASE, operator, ['operator:admin']);
    const ai = await openSession(BASE, agent.token, 'team-admin-op');
    const r = await callTool(ai, 'aimeat_admin_teams', {});
    assert(!r.isError, `tool error: ${r.text.slice(0, 200)}`);
    const row = r.data.teams.find((t: any) => t.organism_id === teamId);
    assert(row && row.members === 1 && !r.text.includes(SECRET_TITLE), `tool row: ${JSON.stringify(row)}`);
});

await test('t04 refusals: an owner, an agent without operator:admin, no token', async () => {
    const owner = await json('/v1/admin/teams', { headers: auth(lead.token) });
    assert(owner.status === 403, `an ordinary owner: ${owner.status}`);
    const wide = await makeAgent(BASE, operator, ['organism:read', 'memory:read']);
    const agent = await json('/v1/admin/teams', { headers: auth(wide.token) });
    assert(agent.status === 403, `an operator's agent without operator:admin: ${agent.status}`);
    const anon = await json('/v1/admin/teams');
    assert(anon.status === 401, `no token: ${anon.status}`);
});

// ── T19: a decision shared with other teams ──
let salesId = '', boardId = '', decisionId = '';

await test('t05 setup: the lead also leads a sales team; a board team has the member only', async () => {
    const made = await json('/v1/teams/setup', {
        method: 'POST', headers: auth(lead.token),
        body: JSON.stringify({ dry_run: false, teams: [{ name: `Myynti ${stamp}`, language: 'fi' }] }),
    });
    assert(made.status === 201, `sales ${made.status}`);
    salesId = made.body.data.teams[0].organism_id;
    const board = await json('/v1/teams/setup', {
        method: 'POST', headers: auth(member.token),
        body: JSON.stringify({ dry_run: false, teams: [{ name: `Board ${stamp}`, language: 'en' }] }),
    });
    assert(board.status === 201, `board ${board.status}`);
    boardId = board.body.data.teams[0].organism_id;
    const st = await json(`/v1/teams/status?organism_id=${teamId}`, { headers: auth(lead.token) });
    const ws = st.body.data.teams[0].workspaces.decisions;
    const read = await json(`/v1/organisms/${teamId}/workspace?ws=${ws}`, { headers: auth(lead.token) });
    const key = JSON.stringify(read.body).match(/(pasted-[a-z0-9]+-1)/)?.[1];
    assert(key, `the pasted decision's id: ${JSON.stringify(read.body).slice(0, 300)}`);
    decisionId = key;
});

await test('t06 a dry run names what would be written and writes nothing; a team the sharer is not in is refused', async () => {
    const r = await json(`/v1/teams/${teamId}/decisions/${decisionId}/share`, {
        method: 'POST', headers: auth(lead.token), body: JSON.stringify({ to: [salesId, boardId] }),
    });
    assert(r.status === 200 && r.body.data.dry_run === true, `dry run ${r.status} ${JSON.stringify(r.body.error ?? '')}`);
    const t = Object.fromEntries(r.body.data.targets.map((x: any) => [x.organism_id, x]));
    assert(t[salesId].result === 'share' && t[boardId].result === 'refused' && /ask one of its members/.test(t[boardId].reason), `targets ${JSON.stringify(r.body.data.targets)}`);
    const st = await json(`/v1/teams/status?organism_id=${salesId}`, { headers: auth(lead.token) });
    assert(st.body.data.teams[0].week.decided === 0, 'nothing written by the dry run');
});

await test('t07 the share writes a copy that names where it came from; a copy cannot be shared on', async () => {
    const r = await json(`/v1/teams/${teamId}/decisions/${decisionId}/share`, {
        method: 'POST', headers: auth(lead.token), body: JSON.stringify({ to: [salesId], dry_run: false }),
    });
    assert(r.status === 201 && r.body.data.targets[0].result === 'share', `share ${r.status} ${JSON.stringify(r.body.data ?? r.body.error)}`);
    const st = await json(`/v1/teams/status?organism_id=${salesId}`, { headers: auth(lead.token) });
    const ws = st.body.data.teams[0].workspaces.decisions;
    const read = await json(`/v1/organisms/${salesId}/workspace?ws=${ws}`, { headers: auth(lead.token) });
    const text = JSON.stringify(read.body);
    assert(text.includes(SECRET_TITLE) && text.includes(teamId), 'the copy carries the title and the source team');
    const copyId = r.body.data.targets[0].record_id;
    const again = await json(`/v1/teams/${salesId}/decisions/${copyId}/share`, {
        method: 'POST', headers: auth(lead.token), body: JSON.stringify({ to: [teamId], dry_run: false }),
    });
    assert(again.status === 400, `a copy shared on: ${again.status}`);
});

await test('t08 the share is withdrawn with a new record, through the MCP tool', async () => {
    const agent = await makeAgent(BASE, lead, ['organism:write', 'organism:read']);
    const ai = await openSession(BASE, agent.token, 'team-share-ai');
    const r = await callTool(ai, 'aimeat_team_decision_share', { organism_id: teamId, decision: decisionId, to: [salesId], withdraw: true, dry_run: false });
    assert(!r.isError && r.data.targets[0].result === 'withdraw', `withdraw: ${r.text.slice(0, 200)}`);
    const st = await json(`/v1/teams/status?organism_id=${salesId}`, { headers: auth(lead.token) });
    const ws = st.body.data.teams[0].workspaces.decisions;
    const read = await json(`/v1/organisms/${salesId}/workspace?ws=${ws}`, { headers: auth(lead.token) });
    assert(JSON.stringify(read.body).includes('"withdrawn"'), 'a withdrawn record is in the sales team');
});

await test('t09 refusals: a non-member of the source team, an agent without organism:write', async () => {
    const outsider = await json(`/v1/teams/${teamId}/decisions/${decisionId}/share`, {
        method: 'POST', headers: auth(operator.token), body: JSON.stringify({ to: [salesId], dry_run: false }),
    });
    assert(outsider.status === 404, `outsider ${outsider.status}`);
    const reader = await makeAgent(BASE, lead, ['organism:read']);
    const noWrite = await json(`/v1/teams/${teamId}/decisions/${decisionId}/share`, {
        method: 'POST', headers: auth(reader.token), body: JSON.stringify({ to: [salesId] }),
    });
    assert(noWrite.status === 403, `without organism:write: ${noWrite.status}`);
});

// ── T7: the team's approval gate ──
let sharedWs = '', itemIds: string[] = [], leadAgent!: { name: string; gaii: string; token: string };
const deleteBody = (ids: string[]) => JSON.stringify({ ws: sharedWs, namespace: 'shared.items', ids });

await test('t10 setup: three open items in the team, the lead\'s agent with delete words', async () => {
    const st = await json(`/v1/teams/status?organism_id=${teamId}`, { headers: auth(lead.token) });
    assert(st.body.data.teams[0].approval_gate === true, `a new team has the gate on: ${st.body.data.teams[0].approval_gate}`);
    sharedWs = st.body.data.teams[0].workspaces.shared;
    const paste = await json(`/v1/teams/${teamId}/paste`, {
        method: 'POST', headers: auth(lead.token), body: JSON.stringify({ text: `OPEN: eka ${stamp}\nOPEN: toka ${stamp}\nOPEN: kolmas ${stamp}`, dry_run: false }),
    });
    assert(paste.status === 201 && paste.body.data.written === 3, `paste ${paste.status}`);
    const read = await json(`/v1/organisms/${teamId}/workspace?ws=${sharedWs}`, { headers: auth(lead.token) });
    itemIds = [...new Set(JSON.stringify(read.body).match(/pasted-[a-z0-9]+-[123]/g) ?? [])].sort();
    assert(itemIds.length === 3, `three item ids: ${itemIds}`);
    leadAgent = await makeAgent(BASE, lead, ['organism:read', 'organism:write', 'memory:read', 'memory:delete', 'messages:send']);
});

let approvalId = '';
await test('t11 the agent\'s delete waits for a lead; asking again files no second approval', async () => {
    const first = await json(`/v1/organisms/${teamId}/workspace/records/delete`, { method: 'POST', headers: auth(leadAgent.token), body: deleteBody([itemIds[0]]) });
    assert(first.status === 403 && first.body.error?.code === 'TEAM_APPROVAL_REQUIRED', `first ${first.status} ${JSON.stringify(first.body.error)}`);
    approvalId = first.body.error.details.approval_id;
    const again = await json(`/v1/organisms/${teamId}/workspace/records/delete`, { method: 'POST', headers: auth(leadAgent.token), body: deleteBody([itemIds[0]]) });
    assert(again.body.error?.details?.approval_id === approvalId, 'the same approval');
    const w = await json('/v1/teams/waiting', { headers: auth(lead.token) });
    assert(w.body.data.approvals.some((a: any) => a.id === approvalId), 'the lead sees it in what waits');
    const st = await json(`/v1/organisms/${teamId}/workspace?ws=${sharedWs}`, { headers: auth(lead.token) });
    assert(JSON.stringify(st.body).includes(itemIds[0]), 'nothing was deleted');
});

await test('t12 a lead approves, the approver is recorded, and the same call then runs', async () => {
    const dec = await json(`/v1/organisms/${teamId}/approvals/${approvalId}`, { method: 'POST', headers: auth(lead.token), body: JSON.stringify({ decision: 'approve' }) });
    assert(dec.status === 200 && dec.body.data.approval.decidedBy?.startsWith(lead.name), `approve ${dec.status} ${JSON.stringify(dec.body.data?.approval ?? dec.body.error)}`);
    const run = await json(`/v1/organisms/${teamId}/workspace/records/delete`, { method: 'POST', headers: auth(leadAgent.token), body: deleteBody([itemIds[0]]) });
    assert(run.status === 200 && run.body.data.deleted.length === 1, `after approval ${run.status} ${JSON.stringify(run.body.error ?? run.body.data)}`);
    const other = await json(`/v1/organisms/${teamId}/workspace/records/delete`, { method: 'POST', headers: auth(leadAgent.token), body: deleteBody([itemIds[1]]) });
    assert(other.status === 403 && other.body.error.details.approval_id !== approvalId, 'a different delete needs its own approval');
});

await test('t13 the person in person is not held; a lead turns the gate off and the agent then deletes', async () => {
    const own = await json(`/v1/organisms/${teamId}/workspace/records/delete`, { method: 'POST', headers: auth(lead.token), body: deleteBody([itemIds[1]]) });
    assert(own.status === 200, `the lead's own delete ${own.status} ${JSON.stringify(own.body.error ?? '')}`);
    const byMember = await json('/v1/teams/setup', { method: 'POST', headers: auth(member.token), body: JSON.stringify({ dry_run: false, teams: [{ organism_id: teamId, approval_gate: false }] }) });
    const still = await json(`/v1/teams/status?organism_id=${teamId}`, { headers: auth(lead.token) });
    assert(still.body.data.teams[0].approval_gate === true, `a member cannot turn it off (${byMember.status})`);
    const off = await json('/v1/teams/setup', { method: 'POST', headers: auth(lead.token), body: JSON.stringify({ dry_run: false, teams: [{ organism_id: teamId, approval_gate: false }] }) });
    assert(off.status === 201, `off ${off.status} ${JSON.stringify(off.body.error ?? '')}`);
    const run = await json(`/v1/organisms/${teamId}/workspace/records/delete`, { method: 'POST', headers: auth(leadAgent.token), body: deleteBody([itemIds[2]]) });
    assert(run.status === 200, `with the gate off ${run.status} ${JSON.stringify(run.body.error ?? '')}`);
    const on = await json('/v1/teams/setup', { method: 'POST', headers: auth(lead.token), body: JSON.stringify({ dry_run: false, teams: [{ organism_id: teamId, approval_gate: true }] }) });
    assert(on.status === 201, 'on again');
});

await test('t14 a send by an agent that works for the team waits; an agent with no workplace is not held', async () => {
    const plain = await json('/v1/messages', { method: 'POST', headers: auth(leadAgent.token), body: JSON.stringify({ to: member.ghii, body: `hei ${stamp}` }) });
    assert(plain.status === 201, `no workplace: ${plain.status} ${JSON.stringify(plain.body.error ?? '')}`);
    const wp = await json(`/v1/agents/${leadAgent.name}/workplace`, { method: 'PUT', headers: auth(lead.token), body: JSON.stringify({ organism_id: teamId, workspace_id: sharedWs }) });
    assert(wp.status === 200, `workplace ${wp.status} ${JSON.stringify(wp.body.error ?? '')}`);
    const msg = JSON.stringify({ to: member.ghii, body: `tarjous lähtee ${stamp}` });
    const held = await json('/v1/messages', { method: 'POST', headers: auth(leadAgent.token), body: msg });
    assert(held.status === 403 && held.body.error?.code === 'TEAM_APPROVAL_REQUIRED', `held ${held.status} ${JSON.stringify(held.body.error)}`);
    const dec = await json(`/v1/organisms/${teamId}/approvals/${held.body.error.details.approval_id}`, { method: 'POST', headers: auth(lead.token), body: JSON.stringify({ decision: 'approve' }) });
    assert(dec.status === 200, `approve ${dec.status}`);
    const sent = await json('/v1/messages', { method: 'POST', headers: auth(leadAgent.token), body: msg });
    assert(sent.status === 201, `after approval ${sent.status} ${JSON.stringify(sent.body.error ?? '')}`);
});

await test('t15 a declined ask is told back; refusals: filed by hand, edited, decided by a member', async () => {
    const msg = JSON.stringify({ to: member.ghii, body: `toinen ${stamp}` });
    const held = await json('/v1/messages', { method: 'POST', headers: auth(leadAgent.token), body: msg });
    const aid = held.body.error?.details?.approval_id;
    assert(aid, 'held');
    const byMember = await json(`/v1/organisms/${teamId}/approvals/${aid}`, { method: 'POST', headers: auth(member.token), body: JSON.stringify({ decision: 'approve' }) });
    assert(byMember.status === 403, `a member decides: ${byMember.status}`);
    const edit = await json(`/v1/organisms/${teamId}/approvals/${aid}`, { method: 'POST', headers: auth(lead.token), body: JSON.stringify({ decision: 'edit', editedArguments: {} }) });
    assert(edit.status === 400, `edit: ${edit.status}`);
    const no = await json(`/v1/organisms/${teamId}/approvals/${aid}`, { method: 'POST', headers: auth(lead.token), body: JSON.stringify({ decision: 'reject', note: 'ei nyt' }) });
    assert(no.status === 200, `reject ${no.status}`);
    const after = await json('/v1/messages', { method: 'POST', headers: auth(leadAgent.token), body: msg });
    assert(after.status === 403 && after.body.error?.code === 'TEAM_APPROVAL_DECLINED', `declined ${after.status} ${JSON.stringify(after.body.error)}`);
    const forged = await json(`/v1/organisms/${teamId}/approvals`, { method: 'POST', headers: auth(leadAgent.token), body: JSON.stringify({ action: 'team:delete', arguments: { fingerprint: 'x' } }) });
    assert(forged.status === 400, `filed by hand: ${forged.status}`);
});

// ── T12: a team moved with its people ──
let bundle = '';

await test('t16 the export names the people and the team; a preview says what would come back and makes nothing', async () => {
    // The member joins the first team, so the bundle has a member as well as the lead.
    const joined = await json(`/v1/organisms/${teamId}/invitations/accept`, { method: 'POST', headers: auth(member.token), body: '{}' });
    assert(joined.status < 300, `member accepts ${joined.status} ${JSON.stringify(joined.body.error ?? '')}`);
    const ex = await json(`/v1/organisms/${teamId}/export?format=base64`, { headers: auth(lead.token) });
    assert(ex.status === 200 && ex.body.data.zip_base64, `export ${ex.status} ${JSON.stringify(ex.body.error ?? '')}`);
    bundle = ex.body.data.zip_base64;
    const before = (await json('/v1/organisms', { headers: auth(lead.token) })).body.data;
    const pv = await json('/v1/organisms/import', { method: 'POST', headers: auth(lead.token), body: JSON.stringify({ zip_base64: bundle, preview: true }) });
    assert(pv.status === 200 && pv.body.data.preview === true, `preview ${pv.status} ${JSON.stringify(pv.body.error ?? '')}`);
    const people = pv.body.data.people;
    assert(people.some((p: any) => p.identity.startsWith(`${member.name}@`) && p.role === 'member' && p.this_node === true), `member in the bundle: ${JSON.stringify(people)}`);
    assert(people.some((p: any) => p.identity.startsWith(`${lead.name}@`) && p.lead === true), 'the lead in the bundle');
    assert(pv.body.data.team?.approval_gate === true && pv.body.data.considerations.length > 0, `team and considerations: ${JSON.stringify(pv.body.data.team)}`);
    const after = (await json('/v1/organisms', { headers: auth(lead.token) })).body.data;
    assert(JSON.stringify(after).length === JSON.stringify(before).length || (after.organisms ?? after).length === (before.organisms ?? before).length, 'the preview made nothing');
});

await test('t17 people "none": the team comes back with its gate and skill, and nobody is invited', async () => {
    const r = await json('/v1/organisms/import', { method: 'POST', headers: auth(lead.token), body: JSON.stringify({ zip_base64: bundle }) });
    assert(r.status === 201, `import ${r.status} ${JSON.stringify(r.body.error ?? '')}`);
    const d = r.body.data;
    assert(d.team?.restored === true && d.team.skill, `team ${JSON.stringify(d.team)}`);
    assert(d.people.find((p: any) => p.identity.startsWith(`${member.name}@`))?.result === 'not_invited', `member: ${JSON.stringify(d.people)}`);
    const st = await json(`/v1/teams/status?organism_id=${d.organism_id}`, { headers: auth(lead.token) });
    assert(st.status === 200 && st.body.data.teams[0].approval_gate === true && st.body.data.teams[0].members.length === 1, `restored team: ${JSON.stringify(st.body.data?.teams?.[0]?.members)}`);
    const inv = await json('/v1/organisms/invitations/mine', { headers: auth(member.token) });
    assert(!JSON.stringify(inv.body).includes(d.organism_id), 'no invitation for the member');
});

await test('t18 people "invite": the member is invited with their role and joins with one accept', async () => {
    const r = await json('/v1/organisms/import', { method: 'POST', headers: auth(lead.token), body: JSON.stringify({ zip_base64: bundle, people: 'invite' }) });
    assert(r.status === 201, `import ${r.status}`);
    const d = r.body.data;
    assert(d.people.find((p: any) => p.identity.startsWith(`${member.name}@`))?.result === 'invited', `invited: ${JSON.stringify(d.people)}`);
    assert(d.people.find((p: any) => p.identity.startsWith(`${lead.name}@`))?.result === 'you', 'the importer is you');
    const acc = await json(`/v1/organisms/${d.organism_id}/invitations/accept`, { method: 'POST', headers: auth(member.token), body: '{}' });
    assert(acc.status < 300, `accept ${acc.status} ${JSON.stringify(acc.body.error ?? '')}`);
    const st = await json(`/v1/teams/status?organism_id=${d.organism_id}`, { headers: auth(member.token) });
    assert(st.status === 200 && st.body.data.teams[0].members.some((m: any) => m.account === member.name), 'the member is in the moved team');
});

await test('t19 refusals: an outsider\'s export, an agent without organism:write imports', async () => {
    const out = await json(`/v1/organisms/${teamId}/export?format=base64`, { headers: auth(operator.token) });
    assert(out.status === 403 || out.status === 404, `outsider export ${out.status}`);
    const reader = await makeAgent(BASE, lead, ['organism:read']);
    const imp = await json('/v1/organisms/import', { method: 'POST', headers: auth(reader.token), body: JSON.stringify({ zip_base64: bundle, preview: true }) });
    assert(imp.status === 403, `without organism:write ${imp.status}`);
});

// ── T11: the team's AI onboarding, recorded (EU AI Act art. 4) ──
await test('t20 the team skill carries the onboarding section; status says the member has not done it', async () => {
    const st = await json(`/v1/teams/status?organism_id=${teamId}`, { headers: auth(member.token) });
    const team = st.body.data.teams[0];
    assert(team.ai_onboarding.you === null && team.ai_onboarding.done === 0 && team.ai_onboarding.of === 2, `before: ${JSON.stringify(team.ai_onboarding)}`);
    assert(team.ai_onboarding.who === undefined, 'a member sees no list of who');
    const [skillOwner, skillName] = String(team.skill).replace(/^user:/, '').split('/');
    const sk = await json(`/v1/skills/${encodeURIComponent(skillName)}?scope=user&owner=${encodeURIComponent(skillOwner)}&body_only=true`, { headers: auth(member.token) });
    assert(JSON.stringify(sk.body).includes('aimeat_team_onboarding_done'), `the skill names the tool: ${sk.status}`);
});

await test('t21 the member\'s AI records it once; the lead sees who; the operator sees the count', async () => {
    const agent = await makeAgent(BASE, member, ['organism:read', 'organism:write']);
    const ai = await openSession(BASE, agent.token, 'team-onboard-ai');
    const r = await callTool(ai, 'aimeat_team_onboarding_done', { organism_id: teamId });
    assert(!r.isError && r.data.entry.account === member.name && r.data.entry.via === 'ai' && r.data.already === false, `record: ${r.text.slice(0, 200)}`);
    const again = await json(`/v1/teams/${teamId}/onboarding`, { method: 'POST', headers: auth(member.token), body: '{}' });
    assert(again.status === 200 && again.body.data.already === true, `again: ${again.status}`);
    const lead_ = await json(`/v1/teams/status?organism_id=${teamId}`, { headers: auth(lead.token) });
    const ob = lead_.body.data.teams[0].ai_onboarding;
    assert(ob.done === 1 && ob.who.some((w: any) => w.account === member.name), `lead view: ${JSON.stringify(ob)}`);
    const admin = await json('/v1/admin/teams', { headers: auth(operator.token) });
    assert(admin.body.data.teams.find((t: any) => t.organism_id === teamId)?.ai_onboarding === 1, 'operator count');
});

await test('t22 refusals: an outsider cannot record it, an agent without organism:write cannot', async () => {
    const out = await json(`/v1/teams/${teamId}/onboarding`, { method: 'POST', headers: auth(operator.token), body: '{}' });
    assert(out.status === 404, `outsider ${out.status}`);
    const reader = await makeAgent(BASE, member, ['organism:read']);
    const ro = await json(`/v1/teams/${teamId}/onboarding`, { method: 'POST', headers: auth(reader.token), body: '{}' });
    assert(ro.status === 403, `read-only agent ${ro.status}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
