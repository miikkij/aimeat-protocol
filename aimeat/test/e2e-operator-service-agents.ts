/**
 * @file e2e-operator-service-agents.ts
 * @description E2E for operator services (agents.operator_services, AIMEAT_OPERATOR_SERVICES): the
 *   operator switches an outside service on for every account, and the service's credential (an agent
 *   of the operator holding operator:service-provision) gets each person's agent through
 *   POST /v1/agents/device-authorize without that person's press. The person sees the agent marked
 *   `set_by_operator`, gets one notice, and turns it off for themselves; that choice holds.
 *
 *   The designed use: the credential provisions alice, reads the accounts it covers, and hears the
 *   `operator-services` live event. The abuse cases of the build spec, each refused or left pending:
 *   a non-operator, an operator's agent without the word ('*' and operator:admin), a non-operator's
 *   agent holding the word, scopes outside the entry, `*`, `memory:*`, an own-tick word, an entry
 *   naming `*` or an own-tick word (the setting write is refused), a disabled, anonymous, unknown and
 *   other-node owner, service B's name asked by service A's credential, a person's own agent of the
 *   same name, provisioning again after the person turned it off, the setting turned off (the old
 *   token answers 401 and the agent leaves the list), the SSE domain withheld from agents without the
 *   word, and a person reading only their own state.
 * @version-history
 *   v1.8.0 — 2026-11-27 — 4c: POST /v1/agents/import under a present entry's id is refused 403
 *     OPERATOR_SERVICE_KEY for the person (the route admits no agent) and no agent is made; a free name imports.
 *   v1.7.0 — 2026-11-27 — While an entry exists its id is the service's: an unauthenticated request, the
 *     person, POST /v1/agents and every caller that is not the entry's credential are refused 403
 *     OPERATOR_SERVICE_KEY with nothing stored (4b, 10, 12, 18); dora's own agent made before the entry
 *     keeps working and reconnects by the ordinary rules (14); the name is free once the entry is gone (22).
 *   v1.6.0 — 2026-11-27 — Case 6: `set_by_operator.given` names the words the entry gave.
 *   v1.5.0 — 2026-11-27 — The credential refused for its own entry's name gets 403 OPERATOR_SERVICE_REFUSED
 *     and the person is offered no request (11, 13, 14, 17, 18, 20, 21); a request for a service's name
 *     from anyone is not offered either (4b).
 *   v1.4.0 — 2026-11-26 — Case 1: memory:read-as-owner without private_read_reason is refused for the reason
 *     (the private-read ruling); consent:read-as-owner stays refused as an own-tick word. Phase 2's own
 *     cases are e2e-operator-service-phase2.ts.
 *   v1.3.0 — 2026-11-26 — Every entry carries the description the setting now requires, and case 1 refuses
 *     an entry without one; the agent list's `set_by_operator` carries the description.
 *   v1.2.0 — 2026-11-26 — The operator's reads ask operator:admin: its agent reads the operator view and
 *     any entry's accounts on REST and through aimeat_admin_service_access (8, 9, 9a), and still makes
 *     no approval (10); the credential reads only its own entry's accounts and is not offered the tool;
 *     a non-operator's agent holding the operator:admin string is refused.
 *   v1.1.0 — 2026-11-26 — 9a: the MCP tool aimeat_admin_service_access, list and accounts.
 *   v1.0.0 — 2026-11-26 — Initial (wish-situatedai-koko-henkil-st-lle-ilman-henkil-kohtaisia-hyv-ksy).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=operator-service-agents
// suite-hygiene: tests the device flow — the operator-service branch of POST /v1/agents/device-authorize
// is the subject here, so the calls and the device-token poll are written out.

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { ownerSignIn } from './helpers/owner-login.js';
import { BASE, test, assert, json, expectRefusal, finish } from './helpers/harness.js';
import { openSession, callTool } from './helpers/mcp-session.js';

const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const SETTING = 'agents.operator_services';
const SVC = 'desk-helper';
const SVC_B = 'desk-notes';
// The account sentence points to no approval: nothing is kept for such a request.
const ACCOUNT_NOTE = 'This operator service cannot set up an agent for that account now, and no request was kept for it.';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}

const stamp = Date.now().toString(36);
async function setupOwner(label: string) {
    const name = `osv${label}${stamp}`;
    const body = JSON.stringify({ username: name, display_name: `Person ${label}`, password: 'OpSvc12345' });
    let reg = await json('/v1/ghii', { method: 'POST', body });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        reg = await json('/v1/ghii', { method: 'POST', body });
    }
    assert(reg.status === 201, `ghii ${label} ${reg.status}`);
    const tok = await ownerSignIn(BASE, name, 'OpSvc12345');
    return { name, ghii: `${name}@${NODE_ID}`, token: tok.body.data.token as string };
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
    return { gaii, key, token: tok.body.data.token as string };
}
type Agent = Awaited<ReturnType<typeof agentOf>>;

const entry = (over: Record<string, unknown> = {}) => ({
    id: SVC, display_name: 'Desk Helper', description: 'Answers questions about the desk.',
    credential_agent: 'desk-service', scopes: ['memory:read', 'memory:write', 'storage:read'], enabled: true, ...over,
});
const SVC_W = 'desk-writer';
const entryW = (over: Record<string, unknown> = {}) => ({
    id: SVC_W, display_name: 'Desk Writer', description: 'Writes the desk\'s answers into your notes.', credential_agent: 'writer-service',
    scopes: ['memory:read', 'memory:write', 'memory:delete', 'memory:write-as-owner'], write_prefixes: ['desk-writer.'], enabled: true, ...over,
});
const entryB = (over: Record<string, unknown> = {}) => ({
    id: SVC_B, display_name: 'Desk Notes', description: 'Reads your notes to answer desk questions.', credential_agent: 'notes-service', scopes: ['memory:read'], enabled: true, ...over,
});
const setSetting = (token: string, value: unknown) =>
    json('/v1/admin/config', { method: 'PUT', headers: auth(token), body: JSON.stringify({ changes: [{ path: SETTING, value }] }) });

/** The credential (or any caller) asks for `owner`'s agent `agentName`. */
const provision = (token: string, owner: string, agentName = SVC, scopes?: string[]) =>
    json('/v1/agents/device-authorize', {
        method: 'POST', headers: auth(token),
        body: JSON.stringify({ agent_name: agentName, owner, display_name: 'Desk Helper', ...(scopes ? { scopes } : {}) }),
    });
