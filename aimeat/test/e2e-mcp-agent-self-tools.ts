/**
 * @file test/e2e-mcp-agent-self-tools.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The agent-management tools no E2E suite had called: an agent reporting about itself
 *   (aimeat_agent_telemetry_report, aimeat_agent_activity), an agent asking for the basic agents
 *   (aimeat_agent_basics_get, aimeat_agent_basics_request), and an agent changing a sibling
 *   (aimeat_agent_description_set, aimeat_agent_run_mode_set, aimeat_agent_console_set,
 *   aimeat_agent_scope_narrow).
 *
 *   WHY THIS SUITE EXISTS. Each of these handlers makes a decision no REST suite reaches: the
 *   same-owner check on a sibling (services/agent-profile-write.ts), the input vocabulary of a run
 *   mode or a console address, and the narrowing rule that replaces '*' with the words an agent
 *   actually used (services/scope-narrowing.ts). A handler that dropped one of those checks stayed
 *   green everywhere. Each tool gets a call that succeeds, read back over REST where a REST read
 *   exists, and the refusal that matters for it: another owner's agent, a value outside the
 *   vocabulary, or an agent without the word (the registration filter does not offer the tool).
 * @structure
 *   - Phase 1: fixtures (alice with a manager, a plain sibling and a '*' agent; bob with an agent)
 *   - Phase 2: telemetry and activity · Phase 3: the basic agents · Phase 4: a sibling's profile
 *   - Phase 5: narrowing a '*' agent
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-agent-self-tools
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit W27).
 */

import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpAgent, type McpSession } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`✅ ${name}`); }
    catch (e) { failed++; console.log(`❌ ${name}: ${(e as Error).message}`); }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

async function rest(method: string, path: string, token: string, body?: unknown): Promise<{ status: number; body: any }> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            method,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        if (res.status === 429 && attempt < 6) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        const text = await res.text();
        let parsed: any;
        try { parsed = JSON.parse(text); } catch { parsed = { _raw: text }; }
        return { status: res.status, body: parsed };
    }
}

const short = (v: unknown): string => String(JSON.stringify(v)).slice(0, 300);
const stamp = Date.now().toString(36).slice(-6);

console.log('\n=== Agent self and sibling tools over MCP (QA audit W27) ===\n');

let alice: RegisteredOwner;
let bob: RegisteredOwner;
/** Holds the words of every tool here. */
let mgr: McpAgent;
/** Holds memory:read only: the sibling the manager changes, and the session without the words. */
let sib: McpAgent;
/** Holds '*': the agent the manager narrows. */
let star: McpAgent;
let bobAgent: McpAgent;
let mgrMcp: McpSession;
let sibMcp: McpSession;

/** One of alice's agents as GET /v1/agents lists it. */
const rowOf = async (agent: McpAgent): Promise<any> => {
    const r = await rest('GET', `/v1/agents?owner=${encodeURIComponent(alice.name)}`, alice.token);
    assert(r.status === 200, `alice's agents: ${r.status} ${short(r.body.error)}`);
    return (r.body.data.agents as any[]).find((a) => a.gaii === agent.gaii) ?? null;
};

// ── Phase 1: fixtures ─────────────────────────────────────────────────────────────────────────────
await test('Phase 1: alice with a manager, a sibling and a \'*\' agent; bob with an agent', async () => {
    await registerOwner(BASE, `opself${stamp}`);   // the node's operator, so alice is a plain owner
    alice = await registerOwner(BASE, `alself${stamp}`);
    bob = await registerOwner(BASE, `boself${stamp}`);
    mgr = await makeAgent(BASE, alice, ['agent:read', 'agent:write', 'agent:permissions', 'memory:read', 'memory:write'], `mg${stamp}`);
    sib = await makeAgent(BASE, alice, ['memory:read'], `sb${stamp}`);
    star = await makeAgent(BASE, alice, ['*'], `st${stamp}`);
    bobAgent = await makeAgent(BASE, bob, ['memory:read'], `bb${stamp}`);
    mgrMcp = await openSession(BASE, mgr.token, 'self-mgr');
    sibMcp = await openSession(BASE, sib.token, 'self-sib');
});

