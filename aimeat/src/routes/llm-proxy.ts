/**
 * @file src/routes/llm-proxy.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An OpenAI-compatible door in front of the node's own AI decisions, so an agent that
 *   speaks that dialect spends money under the same rules as everything else here.
 *
 *   WHY THIS EXISTS. The built-in chat runs on goose, and goose talks to a model provider directly.
 *   Its provider key is process-wide, so every person's turn would arrive on the node's key with
 *   nothing between them and it: no allowance, no daily budget, no per-app quota, no usage record,
 *   no free-model fallback when the allowance runs out. This route is that something. Point the
 *   agent's provider at it and every turn goes through the same gate `/v1/ai/complete` goes through.
 *
 *   IT DECIDES NOTHING ITSELF. Which pocket pays, which model answers, whether the allowance is
 *   spent and a free model has to answer instead of a refusal: `prepareAiCall` decides all of it,
 *   and `settleAiCall` records what happened. This file translates between OpenAI's request shape
 *   and those two, and moves bytes. A second copy of the key choice or the budget test is exactly
 *   the defect this is built to prevent.
 *
 *   THE MODEL IS THE NODE'S CHOICE, NOT THE CALLER'S. A caller naming a model is asking the node to
 *   spend on it, and the node is the one that knows whose money this is and how much is left. The
 *   owner's own preference decides, then the node's default for the role — the same order every
 *   other AI surface uses — and the answer says which model actually ran. Honouring the caller's
 *   name instead would also disable the free-model fallback, because an explicit model is
 *   deliberately left alone by `prepareAiCall`.
 * @structure
 *   - llmProxyRouter(config, storage) — POST /v1/llm/chat/completions, GET /v1/llm/models
 * @usage mounted in server-bootstrap/routes-loader.ts; an agent uses <node>/v1/llm as its base URL
 * @version-history
 *   v1.7.1 — 2026-10-04 — The session_id is the system message's hash alone, not the payer's, so every
 *     conversation with the same prefix reaches the provider that holds it.
 *   v1.7.0 — 2026-10-04 — A call to OpenRouter carries a session_id (cacheSessionId), so every round of a
 *     conversation reaches the provider that holds its prompt cache.
 *   v1.6.0 — 2026-10-04 — `parallel_tool_calls` is passed to the provider beside `tools`; it was dropped,
 *     so a crew could not turn parallel tool calls off on the node route (crewfive's wish). A value
 *     that is not a boolean is refused 400.
 *   v1.5.0 — 2026-10-02 — A spent own or agent key (402 from the provider) is retried once on the free
 *     router before the first byte, as /v1/ai/complete does (route-run.ts noCreditRetry).
 *   v1.4.0 — 2026-09-28 — AI roles: a call may name the AI role it runs as, in the body's `role` or
 *     the X-AIMEAT-AI-Role header (what an OpenAI-compatible client can send), passed to prepareAiCall.
 *     The caller still names no model; the owner's role decides the providers and models.
 *   v1.3.0 — 2026-09-28 — Providers (System 2 plan, V3): the owner's candidates are tried in order
 *     before the first byte, by the owner's rules; an Anthropic provider answers through the
 *     gateway's OpenAI chat converter, byte-compatible with the others; the attempts that failed
 *     before a fallback are usage rows of their own.
 *   v1.2.0 — 2026-09-28 — The model policy: the caller goes to the gate, a refusal carries its details, and
 *     GET /v1/llm/models lists only the models the owner's policy allows.
 *   v1.1.0 — 2026-09-20 — An agent's call is paid by its OWNER, in the agent's name (aiPayerOf): the
 *     agent's own key first, then the owner's, then the server's, under the owner's daily budget
 *     and the agent's cap. Until now the payer was the agent's own namespace.
 *   v1.0.0 — 2026-08-16 — Initial.
 */
