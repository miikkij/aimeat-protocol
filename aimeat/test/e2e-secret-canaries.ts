/**
 * @file e2e-secret-canaries.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Secret canaries: a known credential is stored through its own route, and then every
 *   read route in the list is called as the owner and as an agent of the owner, and the WHOLE answer
 *   is searched for the value, for its ciphertext and for a stretch of ciphertext. A route that
 *   carries a credential along fails here whatever field it put it in.
 *
 *   Written for the secrets audit of 2026-10-09. What failed on the code before the fixes:
 *     - finding 1.1: GET /v1/discover?scope=own built an entry's description from the raw record, so
 *       the whole ciphertext of the owner's AI key came back to the owner and to every agent or app
 *       with memory:read;
 *     - finding 1.1: a workflow extension step's `input_from` could name a credential record, and the
 *       engine handed its value to extension code.
 *   The other confirmed findings have their regression tests in the suite that owns the route:
 *   e2e-app-access-code (1.5), e2e-workspace-public-sharing 14b (1.7), e2e-ext-hardening 3b (1.1),
 *   e2e-admin-setup-closed (1.4), e2e-device-token-grace (1.3), e2e-magic-link-refusal (S2).
 *
 *   ADDING A ROUTE. A new route that reads owner data belongs in READ_ROUTES below. The list is the
 *   statement of where a credential must never appear.
 *
 *   The node for this suite starts with the admin setup route closed after the first operator
 *   (ADMIN_SETUP_CLOSED_SUITES in run-e2e-server.ts), the production setting; this suite never calls it.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-secret-canaries
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const STAMP = Date.now() % 1000000;

const AI_KEY = `sk-or-canary-${STAMP}-owner-key-7f3e`;
const STRIPE_KEY = `sk_test_canary_${STAMP}_c41d`;
const STRIPE_HOOK = `whsec_canary_${STAMP}_9b2a`;
const CANARIES = [AI_KEY, STRIPE_KEY, STRIPE_HOOK];

let passed = 0, failed = 0;
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
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

async function setupOwner(label: string) {
    const name = `can${label}${STAMP}`;
    const reg0 = () => json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Canary', password: 'CanaryTest12345' }) });
    let reg = await reg0();
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await reg0(); }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }),
    });
    assert(tok.body?.ok === true, `token: ${JSON.stringify(tok.body?.error)}`);
    return { name, token: tok.body.data.token as string };
}

/** Device-auth (RFC 8628): an agent token for `owner` carrying exactly `scopes`. */
async function agentToken(owner: { name: string; token: string }, agentName: string, scopes: string[]): Promise<string> {
    const da = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: agentName, owner: owner.name }) });
    assert(da.status === 200, `device-authorize ${da.status}`);
    const ok = await json('/v1/agents/verify', {
        method: 'POST', body: JSON.stringify({ user_code: da.body.data.user_code, action: 'approve', scopes, owner_token: owner.token }),
    });
    assert(ok.status === 200, `approve ${ok.status} ${JSON.stringify(ok.body?.error)}`);
    const poll = await json('/v1/agents/device-token', {
        method: 'POST', body: JSON.stringify({ device_code: da.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    assert(poll.status === 200 && typeof poll.body?.token === 'string', `device-token ${poll.status}`);
    return poll.body.token as string;
}

/** The whole answer, searched: the value, a ciphertext field, and a stretch of AES-GCM ciphertext. */
function noCredential(where: string, body: unknown) {
    const text = JSON.stringify(body);
    for (const c of CANARIES) assert(!text.includes(c), `${where} returned a credential in the clear`);
    assert(!text.includes('"encrypted"'), `${where} returned a credential's ciphertext field: ${text.slice(0, 240)}`);
    // iv:authTag in hex (services/encryption.ts), with or without the bound form's prefix.
    assert(!/[0-9a-f]{24}:[0-9a-f]{32}/.test(text), `${where} returned a stretch of ciphertext: ${text.slice(0, 240)}`);
}

/** The read routes where a credential must never appear, for the owner and for an agent. */
const READ_ROUTES: string[] = [
    '/v1/discover?scope=own',
    '/v1/discover?scope=own&q=apikey',
    '/v1/discover?scope=own&q=openrouter',
    '/v1/discover?scope=own&q=psp',
    '/v1/memory?limit=500',
    '/v1/memory/openrouter.apikey',
    '/v1/memory/commerce.psp',
    '/v1/memory/search?q=apikey',
    '/v1/memory/export',
    '/v1/librarian/search?q=apikey',
];

async function main() {
    console.log('\n=== Secret canaries (secrets audit 2026-10-09) ===\n');
    const owner = await setupOwner('o');
    let agent = '';

    await test('setup: the owner stores an AI key and Stripe secrets through their own routes, and connects an agent', async () => {
        const ai = await json('/v1/openrouter/settings', { method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ apiKey: AI_KEY }) });
        assert(ai.status === 200, `AI key: ${ai.status} ${JSON.stringify(ai.body?.error)}`);
        const st = await json('/v1/commerce/payout/stripe', {
            method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ secret_key: STRIPE_KEY, webhook_secret: STRIPE_HOOK }),
        });
        assert(st.status === 200, `Stripe: ${st.status} ${JSON.stringify(st.body?.error)}`);
        agent = await agentToken(owner, `canreader${STAMP}`, ['memory:read']);
    });

    for (const path of READ_ROUTES) {
        await test(`${path} carries no credential, to the owner or to an agent with memory:read`, async () => {
            for (const [who, token] of [['owner', owner.token], ['agent', agent]] as const) {
                const r = await json(path, { headers: auth(token) });
                noCredential(`${path} (${who}, ${r.status})`, r.body);
            }
        });
    }

    await test('an agent without memory:read is refused the credential record, and gets no value', async () => {
        const outsider = await agentToken(owner, `cannoread${STAMP}`, ['social:read']);
        const r = await json('/v1/memory/openrouter.apikey', { headers: auth(outsider) });
        assert(r.status === 403 || r.status === 401, `expected a refusal, got ${r.status}`);
        noCredential(`/v1/memory/openrouter.apikey (agent without memory:read, ${r.status})`, r.body);
    });

    await test('discover still lists the credential record, as configured', async () => {
        // The mask must not hide the fact: the owner sees that a key is set.
        const r = await json('/v1/discover?scope=own&q=openrouter', { headers: auth(owner.token) });
        assert(r.status === 200, `discover ${r.status}`);
    });

    await test('a workflow step cannot name a credential record as input_from', async () => {
        // An extension of the owner's own, so the save is judged on the key and not on a missing name.
        const ext = `canext${STAMP}`;
        const inst = await json('/v1/extensions', {
            method: 'POST', headers: auth(owner.token),
            body: JSON.stringify({
                manifest: JSON.stringify({
                    metadata: { name: ext, version: '1.0.0', description: 'canary e2e', author: 'e2e' },
                    actions: [{ id: 'echo', method: 'POST', path: '/echo', script: 'echo' }],
                    limits: { timeout_ms: 5000, max_api_calls: 1 },
                }),
                scripts: { echo: 'export default async function(ctx, input){ return { got: input }; }' },
            }),
        });
        assert(inst.status === 201, `install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
        const wf = `canwf${STAMP}`;
        const def = {
            title: { en_US: 'Canary' }, description: { en_US: 'input_from credential' },
            trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect',
            steps: [{
                id: 'act', description: { en_US: 'Act' }, required_to_function: 'none',
                action: { kind: 'extension', extension: ext, action: 'echo', input: {},
                          input_from: { key: 'openrouter.apikey' }, result_to_key: `can.${STAMP}.out` },
            }],
        };
        const put = await json(`/v1/workflows/${wf}`, { method: 'PUT', headers: auth(owner.token), body: JSON.stringify(def) });
        const text = JSON.stringify(put.body);
        assert(put.status >= 400 && put.status < 500, `the save must be refused, got ${put.status}`);
        assert(text.includes('openrouter.apikey') && /reads to decide what it does/.test(text),
            `refused for the credential key, not for something else: ${text.slice(0, 400)}`);
    });

    console.log(`\n=== Secret canaries: ${passed} passed, ${failed} failed ===\n`);
    if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
