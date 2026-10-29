/**
 * @file test/e2e-agent-scope-add.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for agent:permissions-add (services/agent-scope-add.ts): the owner's agent that
 *   holds it adds to another of the owner's agents the permissions it holds itself, and the owner is
 *   told of each addition. Asserted over PATCH /v1/agents/:name/scopes and the node MCP tool
 *   aimeat_operator_agent_configure:
 *     - an agent holding agent:permissions without the new word still only narrows (403
 *       SCOPE_ADDITION_REFUSED, REST and MCP), and the target is unchanged;
 *     - with the word it adds memory:write and memory:read-as-owner (an own-tick word it holds), the
 *       target holds them, and the owner's account feed has agent_permissions_added and the bell a
 *       notice naming both agents;
 *     - the refusals: a word it does not hold (403 SCOPE_NOT_HELD), the word itself (403
 *       PERSON_REQUIRED), its own list (403), another owner's agent (404);
 *     - through the MCP tool: propose, then confirm, adds, and the feed has a second line;
 *     - the owner takes the word away and the next addition is refused, though the agent's token
 *       still names the word;
 *     - the owner in person still sets any list, and that leaves no agent line on the feed.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-scope-add
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (wish-omistajan-ai-voi-lis-t-agenttien-oikeuksia-kun-omistaja-niin).
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpAgent, type McpSession } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now();

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
async function call(method: 'GET' | 'PATCH', path: string, token: string, body?: unknown): Promise<{ status: number; body: Body }> {
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    return { status: res.status, body: (res.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) as Body : { _raw: text } };
}
const setScopes = (token: string, name: string, scopes: string[]) => call('PATCH', `/v1/agents/${encodeURIComponent(name)}/scopes`, token, { scopes });
const scopesOf = async (name: string): Promise<string[]> => {
    const r = await call('GET', '/v1/agents', alice.token);
    assert(r.status === 200, `agents list: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const a = (r.body.data.agents as Body[]).find(x => x.name === name);
    assert(a, `agent ${name} in the list`);
    return (a.default_scopes ?? a.scopes ?? []) as string[];
};
const addedEvents = async (): Promise<Body[]> => {
    const r = await call('GET', '/v1/account/events?limit=200', alice.token);
    assert(r.status === 200, `account events: ${r.status} ${JSON.stringify(r.body?.error)}`);
    return (r.body.data.events as Body[]).filter(e => e.kind === 'agent_permissions_added');
};

console.log('\n=== agent:permissions-add: the owner\'s agent adds permissions it holds to another agent ===\n');

let alice!: RegisteredOwner, bob!: RegisteredOwner;
let adder!: McpAgent, narrower!: McpAgent, target!: McpAgent, bobAgent!: McpAgent;
let adderMcp!: McpSession, narrowerMcp!: McpSession;

await test('Setup: alice has an agent holding agent:permissions-add, one holding agent:permissions only, and a target holding memory:read; bob has an agent', async () => {
    alice = await registerOwner(BASE, `spaalice${stamp}`);
    bob = await registerOwner(BASE, `spabob${stamp}`);
    adder = await makeAgent(BASE, alice, ['*', 'agent:permissions', 'agent:permissions-add', 'memory:read-as-owner'], `spaadd${stamp % 100000}`);
    narrower = await makeAgent(BASE, alice, ['*', 'agent:permissions'], `spanar${stamp % 100000}`);
    target = await makeAgent(BASE, alice, ['memory:read'], `spatgt${stamp % 100000}`);
    bobAgent = await makeAgent(BASE, bob, ['memory:read'], `spabob${stamp % 100000}`);
    adderMcp = await openSession(BASE, adder.token, 'scope-add adder');
    narrowerMcp = await openSession(BASE, narrower.token, 'scope-add narrower');
    assert((await scopesOf(adder.name)).includes('agent:permissions-add'), 'the owner gave the adder the word');
});

await test('DENIAL: an agent with agent:permissions and without agent:permissions-add cannot add (403 SCOPE_ADDITION_REFUSED, REST and MCP)', async () => {
    const r = await setScopes(narrower.token, target.name, ['memory:read', 'memory:write']);
    assert(r.status === 403 && r.body.error?.code === 'SCOPE_ADDITION_REFUSED', `REST: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const m = await callTool(narrowerMcp, 'aimeat_operator_agent_configure', { agent_name: target.name, scopes: ['memory:read', 'memory:write'] });
    assert(m.offered && m.isError && m.text.includes('SCOPE_ADDITION_REFUSED'), `MCP: ${m.text.slice(0, 300)}`);
    assert(JSON.stringify(await scopesOf(target.name)) === JSON.stringify(['memory:read']), `target unchanged: ${await scopesOf(target.name)}`);
    assert((await addedEvents()).length === 0, 'no feed line for a refusal');
});

await test('The agent holding agent:permissions-add adds memory:write and memory:read-as-owner, and the owner reads it on the feed and in the bell', async () => {
    const r = await setScopes(adder.token, target.name, ['memory:read', 'memory:write', 'memory:read-as-owner']);
    assert(r.status === 200, `add: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const held = await scopesOf(target.name);
    assert(held.includes('memory:write') && held.includes('memory:read-as-owner'), `target holds them: ${held}`);
    const events = await addedEvents();
    assert(events.length === 1, `one feed line, got ${events.length}`);
    const e = events[0];
    assert(e.data?.by === adder.name && e.data?.name === target.name, `feed names both agents: ${JSON.stringify(e.data)}`);
    assert(e.data?.words === 'memory:write, memory:read-as-owner', `feed names the words: ${e.data?.words}`);
    assert((e.actor_gaii ?? e.actorGaii) === adder.gaii, `the actor is the adding agent: ${JSON.stringify(e)}`);
    const n = await call('GET', '/v1/notifications', alice.token);
    assert(n.status === 200, `notifications: ${n.status}`);
    const notice = (n.body.data.notifications as Body[]).find(x => x.type === 'agent_permissions_added');
    assert(notice && String(notice.title).includes(adder.name) && String(notice.title).includes(target.name), `bell notice: ${JSON.stringify(notice)}`);
});

await test('DENIAL: a word the adder does not hold (403 SCOPE_NOT_HELD), the word itself (403 PERSON_REQUIRED), its own list (403), another owner\'s agent (404)', async () => {
    const before = await scopesOf(target.name);
    const notHeld = await setScopes(adder.token, target.name, [...before, 'secrets:manage']);
    assert(notHeld.status === 403 && notHeld.body.error?.code === 'SCOPE_NOT_HELD', `not held: ${notHeld.status} ${JSON.stringify(notHeld.body?.error)}`);
    assert((notHeld.body.error?.details?.not_held ?? []).includes('secrets:manage'), `names the word: ${JSON.stringify(notHeld.body.error)}`);
    const word = await setScopes(adder.token, target.name, [...before, 'agent:permissions-add']);
    assert(word.status === 403 && word.body.error?.code === 'PERSON_REQUIRED', `the word itself: ${word.status} ${JSON.stringify(word.body?.error)}`);
    const self = await setScopes(adder.token, adder.name, ['*', 'agent:permissions', 'agent:permissions-add', 'memory:read-as-owner', 'memory:write-reserved']);
    assert(self.status === 403, `its own list: ${self.status} ${JSON.stringify(self.body?.error)}`);
    const other = await setScopes(adder.token, bobAgent.name, ['memory:read', 'memory:write']);
    assert(other.status === 404, `another owner's agent: ${other.status} ${JSON.stringify(other.body?.error)}`);
    assert(JSON.stringify(await scopesOf(target.name)) === JSON.stringify(before), 'target unchanged by the refusals');
    assert((await addedEvents()).length === 1, 'no feed line for a refusal');
});

await test('Through aimeat_operator_agent_configure: propose, then confirm, adds task:read, and the feed has a second line', async () => {
    const scopes = [...await scopesOf(target.name), 'task:read'];
    const p = await callTool(adderMcp, 'aimeat_operator_agent_configure', { agent_name: target.name, scopes });
    assert(!p.isError && p.data?.mode === 'proposal' && p.data?.confirm_token, `propose: ${p.text.slice(0, 300)}`);
    const c = await callTool(adderMcp, 'aimeat_operator_agent_configure', { agent_name: target.name, scopes, confirm_token: p.data.confirm_token });
    assert(!c.isError && c.data?.mode === 'applied', `confirm: ${c.text.slice(0, 300)}`);
    assert((await scopesOf(target.name)).includes('task:read'), 'target holds task:read');
    const events = await addedEvents();
    assert(events.length === 2 && events.some(e => e.data?.words === 'task:read'), `second feed line: ${JSON.stringify(events.map(e => e.data))}`);
});

await test('DENIAL: the owner takes agent:permissions-add away, and the next addition is refused though the token still names the word', async () => {
    const off = await setScopes(alice.token, adder.name, ['*', 'agent:permissions', 'memory:read-as-owner']);
    assert(off.status === 200, `owner takes it away: ${off.status} ${JSON.stringify(off.body?.error)}`);
    const r = await setScopes(adder.token, target.name, [...await scopesOf(target.name), 'task:write']);
    assert(r.status === 403 && r.body.error?.code === 'SCOPE_ADDITION_REFUSED', `after the owner took it away: ${r.status} ${JSON.stringify(r.body?.error)}`);
    // The MCP session was opened while the adder held the word.
    const m = await callTool(adderMcp, 'aimeat_operator_agent_configure', { agent_name: target.name, scopes: [...await scopesOf(target.name), 'task:write'] });
    assert(m.isError && m.text.includes('SCOPE_ADDITION_REFUSED'), `MCP after the owner took it away: ${m.text.slice(0, 300)}`);
    assert(!(await scopesOf(target.name)).includes('task:write'), 'target unchanged');
});

await test('The owner in person still sets any list, and that leaves no agent line on the feed', async () => {
    const r = await setScopes(alice.token, target.name, ['memory:read', 'secrets:manage']);
    assert(r.status === 200, `owner: ${r.status} ${JSON.stringify(r.body?.error)}`);
    assert((await scopesOf(target.name)).includes('secrets:manage'), 'target holds secrets:manage');
    assert((await addedEvents()).length === 2, 'the owner\'s own change is not an agent line');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
