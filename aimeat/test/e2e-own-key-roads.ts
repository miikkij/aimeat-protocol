/**
 * @file test/e2e-own-key-roads.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which key paid, road by road, read where the money is spent.
 *
 *   WHY THIS SUITE EXISTS. Measured on 2026-10-02 on a hosted node with a capped test key read back
 *   at OpenRouter: the owner saved their own key, /v1/chat/status said `has_own_key: true`, and one
 *   chat turn and one agent task both spent the node's key while the owner's key spent nothing. The
 *   chat ran on the shared chat key; the agent's crew used the key in its machine's environment.
 *   This suite proves each road the node decides, the same way the measurement was taken: a
 *   stand-in provider records the Authorization header of every call it receives, so a test reads
 *   which key paid where it is spent, and then the node's own record of the same call.
 *
 *   THE ROADS.
 *   - Node route (a node configured like a hosted place now is: no shared chat key, a place key
 *     and a large free allowance): the chat, a node AI call, an agent's call through /v1/llm, and
 *     an agent's own key. Each with the owner's own key saved: the stand-in sees that key, never
 *     the place key, and the allowance does not move.
 *   - Shared chat key (the operator's special case): the chat process starts with the shared key
 *     and the own key never reaches the chat; the node says so in `own_key`.
 *   - An agent's crew: the node cannot see it, so the proof is that the node says the own key does
 *     not reach it (`own_key.not_covered`), for the owner and for the agent.
 *
 *   WHAT IT CANNOT PROVE. The place key goes only to OpenRouter's own host (ai-allowance.ts
 *   isOpenRouterHost), so it cannot be pointed at a stand-in. Its road is the payer the node names
 *   (`pays: "allowance"`) and the unit tests of resolveAiKey.
 *
 *   It runs its own nodes, like e2e-chat-agent, because the chat's configuration is process-wide.
 *   E2E_OWN_KEY_ROADS_PORT moves the set: the node route on it, the shared-key node one above, the
 *   stand-in provider two above.
 * @usage
 *   cd aimeat && node --import tsx test/e2e-own-key-roads.ts
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=own-key-roads
 * @version-history
 *   v1.2.0 — 2026-10-02 — 1b0: a key saved on its own is served the node's default model
 *     (AIMEAT_MODEL_DEFAULT_CHAT) on the own key, and the free router only when chosen. 1g4: an
 *     agent with no runtime is not listed among the crews; one on its machine's key keeps them
 *     uncovered.
 *   v1.1.0 — 2026-10-02 — The crew model choice guard (UNSAFE_CHOICE on a secret variable, http, a
 *     private or link-local address), the {kind:'node'} choice, and the crews read as covered once
 *     every agent's runtime reports the node road. An agent reports its own road without agent:write
 *     and is refused a sibling's.
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';
import { waitForServer } from './helpers/wait-for-server.js';
import { startFakeAiProvider, type FakeAiProvider, type RecordedRequest } from './helpers/fake-ai-provider.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const PORT = Number(process.env.E2E_OWN_KEY_ROADS_PORT ?? 40350);
const SHARED_PORT = PORT + 1;
const STUB_PORT = PORT + 2;
const NODE_ID = 'aimeat-local-001-dev';
const PEER = pathToFileURL(resolvePath(process.cwd(), 'test/helpers/fake-goose-acp.ts')).href;
const STUB_MODEL = 'stub/own-key-model';
const NODE_DEFAULT_MODEL = 'stub/node-default-model';

// The three keys, each a string no other key contains, so a header names exactly one of them.
const PLACE_KEY = 'sk-or-place-e2e-7f3a91';
const SHARED_CHAT_KEY = 'sk-or-sharedchat-e2e-52c0d4';
const OWN_KEY = 'sk-or-own-e2e-b81e66';
const AGENT_KEY = 'sk-or-agent-e2e-04d9aa';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: boolean, msg: string): void { if (!cond) throw new Error(msg); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── The nodes ────────────────────────────────────────────────────────────────

interface Node { proc: ChildProcess; base: string; dbDir: string; peerLog: string }

async function startNode(port: number, tag: string, sharedChatKey: string): Promise<Node> {
    const dbDir = mkdtempSync(join(tmpdir(), `aimeat-ownkey-${tag}-`));
    const peerLog = join(dbDir, 'peer.jsonl');
    const base = `http://127.0.0.1:${port}`;
    const proc = spawn(process.execPath, [
        'src/index.ts', 'start', '--db', 'sqlite', '--db-path', join(dbDir, 'n.db'), '--port', String(port),
    ], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            // The same NODE_OPTIONS carries the fake agent into the chat child (see e2e-chat-agent).
            NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import tsx --import ${PEER}`.trim(),
            FAKE_GOOSE_LOG: peerLog,
            AIMEAT_GOOSE_ENV_PASSTHROUGH: 'FAKE_GOOSE_LOG',
            AIMEAT_PORT: String(port),
            AIMEAT_BASE_URL: base,
            AIMEAT_NODE_ID: NODE_ID,
            AIMEAT_DB: 'sqlite',
            AIMEAT_DB_PATH: join(dbDir, 'n.db'),
            AIMEAT_ENCRYPTION_KEY: process.env.AIMEAT_ENCRYPTION_KEY
                ?? '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20',
            AIMEAT_DEFAULT_AGENT_SCOPES: '*',
            AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000', AIMEAT_RL_MEMORY: '1000',
            AIMEAT_RL_OPENROUTER: '1000',
            AIMEAT_GOOSE_BIN: process.execPath,
            AIMEAT_GOOSE_PATH_ROOT: dbDir,
            AIMEAT_GOOSE_PROVIDER_API_KEY: sharedChatKey,
            // A node configured as a hosted place is since 2026-10-02 (aimeat-commercial provision.ts).
            AIMEAT_OPENROUTER_INSTANCE_KEY: PLACE_KEY,
            AIMEAT_CHAT_FREE_ALLOWANCE_USD: '1000',
            // The place names a default chat model, as the fleet does for every sold place.
            AIMEAT_MODEL_DEFAULT_CHAT: NODE_DEFAULT_MODEL,
            // The stand-in provider is on loopback.
            AIMEAT_ALLOW_PRIVATE_EGRESS: 'true',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    proc.stdout?.on('data', (c: Buffer) => { output += c.toString(); });
    proc.stderr?.on('data', (c: Buffer) => { output += c.toString(); });
    try {
        await waitForServer(proc, base, { label: `the ${tag} node on port ${port}` });
    } catch (err) {
        console.error(output.slice(-2000));
        throw err;
    }
    return { proc, base, dbDir, peerLog };
}

async function stopNode(node: Node | null): Promise<void> {
    if (!node) return;
    if (node.proc.exitCode === null && !node.proc.killed) {
        node.proc.kill();
        await Promise.race([once(node.proc, 'exit'), sleep(10_000)]);
    }
    try { rmSync(node.dbDir, { recursive: true, force: true }); } catch { /* the OS will get it */ }
}

