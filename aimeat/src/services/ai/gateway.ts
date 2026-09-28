/**
 * @file gateway.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The System 2 AI gateway: the one module that calls the AI SDK's generation functions.
 *
 *   Every model call runs prepareAiCall → gateway → settleAiCall (services/ai-completion.ts). The
 *   gateway does the middle step only: it takes a target prepareAiCall resolved (adapter type,
 *   address, the key that pays) and a model id, asks the adapter registry for a model INSTANCE, and
 *   calls generateText, generateImage or transcribe with it. It decides nothing about who may call,
 *   who pays or what was spent, and it cannot: it receives no identity.
 *
 *   A MODEL INSTANCE, NEVER A STRING. The AI SDK resolves a string model id through its default
 *   provider, which is Vercel's hosted gateway, so `model: 'openai/gpt-6'` would send the owner's
 *   prompt to a third party the node never chose. assertModelInstance() refuses at run time, and
 *   `pnpm check:ai-disclosure` refuses a string literal at build time.
 *
 *   WHAT IS KEPT FROM THE TRANSPORT IT REPLACES (services/openrouter.ts complete(), removed here):
 *   an empty answer is asked again (`retries`, default 2) and then fails naming the finish reason;
 *   OpenRouter's `reasoning` parameter reaches the provider exactly as given; the provider's own
 *   finish reason and reported cost come back; a caller's cancel signal is combined with a 30-minute
 *   timeout per attempt; errors carry the provider's HTTP status. The AI SDK's own retry is off
 *   (maxRetries 0): the node never retried a provider error, and a retry is a second charge.
 * @structure
 *   - text() — one completion, with the empty-answer retry
 *   - image() — one picture, through the image adapter
 *   - transcribeAudio() — one transcript, through the audio adapter or a provider package's model
 *   - openAiChat() / speaksOpenAiChat — an OpenAI chat answer from a provider that does not speak it
 *   - GatewayError — the error shape callers map to their own codes
 * @version-history
 *   v1.1.0 — 2026-09-28 — The direct providers (System 2 plan, V3): a transcription from a provider's
 *     own package (openai, xai, mistral) is read from the AI SDK's result, an empty one included;
 *     openAiChat() answers the proxy and the voice stream for an Anthropic provider.
 *   v1.0.0 — 2026-09-28 — Initial (V1 of the System 2 plan, docs/internal/llmproviderintegrations/).
 */
import { generateText, generateImage, transcribe, APICallError, NoTranscriptGeneratedError } from 'ai';
import type { ImageModelV4, LanguageModelV4, TranscriptionModelV4 } from '@ai-sdk/provider';
import { logger } from '../../utils/logger.js';
import type { AiTarget } from './types.js';
import { adapterFor, openAiChat as adapterOpenAiChat, speaksOpenAiChat } from './adapters/index.js';
import { COMPATIBLE_OPTIONS_KEY } from './adapters/sdk.js';
import type { AimeatImageMetadata } from './adapters/image.js';
import type { AimeatTranscriptionOptions, AimeatTranscriptionModel } from './adapters/audio.js';
import type { OpenAiChatBody } from './adapters/openai-chat.js';
import type {
  CompletionReasoning, ImageGenerationResult, TranscriptionAudio, TranscriptionResult,
} from '../openrouter.js';

/** How long one attempt may take. The same ceiling the transport had. */
const TIMEOUT_MS = 1_800_000;
/** Transcription is bounded work, and OpenRouter's upstream timeout is 60 s per request. */
const STT_TIMEOUT_MS = 120_000;
/** How many times an empty answer is asked again when nobody said. */
export const DEFAULT_EMPTY_RETRIES = 2;
/** The ceiling, the same one the owner's maxRetries setting has always had. */
const MAX_EMPTY_RETRIES = 10;
/** How much of a provider's error body is carried into a message. */
const ERROR_BODY_CHARS = 500;

