/**
 * @file test/e2e-hook-when-missing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A blocking hook whose bound action is missing (feature audit 2026-11-19, 2.4). The
 *   operator binds a published action to pre_owner_registration and the action's publisher then
 *   unpublishes it.
 *   - Default (`pass`): a registration goes through, as it always has, and every operator gets ONE
 *     notification for that hook and action, however many registrations follow on the same day.
 *     The Hooks read names the hook in `missing`, and its row says `when_missing: pass`.
 *   - `refuse`, set over REST: the next registration is refused, and the run log says why.
 *   - `refuse` and back to `pass` over MCP (aimeat_admin_hook_set with `when_missing` alone).
 *   - A notify hook refuses the setting; an owner who is not an operator is refused it.
 *   - A published action behaves as today: its answer decides.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=hook-when-missing
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial.
 */
import * as http from 'node:http';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}: ${(e as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

async function json(path: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
    const res = await fetch(`${BASE}${path}`, {
        method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
        headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    });
    const text = await res.text();
    let body: any = { _raw: text };
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body };
}
const show = (r: { status: number; body: any }) => `${r.status} ${JSON.stringify(r.body?.error ?? r.body).slice(0, 300)}`;

// The action's address: it says yes, and counts how often it is asked.
let calls = 0;
let answerAllowed = true;
const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
        calls++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ allowed: answerAllowed, reason: answerAllowed ? undefined : 'not on the list' }));
    });
});
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const hookUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/check`;

const stamp = Date.now().toString(36).slice(-6);
let OP = { name: '', token: '' };
let OTHER = { name: '', token: '' };
let publisher: Awaited<ReturnType<typeof makeAgent>>;
let ref = '';
let n = 0;
const register = () => json('/v1/ghii', { body: { username: `hwm${stamp}${n++}`, display_name: 'Hook test', password: 'HookTest1234' } });
const notices = async () => ((await json('/v1/notifications?limit=100', { token: OP.token })).body?.data?.notifications ?? [])
    .filter((x: any) => String(x.type ?? '').startsWith('hook_action_missing'));
const row = async (hook: string) => ((await json('/v1/admin/hooks', { token: OP.token })).body?.data?.hooks ?? []).find((h: any) => h.name === hook);

console.log('\n=== AIMEAT blocking hook with a missing action E2E ===\n');

await test('setup: the operator, a second owner, and an action published with an address', async () => {
    OP = await registerOwner(BASE, `hwmop${stamp}`);
    OTHER = await registerOwner(BASE, `hwmown${stamp}`);
    publisher = await makeAgent(BASE, OP, ['work:publish']);
    const pub = await json('/v1/actions', { token: publisher.token, body: {
        id: `hwm-check-${stamp}`, display_name: 'Registration check', description: 'Checks a new account',
        input_schema: { type: 'object' }, output_schema: { type: 'object' }, pricing: { toll_morsels: 0 }, webhook_url: hookUrl,
    } });
    assert(pub.status === 201, `publish ${show(pub)}`);
    const bind = await json('/v1/admin/hooks/pre_owner_registration', { method: 'PUT', token: OP.token, body: { actions: [`hwm-check-${stamp}`] } });
    assert(bind.status === 200, `bind ${show(bind)}`);
    ref = bind.body.data.actions[0];
});

await test('a published action behaves as today: its yes lets the registration through and its no refuses it', async () => {
    calls = 0; answerAllowed = true;
    const yes = await register();
    assert(yes.status === 201, `registration with a yes: ${show(yes)}`);
    assert(calls === 1, `the action was asked once, got ${calls}`);
    answerAllowed = false;
    const no = await register();
    assert(no.status >= 400 && no.status < 500, `registration with a no: ${show(no)}`);
    answerAllowed = true;
    const r = await row('pre_owner_registration');
    assert(r.missing === false && r.when_missing === 'pass', `row: ${JSON.stringify({ missing: r.missing, when_missing: r.when_missing })}`);
});

await test('the publisher unpublishes the action', async () => {
    const del = await json(`/v1/actions/${encodeURIComponent(`hwm-check-${stamp}`)}`, { method: 'DELETE', token: publisher.token });
    assert(del.status === 200 && del.body?.data?.deleted === true, `unpublish ${show(del)}`);
});

await test('default: registrations go through, and the operator is told once, not once per registration', async () => {
    calls = 0;
    for (let i = 0; i < 3; i++) {
        const r = await register();
        assert(r.status === 201, `registration ${i + 1} with the action missing: ${show(r)}`);
    }
    assert(calls === 0, `nothing was called, got ${calls}`);
    const told = await notices();
    assert(told.length === 1, `one notice, got ${told.length}: ${JSON.stringify(told.map((x: any) => x.type))}`);
    assert(told[0].type === 'hook_action_missing_pass' && String(told[0].body).includes(ref), `the notice names the hook and the action: ${JSON.stringify(told[0])}`);
    const r = await row('pre_owner_registration');
    assert(r.missing === true && r.when_missing === 'pass', `row: ${JSON.stringify({ missing: r.missing, when_missing: r.when_missing })}`);
    const all = (await json('/v1/admin/hooks', { token: OP.token })).body.data;
    assert(Array.isArray(all.missing) && all.missing.includes('pre_owner_registration'), `missing list: ${JSON.stringify(all.missing)}`);
});

await test('another owner is refused the setting, and a notify hook has none', async () => {
    const other = await json('/v1/admin/hooks/pre_owner_registration', { method: 'PUT', token: OTHER.token, body: { when_missing: 'refuse' } });
    assert(other.status === 403, `a non-operator: ${show(other)}`);
    const notify = await json('/v1/admin/hooks/post_owner_registration', { method: 'PUT', token: OP.token, body: { when_missing: 'refuse' } });
    assert(notify.status === 400 && notify.body?.error?.code === 'INVALID_INPUT', `a notify hook: ${show(notify)}`);
    const bad = await json('/v1/admin/hooks/pre_owner_registration', { method: 'PUT', token: OP.token, body: { when_missing: 'maybe' } });
    assert(bad.status === 400, `a value that is not one: ${show(bad)}`);
    const r = await row('pre_owner_registration');
    assert(r.when_missing === 'pass', `nothing changed: ${r.when_missing}`);
    assert(r.actions.length === 1 && r.actions[0].ref === ref, 'the binding stays as it was');
});

await test('with "refuse" set over REST, the registration is refused and the log says why', async () => {
    const set = await json('/v1/admin/hooks/pre_owner_registration', { method: 'PUT', token: OP.token, body: { when_missing: 'refuse' } });
    assert(set.status === 200 && set.body.data.when_missing === 'refuse', `set ${show(set)}`);
    const r = await register();
    assert(r.status >= 400 && r.status < 500, `the registration is refused: ${show(r)}`);
    const hooks = (await json('/v1/admin/hooks', { token: OP.token })).body.data;
    const last = hooks.runs[0];
    assert(last.hook === 'pre_owner_registration' && last.answer === 'missing' && last.allowed === false, `the run: ${JSON.stringify(last)}`);
    assert(String(last.reason).includes('refuses when its action is missing'), `the reason: ${last.reason}`);
    assert((await row('pre_owner_registration')).actions[0].ref === ref, 'the binding was not touched');
    assert((await notices()).length === 1, 'still one notice on the same day');
});

await test('over MCP, when_missing alone sets the hook back to letting events through', async () => {
    const opAgent = await makeAgent(BASE, OP, ['operator:admin']);
    const s = await openSession(BASE, opAgent.token, 'hook-when-missing');
    const out = await callTool(s, 'aimeat_admin_hook_set', { hook: 'pre_owner_registration', when_missing: 'pass' });
    assert(!out.isError && out.text.includes('"when_missing": "pass"'), `tool: ${out.text.slice(0, 300)}`);
    const r = await register();
    assert(r.status === 201, `the registration goes through again: ${show(r)}`);
    const wrong = await callTool(s, 'aimeat_admin_hook_set', { hook: 'post_settlement', when_missing: 'refuse' });
    assert(wrong.isError && wrong.text.includes('INVALID_INPUT'), `a notify hook over MCP: ${wrong.text.slice(0, 200)}`);
});

await test('cleanup: the operator clears the hook', async () => {
    const clear = await json('/v1/admin/hooks/pre_owner_registration', { method: 'DELETE', token: OP.token });
    assert(clear.status === 200, `clear ${show(clear)}`);
});

server.close();
console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