// ─── Talking to one of them ───────────────────────────────────────────────────

let BASE = '';
let peerLog = '';

async function json(path: string, token: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    let res: Response | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            res = await fetch(`${BASE}${path}`, {
                ...opts,
                headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...((opts.headers ?? {}) as Record<string, string>) },
            });
            break;
        } catch (err) {
            if (attempt === 4) throw err;
            await sleep(500);
        }
    }
    const ct = res!.headers.get('content-type') ?? '';
    return { status: res!.status, body: ct.includes('json') ? await res!.json() : { _raw: await res!.text() } };
}

async function registerOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', '', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body).slice(0, 200)}`);
    const timestamp = new Date().toISOString();
    const sig = await ed.signAsync(new TextEncoder().encode(name + NODE_ID + timestamp), Buffer.from(reg.body.data.private_key, 'base64'));
    const tok = await json('/v1/auth/token', '', {
        method: 'POST', body: JSON.stringify({ owner: name, timestamp, signature: Buffer.from(sig).toString('base64') }),
    });
    assert(tok.body?.ok === true, `token ${name}: ${JSON.stringify(tok.body?.error)}`);
    return tok.body.data.token as string;
}

async function mintAgent(ownerToken: string, ownerName: string, name: string, scopes: string[]): Promise<string> {
    const reg = await json('/v1/agents', ownerToken, {
        method: 'POST', body: JSON.stringify({ name, owner: ownerName, capabilities: ['memory'], scopes }),
    });
    assert(reg.status === 201, `agent ${name} ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const ts = new Date().toISOString();
    const sig = await ed.signAsync(new TextEncoder().encode(gaii + ts), Buffer.from(reg.body.data.private_key, 'base64'));
    const tok = await json('/v1/auth/token', '', {
        method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: Buffer.from(sig).toString('base64') }),
    });
    assert(tok.body?.ok === true, `agent token ${name}: ${JSON.stringify(tok.body?.error)}`);
    return tok.body.data.token as string;
}

/** One chat turn, read to the end. */
async function turn(token: string, threadId: string, text: string): Promise<Array<{ kind: string; [k: string]: any }>> {
    const res = await fetch(`${BASE}/v1/chat/threads/${threadId}/turn`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text }),
    });
    assert(res.status === 200, `the stream opens with 200, got ${res.status}`);
    return (await res.text()).split('\n\n').filter((f) => f.startsWith('data:')).map((f) => JSON.parse(f.slice(5).trim()));
}

function peerEntries(): any[] {
    if (!existsSync(peerLog)) return [];
    return readFileSync(peerLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/** The one key a recorded call carried, by name. */
function keyOf(r: RecordedRequest): string {
    const auth = r.headers.authorization ?? '';
    if (auth.includes(OWN_KEY)) return 'own';
    if (auth.includes(AGENT_KEY)) return 'agent';
    if (auth.includes(PLACE_KEY)) return 'place';
    if (auth.includes(SHARED_CHAT_KEY)) return 'shared-chat';
    return auth ? `other(${auth.slice(0, 20)})` : 'none';
}

const gapParts = (ownKey: any): string[] => (ownKey?.not_covered ?? []).map((g: any) => g.part);

// ─── The run ──────────────────────────────────────────────────────────────────

console.log('\n=== Which key paid, road by road ===\n');

let routed: Node | null = null;
let shared: Node | null = null;
let stub: FakeAiProvider | null = null;

async function nodeRoute(): Promise<void> {
    routed = await startNode(PORT, 'route', '');
    BASE = routed.base;
    peerLog = routed.peerLog;
    const ownerName = `okr${Date.now() % 100000}`;
    let owner = '';
    let thread = '';
    let agent = '';
    let noai = '';
    const allowance = async () => Number((await json('/v1/chat/status', owner)).body.data.allowance_remaining_usd);

    await test('1a. setup: an owner with no key of their own; the node names the place key and what an own key would reach', async () => {
        owner = await registerOwner(ownerName);
        const created = await json('/v1/chat/threads', owner, { method: 'POST', body: JSON.stringify({ title: 'roads' }) });
        assert(created.status === 201, `create thread ${created.status}`);
        thread = created.body.data.thread.id;
        const s = (await json('/v1/chat/status', owner)).body.data;
        assert(s.has_own_key === false, `no own key yet, got ${s.has_own_key}`);
        assert(s.pays === 'allowance', `the place key pays from the allowance, got ${JSON.stringify(s.pays)}`);
        assert(s.own_key?.set === false, `own_key.set false, got ${JSON.stringify(s.own_key)}`);
        assert(s.own_key.covers.includes('chat') && s.own_key.covers.includes('node_ai') && s.own_key.covers.includes('agent_calls_via_node'),
            `on the node route an own key would reach the chat, the node's AI calls and agents through the node, got ${JSON.stringify(s.own_key.covers)}`);
        assert(JSON.stringify(gapParts(s.own_key)) === '["agent_runtimes"]', `only the crews are out of reach, got ${JSON.stringify(s.own_key.not_covered)}`);
    });

    await test('1b0. a key saved on its own is served the NODE\'s default model, on the own key; the free router only when chosen', async () => {
        // Measured 2026-10-02 on a hosted place: a key-only PUT created the settings with model
        // 'openrouter/free', which came before the node's default, and one task answered in broken
        // Finnish with neither key spending anything. Ruled by Jouni: an own key uses the node's
        // default model unless the owner chose one, and a free model only when chosen.
        const r = await json('/v1/openrouter/settings', owner, {
            method: 'PUT', body: JSON.stringify({ apiKey: OWN_KEY, provider: 'custom', baseUrl: stub!.baseUrl }),
        });
        assert(r.status === 200, `save ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const settings = (await json('/v1/openrouter/settings', owner)).body.data;
        assert(settings.model === null, `a key-only save names no model, got ${JSON.stringify(settings.model)}`);
        const seen = stub!.requestsFor('chat').length;
        const c = await json('/v1/ai/complete', owner, { method: 'POST', body: JSON.stringify({ prompt: 'DEFAULTMODEL-OWNKEY hello', app_id: 'own-key-roads' }) });
        assert(c.status === 200, `complete ${c.status}: ${JSON.stringify(c.body?.error)}`);
        const calls = stub!.requestsFor('chat').slice(seen);
        assert(calls.length === 1 && keyOf(calls[0]) === 'own', `the call carried the owner's key, got ${calls.map(keyOf).join(',')}`);
        assert(calls[0].json?.model === NODE_DEFAULT_MODEL, `the node's default model was served, got ${JSON.stringify(calls[0].json?.model)}`);
        // Chosen on purpose, the free router is what runs.
        // The legacy PUT always writes the provider and the address, so the choice names them too.
        const pick = await json('/v1/openrouter/settings', owner, { method: 'PUT', body: JSON.stringify({ provider: 'custom', baseUrl: stub!.baseUrl, model: 'openrouter/free' }) });
        assert(pick.status === 200, `choose ${pick.status}`);
        const seen2 = stub!.requestsFor('chat').length;
        const c2 = await json('/v1/ai/complete', owner, { method: 'POST', body: JSON.stringify({ prompt: 'CHOSENFREE-OWNKEY hello', app_id: 'own-key-roads' }) });
        assert(c2.status === 200, `complete on the chosen free router ${c2.status}: ${JSON.stringify(c2.body?.error)}`);
        const calls2 = stub!.requestsFor('chat').slice(seen2);
        assert(calls2[0]?.json?.model === 'openrouter/free', `the chosen free router was served, got ${JSON.stringify(calls2[0]?.json?.model)}`);
        const del = await json('/v1/openrouter/settings', owner, { method: 'DELETE' });
        assert(del.status === 200, `delete ${del.status}`);
    });

    await test('1b. the owner saves their own key the way the measurement did (PUT /v1/openrouter/settings); the node says it pays', async () => {
        const r = await json('/v1/openrouter/settings', owner, {
            method: 'PUT',
            body: JSON.stringify({ apiKey: OWN_KEY, provider: 'custom', baseUrl: stub!.baseUrl, model: STUB_MODEL }),
        });
        assert(r.status === 200, `save ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const s = (await json('/v1/chat/status', owner)).body.data;
        assert(s.has_own_key === true && s.own_key.set === true, `the key is set, got ${s.has_own_key} / ${JSON.stringify(s.own_key)}`);
        assert(s.pays === 'own', `the own key pays the chat, got ${JSON.stringify(s.pays)}`);
    });

    await test('1c. ROAD chat: the turn\'s model call reached the provider on the OWN key, and the allowance did not move', async () => {
        const before = await allowance();
        const seen = stub!.requestsFor('chat').length;
        const events = await turn(owner, thread, 'LLMCALL-OWNKEY what is two and two');
        assert(events.at(-1)?.kind === 'done', `the turn finished, got ${JSON.stringify(events.at(-1))}`);
        const calls = stub!.requestsFor('chat').slice(seen);
        assert(calls.length === 1 && calls[0].body.includes('LLMCALL-OWNKEY'), `the provider got this turn's call once, got ${calls.length}`);
        assert(keyOf(calls[0]) === 'own', `the call carried the owner's key, got ${keyOf(calls[0])}`);
        assert(await allowance() === before, `the place allowance did not move: ${before} -> ${await allowance()}`);
    });

    await test('1d. ROAD node AI call (POST /v1/ai/complete): the provider saw the OWN key', async () => {
        const seen = stub!.requestsFor('chat').length;
        const r = await json('/v1/ai/complete', owner, { method: 'POST', body: JSON.stringify({ prompt: 'NODEAI-OWNKEY hello', app_id: 'own-key-roads' }) });
        assert(r.status === 200, `complete ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const calls = stub!.requestsFor('chat').slice(seen);
        assert(calls.length >= 1 && calls.every((c) => keyOf(c) === 'own'), `every call carried the owner's key, got ${calls.map(keyOf).join(',')}`);
    });

    await test('1e. ROAD agent through the node (/v1/llm with its own token): paid by the OWN key, recorded against the agent', async () => {
        agent = await mintAgent(owner, ownerName, 'roads-agent', ['ai:use']);
        const seen = stub!.requestsFor('chat').length;
        const r = await json('/v1/llm/chat/completions', agent, {
            method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'AGENTVIANODE-OWNKEY hi' }] }),
        });
        assert(r.status === 200, `the agent's call ${r.status}: ${JSON.stringify(r.body?.error ?? r.body).slice(0, 200)}`);
        const calls = stub!.requestsFor('chat').slice(seen);
        assert(calls.length === 1 && keyOf(calls[0]) === 'own', `the provider saw the owner's key, got ${calls.map(keyOf).join(',')}`);
        const view = (await json('/v1/agents/roads-agent/ai-keys', owner)).body.data;
        assert(Number(view.spent_today_usd) > 0, `the call is recorded against the agent, got ${JSON.stringify(view.spent_today_usd)}`);
    });

    await test('1f. ROAD the agent\'s own key: it comes before the owner\'s', async () => {
        const providers = (await json('/v1/ai/providers', owner)).body.data;
        const list: any[] = providers?.providers ?? [];
        const mine = list.find((p) => p.source === 'owner' && String(p.base_url ?? '').startsWith(stub!.baseUrl));
        assert(!!mine, `the owner's provider at the stand-in is listed, got ${JSON.stringify(providers).slice(0, 300)}`);
        const set = await json('/v1/agents/roads-agent/ai-keys', owner, {
            method: 'PUT', body: JSON.stringify({ providers: { [mine.id]: { api_key: AGENT_KEY } } }),
        });
        assert(set.status === 200, `set the agent key ${set.status}: ${JSON.stringify(set.body?.error)}`);
        const seen = stub!.requestsFor('chat').length;
        const r = await json('/v1/llm/chat/completions', agent, {
            method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'AGENTKEY hi' }] }),
        });
        assert(r.status === 200, `the agent's call ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const calls = stub!.requestsFor('chat').slice(seen);
        assert(calls.length === 1 && keyOf(calls[0]) === 'agent', `the provider saw the agent's own key, got ${calls.map(keyOf).join(',')}`);
    });

    await test('1g. ROAD an agent\'s crew: the node says the own key does not reach it, to the owner and to the agent', async () => {
        for (const [who, tok] of [['owner', owner], ['agent', agent]] as const) {
            const r = await json('/v1/ai/capabilities', tok);
            assert(r.status === 200, `${who} capabilities ${r.status}: ${JSON.stringify(r.body?.error)}`);
            const gap = (r.body.data.own_key?.not_covered ?? []).find((g: any) => g.part === 'agent_runtimes');
            assert(gap?.reason === 'runtime_uses_machine_key', `${who}: the crews are named with the reason, got ${JSON.stringify(r.body.data.own_key)}`);
        }
    });

    await test('1g2. FENCES: a second owner\'s answer does not carry the first owner\'s key, and an agent without ai:use is refused before the provider', async () => {
        const otherName = `okx${Date.now() % 100000}`;
        const other = await registerOwner(otherName);
        const s = (await json('/v1/chat/status', other)).body.data;
        assert(s.has_own_key === false && s.own_key?.set === false, `the second owner has no key, got ${s.has_own_key} / ${JSON.stringify(s.own_key)}`);
        const view = await json('/v1/agents/roads-agent/ai-keys', other);
        // The name is looked up inside the caller's own account, so another owner's agent is not found.
        assert(view.status === 404, `the second owner cannot read the first owner's agent key view, got ${view.status}`);
        const scopeless = noai = await mintAgent(owner, ownerName, 'roads-noai', ['memory:read']);
        const seen = stub!.requestsFor('chat').length;
        const r = await json('/v1/llm/chat/completions', scopeless, {
            method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'NOSCOPE hi' }] }),
        });
        assert(r.status === 403, `an agent without ai:use is refused, got ${r.status}`);
        assert(stub!.requestsFor('chat').length === seen, 'and the provider was never called, so no key was spent');
    });

    await test('1g3. GUARD: a crew model choice that names a secret or a private address is refused, a provider key at a public https address is stored', async () => {
        const put = (body: unknown) => json('/v1/agents/roads-agent/crew/llm', owner, { method: 'PUT', body: JSON.stringify({ choice: body }) });
        const model = (provider: Record<string, unknown>) => ({ kind: 'model', label: 'x', provider: { type: 'openai', models: [{ id: 'm' }], ...provider } });
        for (const [why, choice] of [
            ['the node encryption key', model({ api_key_env: 'AIMEAT_ENCRYPTION_KEY', base_url: 'https://8.8.8.8/v1' })],
            ['the database address', model({ api_key_env: 'DATABASE_URL', base_url: 'https://8.8.8.8/v1' })],
            ['plain http', model({ api_key_env: 'OPENROUTER_API_KEY', base_url: 'http://8.8.8.8/v1' })],
            ['a private address', model({ api_key_env: 'OPENROUTER_API_KEY', base_url: 'https://10.0.0.5/v1' })],
            ['the cloud metadata address', model({ api_key_env: 'OPENROUTER_API_KEY', base_url: 'https://169.254.169.254/latest' })],
        ] as const) {
            const r = await put(choice);
            assert(r.status === 400 && r.body?.error?.code === 'UNSAFE_CHOICE', `${why}: refused UNSAFE_CHOICE, got ${r.status} ${JSON.stringify(r.body?.error)}`);
        }
        const ok = await put(model({ api_key_env: 'OPENROUTER_API_KEY', base_url: 'https://8.8.8.8/v1' }));
        assert(ok.status === 200, `a provider key at a public https address is stored, got ${ok.status} ${JSON.stringify(ok.body?.error)}`);
        const keyless = await put({ kind: 'model', label: 'local', provider: { type: 'ollama', models: [{ id: 'llama3' }] } });
        assert(keyless.status === 200, `a keyless provider with no address is stored, got ${keyless.status} ${JSON.stringify(keyless.body?.error)}`);
        // The owner's default goes through the same guard.
        const def = await json('/v1/agents/llm-default', owner, { method: 'PUT', body: JSON.stringify({ choice: model({ api_key_env: 'AIMEAT_ADMIN_PASSWORD' }) }) });
        assert(def.status === 400 && def.body?.error?.code === 'UNSAFE_CHOICE', `the default is guarded too, got ${def.status}`);
    });

    await test('1g4. ROAD crew on the node: {kind:"node"} is stored, and the crews read as covered once every agent reports the node road', async () => {
        const put = await json('/v1/agents/roads-agent/crew/llm', owner, { method: 'PUT', body: JSON.stringify({ choice: { kind: 'node', role: 'reasoning' } }) });
        assert(put.status === 200, `the node choice is stored, got ${put.status} ${JSON.stringify(put.body?.error)}`);
        const report = (tok: string, name: string) => json(`/v1/agents/${name}/runtime-source`, tok, { method: 'PATCH', body: JSON.stringify({ runtime_source: { kind: 'crew-def', runtime: 'crewaimeat test', llm: 'node' } }) });
        // A runtime reports about ITSELF with no permission word (auth/self-or-scope.ts): this agent
        // holds only ai:use, like a basic agent holds no agent:write. A sibling's report needs the word.
        const fenced = await report(agent, 'roads-noai');
        assert(fenced.status === 403, `an agent without agent:write cannot report a sibling's runtime, got ${fenced.status}`);
        const bad = await json('/v1/agents/roads-agent/runtime-source', agent, { method: 'PATCH', body: JSON.stringify({ runtime_source: { kind: 'crew-def', llm: 'elsewhere' } }) });
        assert(bad.status === 400, `an llm other than node or machine is refused, got ${bad.status}`);
        // Neither agent enrolled or reported yet: neither has a runtime, so neither is a crew to list
        // (the `app` principal of a hosted place sat in this list with llm null, 2026-10-02).
        let s = (await json('/v1/chat/status', owner)).body.data;
        assert((s.own_key.agents as any[]).length === 0, `an agent with no runtime is not listed, got ${JSON.stringify(s.own_key.agents)}`);
        const r1 = await report(agent, 'roads-agent');
        assert(r1.status === 200, `the agent reports its own road without agent:write, got ${r1.status} ${JSON.stringify(r1.body?.error)}`);
        s = (await json('/v1/chat/status', owner)).body.data;
        const road = (s.own_key.agents as any[]).find((a) => a.agent === 'roads-agent');
        assert(road?.llm === 'node', `the agent's road is listed, got ${JSON.stringify(s.own_key.agents)}`);
        assert(s.own_key.covers.includes('agent_runtimes'), `the only crew with a runtime is on the node road, so the crews are covered, got ${JSON.stringify(s.own_key)}`);
        const machine = await json('/v1/agents/roads-noai/runtime-source', owner, { method: 'PATCH', body: JSON.stringify({ runtime_source: { kind: 'crew-def', runtime: 'crewaimeat test', llm: 'machine' } }) });
        assert(machine.status === 200, `the owner reports the second agent on its machine's key, got ${machine.status}`);
        s = (await json('/v1/chat/status', owner)).body.data;
        assert(gapParts(s.own_key).includes('agent_runtimes'), `one crew (roads-noai) thinks with its machine's key, so the crews are not all covered, got ${JSON.stringify(s.own_key)}`);
        const r2 = await report(owner, 'roads-noai');
        assert(r2.status === 200, `the owner reports the second agent's road, got ${r2.status}`);
        s = (await json('/v1/chat/status', owner)).body.data;
        assert(s.own_key.covers.includes('agent_runtimes') && !gapParts(s.own_key).includes('agent_runtimes'),
            `every agent on the node road: the own key reaches the crews, got ${JSON.stringify(s.own_key)}`);
    });

    await test('1g5. DEFAULT crew on the node: an agent with ai:use thinks through the node when a key pays; one without it keeps the machine\'s key', async () => {
        const read = (tok: string, name: string) => json(`/v1/agents/${name}/crew/llm`, tok);
        // The agent reads its own answer with ai:use alone, as the runtime does; its own choice wins.
        let r = await read(agent, 'roads-agent');
        assert(r.status === 200, `the agent reads its own choice without memory:read, got ${r.status} ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.scope === 'agent' && r.body.data.value?.kind === 'node', `its own choice applies, got ${JSON.stringify(r.body.data)}`);
        // Nothing stored: the node is the default, because the agent holds ai:use and a key pays.
        const cleared = await json('/v1/agents/roads-agent/crew/llm', owner, { method: 'PUT', body: JSON.stringify({ choice: null }) });
        assert(cleared.status === 200, `clear ${cleared.status}`);
        r = await read(owner, 'roads-agent');
        assert(r.body.data.scope === 'node' && r.body.data.value?.kind === 'node', `the node is the default, got ${JSON.stringify(r.body.data)}`);
        assert(['agent', 'own', 'node'].includes(r.body.data.key_source), `the payer is named, got ${JSON.stringify(r.body.data)}`);
        // Without ai:use the machine's key, and the reason names the word.
        r = await read(noai, 'roads-noai');
        assert(r.status === 200 && r.body.data.value === null && r.body.data.scope === null && /ai:use/.test(r.body.data.why),
            `an agent without ai:use keeps the machine's key, got ${r.status} ${JSON.stringify(r.body.data ?? r.body.error)}`);
        // The fleet's owner default {kind:'node'} applies to the agent that can use it, and skips the one that cannot.
        const def = await json('/v1/agents/llm-default', owner, { method: 'PUT', body: JSON.stringify({ choice: { kind: 'node' } }) });
        assert(def.status === 200, `default ${def.status}`);
        r = await read(owner, 'roads-agent');
        assert(r.body.data.scope === 'default' && r.body.data.value?.kind === 'node', `the owner's default applies, got ${JSON.stringify(r.body.data)}`);
        r = await read(owner, 'roads-noai');
        assert(r.body.data.value === null, `the owner's node default skips an agent without ai:use, got ${JSON.stringify(r.body.data)}`);
        // The menu carries the same answer as `effective`.
        const menu = await json('/v1/agents/roads-noai/crew/menu', owner);
        assert(menu.status === 200 && menu.body.data.effective?.value === null && menu.body.data.choice?.scope === 'default',
            `the menu shows the stored default and the effective answer, got ${JSON.stringify(menu.body.data ?? menu.body.error)}`);
        // Another owner's agent is not found inside the caller's own account.
        const otherOwner = await registerOwner(`oky${Date.now() % 100000}`);
        r = await read(otherOwner, 'roads-agent');
        assert(r.status === 404, `a second owner cannot read the first owner's answer, got ${r.status}`);
        await json('/v1/agents/llm-default', owner, { method: 'PUT', body: JSON.stringify({ choice: null }) });
    });

    await test('1h. no call on any road carried the place key or the shared chat key', async () => {
        const all = stub!.requestsFor('chat').map(keyOf);
        assert(all.length >= 4, `the roads above made their calls, got ${all.length}`);
        assert(!all.includes('place') && !all.includes('shared-chat'), `got ${all.join(',')}`);
    });

    await test('1i. the key deleted: the node says so, and the place key is the payer again', async () => {
        const del = await json('/v1/openrouter/settings', owner, { method: 'DELETE' });
        assert(del.status === 200, `delete ${del.status}`);
        const s = (await json('/v1/chat/status', owner)).body.data;
        assert(s.has_own_key === false && s.own_key.set === false, `no key any more, got ${s.has_own_key} / ${JSON.stringify(s.own_key)}`);
        assert(s.pays === 'allowance', `the place key pays from the allowance, got ${JSON.stringify(s.pays)}`);
    });

    await stopNode(routed);
    routed = null;
}

