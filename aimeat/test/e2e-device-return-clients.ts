/**
 * @file e2e-device-return-clients.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two enrolment scripts outside `aimeat connect` prove a reconnect is the agent
 *   coming back, so the owner sees a return and not a new device taking the agent over.
 *
 *   A device-authorization request that names an existing agent is shown to the owner as a takeover
 *   unless it carries `proof`, a signature by the key the agent's last approval gave it
 *   (services/device-return-proof.ts). `aimeat connect add` keeps that key and signs its reconnect
 *   (e2e-agent-reapproval Phase 6). The OpenHands bundle's tools/aimeat-openhands/scripts/aimeat-connect.sh
 *   and the Dify bridge's aimeat/tools/dify-bridge/src/connect-onboard.ts did not, so every reconnect
 *   the owner set up themselves showed the takeover warning. Each script is run here twice against
 *   the runner's node, as a person runs it, the owner approving in between: the first run keeps the
 *   key at 0600 beside the token, and the second run is a proven return.
 *
 *   The OpenHands script is bash: on Windows it runs under Git's bash.exe, found next to git.exe,
 *   and never under the bash.exe in System32, which starts WSL.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=device-return-clients
 * @version-history
 *   v1.1.0 -- 2026-11-01 -- Each script, run with the same folder and names against another server
 *     that reports this node's id, sends that server no return proof (secaudit2026oct31w2 round 11,
 *     connect-onboard.ts:returnProof-signs-held-key-for-contacted-server-node-id and the OpenHands
 *     script's same root cause).
 *   v1.0.0 — 2026-10-26 — Initial (secaudit2026oct22, unbound-reapproval-of-existing-agent, follow-up
 *     to a9e7b15a9).
 */

import { registerOwner } from './helpers/owner-login.js';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const owner = `drc${Date.now() % 100000}`;
const REPO = resolve(process.cwd(), '..');
const OPENHANDS_SCRIPT = join(REPO, 'tools', 'aimeat-openhands', 'scripts', 'aimeat-connect.sh');
const DIFY_SCRIPT = join(process.cwd(), 'tools', 'dify-bridge', 'src', 'connect-onboard.ts');
const tmpRoot = mkdtempSync(join(tmpdir(), 'aimeat-return-clients-'));

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, body: ct.includes('json') ? await res.json() as any : { _raw: await res.text() } };
}

let ownerToken = '';
const auth = () => ({ headers: { Authorization: `Bearer ${ownerToken}` } });

interface Run { code: number | null; out: string }

/** Run a child to its end, killed at the deadline. */
function run(cmd: string, args: string[], env: Record<string, string>, timeoutMs = 120_000): Promise<Run> {
    return new Promise((settle) => {
        const child = spawn(cmd, args, { cwd: process.cwd(), env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        child.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
        child.stderr?.on('data', (d: Buffer) => { out += d.toString(); });
        const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, timeoutMs);
        child.once('error', (e) => { clearTimeout(timer); settle({ code: null, out: out + String(e) }); });
        child.once('close', (code) => { clearTimeout(timer); settle({ code, out }); });
    });
}

/** Git's bash on Windows (System32's bash.exe starts WSL); `bash` elsewhere. */
function bashPath(): string | null {
    if (process.platform !== 'win32') return 'bash';
    const dirs = (process.env.PATH ?? '').split(delimiter);
    for (const dir of dirs) {
        if (!existsSync(join(dir, 'git.exe'))) continue;
        for (const c of [join(dir, '..', 'bin', 'bash.exe'), join(dir, '..', 'usr', 'bin', 'bash.exe'), join(dir, 'bash.exe')]) {
            if (existsSync(c) && !c.toLowerCase().includes('system32')) return c;
        }
    }
    const fallback = 'C:\\Program Files\\Git\\bin\\bash.exe';
    return existsSync(fallback) ? fallback : null;
}

/** The pending request a script raised for `agent`, other than `skip`, once it appears. */
async function pendingRequest(agent: string, skip = ''): Promise<any> {
    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline) {
        const rows = ((await json('/v1/agents/device-authorize/pending', auth())).body.data?.requests ?? []) as any[];
        const row = rows.find(r => r.agent_name === agent && r.status === 'pending' && r.user_code !== skip);
        if (row) return row;
        await new Promise(res => setTimeout(res, 300));
    }
    throw new Error(`no pending request for ${agent} within 40 s`);
}

