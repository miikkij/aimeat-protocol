/**
 * @file goose-acp.ts
 * @description An ACP client for a goose agent, over stdio, that answers the agent's callbacks.
 *
 *   The callbacks are why this is not thirty lines. ACP is bidirectional: the agent calls BACK
 *   mid-turn to ask permission for a tool call or to read a file, and a client that never answers
 *   leaves the turn hanging forever with no error and no output.
 *
 *   STDIO, NOT HTTP, and that was measured rather than chosen for taste. `goose serve` exposes the
 *   same protocol over HTTP and its transport works for requests — initialize, session/new, even a
 *   clean -32601 for an unknown method — but it never delivers a single `session/update`
 *   notification, so a turn produces nothing and hangs. The identical prompt over `goose acp` on
 *   stdio answers in 5.2 s with agent_message_chunk and a stopReason. Measured on goose 1.45.0 and
 *   1.46.0, with the model call visible on the provider's side in both cases.
 *
 *   Stdio is also the better fit here: no port, no shared secret, no loopback surface to protect,
 *   and the lifetime of the agent is a plain child process.
 * @structure
 *   - GooseAcpClient — start(), newSession(), prompt(), cancel(), close()
 *   - SessionUpdate — what a turn emits, normalised for the chat surface
 * @usage
 *   const acp = await GooseAcpClient.start(config);
 *   const sessionId = await acp.newSession({ mcpServers: [aimeatMcpServer(base, token)] });
 *   for await (const u of acp.prompt(sessionId, 'build me a pong game')) { … }
 * @version-history
 *   v2.0.1 — 2026-08-16 — Listen for the child's `error` event. A binary that cannot be spawned
 *     emits `error` rather than `exit`, and an unlistened `error` is thrown: one wrong character in
 *     an operator's path took the whole node down on the first person who said hello, and the turn
 *     waited out the 30 s handshake timeout first.
 *   v2.0.0 — 2026-08-16 — Stdio replaces HTTP. `goose serve` delivers no session/update over its
 *     HTTP transport, which makes every turn silent; `goose acp` on stdio delivers them and the
 *     same turn completes in seconds. The dispatch, the callback answers and the update
 *     normalisation are unchanged — only the pipe moved.
 *   v1.0.0 — 2026-08-16 — Initial, over `goose serve` HTTP.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { AimeatConfig } from '../config.js';
import { logger } from '../utils/logger.js';

/** An MCP server handed to one session. `http` is the transport goose reports as supported. */
export interface AcpMcpServer {
    name: string;
    type: 'http';
    url: string;
    headers?: Array<{ name: string; value: string }>;
}

/** One thing that happened during a turn, flattened for the chat surface to render. */
export type SessionUpdate =
    | { kind: 'text'; text: string }
    | { kind: 'thought'; text: string }
    | { kind: 'tool_call'; id: string; title: string; status: string; raw: unknown }
    | { kind: 'other'; type: string; raw: unknown }
    | { kind: 'done'; stopReason: string; tokens?: number }
    | { kind: 'error'; message: string };

interface JsonRpcMessage {
    jsonrpc: '2.0';
    id?: number | string;
    method?: string;
    params?: Record<string, unknown>;
    result?: unknown;
    error?: { code: number; message: string; data?: unknown };
}

/** How long one turn may run. Turns take minutes when an agent is building something. */
const TURN_TIMEOUT_MS = 15 * 60_000;
/** How long the handshake may take before the child is considered broken. */
const HANDSHAKE_TIMEOUT_MS = 30_000;

export class GooseAcpClient {
    private nextId = 100;
    private readonly pending = new Map<number | string, {
        resolve: (v: unknown) => void; reject: (e: Error) => void;
    }>();
    private readonly bus = new EventEmitter();
    private buffer = '';
    private closed = false;

