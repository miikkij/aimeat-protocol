/**
 * @file test/e2e-mcp-admin-tools.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's administration tools and the account's own vault, access and usage
 *   tools, called over MCP and refused: SSO connections and the SCIM token (aimeat_admin_sso_*),
 *   deactivating and reactivating an account (aimeat_admin_owner_disable / _enable), the node's
 *   statistics and AI spend (aimeat_admin_statistics, aimeat_admin_usage), the hook bindings
 *   (aimeat_admin_hooks, aimeat_admin_hook_set), a person's CORS list (aimeat_admin_cors_set), the
 *   new-version check (aimeat_admin_node_update), the secret vault (aimeat_secret_list / _set /
 *   _delete), the access overview (aimeat_access_list), the usage report (aimeat_usage_report), and
 *   the agent's own statistics on the CLI dispatch (aimeat_agent_statistics).
 *
 *   WHY THIS SUITE EXISTS. Every aimeat_admin_* tool asks resolveOperatorAgentName() in its handler:
 *   the account the agent acts for runs this node AND the agent holds operator:admin. An ordinary
 *   owner may give an agent operator:admin, and the registration filter then offers it every admin
 *   tool, so the handler line is the refusal. No E2E suite called these tools (QA audit W27). Each
 *   refusal below is asserted with the tool OFFERED to an ordinary owner's agent holding
 *   operator:admin, and the state is read back to prove nothing changed. The vault, access and usage
 *   tools are gated by their permission word at registration, so their refusal is "not offered", and
 *   the vault adds the cross-owner boundary: one owner's agent never reads or deletes another's secret.
 *
 *   THE CLI DISPATCH TOOL. aimeat_agent_statistics is connector-only (not on /v1/mcp). It is driven
 *   through its CLI dispatch definition (CONNECT_CLI_TOOLS, the table behind `aimeat connect call`
 *   and /local/call/<tool>) with an agent's own token, which is what the connector runs.
 *
 *   NOTHING IS LEFT CHANGED. The SSO connection made here is deleted, the account is reactivated,
 *   the hook binding is cleared, the CORS list is cleared through the operator's HTTP route, the
 *   update-check setting is reset, and the secret is deleted. aimeat_admin_node_update is called with
 *   the update check switched off, so it reads the status and asks no registry.
 * @structure
 *   - Setup: the operator (the first owner registered), an ordinary owner, a third owner to
 *     deactivate, and their agents
 *   - SSO: list, create, get, update, IdP metadata, SCIM token, delete
 *   - Accounts: deactivate and reactivate
 *   - Numbers: statistics, usage
 *   - Hooks, CORS, the new-version check
 *   - The account's own tools: secrets, access, usage report, agent statistics
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-admin-tools
 * @version-history
 *   v1.1.0 — 2026-10-17 — aimeat_usage_report misses only wallet:read for a memory:read agent, a
 *     one-press word, so it is listed (permission ask, mcp/permission-ask-gate.ts) and the call is
 *     refused SCOPE_DENIED with the allow address. The operator tools keep "not offered".
 *   v1.0.0 — 2026-10-16 — Initial (QA audit W27).
 */
import { registerOwner, ownerSignIn, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, toolNames, type McpSession, type McpAgent } from './helpers/mcp-session.js';
import { buildIdpMetadataXml, FAKE_IDP } from './helpers/fake-saml-idp.js';
import { CONNECT_CLI_TOOLS } from '../src/tool-dispatch/index.js';
import { AimeatClient } from '../src/tool-dispatch/api-client.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const STAMP = Date.now().toString(36);

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`✅ ${name}`); }
    catch (e) { failed++; console.log(`❌ ${name}: ${(e as Error).message}`); }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
        });
        if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1200)); continue; }
        const text = await res.text();
        let body: any;
        try { body = JSON.parse(text); } catch { body = { _raw: text }; }
        return { status: res.status, body };
    }
}

const bearer = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });
const short = (v: unknown): string => String(JSON.stringify(v)).slice(0, 300);
const NOT_OPERATOR = /node operator's own agent/;

/** A refusal by the handler: an error, with the tool offered to the session. */
function assertHandlerRefusal(r: { isError: boolean; offered: boolean; text: string }, label: string, pattern: RegExp = NOT_OPERATOR): void {
    assert(r.isError, `${label}: expected a refusal, got ${r.text.slice(0, 300)}`);
    assert(r.offered, `${label}: the tool was not offered, so the handler line was never reached: ${r.text.slice(0, 200)}`);
    assert(pattern.test(r.text), `${label}: the refusal does not say why: ${r.text.slice(0, 300)}`);
}

