/**
 * @file test/e2e-team-setup.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Teams end to end, driven the way a person's AI drives them: aimeat_team_setup with a
 *   dry run first and then for real, invitations accepted by the people, aimeat_team_status, the team
 *   lines a member's AI reads in its MCP instructions and its handbook, and the team skill.
 *
 *   The structures it proves: one team in three languages, several leads and a new lead beside the
 *   old one, a member made lead at once, a lead invited by address who becomes one on accepting,
 *   many teams in one call (a flat organisation with a virtual team and a Spanish-speaking team), one
 *   person in several teams, applying the same people twice, and a member's own AI counted as
 *   connected once it opens an MCP session.
 *
 *   The refusals: a dry run makes nothing; a non-lead cannot change a team; an outsider gets no
 *   status, no skill and no team line; an agent without organism:invite cannot invite; bad input is
 *   INVALID_INPUT; a team cannot be read through another person's id.
 * @structure t01..t16 in order; each later test reads what the earlier ones made.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=team-setup
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-tiimipaketti-viisi-syyt-valita-aimeat-nopeasti-k-ytt-n).
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, mcpRpc, type McpSession } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
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
const tokenFrom = (url: string) => new URL(url).searchParams.get('token') || '';

/** Open an MCP session and keep what `initialize` answered, so the instructions can be read. */
async function sessionWithInstructions(token: string, label: string): Promise<{ session: McpSession; instructions: string }> {
    const session: McpSession = { base: BASE, token, label };
    const init = await mcpRpc(session, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: label, version: '1.0.0' } });
    assert(session.sessionId, `initialize gave no session: ${JSON.stringify(init).slice(0, 200)}`);
    return { session, instructions: String(init?.result?.instructions ?? '') };
}

const stamp = Date.now().toString(36).slice(-5);
console.log('\n=== Teams E2E (aimeat_team_setup, aimeat_team_status, team lines) ===\n');

let lead!: RegisteredOwner, liisa!: RegisteredOwner, aino!: RegisteredOwner, outsider!: RegisteredOwner;
let leadAi!: McpSession, ainoAgentToken = '', narrowAi!: McpSession;
let salesId = '', salesSkill = '';
const newLeadEmail = `kaisa.${stamp}@example.com`;
let newLeadAcceptUrl = '';

await test('t01 setup: a lead, two colleagues and an outsider; the lead\'s AI holds the team words', async () => {
    lead = await registerOwner(BASE, `tl${stamp}`, { body: { locale: 'fi' } });
    liisa = await registerOwner(BASE, `liisa${stamp}`, { body: { locale: 'fi' } });
    aino = await registerOwner(BASE, `aino${stamp}`, { body: { locale: 'en' } });
    outsider = await registerOwner(BASE, `out${stamp}`, { body: { locale: 'fi' } });
    const agent = await makeAgent(BASE, lead, ['organism:write', 'organism:read', 'organism:invite', 'memory:read']);
    leadAi = await openSession(BASE, agent.token, 'team-lead-ai');
    const narrow = await makeAgent(BASE, lead, ['organism:write', 'organism:read', 'memory:read']);
    narrowAi = await openSession(BASE, narrow.token, 'team-narrow-ai');
});

const salesSpec = () => ({
    teams: [{
        name: 'Myyntitiimi', names: { en: 'Sales team', es: 'Equipo de ventas' }, language: 'fi',
        description: 'Tarjoukset julkisen sektorin asiakkaille.',
        descriptions: { en: 'Tenders for public sector customers.' },
        leads: [liisa.name, { email: newLeadEmail }],
        members: [{ account: aino.name, language: 'en' }],
    }],
});