/** Approve as the consent card does when the owner keeps what the agent has (no scopes named). */
async function approve(userCode: string) {
    return json('/v1/agents/verify', { method: 'POST', body: JSON.stringify({ user_code: userCode, action: 'approve', owner_token: ownerToken }) });
}

const takeoverEvents = async () =>
    ((await json('/v1/account/events?limit=50', auth())).body.data.events as any[]).filter(e => e.kind === 'agent_device_takeover').length;

/**
 * One client, two runs: enrolment, then a reconnect after the stored token stopped working.
 * `spoil` makes the stored token dead between the runs; `keyFile` is where the key is kept.
 */
async function enrolThenReturn(label: string, agent: string, start: () => Promise<Run>, keyFile: string, spoil: () => void,
    firstRow: (row: any) => void = () => {}) {
    let firstCode = '';
    await test(`${label}: the first run keeps the key of the approval beside the token, at 0600`, async () => {
        const running = start();
        const row = await pendingRequest(agent).catch(async (e: Error) => { throw new Error(`${e.message}; the script said: ${(await running).out.slice(-800)}`); });
        firstCode = row.user_code;
        assert(row.existing_agent === false, `a new agent: ${JSON.stringify(row)}`);
        firstRow(row);
        assert((await approve(row.user_code)).status === 200, 'approve');
        const r = await running;
        assert(r.code === 0, `exit ${r.code}: ${r.out.slice(-800)}`);
        assert(existsSync(keyFile) && readFileSync(keyFile, 'utf-8').trim().length > 0, `no key at ${keyFile}`);
        if (process.platform !== 'win32') assert((statSync(keyFile).mode & 0o777) === 0o600, 'the key file is 0600');
    });

    await test(`${label}: the reconnect after the token stopped working is a proven return, not a takeover`, async () => {
        const keyBefore = existsSync(keyFile) ? readFileSync(keyFile, 'utf-8').trim() : '';
        spoil();
        const before = await takeoverEvents();
        const running = start();
        const row = await pendingRequest(agent, firstCode).catch(async (e: Error) => { throw new Error(`${e.message}; the script said: ${(await running).out.slice(-800)}`); });
        assert(row.existing_agent === true && row.return_proven === true, `the card is told it is a return: ${JSON.stringify(row)}`);
        // A proven return is still the owner's to approve: another owner is refused.
        const s = await json('/v1/agents/verify', { method: 'POST', body: JSON.stringify({ user_code: row.user_code, action: 'approve', owner_token: strangerToken }) });
        assert(s.status === 403, `another owner approving: expected 403, got ${s.status}`);
        const a = await approve(row.user_code);
        assert(a.status === 200 && a.body.data.takeover === false, `approve: ${JSON.stringify(a.body.data)}`);
        const r = await running;
        assert(r.code === 0, `exit ${r.code}: ${r.out.slice(-800)}`);
        assert((await takeoverEvents()) === before, 'no takeover event for the return');
        assert(existsSync(keyFile) && readFileSync(keyFile, 'utf-8').trim() !== keyBefore, 'the key of the new approval replaced the old one');
    });
}

/**
 * A server the script is pointed at by mistake that reports this node's id (the relay of
 * secaudit2026oct31w2 round 11): it answers GET /.well-known/aimeat with `nodeId` and keeps the
 * device-authorize body it receives, then refuses it so the script stops.
 */
async function startLookalike(nodeId: string): Promise<{ url: string; bodies: any[]; close: () => Promise<void> }> {
    const bodies: any[] = [];
    const server = createServer((req, res) => {
        let raw = '';
        req.on('data', (c: Buffer) => { raw += c.toString(); });
        req.on('end', () => {
            res.setHeader('Content-Type', 'application/json');
            if (req.method === 'GET' && req.url?.startsWith('/.well-known/aimeat')) {
                res.end(JSON.stringify({ data: { node_id: nodeId } }));
                return;
            }
            if (req.method === 'POST' && req.url?.startsWith('/v1/agents/device-authorize')) {
                try { bodies.push(JSON.parse(raw)); } catch { bodies.push({ _raw: raw }); }
            }
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'lookalike' }));
        });
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    const port = (server.address() as AddressInfo).port;
    return { url: `http://127.0.0.1:${port}`, bodies, close: () => new Promise<void>((ok) => server.close(() => ok())) };
}

