/**
 * @file e2e-operator-service-phase2.ts
 * @description E2E for operator services, phase 2 (agents.operator_services): who an entry reaches
 *   (`audience`), how firmly (`required`), the private read (memory:read-as-owner only with
 *   `private_read_reason`), `how_to_help`, and the operator's switch for one account
 *   (PUT /v1/operator-services/{id}/accounts/{account}, aimeat_admin_service_access account_off and
 *   account_on).
 *
 *   The designed use: the operator makes a service required for everyone and lets it read private
 *   records with a reason; each person gets the agent, sees it marked required with the reason, is told
 *   why, and keeps their own controls over what is theirs (instructions, their own added permissions).
 *   The abuse cases: the person, in person and through another of their agents and over MCP, removing,
 *   turning off, stopping, changing mode, run mode or task start, rekeying, narrowing, setting the
 *   webhook or the budget limits of a required agent (403 OPERATOR_SERVICE_REQUIRED); a person's own
 *   agent under a required service's name (not fenced); required back to false (the controls return
 *   at once); a person who turned it off (the next request sets it up again, with the notice);
 *   the operator's switch by the credential, a person and a non-operator's agent (refused), a bad
 *   body and an unknown account; an account outside the audience (pending), one that leaves it (its
 *   agent ended); and the entry dropping the private read (the agent loses the word and the read).
 * @version-history
 *   v1.4.1 — 2026-11-27 — The account sentence says no request was kept, and points to no approval.
 *   v1.4.0 — 2026-11-27 — The credential refused for its own entry's name: 403 OPERATOR_SERVICE_REFUSED and
 *     no request offered (9, 11, 14); the operator's reason read back and cleared (11, 13).
 *   v1.3.0 — 2026-11-27 — Review round: reserved names (1), a credential agent writing the setting (1b),
 *     `how_to_help` on the agent list (3), the device flow and the MCP consent for the service's agent,
 *     clearance, port, sign-out and the sibling's MCP narrowing and mode (7b), the old token after the
 *     sweep (15), and the person's off coming back once the entry is not required (16b).
 *   v1.2.0 — 2026-11-26 — 18: the notice states the private read in its own sentence and leaves it out of
 *     the permission list; a required service's notice never says the person can turn it off.
 *   v1.1.0 — 2026-11-26 — The key of any service agent is the service's (OPERATOR_SERVICE_KEY): rekey in
 *     case 5, and 16b on a service that is not required (rekey, move, migrate refused; the person's own
 *     agent passes; the proof and the fence still hold after the refusals).
 *   v1.0.0 — 2026-11-26 — Initial (operator services phase 2).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=operator-service-phase2
// suite-hygiene: tests the device flow — the operator-service branch of POST /v1/agents/device-authorize
// is the subject here, so the calls and the device-token poll are written out.

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { ownerSignIn } from './helpers/owner-login.js';
import { BASE, test, assert, json, expectRefusal, finish } from './helpers/harness.js';
import { openSession, callTool } from './helpers/mcp-session.js';
import { mcpPkce, authorizeParams } from './helpers/mcp-oauth-pkce.js';

const SETTING = 'agents.operator_services';
const SVC = 'desk-helper';
const SVC_A = 'desk-aud';
// The account sentence points to no approval: nothing is kept for such a request.
const ACCOUNT_NOTE = 'This operator service cannot set up an agent for that account now, and no request was kept for it.';
const REQUIRED = 'OPERATOR_SERVICE_REQUIRED';
const REASON = 'It reads your private notes to answer the questions you send to the desk.';
const HELP = 'Send it the question with the ticket number in the subject.';
const SECRET_KEY = 'osvp2.private-note';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}

const stamp = Date.now().toString(36);
async function setupOwner(label: string) {
    const name = `osq${label}${stamp}`;
    const body = JSON.stringify({ username: name, display_name: `Person ${label}`, password: 'OpSvc12345' });
    let reg = await json('/v1/ghii', { method: 'POST', body });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        reg = await json('/v1/ghii', { method: 'POST', body });
    }
    assert(reg.status === 201, `ghii ${label} ${reg.status}`);
    const tok = await ownerSignIn(BASE, name, 'OpSvc12345');
    return { name, token: tok.body.data.token as string };
}
type Owner = Awaited<ReturnType<typeof setupOwner>>;

async function agentOf(owner: Owner, name: string, scopes: string[]) {
    const made = await json('/v1/agents', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ name, owner: owner.name, capabilities: ['memory'], model: 'gpt-4o', scopes }),
    });
    assert(made.status === 201, `agent ${name} ${made.status}: ${JSON.stringify(made.body.error)}`);
    const gaii = made.body.data.agent.gaii as string;
    const key = made.body.data.private_key as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: await sign(key, gaii + ts) }) });
    assert(tok.body.ok === true, `agent token ${name}: ${JSON.stringify(tok.body.error)}`);
    return { gaii, token: tok.body.data.token as string };
}
type Agent = Awaited<ReturnType<typeof agentOf>>;

const entry = (over: Record<string, unknown> = {}) => ({
    id: SVC, display_name: 'Desk Helper', description: 'Answers questions about the desk.',
    credential_agent: 'desk-service', scopes: ['memory:read', 'memory:write', 'memory:read-as-owner'],
    private_read_reason: REASON, how_to_help: HELP, required: true, enabled: true, ...over,
});
const entryA = (accounts: string[]) => ({
    id: SVC_A, display_name: 'Desk Audience', description: 'Helps the desk team with their own questions.',
    credential_agent: 'aud-service', scopes: ['memory:read'], audience: { accounts }, enabled: true,
});
const setSetting = (token: string, value: unknown) =>
    json('/v1/admin/config', { method: 'PUT', headers: auth(token), body: JSON.stringify({ changes: [{ path: SETTING, value }] }) });
const provision = (token: string, owner: string, agentName = SVC) =>
    json('/v1/agents/device-authorize', { method: 'POST', headers: auth(token), body: JSON.stringify({ agent_name: agentName, owner, display_name: agentName }) });
const poll = (deviceCode: string) => json('/v1/agents/device-token', {
    method: 'POST', body: JSON.stringify({ device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
});
/** Provision and collect the token; asserts the approval. */
async function provisioned(token: string, owner: string, agentName = SVC): Promise<{ token: string; scopes: string[] }> {
    const r = await provision(token, owner, agentName);
    assert(r.status === 200 && r.body.data.auto_approved === true, `approved for ${owner}: ${JSON.stringify(r.body.data ?? r.body.error).slice(0, 300)}`);
    const p = await poll(r.body.data.device_code);
    assert(p.status === 200 && !!p.body.token, `poll ${p.status}`);
    return { token: p.body.token, scopes: p.body.scopes };
}
/** The service's own credential refused for its own entry's name: 403, nothing stored, no request offered to `owner`. */
async function assertRefused(r: { status: number; body: any }, what: string, owner: Owner, name = SVC): Promise<string> {
    assert(r.status === 403 && r.body.error?.code === 'OPERATOR_SERVICE_REFUSED' && !r.body.data?.device_code,
        `${what}: ${r.status} ${JSON.stringify(r.body.error ?? r.body.data).slice(0, 300)}`);
    const p = await json('/v1/agents/device-authorize/pending', { headers: auth(owner.token) });
    assert(p.status === 200 && !(p.body.data.requests as any[]).some((x) => x.agent_name === name), `${what}: pending ${JSON.stringify(p.body.data)}`);
    return String(r.body.error.message);
}
const agentsOf = async (owner: Owner) => (await json('/v1/agents', { headers: auth(owner.token) })).body.data.agents as any[];
const mine = async (owner: Owner, id = SVC) => ((await json('/v1/operator-services', { headers: auth(owner.token) })).body.data.services as any[]).find((s) => s.id === id);
const noticesOf = async (owner: Owner, type: string) =>
    ((await json('/v1/notifications?limit=100', { headers: auth(owner.token) })).body.data.notifications as any[]).filter((n) => n.type === type);
