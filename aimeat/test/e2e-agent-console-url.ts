/**
 * @file test/e2e-agent-console-url.ts
 * @description Where an agent's HOST manages it: PATCH /v1/agents/:name/console-url.
 *
 *   Two things are worth proving here. One is the ordinary path: a sibling agent under the same
 *   owner can report the address, because the sibling that created an agent in a hatchery is the
 *   only party that knows it, and an owner-only gate would have made the field useless for the case
 *   it exists for.
 *
 *   The other is the scheme check. This value is rendered as a link the owner clicks, in their own
 *   authenticated session, and it arrives from a principal rather than from the node. `javascript:`
 *   is a URL that parses. If it could be stored, an agent could put script in its owner's hands.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-console-url
 * @version-history
 *   v1.0.0 — 2026-08-13 — Initial, with the field itself.
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, message: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');
}

async function setupOwner(label: string) {
    const owner = `acon${label}${Date.now()}`;
    let r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: 'ConsoleUrl12345' }) });
    for (let i = 0; r.status === 429 && i < 8; i++) {
        await new Promise(res => setTimeout(res, 1500));
        r = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: owner, display_name: 'T', password: 'ConsoleUrl12345' }) });
    }
    assert(r.status === 201, `ghii ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner, timestamp: ts, signature: await sign(r.body.data.private_key, owner + NODE_ID + ts) }),
    });
    return { owner, ownerToken: tok.body.data.token as string };
}

async function addAgent(owner: string, ownerToken: string, name: string) {
    const ag = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name, owner, capabilities: [], mode: 'interactive', scopes: ['*'] }),
    });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body?.error)}`);
    const gaii = ag.body.data.agent.gaii as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii, timestamp: ts, signature: await sign(ag.body.data.private_key, gaii + ts) }),
    });
    return { name, gaii, token: tok.body.data.token as string };
}

console.log('\n=== Agent console address ===\n');

async function run() {
    const a = await setupOwner('a');
    const b = await setupOwner('b');
    const authA = { Authorization: `Bearer ${a.ownerToken}` };
    const authB = { Authorization: `Bearer ${b.ownerToken}` };

    const newsbot = await addAgent(a.owner, a.ownerToken, 'newsbot');
    const concierge = await addAgent(a.owner, a.ownerToken, 'concierge');
    await addAgent(b.owner, b.ownerToken, 'stranger');

    const CONSOLE = 'https://hatchery.example.com/agents/newsbot/settings';

    await test('a same-owner SIBLING can report where the agent it created is hosted', async () => {
        const { status, body } = await json(`/v1/agents/${newsbot.name}/console-url`, {
            method: 'PATCH', headers: { Authorization: `Bearer ${concierge.token}` },
            body: JSON.stringify({ console_url: CONSOLE }),
        });
        assert(status === 200, `status ${status}: ${JSON.stringify(body?.error)}`);
        assert(body.data.console_url === CONSOLE, `stored ${body.data.console_url}`);
    });

    await test('the owner sees it on the agent list, so the profile can link to it', async () => {
        const { body } = await json('/v1/agents', { headers: authA });
        const rec = (body.data.agents ?? []).find((x: any) => x.name === newsbot.name);
        assert(!!rec, 'agent present in the list');
        assert(rec.console_url === CONSOLE, `expected the console url on the list row, got ${rec.console_url}`);
    });

    await test('a javascript: URL is refused — this is a link the owner clicks', async () => {
        const { status, body } = await json(`/v1/agents/${newsbot.name}/console-url`, {
            method: 'PATCH', headers: authA,
            body: JSON.stringify({ console_url: 'javascript:alert(document.cookie)' }),
        });
        assert(status === 400, `expected 400, got ${status}`);
        assert(body.error?.code === 'INVALID_INPUT', `expected INVALID_INPUT, got ${body.error?.code}`);

        // And the refusal left the good value alone.
        const list = await json('/v1/agents', { headers: authA });
        const rec = (list.body.data.agents ?? []).find((x: any) => x.name === newsbot.name);
        assert(rec.console_url === CONSOLE, 'a refused write must not overwrite what was there');
    });

    await test('a value that is not a URL at all is refused', async () => {
        const { status } = await json(`/v1/agents/${newsbot.name}/console-url`, {
            method: 'PATCH', headers: authA,
            body: JSON.stringify({ console_url: 'hatchery.example.com/newsbot' }),
        });
        assert(status === 400, `expected 400 for a relative address, got ${status}`);
    });

    await test('another owner cannot touch it', async () => {
        const { status } = await json(`/v1/agents/${newsbot.name}/console-url`, {
            method: 'PATCH', headers: authB,
            body: JSON.stringify({ console_url: 'https://evil.example.com/' }),
        });
        // The GAII is built under the CALLER's owner, so owner B names an agent that does not exist.
        assert(status === 404 || status === 403, `expected 404/403, got ${status}`);
        const list = await json('/v1/agents', { headers: authA });
        const rec = (list.body.data.agents ?? []).find((x: any) => x.name === newsbot.name);
        assert(rec.console_url === CONSOLE, 'cross-owner write must change nothing');
    });

    await test('an empty string clears it (a host that went away says so)', async () => {
        const { status, body } = await json(`/v1/agents/${newsbot.name}/console-url`, {
            method: 'PATCH', headers: authA, body: JSON.stringify({ console_url: '' }),
        });
        assert(status === 200, `status ${status}`);
        assert(body.data.console_url === null, `expected null, got ${body.data.console_url}`);
    });

    console.log('\nCleanup');
    await test('cascade-delete both owners', async () => {
        const r1 = await json(`/v1/owners/${encodeURIComponent(a.owner)}`, { method: 'DELETE', headers: authA });
        const r2 = await json(`/v1/owners/${encodeURIComponent(b.owner)}`, { method: 'DELETE', headers: authB });
        assert(r1.status === 200 && r2.status === 200, `delete ${r1.status}/${r2.status}`);
    });
}

await run();

console.log(`\n${'='.repeat(50)}`);
console.log(`Agent console address E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