const poll = (deviceCode: string) => json('/v1/agents/device-token', {
    method: 'POST', body: JSON.stringify({ device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
});
const agentsOf = async (owner: Owner) => {
    const r = await json('/v1/agents', { headers: auth(owner.token) });
    assert(r.status === 200, `agents of ${owner.name}: ${r.status}`);
    return r.body.data.agents as any[];
};
const notices = async (owner: Owner) => {
    const r = await json('/v1/notifications?limit=100', { headers: auth(owner.token) });
    assert(r.status === 200, `notifications ${r.status}`);
    // The desk-helper service's notices; the writer service sends its own.
    return (r.body.data.notifications as any[]).filter(n => n.type === 'operator_service_on' && String(n.title).includes('Desk Helper'));
};
/** A request answered and left pending, and its note. */
function assertPending(r: { status: number; body: any }, what: string): string {
    assert(r.status === 200, `${what}: status ${r.status} ${JSON.stringify(r.body.error ?? '')}`);
    assert(r.body.data.auto_approved === false && r.body.data.status === 'pending', `${what}: ${JSON.stringify(r.body.data).slice(0, 300)}`);
    return String(r.body.data.user_instructions ?? '');
}
/**
 * The service's own credential refused for its own entry's name: 403 OPERATOR_SERVICE_REFUSED, nothing
 * stored, and `owner`'s pending list offers no request for the name. Answers the refusal's sentence.
 */
async function assertRefused(r: { status: number; body: any }, what: string, owner?: Owner, name = SVC): Promise<string> {
    assert(r.status === 403 && r.body.error?.code === 'OPERATOR_SERVICE_REFUSED' && !r.body.data?.device_code,
        `${what}: ${r.status} ${JSON.stringify(r.body.error ?? r.body.data).slice(0, 300)}`);
    // An account that cannot sign in (disabled, unknown, anonymous) has no list to read.
    const p = owner ? await json('/v1/agents/device-authorize/pending', { headers: auth(owner.token) }) : { status: 200, body: { data: { requests: [] } } };
    assert(p.status === 200 && !(p.body.data.requests as any[]).some((x) => x.agent_name === name), `${what}: pending list ${JSON.stringify(p.body.data)}`);
    return String(r.body.error.message);
}

interface Stream { domains(): string[]; close(): void }
async function openStream(token: string): Promise<Stream> {
    const t = await json('/v1/events/ticket', { method: 'POST', headers: auth(token) });
    assert(t.status === 200 && !!t.body.data.ticket, `ticket ${t.status}`);
    const ctrl = new AbortController();
    const res = await fetch(`${BASE}/v1/events?ticket=${t.body.data.ticket}`, { signal: ctrl.signal });
    assert(res.status === 200, `stream ${res.status}`);
    let buf = '';
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    void (async () => {
        try { for (;;) { const { value, done } = await reader.read(); if (done) break; if (value) buf += dec.decode(value, { stream: true }); } }
        catch { /* aborted on close() */ }
    })();
    return {
        domains: () => buf.split('\n').filter(l => l.startsWith('data: ')).flatMap(l => {
            try { const p = JSON.parse(l.slice(6)); return Array.isArray(p.domains) ? p.domains : []; } catch { return []; }
        }),
        close: () => ctrl.abort(),
    };
}
const settle = (ms: number) => new Promise(r => setTimeout(r, ms));

console.log('\n=== AIMEAT Operator services (an agent for every account by an operator setting) E2E ===\n');

let OP: Owner, A: Owner, B: Owner, C: Owner, D: Owner, E: Owner, G: Owner, H: Owner, X: Owner;
let cred: Agent, credB: Agent, credW: Agent, wild: Agent, opAdmin: Agent, imp: Agent, impAdmin: Agent;
let dorasOwn: Agent;
/** The refusal of a request for a new agent under a service's name: 403 OPERATOR_SERVICE_KEY, nothing stored. */
const SERVICE_NAME = 'belongs to the operator service';
let aliceToken = '';

await test('Setup: the operator, eight people, and the agents that ask', async () => {
    // The first account of a fresh node is the operator (test 4 proves it: only an operator sets the setting).
    OP = await setupOwner('op');
    A = await setupOwner('a'); B = await setupOwner('b'); C = await setupOwner('c');
    D = await setupOwner('d'); E = await setupOwner('e'); G = await setupOwner('g'); H = await setupOwner('h'); X = await setupOwner('x');
    cred = await agentOf(OP, 'desk-service', ['operator:service-provision', 'memory:read']);
    credB = await agentOf(OP, 'notes-service', ['operator:service-provision']);
    credW = await agentOf(OP, 'writer-service', ['operator:service-provision']);
    wild = await agentOf(OP, 'wild-one', ['*']);
    opAdmin = await agentOf(OP, 'op-admin', ['operator:admin']);
    imp = await agentOf(X, 'desk-service', ['operator:service-provision']);
    impAdmin = await agentOf(X, 'fake-admin', ['operator:admin']);
    assert(new Set([cred.gaii, credB.gaii, wild.gaii, opAdmin.gaii, imp.gaii, impAdmin.gaii]).size === 6, 'six distinct agents');
    // Dora's own agent under the service's name, made BEFORE the entry exists (test 14): it stays hers.
    dorasOwn = await agentOf(D, SVC, ['memory:read']);
});

// ── The setting ──

await test('1. The setting refuses *, a domain wildcard, an own-tick word, a word that makes or changes agents, and an unknown word, with the field named', async () => {
    // memory:read-as-owner is the one outside-wildcard word an entry may name, with its reason (ruling
    // 2026-11-26), so without the reason that field is the one refused; consent:read-as-owner stays refused.
    for (const [scopes, field] of [[['*'], 'scopes[0]'], [['memory:read', 'memory:*'], 'scopes[1]'],
        [['memory:read-as-owner'], 'private_read_reason is required'], [['memory:read', 'consent:read-as-owner'], 'scopes[1]'],
        [['memory:read', 'agent:write'], 'scopes[1]'], [['consent:manage'], 'scopes[0]'], [['memory:read', 'nothing:here'], 'scopes[1]'],
        [['memory:read', 'memory:write-as-owner'], 'write_prefixes is required']] as const) {
        const r = await setSetting(OP.token, [entry({ scopes })]);
        // PUT /v1/admin/config answers 400 INVALID_INPUT when nothing applied, each refusal in details.errors.
        expectRefusal(r, 400, 'INVALID_INPUT');
        const errors = r.body.error.details?.errors ?? [];
        assert(errors.length === 1 && errors[0].path === SETTING, `one refusal for the setting: ${JSON.stringify(errors)}`);
        assert(String(errors[0].reason).includes(field), `the refusal names ${field}: ${JSON.stringify(errors)}`);
    }
    // The description is the one place a person learns what the service is: an entry without one is refused.
    for (const description of [undefined, 'Too short.']) {
        const r = await setSetting(OP.token, [entry({ description })]);
        expectRefusal(r, 400, 'INVALID_INPUT');
        assert(String(r.body.error.details?.errors?.[0]?.reason).includes('description is required'), `no description: ${JSON.stringify(r.body.error.details)}`);
    }
});

await test('1b. The MCP config tool refuses a bad entry the same way, naming the field', async () => {
    const s = await openSession(BASE, opAdmin.token, 'osv-config');
    const r = await callTool(s, 'aimeat_admin_config_set', { changes: [{ path: SETTING, value: [entry({ scopes: ['memory:read', 'agent:write'] })] }] });
    assert(r.offered && r.isError, `refused: ${r.text.slice(0, 300)}`);
    assert(r.text.includes('scopes[1]') && r.text.includes('agent:write'), `names the field: ${r.text.slice(0, 300)}`);
});

await test('2. Only an operator sets it (a person is refused)', async () => {
    const r = await setSetting(A.token, [entry(), entryB()]);
    expectRefusal(r, 403);
    assert(r.body.ok === false, 'refused');
});

await test('2b. device-authorize refuses an owner that is not text, before anything else', async () => {
    for (const owner of [['alice'], { name: 'alice' }, 42]) {
        const r = await json('/v1/agents/device-authorize', { method: 'POST', headers: auth(cred.token), body: JSON.stringify({ agent_name: SVC, owner }) });
        // The request schema answers first (VALIDATION_ERROR); the route's own check is the second line.
        expectRefusal(r, 400, 'VALIDATION_ERROR');
        assert(String(r.body.error.message).includes('owner'), `names owner: ${r.body.error.message}`);
    }
});

await test('3. Off by default: the credential\'s request stays pending', async () => {
    const note = assertPending(await provision(cred.token, A.name, SVC, ['memory:read']), 'with no setting');
    assert(!note.startsWith('Auto-approved'), 'not approved');
});

await test('4. The operator switches three services on, one that writes as the person under one prefix', async () => {
    const r = await setSetting(OP.token, [entry(), entryB(), entryW()]);
    assert(r.status === 200 && (r.body.data.errors ?? []).length === 0, `set ${r.status}: ${JSON.stringify(r.body).slice(0, 400)}`);
    // The Config tab's round trip: the admin view answers the list itself, marked json, and PUT takes it back unchanged.
    const view = await json(`/v1/admin/config?q=${SETTING}`, { headers: auth(OP.token) });
    const row = view.body.data?.schema?.[SETTING];
    assert(row?.json === true && Array.isArray(row.value) && row.value.map((x: any) => x.id).join() === [SVC, SVC_B, SVC_W].join()
        && JSON.stringify(row.value[2].write_prefixes) === JSON.stringify(['desk-writer.']), `the admin view row: ${JSON.stringify(row).slice(0, 300)}`);
    const back = await setSetting(OP.token, row.value);
    assert(back.status === 200 && (back.body.data.errors ?? []).length === 0, `the same list saved back: ${JSON.stringify(back.body).slice(0, 300)}`);
});

await test('4b. While the entry exists its id is the service\'s: an unauthenticated request, the person and POST /v1/agents are refused, nothing stored', async () => {
    const r = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: SVC, owner: B.name }) });
    assert(r.status === 403 && r.body.error?.code === 'OPERATOR_SERVICE_KEY' && String(r.body.error.message).includes(SERVICE_NAME) && !r.body.data?.device_code,
        `unauthenticated: ${r.status} ${JSON.stringify(r.body.error ?? r.body.data)}`);
    const self = await json('/v1/agents/device-authorize', { method: 'POST', headers: auth(B.token), body: JSON.stringify({ agent_name: SVC, owner: B.name }) });
    assert(self.status === 403 && self.body.error?.code === 'OPERATOR_SERVICE_KEY', `bob in person: ${self.status} ${JSON.stringify(self.body.error)}`);
    const made = await json('/v1/agents', { method: 'POST', headers: auth(B.token),
        body: JSON.stringify({ name: SVC, owner: B.name, capabilities: ['memory'], model: 'gpt-4o', scopes: ['memory:read'] }) });
    assert(made.status === 403 && made.body.error?.code === 'OPERATOR_SERVICE_KEY', `POST /v1/agents: ${made.status} ${JSON.stringify(made.body.error)}`);
    const proposed = await json('/v1/agents/v2/agent-proposals', { method: 'POST', headers: auth(B.token),
        body: JSON.stringify({ name: SVC, purpose: 'Answers my desk questions for me every day.' }) });
    assert(proposed.status === 403 && proposed.body.error?.code === 'OPERATOR_SERVICE_KEY', `a proposal: ${proposed.status} ${JSON.stringify(proposed.body.error)}`);
    const p = await json('/v1/agents/device-authorize/pending', { headers: auth(B.token) });
    assert(p.status === 200 && !(p.body.data.requests as any[]).some((x) => x.agent_name === SVC), `bob is offered no request for ${SVC}: ${JSON.stringify(p.body.data)}`);
});