/** A failed call, with the provider's HTTP status (502 when it gave none). */
export interface GatewayError extends Error {
  status: number;
  /** Set when every attempt answered with no content. */
  empty?: true;
  finish_reason?: string;
  attempts?: number;
}

function gatewayError(status: number, message: string): GatewayError {
  return Object.assign(new Error(message), { status });
}

/** A provider-side failure as the error the callers already map: status plus a bounded message. */
function providerError(e: unknown): GatewayError {
  if (APICallError.isInstance(e)) {
    const status = e.statusCode ?? 502;
    const body = typeof e.responseBody === 'string' && e.responseBody ? e.responseBody : e.message;
    return gatewayError(status, `Provider ${status}: ${body.slice(0, ERROR_BODY_CHARS)}`);
  }
  const status = (e as { status?: unknown }).status;
  const err = e instanceof Error ? e : new Error(String(e));
  return Object.assign(err, { status: typeof status === 'number' ? status : 502 });
}

/** Refuse a string model id at run time; see the file header for why. */
function assertModelInstance<M extends LanguageModelV4 | ImageModelV4 | TranscriptionModelV4>(model: M | string): M {
  if (typeof model === 'string' || !model || typeof model !== 'object') {
    throw gatewayError(500, 'A model id reached the AI SDK as a string. Build it through the adapter registry.');
  }
  return model;
}

/** The caller's reason to stop, combined with this attempt's own timeout rather than replacing it. */
function attemptSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([timeout, signal]) : timeout;
}

/**
 * The AI SDK downloads a URL a model cannot take itself, with the global fetch. Returning null for
 * every URL keeps each one as it is, so the provider fetches it as it always has and the node makes
 * no outbound request that safeFetch did not validate.
 */
async function keepUrlsAsTheyAre(requests: Array<{ url: URL }>): Promise<null[]> {
  return requests.map(() => null);
}

// ── text ──────────────────────────────────────────────────────────────────────────────────────────

export interface TextRequest {
  target: AiTarget;
  model: string;
  prompt: string;
  system?: string;
  /** data: or https URLs, sent as image parts of the user turn. */
  images?: string[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  reasoning?: CompletionReasoning;
  /** How many times an empty answer is asked again. Default DEFAULT_EMPTY_RETRIES; 0 asks once. */
  retries?: number;
  signal?: AbortSignal;
}

export interface TextResult {
  content: string;
  /** The model the provider says answered, which is not always the one asked for. */
  model: string;
  /** The provider's own finish reason (`stop`, `length`, `content_filter`, ...), when it gave one. */
  finishReason?: string;
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number; costUsd?: number };
}

/** The user turn: a plain string, or text plus image parts when there are images. */
function userContent(prompt: string, images?: string[]) {
  const urls = (images ?? []).filter((u): u is string => typeof u === 'string' && u.length > 0);
  if (urls.length === 0) return prompt;
  const parts: Array<{ type: 'text'; text: string } | { type: 'image'; image: URL }> = [{ type: 'text', text: prompt }];
  for (const u of urls) {
    if (URL.canParse(u)) parts.push({ type: 'image', image: new URL(u) });
    else logger.warn('[ai] an image attachment that is not a URL was left out', { length: u.length });
  }
  return parts;
}

/** The charge the provider reported: OpenRouter's package files it in its metadata; an
 *  OpenAI-compatible provider that reports one leaves it in the raw body. */
function reportedCost(providerMetadata: unknown, body: unknown): number | undefined {
  const fromMeta = (providerMetadata as { openrouter?: { usage?: { cost?: unknown } } } | undefined)?.openrouter?.usage?.cost;
  const fromBody = (body as { usage?: { cost?: unknown } } | undefined)?.usage?.cost;
  const cost = typeof fromMeta === 'number' ? fromMeta : fromBody;
  return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : undefined;
}