let op: RegisteredOwner;
let member: RegisteredOwner;
let target: RegisteredOwner;
let opAdmin: McpSession;
let memAdmin: McpSession;
let opStar: McpSession;

console.log('\n=== MCP admin tools: SSO, accounts, numbers, hooks, CORS, vault ===\n');

await test('Setup: the operator, an ordinary owner, a third owner, and agents holding operator:admin', async () => {
    op = await registerOwner(BASE, `mcpadmop${STAMP}`);
    member = await registerOwner(BASE, `mcpadmmem${STAMP}`);
    target = await registerOwner(BASE, `mcpadmtgt${STAMP}`);
    assert(op.roles.includes('operator'), `the first owner must be the operator, roles ${short(op.roles)}`);
    assert(!member.roles.includes('operator'), `the second owner must not be, roles ${short(member.roles)}`);
    opAdmin = await openSession(BASE, (await makeAgent(BASE, op, ['operator:admin'])).token, 'op-admin');
    memAdmin = await openSession(BASE, (await makeAgent(BASE, member, ['operator:admin'])).token, 'mem-admin');
    opStar = await openSession(BASE, (await makeAgent(BASE, op, ['*'])).token, 'op-star');
});

await test("The operator's agent holding only '*' is offered no admin tool (operator:admin is outside every wildcard)", async () => {
    const names = await toolNames(opStar);
    const offered = names.filter((n) => n.startsWith('aimeat_admin_sso_') || n.startsWith('aimeat_admin_owner_')
        || ['aimeat_admin_usage', 'aimeat_admin_statistics', 'aimeat_admin_hooks', 'aimeat_admin_hook_set',
            'aimeat_admin_cors_set', 'aimeat_admin_node_update'].includes(n));
    assert(offered.length === 0, `offered to '*': ${offered.join(', ')}`);
    const r = await callTool(opStar, 'aimeat_admin_sso_list', {});
    assert(r.isError && !r.offered, `expected not offered, got ${r.text.slice(0, 200)}`);
});

// ─── SSO ───
console.log('\nSSO connections');

const SSO_ID = `mcp-${STAMP}`.slice(0, 31);
const ssoList = () => json('/v1/admin/sso/connections', { headers: bearer(op.token) });

await test("aimeat_admin_sso_list: refused to an ordinary owner's agent holding operator:admin; the operator's agent reads it", async () => {
    assertHandlerRefusal(await callTool(memAdmin, 'aimeat_admin_sso_list', {}), 'member sso_list');
    const r = await callTool(opAdmin, 'aimeat_admin_sso_list', {});
    assert(!r.isError && Array.isArray(r.data.connections), `operator sso_list: ${r.text.slice(0, 300)}`);
});

await test("aimeat_admin_sso_create: refused to the ordinary owner's agent, nothing made; the operator's agent makes one", async () => {
    const refused = await callTool(memAdmin, 'aimeat_admin_sso_create', { id: SSO_ID, name: 'Member Org', domains: ['member-org.example'] });
    assertHandlerRefusal(refused, 'member sso_create');
    assert(!(await ssoList()).body.data.connections.some((c: any) => c.id === SSO_ID), 'the refused connection was made');

    const r = await callTool(opAdmin, 'aimeat_admin_sso_create', { id: SSO_ID, name: 'MCP Org', domains: ['mcp-org.example'] });
    assert(!r.isError && r.data.connection?.id === SSO_ID, `operator sso_create: ${r.text.slice(0, 300)}`);
    assert((await ssoList()).body.data.connections.some((c: any) => c.id === SSO_ID), 'the connection is not listed over HTTP');
    const dup = await callTool(opAdmin, 'aimeat_admin_sso_create', { id: SSO_ID, name: 'Again', domains: ['mcp-org.example'] });
    assert(dup.isError && /NAME_TAKEN/.test(dup.text), `a second create with the same id: ${dup.text.slice(0, 200)}`);
});