await test('4c. POST /v1/agents/import under a present entry\'s id is refused OPERATOR_SERVICE_KEY with no agent made; a free name imports', async () => {
    const bundle = (name: string) => JSON.stringify({ agent: { name, owner: B.name, display_name: 'Imported helper' }, memory: [] });
    // Bob in person: the reserved name is refused before anything is made.
    const self = await json('/v1/agents/import', { method: 'POST', headers: auth(B.token), body: bundle(SVC) });
    assert(self.status === 403 && self.body.error?.code === 'OPERATOR_SERVICE_KEY' && String(self.body.error.message).includes(SERVICE_NAME),
        `bob's import of ${SVC}: ${self.status} ${JSON.stringify(self.body.error)}`);
    // Bob's own agent, even holding every word: the route takes the person only, so it is refused too.
    const bobs = await agentOf(B, `bob-mover-${stamp}`, ['*', 'agent:write']);
    const viaAgent = await json('/v1/agents/import', { method: 'POST', headers: auth(bobs.token), body: bundle(SVC) });
    expectRefusal(viaAgent, 403, 'ACCESS_DENIED');
    assert(!(await agentsOf(B)).some((x) => x.name === SVC), `no ${SVC} agent exists for bob after the imports`);
    // The same import under a free name is not this rule's: it imports.
    const freeName = `bob-imported-${stamp}`;
    const free = await json('/v1/agents/import', { method: 'POST', headers: auth(B.token), body: bundle(freeName) });
    const reservedRule = free.body.error?.code === 'OPERATOR_SERVICE_KEY';
    assert(!reservedRule && free.status === 201, `a free name imports: ${free.status} ${JSON.stringify(free.body.error)}`);
    // Leave bob with the agents the later cases expect.
    for (const name of [freeName, `bob-mover-${stamp}`]) {
        const del = await json(`/v1/agents/${encodeURIComponent(name)}`, { method: 'DELETE', headers: auth(B.token) });
        assert(del.status === 200, `remove ${name}: ${del.status} ${JSON.stringify(del.body.error ?? '')}`);
    }
});

