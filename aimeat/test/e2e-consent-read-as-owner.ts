/**
 * @file test/e2e-consent-read-as-owner.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for consent:read-as-owner: whose consents a caller sees, on the three surfaces that
 *   list or read them (GET /v1/consent and GET /v1/consent/:id, the MCP tool aimeat_consent_list, the
 *   consent-record MCP resource). One function decides it for all three (services/consent/consent-read.ts
 *   consentHolderOf):
 *
 *   - an agent without the word sees only the consents it gave itself, on all three; aimeat_consent_list
 *     listed the whole account's for it until this change;
 *   - a `*` agent is the same: the word is outside every wildcard;
 *   - an agent holding the word sees the account's consents on all three, as the person does;
 *   - the account holder in person sees every consent of the account, their agents' included;
 *   - another owner's agent holding the word sees nothing of this account.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-consent-read-as-owner
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial, with consent:read-as-owner.
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, mcpRpc, type McpAgent, type McpSession } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now().toString(36).slice(-6);
const N = (s: string) => `cro${s}${stamp}`;

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
interface Answer { status: number; body: Body; text: string }
async function call(method: 'GET' | 'POST', path: string, token: string, body?: unknown): Promise<Answer> {
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let parsed: Body = { _raw: text };
    try { parsed = JSON.parse(text) as Body; } catch { /* a non-JSON body stays raw */ }
    return { status: res.status, body: parsed, text };
}
const show = (r: Answer) => `${r.status} ${r.text.slice(0, 300)}`;

/** The consent ids GET /v1/consent lists for `token`. */
async function routeIds(token: string): Promise<string[]> {
    const r = await call('GET', '/v1/consent', token);
    assert(r.status === 200, `GET /v1/consent: ${show(r)}`);
    return (r.body.data.consents as Body[]).map((c) => c.id as string);
}
/** The consent ids aimeat_consent_list lists on `s`. */
async function toolIds(s: McpSession): Promise<string[]> {
    const t = await callTool(s, 'aimeat_consent_list', {});
    assert(!t.isError && Array.isArray(t.data), `aimeat_consent_list: ${t.text.slice(0, 300)}`);
    return (t.data as Body[]).map((c) => c.id as string);
}
/** The consent-record resources resources/list names on `s`, as text. */
async function resourceList(s: McpSession): Promise<string> {
    return JSON.stringify((await mcpRpc(s, 'resources/list', {}))?.result?.resources ?? []);
}
/** One consent read through the consent-record resource, as text. */
async function resourceRead(s: McpSession, id: string): Promise<string> {
    const r = await mcpRpc(s, 'resources/read', { uri: `aimeat://consent/${encodeURIComponent(id)}` });
    return JSON.stringify(r?.result?.contents ?? r);
}
async function grant(token: string, pattern: string): Promise<string> {
    const r = await call('POST', '/v1/consent', token, { data_pattern: `${pattern}.*`, recipient: `someone@example.node`, purpose: 'read-as-owner probe', scope: 'local' });
    assert(r.status === 201, `grant ${pattern}: ${show(r)}`);
    return r.body.data.id as string;
}

console.log('\n=== consent:read-as-owner: whose consents a caller sees ===\n');

let alice!: RegisteredOwner, bob!: RegisteredOwner;
let plain!: McpAgent, star!: McpAgent, wide!: McpAgent, bobWide!: McpAgent;
let plainMcp!: McpSession, starMcp!: McpSession, wideMcp!: McpSession, bobWideMcp!: McpSession;
let ownerConsent = '', agentConsent = '';

await test('Setup: alice gives a consent in person, and her agent without the word gives one of its own', async () => {
    alice = await registerOwner(BASE, N('alice'));
    bob = await registerOwner(BASE, N('bob'));
    plain = await makeAgent(BASE, alice, ['consent:manage'], N('plain'));
    star = await makeAgent(BASE, alice, ['*'], N('star'));
    wide = await makeAgent(BASE, alice, ['consent:manage', 'consent:read-as-owner'], N('wide'));
    bobWide = await makeAgent(BASE, bob, ['consent:manage', 'consent:read-as-owner'], N('bobwide'));
    ownerConsent = await grant(alice.token, N('ownernotes'));
    agentConsent = await grant(plain.token, N('agentnotes'));
    plainMcp = await openSession(BASE, plain.token, 'cro plain');
    starMcp = await openSession(BASE, star.token, 'cro star');
    wideMcp = await openSession(BASE, wide.token, 'cro wide');
    bobWideMcp = await openSession(BASE, bobWide.token, 'cro bob wide');
});

console.log('\nWithout the word an agent sees only the consents it gave itself');

