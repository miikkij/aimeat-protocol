/**
 * @file scripts/chat-turn-measure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Runs ONE chat turn on a node of its own, with real goose and a real model, and
 *   reports what the person would have seen and when: the first event, the first words, every tool
 *   call, how the turn ended, and whether an agent proposal was written.
 *
 *   WHY. A chat turn's length is the model's behaviour, and no fake agent shows it. On 2026-10-02 a
 *   hosted place answered "I want a new agent that goes through my CRM every morning" with 1927
 *   thought events, 21 tool calls and no words in 150 s. This script is how that turn is reproduced
 *   and how a change to it is measured.
 *
 *   THE ROUTE IS THE HOSTED PLACE'S: the node route (no shared goose key), the model calls through
 *   this node's /v1/llm with the person's own chat token, the node's OpenRouter key paying from an
 *   allowance, and AIMEAT_MODEL_DEFAULT_CHAT naming the model (the fleet images name
 *   deepseek/deepseek-v4-pro-0813). goose gets a GOOSE_PATH_ROOT of its own, so the developer's own
 *   goose configuration (its extensions, its provider) never reaches the turn.
 *
 *   IT SPENDS MONEY, and only from a CAPPED TEST KEY: OPENROUTER_TEST_KEY, from the environment or
 *   from scripts/.env in the main checkout, never printed. A key without a spending limit is refused
 *   before anything runs (asked of OpenRouter's /api/v1/key).
 *
 *   PER ROUND. Every model call passes a recording proxy on the next port, which forwards it to
 *   OpenRouter unchanged except for asking for the cost, and notes the tools it carried, the tokens
 *   in (and how many were cached), the tokens out and the cost.
 * @structure readKey · assertCapped · startRecorder · startNode · registerOwner · runTurn · main
 * @usage
 *   cd aimeat && pnpm exec tsx scripts/chat-turn-measure.ts
 *   cd aimeat && pnpm exec tsx scripts/chat-turn-measure.ts --text "Mikä on Suomen pääkaupunki?"
 *   options: --port 40471 (the proxy takes the next) · --model deepseek/deepseek-v4-pro-0813 · --lang fi · --wait-s 240 · --out <file.json>
 *     · --allow-uncapped (only when the key's owner said so)
 * @version-history
 *   v1.1.0 — 2026-10-02 — A capped test key only (OPENROUTER_TEST_KEY); the cost and the tokens of
 *     every model call, from a recording proxy.
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const NODE_ID = 'aimeat-local-001-dev';
const DEFAULT_TEXT = 'Haluan uuden agentin, joka käy joka aamu läpi CRM:ni avoimet kaupat ja kirjoittaa listan siitä, mihin pitää tarttua tänään.';

function arg(name: string, fallback: string): string {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const sleep = (ms: number) => new Promise<void>((r) => { setTimeout(r, ms); });

/** The variable the test key is read from. Never OPENROUTER_API_KEY: that one has no spending limit. */
const KEY_VAR = 'OPENROUTER_TEST_KEY';

/** The capped test key: the environment first, then scripts/.env in the main checkout. */
function readKey(): string {
    if (process.env[KEY_VAR]) return process.env[KEY_VAR]!;
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
    const file = join(dirname(common), 'scripts', '.env');
    if (!existsSync(file)) throw new Error(`no ${KEY_VAR} in the environment and no ${file}`);
    const line = readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${KEY_VAR}=`));
    const key = line?.slice(KEY_VAR.length + 1).trim().replace(/^["']|["']$/g, '');
    if (!key) throw new Error(`${KEY_VAR} is not set in ${file}. A measurement runs on a capped test key only.`);
    return key;
}

/**
 * Refuse a key with no spending limit. Testing never runs on a production key (Jouni, 2026-10-02),
 * and the key that sat in scripts/.env then had `limit: null`. OpenRouter's /api/v1/key says the
 * limit without the key being shown anywhere.
 */
async function assertCapped(key: string): Promise<{ limit: number; remaining: number | null }> {
    const res = await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${key}` } });
    const body = await res.json() as { data?: { limit?: number | null; limit_remaining?: number | null } };
    const limit = body.data?.limit;
    if (typeof limit !== 'number') {
        // Only by name, on the command line, so an uncapped key is never used without someone saying so.
        if (process.argv.includes('--allow-uncapped')) return { limit: Number.POSITIVE_INFINITY, remaining: null };
        throw new Error(`refused: the key in ${KEY_VAR} has no spending limit. Give it one at openrouter.ai, use another key, or pass --allow-uncapped when the owner of the key said so.`);
    }
    return { limit, remaining: body.data?.limit_remaining ?? null };
}