await test("aimeat_admin_sso_get: refused to the ordinary owner's agent; the operator's agent reads it; an unknown id is NOT_FOUND", async () => {
    assertHandlerRefusal(await callTool(memAdmin, 'aimeat_admin_sso_get', { id: SSO_ID }), 'member sso_get');
    const r = await callTool(opAdmin, 'aimeat_admin_sso_get', { id: SSO_ID });
    assert(!r.isError && r.data.connection?.id === SSO_ID, `operator sso_get: ${r.text.slice(0, 300)}`);
    const miss = await callTool(opAdmin, 'aimeat_admin_sso_get', { id: `zz-${STAMP}` });
    assert(miss.isError && /NOT_FOUND/.test(miss.text), `unknown id: ${miss.text.slice(0, 200)}`);
});

await test("aimeat_admin_sso_update: refused to the ordinary owner's agent, the name unchanged; the operator's agent renames it", async () => {
    assertHandlerRefusal(await callTool(memAdmin, 'aimeat_admin_sso_update', { id: SSO_ID, name: 'Taken Over' }), 'member sso_update');
    const mid = await callTool(opAdmin, 'aimeat_admin_sso_get', { id: SSO_ID });
    assert(mid.data.connection?.name === 'MCP Org', `the refused rename landed: ${short(mid.data.connection)}`);
    const r = await callTool(opAdmin, 'aimeat_admin_sso_update', { id: SSO_ID, name: 'MCP Org Renamed', login_visibility: 'hidden' });
    assert(!r.isError && r.data.connection?.name === 'MCP Org Renamed', `operator sso_update: ${r.text.slice(0, 300)}`);
    const bad = await callTool(opAdmin, 'aimeat_admin_sso_update', { id: SSO_ID, login_visibility: 'everywhere' });
    // Refused by the catalog schema (an enum) before the handler; either way nothing is stored.
    assert(bad.isError && /listed|hidden/.test(bad.text), `bad visibility: ${bad.text.slice(0, 200)}`);
});

await test("aimeat_admin_sso_idp_metadata: refused to the ordinary owner's agent; the operator's agent stores the IdP; a non-document is refused", async () => {
    const xml = buildIdpMetadataXml();
    assertHandlerRefusal(await callTool(memAdmin, 'aimeat_admin_sso_idp_metadata', { id: SSO_ID, xml }), 'member idp_metadata');
    const r = await callTool(opAdmin, 'aimeat_admin_sso_idp_metadata', { id: SSO_ID, xml });
    assert(!r.isError, `operator idp_metadata: ${r.text.slice(0, 300)}`);
    assert(JSON.stringify(r.data.connection).includes(FAKE_IDP.entityId), `the IdP entity id is not on the connection: ${short(r.data.connection)}`);
    const bad = await callTool(opAdmin, 'aimeat_admin_sso_idp_metadata', { id: SSO_ID, xml: '<nope/>' });
    assert(bad.isError && /INVALID_INPUT/.test(bad.text), `a non-document: ${bad.text.slice(0, 200)}`);
});

await test("aimeat_admin_sso_scim_token: refused to the ordinary owner's agent; the operator's agent gets a token once", async () => {
    const refused = await callTool(memAdmin, 'aimeat_admin_sso_scim_token', { id: SSO_ID });
    assertHandlerRefusal(refused, 'member scim_token');
    assert(!/scim_token/.test(refused.text), 'a refusal must not carry a token');
    const r = await callTool(opAdmin, 'aimeat_admin_sso_scim_token', { id: SSO_ID });
    assert(!r.isError && typeof r.data.scim_token === 'string' && r.data.scim_token.length > 16, `operator scim_token: ${r.text.slice(0, 120)}`);
});

await test("aimeat_admin_sso_delete: refused to the ordinary owner's agent, the connection stays; the operator's agent deletes it", async () => {
    assertHandlerRefusal(await callTool(memAdmin, 'aimeat_admin_sso_delete', { id: SSO_ID }), 'member sso_delete');
    assert((await ssoList()).body.data.connections.some((c: any) => c.id === SSO_ID), 'the refused delete removed the connection');
    const r = await callTool(opAdmin, 'aimeat_admin_sso_delete', { id: SSO_ID });
    assert(!r.isError && r.data.deleted === true, `operator sso_delete: ${r.text.slice(0, 300)}`);
    assert(!(await ssoList()).body.data.connections.some((c: any) => c.id === SSO_ID), 'the connection is still listed');
    const again = await callTool(opAdmin, 'aimeat_admin_sso_delete', { id: SSO_ID });
    assert(again.isError && /NOT_FOUND/.test(again.text), `a second delete: ${again.text.slice(0, 200)}`);
});