import { createHash } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { assertAiUseAllowed } from '../auth/ai-gate.js';
import { error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { aiPayerOf } from '../services/agent-ai-keys.js';
import { aiCallerOf } from './ai-policy.js';
import {
    prepareAiCall, settleAiCall, AiCompletionError, planFor, recordFailedAttempts, type AiCallPlan,
} from '../services/ai-completion.js';
import { readCallRole } from '../services/ai-call-guards.js';
import { chatCompletionRaw, listModels } from '../services/openrouter.js';
import { openAiChat, speaksOpenAiChat, type OpenAiChatBody } from '../services/ai/gateway.js';
import { runRoute } from '../services/ai/route-run.js';
import { callCost } from '../services/ai/catalog/price.js';
import type { CostSource } from '../services/ai/types.js';
import { logger } from '../utils/logger.js';

/** A turn can take minutes when the model is reasoning; the default socket timeout is not enough. */
const TURN_TIMEOUT_MS = 10 * 60_000;

interface ChatMessage { role: string; content: unknown }

/** What came back, however it came back: one shape for the streamed and the whole-response case. */
interface ProviderOutcome {
    model: string;
    content: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
    costSource: CostSource;
    priceRef: string;
}

export function llmProxyRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();
    // The same ceiling the other AI doors run under. A proxy without one is the cheapest way to
    // spend an operator's money, and it reads the same operator setting as /v1/ai/complete.
    const aiRateLimit = rateLimit(config.rateLimits.openrouter);

    /**
     * GET /v1/llm/models — the models this node will actually run.
     *
     * An OpenAI-shaped client asks this before it asks for anything else. The list comes from the
     * provider through the same service the model pickers use, so a model that appears here is one
     * the node can genuinely reach.
     */
    router.get('/v1/llm/models', requireAuth(), requireScope('ai:use'), aiRateLimit, async (req: Request, res: Response) => {
        if (!assertAiUseAllowed(req, res, config.nodeId)) return;
        // The same payer the completion below resolves, so the list is of the models that key reaches.
        const { payer: gaii, agent } = aiPayerOf(resolveIdentity(req.auth!, config.nodeId));
        try {
            // A client that sends its role on every call sends it here too, and then lists the
            // models of the provider that role would use.
            const role = proxyRole(req);
            const plan = await prepareAiCall(storage, config, gaii, {
                appId: 'llm-proxy', ...(agent ? { agent } : {}), ...aiCallerOf(req, config.nodeId), ...(role ? { role } : {}),
            });
            // A provider that does not speak this dialect has no OpenAI-shaped list: the model the
            // node would use is the one it lists.
            const models = speaksOpenAiChat(plan.providerType)
                ? await listModels(plan.key, plan.baseUrl, 'chat')
                : [{ id: plan.model }];
            // OpenAI's shape, because that is what a client asking this URL parses.
            res.json({
                object: 'list',
                // Only the models the owner's policy allows: a client picking from this list must not
                // pick one the node would then refuse.
                data: models
                    .filter((m) => plan.allowedModels === 'any'
                        || plan.allowedModels.some((r) => r.toLowerCase() === `${plan.providerType}:${m.id}`.toLowerCase()))
                    .map((m) => ({ id: m.id, object: 'model', owned_by: plan.provider })),
            });
        } catch (err) {
            sendError(res, config.nodeId, err);
        }
    });

    /**
     * POST /v1/llm/chat/completions — one completion, streamed or whole.
     *
     * `requireScope('ai:use')` sits in the middleware chain and `assertAiUseAllowed` runs in the
     * handler, and they are not redundant: owner sessions bypass scopes entirely, so the middleware
     * alone would let a mirrored agent token through, and the in-handler test alone is invisible to
     * the route-authorization gate. Together they admit exactly one set of callers.
     *
     * The gate runs before the provider is touched and the accounting runs after it answers, which
     * is the order that matters: a call that was refused must never have been paid for, and a call
     * that was paid for must never go unrecorded.
     */
    router.post('/v1/llm/chat/completions', requireAuth(), requireScope('ai:use'), aiRateLimit, async (req: Request, res: Response) => {
        if (!assertAiUseAllowed(req, res, config.nodeId)) return;
        // An agent's call is paid by its owner, in the agent's name (services/agent-ai-keys.ts).
        const { payer: gaii, agent } = aiPayerOf(resolveIdentity(req.auth!, config.nodeId));

        const body = (req.body ?? {}) as CacheSessionBody & {
            stream?: boolean;
            temperature?: number; top_p?: number; max_tokens?: number;
            tools?: unknown; tool_choice?: unknown; response_format?: unknown; parallel_tool_calls?: unknown;
        };
        if (!Array.isArray(body.messages) || body.messages.length === 0) {
            res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'messages is required.'));
            return;
        }
        if (body.parallel_tool_calls !== undefined && typeof body.parallel_tool_calls !== 'boolean') {
            res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'parallel_tool_calls must be true or false.'));
            return;
        }

        let plan: AiCallPlan;
        try {
            // `model` is deliberately not passed through: see the file header. The node decides.
            // A role is the caller's word on WHAT the call is for, which the owner's roles turn into
            // providers and models (services/ai/roles.ts); it is read, and refused when malformed,
            // before anything else happens. Never forwarded upstream: `upstream` below names its fields.
            const role = proxyRole(req);
            // The agent's own key pays first and its daily cap applies; then the owner's key, then the server's.
            plan = await prepareAiCall(storage, config, gaii, {
                appId: 'llm-proxy', ...(agent ? { agent } : {}), ...aiCallerOf(req, config.nodeId), ...(role ? { role } : {}),
            });
        } catch (err) {
            sendError(res, config.nodeId, err);
            return;
        }

        const upstream = {
            model: plan.model,
            messages: body.messages,
            ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
            ...(body.top_p !== undefined ? { top_p: body.top_p } : {}),
            ...(body.max_tokens !== undefined ? { max_tokens: body.max_tokens } : {}),
            // Tool calling is the whole point for an agent: passed through untouched, because the
            // node has no opinion about which tools a caller offers its own model.
            ...(body.tools !== undefined ? { tools: body.tools } : {}),
            ...(body.tool_choice !== undefined ? { tool_choice: body.tool_choice } : {}),
            // Whether the model may ask for several tools in one answer. Only beside `tools`: OpenAI
            // refuses the field on a request without them. An Anthropic provider gets it as its own
            // setting through the gateway's converter (adapters/openai-chat.ts).
            ...(typeof body.parallel_tool_calls === 'boolean' && body.tools !== undefined
                ? { parallel_tool_calls: body.parallel_tool_calls } : {}),
            ...(body.response_format !== undefined ? { response_format: body.response_format } : {}),
            ...(body.stream ? { stream: true, stream_options: { include_usage: true } } : {}),
        };

        req.setTimeout(TURN_TIMEOUT_MS);
        res.setTimeout(TURN_TIMEOUT_MS);
        const controller = new AbortController();
        req.on('close', () => controller.abort());

        // The owner's candidates in order, moving on only BEFORE the first byte: a provider that
        // refused or did not answer (services/ai/route-run.ts). Once a stream has started, the
        // client has part of an answer and a second provider would be a different text.
        let provider: globalThis.Response;
        let answered: AiCallPlan;
        try {
            const run = await runRoute({
                storage, gaii, capability: plan.capability, candidates: plan.candidates, chosenBy: plan.chosenBy,
                allowFallback: plan.allowFallback, rules: plan.rules, signal: controller.signal,
                ...(plan.noCreditModel ? { noCreditModel: plan.noCreditModel } : {}),
            }, async (c) => {
                // Through the openrouter service or the gateway, never straight out of this file:
                // `pnpm check:llm-transport` holds that, because a second place speaking to a provider
                // is a second place that can forget to meter. An Anthropic provider does not speak
                // this dialect, so the gateway answers for it in the same shape.
                // OpenRouter keeps a conversation on one provider, which is what makes its prompt cache
                // hit, only once it has seen a cache hit, unless the request names a session_id
                // (cacheSessionId below). Only for OpenRouter: another provider may refuse the field.
                const routed = c.provider.type === 'openrouter'
                    ? { ...upstream, model: c.model, session_id: cacheSessionId(body) }
                    : { ...upstream, model: c.model };
                const r = speaksOpenAiChat(c.provider.type)
                    ? await chatCompletionRaw(c.target.key, c.target.baseUrl, routed, controller.signal)
                    : await openAiChat(c.target, c.model, { ...upstream, model: c.model } as OpenAiChatBody, controller.signal);
                if (r.ok) return r;
                // eslint-disable-next-line aimeat/no-silent-catch -- the body only enriches an error already being reported; an unreadable one is honestly reported as empty
                const detail = await r.text().catch(() => '');
                throw Object.assign(new Error(detail || `The provider answered ${r.status}.`), { status: r.status, detail });
            });
            provider = run.result;
            answered = planFor(plan, run.candidate);
            if (run.route.fellBack) await recordFailedAttempts(storage, config, gaii, plan, run.failed, { appId: 'llm-proxy', source: 'llm-proxy' });
        } catch (err) {
            const e = err as { status?: number; detail?: string; route?: { fellBack: boolean }; failed?: Parameters<typeof recordFailedAttempts>[4] };
            if (e.route?.fellBack && e.failed) await recordFailedAttempts(storage, config, gaii, plan, e.failed, { appId: 'llm-proxy', source: 'llm-proxy' });
            sendError(res, config.nodeId, typeof e.status === 'number'
                ? providerFailure(e.status, e.detail ?? '')
                : new AiCompletionError('PROVIDER_ERROR', 502, (err as Error).message));
            return;
        }

        try {
            const outcome = body.stream
                ? await pipeStream(provider, res, answered)
                : await passWhole(provider, res, answered);
            await settleAiCall(storage, config, gaii, answered, {
                ...outcome, appId: 'llm-proxy', source: 'llm-proxy',
            });
        } catch (err) {
            // The provider may already have written half an answer, so there is nothing to send but
            // the log line. Never swallowed: an operator seeing this knows a turn was spent and not
            // recorded, which is the one bookkeeping failure that matters.
            logger.warn(`[llm-proxy] ${gaii}: ${(err as Error).message}`);
            if (!res.headersSent) sendError(res, config.nodeId, err);
            else res.end();
        }
    });

    return router;
}

