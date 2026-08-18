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
 *   v1.0.0 — 2026-08-16 — Initial.
 */
import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { assertAiUseAllowed } from '../auth/ai-gate.js';
import { error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import {
    prepareAiCall, settleAiCall, estimateCostUsd, AiCompletionError, type AiCallPlan,
} from '../services/ai-completion.js';
import { chatCompletionRaw, listModels } from '../services/openrouter.js';
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
        const gaii = resolveIdentity(req.auth!, config.nodeId);
        try {
            const plan = await prepareAiCall(storage, config, gaii, { appId: 'llm-proxy' });
            const models = await listModels(plan.key, plan.baseUrl, 'chat');
            // OpenAI's shape, because that is what a client asking this URL parses.
            res.json({
                object: 'list',
                data: models.map((m) => ({ id: m.id, object: 'model', owned_by: plan.provider })),
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
        const gaii = resolveIdentity(req.auth!, config.nodeId);

        const body = (req.body ?? {}) as {
            messages?: ChatMessage[]; stream?: boolean;
            temperature?: number; top_p?: number; max_tokens?: number;
            tools?: unknown; tool_choice?: unknown; response_format?: unknown;
        };
        if (!Array.isArray(body.messages) || body.messages.length === 0) {
            res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'messages is required.'));
            return;
        }

        let plan: AiCallPlan;
        try {
            // `model` is deliberately not passed through: see the file header. The node decides.
            plan = await prepareAiCall(storage, config, gaii, { appId: 'llm-proxy' });
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
            ...(body.response_format !== undefined ? { response_format: body.response_format } : {}),
            ...(body.stream ? { stream: true, stream_options: { include_usage: true } } : {}),
        };

        req.setTimeout(TURN_TIMEOUT_MS);
        res.setTimeout(TURN_TIMEOUT_MS);
        const controller = new AbortController();
        req.on('close', () => controller.abort());

        let provider: globalThis.Response;
        try {
            // Through the openrouter service, never straight out of this file. That file is the
            // node's only HTTP transport to a model provider, checked by `pnpm check:llm-transport`,
            // and a second place speaking to a provider is a second place that can forget to meter.
            provider = await chatCompletionRaw(plan.key, plan.baseUrl, upstream, controller.signal);
        } catch (err) {
            sendError(res, config.nodeId, new AiCompletionError('PROVIDER_ERROR', 502, (err as Error).message));
            return;
        }

        if (!provider.ok) {
            // eslint-disable-next-line aimeat/no-silent-catch -- the body only enriches an error already being reported; an unreadable one is honestly reported as empty
            const detail = await provider.text().catch(() => '');
            sendError(res, config.nodeId, providerFailure(provider.status, detail));
            return;
        }

        try {
            const outcome = body.stream
                ? await pipeStream(provider, res, plan)
                : await passWhole(provider, res, plan);
            await settleAiCall(storage, config, gaii, plan, {
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
    res.status(status).json(error(nodeId, code, e?.message || 'The completion failed.'));
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
    return readUsage(json.model ?? plan.model, json.choices?.[0]?.message?.content ?? '', json.usage);
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
    return readUsage(model, content, usage);
}

/** Tokens and cost, with the same estimate the rest of the node falls back to. */
function readUsage(
    model: string, content: string,
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number },
): ProviderOutcome {
    const promptTokens = usage?.prompt_tokens ?? 0;
    const completionTokens = usage?.completion_tokens ?? 0;
    const totalTokens = usage?.total_tokens ?? (promptTokens + completionTokens);
    const costUsd = typeof usage?.cost === 'number' ? usage.cost : estimateCostUsd(promptTokens, completionTokens);
    return { model, content, promptTokens, completionTokens, totalTokens, costUsd };
}