    private constructor(private readonly child: ChildProcessWithoutNullStreams) {
        // One listener per in-flight turn; the default of 10 is too few once a handful of people are
        // talking at once, and the warning it prints is not a real leak.
        this.bus.setMaxListeners(256);

        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => this.onData(chunk));
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (d: string) => {
            const line = d.trim();
            if (line) logger.warn(`[goose] ${line.slice(0, 500)}`);
        });
        child.on('exit', (code, signal) => {
            this.closed = true;
            this.failAllPending(new Error(`goose exited (code ${code}, signal ${signal})`));
            logger.warn(`[goose] agent process exited: code ${code}, signal ${signal}`);
        });
        // A child process that cannot be spawned at all — a path that names no binary — emits `error`
        // rather than `exit`, and an `error` nobody listens for is thrown. Without this line one
        // wrong character in the operator's configuration takes the whole node down on the first
        // person who says hello, instead of failing that one turn with the reason.
        child.on('error', (err: Error) => {
            this.closed = true;
            this.failAllPending(new Error(`goose could not be started: ${err.message}`));
            logger.warn(`[goose] agent process could not be started: ${err.message}`);
        });
    }

    /**
     * Start the agent and shake hands.
     *
     * Client capabilities are declared HONESTLY: no filesystem, no terminal. The node has neither to
     * offer a hosted agent, and claiming otherwise then failing the callback is worse than saying no
     * up front — the agent plans around what the client says it can do.
     */
    static async start(config: AimeatConfig): Promise<GooseAcpClient> {
        const bin = config.gooseBin || 'goose';
        const env: NodeJS.ProcessEnv = { ...process.env };
        if (config.goosePathRoot) env.GOOSE_PATH_ROOT = config.goosePathRoot;
        // Every model call this agent makes is billed to whoever owns this key. The node decides who
        // may spend it before a turn is ever started; goose only sees the key.
        if (config.gooseProviderApiKey) env.OPENROUTER_API_KEY = config.gooseProviderApiKey;

        const child = spawn(bin, ['acp'], { stdio: ['pipe', 'pipe', 'pipe'], env });
        const client = new GooseAcpClient(child);

        const info = await client.call('initialize', {
            protocolVersion: 1,
            clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
        }, HANDSHAKE_TIMEOUT_MS) as { agentInfo?: { name?: string; version?: string } };

        logger.info(`[goose] agent ready: ${info.agentInfo?.name ?? 'goose'} ${info.agentInfo?.version ?? ''}`);
        return client;
    }

    /** Split the stream into lines; every line is one JSON-RPC message. */
    private onData(chunk: string): void {
        this.buffer += chunk;
        let cut: number;
        while ((cut = this.buffer.indexOf('\n')) !== -1) {
            const line = this.buffer.slice(0, cut).trim();
            this.buffer = this.buffer.slice(cut + 1);
            if (!line) continue;
            try {
                this.dispatch(JSON.parse(line) as JsonRpcMessage);
            } catch {
                // goose writes the occasional human line to stdout; it is not a protocol error.
                logger.info(`[goose] ${line.slice(0, 300)}`);
            }
        }
    }

    /** A reply to us, a request FROM the agent that must be answered, or a notification. */
    private dispatch(msg: JsonRpcMessage): void {
        if (msg.id !== undefined && !msg.method) {
            const waiter = this.pending.get(msg.id);
            if (!waiter) return;
            this.pending.delete(msg.id);
            if (msg.error) {
                const detail = msg.error.data ? ` (${JSON.stringify(msg.error.data)})` : '';
                waiter.reject(new Error(`${msg.error.code}: ${msg.error.message}${detail}`));
            } else {
                waiter.resolve(msg.result);
            }
            return;
        }

        if (msg.method && msg.id !== undefined) {
            this.answerAgentRequest(msg);
            return;
        }

        if (msg.method === 'session/update') {
            const params = msg.params as { sessionId?: string; update?: Record<string, unknown> } | undefined;
            if (params?.sessionId) this.bus.emit(`update:${params.sessionId}`, params.update ?? {});
        }
    }

    /**
     * Answer the agent's callbacks.
     *
     * Permission is granted, because the node already decided what this session may do: the session's
     * MCP token carries the owner's scopes and the tool surface refuses what it must. A second
     * yes/no here would be a permission model in a place that cannot see the identity.
     *
     * Filesystem and terminal are refused, matching what start() declared.
     */
    private answerAgentRequest(msg: JsonRpcMessage): void {
        const method = msg.method!;
        if (method === 'session/request_permission') {
            const opts = (msg.params as { options?: Array<{ optionId?: string; kind?: string }> } | undefined)?.options ?? [];
            const allow = opts.find((o) => o.kind === 'allow_always')
                ?? opts.find((o) => o.kind === 'allow_once')
                ?? opts[0];
            this.write({
                jsonrpc: '2.0', id: msg.id,
                result: { outcome: { outcome: 'selected', optionId: allow?.optionId ?? 'allow' } },
            });
            return;
        }
        this.write({
            jsonrpc: '2.0', id: msg.id,
            error: { code: -32601, message: 'This client has no filesystem or terminal.' },
        });
    }

    private write(msg: unknown): void {
        if (this.closed) return;
        this.child.stdin.write(`${JSON.stringify(msg)}\n`);
    }

    private failAllPending(err: Error): void {
        for (const [, waiter] of this.pending) waiter.reject(err);
        this.pending.clear();
    }

    private call(method: string, params: Record<string, unknown>, timeoutMs = 60_000): Promise<unknown> {
        if (this.closed) return Promise.reject(new Error('goose agent is not running'));
        const id = this.nextId++;
        const done = new Promise<unknown>((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            setTimeout(() => {
                if (this.pending.delete(id)) reject(new Error(`goose ${method} timed out after ${timeoutMs}ms`));
            }, timeoutMs).unref?.();
        });
        this.write({ jsonrpc: '2.0', id, method, params });
        return done;
    }

    /** Start a session with its own MCP servers. `cwd` is required by the protocol and unused here. */
    async newSession(opts: { mcpServers: AcpMcpServer[]; cwd?: string }): Promise<string> {
        const result = await this.call('session/new', {
            cwd: opts.cwd ?? process.cwd(),
            mcpServers: opts.mcpServers,
        }) as { sessionId?: string; extensionLoadResults?: Array<{ name: string; success: boolean; error?: string }> };

        // A session is created even when an MCP server failed to load, so the failure shows only in
        // this list. Reading it is the difference between "the chat has its tools" and "the chat
        // exists"; measured against a node that was down, where the session came back fine and empty.
        for (const ext of result.extensionLoadResults ?? []) {
            if (!ext.success) logger.warn(`[goose] extension "${ext.name}" failed to load: ${ext.error ?? 'unknown'}`);
        }
        if (!result.sessionId) throw new Error('goose session/new returned no sessionId');
        return result.sessionId;
    }

    /** Run one turn, yielding what happens as it happens. */
    async *prompt(sessionId: string, text: string): AsyncGenerator<SessionUpdate> {
        const queue: SessionUpdate[] = [];
        let wake: (() => void) | null = null;
        const push = (u: SessionUpdate) => { queue.push(u); wake?.(); wake = null; };

        const onUpdate = (update: Record<string, unknown>) => push(normalise(update));
        this.bus.on(`update:${sessionId}`, onUpdate);

        void this.call('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }, TURN_TIMEOUT_MS)
            .then((r) => {
                const res = r as { stopReason?: string; usage?: { totalTokens?: number } };
                push({ kind: 'done', stopReason: String(res?.stopReason ?? 'end_turn'), tokens: res?.usage?.totalTokens });
            })
            .catch((e: Error) => push({ kind: 'error', message: e.message }));

        try {
            for (;;) {
                if (queue.length === 0) await new Promise<void>((resolve) => { wake = resolve; });
                const next = queue.shift();
                if (!next) continue;
                yield next;
                if (next.kind === 'done' || next.kind === 'error') break;
            }
        } finally {
            this.bus.off(`update:${sessionId}`, onUpdate);
        }
    }

    /** Ask the agent to stop the current turn. */
    async cancel(sessionId: string): Promise<void> {
        await this.call('session/cancel', { sessionId }, 15_000).catch((e: Error) => {
            logger.warn(`[goose] cancel failed: ${e.message}`);
        });
    }

    /** Stop the agent. SIGTERM first; a child that ignores it is killed after a grace period. */
    close(): void {
        if (this.closed) return;
        this.closed = true;
        this.failAllPending(new Error('goose client closed'));
        try {
            this.child.kill('SIGTERM');
            setTimeout(() => {
                // eslint-disable-next-line aimeat/no-silent-catch -- the child is already gone, which is the outcome this line wanted
                try { this.child.kill('SIGKILL'); } catch { /* exited on SIGTERM */ }
            }, 5_000).unref?.();
        } catch (err) {
            logger.warn(`[goose] could not stop the agent: ${String(err)}`);
        }
    }
}

