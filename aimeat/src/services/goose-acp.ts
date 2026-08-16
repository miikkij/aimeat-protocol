/**
 * @file goose-acp.ts
 * @description A real ACP client for a `goose serve` agent: two channels, bidirectional, and it
 *   answers the agent's callbacks.
 *
 *   The last part is the whole reason this file is not thirty lines. ACP is not request/response —
 *   the agent calls BACK to the client mid-turn to ask permission for a tool call or to read a file,
 *   and a client that never answers leaves the turn hanging forever with no error and no output.
 *   That is exactly what a shell probe produces, which is why the transport was verified with curl
 *   and the prompt path could not be: curl is half a client, and half a client and a broken server
 *   look identical from outside.
 *
 *   Transport, measured against goose 1.45.0 rather than read from a spec:
 *     - POST /acp  — send a JSON-RPC request. Answers with an empty body; the reply arrives elsewhere.
 *     - GET  /acp  — Accept: text/event-stream. EVERY response and notification arrives here.
 *     - `initialize` is the exception: it answers inline and returns the connection id in the
 *       `acp-connection-id` header, which every later call must carry.
 *     - Auth is the header `X-Secret-Key`, not `Authorization: Bearer`.
 * @structure
 *   - GooseAcpClient — connect(), newSession(), prompt(), cancel(), close()
 *   - SessionUpdate — what a turn emits, normalised for the chat surface
 * @usage
 *   const acp = await GooseAcpClient.connect(config);
 *   const sessionId = await acp.newSession({ mcpServers: [aimeatServer(token)] });
 *   for await (const u of acp.prompt(sessionId, 'build me a pong game')) { … }
 * @version-history
 *   v1.0.0 — 2026-08-16 — Initial. The transport below is MEASURED against goose 1.45.0 and works:
 *     initialize, the connection id, the event stream, session/new with per-session MCP servers, and
 *     the error channel all behave as written. `session/prompt` does NOT: goose accepts it and never
 *     answers — no result, no error, not even a validation error for empty params, while an unknown
 *     method errors immediately. Excluded by measurement: a slow model (7 min), a broken MCP
 *     extension (clean profile), the provider (`goose run` answers in 5 s on the same profile), and
 *     a client that ignores the agent's callbacks, which was the strongest hypothesis and the reason
 *     this file answers them. So this client is finished and blocked upstream rather than unfinished.
 *     See docs/internal/owncustomchatinterface/04 §3c for the reproduction and the next three moves.
 */
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
    | { kind: 'done'; stopReason: string }
    | { kind: 'error'; message: string };

interface JsonRpcMessage {
    jsonrpc: '2.0';
    id?: number | string;
    method?: string;
    params?: Record<string, unknown>;
    result?: unknown;
    error?: { code: number; message: string };
}

/** How long a single turn may run before the client gives up on it. Turns take minutes, not seconds. */
const TURN_TIMEOUT_MS = 15 * 60_000;

export class GooseAcpClient {
    private nextId = 100;
    private readonly pending = new Map<number | string, {
        resolve: (v: unknown) => void; reject: (e: Error) => void;
    }>();
    private readonly bus = new EventEmitter();
    private abort: AbortController | null = null;
    private closed = false;

    private constructor(
        private readonly baseUrl: string,
        private readonly secret: string,
        private readonly connectionId: string,
    ) {
        // One listener per in-flight turn plus the stream itself; the default of 10 is too few once a
        // handful of people are talking at once, and the warning it prints is not a real leak.
        this.bus.setMaxListeners(256);
    }

    private headers(extra: Record<string, string> = {}): Record<string, string> {
        return {
            'X-Secret-Key': this.secret,
            'acp-connection-id': this.connectionId,
            ...extra,
        };
    }