// ─── Accounts ───
console.log('\nDeactivating an account');

const canSignIn = async (owner: RegisteredOwner): Promise<boolean> => (await ownerSignIn(BASE, owner.name, owner.password)).status === 200;

await test("aimeat_admin_owner_disable: refused to the ordinary owner's agent, and the account still signs in", async () => {
    assertHandlerRefusal(await callTool(memAdmin, 'aimeat_admin_owner_disable', { name: target.name }), 'member owner_disable');
    assert(await canSignIn(target), 'the refused deactivation locked the account');
});

await test("aimeat_admin_owner_disable: the operator's agent deactivates the account, and it no longer signs in", async () => {
    const r = await callTool(opAdmin, 'aimeat_admin_owner_disable', { name: target.name });
    assert(!r.isError && r.data.disabled === true && r.data.name === target.name, `operator owner_disable: ${r.text.slice(0, 300)}`);
    assert(!(await canSignIn(target)), 'a deactivated account still signs in');
    const old = await json('/v1/ghii/me', { headers: bearer(target.token) });
    assert(old.status === 401 || old.status === 403, `the deactivated account's old session still works: ${old.status}`);
    const self = await callTool(opAdmin, 'aimeat_admin_owner_disable', { name: op.name });
    assert(self.isError && /own account/.test(self.text), `the operator deactivating themselves: ${self.text.slice(0, 200)}`);
});

await test("aimeat_admin_owner_enable: refused to the ordinary owner's agent, the account stays off; the operator's agent turns it back on", async () => {
    assertHandlerRefusal(await callTool(memAdmin, 'aimeat_admin_owner_enable', { name: target.name }), 'member owner_enable');
    assert(!(await canSignIn(target)), 'the refused reactivation unlocked the account');
    const r = await callTool(opAdmin, 'aimeat_admin_owner_enable', { name: target.name });
    assert(!r.isError && r.data.disabled === false, `operator owner_enable: ${r.text.slice(0, 300)}`);
    assert(await canSignIn(target), 'the reactivated account does not sign in');
    const miss = await callTool(opAdmin, 'aimeat_admin_owner_enable', { name: `nobody${STAMP}` });
    assert(miss.isError && /NOT_FOUND/.test(miss.text), `an unknown account: ${miss.text.slice(0, 200)}`);
});

// ─── Numbers ───
console.log('\nStatistics and usage');

await test("aimeat_admin_statistics: refused to the ordinary owner's agent; the operator's agent reads the counters", async () => {
    assertHandlerRefusal(await callTool(memAdmin, 'aimeat_admin_statistics', {}), 'member statistics');
    const r = await callTool(opAdmin, 'aimeat_admin_statistics', {});
    assert(!r.isError && typeof r.data === 'object' && !r.data._text, `operator statistics: ${r.text.slice(0, 300)}`);
    const half = await callTool(opAdmin, 'aimeat_admin_statistics', { from: '2026-01-01' });
    assert(half.isError && /both/.test(half.text), `from without to: ${half.text.slice(0, 200)}`);
});

await test("aimeat_admin_usage: refused to the ordinary owner's agent; the operator's agent reads the AI spend", async () => {
    assertHandlerRefusal(await callTool(memAdmin, 'aimeat_admin_usage', {}), 'member usage');
    const r = await callTool(opAdmin, 'aimeat_admin_usage', {});
    assert(!r.isError && typeof r.data === 'object' && !r.data._text, `operator usage: ${r.text.slice(0, 300)}`);
    const bad = await callTool(opAdmin, 'aimeat_admin_usage', { from: '2026-02-01', to: '2026-01-01' });
    assert(bad.isError && /after/.test(bad.text), `from after to: ${bad.text.slice(0, 200)}`);
});

// ─── Hooks ───
console.log('\nHooks');

let actionRef = '';

await test("aimeat_admin_hooks: refused to the ordinary owner's agent; the operator's agent reads the eleven moments", async () => {
    assertHandlerRefusal(await callTool(memAdmin, 'aimeat_admin_hooks', {}), 'member hooks');
    const r = await callTool(opAdmin, 'aimeat_admin_hooks', {});
    assert(!r.isError && Array.isArray(r.data.hooks) && r.data.hooks.length === 11, `operator hooks: ${r.text.slice(0, 300)}`);
});

