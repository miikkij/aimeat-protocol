/**
 * @file test/e2e-team-changes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Changing a team and working in it, driven the way a person's AI drives it: a temporary
 *   member's day, taking people out ("Pekka leaves"), the last lead staying, a project team's last
 *   day and the teams it depends on (aimeat_team_setup), everything that waits for a person across
 *   their teams (aimeat_team_waiting), and the team as a prompt for an AI without MCP with its tagged
 *   answer brought back (GET /v1/teams/:id/prompt, POST /v1/teams/:id/paste). The end sweep itself is
 *   test/unit/team-expiry.test.ts.
 * @structure c01..c11 in order; each later test reads what the earlier ones made.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=team-changes
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (team setup T6, T9, T17, T21, T23).
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpSession } from './helpers/mcp-session.js';

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
const stamp = Date.now().toString(36).slice(-5);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

console.log('\n=== Team changes E2E (until, remove, ends_on, depends_on, waiting, prompt, paste) ===\n');

let lead!: RegisteredOwner, pekka!: RegisteredOwner, aino!: RegisteredOwner, outsider!: RegisteredOwner;
let leadAi!: McpSession, ainoAi!: McpSession;
let teamId = '', otherId = '', waitingWs = '';

await test('c01 a team with a temporary member, a project end day and a dependency', async () => {
    lead = await registerOwner(BASE, `cl${stamp}`, { body: { locale: 'fi' } });
    pekka = await registerOwner(BASE, `pekka${stamp}`, { body: { locale: 'fi' } });
    aino = await registerOwner(BASE, `cino${stamp}`, { body: { locale: 'en' } });
    outsider = await registerOwner(BASE, `cout${stamp}`);
    leadAi = await openSession(BASE, (await makeAgent(BASE, lead, ['organism:write', 'organism:read', 'organism:invite', 'memory:read', 'memory:write'])).token, 'lead-ai');
    const other = await callTool(leadAi, 'aimeat_team_setup', { dry_run: false, teams: [{ name: 'Ohjelmistokehitys' }] });
    otherId = other.data.teams[0].organism_id;
    const spec = { teams: [{
        name: 'Projekti Atlas', kind: 'virtual', ends_on: inDays(60),
        depends_on: [{ organism_id: otherId, what: 'rajapinnat' }],
        members: [{ account: pekka.name, until: inDays(30) }, aino.name],
    }] };
    const dry = await callTool(leadAi, 'aimeat_team_setup', spec);
    const plannedPekka = dry.data.teams[0].people.find((p: any) => p.who === pekka.name);
    assert(plannedPekka?.until === inDays(30), `dry run shows the end day: ${JSON.stringify(plannedPekka)}`);
    assert(dry.data.teams[0].changes?.ends_on === inDays(60), `dry run shows the team's end: ${JSON.stringify(dry.data.teams[0].changes)}`);
    const made = await callTool(leadAi, 'aimeat_team_setup', { ...spec, dry_run: false });
    assert(!made.isError && made.data.teams[0].problems.length === 0, `setup: ${made.text.slice(0, 200)}`);
    teamId = made.data.teams[0].organism_id;
    waitingWs = made.data.teams[0].workspaces[2];
    for (const who of [pekka, aino]) {
        const r = await json(`/v1/organisms/${teamId}/invitations/accept`, { method: 'POST', headers: auth(who.token) });
        assert(r.status === 200, `${who.name} accepts: ${r.status}`);
    }
});

await test('c02 the lead sees the end days and the dependency; a member sees the team\'s end but not the members\' days', async () => {
    const st = await json(`/v1/teams/status?organism_id=${teamId}`, { headers: auth(lead.token) });
    const t = st.body.data.teams[0];
    assert(t.ends_on === inDays(60) && t.depends_on[0]?.organism_id === otherId, `team: ${JSON.stringify({ e: t.ends_on, d: t.depends_on })}`);
    assert(t.member_until?.[pekka.name] === inDays(30), `member_until: ${JSON.stringify(t.member_until)}`);
    const asAino = (await json(`/v1/teams/status?organism_id=${teamId}`, { headers: auth(aino.token) })).body.data.teams[0];
    assert(asAino.ends_on === inDays(60) && asAino.member_until === undefined, 'a member sees no one else\'s day');
});

await test('c03 "Pekka leaves": a dry run says so, the real call takes him out, and his AI loses the team', async () => {
    const pekkaAgent = await makeAgent(BASE, pekka, ['organism:read', 'memory:read']);
    const dry = await callTool(leadAi, 'aimeat_team_setup', { teams: [{ organism_id: teamId, remove: [pekka.name] }] });
    assert(dry.data.teams[0].changes.removed[0]?.result === 'remove', `dry: ${JSON.stringify(dry.data.teams[0].changes)}`);
    const real = await callTool(leadAi, 'aimeat_team_setup', { dry_run: false, teams: [{ organism_id: teamId, remove: [pekka.name] }] });
    assert(real.data.teams[0].changes.removed[0]?.result === 'removed', `real: ${JSON.stringify(real.data.teams[0].changes)}`);
    const st = await json(`/v1/teams/status?organism_id=${teamId}`, { headers: auth(pekkaAgent.token) });
    assert(st.status === 404, `his AI still reads the team: ${st.status}`);
    const after = (await json(`/v1/teams/status?organism_id=${teamId}`, { headers: auth(lead.token) })).body.data.teams[0];
    assert(after.member_until?.[pekka.name] === undefined, 'his end day is gone with him');
});

await test('c04 the last lead is never taken out this way', async () => {
    const r = await callTool(leadAi, 'aimeat_team_setup', { dry_run: false, teams: [{ organism_id: teamId, remove: [lead.name] }] });
    assert(r.data.teams[0].changes.removed[0]?.result === 'last_lead', `last lead: ${JSON.stringify(r.data.teams[0].changes)}`);
    const st = await json(`/v1/teams/status?organism_id=${teamId}`, { headers: auth(lead.token) });
    assert(st.status === 200 && st.body.data.teams[0].you_lead, 'still the lead');
});

await test('c05 the end day is cleared with null', async () => {
    await callTool(leadAi, 'aimeat_team_setup', { dry_run: false, teams: [{ organism_id: teamId, ends_on: null }] });
    const st = await json(`/v1/teams/status?organism_id=${teamId}`, { headers: auth(lead.token) });
    assert(st.body.data.teams[0].ends_on === null, `ends_on: ${st.body.data.teams[0].ends_on}`);
});

await test('c06 what waits: a record for the lead reaches the lead and not Aino; one for Aino reaches Aino', async () => {
    ainoAi = await openSession(BASE, (await makeAgent(BASE, aino, ['organism:read', 'organism:write', 'memory:read', 'memory:write'])).token, 'aino-ai');
    const w1 = await callTool(ainoAi, 'aimeat_workspace_write', { organism_id: teamId, ws: waitingWs, space: 'waiting', id: 'send-1', value: { id: 'send-1', title: 'Tarjous kaupungille', kind: 'send', status: 'open', by: aino.name } });
    assert(!w1.isError, `write 1: ${w1.text.slice(0, 160)}`);
    const w2 = await callTool(leadAi, 'aimeat_workspace_write', { organism_id: teamId, ws: waitingWs, space: 'waiting', id: 'ask-aino', value: { id: 'ask-aino', title: 'Check the delivery date', kind: 'approve', status: 'open', for: aino.name, by: lead.name } });
    assert(!w2.isError, `write 2: ${w2.text.slice(0, 160)}`);
    const forLead = await callTool(leadAi, 'aimeat_team_waiting', {});
    const leadIds = forLead.data.items.map((i: any) => i.id);
    assert(leadIds.includes('send-1') && !leadIds.includes('ask-aino'), `lead waits: ${leadIds}`);
    const forAino = await callTool(ainoAi, 'aimeat_team_waiting', {});
    const ainoIds = forAino.data.items.map((i: any) => i.id);
    assert(ainoIds.includes('ask-aino') && !ainoIds.includes('send-1'), `Aino waits: ${ainoIds}`);
});

await test('c07 a decided record leaves the list', async () => {
    await callTool(ainoAi, 'aimeat_workspace_write', { organism_id: teamId, ws: waitingWs, space: 'waiting', id: 'ask-aino', value: { id: 'ask-aino', title: 'Check the delivery date', kind: 'approve', status: 'done', for: aino.name, by: lead.name } });
    const forAino = await callTool(ainoAi, 'aimeat_team_waiting', {});
    assert(!forAino.data.items.some((i: any) => i.id === 'ask-aino'), 'done is not waiting');
});

await test('c08 the team as a prompt, in the reader\'s language, with the tags to bring the answer back', async () => {
    const r = await json(`/v1/teams/${teamId}/prompt`, { headers: auth(aino.token) });
    assert(r.status === 200 && r.body.data.language === 'en', `prompt: ${r.status} ${r.body.data?.language}`);
    const p = String(r.body.data.prompt);
    assert(p.includes('Projekti Atlas') || p.includes('Atlas'), 'names the team');
    assert(p.includes('DECISION:') && p.includes('OPEN:') && p.includes('WAITING:'), 'carries the tags');
});

let pasted: any[] = [];
await test('c09 a pasted answer: a dry run reads the tags, the real one writes drafts the team sees', async () => {
    const text = 'Here is the summary.\nDECISION: Maintenance is priced monthly | customers asked for it\nOPEN: Two references missing\nWAITING: Send the tender to the city\nNot a tagged line.';
    const dry = await json(`/v1/teams/${teamId}/paste`, { method: 'POST', headers: auth(aino.token), body: JSON.stringify({ text }) });
    assert(dry.status === 200 && dry.body.data.dry_run === true && dry.body.data.entries.length === 3 && dry.body.data.written === 0, `dry: ${JSON.stringify(dry.body.data)}`);
    const real = await json(`/v1/teams/${teamId}/paste`, { method: 'POST', headers: auth(aino.token), body: JSON.stringify({ text, dry_run: false }) });
    assert(real.status === 201 && real.body.data.written === 3, `real: ${real.status} ${JSON.stringify(real.body.error ?? real.body.data)}`);
    pasted = real.body.data.entries;
    const forLead = await callTool(leadAi, 'aimeat_team_waiting', {});
    assert(forLead.data.items.some((i: any) => i.title === 'Send the tender to the city'), 'the pasted waiting matter reaches the lead');
    const prompt = await json(`/v1/teams/${teamId}/prompt`, { headers: auth(lead.token) });
    assert(String(prompt.body.data.prompt).includes('Maintenance is priced monthly'), 'the pasted decision is in the next prompt');
});

await test('c10 refusals: an outsider gets no prompt and no paste; a token without the words is refused', async () => {
    const p = await json(`/v1/teams/${teamId}/prompt`, { headers: auth(outsider.token) });
    assert(p.status === 404, `outsider prompt: ${p.status}`);
    const w = await json(`/v1/teams/${teamId}/paste`, { method: 'POST', headers: auth(outsider.token), body: JSON.stringify({ text: 'OPEN: x', dry_run: false }) });
    assert(w.status === 404, `outsider paste: ${w.status}`);
    const narrow = await makeAgent(BASE, aino, ['memory:read']);
    const r1 = await json('/v1/teams/waiting', { headers: auth(narrow.token) });
    assert(r1.status === 403, `waiting without organism:read: ${r1.status}`);
    const r2 = await json(`/v1/teams/${teamId}/prompt`, { headers: auth(narrow.token) });
    assert(r2.status === 403, `prompt without organism:read: ${r2.status}`);
    const r3 = await json(`/v1/teams/${teamId}/paste`, { method: 'POST', headers: auth(narrow.token), body: JSON.stringify({ text: 'OPEN: x' }) });
    assert(r3.status === 403, `paste without organism:write: ${r3.status}`);
    const anon = await json('/v1/teams/waiting');
    assert(anon.status === 401, `waiting with no token: ${anon.status}`);
});

await test('c11 bad input: remove on a new team, a malformed day', async () => {
    const r1 = await json('/v1/teams/setup', { method: 'POST', headers: auth(lead.token), body: JSON.stringify({ teams: [{ name: 'X', remove: ['someone'] }] }) });
    assert(r1.status === 400, `remove on a new team: ${r1.status}`);
    const r2 = await json('/v1/teams/setup', { method: 'POST', headers: auth(lead.token), body: JSON.stringify({ teams: [{ name: 'X', ends_on: '31.3.2027' }] }) });
    assert(r2.status === 400, `malformed day: ${r2.status}`);
    void pasted;
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
