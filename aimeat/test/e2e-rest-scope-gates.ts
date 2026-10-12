/**
 * @file e2e-rest-scope-gates.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The REST routes that asked no scope word until node 4.0.0, on a running node of
 *   either release (auth/rest-scope-gate.ts; Core 2026-11 AUTHZ-01, ruling Q21).
 *
 *   On 3.x a call without the word still works, so this suite asserts what 3.x promises: the call
 *   answers with `Deprecation: true` and `X-AIMEAT-Removed-In: 4.0.0`, it is counted per word in
 *   GET /v1/stats, an agent holding the word and the owner in person get no such header, and an agent
 *   acting on its own record (queueing work for itself) needs no word at all. On a node at 4.0.0
 *   (a loopback test node run with AIMEAT_TEST_SOFTWARE_VERSION, helpers/node-release.ts) the same
 *   call without the word is refused with 403 SCOPE_DENIED and counted nowhere, and the other
 *   assertions hold as on 3.x. test/unit/rest-scope-gates.test.ts proves both halves in code.
 *
 *   Failure modes asserted: an agent without the word is marked on every family tried (skills,
 *   installs, the v2 task roster, organism invitations, another agent's task queue); an agent made
 *   after the node's one-time grant does not get packages:read by itself.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-rest-scope-gates
 * @version-history
 *   v1.1.0 — 2026-10-12 — Asks the node which release it runs: the 3.x acceptance on 3.x, the 403
 *     SCOPE_DENIED on 4.0.0 (the 4.0.0 sweep).
 *   v1.0.0 — 2026-10-12 — Initial (wish-rest-reitit-ilman-scope-tarkistusta-agentti-p-see-kaikkeen).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { removedOn } from './helpers/node-release.js';
import { REST_SCOPE_GATES_ENFORCED_IN } from '../src/utils/rest-scope-release.js';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: unknown) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

interface Reply { status: number; body: any; headers: Headers }
async function call(path: string, opts: RequestInit = {}): Promise<Reply> {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() : { _raw: await res.text() };
    return { status: res.status, body, headers: res.headers };
}
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function sign(privB64: string, message: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');
}

const owner = `restscope${Date.now().toString(36)}`;
const PASSWORD = 'RestScopeGate12345';

async function signUpOwner(): Promise<string> {
    let r = await call('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'Scope', password: PASSWORD }) });
    for (let i = 0; r.status === 429 && i < 8; i++) {
        await new Promise(res => setTimeout(res, 1500));
        r = await call('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'Scope', password: PASSWORD }) });
    }
    assert(r.status === 201, `register ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const login = await call('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: owner, password: PASSWORD }) });
    assert(login.body?.ok === true, `sign in: ${JSON.stringify(login.body?.error)}`);
    return login.body.data.token as string;
}

async function addAgent(ownerToken: string, name: string, scopes: string[]): Promise<{ gaii: string; token: string }> {
    const ag = await call('/v1/agents', {
        method: 'POST', headers: auth(ownerToken),
        body: JSON.stringify({ name, owner, capabilities: [], scopes }),
    });
    assert(ag.status === 201, `agent ${name} ${ag.status}: ${JSON.stringify(ag.body?.error)}`);
    const gaii = ag.body.data.agent.gaii as string;
    const ts = new Date().toISOString();
    const tok = await call('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii, timestamp: ts, signature: await sign(ag.body.data.private_key, gaii + ts) }),
    });
    assert(tok.body?.ok === true, `agent token ${name}: ${JSON.stringify(tok.body?.error)}`);
    return { gaii, token: tok.body.data.token as string };
}

function deprecated(r: Reply): boolean {
    return r.headers.get('deprecation') === 'true' && r.headers.get('x-aimeat-removed-in') === '4.0.0';
}

async function missingCount(word: string): Promise<number> {
    const r = await call('/v1/stats');
    return Number(r.body?.data?.deprecated_use_by_type?.[`rest_scope_missing:${word}`] ?? r.body?.deprecated_use_by_type?.[`rest_scope_missing:${word}`] ?? 0);
}

/**
 * A call without the word: on 3.x allowed, marked deprecated and counted once; from 4.0.0 refused with
 * 403 SCOPE_DENIED and not counted as a deprecated use.
 */
