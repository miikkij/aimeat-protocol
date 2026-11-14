/**
 * @file test/e2e-team-admin.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's view of the teams on a node (team setup T16): GET /v1/admin/teams and
 *   aimeat_admin_teams give every team with counts only (leads, members, connected AIs, the week's
 *   numbers) and never a record title or the team context. The refusals: an ordinary owner and an
 *   agent without operator:admin are refused, and a caller with no token gets 401.
 * @structure t01..t04 in order; each later test reads what the earlier ones made.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=team-admin
 * @version-history
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

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