const switchFor = (token: string, account: string, body: unknown, id = SVC) =>
    json(`/v1/operator-services/${id}/accounts/${account}`, { method: 'PUT', headers: auth(token), body: JSON.stringify(body) });

console.log('\n=== AIMEAT Operator services phase 2 (audience, required, private read, the operator\'s switch) E2E ===\n');

let OP: Owner, A: Owner, B: Owner, C: Owner, D: Owner, X: Owner;
let cred: Agent, credA: Agent, opAdmin: Agent, impAdmin: Agent, aHelper: Agent, adminCred: Agent;
let aService = '';
let bobService = '';

await test('Setup: the operator, five people, the credentials, an operator agent and alice\'s own helper', async () => {
    OP = await setupOwner('op');
    A = await setupOwner('a'); B = await setupOwner('b'); C = await setupOwner('c'); D = await setupOwner('d'); X = await setupOwner('x');
    cred = await agentOf(OP, 'desk-service', ['operator:service-provision']);
    credA = await agentOf(OP, 'aud-service', ['operator:service-provision']);
    opAdmin = await agentOf(OP, 'op-admin', ['operator:admin']);
    adminCred = await agentOf(OP, 'admin-cred', ['operator:admin', 'operator:service-provision']);
    impAdmin = await agentOf(X, 'fake-admin', ['operator:admin']);
    aHelper = await agentOf(A, 'a-helper', ['agent:write', 'agent:permissions', 'agent:delete', 'agent:read']);
    // dora's own agent under the service's name, before any setting: never the service's.
    await agentOf(D, SVC, ['memory:read']);
    const w = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: SECRET_KEY, value: { note: 'osvp2-secret' }, visibility: 'private' }) });
    assert(w.status === 201, `alice's private note ${w.status}`);
});

