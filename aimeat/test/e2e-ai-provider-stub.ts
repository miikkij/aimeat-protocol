/**
 * @file test/e2e-ai-provider-stub.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The AI paths BEHIND the gate, driven end to end against a provider that answers.
 *
 *   WHAT THIS SUITE IS FOR. Every other AI suite in this repo stops at the door: e2e-llm-proxy
 *   proves the scope word and says so in its own header ("CI has no provider key and no model"),
 *   e2e-ai-transcribe prints "a SUCCESSFUL transcription is not covered", e2e-ai-image walks the
 *   refusals. So the refusals are proven and the WORK is not. The streamed frames the chat proxy
 *   forwards, the three-attempt moderation retry, the multipart form a transcription is sent as,
 *   the model-list name fallback that exists because NVIDIA NIM returns no `name`, and the JSON a
 *   classifier's answer is parsed out of have never been executed by a test on this node.
 *
 *   NOTHING INSIDE THE NODE IS MOCKED. A local OpenAI-compatible stub stands in for the provider and
 *   for nothing else (test/helpers/fake-ai-provider.ts): the node reads its own settings, picks its
 *   own model, opens a real socket, forwards real bytes and does its own accounting. The node is
 *   pointed at the stub by writing ONE memory record as the owner — `openrouter.settings` with
 *   provider `custom` and the stub's baseUrl — which is the same door a person uses, and needs no
 *   key because a custom provider legitimately has none.
 *
 *   WHY IT OWNS ITS SERVER. The stub's port has to be in the owner's settings before the first call,
 *   the AI job slot count is a boot-time number (one slot, so a second job is reachably `queued`),
 *   and loopback egress has to be allowed. None of that is true of the shared runner's node. SQLite
 *   on a temporary file, because the point here is the provider transport and not the storage layer;
 *   the backend-sensitive AI assertions live in e2e-ai-jobs, which follows the runner's backend.
 *
 *   HOW THE STUB IS AIMED. Every scripted reply is bound to a MARKER in the prompt rather than to
 *   its position in a queue. The scheduler runs core:living-pulse every five minutes, so a reply
 *   pinned to arrival order can be eaten by a background derive that happened to fire first; a reply
 *   pinned to its own prompt cannot.
 * @structure
 *   - the node under test: temp SQLite, own port, pinnedEnv plus the pins only this suite needs
 *   - phase 1: the doors refuse (401 unauthenticated, 403 wrong scope) before the provider is touched
 *   - phase 2-3: the chat proxy whole and streamed; both model catalogues
 *   - phase 4-6: transcription, image generation, /v1/ai/complete's error and multimodal branches
 *   - phase 7: the librarian's classify / plan / distribute over a real organism structure
 *   - phase 8: AI jobs — listing with filters, and cancelling one that is genuinely queued
 *   - phase 9: the living-document pulse's derive loop, its gate, its stop and its guards
 * @usage cd aimeat && pnpm exec node --import tsx test/e2e-ai-provider-stub.ts
 * @version-history
 *   v1.0.0 — 2026-09-08 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pinnedEnv } from './run-e2e-server.js';
import {
    startFakeAiProvider, chatJson, chatErrorBody, sseChat, modelsJson, transcriptionJson,
    imageJson, providerStatus, type FakeAiProvider, type RecordedRequest,
} from './helpers/fake-ai-provider.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

// 40314/40315 are this suite's own pair. E2E_AI_STUB_PORT is already e2e-ai-provenance's variable,
// so these carry their own names rather than quietly moving that suite's stub.
const PORT = process.env.E2E_AI_PROVIDER_STUB_PORT ?? '40314';
const BASE = `http://localhost:${PORT}`;
const STUB_PORT = parseInt(process.env.E2E_AI_PROVIDER_STUB_UPSTREAM_PORT ?? '40315', 10);
const NODE_ID = process.env.AIMEAT_NODE_ID ?? 'aimeat-local-001-dev';
const MODEL = 'stub/test-model';
const DEFAULT_ANSWER = 'The stub provider answered.';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body, headers: res.headers };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}

// ── the node under test ───────────────────────────────────────────────────────

const dbDir = mkdtempSync(join(tmpdir(), 'aimeat-ai-stub-'));
const DB_PATH = join(dbDir, 'ai-stub.db');

async function startServer(): Promise<ChildProcess> {
    const target = {
        port: PORT, baseUrl: BASE, dbType: 'sqlite', dbPath: DB_PATH, dbUrl: '', external: false,
    };
    const env: Record<string, string | undefined> = {
        ...process.env,
        // The runner's own pin list, so this node behaves like every other test node: no real SMTP,
        // no developer .env leaking a live OAuth client, generous ceilings, a fixed operator.
        ...pinnedEnv(target),
        AIMEAT_DEV_MODE: 'true',
        AIMEAT_TEST_MODE: 'true',
        // The stub lives on loopback, which outbound validation refuses on a public node and must.
        AIMEAT_ALLOW_PRIVATE_EGRESS: 'true',
        AIMEAT_RL_OPENROUTER: '1000',
        AIMEAT_RL_GLOBAL: '10000',
        AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000', AIMEAT_RL_MEMORY: '1000',
        AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000',
        AIMEAT_DEFAULT_AGENT_SCOPES: '*',
        // One slot, so the second job of a pair is genuinely queued rather than racing to finish.
        AIMEAT_AI_JOB_SLOTS: '1',
    };
    const child = spawn('node', ['--import', 'tsx', 'src/index.ts', 'start', '--db', 'sqlite', '--db-path', DB_PATH],
        { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    const stderrTail: string[] = [];
    child.stdout?.on('data', () => { /* drained */ });
    child.stderr?.on('data', (d: Buffer) => { stderrTail.push(d.toString()); if (stderrTail.length > 20) stderrTail.shift(); });

    const began = Date.now();
    while (Date.now() - began < 60_000) {
        if (child.exitCode !== null || child.signalCode !== null) {
            throw new Error(`the node exited during startup: ${stderrTail.join('').trim()}`);
        }
        // Not listening yet is the normal state for the first second or two; the loop's own
        // deadline, and the stderr tail above, are what report a real failure.
        try { if ((await fetch(`${BASE}/v1/spec`)).ok) return child; } catch { /* not up yet */ }
        await sleep(300);
    }
    child.kill('SIGKILL');
    throw new Error(`the node failed to start: ${stderrTail.join('').trim()}`);
}

async function stopServer(child: ChildProcess): Promise<void> {
    if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        // Wait for the process to be GONE rather than sleeping a guessed second: on Windows the
        // SQLite file cannot be deleted while the handle is open.
        const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
        await once(child, 'exit');
        clearTimeout(timer);
    }
}

