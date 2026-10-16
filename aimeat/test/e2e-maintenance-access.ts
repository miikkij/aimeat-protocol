/**
 * @file test/e2e-maintenance-access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may stop the node, and who gets through while it is stopped.
 *     - POST /v1/admin/maintenance is refused to a plain owner (403), to a plain owner's agent (403)
 *       and to a caller with no credential (401), and GET on the same path likewise; the state is
 *       unchanged afterwards.
 *     - While maintenance is on, on a data route outside /v1/admin (GET /v1/memory): a signed-in
 *       plain owner gets exactly 503 MAINTENANCE_MODE; the operator gets through; the operator's
 *       agent holding operator:admin gets through and one without that word gets 503; an anonymous
 *       JSON request gets exactly 503 MAINTENANCE_MODE and a browser gets the 503 page.
 *     - During the stop a plain owner can still sign in, and still cannot read or end the stop.
 *     - The operator ends it, and the plain owner's request goes through again.
 *
 *   WHY. The one maintenance test (api-full.ts) sent every operator request to /v1/admin/*, which
 *   the guard lets through by path before it asks who is calling, sent no signed-in non-operator
 *   request during the stop, and accepted 401 as well as 503 for the anonymous JSON request. So the
 *   guard's operator branch could admit everyone, or no operator, and stay green.
 *
 *   Maintenance is switched off in a finally block, so a failed assertion never leaves the node
 *   stopped for whatever runs next.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-maintenance-access
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit F19a-02).
 */
import { registerOwner, ownerSignIn, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, type McpAgent } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}: ${(e as Error).message}`); }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit & { token?: string } = {}): Promise<{ status: number; body: any; type: string }> {
    const { token, ...rest } = opts;
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            ...rest,
            headers: {
                'Content-Type': 'application/json', Accept: 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(rest.headers ?? {}),
            },
        });
        if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        const text = await res.text();
        let body: any;
        try { body = JSON.parse(text); } catch { body = { _raw: text.slice(0, 400) }; }
        return { status: res.status, body, type: res.headers.get('content-type') ?? '' };
    }
}

const short = (v: unknown) => JSON.stringify(v).slice(0, 240);
const stamp = Date.now().toString(36).slice(-5);
const DATA_ROUTE = '/v1/memory?limit=1';

let operator: RegisteredOwner;
let plain: RegisteredOwner;
let plainAgent: McpAgent;
let opAgentWithWord: McpAgent;
let opAgentWithout: McpAgent;

const setMaintenance = (enabled: boolean, token?: string) => json('/v1/admin/maintenance', {
    method: 'POST', token, body: JSON.stringify({ enabled, message: 'E2E maintenance access' }),
});

async function maintenanceState(): Promise<boolean> {
    const r = await json('/v1/admin/maintenance', { token: operator.token });
    if (r.status !== 200) throw new Error(`operator GET maintenance: ${r.status} ${short(r.body)}`);
    return r.body.data.enabled === true;
}

console.log('\n=== MAINTENANCE ACCESS E2E (who stops the node, who passes the stop) ===\n');
console.log('Phase 0 — fixtures (before the stop: agents sign in through routes the stop refuses)');

await test('The operator, a plain owner, and three agents', async () => {
    operator = await registerOwner(BASE, `mtop${stamp}`);
    plain = await registerOwner(BASE, `mtpl${stamp}`);
    plainAgent = await makeAgent(BASE, plain, ['memory:read', 'memory:write']);
    opAgentWithWord = await makeAgent(BASE, operator, ['operator:admin', 'memory:read']);
    opAgentWithout = await makeAgent(BASE, operator, ['memory:read', 'memory:write']);
    assert(opAgentWithWord.gaii.includes(`#${operator.name}@`), `the agent is the operator's: ${opAgentWithWord.gaii}`);
});

console.log('\nPhase 1 — who may switch it');

await test('A plain owner cannot switch maintenance on (403), nor read it (403)', async () => {
    const post = await setMaintenance(true, plain.token);
    assert(post.status === 403, `plain owner POST: ${post.status} ${short(post.body)}`);
    const get = await json('/v1/admin/maintenance', { token: plain.token });
    assert(get.status === 403, `plain owner GET: ${get.status} ${short(get.body)}`);
});

await test('A plain owner\'s agent cannot switch it on (403)', async () => {
    const post = await setMaintenance(true, plainAgent.token);
    assert(post.status === 403, `agent POST: ${post.status} ${short(post.body)}`);
});

await test('The operator\'s agent without operator:admin cannot switch it on (403)', async () => {
    const post = await setMaintenance(true, opAgentWithout.token);
    assert(post.status === 403, `operator's agent without the word: ${post.status} ${short(post.body)}`);
});