await test("aimeat_admin_hook_set: refused to the ordinary owner's agent, nothing bound; the operator's agent binds a published action", async () => {
    const publisher = await makeAgent(BASE, op, ['work:publish']);
    const id = `mcp-hook-${STAMP}`;
    const pub = await json('/v1/actions', {
        method: 'POST', headers: bearer(publisher.token), body: JSON.stringify({
            id, display_name: `Test ${id}`, description: 'An action published to prove a hook can bind to it.',
            input_schema: { type: 'object' }, output_schema: { type: 'object' }, pricing: { toll_morsels: 0 }, tags: ['test'],
        }),
    });
    assert(pub.status === 201, `publish: ${pub.status} ${short(pub.body)}`);
    actionRef = id;

    assertHandlerRefusal(await callTool(memAdmin, 'aimeat_admin_hook_set', { hook: 'post_settlement', actions: [id] }), 'member hook_set');
    const mid = await callTool(opAdmin, 'aimeat_admin_hooks', {});
    assert(mid.data.hooks.find((h: any) => h.name === 'post_settlement').actions.length === 0, 'the refused binding landed');

    const r = await callTool(opAdmin, 'aimeat_admin_hook_set', { hook: 'post_settlement', actions: [id] });
    assert(!r.isError && r.data.hook === 'post_settlement' && r.data.actions.length === 1, `operator hook_set: ${r.text.slice(0, 300)}`);
    assert(String(r.data.actions[0]).startsWith(`${id}#`), `the binding names its provider: ${short(r.data.actions)}`);
    const unknown = await callTool(opAdmin, 'aimeat_admin_hook_set', { hook: 'no_such_moment', actions: [id] });
    assert(unknown.isError && /INVALID_INPUT/.test(unknown.text), `unknown hook: ${unknown.text.slice(0, 200)}`);
});

await test('Cleanup: the hook binding is cleared', async () => {
    const r = await callTool(opAdmin, 'aimeat_admin_hook_set', { hook: 'post_settlement', actions: [] });
    assert(!r.isError && r.data.cleared === true, `clear: ${r.text.slice(0, 300)}`);
    assert(actionRef !== '', 'the action was published');
});

// ─── CORS ───
console.log('\nCORS');

const ORIGIN = 'https://mcp-e2e.example.test';

async function corsListOf(ghii: string): Promise<string[] | null> {
    const r = await callTool(opAdmin, 'aimeat_admin_cors_overview', {});
    assert(!r.isError, `cors overview: ${r.text.slice(0, 200)}`);
    return r.data.people.with_list.find((p: any) => p.ghii === ghii)?.allowed_origins ?? null;
}

await test("aimeat_admin_cors_set: refused to the ordinary owner's agent, the list unchanged; the operator's agent sets a person's list", async () => {
    assertHandlerRefusal(await callTool(memAdmin, 'aimeat_admin_cors_set', { who: member.name, origins: [ORIGIN] }), 'member cors_set');
    assert((await corsListOf(member.ghii)) === null, 'the refused list landed');
    const r = await callTool(opAdmin, 'aimeat_admin_cors_set', { who: member.name, origins: [ORIGIN] });
    assert(!r.isError && r.data.kind === 'person' && JSON.stringify(r.data.allowed_origins) === JSON.stringify([ORIGIN]),
        `operator cors_set: ${r.text.slice(0, 300)}`);
    assert(JSON.stringify(await corsListOf(member.ghii)) === JSON.stringify([ORIGIN]), 'the overview does not show the list');
    const bad = await callTool(opAdmin, 'aimeat_admin_cors_set', { who: member.name, origins: ['ftp://nope'] });
    assert(bad.isError && /INVALID_INPUT/.test(bad.text), `a bad origin: ${bad.text.slice(0, 200)}`);
});

await test("Cleanup: the person's CORS list is cleared through the operator's HTTP route", async () => {
    const r = await json(`/v1/admin/ghii/${encodeURIComponent(member.ghii)}/cors`, {
        method: 'PUT', headers: bearer(op.token), body: JSON.stringify({ allowed_origins: null }),
    });
    assert(r.status === 200 && r.body.data.allowed_origins === null, `clear: ${r.status} ${short(r.body)}`);
    assert((await corsListOf(member.ghii)) === null, 'the list is still there');
});