await test('REFUSED: the agent without the word lists only its own consent on GET /v1/consent and is refused alice\'s on GET /v1/consent/:id', async () => {
    const ids = await routeIds(plain.token);
    assert(ids.includes(agentConsent), `its own consent is missing: ${ids.join(', ')}`);
    assert(!ids.includes(ownerConsent), 'the route lists the consent alice gave in person');
    const r = await call('GET', `/v1/consent/${encodeURIComponent(ownerConsent)}`, plain.token);
    assert(r.status === 403, `route: ${show(r)}`);
});

await test('REFUSED: the agent without the word lists only its own consent on aimeat_consent_list', async () => {
    const ids = await toolIds(plainMcp);
    assert(ids.includes(agentConsent), `its own consent is missing: ${ids.join(', ')}`);
    assert(!ids.includes(ownerConsent), 'aimeat_consent_list lists the consent alice gave in person');
});

await test('REFUSED: the agent without the word is not named alice\'s consent by the resource list and is refused it by the resource', async () => {
    const list = await resourceList(plainMcp);
    assert(list.includes(agentConsent), `its own consent is missing from the resource list: ${list.slice(0, 300)}`);
    assert(!list.includes(ownerConsent), 'the resource list names the consent alice gave in person');
    assert((await resourceRead(plainMcp, ownerConsent)).includes('ACCESS_DENIED'), 'the resource reads alice\'s consent');
});

await test('REFUSED: a `*` agent does not see alice\'s consent on the route, the tool or the resource: no wildcard carries the word', async () => {
    assert(!(await routeIds(star.token)).includes(ownerConsent), 'route');
    assert(!(await toolIds(starMcp)).includes(ownerConsent), 'tool');
    assert(!(await resourceList(starMcp)).includes(ownerConsent), 'resource list');
    assert((await resourceRead(starMcp, ownerConsent)).includes('ACCESS_DENIED'), 'resource read');
});

console.log('\nWith the word an agent sees the account\'s consents, as the person does');

await test('DECIDED: the agent holding consent:read-as-owner lists and reads alice\'s consent and its sibling\'s on GET /v1/consent and /:id', async () => {
    const ids = await routeIds(wide.token);
    assert(ids.includes(ownerConsent) && ids.includes(agentConsent), `route list: ${ids.join(', ')}`);
    for (const id of [ownerConsent, agentConsent]) {
        const r = await call('GET', `/v1/consent/${encodeURIComponent(id)}`, wide.token);
        assert(r.status === 200 && r.body.data.id === id, `route read ${id}: ${show(r)}`);
    }
});

await test('DECIDED: the agent holding consent:read-as-owner lists both on aimeat_consent_list', async () => {
    const ids = await toolIds(wideMcp);
    assert(ids.includes(ownerConsent) && ids.includes(agentConsent), `tool list: ${ids.join(', ')}`);
});

await test('DECIDED: the agent holding consent:read-as-owner is named both by the resource list and reads both through the resource', async () => {
    const list = await resourceList(wideMcp);
    assert(list.includes(ownerConsent) && list.includes(agentConsent), `resource list: ${list.slice(0, 300)}`);
    for (const id of [ownerConsent, agentConsent]) {
        const res = await resourceRead(wideMcp, id);
        assert(res.includes(id) && !res.includes('ACCESS_DENIED'), `resource read ${id}: ${res.slice(0, 200)}`);
    }
});

console.log('\nThe account holder in person sees everything');

// The MCP endpoint takes agent sessions only (an owner's own AI connects as one of their agents), so
// the person in person is read on the route.
await test('USE KEPT: alice in person lists and reads both consents on GET /v1/consent and /:id', async () => {
    const ids = await routeIds(alice.token);
    assert(ids.includes(ownerConsent) && ids.includes(agentConsent), `route list: ${ids.join(', ')}`);
    for (const id of [ownerConsent, agentConsent]) {
        const r = await call('GET', `/v1/consent/${encodeURIComponent(id)}`, alice.token);
        assert(r.status === 200 && r.body.data.id === id, `route read ${id}: ${show(r)}`);
    }
});

console.log('\nAnother owner\'s agent sees nothing of the account');

await test('REFUSED: bob\'s agent holding consent:read-as-owner sees neither consent on the route, the tool or the resource', async () => {
    const ids = await routeIds(bobWide.token);
    assert(!ids.includes(ownerConsent) && !ids.includes(agentConsent), `route list: ${ids.join(', ')}`);
    for (const id of [ownerConsent, agentConsent]) {
        const r = await call('GET', `/v1/consent/${encodeURIComponent(id)}`, bobWide.token);
        assert(r.status === 403, `route read ${id}: ${show(r)}`);
        assert((await resourceRead(bobWideMcp, id)).includes('ACCESS_DENIED'), `resource read ${id}`);
    }
    const tool = await toolIds(bobWideMcp);
    assert(!tool.includes(ownerConsent) && !tool.includes(agentConsent), `tool list: ${tool.join(', ')}`);
    const list = await resourceList(bobWideMcp);
    assert(!list.includes(ownerConsent) && !list.includes(agentConsent), `resource list: ${list.slice(0, 300)}`);
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