interface CacheSessionBody { messages?: ChatMessage[]; session_id?: unknown; prompt_cache_key?: unknown }

/**
 * The session_id OpenRouter routes a conversation by, so every round of it reaches the provider that
 * holds its prompt cache. OpenRouter's own default key is the first system message and the first other
 * message, but it applies that only after it has seen a cache hit; on a model several providers serve
 * (DeepSeek), the rounds before that scatter and nothing is cached (no hit in any round of three agent
 * requests, measured 2026-10-02, commit 08de02e25). The caller's own session_id or prompt_cache_key wins;
 * otherwise a hash of the system message alone. The system message and the tools are the prefix a
 * prompt cache reuses, and they are the same for every conversation of the same agent on this node, so
 * every one of them goes to the provider that already holds that prefix. A first version hashed the
 * payer in too: each person then got a provider of their own, and a person's first question found no
 * cache (measured 2026-10-04: a second one-line question cached 2 048 of 11 339 tokens, against
 * 18 432 of 19 472 on OpenRouter's own default). The key carries neither the person nor the content.
 */
export function cacheSessionId(body: CacheSessionBody): string {
    for (const given of [body.session_id, body.prompt_cache_key]) {
        if (typeof given === 'string' && given.trim()) return given.trim().slice(0, 256);
    }
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const system = messages.find((m) => m?.role === 'system' || m?.role === 'developer');
    const hash = createHash('sha256').update(JSON.stringify(system?.content ?? '')).digest('hex');
    return `aimeat-${hash.slice(0, 40)}`;
}