// ─── The new-version check ───
console.log('\nThe new-version check');

const setConfig = (path: string, value: unknown) => json('/v1/admin/config', {
    method: 'PUT', headers: bearer(op.token), body: JSON.stringify({ changes: [{ path, value }] }),
});

await test("aimeat_admin_node_update: refused to the ordinary owner's agent; the operator's agent reads the status, and nothing is installed", async () => {
    const off = await setConfig('node.update_check', false);
    assert(off.status === 200, `switch the check off: ${off.status} ${short(off.body)}`);
    const refused = await callTool(memAdmin, 'aimeat_admin_node_update', {});
    assertHandlerRefusal(refused, 'member node_update');
    assert(/FORBIDDEN/.test(refused.text), `the refusal code: ${refused.text.slice(0, 200)}`);
    const r = await callTool(opAdmin, 'aimeat_admin_node_update', {});
    assert(!r.isError && r.data.enabled === false && typeof r.data.current === 'string', `operator node_update: ${r.text.slice(0, 300)}`);
    assert(r.data.updateAvailable === false && r.data.prompt === null, `with the check off nothing is offered: ${short(r.data)}`);
});

await test('Cleanup: the update-check setting is back to its default', async () => {
    const r = await json(`/v1/admin/config/${encodeURIComponent('node.update_check')}`, { method: 'DELETE', headers: bearer(op.token) });
    assert(r.status === 200, `reset: ${r.status} ${short(r.body)}`);
});

// ─── The account's own tools ───
console.log('\nSecrets, access, usage, agent statistics');

const SECRET = `MCP_E2E_${STAMP.toUpperCase()}`;
let opSecrets: McpSession;
let memSecrets: McpSession;

await test('aimeat_secret_*: not offered without secrets:manage, \'*\' included (the word is outside every wildcard)', async () => {
    opSecrets = await openSession(BASE, (await makeAgent(BASE, op, ['secrets:manage'])).token, 'op-secrets');
    memSecrets = await openSession(BASE, (await makeAgent(BASE, member, ['secrets:manage'])).token, 'mem-secrets');
    for (const tool of ['aimeat_secret_list', 'aimeat_secret_set', 'aimeat_secret_delete']) {
        const r = await callTool(opStar, tool, { name: SECRET, value: 'x' });
        assert(r.isError && !r.offered, `${tool} offered to '*': ${r.text.slice(0, 200)}`);
    }
});

await test('aimeat_secret_set / _list: an owner\'s agent stores a secret, the list names it and never shows the value', async () => {
    const set = await callTool(opSecrets, 'aimeat_secret_set', { name: SECRET, value: 'sk-mcp-e2e-value-123', host: 'api.example.test' });
    assert(!set.isError, `secret_set: ${set.text.slice(0, 300)}`);
    assert(!set.text.includes('sk-mcp-e2e-value-123'), 'the answer echoes the value');
    const list = await callTool(opSecrets, 'aimeat_secret_list', {});
    assert(!list.isError && list.data.secrets.some((s: any) => s.name === SECRET), `secret_list: ${list.text.slice(0, 300)}`);
    assert(!list.text.includes('sk-mcp-e2e-value-123'), 'the list shows the value');
    const bad = await callTool(opSecrets, 'aimeat_secret_set', { name: 'has space', value: 'x' });
    assert(bad.isError && /INVALID_SECRET_NAME/.test(bad.text), `a bad name: ${bad.text.slice(0, 200)}`);
});

await test("aimeat_secret_list / _delete: another owner's agent neither sees nor deletes the secret", async () => {
    const list = await callTool(memSecrets, 'aimeat_secret_list', {});
    assert(!list.isError && !list.data.secrets.some((s: any) => s.name === SECRET), `another owner sees it: ${list.text.slice(0, 300)}`);
    const del = await callTool(memSecrets, 'aimeat_secret_delete', { name: SECRET });
    assert(del.isError, `another owner deleted it: ${del.text.slice(0, 200)}`);
    const still = await callTool(opSecrets, 'aimeat_secret_list', {});
    assert(still.data.secrets.some((s: any) => s.name === SECRET), 'the secret is gone after another owner\'s delete');
});

