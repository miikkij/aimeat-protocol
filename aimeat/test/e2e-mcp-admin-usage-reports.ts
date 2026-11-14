/**
 * @file test/e2e-mcp-admin-usage-reports.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_admin_usage reads the node's usage reports, as GET /v1/admin/usage/summary
 *   does: the same rows for the same report and window, the same INVALID_INPUT for a bad report or
 *   day, the same refusal of a caller who does not run the node, on the node MCP endpoint and on the
 *   CLI dispatch (the table behind `aimeat connect call` and /local/call/<tool>). A call that names
 *   no report parameter still answers the AI-cost page, as GET /v1/admin/usage/page does.
 *
 *   HOW "THE SAME ROWS" IS MEASURED. Every call to the node is itself a usage call, so two reads
 *   made one after the other can differ by the reads between them. Each tool read is therefore
 *   bracketed by two HTTP reads, and each of its rows has to sit between them: present in the later
 *   read, and with a call count no lower than the earlier read and no higher than the later one.
 * @structure
 *   - Setup: the operator (the first owner registered), an ordinary owner, and agents holding
 *     operator:admin
 *   - The node-wide tool report and one owner's slice of it, over MCP and the CLI dispatch
 *   - A bad report, a bad day, ask_provider beside a report
 *   - The ordinary owner's agent is refused on all three surfaces
 *   - No parameters: the AI-cost page as before
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-admin-usage-reports
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial: aimeat_admin_usage takes report, owner, from, to, grain, series and limit.
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, toolNames, type McpSession, type McpAgent } from './helpers/mcp-session.js';
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

async function json(path: string, token: string): Promise<{ status: number; body: any }> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1200)); continue; }
        const text = await res.text();
        let body: any;
        try { body = JSON.parse(text); } catch { body = { _raw: text }; }
        return { status: res.status, body };
    }
}

const short = (v: unknown): string => String(JSON.stringify(v)).slice(0, 300);
const NOT_OPERATOR = /node operator's own agent/;
const day = (daysAgo: number): string => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
const FROM = day(30);
const TO = day(0);

async function dispatch(agent: McpAgent, owner: RegisteredOwner, input: Record<string, unknown>): Promise<{ resp: any; status: number }> {
    const def = CONNECT_CLI_TOOLS.find((d) => d.name === 'aimeat_admin_usage');
    assert(def, 'aimeat_admin_usage has no CLI dispatch definition');
    const client = new AimeatClient(BASE, agent.token);
    const resp = await def.handler({ client, config: { node_url: BASE, agent: agent.name, owner: owner.name }, agentPath: '' }, input as never);
    return { resp, status: client.lastStatus };
}

const summaryPath = (q: Record<string, string>): string => `/v1/admin/usage/summary?${new URLSearchParams(q).toString()}`;

/** Every row of `mid` lies between the same report read before it and after it. */
function assertBetween(before: any, mid: any, after: any, label: string): void {
    assert(mid && Array.isArray(mid.groups), `${label}: no groups in the answer: ${short(mid)}`);
    for (const k of ['report', 'cut', 'scope', 'owner', 'from', 'to', 'grain'] as const) {
        assert(mid[k] === after[k], `${label}: ${k} is ${short(mid[k])}, the route says ${short(after[k])}`);
    }
    const byKey = (r: any) => new Map<string, number>(r.groups.map((g: any) => [g.key, g.calls]));
    const lo = byKey(before);
    const hi = byKey(after);
    const got = byKey(mid);
    for (const [key, calls] of lo) {
        assert(got.has(key), `${label}: row "${key}" is in the route's earlier read and not in the tool's`);
        assert(got.get(key)! >= calls, `${label}: row "${key}" has ${got.get(key)} calls, fewer than the earlier read's ${calls}`);
    }
    for (const [key, calls] of got) {
        assert(hi.has(key), `${label}: row "${key}" is in the tool's answer and not in the route's later read`);
        assert(calls <= hi.get(key)!, `${label}: row "${key}" has ${calls} calls, more than the later read's ${hi.get(key)}`);
    }
}