// ── The designed use ──

await test('5. The credential gets alice\'s agent at once, and the first poll hands it the token', async () => {
    const r = await provision(cred.token, A.name, SVC, ['memory:read', 'memory:write', 'storage:read']);
    assert(r.status === 200 && r.body.data.auto_approved === true, `approved: ${JSON.stringify(r.body.data ?? r.body.error).slice(0, 400)}`);
    const p = await poll(r.body.data.device_code);
    assert(p.status === 200 && !!p.body.token, `poll ${p.status}: ${JSON.stringify(p.body).slice(0, 200)}`);
    assert(p.body.gaii === `${SVC}#${A.name}@${NODE_ID}`, `gaii ${p.body.gaii}`);
    assert(JSON.stringify(p.body.scopes) === JSON.stringify(['memory:read', 'memory:write', 'storage:read']), `scopes ${JSON.stringify(p.body.scopes)}`);
    aliceToken = p.body.token;
    const mem = await json('/v1/memory?limit=1', { headers: auth(aliceToken) });
    assert(mem.status === 200, `the new agent reads alice's memory: ${mem.status}`);
});

await test('6. Alice sees the agent marked as set by the operator, and is told once', async () => {
    const a = (await agentsOf(A)).find(x => x.name === SVC);
    assert(!!a, 'the agent is in alice\'s list');
    assert(a.set_by_operator?.service === SVC && a.set_by_operator?.display_name === 'Desk Helper'
        && a.set_by_operator?.description === 'Answers questions about the desk.'
        // The words the entry gave, from the ledger: the three the request named.
        && JSON.stringify([...(a.set_by_operator?.given ?? [])].sort()) === JSON.stringify(['memory:read', 'memory:write', 'storage:read']),
        `set_by_operator ${JSON.stringify(a.set_by_operator)}`);
    const n = await notices(A);
    assert(n.length === 1, `one notice: ${n.length}`);
    assert(String(n[0].link ?? '').includes('tab=agents'), `the notice points at the Agents page: ${n[0].link}`);
    // The page says the permissions in its own language from the words, and the operator's own description
    // in a sentence of its own.
    const vars = n[0].i18n?.vars ?? {};
    assert(vars.scope_words === 'memory:read,memory:write,storage:read' && vars.description === 'Answers questions about the desk.',
        `the notice carries the words and the description: ${JSON.stringify(vars)}`);
    assert(String(n[0].body).includes('The operator\'s description: Answers questions about the desk.') && !String(n[0].body).includes('..')
        && String(n[0].body).includes('Its permissions: “') && String(n[0].body).includes('”; “')
        && String(n[0].body).includes('a message to support@operators.'),
        `the stored body: ${n[0].body}`);
    // A service's agent owes no onboarding: no test task waits in alice's list, and the agent has no onboarding.
    const tasks = await json(`/v1/agents/${SVC}/tasks?per_page=100`, { headers: auth(A.token) });
    assert(tasks.status === 200 && !(tasks.body.data.tasks as any[]).some((t) => /onboarding/i.test(String(t.title))), `no onboarding task: ${JSON.stringify(tasks.body.data?.tasks ?? tasks.body.error).slice(0, 300)}`);
    assert(a.health?.onboarding === null, `no onboarding for the service's agent: ${JSON.stringify(a.health?.onboarding)}`);
});

await test('7. Asking again for the same person connects the same agent again and sends no second notice', async () => {
    const r = await provision(cred.token, A.name);
    assert(r.body.data?.auto_approved === true, `again: ${JSON.stringify(r.body.data ?? r.body.error).slice(0, 300)}`);
    const p = await poll(r.body.data.device_code);
    assert(p.status === 200 && !!p.body.token, 'a new token');
    aliceToken = p.body.token;
    assert((await notices(A)).length === 1, 'still one notice');
});

await test('7b. The service\'s agent, even holding agent:write the person gave it, does not approve a sibling', async () => {
    const r = await provision(cred.token, H.name);
    assert(r.body.data?.auto_approved === true, `hana provisioned: ${JSON.stringify(r.body.data ?? r.body.error).slice(0, 200)}`);
    const add = await json(`/v1/agents/${SVC}/allow`, { method: 'POST', headers: auth(H.token), body: JSON.stringify({ scopes: ['agent:write'] }) });
    assert(add.status === 200, `hana gives it agent:write: ${add.status} ${JSON.stringify(add.body.error ?? '')}`);
    const again = await provision(cred.token, H.name);
    const p = await poll(again.body.data.device_code);
    assert((p.body.scopes as string[]).includes('agent:write'), `the person's word survives the reconnect: ${JSON.stringify(p.body.scopes)}`);
    const sibling = await json('/v1/agents/device-authorize', {
        method: 'POST', headers: auth(p.body.token), body: JSON.stringify({ agent_name: 'helper', owner: H.name, scopes: ['memory:read'] }),
    });
    const note = assertPending(sibling, 'the service\'s agent asks for a sibling');
    assert(note.includes('An agent an operator service set up does not approve other agents'), `note: ${note.slice(-250)}`);
    assert(!(await agentsOf(H)).some(x => x.name === 'helper'), 'no sibling was made');
});