await test('Cleanup: aimeat_secret_delete removes the secret, and a second delete is refused', async () => {
    const del = await callTool(opSecrets, 'aimeat_secret_delete', { name: SECRET });
    assert(!del.isError && del.data.deleted === true, `secret_delete: ${del.text.slice(0, 300)}`);
    const list = await callTool(opSecrets, 'aimeat_secret_list', {});
    assert(!list.data.secrets.some((s: any) => s.name === SECRET), 'the secret is still listed');
    const again = await callTool(opSecrets, 'aimeat_secret_delete', { name: SECRET });
    assert(again.isError, `a second delete: ${again.text.slice(0, 200)}`);
});

await test('aimeat_access_list: not offered without account:security; with it, the agent reads its OWNER\'s access overview', async () => {
    const bare = await openSession(BASE, (await makeAgent(BASE, member, ['memory:read'])).token, 'mem-bare');
    const refused = await callTool(bare, 'aimeat_access_list', {});
    assert(refused.isError && !refused.offered, `expected not offered, got ${refused.text.slice(0, 200)}`);
    const holder = await openSession(BASE, (await makeAgent(BASE, member, ['account:security'])).token, 'mem-access');
    const r = await callTool(holder, 'aimeat_access_list', {});
    assert(!r.isError && r.data.sign_in?.has_password === true && Array.isArray(r.data.accessTokens?.tokens),
        `access_list: ${r.text.slice(0, 300)}`);
});

await test('aimeat_usage_report: refused with the allow address without wallet:read; with it, the owner\'s report by model', async () => {
    const bare = await openSession(BASE, (await makeAgent(BASE, member, ['memory:read'])).token, 'mem-bare2');
    const refused = await callTool(bare, 'aimeat_usage_report', { report: 'model' });
    // Listed since 2026-10-17 (permission ask): a one-press permission keeps the tool on the list and the call is refused with the allow address.
    assert(refused.isError && refused.offered && /^SCOPE_DENIED/.test(refused.text) && refused.text.includes('/v1/allow?'),
        `expected SCOPE_DENIED with the allow address, got ${refused.text.slice(0, 200)}`);
    const holder = await openSession(BASE, (await makeAgent(BASE, member, ['wallet:read'])).token, 'mem-wallet');
    const r = await callTool(holder, 'aimeat_usage_report', { report: 'model' });
    assert(!r.isError && typeof r.data === 'object' && !r.data._text, `usage_report: ${r.text.slice(0, 300)}`);
    const bad = await callTool(holder, 'aimeat_usage_report', { report: 'no-such-report' });
    assert(bad.isError, `an unknown report: ${bad.text.slice(0, 200)}`);
});

/** Run one CLI dispatch definition as the connector does, with the agent's own token. */
async function dispatch(agent: McpAgent, owner: RegisteredOwner, tool: string, agentPath: string, input: Record<string, unknown> = {}) {
    const def = CONNECT_CLI_TOOLS.find((d) => d.name === tool);
    assert(def, `${tool} has no CLI dispatch definition`);
    const client = new AimeatClient(BASE, agent.token);
    const resp = await def.handler({ client, config: { node_url: BASE, agent: agent.name, owner: owner.name }, agentPath }, input);
    return { resp, status: client.lastStatus };
}

await test('aimeat_agent_statistics (CLI dispatch): an agent reads its own rollups; it is not on /v1/mcp', async () => {
    const self = await makeAgent(BASE, member, ['memory:read']);
    const { resp, status } = await dispatch(self, member, 'aimeat_agent_statistics', encodeURIComponent(self.name));
    assert(resp.ok && status === 200, `own statistics: ${status} ${short(resp.error ?? resp.data)}`);
    const data = resp.data as any;
    assert(data && 'performance' in data && 'reviews' in data && Array.isArray(data.custom), `shape: ${short(data)}`);
    const names = await toolNames(opStar);
    assert(!names.includes('aimeat_agent_statistics'), 'the connector-only tool is offered on /v1/mcp');
});

await test("aimeat_agent_statistics (CLI dispatch): a sibling agent of the same owner is refused another agent's rollups", async () => {
    const self = await makeAgent(BASE, member, ['memory:read']);
    const sibling = await makeAgent(BASE, member, ['memory:read']);
    const { resp, status } = await dispatch(sibling, member, 'aimeat_agent_statistics', encodeURIComponent(self.name));
    assert(!resp.ok && status === 403, `a sibling read another agent's statistics: ${status} ${short(resp.data ?? resp.error)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