await test('1. The setting checks the new fields, naming the field', async () => {
    for (const [over, field] of [
        [{ private_read_reason: undefined }, 'private_read_reason is required'],
        [{ private_read_reason: 'Too short.' }, 'private_read_reason is text'],
        [{ scopes: ['memory:read'], private_read_reason: REASON }, 'private_read_reason belongs only'],
        [{ required: 'yes' }, '.required'],
        [{ audience: { accounts: [] } }, '.audience'],
        [{ audience: 'some' }, '.audience'],
        [{ how_to_help: 'Short.' }, 'how_to_help'],
        // S3: a name the node manages in every account is no service's.
        [{ id: 'chat' }, 'is a name this node manages'],
        [{ credential_agent: 'app' }, 'is a name this node manages'],
    ] as const) {
        const r = await setSetting(OP.token, [entry(over)]);
        expectRefusal(r, 400, 'INVALID_INPUT');
        assert(String(r.body.error.details?.errors?.[0]?.reason).includes(field), `names ${field}: ${JSON.stringify(r.body.error.details)}`);
    }
});

await test('1b. An operator agent that is a credential in the value does not write the setting (S6)', async () => {
    const r = await setSetting(adminCred.token, [entry(), entryA([B.name]), { ...entryA([B.name]), id: 'desk-x', credential_agent: 'admin-cred' }]);
    assert(r.status === 403 && r.body.error?.code === 'ACCESS_DENIED', `refused: ${r.status} ${JSON.stringify(r.body.error)}`);
    // Another operator agent, not a credential, writes the same value's other entries.
    const ok = await setSetting(opAdmin.token, [entry(), entryA([B.name])]);
    assert(ok.status === 200 && (ok.body.data.errors ?? []).length === 0, `the operator's other agent writes it: ${ok.status} ${JSON.stringify(ok.body.error ?? '')}`);
});