// ── owners, agents and the one record that aims the node at the stub ──────────

interface Owner { name: string; gaii: string; token: string }

async function setupOwner(label: string): Promise<Owner> {
    const name = `aistub${label}${Date.now()}`.toLowerCase();
    const reg = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: name, display_name: 'AI Stub', password: 'AiStubTest1234' }),
    });
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }),
    });
    assert(tok.status === 200 && tok.body?.data?.token, `auth/token ${tok.status}: ${JSON.stringify(tok.body)}`);
    return { name, gaii: `${name}@${NODE_ID}`, token: tok.body.data.token as string };
}

/** Device-authorise an agent with an explicit scope set (RFC 8628), and return its token. */
async function connectAgent(owner: Owner, agentName: string, scopes: string[]): Promise<string> {
    const da = await json('/v1/agents/device-authorize', {
        method: 'POST', body: JSON.stringify({ agent_name: agentName, owner: owner.name }),
    });
    assert(da.status === 200, `device-authorize ${da.status}: ${JSON.stringify(da.body)}`);
    const v = await json('/v1/agents/verify', {
        method: 'POST',
        body: JSON.stringify({ user_code: da.body.data.user_code, action: 'approve', scopes, owner_token: owner.token }),
    });
    assert(v.status === 200, `verify ${v.status}: ${JSON.stringify(v.body?.error ?? v.body)}`);
    const t = await json('/v1/agents/device-token', {
        method: 'POST',
        body: JSON.stringify({ device_code: da.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    assert(t.status === 200, `device-token ${t.status}: ${JSON.stringify(t.body)}`);
    return t.body.token as string;
}

/** The whole of the aiming: one memory record, written the way a person writes it. */
async function pointAtStub(owner: Owner, provider: FakeAiProvider): Promise<void> {
    const r = await json('/v1/memory', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({
            key: 'openrouter.settings', visibility: 'private',
            value: { provider: 'custom', baseUrl: provider.baseUrl, model: MODEL, daily_budget_usd: 50 },
        }),
    });
    assert(r.status === 201, `settings ${r.status}: ${JSON.stringify(r.body?.error)}`);
}

async function writeMemory(owner: Owner, key: string, value: unknown) {
    return json('/v1/memory', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ key, value, visibility: 'private' }),
    });
}
const readMemory = (owner: Owner, key: string) =>
    json(`/v1/memory/${encodeURIComponent(key)}`, { headers: auth(owner.token) });

/** Does this request's body carry the marker the reply was written for? */
const carries = (marker: string) => (r: RecordedRequest) => r.body.includes(marker);

// ── the run ───────────────────────────────────────────────────────────────────