let op: RegisteredOwner;
let member: RegisteredOwner;
let opAgent: McpAgent;
let memAgent: McpAgent;
let opAdmin: McpSession;
let memAdmin: McpSession;

console.log('\n=== aimeat_admin_usage: the node usage reports ===\n');

await test('Setup: the operator, an ordinary owner, and agents holding operator:admin', async () => {
    op = await registerOwner(BASE, `usgrepop${STAMP}`);
    member = await registerOwner(BASE, `usgrepmem${STAMP}`);
    assert(op.roles.includes('operator'), `the first owner must be the operator, roles ${short(op.roles)}`);
    assert(!member.roles.includes('operator'), `the second owner must not be, roles ${short(member.roles)}`);
    opAgent = await makeAgent(BASE, op, ['operator:admin']);
    memAgent = await makeAgent(BASE, member, ['operator:admin']);
    opAdmin = await openSession(BASE, opAgent.token, 'op-admin');
    memAdmin = await openSession(BASE, memAgent.token, 'mem-admin');
    // Some tool calls of both owners, so the tool report has rows to compare.
    assert((await toolNames(opAdmin)).includes('aimeat_admin_usage'), 'the operator agent is not offered aimeat_admin_usage');
    await callTool(opAdmin, 'aimeat_admin_statistics', {});
    await callTool(memAdmin, 'aimeat_admin_statistics', {});
});

await test("report tool over MCP: the same rows as GET /v1/admin/usage/summary?report=tool for the same window", async () => {
    const q = { report: 'tool', from: FROM, to: TO };
    const before = await json(summaryPath(q), op.token);
    assert(before.status === 200, `route: ${before.status} ${short(before.body)}`);
    assert(before.body.data.groups.length > 0, `the route's tool report is empty, nothing to compare: ${short(before.body.data)}`);
    const r = await callTool(opAdmin, 'aimeat_admin_usage', q);
    assert(!r.isError, `tool: ${r.text.slice(0, 300)}`);
    const after = await json(summaryPath(q), op.token);
    assertBetween(before.body.data, r.data, after.body.data, 'MCP node tool report');
    assert(r.data.scope === 'node' && r.data.report === 'tool', `not the node tool report: ${short(r.data)}`);
});

await test("report tool for one owner over MCP: the same rows as the route's owner slice", async () => {
    const q = { report: 'tool', owner: member.name, from: FROM, to: TO, grain: 'day', series: 'false', limit: '50' };
    const before = await json(summaryPath(q), op.token);
    assert(before.status === 200, `route: ${before.status} ${short(before.body)}`);
    const r = await callTool(opAdmin, 'aimeat_admin_usage', { report: 'tool', owner: member.name, from: FROM, to: TO, grain: 'day', series: false, limit: 50 });
    assert(!r.isError, `tool: ${r.text.slice(0, 300)}`);
    const after = await json(summaryPath(q), op.token);
    assertBetween(before.body.data, r.data, after.body.data, 'MCP owner tool report');
    assert(r.data.scope === 'owner' && String(r.data.owner).startsWith(`${member.name}@`), `not the owner slice: ${short(r.data)}`);
    assert(Array.isArray(r.data.series) && r.data.series.length === 0, `series false still carries a series: ${short(r.data.series)}`);
});

await test("report tool on the CLI dispatch: the same rows as the route", async () => {
    const q = { report: 'tool', from: FROM, to: TO };
    const before = await json(summaryPath(q), op.token);
    const { resp, status } = await dispatch(opAgent, op, q);
    assert(resp.ok && status === 200, `dispatch: ${status} ${short(resp.error ?? resp.data)}`);
    const after = await json(summaryPath(q), op.token);
    assertBetween(before.body.data, resp.data, after.body.data, 'dispatch node tool report');
});