await test('2. The operator switches on a required service that reads private records, and one for an audience', async () => {
    const r = await setSetting(OP.token, [entry(), entryA([B.name])]);
    assert(r.status === 200 && (r.body.data.errors ?? []).length === 0, `set ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
});

await test('3. Alice gets the agent with the private read; she sees it required, with the reason, and is told why', async () => {
    const got = await provisioned(cred.token, A.name);
    aService = got.token;
    assert(got.scopes.includes('memory:read-as-owner'), `the token carries the private read: ${got.scopes}`);
    const a = (await agentsOf(A)).find((x) => x.name === SVC);
    assert(a?.set_by_operator?.required === true && a.set_by_operator.private_read === true && a.set_by_operator.private_read_reason === REASON
        && a.set_by_operator.how_to_help === HELP, `set_by_operator ${JSON.stringify(a?.set_by_operator)}`);
    const s = await mine(A);
    assert(s.required === true && s.private_read === true && s.private_read_reason === REASON && s.how_to_help === HELP
        && s.state === 'active' && s.may_turn_off === false && s.in_audience === true, `alice's view ${JSON.stringify(s)}`);
    const [n] = await noticesOf(A, 'operator_service_on');
    const vars = n?.i18n?.vars ?? {};
    assert(vars.required === 'true' && vars.private_read_reason === REASON && vars.how_to_help === HELP && String(vars.private_read).includes(REASON)
        && String(vars.off).length > 0, `the notice vars ${JSON.stringify(vars)}`);
});

await test('4. The private read works: the service reads alice\'s private note with owner_scope', async () => {
    const r = await json(`/v1/memory/${SECRET_KEY}?owner_scope=true`, { headers: auth(aService) });
    assert(r.status === 200 && r.body.data?.value?.note === 'osvp2-secret', `read ${r.status} ${JSON.stringify(r.body.error ?? '')}`);
});

await test('5. Alice in person cannot remove, turn off, stop, change, rekey, narrow, point the webhook or cap a required agent', async () => {
    const gaii = (await agentsOf(A)).find((x) => x.name === SVC).gaii as string;
    const calls: Array<[string, Promise<{ status: number; body: any }>]> = [
        ['turn off', json(`/v1/operator-services/${SVC}/me`, { method: 'DELETE', headers: auth(A.token) })],
        ['remove', json(`/v1/agents/${SVC}`, { method: 'DELETE', headers: auth(A.token) })],
        ['stop', json(`/v1/agents/${SVC}/stop`, { method: 'POST', headers: auth(A.token) })],
        ['mode', json(`/v1/agents/${SVC}/mode`, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ mode: 'autonomous' }) })],
        ['run mode', json(`/v1/agents/${SVC}/run-mode`, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ run_mode: 'spawn' }) })],
        ['task start', json(`/v1/agents/${SVC}/task-start`, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ task_start: 'confirm' }) })],
        ['narrow', json(`/v1/agents/${SVC}/scopes`, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ scopes: ['memory:read', 'memory:write'] }) })],
        ['narrowing', json(`/v1/agents/${SVC}/scope-narrowing`, { method: 'POST', headers: auth(A.token) })],
        ['webhook', json(`/v1/agents/${SVC}/webhook`, { method: 'PUT', headers: auth(A.token), body: JSON.stringify({ url: 'https://example.com/hook' }) })],
        ['webhook off', json(`/v1/agents/${SVC}/webhook`, { method: 'DELETE', headers: auth(A.token) })],
        ['budget', json(`/v1/agents/${SVC}/directives`, { method: 'PUT', headers: auth(A.token), body: JSON.stringify({ budget_limits: { max_tasks_per_day: 1 } }) })],
    ];
    for (const [what, call] of calls) {
        const r = await call;
        expectRefusal(r, 403, REQUIRED);
        assert(String(r.body.error.message).includes('support@operators'), `${what} names whom to ask: ${r.body.error.message}`);
    }
    // The key is the service's for every service agent, required or not: its own code (case 16b).
    const rekey = await json(`/v1/agents/${encodeURIComponent(gaii)}/rekey`, { method: 'POST', headers: auth(A.token) });
    expectRefusal(rekey, 403, 'OPERATOR_SERVICE_KEY');
    assert(String(rekey.body.error.message).includes('support@operators'), `rekey names whom to ask: ${rekey.body.error.message}`);
    assert((await agentsOf(A)).some((x) => x.name === SVC), 'the agent is still there');
    const read = await json(`/v1/memory/${SECRET_KEY}?owner_scope=true`, { headers: auth(aService) });
    assert(read.status === 200, `the service's token still works after the refused rekey: ${read.status}`);
});

await test('6. Alice\'s other agent, over REST and MCP, is refused the same way', async () => {
    expectRefusal(await json(`/v1/agents/${SVC}/stop`, { method: 'POST', headers: auth(aHelper.token) }), 403, REQUIRED);
    expectRefusal(await json(`/v1/agents/${SVC}/scopes`, { method: 'PATCH', headers: auth(aHelper.token), body: JSON.stringify({ scopes: ['memory:read'] }) }), 403, REQUIRED);
    const s = await openSession(BASE, aHelper.token, 'osvp2-helper');
    const r = await callTool(s, 'aimeat_agent_stop', { target_agent_name: SVC });
    assert(r.offered && r.isError && r.text.includes(REQUIRED), `MCP stop: ${r.text.slice(0, 300)}`);
});