await test('8. GET /v1/operator-services: the operator reads counts, a person reads only their own state', async () => {
    const op = await json('/v1/operator-services', { headers: auth(OP.token) });
    assert(op.status === 200 && op.body.data.view === 'operator', `operator view ${op.status}`);
    const s = op.body.data.services.find((x: any) => x.id === SVC);
    assert(s.counts.active === 2 && s.usable === true, `counts (alice and hana) ${JSON.stringify(s.counts)}`);
    // The operator's read word is operator:admin: its agent reads the operator view without the provisioning word.
    const adminView = await json('/v1/operator-services', { headers: auth(opAdmin.token) });
    assert(adminView.body.data?.view === 'operator' && adminView.body.data.services.find((x: any) => x.id === SVC)?.counts?.active === 2,
        `an operator:admin agent reads the operator view: ${JSON.stringify(adminView.body).slice(0, 300)}`);
    // The credential holds the provisioning word and not agent:read: the list is not its route.
    expectRefusal(await json('/v1/operator-services', { headers: auth(cred.token) }), 403);
    // A non-operator's agent holding the operator:admin string reads only its own account's state.
    const fake = await json('/v1/operator-services', { headers: auth(impAdmin.token) });
    assert(fake.status === 200 && fake.body.data.view === 'person' && !JSON.stringify(fake.body.data).includes('counts'), `non-operator with operator:admin: ${JSON.stringify(fake.body).slice(0, 200)}`);
    const a = await json('/v1/operator-services', { headers: auth(A.token) });
    assert(a.status === 200 && a.body.data.view === 'person', `person view ${a.status}`);
    const mine = a.body.data.services.find((x: any) => x.id === SVC);
    assert(mine.state === 'active' && mine.agent === `${SVC}#${A.name}@${NODE_ID}`, `alice's state ${JSON.stringify(mine)}`);
    assert(!JSON.stringify(a.body.data).includes('counts') && !JSON.stringify(a.body.data).includes(B.name), 'no counts and no other account');
    const b = await json('/v1/operator-services', { headers: auth(B.token) });
    assert(b.body.data.services.find((x: any) => x.id === SVC)?.state === 'pending', 'bob is pending');
    const w = await json('/v1/operator-services', { headers: auth(wild.token) });
    assert(w.body.data?.view === 'person', 'a \'*\' agent of the operator reads no operator view');
});

await test('9. The accounts route: the credential and the operator read it, nobody else', async () => {
    const r = await json(`/v1/operator-services/${SVC}/accounts?limit=500`, { headers: auth(cred.token) });
    assert(r.status === 200, `credential ${r.status}: ${JSON.stringify(r.body.error)}`);
    const rows = r.body.data.accounts as any[];
    assert(rows.find(x => x.account === A.name)?.state === 'active', 'alice active');
    assert(rows.find(x => x.account === B.name)?.state === 'pending', 'bob pending');
    assert(Object.keys(rows[0]).sort().join() === 'account,at,ghii,state', `fields ${Object.keys(rows[0])}`);
    const page = await json(`/v1/operator-services/${SVC}/accounts?limit=2`, { headers: auth(OP.token) });
    assert(page.status === 200 && page.body.data.accounts.length === 2 && !!page.body.data.next_cursor, 'the operator reads a page with a cursor');
    const next = await json(`/v1/operator-services/${SVC}/accounts?limit=2&cursor=${encodeURIComponent(page.body.data.next_cursor)}`, { headers: auth(OP.token) });
    assert(next.body.data.accounts[0].account > page.body.data.next_cursor, 'the next page follows');
    // An operator's agent holding operator:admin, without the provisioning word, reads any entry's accounts.
    const adm = await json(`/v1/operator-services/${SVC_B}/accounts?limit=500`, { headers: auth(opAdmin.token) });
    assert(adm.status === 200 && adm.body.data.service === SVC_B && (adm.body.data.accounts as any[]).some(x => x.account === A.name),
        `an operator:admin agent reads the accounts: ${adm.status} ${JSON.stringify(adm.body.error ?? '')}`);
    for (const [who, tok] of [['a \'*\' agent', wild.token], ['a person', A.token],
        ['another service\'s credential', credB.token], ['a non-operator\'s agent holding the word', imp.token],
        ['a non-operator\'s agent holding operator:admin', impAdmin.token]] as const) {
        const refused = await json(`/v1/operator-services/${SVC}/accounts`, { headers: auth(tok) });
        assert(refused.status === 403, `${who} is refused the accounts: ${refused.status} ${JSON.stringify(refused.body.error ?? '')}`);
    }
});

await test('9a. aimeat_admin_service_access: an operator:admin agent reads list and accounts; the credential, a non-operator and an agent without the word are not', async () => {
    const tool = (s: Awaited<ReturnType<typeof openSession>>, args: Record<string, unknown>) => callTool(s, 'aimeat_admin_service_access', args);
    // The operator's chat AI holds operator:admin, the word of the other operator read tools, and not the provisioning word.
    const so = await openSession(BASE, opAdmin.token, 'osv-tool-admin');
    const list = await tool(so, { action: 'list' });
    assert(!list.isError && list.data?.view === 'operator', `operator:admin list: ${list.text.slice(0, 300)}`);
    assert(list.data.services.find((x: any) => x.id === SVC)?.counts?.active === 2, `counts: ${list.text.slice(0, 300)}`);
    // The operator's own account's state rides on the operator's view too, for the Agents page's Turn on again.
    assert(list.data.services.find((x: any) => x.id === SVC)?.state === 'pending', `the operator's own state: ${list.text.slice(0, 300)}`);
    for (const service of [SVC, SVC_B]) {
        const acc = await tool(so, { action: 'accounts', service, limit: 2 });
        assert(!acc.isError && acc.data?.service === service && acc.data.accounts.length === 2 && !!acc.data.next_cursor, `${service} accounts: ${acc.text.slice(0, 300)}`);
        const next = await tool(so, { action: 'accounts', service, limit: 2, cursor: acc.data.next_cursor });
        assert(!next.isError && next.data.accounts[0].account > acc.data.next_cursor, `${service} next page: ${next.text.slice(0, 200)}`);
    }
    const none = await tool(so, { action: 'accounts' });
    assert(none.isError && /^INVALID_INPUT: /.test(none.text), `accounts without a service: ${none.text.slice(0, 200)}`);
    const unknown = await tool(so, { action: 'accounts', service: 'no-such-service' });
    assert(unknown.isError && /^NOT_FOUND: /.test(unknown.text), `an unknown service: ${unknown.text.slice(0, 200)}`);
    // A non-operator's agent holding the operator:admin string is offered the tool and refused by the account check.
    const sx = await openSession(BASE, impAdmin.token, 'osv-tool-fake-admin');
    for (const args of [{ action: 'list' }, { action: 'accounts', service: SVC }]) {
        const r = await tool(sx, args);
        assert(r.isError && /^FORBIDDEN: /.test(r.text), `non-operator with operator:admin, ${args.action}: ${r.text.slice(0, 200)}`);
    }
    // Without operator:admin the tool is not offered: the credential (it reads its accounts on REST) and alice's service agent.
    for (const [who, tok] of [['the credential', cred.token], ['alice\'s service agent', aliceToken]] as const) {
        const s = await openSession(BASE, tok, `osv-tool-${who.length}`);
        const r = await tool(s, { action: 'accounts', service: SVC });
        assert(r.isError && !r.offered, `${who} is not offered it: ${r.text.slice(0, 200)}`);
    }
});

// ── Writing as the person, fenced by the entry's prefixes ──

const memWrite = (token: string, key: string, ownerScope = true) => json('/v1/memory', {
    method: 'POST', headers: auth(token), body: JSON.stringify({ key, value: { n: 1 }, ...(ownerScope ? { owner_scope: true } : {}) }),
});

