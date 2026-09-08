/**
 * @file test/helpers/fake-ai-provider.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An OpenAI-compatible provider on loopback that a node under test can be pointed at,
 *   and that a suite can script per request.
 *
 *   WHY IT EXISTS. Every AI path in this node ends at one HTTP transport (services/openrouter.ts),
 *   and every suite that reaches that transport stops at the gate in front of it, because CI has no
 *   provider key and no model. So the refusals are proven and the answers are not: the streamed
 *   frame forwarding, the moderation retry, the multipart transcription form, the model-list name
 *   fallback and the JSON parsing of a classifier's reply have never been executed by a test. This
 *   stands in for the provider and for nothing else — the node still decrypts its own settings,
 *   picks its own model, opens a real socket and does its own accounting.
 *
 *   HOW IT IS SCRIPTED. Two ways, and the second is the one that survives a background job firing
 *   mid-suite. `queue(route, reply)` is FIFO: the next request on that route takes it. `queue(route,
 *   reply, match)` binds the reply to a PREDICATE over the recorded request, so a reply meant for
 *   one prompt cannot be eaten by an unrelated call that happened to arrive first. Anything the
 *   script does not claim falls to the route's default.
 *
 *   Every request is recorded whole — method, path, query, headers and body — so a suite can assert
 *   what the node actually sent rather than only what it did with the answer.
 * @structure
 *   - RecordedRequest / StubReply / Reply — what is recorded, and what may be answered
 *   - startFakeAiProvider() — bind on 127.0.0.1 and return the handle
 *   - FakeAiProvider — queue/setDefault/requestsFor/releaseHeld/reset/close
 *   - chatJson / chatErrorBody / sseChat / modelsJson / transcriptionJson / imageJson /
 *     providerStatus — the reply shapes, so a suite states intent rather than JSON
 * @usage
 *   const provider = await startFakeAiProvider(40315);
 *   provider.queue('chat', chatJson('hello'));
 *   // … point the node at provider.baseUrl and drive it …
 *   await provider.close();
 * @version-history
 *   v1.0.0 — 2026-09-08 — Initial creation, with e2e-ai-provider-stub.ts.
 */
import { createServer, type Server, type ServerResponse } from 'node:http';

/** Which door of the provider a request arrived at. `other` is anything else, recorded not refused. */
export type StubRoute = 'chat' | 'models' | 'transcriptions' | 'images' | 'other';

/** One request as the provider saw it. `bytes` is the body untouched; `body` is it as UTF-8, which
 *  is what the multipart assertions read (the field markers are ASCII either way). */
export interface RecordedRequest {
    route: StubRoute;
    method: string;
    url: string;
    pathname: string;
    query: URLSearchParams;
    headers: Record<string, string>;
    bytes: Buffer;
    body: string;
    /** The body parsed as JSON, or null when it is not JSON. */
    json: Record<string, unknown> | null;
}

export type StubReply =
    | { kind: 'json'; status?: number; body: unknown }
    | { kind: 'text'; status: number; body: string; contentType?: string }
    /** Server-sent events, written verbatim. `body` is the exact bytes, so a suite can compare. */
    | { kind: 'sse'; body: string }
    /** Hold the socket open until releaseHeld(), which is how a job is kept `running` on purpose. */
    | { kind: 'hold' };

export type Reply = StubReply | ((req: RecordedRequest) => StubReply);

interface Scripted {
    reply: Reply;
    match?: (req: RecordedRequest) => boolean;
}

export interface FakeAiProvider {
    port: number;
    /** What the node's `openrouter.settings.baseUrl` is set to. */
    baseUrl: string;
    /** Every request, oldest first. */
    requests: RecordedRequest[];
    requestsFor(route: StubRoute): RecordedRequest[];
    lastRequest(route?: StubRoute): RecordedRequest | undefined;
    /** Answer the next request on this route (optionally only one the predicate accepts). */
    queue(route: StubRoute, reply: Reply, match?: (req: RecordedRequest) => boolean): void;
    /** What a request answers when nothing scripted claims it. */
    setDefault(route: StubRoute, reply: Reply): void;
    /** Release everything held open, answering it with the route's default. */
    releaseHeld(): void;
    /** Forget the recorded requests and the pending script. Defaults survive. */
    reset(): void;
    close(): Promise<void>;
}

