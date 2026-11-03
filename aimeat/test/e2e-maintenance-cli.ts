/**
 * @file test/e2e-maintenance-cli.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A maintenance stop made outside the running node reaches it.
 *     - `aimeat maintenance on <message>`, run as its own process against the node's database, makes
 *       the running node answer 503 MAINTENANCE_MODE with that message on a data route within the
 *       re-read interval, and `aimeat maintenance off` lets requests through again.
 *     - The operator's own switch (POST /v1/admin/maintenance) still takes effect on the very next
 *       request, in both directions: a re-read that started before the switch does not undo it.
 *
 *   WHY. The CLI writes storage only, and until 2026-11-04 the node read the state once at boot
 *   (server-bootstrap/service-init.ts), so the command the startup banner recommends did nothing
 *   until a restart. A standby or second process had the same blind spot for the operator's switch
 *   on the other process (codebase analysis 2026-11-03, item A8).
 *
 *   Maintenance is switched off in a finally block, through both the CLI and the operator's route,
 *   so a failed assertion never leaves the node stopped for whatever runs next.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-maintenance-cli
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item A8).
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { runCli } from './helpers/connect-cli.js';
import { serverDbUrl, serverSqlitePath } from './helpers/server-db.js';

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

async function json(path: string, opts: RequestInit & { token?: string } = {}): Promise<{ status: number; body: any }> {
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
        return { status: res.status, body };
    }
}

const short = (v: unknown) => JSON.stringify(v).slice(0, 240);
const stamp = Date.now().toString(36).slice(-5);
const DATA_ROUTE = '/v1/memory?limit=1';
const CLI_MESSAGE = 'E2E maintenance from the CLI';
/** The node re-reads every 5 s; the rest is the time a loaded machine takes to answer. */
const REACH_MS = 20_000;

/** The CLI pointed at the database the node under test writes, the way an operator runs it on the host. */
function cliEnv(): Record<string, string> {
    const url = serverDbUrl();
    return url
        ? { AIMEAT_STORAGE: 'postgres-kysely', DATABASE_URL: url }
        : { AIMEAT_STORAGE: 'sqlite', AIMEAT_SQLITE_PATH: serverSqlitePath() };
}

async function cli(...args: string[]) {
    return runCli(['maintenance', ...args], { env: cliEnv(), timeoutMs: 90_000 });
}

/** Ask the data route until it answers `status`, or until the deadline. Answers the last reply. */
async function until(token: string, status: number): Promise<{ status: number; body: any; ms: number }> {
    const started = Date.now();
    let last = await json(DATA_ROUTE, { token });
    while (last.status !== status && Date.now() - started < REACH_MS) {
        await new Promise((r) => setTimeout(r, 500));
        last = await json(DATA_ROUTE, { token });
    }
    return { ...last, ms: Date.now() - started };
}

let operator: RegisteredOwner;
let plain: RegisteredOwner;

console.log('\n=== MAINTENANCE CLI E2E (a stop made outside the node reaches it) ===\n');

await test('An operator and a plain owner; the plain owner reads a data route', async () => {
    operator = await registerOwner(BASE, `mcop${stamp}`);
    plain = await registerOwner(BASE, `mcpl${stamp}`);
    const r = await json(DATA_ROUTE, { token: plain.token });
    assert(r.status === 200, `before the stop: ${r.status} ${short(r.body)}`);
});

try {
    await test('`aimeat maintenance on` from another process stops the running node', async () => {
        const run = await cli('on', CLI_MESSAGE);
        assert(run.code === 0 && run.stdout.includes('Maintenance mode ON'), `cli on: code ${run.code} ${run.out.slice(-400)}`);
        const r = await until(plain.token, 503);
        assert(r.status === 503 && r.body.error?.code === 'MAINTENANCE_MODE',
            `the running node did not see the CLI's stop within ${REACH_MS} ms: ${r.status} ${short(r.body)}`);
        assert(r.body.error?.message === CLI_MESSAGE, `the CLI's message: ${short(r.body)}`);
    });

    await test('A plain owner can neither end the CLI\'s stop nor read it (403), and the stop holds', async () => {
        const end = await json('/v1/admin/maintenance', { method: 'POST', token: plain.token, body: JSON.stringify({ enabled: false }) });
        assert(end.status === 403, `plain owner POST during the CLI stop: ${end.status} ${short(end.body)}`);
        const read = await json('/v1/admin/maintenance', { token: plain.token });
        assert(read.status === 403, `plain owner GET during the CLI stop: ${read.status} ${short(read.body)}`);
        const still = await json(DATA_ROUTE, { token: plain.token });
        assert(still.status === 503, `the stop went off after a refused request: ${still.status}`);
    });

    await test('The operator still passes the stop the CLI made', async () => {
        const r = await json(DATA_ROUTE, { token: operator.token });
        assert(r.status === 200, `operator during the CLI stop: ${r.status} ${short(r.body)}`);
    });

    await test('`aimeat maintenance off` from another process ends it', async () => {
        const run = await cli('off');
        assert(run.code === 0 && run.stdout.includes('Maintenance mode OFF'), `cli off: code ${run.code} ${run.out.slice(-400)}`);
        const r = await until(plain.token, 200);
        assert(r.status === 200, `the running node did not see the CLI's end within ${REACH_MS} ms: ${r.status} ${short(r.body)}`);
    });

    await test('The operator\'s own switch takes effect on the next request, on and off, ten times', async () => {
        for (let i = 0; i < 10; i++) {
            const on = await json('/v1/admin/maintenance', {
                method: 'POST', token: operator.token, body: JSON.stringify({ enabled: true, message: 'E2E switch' }),
            });
            assert(on.status === 200, `operator on: ${on.status} ${short(on.body)}`);
            const during = await json(DATA_ROUTE, { token: plain.token });
            assert(during.status === 503, `round ${i}: next request after on: ${during.status}`);
            const off = await json('/v1/admin/maintenance', {
                method: 'POST', token: operator.token, body: JSON.stringify({ enabled: false }),
            });
            assert(off.status === 200, `operator off: ${off.status} ${short(off.body)}`);
            const after = await json(DATA_ROUTE, { token: plain.token });
            assert(after.status === 200, `round ${i}: next request after off: ${after.status}`);
            if (i % 3 === 2) await new Promise((r) => setTimeout(r, 2_000));
        }
    });
} finally {
    await cli('off').catch(() => undefined);
    if (operator) {
        await json('/v1/admin/maintenance', {
            method: 'POST', token: operator.token, body: JSON.stringify({ enabled: false }),
        }).catch(() => undefined);
    }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