await test('7. What stays alice\'s: her instructions, her own added word and taking it back, a start, the agent\'s activity', async () => {
    const d = await json(`/v1/agents/${SVC}/directives`, { method: 'PUT', headers: auth(A.token), body: JSON.stringify({ purpose: 'Answer my desk questions in Finnish.' }) });
    assert(d.status === 200, `instructions ${d.status} ${JSON.stringify(d.body.error ?? '')}`);
    const add = await json(`/v1/agents/${SVC}/allow`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ scopes: ['storage:read'] }) });
    assert(add.status === 200, `her own word ${add.status} ${JSON.stringify(add.body.error ?? '')}`);
    const back = await json(`/v1/agents/${SVC}/scopes`, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ scopes: ['memory:read', 'memory:write', 'memory:read-as-owner'] }) });
    assert(back.status === 200, `taking her word back keeps the entry's: ${back.status} ${JSON.stringify(back.body.error ?? '')}`);
    const start = await json(`/v1/agents/${SVC}/start`, { method: 'POST', headers: auth(A.token) });
    assert(start.status === 200, `start ${start.status}`);
    const tasks = await json(`/v1/agents/${SVC}/tasks`, { headers: auth(A.token) });
    assert(tasks.status === 200, `her view of what it does ${tasks.status}`);
});

await test('7b. Nobody but the service gets the agent\'s key or a credential as it; clearance, port, sign-out and the sibling\'s MCP narrowing and mode are refused', async () => {
    const gaii = (await agentsOf(A)).find((x) => x.name === SVC).gaii as string;
    // S1: the person, and the person's own agent, ask the device flow for the service's name: refused, no row.
    for (const [who, token] of [['alice in person', A.token], ['alice\'s helper', aHelper.token]] as const) {
        const r = await json('/v1/agents/device-authorize', { method: 'POST', headers: auth(token), body: JSON.stringify({ agent_name: SVC, owner: A.name }) });
        assert(r.status === 403 && r.body.error?.code === 'OPERATOR_SERVICE_KEY' && !r.body.data?.device_code, `${who}: ${r.status} ${JSON.stringify(r.body.error ?? r.body.data)}`);
    }
    // S2: the person's MCP consent for the service's agent mints nothing.
    const reg = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: `osvp2-${stamp}`, redirect_uris: [] }) });
    assert(reg.status === 201, `register ${reg.status}`);
    const consent = await json('/v1/mcp/authorize-consent', { method: 'POST', body: JSON.stringify({
        client_id: reg.body.client_id, gaii, owner_token: A.token, ...authorizeParams(mcpPkce(BASE)) }) });
    assert(consent.status === 403 && consent.body.error === 'access_denied' && consent.body.reason === 'OPERATOR_SERVICE_KEY' && !consent.body.code,
        `consent ${consent.status} ${JSON.stringify(consent.body)}`);
    // Clearance lowered, porting, and signing out the service's session are refused on a required agent.
    expectRefusal(await json(`/v1/agents/${SVC}/clearance`, { method: 'PATCH', headers: auth(A.token), body: JSON.stringify({ clearance: 'sisainen' }) }), 403, REQUIRED);
    expectRefusal(await json(`/v1/agents/${encodeURIComponent(gaii)}/port`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ target_node_url: 'https://other.example' }) }), 403, REQUIRED);
    const sid = JSON.parse(Buffer.from(aService.split('.')[1], 'base64url').toString()).jti as string;
    const signOut = await json(`/v1/auth/sessions/${encodeURIComponent(sid)}`, { method: 'DELETE', headers: auth(A.token) });
    assert(signOut.status === 403 && signOut.body.error?.code === REQUIRED, `sign-out ${signOut.status} ${JSON.stringify(signOut.body.error)}`);
    // The sibling's MCP narrowing and mode change.
    const s = await openSession(BASE, aHelper.token, 'osvp2-helper2');
    for (const [tool, args] of [['aimeat_agent_scope_narrow', { target_agent_name: SVC }], ['aimeat_agent_mode_set', { target_agent_name: SVC, mode: 'autonomous' }]] as const) {
        const r = await callTool(s, tool, args);
        assert(r.offered && r.isError && r.text.includes(REQUIRED), `${tool}: ${r.text.slice(0, 300)}`);
    }
    assert((await json(`/v1/memory/${SECRET_KEY}?owner_scope=true`, { headers: auth(aService) })).status === 200, 'the service still works');
});