// ── Phase 2: telemetry and activity ───────────────────────────────────────────────────────────────
await test('2a. telemetry report: the agent reports a tool call about itself and gets the event id', async () => {
    const r = await callTool(mgrMcp, 'aimeat_agent_telemetry_report', { type: 'tool_call', data: { tool: 'parity_probe', duration_ms: 12 } });
    assert(!r.isError && typeof r.data.id === 'string' && r.data.id.length >= 32, `report: ${r.text.slice(0, 300)}`);
});

await test('2b. telemetry report: an event type outside the vocabulary is refused', async () => {
    const r = await callTool(mgrMcp, 'aimeat_agent_telemetry_report', { type: 'heartbeat', data: {} });
    assert(r.offered && r.isError, `a type outside llm_call|tool_call|agent_report: ${r.text.slice(0, 200)}`);
});

await test('2c. agent activity: the agent reads its own stats and a daily history', async () => {
    const r = await callTool(mgrMcp, 'aimeat_agent_activity', { days: 7, granularity: 'daily' });
    assert(!r.isError && 'stats' in r.data && Array.isArray(r.data.history), `activity: ${r.text.slice(0, 300)}`);
});

await test('2d. agent activity: a granularity outside daily|hourly is refused', async () => {
    const r = await callTool(mgrMcp, 'aimeat_agent_activity', { days: 7, granularity: 'weekly' });
    assert(r.offered && r.isError, `weekly: ${r.text.slice(0, 200)}`);
});

// ── Phase 3: the basic agents ─────────────────────────────────────────────────────────────────────
await test('3a. basics get: the agent holding agent:read reads what the button would make, as REST answers it', async () => {
    const r = await callTool(mgrMcp, 'aimeat_agent_basics_get', {});
    assert(!r.isError && r.text.includes('concierge'), `basics get: ${r.text.slice(0, 300)}`);
    const viaRest = await rest('GET', '/v1/agents/v2/basic-agents', alice.token);
    assert(viaRest.status === 200, `REST basics: ${viaRest.status} ${short(viaRest.body.error)}`);
    const names = (x: any) => JSON.stringify((x.agents ?? []).map((a: any) => a.name ?? a.id));
    assert(names(r.data) !== '[]' && names(r.data) === names(viaRest.body.data), `the two answers differ: ${names(r.data)} vs ${names(viaRest.body.data)}`);
});

await test('3b. basics get / request: not offered to an agent without agent:read / memory:write', async () => {
    const get = await callTool(sibMcp, 'aimeat_agent_basics_get', {});
    assert(get.isError && !get.offered, `basics get offered without agent:read: ${get.text.slice(0, 200)}`);
    const req = await callTool(sibMcp, 'aimeat_agent_basics_request', { note: 'should not land' });
    assert(req.isError && !req.offered, `basics request offered without memory:write: ${req.text.slice(0, 200)}`);
});

await test('3c. basics request: the agent asks once, and asking again writes nothing new', async () => {
    const first = await callTool(mgrMcp, 'aimeat_agent_basics_request', { note: `parity ${stamp}` });
    assert(!first.isError && first.data.requested === true, `first request: ${first.text.slice(0, 300)}`);
    const again = await callTool(mgrMcp, 'aimeat_agent_basics_request', { note: `parity ${stamp} again` });
    assert(!again.isError && again.data.requested === false, `second request: ${again.text.slice(0, 300)}`);
});

// ── Phase 4: a sibling's profile ──────────────────────────────────────────────────────────────────
await test('4a. description set: the manager describes its sibling, and GET /v1/agents shows it', async () => {
    const r = await callTool(mgrMcp, 'aimeat_agent_description_set', { target_agent_name: sib.name, description: `Reads the morning mail ${stamp}` });
    assert(!r.isError && r.data.description === `Reads the morning mail ${stamp}`, `description: ${r.text.slice(0, 300)}`);
    assert((await rowOf(sib))?.description === `Reads the morning mail ${stamp}`, 'the list does not show the description');
});

await test('4b. description set: refused on another owner\'s agent, and not offered without agent:write', async () => {
    const r = await callTool(mgrMcp, 'aimeat_agent_description_set', { target_agent_name: bobAgent.gaii, description: 'rewritten by alice\'s agent' });
    assert(r.isError, `bob's agent was described by alice's agent: ${r.text.slice(0, 200)}`);
    const own = await callTool(sibMcp, 'aimeat_agent_description_set', { target_agent_name: sib.name, description: 'x' });
    assert(own.isError && !own.offered, `offered without agent:write: ${own.text.slice(0, 200)}`);
});