export async function text(req: TextRequest): Promise<TextResult> {
  const adapter = adapterFor(req.target.type);
  if (!adapter.language) throw gatewayError(400, `A ${req.target.type} provider does not produce text.`);
  const model = assertModelInstance(adapter.language(req.target, req.model));
  const content = userContent(req.prompt, req.images);
  const providerOptions = req.reasoning
    ? { [req.target.type === 'openrouter' ? 'openrouter' : COMPATIBLE_OPTIONS_KEY]: { reasoning: { ...req.reasoning } } }
    : undefined;

  const once = async (): Promise<TextResult> => {
    let r;
    try {
      r = await generateText({
        model,
        ...(req.system ? { instructions: req.system } : {}),
        messages: [{ role: 'user', content }],
        temperature: req.temperature,
        topP: req.topP,
        maxOutputTokens: req.maxTokens,
        frequencyPenalty: req.frequencyPenalty,
        presencePenalty: req.presencePenalty,
        ...(providerOptions ? { providerOptions } : {}),
        maxRetries: 0,
        abortSignal: attemptSignal(TIMEOUT_MS, req.signal),
        experimental_download: keepUrlsAsTheyAre,
        // AI SDK 7 drops the response body unless asked; an OpenAI-compatible provider that reports
        // its charge leaves it only there (usage.cost), and the node bills from it.
        include: { responseBody: true },
      });
    } catch (e) {
      throw providerError(e);
    }
    const out: TextResult = {
      content: r.text ?? '',
      model: r.response.modelId || req.model,
      finishReason: r.rawFinishReason ?? r.finishReason,
      usage: {
        promptTokens: r.usage.inputTokens,
        completionTokens: r.usage.outputTokens,
        totalTokens: r.usage.totalTokens,
        costUsd: reportedCost(r.providerMetadata, r.response.body),
      },
    };
    logger.info(`[ai] text: type=${req.target.type} model=${out.model} finish=${out.finishReason} `
      + `promptTokens=${out.usage.promptTokens} completionTokens=${out.usage.completionTokens}`);
    return out;
  };

  // AN EMPTY ANSWER IS A FAILED CALL (2026-09-09). A reasoning model behind a token cap spends the
  // cap on hidden thinking and answers with no content at HTTP 200; the same prompt on the next
  // attempt, often on another provider behind OpenRouter, answers. So: ask again, a bounded number
  // of times, then fail with the reason.
  const retries = Math.max(0, Math.min(MAX_EMPTY_RETRIES, Math.floor(req.retries ?? DEFAULT_EMPTY_RETRIES)));
  for (let attempt = 1; ; attempt++) {
    const r = await once();
    if (r.content.trim()) return r;
    const finish = r.finishReason ?? 'unknown';
    if (attempt <= retries && !req.signal?.aborted) {
      logger.warn(`[ai] empty content: model=${r.model}, finish_reason=${finish}, attempt ${attempt} of ${retries + 1}; asking again`);
      continue;
    }
    const err = gatewayError(502,
      `The model returned no content after ${attempt} attempt(s): model=${r.model}, finish_reason=${finish}`
      + (finish === 'length' ? ' (the token cap ran out before an answer; a reasoning model spends it on hidden thinking — raise the cap or set reasoning.enabled=false)' : ''));
    throw Object.assign(err, { empty: true as const, finish_reason: finish, attempts: attempt });
  }
}

// ── image ─────────────────────────────────────────────────────────────────────────────────────────

export interface ImageRequest {
  target: AiTarget;
  model: string;
  prompt: string;
  /** Provider-specific size, e.g. '1024x1024'. Passed through untouched. */
  size?: string;
  signal?: AbortSignal;
}