/** The header an OpenAI-compatible client sends its AI role in (aimeat-crewai node_llm(role=...)). */
const LLM_ROLE_HEADER = 'x-aimeat-ai-role';

/**
 * The AI role a /v1/llm call names: the body's `role`, or the X-AIMEAT-AI-Role header, which is how
 * an OpenAI-compatible client carries it (it can set a header on every call, and it cannot add a
 * top-level body field without a client-specific option). Both given and different is refused, so
 * the call never runs as a role the caller did not mean. Validated by readCallRole: 1 to 300 characters.
 */
function proxyRole(req: Request): string | undefined {
    const fromBody = readCallRole((req.body as { role?: unknown } | undefined)?.role);
    const header = req.get(LLM_ROLE_HEADER);
    const fromHeader = header === undefined ? undefined : readCallRole(header);
    if (fromBody && fromHeader && fromBody !== fromHeader) {
        throw new AiCompletionError('INVALID_BODY', 400,
            `The body's role (${fromBody}) and the X-AIMEAT-AI-Role header (${fromHeader}) differ; send one of them.`);
    }
    return fromBody ?? fromHeader;
}

/** A provider status turned into the node's own vocabulary, so a caller sees a named cause. */
function providerFailure(status: number, detail: string): AiCompletionError {
    const short = detail.slice(0, 300);
    if (status === 401 || status === 403) {
        return new AiCompletionError('INVALID_API_KEY', 401, `The provider rejected the key. ${short}`);
    }
    if (status === 429) {
        // The one a free model hits first: the free tier's request ceiling depends on what the
        // account has bought, so this is a quota answer and not a fault in the request.
        return new AiCompletionError('RATE_LIMITED', 429,
            `The model is rate limited right now. Free models hit this first. ${short}`);
    }
    if (status === 502 || status === 503) {
        return new AiCompletionError('PROVIDER_ERROR', 502,
            `The model is overloaded or unavailable. ${short}`);
    }
    return new AiCompletionError('PROVIDER_ERROR', 502, `The provider answered ${status}. ${short}`);
}