/** One model call, as the recording proxy saw it. */
interface ModelCall { t: number; tools: number; requestChars: number; prompt?: number; cached?: number; completion?: number; cost?: number }

/**
 * A recording proxy between the node and OpenRouter. The node keeps only a day's total per owner, and
 * the question is what each ROUND costs: how many tokens went in, how many were cached, what it cost.
 * OpenRouter puts `usage` (with `cost`) in the last chunk of a streamed answer.
 */
function startRecorder(port: number, started: () => number): { calls: ModelCall[]; close: () => void } {
    const calls: ModelCall[] = [];
    const server = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', async () => {
            const body = Buffer.concat(chunks);
            let parsed: { tools?: unknown[]; usage?: unknown; stream?: boolean } = {};
            try { parsed = JSON.parse(body.toString('utf8') || '{}'); } catch { /* not JSON */ }
            // Ask for the cost in the answer; OpenRouter accepts it on any chat completion.
            if (req.method === 'POST' && req.url?.endsWith('/chat/completions')) parsed.usage = { include: true };
            const forwarded = req.method === 'POST' ? JSON.stringify(parsed) : undefined;
            const call: ModelCall = { t: started(), tools: Array.isArray(parsed.tools) ? parsed.tools.length : 0, requestChars: body.length };
            if (req.method === 'POST' && req.url?.endsWith('/chat/completions')) calls.push(call);
            const headers: Record<string, string> = {};
            for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string' && !['host', 'content-length', 'connection'].includes(k)) headers[k] = v;
            const upstream = await fetch(`https://openrouter.ai${req.url}`, { method: req.method, headers, body: forwarded });
            res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
            const reader = upstream.body?.getReader();
            let tail = '';
            while (reader) {
                const { value, done } = await reader.read();
                if (done) break;
                res.write(value);
                tail = (tail + Buffer.from(value).toString('utf8')).slice(-8000);
            }
            res.end();
            const usageMatch = tail.match(/"usage":(\{[^{}]*(\{[^{}]*\}[^{}]*)*\})/g);
            if (usageMatch) {
                try {
                    const u = JSON.parse(usageMatch.at(-1)!.slice('"usage":'.length)) as { prompt_tokens?: number; completion_tokens?: number; cost?: number; prompt_tokens_details?: { cached_tokens?: number } };
                    call.prompt = u.prompt_tokens; call.completion = u.completion_tokens; call.cost = u.cost;
                    call.cached = u.prompt_tokens_details?.cached_tokens;
                } catch { /* a usage block this script cannot read leaves the call without numbers */ }
            }
        });
    });
    server.listen(port, '127.0.0.1');
    return { calls, close: () => server.close() };
}

interface Node { proc: ChildProcess; base: string; dir: string; output: () => string }