await test('9b. The writer service writes as alice under its prefix and nowhere else: write, patch and delete outside it are 403', async () => {
    const r = await provision(credW.token, A.name, SVC_W, ['memory:read', 'memory:write', 'memory:delete', 'memory:write-as-owner']);
    assert(r.body.data?.auto_approved === true, `writer provisioned: ${JSON.stringify(r.body.data ?? r.body.error).slice(0, 300)}`);
    const wTok = (await poll(r.body.data.device_code)).body.token as string;
    const inside = await memWrite(wTok, 'desk-writer.note');
    assert(inside.status === 201, `inside the prefix: ${inside.status} ${JSON.stringify(inside.body.error ?? '')}`);
    assert((await json('/v1/memory/desk-writer.note', { headers: auth(A.token) })).status === 200, 'the record is alice\'s own');
    const outside = await memWrite(wTok, 'diary.secret');
    expectRefusal(outside, 403, 'OPERATOR_SERVICE_PREFIX');
    assert(String(outside.body.error.message).includes('"desk-writer."'), `names the prefix: ${outside.body.error.message}`);
    // Alice's own record outside the prefix: the service may neither patch nor delete it.
    const own = await memWrite(A.token, 'diary.entry', false);
    assert(own.status === 201, `alice writes her diary: ${own.status}`);
    const patch = await json('/v1/memory/diary.entry', { method: 'PATCH', headers: auth(wTok), body: JSON.stringify({ patch: { n: 2 }, owner_scope: true }) });
    expectRefusal(patch, 403, 'OPERATOR_SERVICE_PREFIX');
    const del = await json('/v1/memory/diary.entry?owner_scope=true', { method: 'DELETE', headers: auth(wTok) });
    expectRefusal(del, 403, 'OPERATOR_SERVICE_PREFIX');
    assert((await json('/v1/memory/diary.entry', { headers: auth(A.token) })).body.data?.value?.n === 1, 'her diary is unchanged');
});

await test('9c. Alice\'s own agent with the same word is not fenced', async () => {
    const mine = await agentOf(A, 'own-writer', ['memory:read', 'memory:write', 'memory:write-as-owner']);
    const w = await memWrite(mine.token, 'diary.from-my-agent');
    assert(w.status === 201, `her own agent writes as her: ${w.status} ${JSON.stringify(w.body.error ?? '')}`);
});

await test('9d. Narrowing the prefixes binds at once, with no sweep', async () => {
    const r = await provision(credW.token, A.name, SVC_W);
    const wTok = (await poll(r.body.data.device_code)).body.token as string;
    const set = await setSetting(OP.token, [entry(), entryB(), entryW({ write_prefixes: ['desk-writer.inbox.'] })]);
    assert(set.status === 200 && (set.body.data.errors ?? []).length === 0, `narrow ${set.status}`);
    expectRefusal(await memWrite(wTok, 'desk-writer.note2'), 403, 'OPERATOR_SERVICE_PREFIX');
    const ok = await memWrite(wTok, 'desk-writer.inbox.1');
    assert(ok.status === 201, `inside the narrowed prefix: ${ok.status}`);
    const view = (await json('/v1/operator-services', { headers: auth(A.token) })).body.data.services.find((x: any) => x.id === SVC_W);
    assert(JSON.stringify(view?.write_prefixes) === JSON.stringify(['desk-writer.inbox.']), `alice sees what it may write: ${JSON.stringify(view)}`);
});

await test('9e. Even with the words alice gives it, the writer service changes neither her AI settings nor her calibrator records', async () => {
    // The two words have a tick of their own on the agent's page, which writes the whole list.
    const held = ((await agentsOf(A)).find(x => x.name === SVC_W)?.default_scopes ?? []) as string[];
    const add = await json(`/v1/agents/${SVC_W}/scopes`, { method: 'PATCH', headers: auth(A.token),
        body: JSON.stringify({ scopes: [...new Set([...held, 'memory:write-reserved', 'memory:read-as-owner'])] }) });
    assert(add.status === 200, `alice gives it the words: ${add.status} ${JSON.stringify(add.body.error ?? '')}`);
    const r = await provision(credW.token, A.name, SVC_W);
    const p = await poll(r.body.data.device_code);
    assert((p.body.scopes as string[]).includes('memory:write-reserved'), `her words survive the reconnect: ${JSON.stringify(p.body.scopes)}`);
    const settings = await json('/v1/ai/settings', { method: 'POST', headers: auth(p.body.token), body: JSON.stringify({ daily_budget_usd: 1, owner_scope: true }) });
    expectRefusal(settings, 403, 'OPERATOR_SERVICE_PREFIX');
    const cal = await json('/v1/calibrator', { method: 'POST', headers: auth(p.body.token), body: JSON.stringify({ name: 'svc' }) });
    expectRefusal(cal, 403, 'OPERATOR_SERVICE_PREFIX');
});

// ── Abuse: callers ──

await test('10. Callers without the standing are refused, nothing stored: \'*\', operator:admin (the read word), a non-operator\'s agent with the word', async () => {
    // operator:admin reads the services (8, 9, 9a) and never makes this approval: that takes operator:service-provision.
    // None is the entry's credential, and the name is the service's while the entry exists.
    for (const [who, tok] of [['\'*\' agent', wild.token], ['operator:admin agent', opAdmin.token], ['non-operator agent with the word', imp.token]] as const) {
        const r = await provision(tok, B.name);
        assert(r.status === 403 && r.body.error?.code === 'OPERATOR_SERVICE_KEY' && !r.body.data?.device_code, `${who}: ${r.status} ${JSON.stringify(r.body.error ?? r.body.data)}`);
    }
    assert(!(await agentsOf(B)).some(x => x.name === SVC), 'bob has no service agent');
});

await test('11. A scope outside the entry, *, memory:* and an own-tick word are refused, and leave bob no request to approve', async () => {
    for (const scopes of [['memory:delete'], ['*'], ['memory:*'], ['memory:read-as-owner']]) {
        const r = await provision(cred.token, B.name, SVC, scopes);
        if (r.status === 400) continue;  // above the node's maximum: refused before anything is written
        await assertRefused(r, scopes.join(), B);
    }
    assert(!(await agentsOf(B)).some(x => x.name === SVC), 'bob has no service agent');
});

await test('12. Service B\'s agent name with service A\'s credential, and A\'s name with B\'s credential, are refused, nothing stored', async () => {
    for (const [who, r] of [['A asks for B', await provision(cred.token, B.name, SVC_B)], ['B asks for A', await provision(credB.token, B.name, SVC)]] as const) {
        assert(r.status === 403 && r.body.error?.code === 'OPERATOR_SERVICE_KEY', `${who}: ${r.status} ${JSON.stringify(r.body.error ?? r.body.data)}`);
    }
    const ok = await provision(credB.token, B.name, SVC_B);
    assert(ok.body.data?.auto_approved === true, `B's own credential for B's name: ${JSON.stringify(ok.body.data ?? ok.body.error).slice(0, 300)}`);
});