await test('t02 a dry run plans every person and makes nothing', async () => {
    const r = await callTool(leadAi, 'aimeat_team_setup', salesSpec());
    assert(!r.isError, `dry run refused: ${r.text}`);
    const t = r.data.teams[0];
    assert(r.data.dry_run === true && t.action === 'create' && t.organism_id === null, 'a plan, not a team');
    assert(JSON.stringify(t.workspaces) === JSON.stringify(['Yhteinen tieto', 'Päätökset', 'Odottaa sinua']), `workspaces in Finnish: ${t.workspaces}`);
    const who = Object.fromEntries(t.people.map((p: any) => [p.who, p]));
    assert(who[lead.name].result === 'creator', 'the caller is the first lead');
    assert(who[liisa.name].lead && who[liisa.name].result === 'invite', 'Liisa invited as a lead');
    assert(who[aino.name].language === 'en', 'Aino gets her invitation in English');
    const st = await json('/v1/teams/status', { headers: auth(lead.token) });
    assert(st.status === 200 && st.body.data.teams.length === 0, `the dry run made a team: ${JSON.stringify(st.body).slice(0, 200)}`);
});

await test('t03 the same call for real makes the team, its three workspaces, context and skill, and sends the invitations', async () => {
    const r = await callTool(leadAi, 'aimeat_team_setup', { ...salesSpec(), dry_run: false });
    assert(!r.isError, `setup refused: ${r.text}`);
    const t = r.data.teams[0];
    assert(t.problems.length === 0, `problems: ${t.problems}`);
    salesId = t.organism_id; salesSkill = t.skill;
    assert(salesId && t.workspaces.length === 3 && salesSkill?.startsWith(`user:${lead.name}/team-`), `made: ${JSON.stringify(t).slice(0, 300)}`);
    const results = Object.fromEntries(t.people.map((p: any) => [p.who, p.result]));
    assert(results[liisa.name] === 'invited' && results[aino.name] === 'invited' && results[newLeadEmail] === 'invited', `results ${JSON.stringify(results)}`);
    newLeadAcceptUrl = t.people.find((p: any) => p.who === newLeadEmail)?.accept_url ?? '';
    assert(newLeadAcceptUrl.includes('/v1/invite?token='), 'an emailed invitation answers its address to the inviter');
    const ws = await json(`/v1/organisms/${salesId}/workspace?ws=${t.workspaces[0]}`, { headers: auth(lead.token) });
    assert(ws.status === 200 && ws.body.data.manifest?.name === 'Yhteinen tieto', `shared workspace: ${ws.status} ${ws.body.data?.manifest?.name}`);
    // The spaces and fields carry their labels in every language, which the page reads per reader.
    const i18n = ws.body.data.manifest?.i18n;
    assert(i18n?.en?.['type.item'] === 'Open matters' && i18n?.fi?.['type.item'] === 'Avoimet asiat' && i18n?.es?.['shared.items.title'] === 'Título', `manifest i18n: ${JSON.stringify(i18n?.en ?? null).slice(0, 200)}`);
    const st = await json(`/v1/teams/status?organism_id=${salesId}`, { headers: auth(lead.token) });
    const team = st.body.data.teams[0];
    assert(team.context?.core.includes('Tarjoukset julkisen sektorin asiakkaille.'), 'the context starts from the description');
    assert(team.invitations.length === 3 && team.invitations.filter((i: any) => i.lead).length === 2, `invitations ${JSON.stringify(team.invitations)}`);
});

await test('t04 a name invitation to a lead makes Liisa a lead when she accepts; the first lead stays', async () => {
    const r = await json(`/v1/organisms/${salesId}/invitations/accept`, { method: 'POST', headers: auth(liisa.token) });
    assert(r.status === 200, `accept ${r.status}: ${JSON.stringify(r.body.error)}`);
    const st = await json(`/v1/teams/status?organism_id=${salesId}`, { headers: auth(liisa.token) });
    const team = st.body.data.teams[0];
    assert(team.you_lead === true && team.leads.includes(lead.name) && team.leads.includes(liisa.name), `leads ${team.leads}`);
});

await test('t05 a lead invited by address registers through the link and becomes a lead', async () => {
    const r = await json(`/v1/invitations/${tokenFrom(newLeadAcceptUrl)}/accept`, { method: 'POST', body: JSON.stringify({ username: `kaisa${stamp}`, password: 'KaisaPass1234', display_name: 'Kaisa' }) });
    assert(r.status === 200 && r.body.data.status === 'joined', `accept ${r.status}: ${JSON.stringify(r.body.error)}`);
    const st = await json(`/v1/teams/status?organism_id=${salesId}`, { headers: auth(lead.token) });
    const team = st.body.data.teams[0];
    assert(team.leads.length === 3 && team.leads.includes(`kaisa${stamp}`), `three leads now: ${team.leads}`);
    assert(team.invitations.length === 1 && team.invitations[0].who === aino.name, `only Aino's invitation is open: ${JSON.stringify(team.invitations)}`);
});