/** Flatten one session/update into something the chat surface can render without knowing ACP. */
function normalise(update: Record<string, unknown>): SessionUpdate {
    const kind = String(update.sessionUpdate ?? 'unknown');
    const content = update.content as { text?: string } | undefined;
    switch (kind) {
        case 'agent_message_chunk':
            return { kind: 'text', text: content?.text ?? '' };
        case 'agent_thought_chunk':
            return { kind: 'thought', text: content?.text ?? '' };
        case 'tool_call':
        case 'tool_call_update':
            return {
                kind: 'tool_call',
                id: String(update.toolCallId ?? ''),
                title: String(update.title ?? ''),
                status: String(update.status ?? 'pending'),
                raw: update,
            };
        default:
            // usage_update, session_info_update, available_commands_update and whatever goose adds
            // next. Kept rather than dropped: the chat shows spend and the work log from these.
            return { kind: 'other', type: kind, raw: update };
    }
}

/** The aimeat MCP server, as one session's tool surface, carrying that person's own agent token. */
export function aimeatMcpServer(baseUrl: string, agentToken: string): AcpMcpServer {
    return {
        name: 'aimeat',
        type: 'http',
        url: `${baseUrl.replace(/\/+$/, '')}/v1/mcp`,
        headers: [{ name: 'Authorization', value: `Bearer ${agentToken}` }],
    };
}