async function assertMissingWord(r: Reply, word: string, before: number, enforced: boolean): Promise<void> {
    const after = await missingCount(word);
    if (enforced) {
        assert(r.status === 403 && r.body?.error?.code === 'SCOPE_DENIED', `on 4.0.0 expected 403 SCOPE_DENIED, got ${r.status} ${JSON.stringify(r.body?.error)}`);
        assert(after === before, `a refused call is not a deprecated use: rest_scope_missing:${word} went from ${before} to ${after}`);
        return;
    }
    assert(r.status !== 403, `refused on 3.x: ${r.status} ${JSON.stringify(r.body?.error)}`);
    assert(deprecated(r), `no Deprecation headers: ${r.headers.get('deprecation')} ${r.headers.get('x-aimeat-removed-in')}`);
    assert(after === before + 1, `rest_scope_missing:${word} went from ${before} to ${after}`);
}

async function main(): Promise<void> {
    const enforced = await removedOn(BASE, REST_SCOPE_GATES_ENFORCED_IN);
    console.log(enforced
        ? '\n=== REST scope gates on a 4.0.0 node: refused without the word ===\n'
        : '\n=== REST scope gates on a 3.x node: allowed, marked deprecated, counted ===\n');

    const ownerToken = await signUpOwner();
    // `narrow` holds nothing any of the routes below ask; `wide` holds every word they ask.
    const narrow = await addAgent(ownerToken, 'narrow', ['memory:delete']);
    const wide = await addAgent(ownerToken, 'wide', ['memory:read', 'packages:read', 'task:read', 'task:write', 'organism:read']);

    const reads: Array<[string, string]> = [
        ['/v1/skills', 'memory:read'],
        ['/v1/instances', 'packages:read'],
        ['/v1/agents/v2/tasks', 'task:read'],
        ['/v1/organisms/invitations/mine', 'organism:read'],
    ];

    for (const [path, word] of reads) {
        await test(enforced
            ? `GET ${path}: an agent without ${word} is refused with 403 SCOPE_DENIED (4.0.0)`
            : `GET ${path}: an agent without ${word} is let through, marked deprecated and counted`, async () => {
            const before = await missingCount(word);
            const r = await call(path, { headers: auth(narrow.token) });
            await assertMissingWord(r, word, before, enforced);
        });

        await test(`GET ${path}: an agent with ${word} and the owner get no Deprecation header`, async () => {
            const withWord = await call(path, { headers: auth(wide.token) });
            assert(withWord.status !== 403 && !deprecated(withWord), `agent with ${word}: ${withWord.status} ${withWord.headers.get('deprecation')}`);
            const asOwner = await call(path, { headers: auth(ownerToken) });
            assert(asOwner.status !== 403 && !deprecated(asOwner), `owner: ${asOwner.status} ${asOwner.headers.get('deprecation')}`);
        });
    }

    const taskBody = JSON.stringify({ title: 'Scope gate probe', description: 'A task made by the scope gate suite.' });

    await test('an agent queueing work for itself needs no task:write and gets no Deprecation header', async () => {
        const r = await call('/v1/agents/narrow/tasks', { method: 'POST', headers: auth(narrow.token), body: taskBody });
        assert(r.status !== 403, `refused: ${r.status} ${JSON.stringify(r.body?.error)}`);
        assert(!deprecated(r), 'its own queue is not a deprecated call');
    });

    await test(enforced
        ? 'an agent queueing work for another agent without task:write is refused with 403 SCOPE_DENIED (4.0.0)'
        : 'an agent queueing work for another agent without task:write is marked deprecated', async () => {
        const before = await missingCount('task:write');
        const r = await call('/v1/agents/wide/tasks', { method: 'POST', headers: auth(narrow.token), body: taskBody });
        await assertMissingWord(r, 'task:write', before, enforced);
    });

    await test('with task:write the same call carries no Deprecation header', async () => {
        const r = await call('/v1/agents/narrow/tasks', { method: 'POST', headers: auth(wide.token), body: taskBody });
        assert(r.status !== 403 && !deprecated(r), `${r.status} ${r.headers.get('deprecation')}`);
    });

    await test('an agent made after the node ran its one-time grant does not hold packages:read', async () => {
        const r = await call('/v1/agents', { headers: auth(ownerToken) });
        assert(r.status === 200, `list agents: ${r.status}`);
        const list = (r.body.data.agents ?? r.body.data) as Array<Record<string, unknown>>;
        const row = list.find(a => a.gaii === narrow.gaii || a.name === 'narrow');
        assert(!!row, `agent narrow not listed: ${JSON.stringify(r.body.data).slice(0, 200)}`);
        const scopes = (row!.default_scopes ?? row!.defaultScopes ?? row!.scopes ?? []) as string[];
        assert(Array.isArray(scopes) && scopes.includes('memory:delete'), `scopes not read: ${JSON.stringify(row).slice(0, 300)}`);
        assert(!scopes.includes('packages:read'), `the grant reached a new agent: ${scopes.join(', ')}`);
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