await test('t06 Aino accepts; her status names the team in English and gives her no invitation list', async () => {
    const r = await json(`/v1/organisms/${salesId}/invitations/accept`, { method: 'POST', headers: auth(aino.token) });
    assert(r.status === 200, `accept ${r.status}`);
    const st = await json('/v1/teams/status', { headers: auth(aino.token) });
    const team = st.body.data.teams.find((t: any) => t.organism_id === salesId);
    assert(team && team.name === 'Sales team' && team.you_lead === false, `name for an English reader: ${team?.name}`);
    assert(team.invitations === undefined, 'a member does not see the open invitations');
});

await test('t07 Aino\'s own AI is told about the team on connecting, reads it, and loads the team skill', async () => {
    const agent = await makeAgent(BASE, aino, ['organism:read', 'memory:read']);
    ainoAgentToken = agent.token;
    const { session, instructions } = await sessionWithInstructions(agent.token, 'claude');
    assert(instructions.includes('Sales team') && instructions.includes(salesId), `instructions name the team: ${instructions.slice(-500)}`);
    const hb = await callTool(session, 'aimeat_handbook_get', {});
    assert(hb.text.includes('Sales team') && hb.text.includes(salesSkill), 'the handbook carries the team line');
    const st = await callTool(session, 'aimeat_team_status', { organism_id: salesId });
    assert(!st.isError && st.data.teams[0].context.core.includes('Myyntitiimi'), `status over MCP: ${st.text.slice(0, 200)}`);
    const sk = await callTool(session, 'aimeat_skill_get', { ref: salesSkill, body_only: true });
    assert(!sk.isError && sk.text.includes('Odottaa sinua') && sk.text.includes(salesId), `team skill readable by a member's AI: ${sk.text.slice(0, 200)}`);
});

await test('t08 the lead sees Aino\'s AI as connected once it has opened a session', async () => {
    const st = await json(`/v1/teams/status?organism_id=${salesId}`, { headers: auth(lead.token) });
    const team = st.body.data.teams[0];
    const ainoRow = team.members.find((m: any) => m.account === aino.name);
    assert(ainoRow?.ai.connected === true && ainoRow.ai.agents.length === 1, `Aino's AI: ${JSON.stringify(ainoRow)}`);
    const kaisa = team.members.find((m: any) => m.account === `kaisa${stamp}`);
    assert(kaisa?.ai.connected === false, 'a member with no AI is not counted');
    // The lead's own AI opened a session in t01 too, so two members have their AI connected.
    assert(team.ai_connected === 2, `two connected: ${team.ai_connected}`);
    // The organism roster says the same, for the page's "own AI connected" line.
    const roster = await json(`/v1/organisms/${salesId}/members`, { headers: auth(lead.token) });
    const ainoAgents = roster.body.data.members.find((m: any) => m.ghii === aino.name)?.agents ?? [];
    assert(ainoAgents.some((a: any) => typeof a.mcp_last_seen === 'string'), `roster mcp_last_seen: ${JSON.stringify(ainoAgents)}`);
});

await test('t09 an outsider gets no status, no skill and no team line', async () => {
    const st = await json(`/v1/teams/status?organism_id=${salesId}`, { headers: auth(outsider.token) });
    assert(st.status === 404, `outsider status ${st.status}`);
    const agent = await makeAgent(BASE, outsider, ['organism:read', 'memory:read']);
    const { session, instructions } = await sessionWithInstructions(agent.token, 'outsider-ai');
    assert(!instructions.includes(salesId), 'the outsider\'s AI is not told about the team');
    const sk = await callTool(session, 'aimeat_skill_get', { ref: salesSkill });
    assert(sk.isError, `the team skill is readable outside the team: ${sk.text.slice(0, 120)}`);
    const up = await callTool(session, 'aimeat_team_status', { organism_id: salesId });
    assert(up.isError && /NOT_FOUND/.test(up.text), `outsider over MCP: ${up.text.slice(0, 120)}`);
});