(async () => {
    console.log('\n── AI provider transport (a stub that answers, not a gate that refuses) ──');
    const provider = await startFakeAiProvider(STUB_PORT);
    // The default answer is a FUNCTION, so a background living-document derive or a stray job never
    // consumes a reply written for a named test. 'Stop condition:' is the living charter's judge.
    provider.setDefault('chat', (r) => r.body.includes('Stop condition:') ? chatJson('NO') : chatJson(DEFAULT_ANSWER));
    const server = await startServer();

    const a = await setupOwner('a');
    const b = await setupOwner('b');
    await pointAtStub(a, provider);
    await pointAtStub(b, provider);
    const aiAgent = await connectAgent(a, `aistubyes${Date.now()}`, ['ai:use', 'memory:write']);
    const noAiAgent = await connectAgent(a, `aistubno${Date.now()}`, ['memory:read']);

    // ── 1. The doors, before anything is spent ────────────────────────────────

    await test('1a. Every AI door refuses an unauthenticated caller with 401', async () => {
        const doors: Array<[string, RequestInit]> = [
            ['/v1/llm/chat/completions', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }] }) }],
            ['/v1/llm/models', {}],
            ['/v1/ai/complete', { method: 'POST', body: JSON.stringify({ prompt: 'x' }) }],
            ['/v1/ai/transcribe', { method: 'POST', body: JSON.stringify({ audio_base64: 'AAA=' }) }],
            ['/v1/ai/image', { method: 'POST', body: JSON.stringify({ prompt: 'x' }) }],
            ['/v1/ai/jobs', {}],
            ['/v1/librarian/classify', { method: 'POST', body: JSON.stringify({ text: 'x' }) }],
        ];
        for (const [path, opts] of doors) {
            const r = await json(path, opts);
            assert(r.status === 401, `${path} without a credential: expected 401, got ${r.status}`);
        }
    });

    await test('1b. An agent holding the wrong word is refused 403, and the provider is never touched', async () => {
        const before = provider.requests.length;
        const proxy = await json('/v1/llm/chat/completions', {
            method: 'POST', headers: auth(noAiAgent),
            body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }] }),
        });
        assert(proxy.status === 403, `the chat proxy: expected 403, got ${proxy.status}`);
        const complete = await json('/v1/ai/complete', {
            method: 'POST', headers: auth(noAiAgent), body: JSON.stringify({ prompt: 'x' }),
        });
        assert(complete.status === 403, `/v1/ai/complete: expected 403, got ${complete.status}`);
        const image = await json('/v1/ai/image', {
            method: 'POST', headers: auth(noAiAgent), body: JSON.stringify({ prompt: 'x', model: MODEL }),
        });
        assert(image.status === 403, `/v1/ai/image: expected 403, got ${image.status}`);
        const classify = await json('/v1/librarian/classify', {
            method: 'POST', headers: auth(noAiAgent), body: JSON.stringify({ text: 'x' }),
        });
        assert(classify.status === 403, `/v1/librarian/classify: expected 403, got ${classify.status}`);
        assert(provider.requests.length === before,
            `a refusal must not reach the provider: ${provider.requests.length - before} request(s) arrived`);
    });

    await test('1c. The agent that DOES hold ai:use is admitted, and runs on its OWN provider settings', async () => {
        // The positive control, and the reason 1b is load-bearing: without it, "everything is
        // refused" would satisfy the pair.
        //
        // An agent session resolves to its own GAII and not to the owner's GHII, so its provider
        // settings are its own record — pinning today's behaviour, which e2e-ai-jobs case 16b states
        // from the other side (an agent with no settings of its own is refused for the KEY, not for
        // the permission). Writing them here is what turns that refusal into a completion.
        const settings = await json('/v1/memory', {
            method: 'POST', headers: auth(aiAgent),
            body: JSON.stringify({
                key: 'openrouter.settings', visibility: 'private',
                value: { provider: 'custom', baseUrl: provider.baseUrl, model: MODEL, daily_budget_usd: 50 },
            }),
        });
        assert(settings.status === 201, `the agent wrote its own settings, got ${settings.status}: ${JSON.stringify(settings.body?.error)}`);
        provider.queue('chat', chatJson('Admitted.'), carries('MARK-AGENT-ADMITTED'));
        const r = await json('/v1/ai/complete', {
            method: 'POST', headers: auth(aiAgent),
            body: JSON.stringify({ prompt: 'MARK-AGENT-ADMITTED', app_id: 'e2e-ai-stub' }),
        });
        assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.content === 'Admitted.', `the answer came back: ${JSON.stringify(r.body.data?.content)}`);
    });

    // ── 2. The chat proxy: the provider's own bytes ───────────────────────────

    await test('2a. A whole completion is forwarded, on the model the NODE chose, with the tools untouched', async () => {
        provider.queue('chat', chatJson('Seventeen swans.', { usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7, cost: 0.001 } }), carries('MARK-PROXY-WHOLE'));
        const r = await json('/v1/llm/chat/completions', {
            method: 'POST', headers: auth(a.token),
            body: JSON.stringify({
                model: 'caller/should-be-ignored',
                messages: [{ role: 'user', content: 'MARK-PROXY-WHOLE how many swans' }],
                temperature: 0.3, max_tokens: 64,
                tools: [{ type: 'function', function: { name: 'count_swans' } }],
            }),
        });
        assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.choices?.[0]?.message?.content === 'Seventeen swans.', `the provider's answer came back: ${JSON.stringify(r.body).slice(0, 120)}`);
        const sent = provider.lastRequest('chat')!;
        // The caller named a model and the node ignored it: the node knows whose money this is.
        assert(sent.json?.model === MODEL, `the node's own model was used, got ${sent.json?.model}`);
        assert(Array.isArray(sent.json?.tools), 'the tools were passed through untouched');
        assert((sent.json as any)?.temperature === 0.3, 'temperature rode along');
        const usage = await json('/v1/ai/usage', { headers: auth(a.token) });
        assert(usage.body.data.total_calls >= 1, `the turn was recorded, total_calls=${usage.body.data.total_calls}`);
    });

    await test('2b. A streamed completion is forwarded FRAME FOR FRAME, and the usage is read out of it', async () => {
        const stream = sseChat(['Seven', 'teen ', 'swans.'], { usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10, cost: 0.002 } });
        provider.queue('chat', stream.reply, carries('MARK-PROXY-STREAM'));
        const before = (await json('/v1/ai/usage', { headers: auth(a.token) })).body.data.spent_today_usd;
        const res = await fetch(`${BASE}/v1/llm/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...auth(a.token) },
            body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'MARK-PROXY-STREAM swans' }] }),
        });
        assert(res.status === 200, `expected 200, got ${res.status}`);
        assert((res.headers.get('content-type') ?? '').includes('text/event-stream'), `the answer is an event stream, got ${res.headers.get('content-type')}`);
        const text = await res.text();
        // Byte for byte. A client that understands OpenAI's stream understands this one, and
        // anything rewritten in the middle would be a second dialect to keep in step.
        assert(text === stream.body, `the frames were rewritten:\n  sent: ${JSON.stringify(stream.body)}\n  got:  ${JSON.stringify(text)}`);
        const sent = provider.lastRequest('chat')!;
        assert((sent.json as any)?.stream === true && !!(sent.json as any)?.stream_options,
            'the node asked for usage in the stream, which is how it knows what the turn cost');
        const after = (await json('/v1/ai/usage', { headers: auth(a.token) })).body.data.spent_today_usd;
        assert(after > before, `the streamed turn was billed: $${before} → $${after}`);
    });

    await test('2c. A provider 429 comes back as the node\'s own named reason, not as a 500', async () => {
        provider.queue('chat', providerStatus(429, '{"error":{"message":"slow down"}}'), carries('MARK-PROXY-429'));
        const r = await json('/v1/llm/chat/completions', {
            method: 'POST', headers: auth(a.token),
            body: JSON.stringify({ messages: [{ role: 'user', content: 'MARK-PROXY-429' }] }),
        });
        assert(r.status === 429, `expected 429, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.error?.code === 'RATE_LIMITED', `code ${r.body.error?.code}`);
    });

    // ── 3. The two model catalogues ───────────────────────────────────────────

    await test('3a. A model with only an id still gets a label, and the list sorts without throwing', async () => {
        // NVIDIA NIM, LM Studio and OpenAI return models with no `name`. The sort used to
        // dereference undefined.localeCompare, which surfaced as an empty dropdown.
        provider.queue('models', modelsJson([
            { id: 'zeta/named', name: 'Aardvark', context_length: 8000, pricing: { prompt: '1', completion: '2' } },
            { id: 'beta/nameless' },
            { id: 'gamma/owned', owned_by: 'a-vendor', architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
            { notAModel: true },
        ]));
        const r = await json('/v1/llm/models', { headers: auth(a.token) });
        assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const ids = (r.body.data as Array<{ id: string }>).map(m => m.id);
        assert(ids.length === 3, `the entry with no id was dropped, got ${ids.length}: ${ids.join(', ')}`);
        // Sorted by name-or-id: 'Aardvark' < 'beta/nameless' < 'gamma/owned'.
        assert(ids.join('|') === 'zeta/named|beta/nameless|gamma/owned', `sorted by the label, got ${ids.join('|')}`);
        assert(!provider.lastRequest('models')!.query.has('output_modalities'), 'a chat listing sends no modality filter');
    });

    await test('3b. A transcription listing asks for ?output_modalities=transcription, which is a different catalogue', async () => {
        // OpenRouter's default catalogue contains no whisper model at all, so this is not a
        // client-side filter dressed up as a parameter.
        provider.queue('models', modelsJson([
            { id: 'openai/whisper-large-v3', name: 'Whisper Large v3', architecture: { input_modalities: ['audio'], output_modalities: ['transcription'] } },
        ]), r => r.query.get('output_modalities') === 'transcription');
        const r = await json('/v1/openrouter/models?modality=transcription', { headers: auth(a.token) });
        assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.modality === 'transcription', `modality ${r.body.data.modality}`);
        assert(r.body.data.models[0].output_modalities?.includes('transcription'), 'the architecture block was carried through');
        const seen = provider.requestsFor('models').filter(x => x.query.get('output_modalities') === 'transcription');
        assert(seen.length === 1, `the stub saw the filter exactly once, got ${seen.length}`);
    });

    await test('3b2. An image listing asks for ?output_modalities=image, so the picker can list image models', async () => {
        // Asserted as a hole first, 2026-09-08: the route narrowed the word to transcription, speech
        // or chat, so ?modality=image answered with the chat catalogue and no filter reached the
        // provider. Fixed in routes/openrouter.ts v1.11.0.
        provider.queue('models', modelsJson([
            { id: 'openai/gpt-image-1', name: 'GPT Image', architecture: { input_modalities: ['text'], output_modalities: ['image'] } },
        ]), r => r.query.get('output_modalities') === 'image');
        const r = await json('/v1/openrouter/models?modality=image', { headers: auth(a.token) });
        assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.modality === 'image', `the door answers the modality it was asked, got ${r.body.data.modality}`);
        const seen = provider.requestsFor('models').filter(x => x.query.get('output_modalities') === 'image');
        assert(seen.length === 1, `the provider was asked for image models exactly once, got ${seen.length}`);
    });

    await test('3c. A catalogue that answers badly is a named 502, and a rejected key is a 401', async () => {
        provider.queue('models', providerStatus(503, 'upstream down'), r => r.query.get('output_modalities') === 'speech');
        const bad = await json('/v1/openrouter/models?modality=speech', { headers: auth(a.token) });
        assert(bad.status === 502, `expected 502, got ${bad.status}: ${JSON.stringify(bad.body?.error)}`);
        assert(bad.body.error?.code === 'OPENROUTER_ERROR', `code ${bad.body.error?.code}`);
        provider.queue('models', providerStatus(401, 'bad key'), r => r.query.get('output_modalities') === 'speech');
        const rejected = await json('/v1/openrouter/models?modality=speech', { headers: auth(a.token) });
        assert(rejected.status === 401, `a rejected key is 401, got ${rejected.status}`);
        assert(rejected.body.error?.code === 'INVALID_API_KEY', `code ${rejected.body.error?.code}`);
    });

    // ── 4. Transcription: the multipart form the provider actually receives ───

    const AUDIO = Buffer.from('RIFFfake-audio-bytes-for-the-stub').toString('base64');
    const transcribe = (body: Record<string, unknown>) => json('/v1/ai/transcribe', {
        method: 'POST', headers: auth(a.token),
        body: JSON.stringify({ audio_base64: AUDIO, mime: 'audio/webm', filename: 'note.webm', model: MODEL, ...body }),
    });

    await test('4a. verbose asks for verbose_json AND segment timestamps, and the reported usage comes back', async () => {
        provider.queue('transcriptions', transcriptionJson({
            text: 'The harbour extension was approved.', language: 'en', model: MODEL,
            usage: { seconds: 12.5, input_tokens: 30, output_tokens: 9, total_tokens: 39, cost: 0.0009 },
        }));
        const r = await transcribe({ verbose: true, language: 'en' });
        assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.text === 'The harbour extension was approved.', `text: ${r.body.data.text}`);
        assert(r.body.data.language === 'en', `language ${r.body.data.language}`);
        assert(r.body.data.seconds === 12.5, `seconds ${r.body.data.seconds}`);
        // Audio pricing is per-minute on one provider and per-hour on another, so the provider's own
        // cost is the only trustworthy signal — and cost_exact says whether there was one.
        assert(r.body.data.usage.cost_exact === true && r.body.data.usage.cost_usd === 0.0009, `cost: ${JSON.stringify(r.body.data.usage)}`);
        const form = provider.lastRequest('transcriptions')!;
        assert(form.headers['content-type']?.startsWith('multipart/form-data'), `multipart, got ${form.headers['content-type']}`);
        assert(form.body.includes('name="response_format"') && form.body.includes('verbose_json'), 'response_format=verbose_json is in the form');
        assert(form.body.includes('name="timestamp_granularities[]"'), 'the segment granularity is in the form');
        assert(form.body.includes('name="language"') && form.body.includes('name="file"'), 'the language hint and the file part are in the form');
    });

    await test('4b. Without verbose neither field is sent, and a provider that reports no cost is recorded as inexact', async () => {
        provider.queue('transcriptions', transcriptionJson({ text: 'plain' }));
        const r = await transcribe({});
        assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.usage.cost_exact === false && r.body.data.usage.cost_usd === 0,
            `zero-and-flagged is the honest answer, got ${JSON.stringify(r.body.data.usage)}`);
        const form = provider.lastRequest('transcriptions')!;
        assert(!form.body.includes('verbose_json'), 'no response_format when verbose was not asked for');
        assert(!form.body.includes('timestamp_granularities'), 'no granularity when verbose was not asked for');
    });

    await test('4c. A 200 that carries an error is still a failure, and a non-OK names the status', async () => {
        provider.queue('transcriptions', { kind: 'json', body: { error: { message: 'the audio was unreadable' } } });
        const carried = await transcribe({});
        assert(carried.status === 502, `expected 502, got ${carried.status}: ${JSON.stringify(carried.body?.error)}`);
        assert(/unreadable/.test(carried.body.error?.message ?? ''), `the reason is carried: ${carried.body.error?.message}`);
        provider.queue('transcriptions', providerStatus(500, 'engine exploded'));
        const nonOk = await transcribe({});
        assert(nonOk.status === 502, `expected 502, got ${nonOk.status}`);
        assert(/500/.test(nonOk.body.error?.message ?? ''), `the status is named: ${nonOk.body.error?.message}`);
        provider.queue('transcriptions', providerStatus(401, 'nope'));
        const rejected = await transcribe({});
        assert(rejected.status === 401, `a rejected key is 401, got ${rejected.status}`);
        assert(rejected.body.error?.code === 'INVALID_API_KEY', `code ${rejected.body.error?.code}`);
    });

    // ── 5. Images: the moderation retry, and what the bytes are ───────────────

    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4]).toString('base64');
    const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3, 4, 5]).toString('base64');
    const image = (body: Record<string, unknown> = {}) => json('/v1/ai/image', {
        method: 'POST', headers: auth(a.token),
        body: JSON.stringify({ prompt: 'a red bicycle', model: MODEL, ...body }),
    });
    const imageCalls = () => provider.requestsFor('images').length;

    await test('5a. Two moderation refusals then a 200: the same prompt is retried and the picture lands', async () => {
        // Not defensive padding. Some providers' moderation throws false positives and the SAME
        // prompt passes on the next attempt, which scripts/gen_image.py has worked around for months.
        const before = imageCalls();
        provider.queue('images', providerStatus(400, '{"error":{"message":"flagged by moderation"}}'));
        provider.queue('images', providerStatus(400, '{"error":{"message":"flagged by moderation"}}'));
        provider.queue('images', imageJson({ b64: PNG, cost: 0.04 }));
        const r = await image({ size: '1024x1024' });
        assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(imageCalls() - before === 3, `three attempts were made, got ${imageCalls() - before}`);
        assert(r.body.data.mime_type === 'image/png', `PNG magic bytes were sniffed, got ${r.body.data.mime_type}`);
        assert(r.body.data.usage.cost_usd === 0.04 && r.body.data.usage.cost_exact === true, `cost ${JSON.stringify(r.body.data.usage)}`);
        assert(r.body.data.url.startsWith('/v1/storage/'), `a private image is fetched through the owner door, got ${r.body.data.url}`);
        assert((provider.lastRequest('images')!.json as any)?.size === '1024x1024', 'the size was passed through');
        const stored = await fetch(`${BASE}${r.body.data.url}`, { headers: auth(a.token) });
        assert(stored.status === 200, `the bytes are readable at the URL, got ${stored.status}`);
    });

    await test('5b. Three moderation refusals give up, and a non-moderation 400 gives up at once', async () => {
        const beforeGiveUp = imageCalls();
        for (let i = 0; i < 3; i++) provider.queue('images', providerStatus(400, '{"error":{"message":"moderation blocked this"}}'));
        const giveUp = await image();
        assert(giveUp.status === 502, `expected 502, got ${giveUp.status}: ${JSON.stringify(giveUp.body?.error)}`);
        assert(imageCalls() - beforeGiveUp === 3, `three attempts and no more, got ${imageCalls() - beforeGiveUp}`);

        const beforeHard = imageCalls();
        provider.queue('images', providerStatus(400, '{"error":{"message":"prompt is empty"}}'));
        const hard = await image();
        assert(hard.status === 502, `expected 502, got ${hard.status}: ${JSON.stringify(hard.body?.error)}`);
        // Retrying a real error only makes the person wait longer for it.
        assert(imageCalls() - beforeHard === 1, `one attempt for a non-moderation failure, got ${imageCalls() - beforeHard}`);
    });

    await test('5c. A data: URL carries the same bytes as b64_json, and the format is sniffed rather than trusted', async () => {
        provider.queue('images', imageJson({ dataUrl: `data:image/jpeg;base64,${JPEG}` }));
        const r = await image({ public: true });
        assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.mime_type === 'image/jpeg', `no PNG magic, so JPEG: got ${r.body.data.mime_type}`);
        assert(r.body.data.usage.cost_exact === false, 'a provider that reported no cost is not invented one');
        assert(r.body.data.url.startsWith('/v1/pub/'), `a public image is fetched anonymously, got ${r.body.data.url}`);
        const anon = await fetch(`${BASE}${r.body.data.url}`);
        assert(anon.status === 200, `and a visitor with no credential can open it, got ${anon.status}`);
    });

    await test('5d. A 200 with an error message, and a 200 with no image at all, both fail by name', async () => {
        provider.queue('images', imageJson({ errorMessage: 'the model refused' }));
        const named = await image();
        assert(named.status === 502, `expected 502, got ${named.status}`);
        assert(/refused/.test(named.body.error?.message ?? ''), `the reason is carried: ${named.body.error?.message}`);
        provider.queue('images', imageJson({}));
        const empty = await image();
        assert(empty.status === 502, `expected 502, got ${empty.status}`);
        assert(/no image data/i.test(empty.body.error?.message ?? ''), `named: ${empty.body.error?.message}`);
    });

    // ── 6. /v1/ai/complete: the branches a completion can end in ──────────────

    const complete = (body: Record<string, unknown>) => json('/v1/ai/complete', {
        method: 'POST', headers: auth(a.token), body: JSON.stringify(body),
    });

    await test('6a. A non-OK provider is a 502, and a 200 carrying error.code 429 is a 429', async () => {
        provider.queue('chat', providerStatus(500, 'upstream fell over'), carries('MARK-COMPLETE-500'));
        const down = await complete({ prompt: 'MARK-COMPLETE-500', app_id: 'e2e-ai-stub' });
        assert(down.status === 502, `expected 502, got ${down.status}: ${JSON.stringify(down.body?.error)}`);
        assert(down.body.error?.code === 'PROVIDER_ERROR', `code ${down.body.error?.code}`);
        // A 200 with an error body is a real shape: Owl Alpha and friends reject params that way.
        provider.queue('chat', chatErrorBody('rate limited by the vendor', 429), carries('MARK-COMPLETE-200ERR'));
        const carried = await complete({ prompt: 'MARK-COMPLETE-200ERR', app_id: 'e2e-ai-stub' });
        assert(carried.status === 429, `the error body's own code decides the status, got ${carried.status}: ${JSON.stringify(carried.body?.error)}`);
        assert(carried.body.error?.code === 'RATE_LIMITED', `code ${carried.body.error?.code}`);
    });

    await test('6b. An empty completion is answered as empty rather than as a failure', async () => {
        provider.queue('chat', chatJson('', { finishReason: 'length' }), carries('MARK-COMPLETE-EMPTY'));
        const r = await complete({ prompt: 'MARK-COMPLETE-EMPTY', app_id: 'e2e-ai-stub' });
        assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.content === '', `empty content, got ${JSON.stringify(r.body.data.content)}`);
    });

    await test('6c. An image attachment turns the user turn into a multimodal content array', async () => {
        provider.queue('chat', chatJson('A red bicycle.'), carries('MARK-COMPLETE-VISION'));
        const r = await complete({
            prompt: 'MARK-COMPLETE-VISION what is in this picture',
            images: [`data:image/png;base64,${PNG}`, ''],
            app_id: 'e2e-ai-stub',
        });
        assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const sent = provider.lastRequest('chat')!.json as any;
        const last = sent.messages[sent.messages.length - 1];
        assert(Array.isArray(last.content), `the user turn is a content array, got ${typeof last.content}`);
        assert(last.content[0].type === 'text', 'the text part comes first');
        // The empty string in `images` is dropped rather than sent as an image_url with no URL.
        assert(last.content.length === 2 && last.content[1].type === 'image_url', `one image part, got ${JSON.stringify(last.content).slice(0, 120)}`);
        assert(!!r.body.meta?.provenance,
            `the bytes came back with the provenance the node minted while watching them being made: ${JSON.stringify(r.body.meta)}`);
    });

    // ── 7. The librarian: a classifier's JSON, over a real structure ──────────

    const org = await json('/v1/organisms', {
        method: 'POST', headers: auth(a.token),
        body: JSON.stringify({ name: 'Stub Notebook Org', type: 'project', join_policy: 'open', visibility: 'public' }),
    });
    assert(org.status === 201, `organism ${org.status}: ${JSON.stringify(org.body?.error)}`);
    const ORG = org.body.data.organism.id as string;
    const WS = 'ws-stubnote';
    const NS = 'notes';
    for (const [key, value] of [
        [`organism.${ORG}.meta.workspaces`, { workspaces: [{ id: WS, name: 'Notebook' }] }],
        // The manifest key carries a locked schema (services/manifest-schema.ts), so this is the
        // real envelope a workspace has and not a stand-in for one.
        [`organism.${ORG}.w.${WS}.meta.manifest`, {
            manifestVersion: '1', id: WS, name: 'Notebook', kind: 'project', status: 'active',
            objectTypes: [{
                name: 'Notes', namespace: NS, mode: 'document',
                schemaRef: 'free', backing: 'memory', writeRole: 'member',
            }],
        }],
        [`organism.${ORG}.w.${WS}.${NS}.harbour.latest`, { title: 'Harbour minutes', markdown: '# Harbour minutes' }],
    ] as Array<[string, unknown]>) {
        const w = await writeMemory(a, key, value);
        assert(w.status === 201, `setup write ${key}: ${w.status} ${JSON.stringify(w.body?.error)}`);
    }

    const classify = (text: string) => json('/v1/librarian/classify', {
        method: 'POST', headers: auth(a.token), body: JSON.stringify({ text }),
    });
    const distribute = (text: string) => json('/v1/librarian/distribute', {
        method: 'POST', headers: auth(a.token), body: JSON.stringify({ text }),
    });

    await test('7a. The real structure reaches the model, and the ids it picks are re-resolved against it', async () => {
        provider.queue('chat', chatJson(JSON.stringify({
            suggestion: { organismId: ORG, workspaceId: WS, space: NS, title: 'Council decision', markdown: '# Council decision', confidence: 0.87, reason: 'same kind of material' },
            alternatives: [
                { organismId: 'no-such-organism', workspaceId: WS, space: NS },
                { organismId: ORG, workspaceId: WS, space: 'no-such-space' },
            ],
            createNew: { suggest: true, organismName: 'Harbour', workspaceName: 'Minutes', reason: 'nothing fits' },
        })), carries('MARK-CLASSIFY-OK'));
        const r = await classify('MARK-CLASSIFY-OK the council approved the harbour extension 7-2');
        assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const d = r.body.data;
        // The context is what the model was shown, and it is built from the live structure.
        const shown = d.context.organisms.find((o: any) => o.id === ORG);
        const space = shown?.workspaces?.[0]?.documentSpaces?.[0];
        assert(space?.namespace === NS, `the document space is in the context: ${JSON.stringify(shown)}`);
        assert(space?.examples?.includes('Harbour minutes'), `and a recent title rides as a placement example: ${JSON.stringify(space?.examples)}`);
        assert(d.suggestion.organismId === ORG && d.suggestion.workspaceId === WS && d.suggestion.space === NS,
            `the valid target survived: ${JSON.stringify(d.suggestion)}`);
        assert(d.suggestion.workspaceName === 'Notebook', `the name was attached from the context, got ${d.suggestion.workspaceName}`);
        assert(d.suggestion.confidence === 0.87 && d.suggestion.title === 'Council decision', `title/confidence: ${JSON.stringify(d.suggestion)}`);
        // An id the model invented is dropped, not passed on: an alternative naming an unknown
        // organism resolves to organismId null and is filtered out of the list entirely.
        assert(d.alternatives.length === 1, `the invented organism was dropped, got ${d.alternatives.length}`);
        assert(d.alternatives[0].space === null, `and an unknown space becomes null, got ${d.alternatives[0].space}`);
        assert(d.createNew?.organismName === 'Harbour', `createNew survived: ${JSON.stringify(d.createNew)}`);
        const prompt = provider.lastRequest('chat')!.json as any;
        assert(String(prompt.messages[1].content).includes(ORG), 'the organism id was actually in the prompt');
    });

    await test('7b. A suggestion missing a field falls back rather than inventing one', async () => {
        provider.queue('chat', chatJson('```json\n' + JSON.stringify({
            suggestion: { organismId: ORG, space: NS, confidence: 4 },
        }) + '\n```'), carries('MARK-CLASSIFY-THIN'));
        const note = 'MARK-CLASSIFY-THIN a loose thought';
        const r = await classify(note);
        assert(r.status === 200, `a fenced answer is read, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const s = r.body.data.suggestion;
        assert(s.organismId === ORG && s.workspaceId === null, `no workspace named, so none is claimed: ${JSON.stringify(s)}`);
        assert(s.space === null, 'a space without a workspace cannot resolve');
        assert(s.title === 'Untitled', `title fallback, got ${s.title}`);
        assert(s.markdown === note, 'the note itself is the markdown when the model wrote none');
        assert(s.confidence === 1, `confidence is clamped to 0..1, got ${s.confidence}`);
    });

    await test('7c. An answer that is not JSON is PARSE_ERROR on all three notebook doors', async () => {
        for (const [label, call] of [
            ['classify', () => classify('MARK-PARSE-CLASSIFY note')],
            ['distribute', () => distribute('MARK-PARSE-DISTRIBUTE note')],
        ] as Array<[string, () => Promise<any>]>) {
            provider.queue('chat', chatJson('I am afraid I cannot do that.'), carries(`MARK-PARSE-${label.toUpperCase()}`));
            const r = await call();
            assert(r.status === 502, `${label}: expected 502, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
            assert(r.body.error?.code === 'PARSE_ERROR', `${label}: code ${r.body.error?.code}`);
        }
        provider.queue('chat', chatJson('not json either'), carries('MARK-PARSE-PLAN'));
        const plan = await json('/v1/librarian/plan', {
            method: 'POST', headers: auth(a.token), body: JSON.stringify({ text: 'MARK-PARSE-PLAN note' }),
        });
        assert(plan.status === 502 && plan.body.error?.code === 'PARSE_ERROR', `plan: ${plan.status} ${plan.body.error?.code}`);
    });

    await test('7d. The planner sees the same structure, and a delegate step the catalogue does not know is dropped', async () => {
        provider.queue('chat', chatJson(JSON.stringify({
            summary: 'Two steps',
            confidence: 0.6,
            steps: [
                { id: 's1', kind: 'llm_reason', query: 'what changed', title: 'Think' },
                { id: 's2', kind: 'librarian_assess', query: 'what do I already have' },
                { id: 's3', kind: 'delegate', query: 'ask someone', agent: 'ghost', offerId: 'nope' },
                { id: 's4', kind: 'not-a-kind', query: 'x' },
            ],
        })), carries('MARK-PLAN-OK'));
        const r = await json('/v1/librarian/plan', {
            method: 'POST', headers: auth(a.token),
            body: JSON.stringify({ text: 'MARK-PLAN-OK the harbour note', catalogue: [{ agent: 'other', offerId: 'x' }] }),
        });
        assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const kinds = r.body.data.plan.steps.map((s: any) => s.kind);
        assert(kinds.join(',') === 'llm_reason,librarian_assess', `ungrounded and unknown steps are dropped, got ${kinds.join(',')}`);
        assert(r.body.data.context.organisms.some((o: any) => o.id === ORG), 'the placement context reached the planner');
    });

    await test('7e. Distribute clamps a runaway split to twelve chunks', async () => {
        const chunks = Array.from({ length: 14 }, (_, i) => ({
            organismId: ORG, workspaceId: WS, space: NS, title: `Chunk ${i}`, markdown: `body ${i}`,
            ...(i === 0 ? { createNew: { suggest: true, organismName: 'New Org' } } : {}),
        }));
        provider.queue('chat', chatJson(JSON.stringify({ chunks })), carries('MARK-DISTRIBUTE-MANY'));
        const r = await distribute('MARK-DISTRIBUTE-MANY a long note');
        assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.chunks.length === 12, `the cap holds, got ${r.body.data.chunks.length}`);
        assert(r.body.data.chunks[0].createNew?.organismName === 'New Org', 'a per-chunk create-new hint survives');
        assert(r.body.data.chunks[0].workspaceName === 'Notebook', 'each chunk is resolved against the real structure');
    });

    await test('7f. With the operator prompt deactivated the code template answers instead', async () => {
        // The seeded `notebook-classify` prompt and the code fallback share one source, so the TEXT
        // is the same either way and cannot be told apart in the request. What is provable is that
        // deactivating the managed prompt does not break the feature — which is the branch's job.
        const off = await json('/v1/admin/prompts/notebook-classify', {
            method: 'PATCH', headers: auth(a.token), body: JSON.stringify({ active: false }),
        });
        assert(off.status === 200, `deactivate ${off.status}: ${JSON.stringify(off.body?.error)}`);
        provider.queue('chat', chatJson(JSON.stringify({ suggestion: { organismId: ORG, workspaceId: WS, space: NS, title: 'Fallback', markdown: 'x' } })), carries('MARK-CLASSIFY-FALLBACK'));
        const r = await classify('MARK-CLASSIFY-FALLBACK note');
        assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.suggestion.title === 'Fallback', `answered from the code template, got ${r.body.data.suggestion.title}`);
        const back = await json('/v1/admin/prompts/notebook-classify', {
            method: 'PATCH', headers: auth(a.token), body: JSON.stringify({ active: true }),
        });
        assert(back.status === 200, `reactivate ${back.status}`);
        const stranger = await json('/v1/admin/prompts/notebook-classify', {
            method: 'PATCH', headers: auth(b.token), body: JSON.stringify({ active: false }),
        });
        assert(stranger.status === 403, `only the operator edits a managed prompt, got ${stranger.status}`);
    });

    // ── 8. AI jobs: listing, and cancelling one that is genuinely queued ──────
    // e2e-ai-jobs owns the lifecycle, the fold and the refusals. What is added here is the reading
    // half against a provider that answers: the state filters, and a cancel that lands on a job the
    // single slot has not reached yet.

    const startJob = (owner: Owner, body: Record<string, unknown>) =>
        json('/v1/ai/jobs', { method: 'POST', headers: auth(owner.token), body: JSON.stringify(body) });

    await test('8a. The state filters answer about different sets of jobs', async () => {
        const started = await startJob(a, { prompt: 'MARK-JOB-DONE summarise', result_key: 'aistub.job.done' });
        assert(started.status === 202, `start ${started.status}: ${JSON.stringify(started.body?.error)}`);
        const id = started.body.data.job_id as string;
        const began = Date.now();
        for (;;) {
            const one = await json(`/v1/ai/jobs/${id}`, { headers: auth(a.token) });
            if (one.status === 200 && one.body.data.state === 'done') break;
            assert(Date.now() - began < 20_000, `the job never finished: ${JSON.stringify(one.body?.data ?? one.body)}`);
            await sleep(120);
        }
        const done = await json('/v1/ai/jobs?state=done', { headers: auth(a.token) });
        assert(done.status === 200 && done.body.data.jobs.some((j: any) => j.id === id), 'state=done finds the finished job');
        const live = await json('/v1/ai/jobs?state=live', { headers: auth(a.token) });
        assert(!live.body.data.jobs.some((j: any) => j.id === id), 'and state=live does not');
        const capped = await json('/v1/ai/jobs?state=all&limit=1', { headers: auth(a.token) });
        assert(capped.body.data.jobs.length <= 1, `limit is honoured, got ${capped.body.data.jobs.length}`);
        const bad = await json('/v1/ai/jobs?state=nonsense', { headers: auth(a.token) });
        assert(bad.status === 400, `an unknown state is refused, got ${bad.status}`);
        const answer = await readMemory(a, 'aistub.job.done');
        assert(answer.status === 200 && answer.body.data.value === DEFAULT_ANSWER, `the stub's answer landed at result_key: ${JSON.stringify(answer.body?.data?.value)}`);
    });

    await test('8b. A job the single slot has not reached is cancelled without spending anything', async () => {
        provider.queue('chat', { kind: 'hold' }, carries('MARK-JOB-HOLD'));
        const held = await startJob(a, { prompt: 'MARK-JOB-HOLD hold me', result_key: 'aistub.job.held' });
        assert(held.status === 202, `start ${held.status}`);
        // The held provider call occupies the one slot, so the next start can only queue.
        await sleep(700);
        const queued = await startJob(a, { prompt: 'MARK-JOB-QUEUED', result_key: 'aistub.job.queued' });
        assert(queued.status === 202, `queued start ${queued.status}: ${JSON.stringify(queued.body?.error)}`);
        const listed = await json('/v1/ai/jobs?state=queued', { headers: auth(a.token) });
        assert(listed.body.data.jobs.some((j: any) => j.id === queued.body.data.job_id), 'the second job is queued, not running');
        const stop = await json(`/v1/ai/jobs/${queued.body.data.job_id}/cancel`, { method: 'POST', headers: auth(a.token) });
        assert(stop.status === 200, `cancel ${stop.status}: ${JSON.stringify(stop.body?.error)}`);
        assert(stop.body.data.state === 'cancelled', `state ${stop.body.data.state}`);
        const wrote = await readMemory(a, 'aistub.job.queued');
        assert(wrote.status === 404, 'a cancelled queued job writes no result');
        const stranger = await json(`/v1/ai/jobs/${held.body.data.job_id}`, { headers: auth(b.token) });
        assert(stranger.status === 404, `another owner's job is not found rather than forbidden, got ${stranger.status}`);
        provider.releaseHeld();
    });

    // ── 9. Living documents: the unattended derive loop ───────────────────────
    // Everything from here answers from the DEFAULT replier, because the scheduler fires
    // core:living-pulse on its own clock and a positional script would be a race.

    const SECTION = 'The harbour extension was approved 7-2 〔minutes〕';
    provider.setDefault('chat', (r) => r.body.includes('Stop condition:') ? chatJson('NO') : chatJson(SECTION));

    const livingKey = (ws: string, doc: string) => `organism.${ORG}.w.${ws}.living.${doc}.latest`;
    const slotOf = (ws: string, doc: string, slot: string) => `organism.${ORG}.w.${ws}.living-slot.${doc}__${slot}.latest`;
    const pendingOf = (ws: string, doc: string, slot: string) => `organism.${ORG}.w.${ws}.living-pending.${doc}__${slot}.latest`;

    async function seedLiving(ws: string, doc: string, cfg: Record<string, unknown>, withSource = false) {
        if (withSource) {
            await writeMemory(a, `organism.${ORG}.w.${ws}.living-src.${doc}__intro.latest`, {
                id: 'seed', slot: 'intro', text: 'The council voted 7-2.', origin: 'minutes', active: true,
            });
        }
        const r = await writeMemory(a, livingKey(ws, doc), { type: 'living-config', title: `Living ${doc}`, ...cfg });
        assert(r.status === 201, `living config ${r.status}: ${JSON.stringify(r.body?.error)}`);
    }
    const TEMPLATE = [{ slot: 'intro', section: 'Summary', desc: 'What was decided' }];
    const trigger = () => json('/v1/admin/scheduler/jobs/core:living-pulse/trigger', { method: 'POST', headers: auth(a.token) });
    const statusOf = async (ws: string, doc: string) =>
        ((await readMemory(a, livingKey(ws, doc))).body?.data?.value?.status ?? {}) as Record<string, unknown>;

    await seedLiving('ws-lv-a', 'da', { charter: { cadence: 'hourly', scope: 'the harbour', stop: [{ max_pulses: 1 }] }, template: TEMPLATE, status: {} }, true);
    await seedLiving('ws-lv-b', 'db', { charter: { cadence: 'hourly', scope: 'the harbour', trust: { derive: 'gated' }, stop_when: 'the summary is complete' }, template: TEMPLATE, status: {} }, true);
    await seedLiving('ws-lv-c', 'dc', { charter: { triggers: [{ kind: 'activity', changed_gte: 1 }] }, template: [], status: {} });
    await writeMemory(a, `organism.${ORG}.w.ws-lv-c.notes.stir.latest`, { title: 'Something changed' });
    await seedLiving('ws-lv-d', 'dd', { charter: { cadence: 'hourly', guards: [{ cadence_floor_h: 24 }] }, template: [], status: { last_pulse: new Date().toISOString(), pulses: 0 } });
    await seedLiving('ws-lv-e', 'de', { charter: { cadence: 'hourly', guards: [{ no_workspace_activity_for_h: 1 }] }, template: [], status: {} });
    await seedLiving('ws-lv-f', 'df', { charter: { cadence: 'hourly', triggers: [{ kind: 'schedule' }] }, template: [], status: {} });

    await test('9a. A due instance derives its section from the owner\'s own material and the model\'s answer', async () => {
        const t = await trigger();
        assert(t.status === 200, `trigger ${t.status}: ${JSON.stringify(t.body?.error)}`);
        const slot = await readMemory(a, slotOf('ws-lv-a', 'da', 'intro'));
        assert(slot.status === 200, `the slot was written, got ${slot.status}`);
        assert(slot.body.data.value.markdown === SECTION, `the model's text landed: ${JSON.stringify(slot.body.data.value.markdown).slice(0, 80)}`);
        assert(slot.body.data.value.pending === false, 'an ungated derivation is not parked');
        const status = await statusOf('ws-lv-a', 'da');
        assert(status.pulses === 1, `one pulse, got ${status.pulses}`);
        // The charter said one pulse and no more, so the document retires itself.
        assert(status.health === 'retired', `stop condition retires it, got ${status.health}`);
        assert(/max pulses/.test(String(status.retired_reason)), `and says why: ${status.retired_reason}`);
    });

    await test('9b. A gated charter parks the text for a human instead of publishing it', async () => {
        const pending = await readMemory(a, pendingOf('ws-lv-b', 'db', 'intro'));
        assert(pending.status === 200, `the pending key was written, got ${pending.status}`);
        assert(pending.body.data.value.pending === true, 'and it is marked as awaiting approval');
        const slot = await readMemory(a, slotOf('ws-lv-b', 'db', 'intro'));
        assert(slot.status === 404, `nothing was published, got ${slot.status}`);
        // stop_when was judged by the model, which answered NO, so this one keeps going.
        const status = await statusOf('ws-lv-b', 'db');
        assert(status.health === 'green', `a NO from the judge does not retire it, got ${status.health}`);
    });

    await test('9c. Triggers fire and guards suppress, each for its own declared reason', async () => {
        const activity = await statusOf('ws-lv-c', 'dc');
        assert(activity.pulses === 1, `an activity trigger with a changed record fires, got ${activity.pulses}`);
        const scheduled = await statusOf('ws-lv-f', 'df');
        assert(scheduled.pulses === 1, `a schedule trigger past its cadence fires, got ${scheduled.pulses}`);
        const floored = await statusOf('ws-lv-d', 'dd');
        assert(floored.pulses === 0, `a cadence floor suppresses a pulse that would otherwise be due, got ${floored.pulses}`);
        const quiet = await statusOf('ws-lv-e', 'de');
        assert(quiet.pulses === undefined, `a workspace with no activity is left alone, got ${quiet.pulses}`);
    });

    // ── cleanup ──
    provider.releaseHeld();
    await stopServer(server);
    await provider.close();
    // A leftover temp directory is not a result, and the OS collects it either way.
    try { rmSync(dbDir, { recursive: true, force: true }); } catch { /* the OS will collect it */ }

    console.log(`\n  ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
    console.error('SUITE CRASHED:', err);
    process.exit(1);
});