async function startNode(port: number, model: string, key: string, recorderPort: number): Promise<Node> {
    const dir = mkdtempSync(join(tmpdir(), 'aimeat-chat-measure-'));
    const base = `http://127.0.0.1:${port}`;
    let output = '';
    const proc = spawn(process.execPath, [
        '--import', 'tsx', 'src/index.ts', 'start', '--db', 'sqlite', '--db-path', join(dir, 'node.db'), '--port', String(port),
    ], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            AIMEAT_PORT: String(port), AIMEAT_BASE_URL: base, AIMEAT_NODE_ID: NODE_ID,
            AIMEAT_DB: 'sqlite', AIMEAT_DB_PATH: join(dir, 'node.db'), AIMEAT_LOG_LEVEL: 'info',
            AIMEAT_ENCRYPTION_KEY: '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20',
            AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000', AIMEAT_RL_MEMORY: '1000',
            // The hosted place's chat: goose on the node route, the node's key, the fleet's model.
            AIMEAT_GOOSE_BIN: process.env.AIMEAT_GOOSE_BIN || 'goose',
            AIMEAT_GOOSE_PROVIDER_API_KEY: '',
            AIMEAT_GOOSE_PROVIDER: '',
            AIMEAT_GOOSE_MODEL: model,
            AIMEAT_GOOSE_PATH_ROOT: join(dir, 'goose'),
            AIMEAT_OPENROUTER_INSTANCE_KEY: key,
            AIMEAT_MODEL_DEFAULT_CHAT: model,
            AIMEAT_CHAT_FREE_ALLOWANCE_USD: '1000',
            // Every model call through the recording proxy, which forwards it to OpenRouter as it is.
            AIMEAT_AI_FIXED_BASEURL_OVERRIDES: JSON.stringify({ openrouter: `http://127.0.0.1:${recorderPort}/api/v1` }),
            AIMEAT_ALLOW_PRIVATE_EGRESS: 'true',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout?.on('data', (c: Buffer) => { output += c.toString(); });
    proc.stderr?.on('data', (c: Buffer) => { output += c.toString(); });
    for (let i = 0; i < 120; i++) {
        if (proc.exitCode !== null) throw new Error(`the node exited:\n${output.slice(-2000)}`);
        try { if ((await fetch(`${base}/v1/spec`)).ok) return { proc, base, dir, output: () => output }; } catch { /* not up yet */ }
        await sleep(500);
    }
    throw new Error(`the node did not answer on ${base}`);
}

/** The envelope's `data`, loosely: this script reads a handful of known fields from it. */
interface Envelope { data: Record<string, unknown> & { proposals?: Proposal[] } }
interface Proposal { name: string; purpose: string; crew_def?: unknown; scopes?: string[] }

async function call(base: string, path: string, init: RequestInit = {}, token?: string): Promise<Envelope> {
    const res = await fetch(`${base}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    return res.json();
}

async function registerOwner(base: string, name: string): Promise<string> {
    const reg = await call(base, '/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    const priv = reg.data.private_key as string;
    const timestamp = new Date().toISOString();
    const sig = await ed.signAsync(new TextEncoder().encode(name + NODE_ID + timestamp), Buffer.from(priv, 'base64'));
    const tok = await call(base, '/v1/auth/token', {
        method: 'POST', body: JSON.stringify({ owner: name, timestamp, signature: Buffer.from(sig).toString('base64') }),
    });
    return tok.data.token as string;
}

interface Seen { t: number; kind: string; [k: string]: unknown }

/** One turn, read as it arrives, each event stamped with the milliseconds since the request. */
async function runTurn(base: string, token: string, threadId: string, text: string, lang: string, waitMs: number): Promise<{ events: Seen[]; ended: boolean }> {
    const started = Date.now();
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), waitMs);
    const events: Seen[] = [];
    let ended = false;
    try {
        const res = await fetch(`${base}/v1/chat/threads/${threadId}/turn`, {
            method: 'POST', signal: abort.signal,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            // The page sends its own language; so does this.
            body: JSON.stringify({ text, lang }),
        });
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
            const { value, done } = await reader.read();
            if (done) { ended = true; break; }
            buffer += decoder.decode(value, { stream: true });
            let cut: number;
            while ((cut = buffer.indexOf('\n\n')) !== -1) {
                const frame = buffer.slice(0, cut);
                buffer = buffer.slice(cut + 2);
                if (!frame.startsWith('data:')) continue;
                const ev = JSON.parse(frame.slice(5).trim());
                // What a finished call answered, which is how a refused proposal says why.
                const content = ev.kind === 'tool_call' && ev.status !== 'pending' ? ev.raw?.content : undefined;
                const result = Array.isArray(content)
                    ? content.map((c: { content?: { text?: string }; text?: string }) => c?.content?.text ?? c?.text ?? '').join('\n').slice(0, 1500)
                    : undefined;
                // goose's usage_update says how full the context is, which is what each round waits on.
                const usage = ev.kind === 'other' && ev.type === 'usage_update' ? ev.raw : undefined;
                events.push({ t: Date.now() - started, ...ev, raw: undefined, ...(result ? { result } : {}), ...(usage ? { usage } : {}) });
            }
        }
    } catch (err) {
        if ((err as Error).name !== 'AbortError') throw err;
    } finally {
        clearTimeout(timer);
    }
    return { events, ended };
}

async function main(): Promise<void> {
    const port = Number(arg('port', '40471'));
    const model = arg('model', 'deepseek/deepseek-v4-pro-0813');
    const text = arg('text', DEFAULT_TEXT);
    const waitMs = Number(arg('wait-s', '240')) * 1000;
    const out = arg('out', '');

    const key = readKey();
    const cap = await assertCapped(key);
    console.log(`key: capped at ${cap.limit} USD, ${cap.remaining ?? '?'} USD left`);
    let turnStart = 0;
    const recorder = startRecorder(port + 1, () => (turnStart ? Date.now() - turnStart : -1));
    const node = await startNode(port, model, key, port + 1);
    try {
        const token = await registerOwner(node.base, `measure${Date.now().toString(36)}`);
        const thread = await call(node.base, '/v1/chat/threads', { method: 'POST', body: '{}' }, token);
        const threadId = (thread.data.thread as { id: string }).id;
        turnStart = Date.now();
        const { events, ended } = await runTurn(node.base, token, threadId, text, arg('lang', 'fi'), waitMs);
        const spent = await call(node.base, '/v1/ai/usage', {}, token);

        const by = (k: string) => events.filter((e) => e.kind === k);
        const tools = new Map<string, { title: string; status: string; t: number }>();
        for (const e of by('tool_call')) {
            const id = String(e.id || e.title);
            const seen = tools.get(id);
            if (seen) { seen.status = String(e.status); if (e.title) seen.title = String(e.title); }
            else tools.set(id, { title: String(e.title), status: String(e.status), t: e.t });
        }
        const firstVisible = events.find((e) => e.kind === 'text' || e.kind === 'progress');
        const firstText = by('text')[0];
        const answer = by('text').map((e) => e.text).join('');
        const done = events.find((e) => e.kind === 'done' || e.kind === 'error');
        const proposals = await call(node.base, '/v1/agents/v2/agent-proposals', {}, token);

        const summary = {
            model, text, ended,
            last_event_ms: events.at(-1)?.t ?? null,
            first_visible_ms: firstVisible?.t ?? null,
            first_model_text_ms: firstText?.t ?? null,
            done: done ? { kind: done.kind, at_ms: done.t, stopReason: done.stopReason, message: done.message } : null,
            counts: Object.fromEntries([...new Set(events.map((e) => e.kind))].map((k) => [k, by(k).length])),
            tool_calls: [...tools.values()].map((v) => `${(v.t / 1000).toFixed(1)}s ${v.status} ${v.title}`),
            failed_results: by('tool_call').filter((e) => e.status === 'failed' && e.result).map((e) => e.result),
            progress: by('progress').map((e) => `${(e.t / 1000).toFixed(1)}s ${e.step}${e.detail ? ` (${e.detail})` : ''}`),
            guard: by('guard').map((e) => `${(e.t / 1000).toFixed(1)}s ${e.reason} ${e.phase}`),
            usage: events.filter((e) => e.usage).map((e) => `${(e.t / 1000).toFixed(1)}s ${JSON.stringify(e.usage)}`),
            proposal_ready_ms: by('tool_call').find((e) => e.status === 'completed' && /agent propose/.test(String(tools.get(String(e.id || e.title))?.title ?? '')))?.t ?? null,
            // Each model call: when it was sent, how many tools it carried, tokens in (cached of them), out, and its cost.
            model_calls: recorder.calls.map((c) => `${(c.t / 1000).toFixed(1)}s tools ${c.tools} in ${c.prompt ?? '?'} (cached ${c.cached ?? '?'}) out ${c.completion ?? '?'} cost ${c.cost ?? '?'}`),
            turn_cost_usd: recorder.calls.reduce((sum, c) => sum + (c.cost ?? 0), 0),
            node_recorded_usd: spent?.data?.spent_today_usd ?? null,
            answer,
            proposals: (proposals?.data?.proposals ?? []).map((p) => ({ name: p.name, purpose: p.purpose, has_crew_def: !!p.crew_def, scopes: p.scopes })),
        };
        console.log(JSON.stringify(summary, null, 2));
        if (out) writeFileSync(resolve(out), JSON.stringify({ summary, events }, null, 2));
        const warnings = node.output().split('\n').filter((l) => /\[(chat|goose)\]/.test(l)).slice(-40);
        if (warnings.length) console.log(`\n--- node log ([chat]/[goose]) ---\n${warnings.join('\n')}`);
    } finally {
        recorder.close();
        node.proc.kill();
        await Promise.race([once(node.proc, 'exit'), sleep(10_000)]);
        await sleep(1000);
        try { rmSync(node.dir, { recursive: true, force: true }); } catch { /* Windows may hold the db a moment longer */ }
    }
}

main().catch((err) => { console.error(err); process.exit(1); });