await test('t10 a member who is not a lead cannot change the team', async () => {
    const r = await json('/v1/teams/setup', { method: 'POST', headers: auth(aino.token), body: JSON.stringify({ dry_run: false, teams: [{ organism_id: salesId, members: [outsider.name] }] }) });
    assert(r.status === 201 && /FORBIDDEN/.test(r.body.data.teams[0].problems.join(' ')), `non-lead change: ${JSON.stringify(r.body).slice(0, 300)}`);
    const st = await json(`/v1/teams/status?organism_id=${salesId}`, { headers: auth(lead.token) });
    assert(!st.body.data.teams[0].invitations.some((i: any) => i.who === outsider.name), 'no invitation was sent');
});

await test('t11 a member named a lead becomes one at once; leads are added, never replaced', async () => {
    const r = await callTool(leadAi, 'aimeat_team_setup', { dry_run: false, teams: [{ organism_id: salesId, leads: [aino.name] }] });
    const p = r.data.teams[0].people.find((x: any) => x.who === aino.name);
    assert(p?.result === 'lead_now', `Aino: ${JSON.stringify(p)}`);
    const st = await json(`/v1/teams/status?organism_id=${salesId}`, { headers: auth(lead.token) });
    assert(st.body.data.teams[0].leads.length === 4 && st.body.data.teams[0].leads.includes(lead.name), `four leads: ${st.body.data.teams[0].leads}`);
});

await test('t12 the same people again change nothing', async () => {
    const r = await callTool(leadAi, 'aimeat_team_setup', { dry_run: false, teams: [{ organism_id: salesId, leads: [liisa.name], members: [aino.name] }] });
    const results = r.data.teams[0].people.map((p: any) => p.result);
    assert(results.every((x: string) => x === 'already'), `already: ${results}`);
});

let teamIds: Record<string, string> = {};
await test('t13 many teams in one call: a flat organisation with a virtual team and a Spanish team', async () => {
    const spec = {
        dry_run: false,
        teams: [
            { name: 'Johtoryhmä', names: { en: 'Management team', es: 'Comité de dirección' }, members: [liisa.name] },
            { name: 'AI-strategia', names: { en: 'AI strategy', es: 'Estrategia de IA' }, kind: 'virtual', members: [aino.name, liisa.name] },
            { name: 'Diseño', names: { fi: 'Design', en: 'Design' }, language: 'es', members: [aino.name] },
            { name: 'Ohjelmistokehitys', names: { en: 'Software development', es: 'Desarrollo de software' } },
        ],
    };
    const r = await callTool(leadAi, 'aimeat_team_setup', spec);
    assert(!r.isError, `many teams refused: ${r.text.slice(0, 200)}`);
    for (const t of r.data.teams) {
        assert(t.organism_id && t.problems.length === 0, `${t.name}: ${t.problems}`);
        teamIds[t.names.fi ?? t.name] = t.organism_id;
    }
    const es = r.data.teams[2];
    assert(es.language === 'es' && JSON.stringify(es.workspaces).length > 0, 'the Spanish team');
    const ws = await json(`/v1/organisms/${es.organism_id}/workspace?ws=${es.workspaces[2]}`, { headers: auth(lead.token) });
    assert(ws.body.data.manifest?.name === 'Pendiente de ti', `Spanish workspace names: ${ws.body.data.manifest?.name}`);
    assert(r.data.teams[1].kind === 'virtual', 'the virtual team');
});