// ── Abuse: the named account ──

await test('13. A disabled, an unknown and the anonymous account are refused with one sentence and nothing stored; another node\'s is refused', async () => {
    const dis = await json(`/v1/admin/owners/${C.name}/disable`, { method: 'POST', headers: auth(OP.token) });
    assert(dis.status === 200, `disable ${dis.status}`);
    const notes = [];
    for (const owner of [C.name, `nobody${stamp}`, 'anonymous']) {
        const note = await assertRefused(await provision(cred.token, owner), owner);
        assert(note.includes(ACCOUNT_NOTE), `${owner} note: ${note.slice(-300)}`);
        notes.push(note);
    }
    assert(new Set(notes).size === 1, `one sentence for every account: ${JSON.stringify(notes)}`);
    const peer = await provision(cred.token, `alice@peer`);
    assert(peer.body.data?.auto_approved !== true, `another node's account: ${peer.status}`);
});

await test('14. A person\'s own agent made before the entry is not taken over, keeps working, and reconnects by the ordinary rules', async () => {
    const own = dorasOwn;
    const note = await assertRefused(await provision(cred.token, D.name), 'namesake', D);
    assert(note.includes(ACCOUNT_NOTE), `note ${note.slice(-200)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii: own.gaii, timestamp: ts, signature: await sign(own.key, own.gaii + ts) }) });
    assert(tok.status === 200, 'the person\'s own agent keeps its key');
    // Dora connects her own agent again from her own session: the same-owner rules, as before the entry.
    const again = await json('/v1/agents/device-authorize', { method: 'POST', headers: auth(D.token), body: JSON.stringify({ agent_name: SVC, owner: D.name, scopes: ['memory:read'] }) });
    assert(again.status === 200 && again.body.data.auto_approved === true, `dora reconnects her own agent: ${again.status} ${JSON.stringify(again.body.error ?? again.body.data).slice(0, 300)}`);
    const d = (await agentsOf(D)).find(x => x.name === SVC);
    assert(d.set_by_operator === null, 'and is not marked as the operator\'s');
});

// ── The live event ──

await test('15. The operator-services event reaches the credential and the operator, not \'*\' or operator:admin agents', async () => {
    const [sCred, sOp, sWild, sAdmin] = await Promise.all([openStream(cred.token), openStream(OP.token), openStream(wild.token), openStream(opAdmin.token)]);
    try {
        await settle(300);
        const off = await json(`/v1/operator-services/${SVC}/me`, { method: 'DELETE', headers: auth(B.token) });
        assert(off.status === 200, `bob turns it off ${off.status}`);
        const deadline = Date.now() + 4000;
        while (Date.now() < deadline && !(sCred.domains().includes('operator-services') && sOp.domains().includes('operator-services'))) await settle(50);
        assert(sCred.domains().includes('operator-services'), `the credential heard it: ${sCred.domains()}`);
        assert(sOp.domains().includes('operator-services'), 'the operator heard it');
        await settle(1500);
        assert(!sWild.domains().includes('operator-services'), `a '*' agent heard it: ${sWild.domains()}`);
        assert(!sAdmin.domains().includes('operator-services'), 'an operator:admin agent heard it');
    } finally { for (const s of [sCred, sOp, sWild, sAdmin]) s.close(); }
});

// ── The person's own switch ──

await test('16. Only the person in person turns it off (alice\'s service agent is refused)', async () => {
    const r = await json(`/v1/operator-services/${SVC}/me`, { method: 'DELETE', headers: auth(aliceToken) });
    expectRefusal(r, 403);
    assert((await agentsOf(A)).some(x => x.name === SVC), 'her service agent is still there');
});

await test('17. Alice turns it off: the agent goes, its token stops, and the service is refused until she turns it on', async () => {
    const off = await json(`/v1/operator-services/${SVC}/me`, { method: 'DELETE', headers: auth(A.token) });
    assert(off.status === 200 && off.body.data.agent_removed === true, `off ${off.status}: ${JSON.stringify(off.body)}`);
    assert(!(await agentsOf(A)).some(x => x.name === SVC), 'gone from her list');
    const mem = await json('/v1/memory?limit=1', { headers: auth(aliceToken) });
    assert(mem.status === 401, `the old token: ${mem.status}`);
    const note = await assertRefused(await provision(cred.token, A.name), 'after off', A);
    assert(note.includes(ACCOUNT_NOTE), 'one sentence');
    const on = await json(`/v1/operator-services/${SVC}/me`, { method: 'POST', headers: auth(A.token) });
    assert(on.status === 200 && on.body.data.was_off === true, `on ${on.status}`);
    const again = await provision(cred.token, A.name);
    assert(again.body.data?.auto_approved === true, `after on: ${JSON.stringify(again.body.data ?? again.body.error).slice(0, 300)}`);
    assert((await notices(A)).length === 1, 'no second notice');
});

await test('18. Removing the service\'s agent the ordinary way also turns the service off for the person', async () => {
    const r = await provision(cred.token, E.name);
    assert(r.body.data?.auto_approved === true, 'erin provisioned');
    const del = await json(`/v1/agents/${SVC}`, { method: 'DELETE', headers: auth(E.token) });
    assert(del.status === 200, `delete ${del.status}`);
    await assertRefused(await provision(cred.token, E.name), 'after the ordinary removal', E);
    const on = await json(`/v1/operator-services/${SVC}/me`, { method: 'POST', headers: auth(E.token) });
    assert(on.body.data?.was_off === true, 'the removal was remembered as off');
    // Erin's line is `ended` now. While the entry exists she cannot occupy the service's name with an
    // agent of her own, so nobody can take the name in advance (test 21 provisions her again).
    const own = await json('/v1/agents', { method: 'POST', headers: auth(E.token),
        body: JSON.stringify({ name: SVC, owner: E.name, capabilities: ['memory'], model: 'gpt-4o', scopes: ['memory:read'] }) });
    assert(own.status === 403 && own.body.error?.code === 'OPERATOR_SERVICE_KEY' && String(own.body.error.message).includes(SERVICE_NAME),
        `erin's own agent under the service's name: ${own.status} ${JSON.stringify(own.body.error)}`);
    // Gina turns it off before the service ever asked for her; test 21 holds that it survives off and on.
    const gOff = await json(`/v1/operator-services/${SVC}/me`, { method: 'DELETE', headers: auth(G.token) });
    assert(gOff.status === 200 && gOff.body.data.agent_removed === false, `gina off ${gOff.status}`);
});

// ── The operator's switch ──

const scopesOfAlicesAgent = async () => ((await agentsOf(A)).find(x => x.name === SVC)?.default_scopes ?? []) as string[];

await test('19. Narrowing the entry takes back only the word the entry gave and no longer gives; alice\'s own word stays', async () => {
    assert(JSON.stringify(await scopesOfAlicesAgent()) === JSON.stringify(['memory:read', 'memory:write', 'storage:read']), 'the three words the entry gave');
    const add = await json(`/v1/agents/${SVC}/allow`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ scopes: ['task:read'] }) });
    assert(add.status === 200, `alice adds task:read: ${add.status} ${JSON.stringify(add.body.error ?? '')}`);
    const r = await setSetting(OP.token, [entry({ scopes: ['memory:read', 'memory:write'] }), entryB()]);
    assert(r.status === 200 && (r.body.data.errors ?? []).length === 0, `narrow ${r.status}`);
    const after = await scopesOfAlicesAgent();
    assert(!after.includes('storage:read'), `the narrowed word is gone: ${JSON.stringify(after)}`);
    for (const w of ['memory:read', 'memory:write', 'task:read']) assert(after.includes(w), `${w} stays: ${JSON.stringify(after)}`);
});

await test('19b. Removing a word the entry gave and alice did not add takes it away; her own word still stays', async () => {
    const r = await setSetting(OP.token, [entry({ scopes: ['memory:read'] }), entryB()]);
    assert(r.status === 200 && (r.body.data.errors ?? []).length === 0, `narrow ${r.status}`);
    const after = await scopesOfAlicesAgent();
    assert(JSON.stringify([...after].sort()) === JSON.stringify(['memory:read', 'task:read']), `alice's agent ${JSON.stringify(after)}`);
});

await test('20. Switching the service off removes its agents; the old token answers 401; a new request is refused and stored nowhere', async () => {
    const r = await provision(cred.token, A.name);
    const p = await poll(r.body.data.device_code);
    const token = p.body.token as string;
    assert((await json('/v1/memory?limit=1', { headers: auth(token) })).status === 200, 'the token works before');
    const off = await setSetting(OP.token, [entry({ scopes: ['memory:read'], enabled: false }), entryB()]);
    assert(off.status === 200 && (off.body.data.errors ?? []).length === 0, `off ${off.status}`);
    assert((await json('/v1/memory?limit=1', { headers: auth(token) })).status === 401, 'the old token answers 401');
    assert(!(await agentsOf(A)).some(x => x.name === SVC), 'the agent left alice\'s list');
    await assertRefused(await provision(cred.token, A.name), 'while switched off', A);
    const mine = (await json('/v1/operator-services', { headers: auth(A.token) })).body.data.services;
    assert(!mine.some((x: any) => x.id === SVC), 'a switched-off service is not shown to a person');
});

await test('21. Switched on again, the service may ask again (the operator ended it, the person did not)', async () => {
    const on = await setSetting(OP.token, [entry(), entryB()]);
    assert(on.status === 200, `on ${on.status}`);
    const r = await provision(cred.token, A.name);
    assert(r.body.data?.auto_approved === true, `again: ${JSON.stringify(r.body.data ?? r.body.error).slice(0, 300)}`);
    // Gina turned the service off in test 18: that choice survives the operator switching it off and on.
    const note = await assertRefused(await provision(cred.token, G.name), 'gina after off and on', G);
    assert(note.includes(ACCOUNT_NOTE), `gina's off holds: ${note.slice(-200)}`);
    const mine = (await json('/v1/operator-services', { headers: auth(G.token) })).body.data.services;
    assert(mine.find((x: any) => x.id === SVC)?.state === 'removed', `gina's state ${JSON.stringify(mine)}`);
    // Erin turned it back on in test 18 and could not take the name meanwhile: the service sets her up again.
    const en = await provision(cred.token, E.name);
    assert(en.body.data?.auto_approved === true, `erin again: ${JSON.stringify(en.body.data ?? en.body.error).slice(0, 300)}`);
    assert((await agentsOf(E)).find(x => x.name === SVC)?.set_by_operator?.service === SVC, 'erin\'s agent is the service\'s');
});

await test('21b. Forty people enrolled at once: every one ends active with one agent, and nothing answers 500', async () => {
    const people: Owner[] = [];
    for (let i = 0; i < 40; i++) people.push(await setupOwner(`p${i}`));
    const answers = await Promise.all(people.map((p) => provision(cred.token, p.name)));
    const bad = answers.filter((r) => r.status !== 200 || r.body.data?.auto_approved !== true);
    assert(bad.length === 0, `${bad.length} not approved: ${JSON.stringify(bad.slice(0, 3).map((r) => [r.status, r.body.error ?? r.body.data?.user_instructions?.slice(-120)]))}`);
    const rows = (await json(`/v1/operator-services/${SVC}/accounts?limit=500`, { headers: auth(cred.token) })).body.data.accounts as any[];
    const names = new Set(people.map((p) => p.name));
    const active = rows.filter((x) => names.has(x.account) && x.state === 'active');
    assert(active.length === 40, `40 active lines: ${active.length}`);
    for (const p of people) {
        const mine = (await agentsOf(p)).filter((x) => x.name === SVC);
        assert(mine.length === 1 && mine[0].set_by_operator?.service === SVC, `${p.name} has one service agent: ${mine.length}`);
    }
});

await test('22. Removing every entry removes the agents; the setting is empty again', async () => {
    const r = await setSetting(OP.token, []);
    assert(r.status === 200, `clear ${r.status}`);
    assert(!(await agentsOf(A)).some(x => x.name === SVC), 'alice\'s agent is gone');
    assert(!(await agentsOf(B)).some(x => x.name === SVC_B), 'bob\'s notes agent is gone');
    const d = (await agentsOf(D)).find(x => x.name === SVC);
    assert(!!d && d.gaii === dorasOwn.gaii, 'dora\'s own agent of the same name stays');
    assert(!(await agentsOf(E)).some(x => x.name === SVC), 'erin\'s service agent is gone');
    // With no entry left the name is free again: anyone may make an agent under it.
    const free = await json('/v1/agents', { method: 'POST', headers: auth(E.token),
        body: JSON.stringify({ name: SVC, owner: E.name, capabilities: ['memory'], model: 'gpt-4o', scopes: ['memory:read'] }) });
    assert(free.status === 201, `the name is free once the entry is gone: ${free.status} ${JSON.stringify(free.body.error ?? '')}`);
});

finish();