function routeOf(pathname: string): StubRoute {
    if (pathname.endsWith('/chat/completions')) return 'chat';
    if (pathname.endsWith('/models')) return 'models';
    if (pathname.endsWith('/audio/transcriptions')) return 'transcriptions';
    if (pathname.endsWith('/images/generations')) return 'images';
    return 'other';
}

// ── the reply shapes ─────────────────────────────────────────────────────────

/** A whole (non-streamed) chat completion. */
export function chatJson(
    content: string,
    opts: { model?: string; usage?: Record<string, number>; finishReason?: string } = {},
): StubReply {
    return {
        kind: 'json',
        body: {
            id: 'chatcmpl-stub',
            model: opts.model ?? 'stub/test-model',
            choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: opts.finishReason ?? 'stop' }],
            usage: opts.usage ?? { prompt_tokens: 7, completion_tokens: 11, total_tokens: 18, cost: 0.0003 },
        },
    };
}

/** A 200 that still carries an error, which OpenAI-compatible providers do and callers forget. */
export function chatErrorBody(message: string, code?: number): StubReply {
    return { kind: 'json', body: { model: 'stub/test-model', error: { message, ...(code ? { code } : {}) } } };
}

/**
 * A streamed completion as the frames go on the wire.
 *
 * The exact string is handed back on the reply so a suite can assert the node forwarded it byte for
 * byte; anything rewritten in the middle would be a second dialect for a client to learn.
 */
export function sseChat(
    deltas: string[],
    opts: { model?: string; usage?: Record<string, number> } = {},
): { reply: StubReply; body: string } {
    const model = opts.model ?? 'stub/test-model';
    const frames = deltas.map(d =>
        `data: ${JSON.stringify({ id: 'chatcmpl-stub', model, choices: [{ index: 0, delta: { content: d } }] })}\n\n`);
    frames.push(`data: ${JSON.stringify({
        id: 'chatcmpl-stub', model, choices: [],
        usage: opts.usage ?? { prompt_tokens: 5, completion_tokens: 9, total_tokens: 14, cost: 0.0002 },
    })}\n\n`);
    frames.push('data: [DONE]\n\n');
    const body = frames.join('');
    return { reply: { kind: 'sse', body }, body };
}

/** A model catalogue, in the `{ data: [...] }` envelope every OpenAI-compatible provider uses. */
export function modelsJson(models: unknown[]): StubReply {
    return { kind: 'json', body: { data: models } };
}

/** One transcription result. `usage` present means the provider reported a real charge. */
export function transcriptionJson(v: {
    text: string; language?: string; model?: string; usage?: Record<string, number>;
}): StubReply {
    return {
        kind: 'json',
        body: {
            text: v.text,
            ...(v.language ? { language: v.language } : {}),
            ...(v.model ? { model: v.model } : {}),
            ...(v.usage ? { usage: v.usage } : {}),
        },
    };
}

/** One image generation. Either `b64` (the `b64_json` field) or `dataUrl` (a data: URL). */
export function imageJson(v: { b64?: string; dataUrl?: string; cost?: number; errorMessage?: string }): StubReply {
    if (v.errorMessage) return { kind: 'json', body: { error: { message: v.errorMessage } } };
    const first = v.b64 !== undefined ? { b64_json: v.b64 } : v.dataUrl !== undefined ? { url: v.dataUrl } : undefined;
    return {
        kind: 'json',
        body: {
            ...(first ? { data: [first] } : {}),
            ...(typeof v.cost === 'number' ? { usage: { cost: v.cost } } : {}),
        },
    };
}

/** A provider failure with a status and a body, which is how the node learns the reason. */
export function providerStatus(status: number, body: string, contentType = 'application/json'): StubReply {
    return { kind: 'text', status, body, contentType };
}

// ── the server ───────────────────────────────────────────────────────────────

const BUILT_IN_DEFAULTS: Record<StubRoute, Reply> = {
    chat: chatJson('The stub provider answered.'),
    models: modelsJson([]),
    transcriptions: transcriptionJson({ text: 'the stub transcript' }),
    // Unscripted image and unknown calls answer a NAMED failure rather than something plausible, so
    // a missing line of script reads as a missing line of script.
    images: providerStatus(500, '{"error":{"message":"fake-ai-provider: no image reply was scripted"}}'),
    other: providerStatus(404, '{"error":{"message":"fake-ai-provider: no such route"}}'),
};

