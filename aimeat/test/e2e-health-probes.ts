/**
 * @file test/e2e-health-probes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The probes a process manager or load balancer acts on, beside GET /v1/health.
 *     - GET /v1/health/live answers 200 `live`, uncached, with no credential.
 *     - GET /v1/health/ready answers 200 `ready` on a booted node, uncached, with no credential.
 *     - GET /v1/health answers as before: 200, `status`, `subsystems.storage.healthy`, `build`.
 *     - During a maintenance stop both probes still answer 200, while a data route answers 503: the
 *       process is up and serves the maintenance answer, so a load balancer keeps it in rotation.
 *   The draining answer (503 NOT_READY while a SIGTERM drains the process) is proved by
 *   e2e-graceful-shutdown.ts, which owns a node it may stop.
 *
 *   WHY. GET /v1/health answers 200 also when degraded, so a balancer that reads only the status
 *   code never takes a process out; and it lists every personal node and reads two rows for each,
 *   on an unsigned call (codebase analysis 2026-11-03, HA stage 1).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-health-probes
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, HA stage 1: liveness and readiness).
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';

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

async function json(path: string, opts: RequestInit & { token?: string } = {}): Promise<{ status: number; body: any; cache: string }> {
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
        return { status: res.status, body, cache: res.headers.get('cache-control') ?? '' };
    }
}

const short = (v: unknown) => JSON.stringify(v).slice(0, 240);
const stamp = Date.now().toString(36).slice(-5);

console.log('\n=== HEALTH PROBES E2E (liveness, readiness, and /v1/health as before) ===\n');

await test('GET /v1/health/live answers 200 live, uncached, with no credential', async () => {
    const r = await json('/v1/health/live');
    assert(r.status === 200 && r.body.ok === true && r.body.data?.status === 'live', `live: ${r.status} ${short(r.body)}`);
    assert(typeof r.body.data.uptime_seconds === 'number', `uptime: ${short(r.body)}`);
    assert(r.cache.includes('no-store'), `cache-control: ${r.cache}`);
});

await test('GET /v1/health/ready answers 200 ready on a booted node, uncached, with no credential', async () => {
    const r = await json('/v1/health/ready');
    assert(r.status === 200 && r.body.ok === true && r.body.data?.status === 'ready', `ready: ${r.status} ${short(r.body)}`);
    assert(r.cache.includes('no-store'), `cache-control: ${r.cache}`);
});

await test('GET /v1/health answers as before: 200, status, the storage subsystem and the build', async () => {
    const r = await json('/v1/health');
    assert(r.status === 200 && r.body.ok === true, `health: ${r.status} ${short(r.body)}`);
    assert(r.body.data?.status === 'healthy', `status: ${short(r.body.data)}`);
    assert(r.body.data?.subsystems?.storage?.healthy === true, `storage: ${short(r.body.data)}`);
    assert(typeof r.body.data?.build?.version === 'string', `build: ${short(r.body.data)}`);
});

let operator: RegisteredOwner | undefined;
let plain: RegisteredOwner | undefined;
await test('An operator and a plain owner', async () => {
    operator = await registerOwner(BASE, `hpop${stamp}`);
    plain = await registerOwner(BASE, `hppl${stamp}`);
});

const setMaintenance = (enabled: boolean) => json('/v1/admin/maintenance', {
    method: 'POST', token: operator?.token, body: JSON.stringify({ enabled, message: 'E2E health probes' }),
});

try {
    await test('During a maintenance stop both probes answer 200 while a data route answers 503', async () => {
        assert(operator && plain, 'fixtures');
        const on = await setMaintenance(true);
        assert(on.status === 200 && on.body.data?.enabled === true, `operator on: ${on.status} ${short(on.body)}`);
        const data = await json('/v1/memory?limit=1', { token: plain.token });
        assert(data.status === 503 && data.body.error?.code === 'MAINTENANCE_MODE', `data route: ${data.status} ${short(data.body)}`);
        const live = await json('/v1/health/live');
        assert(live.status === 200 && live.body.data?.status === 'live', `live during the stop: ${live.status} ${short(live.body)}`);
        const ready = await json('/v1/health/ready');
        assert(ready.status === 200 && ready.body.data?.status === 'ready', `ready during the stop: ${ready.status} ${short(ready.body)}`);
        const health = await json('/v1/health');
        assert(health.status === 200, `health during the stop: ${health.status} ${short(health.body)}`);
    });
} finally {
    if (operator) await setMaintenance(false).catch(() => undefined);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