await test('No credential: 401 for POST and GET', async () => {
    const post = await setMaintenance(true);
    assert(post.status === 401, `anonymous POST: ${post.status} ${short(post.body)}`);
    const get = await json('/v1/admin/maintenance');
    assert(get.status === 401, `anonymous GET: ${get.status} ${short(get.body)}`);
});

await test('After the refusals the node is still running', async () => {
    assert(await maintenanceState() === false, 'a refused caller switched maintenance on');
    const r = await json(DATA_ROUTE, { token: plain.token });
    assert(r.status === 200, `plain owner before the stop: ${r.status} ${short(r.body)}`);
});

console.log('\nPhase 2 — during the stop');

const on = await setMaintenance(true, operator.token);
try {
    await test('The operator switches maintenance on', async () => {
        assert(on.status === 200 && on.body.data?.enabled === true, `operator POST: ${on.status} ${short(on.body)}`);
        assert(await maintenanceState() === true, 'maintenance is not on');
    });

    await test('A signed-in plain owner gets exactly 503 MAINTENANCE_MODE on a data route', async () => {
        const r = await json(DATA_ROUTE, { token: plain.token });
        assert(r.status === 503 && r.body.error?.code === 'MAINTENANCE_MODE', `plain owner: ${r.status} ${short(r.body)}`);
        assert(r.body.error?.message === 'E2E maintenance access', `the operator's message: ${short(r.body)}`);
    });

    await test('A plain owner\'s agent gets 503 on the same route', async () => {
        const r = await json(DATA_ROUTE, { token: plainAgent.token });
        assert(r.status === 503 && r.body.error?.code === 'MAINTENANCE_MODE', `plain agent: ${r.status} ${short(r.body)}`);
    });

    await test('The operator gets through on the same route', async () => {
        const r = await json(DATA_ROUTE, { token: operator.token });
        assert(r.status === 200, `operator outside /v1/admin: ${r.status} ${short(r.body)}`);
    });

    await test('The operator\'s agent holding operator:admin gets through; one without it gets 503', async () => {
        const withWord = await json(DATA_ROUTE, { token: opAgentWithWord.token });
        assert(withWord.status === 200, `operator's agent with operator:admin: ${withWord.status} ${short(withWord.body)}`);
        const without = await json(DATA_ROUTE, { token: opAgentWithout.token });
        assert(without.status === 503 && without.body.error?.code === 'MAINTENANCE_MODE', `operator's agent without it: ${without.status} ${short(without.body)}`);
    });

    await test('An anonymous JSON request gets exactly 503 MAINTENANCE_MODE', async () => {
        const r = await json('/v1/memory/some-key');
        assert(r.status === 503, `anonymous JSON: ${r.status} ${short(r.body)}`);
        assert(r.body.error?.code === 'MAINTENANCE_MODE', `anonymous JSON code: ${short(r.body)}`);
    });

    await test('A browser gets the 503 maintenance page', async () => {
        const res = await fetch(`${BASE}/v1/memory/some-key`, { headers: { Accept: 'text/html' } });
        const html = await res.text();
        assert(res.status === 503 && (res.headers.get('content-type') ?? '').includes('text/html'), `browser: ${res.status} ${res.headers.get('content-type')}`);
        assert(html.includes('E2E maintenance access'), 'the page carries the operator\'s message');
    });

    await test('A plain owner can still sign in, and still cannot read or end the stop', async () => {
        const login = await ownerSignIn(BASE, plain.name, plain.password);
        assert(login.status === 200 && typeof login.body.data?.token === 'string', `sign-in during the stop: ${login.status} ${short(login.body)}`);
        const fresh = login.body.data.token as string;
        const get = await json('/v1/admin/maintenance', { token: fresh });
        assert(get.status === 403, `plain owner GET during the stop: ${get.status} ${short(get.body)}`);
        const off = await setMaintenance(false, fresh);
        assert(off.status === 403, `plain owner ended the stop: ${off.status} ${short(off.body)}`);
        assert(await maintenanceState() === true, 'maintenance went off after a refused request');
    });
} finally {
    const off = await setMaintenance(false, operator.token);
    if (off.status !== 200) console.log(`  ⚠ could not switch maintenance off: ${off.status} ${short(off.body)}`);
}

console.log('\nPhase 3 — after the stop');

await test('The operator switched it off, and the plain owner goes through again', async () => {
    assert(await maintenanceState() === false, 'maintenance is still on');
    const r = await json(DATA_ROUTE, { token: plain.token });
    assert(r.status === 200, `plain owner after the stop: ${r.status} ${short(r.body)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