export async function startFakeAiProvider(port: number): Promise<FakeAiProvider> {
    const requests: RecordedRequest[] = [];
    const scripted: Record<StubRoute, Scripted[]> = {
        chat: [], models: [], transcriptions: [], images: [], other: [],
    };
    const defaults: Record<StubRoute, Reply> = { ...BUILT_IN_DEFAULTS };
    const held: Array<{ route: StubRoute; req: RecordedRequest; res: ServerResponse }> = [];

    const resolveReply = (req: RecordedRequest): StubReply => {
        const queue = scripted[req.route];
        const at = queue.findIndex(s => !s.match || s.match(req));
        const chosen = at >= 0 ? queue.splice(at, 1)[0].reply : defaults[req.route];
        return typeof chosen === 'function' ? chosen(req) : chosen;
    };

    const write = (res: ServerResponse, reply: StubReply): void => {
        if (reply.kind === 'json') {
            res.writeHead(reply.status ?? 200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(reply.body));
            return;
        }
        if (reply.kind === 'text') {
            res.writeHead(reply.status, { 'Content-Type': reply.contentType ?? 'text/plain' });
            res.end(reply.body);
            return;
        }
        // 'sse': the frames as given, with no buffering in the way.
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        res.end(reply.body);
    };

    const server: Server = createServer((raw, res) => {
        const chunks: Buffer[] = [];
        raw.on('data', (c: Buffer) => { chunks.push(c); });
        raw.on('end', () => {
            const bytes = Buffer.concat(chunks);
            const url = raw.url ?? '/';
            const parsed = new URL(url, `http://127.0.0.1:${port}`);
            const body = bytes.toString('utf8');
            let json: Record<string, unknown> | null = null;
            if ((raw.headers['content-type'] ?? '').includes('json') && body) {
                // A body that does not parse stays available as raw text on `body`, which is what an
                // assertion about a malformed request wants to look at.
                try { json = JSON.parse(body) as Record<string, unknown>; } catch { json = null; }
            }
            const req: RecordedRequest = {
                route: routeOf(parsed.pathname),
                method: raw.method ?? 'GET',
                url,
                pathname: parsed.pathname,
                query: parsed.searchParams,
                headers: Object.fromEntries(
                    Object.entries(raw.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v ?? '')]),
                ),
                bytes,
                body,
                json,
            };
            requests.push(req);
            const reply = resolveReply(req);
            if (reply.kind === 'hold') { held.push({ route: req.route, req, res }); return; }
            write(res, reply);
        });
    });

    await new Promise<void>(resolve => { server.listen(port, '127.0.0.1', () => resolve()); });

    const releaseHeld = (): void => {
        while (held.length) {
            const entry = held.shift();
            if (!entry) continue;
            const fallback = defaults[entry.route];
            const resolved = typeof fallback === 'function' ? fallback(entry.req) : fallback;
            // A default that is itself 'hold' would hold for ever, so the release answers something.
            const reply: StubReply = resolved.kind === 'hold' ? chatJson('released') : resolved;
            // The socket may already be gone because the node cancelled the call, which is a normal
            // end for a held request and not a failure of the release.
            try { write(entry.res, reply); } catch { /* the caller hung up */ }
        }
    };

    return {
        port,
        baseUrl: `http://127.0.0.1:${port}/v1`,
        requests,
        requestsFor: (route) => requests.filter(r => r.route === route),
        lastRequest: (route) => {
            const pool = route ? requests.filter(r => r.route === route) : requests;
            return pool[pool.length - 1];
        },
        queue: (route, reply, match) => { scripted[route].push({ reply, ...(match ? { match } : {}) }); },
        setDefault: (route, reply) => { defaults[route] = reply; },
        releaseHeld,
        reset: () => {
            requests.length = 0;
            for (const route of Object.keys(scripted) as StubRoute[]) scripted[route].length = 0;
        },
        close: async () => {
            releaseHeld();
            await new Promise<void>(resolve => { server.close(() => resolve()); });
        },
    };
}