/** Send whatever went wrong in the node's envelope, with its own code. */
function sendError(res: Response, nodeId: string, err: unknown): void {
    const e = err as AiCompletionError;
    const status = typeof e?.status === 'number' ? e.status : 500;
    const code = typeof e?.code === 'string' ? e.code : 'INTERNAL_ERROR';
    res.status(status).json(error(nodeId, code, e?.message || 'The completion failed.', status, e?.details));
}

/** Whole-response: hand it on unchanged, and read the accounting out of it. */
async function passWhole(
    provider: globalThis.Response, res: Response, plan: AiCallPlan,
): Promise<ProviderOutcome> {
    const json = await provider.json() as {
        model?: string;
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number };
    };
    res.json(json);
    return readUsage(json.model ?? plan.model, json.choices?.[0]?.message?.content ?? '', json.usage, plan);
}

/**
 * Streamed: the provider's own frames, byte for byte, while the text and the usage are read out of
 * them on the way past.
 *
 * The frames are not rewritten. A client that understands OpenAI's stream understands this one, and
 * anything the node invented in the middle would be a second dialect to keep in step.
 */
async function pipeStream(
    provider: globalThis.Response, res: Response, plan: AiCallPlan,
): Promise<ProviderOutcome> {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });

    const reader = provider.body?.getReader();
    if (!reader) throw new AiCompletionError('PROVIDER_ERROR', 502, 'The provider sent no body.');

    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let model = plan.model;
    let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number } | undefined;

    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        res.write(chunk);
        (res as unknown as { flush?: () => void }).flush?.();

        buffer += chunk;
        let cut: number;
        while ((cut = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 2);
            for (const line of frame.split('\n')) {
                if (!line.startsWith('data:')) continue;
                const payload = line.slice(5).trim();
                if (!payload || payload === '[DONE]') continue;
                let parsed;
                try {
                    parsed = JSON.parse(payload) as {
                        model?: string;
                        choices?: Array<{ delta?: { content?: string } }>;
                        usage?: typeof usage;
                    };
                } catch (err) {
                    // The frame was already forwarded verbatim above, so the client is unaffected;
                    // only the node's own reading of it failed, and only the accounting depends on
                    // that. Said out loud rather than dropped.
                    logger.warn(`[llm-proxy] unreadable frame: ${(err as Error).message}`);
                    continue;
                }
                if (parsed.model) model = parsed.model;
                const delta = parsed.choices?.[0]?.delta?.content;
                if (typeof delta === 'string') content += delta;
                // OpenRouter puts the totals in the last frame when include_usage is set, which is
                // why it is set: without it the node would have to guess what the turn cost.
                if (parsed.usage) usage = parsed.usage;
            }
        }
    }
    res.end();
    return readUsage(model, content, usage, plan);
}

/** Tokens and cost: the provider's charge, then the model catalogue, then the table and the estimate
 *  the rest of the node falls back to (services/ai/catalog/price.ts). */
function readUsage(
    model: string, content: string,
    usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number } | undefined,
    plan: AiCallPlan,
): ProviderOutcome {
    const promptTokens = usage?.prompt_tokens ?? 0;
    const completionTokens = usage?.completion_tokens ?? 0;
    const totalTokens = usage?.total_tokens ?? (promptTokens + completionTokens);
    const price = callCost({ type: plan.providerType, model, requestedModel: plan.model, promptTokens, completionTokens, reported: usage?.cost });
    return { model, content, promptTokens, completionTokens, totalTokens, costUsd: price.costUsd, costSource: price.costSource, priceRef: price.priceRef };
}