/**
 * The key kept from an approval at this node signs a return proof only toward this node: run
 * against another address with the same names and folder, the script sends that server no proof,
 * says which node holds the names, and leaves the kept key alone.
 */
async function noProofElsewhere(label: string, start: (baseUrl: string) => Promise<Run>, keyFile: string) {
    await test(`${label}: pointed at another server that reports this node's id, the script sends it no return proof`, async () => {
        const nodeId = (await json('/.well-known/aimeat')).body.data.node_id as string;
        const keyBefore = readFileSync(keyFile, 'utf-8').trim();
        const lookalike = await startLookalike(nodeId);
        try {
            const r = await start(lookalike.url);
            assert(lookalike.bodies.length === 1, `one device request reached the other server: ${lookalike.bodies.length}; the script said: ${r.out.slice(-800)}`);
            assert(lookalike.bodies[0].proof === undefined, `no proof went to the other server: ${JSON.stringify(lookalike.bodies[0].proof)}`);
            assert(r.out.includes(new URL(BASE).origin), `the script names the node that holds the key: ${r.out.slice(-800)}`);
            assert(readFileSync(keyFile, 'utf-8').trim() === keyBefore, 'the kept key is unchanged');
        } finally {
            await lookalike.close();
        }
    });
}

console.log('\n=== Device-authorization returns from the OpenHands and Dify scripts ===\n');

let strangerToken = '';
await test('Register the owner, and another owner', async () => {
    ownerToken = (await registerOwner(BASE, owner)).token;
    strangerToken = (await registerOwner(BASE, `${owner}x`)).token;
});

console.log('\nOpenHands: tools/aimeat-openhands/scripts/aimeat-connect.sh');
{
    const agent = 'oh-return';
    const secrets = join(tmpRoot, 'openhands', 'secrets', 'aimeat.env');
    const keyFile = join(dirname(secrets), `${agent}@${owner}.key`);
    const bash = bashPath();
    await test('Git bash is available to run the script', async () => {
        assert(!!bash, 'no bash.exe next to git.exe on PATH');
    });
    if (bash) {
        await enrolThenReturn('openhands', agent,
            () => run(bash, [OPENHANDS_SCRIPT], { AIMEAT_BASE_URL: BASE, AIMEAT_OWNER: owner, AIMEAT_AGENT_NAME: agent, AIMEAT_SECRETS_FILE: secrets }),
            keyFile,
            () => writeFileSync(secrets, readFileSync(secrets, 'utf-8').replace(/^AIMEAT_AGENT_TOKEN=.*$/m, 'AIMEAT_AGENT_TOKEN=aaa.bbb.ccc'), 'utf-8'),
            // The default scope "*" is asked for as itself, not glob-expanded into file names.
            (row) => assert(JSON.stringify(row.requested_scopes) === '["*"]', `requested scopes: ${JSON.stringify(row.requested_scopes)}`));
        await noProofElsewhere('openhands', (url) => run(bash, [OPENHANDS_SCRIPT], {
            AIMEAT_BASE_URL: url, AIMEAT_OWNER: owner, AIMEAT_AGENT_NAME: agent, AIMEAT_SECRETS_FILE: secrets,
        }), keyFile);
    }
}

console.log('\nDify: aimeat/tools/dify-bridge/src/connect-onboard.ts');
{
    const agent = 'dify-return';
    const home = join(tmpRoot, 'dify');
    mkdirSync(home, { recursive: true });
    const keyFile = join(home, `${agent}@${owner}.key`);
    const tokenFile = join(home, `${agent}@${owner}.token`);
    await enrolThenReturn('dify', agent,
        () => run(process.execPath, ['--import', 'tsx', DIFY_SCRIPT], {
            AIMEAT_BASE_URL: BASE, OWNER: owner, AGENT_NAME: agent, AIMEAT_DIFY_HOME: home, POLL_TIMEOUT_SEC: '90',
        }),
        keyFile,
        () => writeFileSync(tokenFile, 'aaa.bbb.ccc', 'utf-8'));
    await noProofElsewhere('dify', (url) => run(process.execPath, ['--import', 'tsx', DIFY_SCRIPT], {
        AIMEAT_BASE_URL: url, OWNER: owner, AGENT_NAME: agent, AIMEAT_DIFY_HOME: home, POLL_TIMEOUT_SEC: '10',
    }), keyFile);
}

try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* a handle may still be closing */ }

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