async function sharedChatKey(): Promise<void> {
    shared = await startNode(SHARED_PORT, 'shared', SHARED_CHAT_KEY);
    BASE = shared.base;
    peerLog = shared.peerLog;
    const ownerName = `oks${Date.now() % 100000}`;
    let owner = '';
    let thread = '';

    await test('2a. setup on the shared chat key: an owner saves their own key', async () => {
        owner = await registerOwner(ownerName);
        thread = (await json('/v1/chat/threads', owner, { method: 'POST', body: JSON.stringify({ title: 'shared' }) })).body.data.thread.id;
        const r = await json('/v1/openrouter/settings', owner, {
            method: 'PUT', body: JSON.stringify({ apiKey: OWN_KEY, provider: 'custom', baseUrl: stub!.baseUrl, model: STUB_MODEL }),
        });
        assert(r.status === 200, `save ${r.status}: ${JSON.stringify(r.body?.error)}`);
    });

    await test('2b. the status says both halves: a key is set, the shared key pays the chat, and the own key does not reach it', async () => {
        const s = (await json('/v1/chat/status', owner)).body.data;
        assert(s.has_own_key === true, `the key is set, got ${s.has_own_key}`);
        assert(s.pays === 'node', `the shared chat key pays, got ${JSON.stringify(s.pays)}`);
        const chatGap = (s.own_key?.not_covered ?? []).find((g: any) => g.part === 'chat');
        assert(chatGap?.reason === 'shared_chat_key', `the chat is named as out of reach, got ${JSON.stringify(s.own_key)}`);
        assert(!s.own_key.covers.includes('chat'), `and is not in covers, got ${JSON.stringify(s.own_key.covers)}`);
        assert(s.own_key.covers.includes('node_ai'), `the node's other AI calls still take it, got ${JSON.stringify(s.own_key.covers)}`);
    });

    await test('2c. ROAD chat on the shared key: the process that ran the turn holds the shared key, and the own key never left the node', async () => {
        const seen = stub!.requestsFor('chat').length;
        const events = await turn(owner, thread, 'hello on the shared key');
        assert(events.at(-1)?.kind === 'done', `the turn finished, got ${JSON.stringify(events.at(-1))}`);
        const prompt = peerEntries().filter((e) => e.kind === 'request' && e.method === 'session/prompt').at(-1);
        const started = peerEntries().find((e) => e.kind === 'started' && e.pid === prompt?.pid);
        assert(started?.env?.OPENROUTER_API_KEY === SHARED_CHAT_KEY, `the chat process was given the shared key, got ${started?.env?.OPENROUTER_API_KEY}`);
        assert(started.env.OPENAI_API_KEY === null, `and no token of the owner's, got ${started.env.OPENAI_API_KEY}`);
        assert(stub!.requestsFor('chat').length === seen, 'the own key\'s provider was not called for the chat');
    });

    await stopNode(shared);
    shared = null;
}

async function run(): Promise<void> {
    stub = await startFakeAiProvider(STUB_PORT);
    await nodeRoute();
    await sharedChatKey();
}

run()
    .catch((err: Error) => { console.error('Suite crashed:', err); failed++; })
    .finally(async () => {
        await stopNode(routed);
        await stopNode(shared);
        await stub?.close();
        console.log(`\nOwn key roads E2E: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
        process.exit(failed > 0 ? 1 : 0);
    });