await test('4c. run mode set: the manager sets its sibling to spawn, and GET /v1/agents shows it', async () => {
    const r = await callTool(mgrMcp, 'aimeat_agent_run_mode_set', { target_agent_name: sib.name, run_mode: 'spawn' });
    assert(!r.isError && r.data.run_mode === 'spawn', `run mode: ${r.text.slice(0, 300)}`);
    assert((await rowOf(sib))?.run_mode === 'spawn', 'the list does not show the run mode');
});

await test('4d. run mode set: a mode outside spawn|resident and another owner\'s agent are refused', async () => {
    const bad = await callTool(mgrMcp, 'aimeat_agent_run_mode_set', { target_agent_name: sib.name, run_mode: 'forever' });
    assert(bad.offered && bad.isError, `forever: ${bad.text.slice(0, 200)}`);
    const theirs = await callTool(mgrMcp, 'aimeat_agent_run_mode_set', { target_agent_name: bobAgent.gaii, run_mode: 'resident' });
    assert(theirs.isError, `bob's agent: ${theirs.text.slice(0, 200)}`);
    assert((await rowOf(sib))?.run_mode === 'spawn', 'a refused call changed the run mode');
});

await test('4e. console set: the manager records its sibling\'s console address, and GET /v1/agents shows it', async () => {
    const url = `https://console.example.test/${stamp}`;
    const r = await callTool(mgrMcp, 'aimeat_agent_console_set', { target_agent_name: sib.name, console_url: url });
    assert(!r.isError && r.data.console_url === url, `console: ${r.text.slice(0, 300)}`);
    assert((await rowOf(sib))?.console_url === url, 'the list does not show the console address');
});

await test('4f. console set: an address that is not http(s) and another owner\'s agent are refused', async () => {
    const bad = await callTool(mgrMcp, 'aimeat_agent_console_set', { target_agent_name: sib.name, console_url: 'javascript:alert(1)' });
    assert(bad.isError, `a javascript: address: ${bad.text.slice(0, 200)}`);
    const theirs = await callTool(mgrMcp, 'aimeat_agent_console_set', { target_agent_name: bobAgent.gaii, console_url: 'https://console.example.test/x' });
    assert(theirs.isError, `bob's agent: ${theirs.text.slice(0, 200)}`);
    assert((await rowOf(sib))?.console_url === `https://console.example.test/${stamp}`, 'a refused call changed the address');
});

// ── Phase 5: narrowing a '*' agent ────────────────────────────────────────────────────────────────
await test('5a. scope narrow: the \'*\' agent uses memory:write once, and the manager narrows it to what it used', async () => {
    const used = await rest('POST', '/v1/memory', star.token, { key: `parity.narrow.${stamp}`, value: 'used once', visibility: 'private' });
    assert(used.status === 200 || used.status === 201, `the '*' agent's write: ${used.status} ${short(used.body.error)}`);
    const r = await callTool(mgrMcp, 'aimeat_agent_scope_narrow', { target_agent_name: star.name });
    assert(!r.isError && Array.isArray(r.data.scopes) && !r.data.scopes.includes('*') && r.data.scopes.includes('memory:write'),
        `narrow: ${r.text.slice(0, 300)}`);
    const row = await rowOf(star);
    assert(JSON.stringify(row?.default_scopes) === JSON.stringify(r.data.scopes), `the stored list: ${short(row?.default_scopes)}`);
});

await test('5b. scope narrow: an agent that no longer holds \'*\' is refused, and the tool is not offered without agent:permissions', async () => {
    const again = await callTool(mgrMcp, 'aimeat_agent_scope_narrow', { target_agent_name: star.name });
    assert(again.isError && again.text.includes('NOT_WILDCARD'), `second narrowing: ${again.text.slice(0, 200)}`);
    const plain = await callTool(sibMcp, 'aimeat_agent_scope_narrow', { target_agent_name: star.name });
    assert(plain.isError && !plain.offered, `offered without agent:permissions: ${plain.text.slice(0, 200)}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