await test('A bad report: the same INVALID_INPUT as the route, on MCP and on the CLI dispatch', async () => {
    const route = await json(summaryPath({ report: 'nope' }), op.token);
    assert(route.status === 400 && route.body.error?.code === 'INVALID_INPUT', `route: ${route.status} ${short(route.body)}`);
    const r = await callTool(opAdmin, 'aimeat_admin_usage', { report: 'nope' });
    assert(r.isError && r.text.startsWith(`INVALID_INPUT: ${route.body.error.message}`), `tool: ${r.text.slice(0, 300)}`);
    const { resp, status } = await dispatch(opAgent, op, { report: 'nope' });
    assert(!resp.ok && status === 400 && resp.error?.code === 'INVALID_INPUT', `dispatch: ${status} ${short(resp.error ?? resp)}`);
});

await test('A bad day: the same INVALID_INPUT as the route', async () => {
    const route = await json(summaryPath({ report: 'tool', from: 'yesterday' }), op.token);
    assert(route.status === 400 && route.body.error?.code === 'INVALID_INPUT', `route: ${route.status} ${short(route.body)}`);
    const r = await callTool(opAdmin, 'aimeat_admin_usage', { report: 'tool', from: 'yesterday' });
    assert(r.isError && r.text.startsWith(`INVALID_INPUT: ${route.body.error.message}`), `tool: ${r.text.slice(0, 300)}`);
});

await test('ask_provider beside a report is refused, since it belongs to the cost page', async () => {
    const r = await callTool(opAdmin, 'aimeat_admin_usage', { report: 'tool', ask_provider: true });
    assert(r.isError && /^INVALID_INPUT: /.test(r.text) && /ask_provider/.test(r.text), `tool: ${r.text.slice(0, 300)}`);
    let threw = '';
    try { await dispatch(opAgent, op, { report: 'tool', ask_provider: true }); } catch (e) { threw = (e as Error).message; }
    assert(/^INVALID_INPUT: /.test(threw) && /ask_provider/.test(threw), `dispatch: ${threw || 'no refusal'}`);
});

await test("The ordinary owner's agent holding operator:admin is refused, as the route refuses it", async () => {
    const route = await json(summaryPath({ report: 'tool' }), memAgent.token);
    assert(route.status === 403, `route answered ${route.status} ${short(route.body)}`);
    const r = await callTool(memAdmin, 'aimeat_admin_usage', { report: 'tool' });
    assert(r.isError && r.offered && NOT_OPERATOR.test(r.text), `tool: ${r.text.slice(0, 300)}`);
    const { resp, status } = await dispatch(memAgent, member, { report: 'tool' });
    assert(!resp.ok && status === 403, `dispatch: ${status} ${short(resp.error ?? resp.data)}`);
});

await test('No parameters: the AI-cost page, as GET /v1/admin/usage/page answers it', async () => {
    const page = await json('/v1/admin/usage/page', op.token);
    assert(page.status === 200 && page.body.data.whose_money, `route: ${page.status} ${short(page.body)}`);
    const r = await callTool(opAdmin, 'aimeat_admin_usage', {});
    assert(!r.isError && r.data.whose_money && r.data.groups === undefined, `tool: ${r.text.slice(0, 300)}`);
    assert(short(Object.keys(r.data).sort()) === short(Object.keys(page.body.data).sort()),
        `tool keys ${short(Object.keys(r.data))}, route keys ${short(Object.keys(page.body.data))}`);
    assert(r.data.from === page.body.data.from && r.data.to === page.body.data.to, `window ${r.data.from}..${r.data.to}`);
    const { resp, status } = await dispatch(opAgent, op, {});
    assert(resp.ok && status === 200 && resp.data.whose_money && resp.data.groups === undefined, `dispatch: ${status} ${short(resp.data)}`);
    const half = await callTool(opAdmin, 'aimeat_admin_usage', { from: '2026-01-01' });
    assert(half.isError && /both/.test(half.text), `a lone from still refused on the page: ${half.text.slice(0, 200)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