await test('t14 one person in several teams: Aino joins two more and her AI is told about all three, in English', async () => {
    for (const name of ['AI-strategia', 'Design']) {
        const id = teamIds[name];
        const r = await json(`/v1/organisms/${id}/invitations/accept`, { method: 'POST', headers: auth(aino.token) });
        assert(r.status === 200, `accept ${name}: ${r.status}`);
    }
    const st = await json('/v1/teams/status', { headers: auth(aino.token) });
    const names = st.body.data.teams.map((t: any) => t.name).sort();
    assert(JSON.stringify(names) === JSON.stringify(['AI strategy', 'Design', 'Sales team']), `Aino's teams: ${names}`);
    const { instructions } = await sessionWithInstructions(ainoAgentToken, 'claude-again');
    for (const n of ['AI strategy', 'Design', 'Sales team']) assert(instructions.includes(n), `instructions name ${n}`);
    assert(!instructions.includes('Johtoryhmä') && !instructions.includes('Management team'), 'a team she is not in is not named');
    // The organism list carries every team's names, so the page names each team in the reader's language.
    const list = await json(`/v1/organisms?member=${aino.name}`, { headers: auth(aino.token) });
    const sales = list.body.data.organisms.find((o: any) => o.id === salesId);
    assert(sales?.team_names?.names?.en === 'Sales team' && sales.team_names.language === 'fi', `list team_names: ${JSON.stringify(sales?.team_names)}`);
    // The workspaces and the description in every language, for the page to pick the reader's.
    const wsNames = Object.values(sales.team_names.workspaces ?? {}).map((n: any) => n.en).sort();
    assert(JSON.stringify(wsNames) === JSON.stringify(['Decisions', 'Shared knowledge', 'Waiting for you']), `workspace names in English: ${wsNames}`);
    assert(sales.team_names.descriptions?.en === 'Tenders for public sector customers.' && sales.team_names.descriptions?.fi === 'Tarjoukset julkisen sektorin asiakkaille.', `descriptions: ${JSON.stringify(sales.team_names.descriptions)}`);
});

await test('t15 the names can be corrected; the language and the workspaces stay', async () => {
    const id = teamIds['Johtoryhmä'];
    const r = await callTool(leadAi, 'aimeat_team_setup', { dry_run: false, teams: [{ organism_id: id, names: { en: 'Leadership team' } }] });
    assert(!r.isError && r.data.teams[0].names.en === 'Leadership team' && r.data.teams[0].names.fi === 'Johtoryhmä', `names ${JSON.stringify(r.data.teams?.[0]?.names)}`);
    const st = await json(`/v1/teams/status?organism_id=${id}`, { headers: auth(lead.token) });
    assert(st.body.data.teams[0].names.en === 'Leadership team' && st.body.data.teams[0].language === 'fi', 'stored');
});

await test('t16 refusals: no invite permission, bad input, a dry run allowed without it', async () => {
    const noInvite = await callTool(narrowAi, 'aimeat_team_setup', { dry_run: false, teams: [{ name: 'Talous', members: ['someone@example.com'] }] });
    assert(noInvite.isError && /SCOPE_DENIED/.test(noInvite.text), `without organism:invite: ${noInvite.text.slice(0, 160)}`);
    const dry = await callTool(narrowAi, 'aimeat_team_setup', { teams: [{ name: 'Talous', members: ['someone@example.com'] }] });
    assert(!dry.isError && dry.data.dry_run === true, 'a dry run needs no invite permission');
    const empty = await json('/v1/teams/setup', { method: 'POST', headers: auth(lead.token), body: JSON.stringify({ teams: [] }) });
    assert(empty.status === 400 && empty.body.error?.code === 'INVALID_INPUT', `empty ${empty.status}`);
    const badEmail = await json('/v1/teams/setup', { method: 'POST', headers: auth(lead.token), body: JSON.stringify({ teams: [{ name: 'X', members: [{ email: 'not an address' }] }] }) });
    assert(badEmail.status === 400, `bad email ${badEmail.status}`);
    const st = await json('/v1/teams/status', { headers: auth(lead.token) });
    assert(!st.body.data.teams.some((t: any) => t.name === 'Talous'), 'no Talous team was made');
});

await test('t17 the REST routes refuse an agent without the permission word and a caller with no token', async () => {
    const noWords = await makeAgent(BASE, lead, ['memory:read']);
    const setup = await json('/v1/teams/setup', { method: 'POST', headers: auth(noWords.token), body: JSON.stringify({ teams: [{ name: 'X' }] }) });
    assert(setup.status === 403, `setup without organism:write: ${setup.status}`);
    const status = await json('/v1/teams/status', { headers: auth(noWords.token) });
    assert(status.status === 403, `status without organism:read: ${status.status}`);
    const anon = await json('/v1/teams/status');
    assert(anon.status === 401, `status with no token: ${anon.status}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
