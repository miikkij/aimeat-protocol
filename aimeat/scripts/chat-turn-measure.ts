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
 *   IT SPENDS MONEY: one turn on the node's key. The key is read from OPENROUTER_API_KEY, or from
 *   scripts/.env in the main checkout (the file scripts/gen_image.py reads), and never printed.
 * @structure readKey · startNode · registerOwner · runTurn · main
 * @usage
 *   cd aimeat && pnpm exec tsx scripts/chat-turn-measure.ts
 *   cd aimeat && pnpm exec tsx scripts/chat-turn-measure.ts --text "Mikä on Suomen pääkaupunki?"
 *   options: --port 40471 · --model deepseek/deepseek-v4-pro-0813 · --lang fi · --wait-s 240 · --out <file.json>
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

/** The OpenRouter key: the environment first, then scripts/.env in the main checkout. */
function readKey(): string {
    if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
    const file = join(dirname(common), 'scripts', '.env');
    if (!existsSync(file)) throw new Error(`no OPENROUTER_API_KEY in the environment and no ${file}`);
    const line = readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.startsWith('OPENROUTER_API_KEY='));
    const key = line?.slice('OPENROUTER_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
    if (!key) throw new Error(`OPENROUTER_API_KEY is empty in ${file}`);
    return key;
}

interface Node { proc: ChildProcess; base: string; dir: string; output: () => string }

async function startNode(port: number, model: string, key: string): Promise<Node> {
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

    const node = await startNode(port, model, readKey());
    try {
        const token = await registerOwner(node.base, `measure${Date.now().toString(36)}`);
        const thread = await call(node.base, '/v1/chat/threads', { method: 'POST', body: '{}' }, token);
        const threadId = (thread.data.thread as { id: string }).id;
        const { events, ended } = await runTurn(node.base, token, threadId, text, arg('lang', 'fi'), waitMs);

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
            answer,
            proposals: (proposals?.data?.proposals ?? []).map((p) => ({ name: p.name, purpose: p.purpose, has_crew_def: !!p.crew_def, scopes: p.scopes })),
        };
        console.log(JSON.stringify(summary, null, 2));
        if (out) writeFileSync(resolve(out), JSON.stringify({ summary, events }, null, 2));
        const warnings = node.output().split('\n').filter((l) => /\[(chat|goose)\]/.test(l)).slice(-40);
        if (warnings.length) console.log(`\n--- node log ([chat]/[goose]) ---\n${warnings.join('\n')}`);
    } finally {
        node.proc.kill();
        await Promise.race([once(node.proc, 'exit'), sleep(10_000)]);
        await sleep(1000);
        try { rmSync(node.dir, { recursive: true, force: true }); } catch { /* Windows may hold the db a moment longer */ }
    }
}

main().catch((err) => { console.error(err); process.exit(1); });