await test('8. Dora\'s own agent under the required service\'s name is not fenced', async () => {
    const r = await json(`/v1/agents/${SVC}`, { method: 'DELETE', headers: auth(D.token) });
    assert(r.status === 200, `dora removes her own agent: ${r.status} ${JSON.stringify(r.body.error ?? '')}`);
});

await test('9. Required back to false: the controls return at once; she turns it off', async () => {
    assert((await setSetting(OP.token, [entry({ required: false }), entryA([B.name])])).status === 200, 'not required');
    const stop = await json(`/v1/agents/${SVC}/stop`, { method: 'POST', headers: auth(A.token) });
    assert(stop.status === 200 && stop.body.data.changed === true, `stop ${stop.status} ${JSON.stringify(stop.body.error ?? '')}`);
    const off = await json(`/v1/operator-services/${SVC}/me`, { method: 'DELETE', headers: auth(A.token) });
    assert(off.status === 200 && off.body.data.agent_removed === true, `off ${off.status} ${JSON.stringify(off.body.error ?? '')}`);
    assert((await mine(A)).state === 'removed', 'removed');
    assert((await assertRefused(await provision(cred.token, A.name), 'her off holds', A)).includes(ACCOUNT_NOTE), 'one sentence');
});

await test('10. Made required again: the next request sets her agent up again, and she is told it is required now', async () => {
    assert((await setSetting(OP.token, [entry(), entryA([B.name])])).status === 200, 'required again');
    assert((await mine(A)).state === 'pending', 'a removed line reads pending while required');
    await provisioned(cred.token, A.name);
    assert((await agentsOf(A)).some((x) => x.name === SVC && x.set_by_operator?.required === true), 'the agent is back, required');
    const [n] = await noticesOf(A, 'operator_service_required');
    assert(!!n && n.i18n?.vars?.required === 'true' && String(n.body).includes('only the operator can turn it off'), `the notice ${JSON.stringify(n).slice(0, 400)}`);
});

await test('11. The operator switches the service off for alice: the agent ends and stays away, whatever required says', async () => {
    const r = await switchFor(OP.token, A.name, { on: false, reason: 'Alice is on leave until spring.' });
    assert(r.status === 200 && r.body.data.agent_ended === true && r.body.data.changed === true, `off ${r.status} ${JSON.stringify(r.body.data ?? r.body.error)}`);
    assert(!(await agentsOf(A)).some((x) => x.name === SVC), 'the agent is gone');
    const s = await mine(A);
    assert(s.state === 'operator_off' && s.may_turn_off === false, `alice's view ${JSON.stringify(s)}`);
    assert((await assertRefused(await provision(cred.token, A.name), 'operator off', A)).includes(ACCOUNT_NOTE), 'one sentence');
    const row = ((await json(`/v1/operator-services/${SVC}/accounts`, { headers: auth(OP.token) })).body.data.accounts as any[]).find((x) => x.account === A.name);
    // B2: who switched it off, when and why, read back on the operator's list and in alice's view.
    assert(row?.state === 'operator_off' && row.reason === 'Alice is on leave until spring.' && typeof row.by === 'string' && !!row.at, `accounts row ${JSON.stringify(row)}`);
    assert((await mine(A)).operator_off_reason === 'Alice is on leave until spring.', `alice reads why: ${JSON.stringify(await mine(A))}`);
    const op = ((await json('/v1/operator-services', { headers: auth(OP.token) })).body.data.services as any[]).find((x) => x.id === SVC);
    assert(op.counts.operator_off >= 1 && op.required === true && op.audience === 'all', `operator view ${JSON.stringify(op)}`);
});

await test('12. Only the operator switches: the credential, a person and a non-operator\'s agent are refused; a bad body and an unknown account too', async () => {
    for (const [who, token] of [['the credential', cred.token], ['a person', A.token], ['a non-operator\'s agent', impAdmin.token]] as const) {
        const r = await json(`/v1/operator-services/${SVC}/accounts/${A.name}`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ on: true }) });
        assert(r.status === 403 && r.body.ok === false, `${who} is refused the switch: ${r.status}`);
    }
    // The request schema (openapi.yaml) answers first; the service's own check is the second line.
    expectRefusal(await switchFor(OP.token, A.name, { on: 'yes' }), 400, 'VALIDATION_ERROR');
    expectRefusal(await switchFor(OP.token, `nobody${stamp}`, { on: true }), 404, 'NOT_FOUND');
    expectRefusal(await switchFor(OP.token, A.name, { on: true }, 'no-such-svc'), 404, 'NOT_FOUND');
    assert((await mine(A)).state === 'operator_off', 'still off');
});

