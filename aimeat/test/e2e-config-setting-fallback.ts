/**
 * @file test/e2e-config-setting-fallback.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A node started with a setting it does not accept starts anyway, on that setting's
 *   default, says so in one log line, and shows one incident per such setting on the Security page;
 *   the incident closes by itself at the first start with a value the node accepts. A storage type
 *   it does not know still stops the start, with the reason (Jouni, decision 2026-10-16, reversing
 *   the refusal of QA audit D8-02 for every setting outside REFUSE_ON_INVALID in
 *   src/config-start-check.ts).
 *
 *   HOW. Three starts of one node on one database: first with AIMEAT_METRICS_ACCESS=everyone (the
 *   default is operator) and AIMEAT_PASSWORD_LOCKOUT_ATTEMPTS=five (the default is 5); then with the
 *   metrics access corrected; and one start with `--db sqllite`, which exits without serving.
 *
 *   It runs its own node, on the run's backend (test/helpers/own-node-db.ts), on port 28484.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-config-setting-fallback
 * @version-history
 *   2026-10-16 — Initial (Jouni, decision 2026-10-16).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { registerOwner } from './helpers/owner-login.js';

const PORT = 28484;
const BASE = `http://127.0.0.1:${PORT}`;
const STAMP = Date.now().toString(36).slice(-6);

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); } catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const short = (v: unknown): string => JSON.stringify(v).slice(0, 400);

async function json(path: string, token?: string): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, body: ct.includes('json') ? await res.json() : { _raw: await res.text() } };
}

const db = await ownNodeDb(String(PORT));
let log = '';
let node: ChildProcess | null = null;

function nodeEnv(settings: Record<string, string>): NodeJS.ProcessEnv {
    const env: Record<string, string | undefined> = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith('AIMEAT_') || k === 'DATABASE_URL') delete env[k];
    Object.assign(env, db.env, {
        AIMEAT_PORT: String(PORT),
        AIMEAT_NODE_ID: `aimeat-test-001-fallback${STAMP}`,
        AIMEAT_ADMIN_PASSWORD: `Fallback-Admin-${STAMP}-Pw!`,
        AIMEAT_LOG_LEVEL: 'info',
        AIMEAT_METRICS_ENABLED: 'true',
        AIMEAT_SMTP_HOST: '',
    }, settings);
    return env as NodeJS.ProcessEnv;
}

async function startNode(settings: Record<string, string>): Promise<void> {
    log = '';
    node = spawn('node', [...nodeEntryArgs(), 'start', ...db.args], { env: nodeEnv(settings), stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    node.stdout?.on('data', (d: Buffer) => { log += d.toString(); });
    node.stderr?.on('data', (d: Buffer) => { log += d.toString(); });
    await waitForServer(node, BASE, { label: 'the setting-fallback node' });
}

async function stopNode(): Promise<void> {
    if (!node || node.exitCode !== null) return;
    node.kill('SIGTERM');
    await Promise.race([once(node, 'exit'), new Promise(r => setTimeout(r, 10_000))]);
}

async function settingIncidents(token: string): Promise<any[]> {
    const r = await json('/v1/admin/security/incidents', token);
    assert(r.status === 200, `incident list: ${r.status} ${short(r.body)}`);
    return (r.body.data.incidents as any[]).filter(i => i.type === 'config_setting');
}

console.log('\n=== A setting the node does not accept: the node starts on the default and says so ===\n');

try {
    await startNode({ AIMEAT_METRICS_ACCESS: 'everyone', AIMEAT_PASSWORD_LOCKOUT_ATTEMPTS: 'five' });

    await test('the node started, and one log line names each setting, its problem and the default used', async () => {
        const lines = log.split(/\r?\n/).filter(l => l.includes('[config]') && l.includes('is not a value this node accepts'));
        const metrics = lines.find(l => l.includes('AIMEAT_METRICS_ACCESS="everyone"'));
        const lockout = lines.find(l => l.includes('AIMEAT_PASSWORD_LOCKOUT_ATTEMPTS="five"'));
        assert(metrics?.includes('takes one of public, authenticated, operator') && metrics.includes('the default, operator'), `metrics line: ${metrics}`);
        assert(lockout?.includes('takes a whole number') && lockout.includes('the default, 5'), `lockout line: ${lockout}`);
        assert(lines.length === 2, `expected two lines, got ${short(lines)}`);
    });

    await test('the default runs: the metrics are refused to a caller who is not the operator', async () => {
        const r = await json('/v1/metrics');
        assert(r.status === 403 && r.body.error?.code === 'ACCESS_DENIED', `metrics without a credential: ${r.status} ${short(r.body)}`);
    });

    const operator = await registerOwner(BASE, `fallop${STAMP}`);

    await test('the Security page has one open incident per setting, with the value and what to do', async () => {
        const open = (await settingIncidents(operator.token)).filter(i => i.status === 'open');
        assert(open.length === 2, `open incidents: ${short(open)}`);
        const m = open.find(i => i.setting?.variable === 'AIMEAT_METRICS_ACCESS');
        assert(m?.setting?.value === 'everyone' && m.code === 'SETTING_NOT_ACCEPTED', `metrics incident: ${short(m)}`);
        assert(String(m.detail).includes('closes by itself'), `detail: ${m.detail}`);
    });

    await test('an operator reads them; a member who is not the operator is refused', async () => {
        const member = await registerOwner(BASE, `fallmem${STAMP}`);
        const r = await json('/v1/admin/security/incidents', member.token);
        assert(r.status === 403, `a member read the incidents: ${r.status} ${short(r.body)}`);
        const anon = await json('/v1/admin/security/incidents');
        assert(anon.status === 401, `no credential read the incidents: ${anon.status} ${short(anon.body)}`);
    });

    await stopNode();
    await startNode({ AIMEAT_METRICS_ACCESS: 'operator', AIMEAT_PASSWORD_LOCKOUT_ATTEMPTS: 'five' });

    await test('a start with the value corrected closes its incident by itself, and the other stays, once', async () => {
        const all = await settingIncidents(operator.token);
        const metrics = all.filter(i => i.setting?.variable === 'AIMEAT_METRICS_ACCESS');
        const lockout = all.filter(i => i.setting?.variable === 'AIMEAT_PASSWORD_LOCKOUT_ATTEMPTS');
        assert(metrics.length === 1 && metrics[0].status === 'resolved', `metrics: ${short(metrics)}`);
        assert(lockout.length === 1 && lockout[0].status === 'open', `lockout: ${short(lockout)}`);
        assert(!log.includes('AIMEAT_METRICS_ACCESS="'), 'the corrected setting is still named in the log');
    });

    await stopNode();

    await test('a storage type the node does not know stops the start and says why the default is not used', async () => {
        log = '';
        const args = [...nodeEntryArgs(), 'start', ...db.args.map(a => (a === 'sqlite' || a === 'postgres-kysely' ? 'sqllite' : a))];
        const refused = spawn('node', args, { env: nodeEnv({}), stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
        refused.stdout?.on('data', (d: Buffer) => { log += d.toString(); });
        refused.stderr?.on('data', (d: Buffer) => { log += d.toString(); });
        const [code] = await Promise.race([once(refused, 'exit'), new Promise<[null]>(r => setTimeout(() => { refused.kill('SIGKILL'); r([null]); }, 120_000))]);
        assert(code === 1, `exit code: ${code}; log: ${log.slice(-500)}`);
        assert(log.includes('AIMEAT_STORAGE="sqllite"') && log.includes('in-memory database'), `refusal: ${log.slice(-600)}`);
    });
} finally {
    await stopNode();
}

console.log(`\nSetting fallback E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
if (failed > 0 || passed === 0) {
    if (failed > 0) console.log(log.split(/\r?\n/).slice(-30).join('\n'));
    process.exit(1);
}