export async function image(req: ImageRequest): Promise<ImageGenerationResult> {
  const adapter = adapterFor(req.target.type);
  if (!adapter.image) throw gatewayError(400, `A ${req.target.type} provider does not make images.`);
  const model = assertModelInstance(adapter.image(req.target, req.model));
  let r;
  try {
    r = await generateImage({
      model,
      prompt: req.prompt,
      n: 1,
      // The AI SDK types a size as WIDTHxHEIGHT; the node has always passed the caller's string on.
      ...(req.size ? { size: req.size as `${number}x${number}` } : {}),
      maxRetries: 0,
      abortSignal: attemptSignal(TIMEOUT_MS, req.signal),
    });
  } catch (e) {
    throw providerError(e);
  }
  const meta = (r.providerMetadata?.aimeat?.images as unknown as AimeatImageMetadata[] | undefined)?.[0];
  return {
    data: Buffer.from(r.image.uint8Array),
    mime: meta?.mime ?? r.image.mediaType,
    model: meta?.model ?? req.model,
    costUsd: typeof meta?.costUsd === 'number' ? meta.costUsd : undefined,
  };
}

// ── transcription ─────────────────────────────────────────────────────────────────────────────────

export interface TranscribeRequest {
  target: AiTarget;
  model: string;
  audio: TranscriptionAudio;
  language?: string;
  verbose?: boolean;
  temperature?: number;
  signal?: AbortSignal;
}

export async function transcribeAudio(req: TranscribeRequest): Promise<TranscriptionResult> {
  const adapter = adapterFor(req.target.type);
  if (!adapter.transcription) throw gatewayError(400, `A ${req.target.type} provider does not transcribe.`);
  const model = adapter.transcription(req.target, req.model);
  assertModelInstance(model);
  const options: AimeatTranscriptionOptions = {
    mime: req.audio.mime,
    filename: req.audio.filename,
    ...(req.language ? { language: req.language } : {}),
    ...(req.verbose ? { verbose: true } : {}),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
  };
  // The node's own adapter keeps the transport's whole answer; a provider package's model does not.
  const own = model.provider.startsWith('aimeat.');
  let r;
  try {
    r = await transcribe({
      model,
      audio: new Uint8Array(req.audio.data),
      providerOptions: {
        aimeat: { ...options },
        // A direct provider's package reads the language from its own options key.
        ...(req.language ? { [req.target.type]: { language: req.language } } : {}),
      },
      maxRetries: 0,
      abortSignal: attemptSignal(STT_TIMEOUT_MS, req.signal),
    });
  } catch (e) {
    // The AI SDK throws on an empty transcript. A silent recording has one, the provider was paid
    // for it, and the node has always answered it: when the adapter holds the answer, it stands.
    if (own && (model as AimeatTranscriptionModel).last) return (model as AimeatTranscriptionModel).last!;
    if (!own && NoTranscriptGeneratedError.isInstance(e)) return { text: '', model: req.model };
    throw providerError(e);
  }
  if (own) {
    const last = (model as AimeatTranscriptionModel).last;
    if (!last) throw gatewayError(502, 'The transcription returned no result.');
    return last;
  }
  // A direct provider reports no charge for audio; the seconds are what the record keeps.
  return {
    text: r.text, model: r.responses[0]?.modelId ?? req.model,
    ...(r.language ? { language: r.language } : {}),
    ...(typeof r.durationInSeconds === 'number' ? { usage: { seconds: r.durationInSeconds } } : {}),
  };
}

// ── OpenAI chat for the proxy and the voice stream ────────────────────────────────────────────────

/**
 * An OpenAI chat-completions Response from a provider that does not speak that dialect (Anthropic).
 * The proxy and the voice stream pass an OpenAI-dialect provider's own bytes on (services/
 * openrouter.ts chatCompletionRaw); for the others this is their answer in the same shape, JSON or
 * SSE, so neither caller needs a second code path.
 */
export function openAiChat(target: AiTarget, model: string, body: OpenAiChatBody, signal?: AbortSignal): Promise<Response> {
  return adapterOpenAiChat(target, model, body, signal);
}

export { speaksOpenAiChat };
export type { OpenAiChatBody };