await test('13. The operator\'s agent switches it back on over MCP; the service may ask again', async () => {
    const s = await openSession(BASE, opAdmin.token, 'osvp2-op');
    const r = await callTool(s, 'aimeat_admin_service_access', { action: 'account_on', service: SVC, account: A.name });
    assert(r.offered && !r.isError && r.text.includes('"changed":true'), `account_on: ${r.text.slice(0, 300)}`);
    // The operator's reason goes with the switch.
    assert((await mine(A)).operator_off_reason === null, `the reason is cleared: ${JSON.stringify(await mine(A))}`);
    const credS = await openSession(BASE, cred.token, 'osvp2-cred');
    const refused = await callTool(credS, 'aimeat_admin_service_access', { action: 'account_off', service: SVC, account: A.name });
    // The credential holds operator:service-provision, not operator:admin, so the tool is not offered to it.
    assert(!refused.offered, `the credential is not offered the switch over MCP: ${refused.text.slice(0, 200)}`);
    aService = (await provisioned(cred.token, A.name)).token;
});

await test('14. The audience: only bob gets the audience service; carol stays pending; the accounts route lists bob only', async () => {
    assert((await assertRefused(await provision(credA.token, C.name, SVC_A), 'carol outside', C, SVC_A)).includes(ACCOUNT_NOTE), 'one sentence');
    bobService = (await provisioned(credA.token, B.name, SVC_A)).token;
    const rows =(await json(`/v1/operator-services/${SVC_A}/accounts`, { headers: auth(OP.token) })).body.data.accounts as any[];
    assert(rows.length === 1 && rows[0].account === B.name && rows[0].state === 'active', `rows ${JSON.stringify(rows)}`);
    assert(!(await mine(C, SVC_A)), 'carol is not shown an entry that does not cover her');
});

await test('15. Bob leaves the audience: his agent is ended (not removed); carol is let in', async () => {
    assert((await setSetting(OP.token, [entry(), entryA([C.name])])).status === 200, 'audience moved');
    assert(!(await agentsOf(B)).some((x) => x.name === SVC_A), 'bob\'s agent is gone');
    // The token the sweep ended answers 401 at once.
    const old = await json('/v1/memory?limit=1', { headers: auth(bobService) });
    assert(old.status === 401, `bob's old service token after the sweep: ${old.status}`);
    const s = await mine(B, SVC_A);
    assert(s?.in_audience === false && s.state === 'pending' && s.may_turn_off === false, `bob's view ${JSON.stringify(s)}`);
    await provisioned(credA.token, C.name, SVC_A);
});

await test('16. The entry drops the private read: alice\'s agent loses the word and the read', async () => {
    const plain = entry({ scopes: ['memory:read', 'memory:write'], private_read_reason: undefined });
    assert((await setSetting(OP.token, [plain, entryA([C.name])])).status === 200, 'narrowed');
    const a = (await agentsOf(A)).find((x) => x.name === SVC);
    assert(!a.default_scopes.includes('memory:read-as-owner') && a.set_by_operator?.private_read === false, `alice's agent ${JSON.stringify(a)}`);
    const re = await provisioned(cred.token, A.name);
    aService = re.token;
    const r = await json(`/v1/memory/${SECRET_KEY}?owner_scope=true`, { headers: auth(re.token) });
    // A private record an agent without memory:read-as-owner asks for answers 404, as for no record.
    assert(r.status === 404, `the read is gone: ${r.status}`);
});

