/**
 * @file test/e2e-consent-publish-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A consent whose recipient is `*` reaches the anonymous reader, so it meets the same
 *   gate a raise to public meets (services/publish-gate.ts).
 *
 *   WHY THIS SUITE EXISTS. grantConsent checked `consent:manage` and nothing else. That word is
 *   inside every wildcard scope, while `publish:public` is deliberately outside all of them, so an
 *   agent on Full access could make its private records world-readable through the consent route
 *   although the write route would have kept them private and asked the owner (secaudit 2026-10,
 *   grantConsent:wildcard-recipient-skips-publish-gate). The contrast can only be seen on a node
 *   whose gate is on, so this suite starts one with AIMEAT_PUBLISH_GATE=agents.
 *
 *   WHAT IS PROVEN. The control first: the same agent's public memory write is kept private and
 *   files a request, which is what "the gate is on" means here. Then the consent: the `*` consent
 *   is refused with PUBLISH_REQUESTED, the record stays unreadable to an anonymous caller, a request
 *   of kind `consent` waits on the owner's list, and the owner's approval grants the consent and
 *   opens the read. And the positive path that must not change: the owner in person grants a `*`
 *   consent on their own record and it is active at once.
 * @structure
 *   - Phase 1 the node, the owner and the scoped agent
 *   - Phase 2 the control: a public memory write by the same agent is held and asked about
 *   - Phase 3 the `*` consent is held and asked about, and nothing is opened
 *   - Phase 4 the owner's approval grants it; the owner in person is unchanged
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-consent-publish-gate
 * @version-history
 *   2026-10-24 — Phase 3b: a 'domain:*' consent admits a signed-in owner of this node and never the
 *     anonymous reader (secaudit2026oct22, domain-recipient-matches-anonymous-reader).
 *   2026-10-20 — Initial (secaudit 2026-10, grantConsent:wildcard-recipient-skips-publish-gate).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { ownerSignIn } from './helpers/owner-login.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const PORT = process.env.E2E_CONSENT_GATE_PORT ?? '28493';
const BASE = `http://localhost:${PORT}`;
const NODE_ID = 'aimeat-local-001-dev';
const DB_PATH = resolve(process.cwd(), 'test/.test-consent-publish-gate.db');
const STAMP = Date.now().toString(36).slice(-6);

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const short = (v: unknown): string => String(JSON.stringify(v) ?? v).slice(0, 300);
const bearer = (t: string): Record<string, string> => ({ Authorization: `Bearer ${t}` });

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = res.status === 204 ? null : ct.includes('json') ? await res.json() : { _raw: await res.text() };
    return { status: res.status, body };
}

const sign = async (privB64: string, message: string): Promise<string> =>
    Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');

function cleanupDb(): void {
    for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
        try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ }
    }
}

async function startServer(): Promise<ChildProcess> {
    cleanupDb();
    const db = await ownNodeDb('consent-publish-gate', { sqlitePath: DB_PATH });
    const env = {
        ...process.env, ...db.env,
        AIMEAT_PORT: PORT, AIMEAT_BASE_URL: BASE, AIMEAT_NODE_ID: NODE_ID,
        AIMEAT_PUBLISH_GATE: 'agents',
        // ON, because `*` means the anonymous reader and this suite reads as one: with it off every
        // unauthenticated read is 401 before any consent is consulted, which proves nothing here.
        AIMEAT_ANONYMOUS_MODE: 'true',
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000', AIMEAT_RL_MEMORY: '1000', AIMEAT_RL_GHII: '1000',
    };
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...db.args], { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    return waitForServer(child, BASE, { label: 'the consent publish-gate node' });
}

console.log('\n=== A consent to everyone meets the publish gate ===\n');
console.log('Phase 1 — the node, the owner and the scoped agent');

const server = await startServer();

const ownerName = `cpg${STAMP}`;
const ownerGhii = `${ownerName}@${NODE_ID}`;
let ownerToken = '';
let agentGaii = '';
let agentToken = '';
let requestId = '';
const AGENT_KEY = 'cpg.secret';
const OWNER_KEY = 'cpgowner.secret';
const DOMAIN_KEY = 'cpgdom.secret';

await test('the owner and an agent holding consent:manage but not publish:public', async () => {
    const reg = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: ownerName, display_name: 'Consent Gate', password: 'CpGate1234' }),
    });
    assert(reg.status === 201, `register ${reg.status}: ${short(reg.body)}`);
    const tok = await ownerSignIn(BASE, ownerName, 'CpGate1234');
    assert(tok.status === 200 && tok.body.data?.token, `owner token ${tok.status}: ${short(tok.body)}`);
    ownerToken = tok.body.data.token as string;

    const agent = await json('/v1/agents', {
        method: 'POST', headers: bearer(ownerToken),
        body: JSON.stringify({
            name: 'cpgagent', owner: ownerName, model: 'gpt-4o',
            scopes: ['memory:read', 'memory:write', 'consent:manage'],
        }),
    });
    assert(agent.status === 201, `agent ${agent.status}: ${short(agent.body)}`);
    agentGaii = agent.body.data.agent.gaii as string;
    const scopes = agent.body.data.agent.scopes ?? agent.body.data.agent.default_scopes ?? [];
    assert(!scopes.includes('publish:public'), `the agent must not hold publish:public: ${short(scopes)}`);
    const ts = new Date().toISOString();
    const at = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentGaii, timestamp: ts, signature: await sign(agent.body.data.private_key, agentGaii + ts) }),
    });
    assert(at.status === 200 && at.body.data?.token, `agent token ${at.status}: ${short(at.body)}`);
    agentToken = at.body.data.token as string;
});

console.log('\nPhase 2 — the control: the gate is on for this agent');

await test('a public memory write by the agent is kept private and files a request', async () => {
    const w = await json('/v1/memory', {
        method: 'POST', headers: bearer(agentToken),
        body: JSON.stringify({ key: 'cpg.control', value: { note: 'control' }, visibility: 'public' }),
    });
    assert(w.status === 202, `a held public write answers 202: ${w.status}: ${short(w.body)}`);
    assert(w.body.data?.publish_request?.status === 'awaiting_owner',
        `the gate is off on this node: no waiting publish_request on a public write: ${short(w.body.data)}`);
    assert(w.body.data?.visibility === 'private', `the record was stored as ${w.body.data?.visibility}, not private`);
});

console.log('\nPhase 3 — the `*` consent is held, and nothing is opened');

await test('the agent writes a private record of its own', async () => {
    const w = await json('/v1/memory', {
        method: 'POST', headers: bearer(agentToken),
        body: JSON.stringify({ key: AGENT_KEY, value: { note: 'the agent\'s own private record' }, visibility: 'private' }),
    });
    assert(w.status === 201, `write ${w.status}: ${short(w.body)}`);
    const anon = await json(`/v1/memory/${encodeURIComponent(agentGaii)}/${encodeURIComponent(AGENT_KEY)}`);
    assert(anon.status !== 200, `a private record was readable before any consent: ${anon.status} ${short(anon.body)}`);
});

await test('POST /v1/consent with recipient "*" is refused with PUBLISH_REQUESTED, and nothing is granted', async () => {
    const r = await json('/v1/consent', {
        method: 'POST', headers: bearer(agentToken),
        body: JSON.stringify({ data_pattern: 'cpg.*', recipient: '*', purpose: 'open it to anyone' }),
    });
    assert(r.status === 403, `expected 403, got ${r.status}: ${short(r.body)}`);
    assert(r.body.error?.code === 'PUBLISH_REQUESTED', `code: ${short(r.body.error)}`);
    const list = await json('/v1/consent', { headers: bearer(ownerToken) });
    assert(!(list.body.data?.consents ?? []).some((c: any) => c.recipient === '*'),
        `a consent to everyone was stored anyway: ${short(list.body.data?.consents)}`);
});

await test('the agent\'s private record is still unreadable to an anonymous caller', async () => {
    const anon = await json(`/v1/memory/${encodeURIComponent(agentGaii)}/${encodeURIComponent(AGENT_KEY)}`);
    assert(anon.status !== 200, `the refused consent opened the record anyway: ${anon.status} ${short(anon.body)}`);
});

await test('the owner has a waiting request of kind "consent" naming the pattern', async () => {
    const r = await json('/v1/publish-requests', { headers: bearer(ownerToken) });
    assert(r.status === 200, `publish requests ${r.status}: ${short(r.body)}`);
    const found = (r.body.data?.requests ?? []).find((q: any) => q.kind === 'consent');
    assert(found?.kind === 'consent', `no consent request on the owner's list: ${short(r.body.data?.requests)}`);
    assert(found.state === 'awaiting_owner', `state: ${found.state}`);
    assert(found.name === 'cpg.*', `name: ${found.name}`);
    assert(found.requested_by?.principal === agentGaii, `requested_by: ${short(found.requested_by)}`);
    requestId = found.id as string;
});

console.log('\nPhase 3b — a "domain:*" consent reaches signed-in principals, never the anonymous reader');

await test('a "domain:*" consent on the agent\'s record admits a signed-in owner and not the anonymous reader', async () => {
    const w = await json('/v1/memory', {
        method: 'POST', headers: bearer(agentToken),
        body: JSON.stringify({ key: DOMAIN_KEY, value: { note: 'the agent\'s record for every node' }, visibility: 'private' }),
    });
    assert(w.status === 201, `write ${w.status}: ${short(w.body)}`);
    const r = await json('/v1/consent', {
        method: 'POST', headers: bearer(agentToken),
        body: JSON.stringify({ data_pattern: 'cpgdom.*', recipient: 'domain:*', purpose: 'principals of any node' }),
    });
    assert(r.status === 201, `a "domain:*" consent is not a publish and needs no approval: ${r.status}: ${short(r.body)}`);

    const reader = `cpgr${STAMP}`;
    const reg = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: reader, display_name: 'Consent Reader', password: 'CpGate1234' }),
    });
    assert(reg.status === 201, `register the reader ${reg.status}: ${short(reg.body)}`);
    const tok = await ownerSignIn(BASE, reader, 'CpGate1234');
    assert(tok.status === 200 && tok.body.data?.token, `reader token ${tok.status}: ${short(tok.body)}`);
    const path = `/v1/memory/${encodeURIComponent(agentGaii)}/${encodeURIComponent(DOMAIN_KEY)}`;
    const signedIn = await json(path, { headers: bearer(tok.body.data.token as string) });
    assert(signedIn.status === 200 && signedIn.body.data?.value?.note === 'the agent\'s record for every node',
        `a signed-in owner of this node did not read through "domain:*": ${signedIn.status} ${short(signedIn.body)}`);

    const anon = await json(path);
    assert(anon.status !== 200, `"domain:*" opened the record to the anonymous reader: ${anon.status} ${short(anon.body)}`);
});

console.log('\nPhase 4 — the owner decides, and the owner in person is unchanged');

await test('the owner in person grants a "*" consent on their own record, and it opens at once', async () => {
    const w = await json('/v1/memory', {
        method: 'POST', headers: bearer(ownerToken),
        body: JSON.stringify({ key: OWNER_KEY, value: { note: 'the owner\'s own record' }, visibility: 'private' }),
    });
    assert(w.status === 201, `owner write ${w.status}: ${short(w.body)}`);
    const before = await json(`/v1/memory/${encodeURIComponent(ownerGhii)}/${encodeURIComponent(OWNER_KEY)}`);
    assert(before.status !== 200, `readable before the consent: ${before.status}`);

    const r = await json('/v1/consent', {
        method: 'POST', headers: bearer(ownerToken),
        body: JSON.stringify({ data_pattern: 'cpgowner.*', recipient: '*', purpose: 'my own decision' }),
    });
    assert(r.status === 201, `the owner in person was refused: ${r.status}: ${short(r.body)}`);
    assert(r.body.data?.status === 'active', `status: ${short(r.body.data)}`);
    const after = await json(`/v1/memory/${encodeURIComponent(ownerGhii)}/${encodeURIComponent(OWNER_KEY)}`);
    assert(after.status === 200, `the owner's own consent did not open the read: ${after.status} ${short(after.body)}`);
});

await test('approving the request grants the consent the agent asked for, and the read opens', async () => {
    const d = await json(`/v1/publish-requests/${requestId}/decision`, {
        method: 'POST', headers: bearer(ownerToken), body: JSON.stringify({ decision: 'approve' }),
    });
    assert(d.status === 200, `decision ${d.status}: ${short(d.body)}`);
    assert(d.body.data?.request?.state === 'approved', `state: ${short(d.body.data?.request)}`);
    const anon = await json(`/v1/memory/${encodeURIComponent(agentGaii)}/${encodeURIComponent(AGENT_KEY)}`);
    assert(anon.status === 200, `the approved consent did not open the read: ${anon.status} ${short(anon.body)}`);
    assert(anon.body.data?.value?.note === 'the agent\'s own private record', `value: ${short(anon.body.data?.value)}`);
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
server.kill();
await new Promise<void>(r => setTimeout(r, 300));
cleanupDb();
process.exit(failed > 0 ? 1 : 0);