    /**
     * Handshake, then open the event stream.
     *
     * The client capabilities are declared HONESTLY: this client has no filesystem and no terminal,
     * because the node it runs in has neither to offer a hosted agent. Claiming otherwise and then
     * failing the callback is worse than saying no up front — the agent plans around what the client
     * says it can do.
     */
    static async connect(config: AimeatConfig): Promise<GooseAcpClient> {
        const baseUrl = config.gooseUrl.replace(/\/+$/, '');
        const secret = config.gooseSecret;
        if (!baseUrl) throw new Error('AIMEAT_GOOSE_URL is not set; the chat agent is disabled.');

        const resp = await fetch(`${baseUrl}/acp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Secret-Key': secret },
            body: JSON.stringify({
                jsonrpc: '2.0', id: 1, method: 'initialize',
                params: {
                    protocolVersion: 1,
                    clientCapabilities: {
                        fs: { readTextFile: false, writeTextFile: false },
                        terminal: false,
                    },
                },
            }),
        });
        if (!resp.ok) throw new Error(`goose initialize: HTTP ${resp.status}`);
        const connectionId = resp.headers.get('acp-connection-id');
        if (!connectionId) throw new Error('goose initialize returned no acp-connection-id');
        const body = await resp.json() as JsonRpcMessage;
        if (body.error) throw new Error(`goose initialize: ${body.error.message}`);

        const client = new GooseAcpClient(baseUrl, secret, connectionId);
        await client.openStream();
        logger.info(`[goose] ACP connected (${connectionId})`);
        return client;
    }

    /** Open the SSE channel and pump it. Every reply and notification comes through here. */
    private async openStream(): Promise<void> {
        this.abort = new AbortController();
        const resp = await fetch(`${this.baseUrl}/acp`, {
            method: 'GET',
            headers: this.headers({ Accept: 'text/event-stream' }),
            signal: this.abort.signal,
        });
        if (!resp.ok || !resp.body) throw new Error(`goose stream: HTTP ${resp.status}`);

        void (async () => {
            const reader = resp.body!.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            try {
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    // SSE frames are separated by a blank line. A line starting with ':' is a
                    // keep-alive comment and carries nothing.
                    let cut: number;
                    while ((cut = buffer.indexOf('\n\n')) !== -1) {
                        const frame = buffer.slice(0, cut);
                        buffer = buffer.slice(cut + 2);
                        for (const line of frame.split('\n')) {
                            if (!line.startsWith('data:')) continue;
                            const payload = line.slice(5).trim();
                            if (!payload) continue;
                            try {
                                this.dispatch(JSON.parse(payload) as JsonRpcMessage);
                            } catch (err) {
                                logger.warn(`[goose] unparseable frame: ${String(err)}`);
                            }
                        }
                    }
                }
            } catch (err) {
                if (!this.closed) logger.warn(`[goose] stream ended: ${String(err)}`);
            } finally {
                this.failAllPending(new Error('goose stream closed'));
            }
        })();
    }

    /**
     * Route one message: a reply to something we asked, a REQUEST from the agent that we must answer,
     * or a notification.
     */
    private dispatch(msg: JsonRpcMessage): void {
        // A reply to us.
        if (msg.id !== undefined && !msg.method) {
            const waiter = this.pending.get(msg.id);
            if (waiter) {
                this.pending.delete(msg.id);
                if (msg.error) waiter.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
                else waiter.resolve(msg.result);
            }
            return;
        }

        // A request FROM the agent. Answering these is what keeps a turn moving; ignoring one hangs
        // it silently and forever, which is the failure this client exists to avoid.
        if (msg.method && msg.id !== undefined) {
            void this.answerAgentRequest(msg);
            return;
        }

        // A notification. session/update carries the turn's contents.
        if (msg.method === 'session/update') {
            const params = msg.params as { sessionId?: string; update?: Record<string, unknown> } | undefined;
            if (params?.sessionId) this.bus.emit(`update:${params.sessionId}`, params.update ?? {});
        }
    }

    /**
     * Answer the agent's callbacks.
     *
     * Permission is granted, because the node has already decided what this session may do: the
     * session's MCP token carries the owner's scopes, and the tool surface refuses what it must. A
     * second yes/no here would be a permission model in a place that cannot see the identity.
     *
     * Filesystem and terminal are refused, matching what connect() declared. A hosted agent has no
     * machine, and the draft tools are how it writes.
     */
    private async answerAgentRequest(msg: JsonRpcMessage): Promise<void> {
        const method = msg.method!;
        let result: unknown;
        let error: { code: number; message: string } | undefined;

        if (method === 'session/request_permission') {
            const opts = (msg.params as { options?: Array<{ optionId?: string; kind?: string }> } | undefined)?.options ?? [];
            const allow = opts.find((o) => o.kind === 'allow_always')
                ?? opts.find((o) => o.kind === 'allow_once')
                ?? opts[0];
            result = { outcome: { outcome: 'selected', optionId: allow?.optionId ?? 'allow' } };
        } else if (method.startsWith('fs/') || method.startsWith('terminal/')) {
            error = { code: -32601, message: 'This client has no filesystem or terminal.' };
        } else {
            error = { code: -32601, message: `Unsupported client method: ${method}` };
        }

        try {
            await fetch(`${this.baseUrl}/acp`, {
                method: 'POST',
                headers: this.headers({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(error
                    ? { jsonrpc: '2.0', id: msg.id, error }
                    : { jsonrpc: '2.0', id: msg.id, result }),
            });
        } catch (err) {
            logger.warn(`[goose] failed to answer ${method}: ${String(err)}`);
        }
    }

    private failAllPending(err: Error): void {
        for (const [, waiter] of this.pending) waiter.reject(err);
        this.pending.clear();
    }

    /** Send a request and wait for its reply on the stream. */
    private async call(method: string, params: Record<string, unknown>, timeoutMs = 60_000): Promise<unknown> {
        if (this.closed) throw new Error('goose client is closed');
        const id = this.nextId++;
        const done = new Promise<unknown>((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            setTimeout(() => {
                if (this.pending.delete(id)) reject(new Error(`goose ${method} timed out after ${timeoutMs}ms`));
            }, timeoutMs).unref?.();
        });

        const resp = await fetch(`${this.baseUrl}/acp`, {
            method: 'POST',
            headers: this.headers({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        });
        if (!resp.ok) {
            this.pending.delete(id);
            throw new Error(`goose ${method}: HTTP ${resp.status}`);
        }
        return done;
    }

    /** Start a session with its own MCP servers. `cwd` is required by the protocol and unused here. */
    async newSession(opts: { mcpServers: AcpMcpServer[]; cwd?: string }): Promise<string> {
        const result = await this.call('session/new', {
            cwd: opts.cwd ?? process.cwd(),
            mcpServers: opts.mcpServers,
        }) as { sessionId?: string; extensionLoadResults?: Array<{ name: string; success: boolean; error?: string }> };

        // A session is created even when an MCP server failed to load, so the failure only shows in
        // this list. Reading it is the difference between "the chat has its tools" and "the chat
        // exists"; measured on a node that was down, where the session came back fine and empty.
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

        const turn = this.call('session/prompt', {
            sessionId,
            prompt: [{ type: 'text', text }],
        }, TURN_TIMEOUT_MS)
            .then((r) => push({ kind: 'done', stopReason: String((r as { stopReason?: string })?.stopReason ?? 'end_turn') }))
            .catch((e: Error) => push({ kind: 'error', message: e.message }));

        try {
            for (;;) {
                if (queue.length === 0) {
                    await new Promise<void>((resolve) => { wake = resolve; });
                }
                const next = queue.shift();
                if (!next) continue;
                yield next;
                if (next.kind === 'done' || next.kind === 'error') break;
            }
        } finally {
            this.bus.off(`update:${sessionId}`, onUpdate);
            void turn;
        }
    }

    /** Ask the agent to stop the current turn. */
    async cancel(sessionId: string): Promise<void> {
        await this.call('session/cancel', { sessionId }, 15_000).catch((e: Error) => {
            logger.warn(`[goose] cancel failed: ${e.message}`);
        });
    }

    close(): void {
        this.closed = true;
        this.abort?.abort();
        this.failAllPending(new Error('goose client closed'));
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