await test('16b. A service that is not required still keeps its agent\'s key: rekey, move and migrate are refused; alice\'s own agent passes', async () => {
    const plain = entry({ scopes: ['memory:read', 'memory:write'], private_read_reason: undefined, required: false });
    assert((await setSetting(OP.token, [plain, entryA([C.name])])).status === 200, 'not required');
    // S9: alice turned it off before it was required (case 9); required no longer, it is off for her again.
    assert(!(await agentsOf(A)).some((x) => x.name === SVC) && (await mine(A)).state === 'removed', `her off holds again: ${JSON.stringify(await mine(A))}`);
    assert((await json(`/v1/operator-services/${SVC}/me`, { method: 'POST', headers: auth(A.token) })).status === 200, 'she turns it on');
    aService = (await provisioned(cred.token, A.name)).token;
    const gaii = (await agentsOf(A)).find((x) => x.name === SVC).gaii as string;
    const rekey = await json(`/v1/agents/${encodeURIComponent(gaii)}/rekey`, { method: 'POST', headers: auth(A.token) });
    assert(rekey.status === 403 && rekey.body.error?.code === 'OPERATOR_SERVICE_KEY', `rekey ${rekey.status} ${JSON.stringify(rekey.body.error)}`);
    assert(String(rekey.body.error.message).includes('remove the agent'), `the sentence says she can remove it: ${rekey.body.error.message}`);
    const move = await json(`/v1/agents/v2/agents/${SVC}/move`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ install_id: 'any' }) });
    assert(move.status === 403 && move.body.error?.code === 'OPERATOR_SERVICE_KEY', `move ${move.status} ${JSON.stringify(move.body.error)}`);
    const migrate = await json('/v1/agents/v2/migrate', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ agents: [SVC] }) });
    expectRefusal(migrate, 409, 'NOTHING_TO_MIGRATE');
    const skipped = (migrate.body.error.details?.skipped ?? []) as Array<{ name: string; reason: string }>;
    assert(skipped.some((s) => s.name === SVC && s.reason.includes('holds this agent\'s key')), `migrate skips it with the reason: ${JSON.stringify(skipped)}`);
    // After the refusals the agent is still the service's (the proof holds) and its token still works.
    assert((await agentsOf(A)).find((x) => x.name === SVC)?.set_by_operator?.service === SVC, 'still marked as the service\'s');
    assert((await json(`/v1/agents/${SVC}/tasks`, { headers: auth(aService) })).status !== 401, 'the service\'s token still works');
    // And the fence still binds once the entry is required again.
    assert((await setSetting(OP.token, [{ ...plain, required: true }, entryA([C.name])])).status === 200, 'required again');
    expectRefusal(await json(`/v1/agents/${SVC}/stop`, { method: 'POST', headers: auth(A.token) }), 403, REQUIRED);
    // Alice's own agent is hers: it rekeys, and a move or migration reaches its own checks, not the service's.
    const ownRekey = await json(`/v1/agents/${encodeURIComponent(aHelper.gaii)}/rekey`, { method: 'POST', headers: auth(A.token) });
    assert(ownRekey.status === 200 && ownRekey.body.data.rekeyed === true, `her own agent rekeys: ${ownRekey.status}`);
    const ownMove = await json('/v1/agents/v2/agents/a-helper/move', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ install_id: 'any' }) });
    assert(ownMove.status === 409 && ownMove.body.error?.code === 'V1_AGENT', `her own agent's move reaches its own check: ${ownMove.status} ${JSON.stringify(ownMove.body.error)}`);
    const ownMigrate = await json('/v1/agents/v2/migrate', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ agents: ['a-helper'] }) });
    assert(ownMigrate.status === 409 && ownMigrate.body.error?.code === 'NO_DAEMON'
        && (ownMigrate.body.error.details?.would_move ?? []).includes('a-helper'), `her own agent would move: ${JSON.stringify(ownMigrate.body.error)}`);
});

await test('17. Removing every entry removes the agents', async () => {
    assert((await setSetting(OP.token, [])).status === 200, 'cleared');
    assert(!(await agentsOf(A)).some((x) => x.name === SVC) && !(await agentsOf(C)).some((x) => x.name === SVC_A), 'gone');
});

await test('18. The notice states the private read apart: its own sentence with the reason, and never inside the permission list', async () => {
    const [n] = await noticesOf(A, 'operator_service_on');
    const vars = n?.i18n?.vars ?? {};
    assert(!String(vars.scope_words).split(',').includes('memory:read-as-owner'), `the listed words leave the private read out: ${vars.scope_words}`);
    const body = String(n?.body ?? '');
    const list = body.slice(body.indexOf('Its permissions:'), body.indexOf(String(vars.private_read).trim()));
    assert(body.includes(String(vars.private_read).trim()) && !/private records/i.test(list), `the body: ${body}`);
    // A required service never says the person can turn it off.
    assert(!/turn it off for yourself/i.test(body), `a required service's notice: ${body}`);
});

finish();
