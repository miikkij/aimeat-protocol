/**
 * @file ai-voice.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Metered text and speech streams sharing the existing AI preflight and settlement.
 * @structure streamReply, streamSpeech; bounded SSE parsing; speech price cache
 * @usage await streamReply(storage, config, principal, options, signal, emit)
 * @version-history
 *   v1.10.0 - 2026-10-08 - aiprov plan, workstream A. A provider's refusal goes through the one status
 *     table (services/ai/errors.ts): a permanent 4xx is 422 PROVIDER_REJECTED with the provider's
 *     reason (read, redacted, logged; the body was cancelled unread), a 429 is RATE_LIMITED with its
 *     Retry-After, and a refused mp3 says to ask for pcm (A1-A3). The speech runs its candidates
 *     through runRoute, so the owner's speech fallback works and failed attempts are recorded (A5);
 *     a voice the catalogue says the model lacks is 400 INVALID_VOICE before the paid call (A6); the
 *     start and done frames carry `audio` { mime, sample_rate, channels, sample_format } and the done
 *     frame the route (A4). The reply retries a spent own key on the free router (A7), records failed
 *     attempts on failure too, and both done frames carry key_source (A12). A failure after the first
 *     byte is a typed refusal: TOO_LARGE 413 at a size cap, PROVIDER_ERROR 502 for a broken stream (A8).
 *   v1.9.0 - 2026-10-07 - A speech provider's key refusal is 424 INVALID_API_KEY, not PROVIDER_ERROR at 401.
 *   v1.8.0 - 2026-10-05 - The AI call limit is counted per account in the service, so the MCP tools share it (secaudit 2026-10, C5).
 *   v1.7.0 - 2026-10-05 - `caller` is required: every call says who asks (secaudit 2026-10, AI-3).
 *   v1.6.0 - 2026-09-28 - The reply and the speech take `role`, the AI role the call runs as (services/ai/roles.ts).
 *   v1.4.0 - 2026-09-28 - Speech takes no model and no voice when a role gives them (System 2 plan,
 *     V5): the model is the speech role's (NO_TTS_MODEL without one), the voice the provider's, the
 *     owner's or the node's (NO_TTS_VOICE without one). The speech `done` event carries cost_usd, and
 *     the reply and the speech take `provider` (an id or a type, no fallback then).
 *   v1.5.0 - 2026-09-28 - Speech on an extension provider runs its ai.speak action (System 2 plan, V6).
 *   v1.3.0 - 2026-09-28 - A reply the provider did not price is priced from the model catalogue
 *     (services/ai/catalog/price.ts), as every other text call is (System 2 plan, V4).
 *   v1.2.0 - 2026-09-28 - Providers (System 2 plan, V3): the reply tries the owner's candidates before
 *     the first byte and an Anthropic provider answers through the gateway's converter; the spoken
 *     audio uses the first candidate, whose type speaks OpenAI's /audio/speech (providers.ts).
 *   v1.1.0 - 2026-09-28 - The owner's model policy covers voice: the reply runs under the text list,
 *     the spoken audio under the speech list, and the caller (owner, agent, verified app) is passed on.
 *   v1.0.2 - 2026-09-28 - The fallback price of a streamed reply is estimateCostUsd() from
 *     ai/completion.ts, not a copy of its two numbers.
 *   v1.0.1 - 2026-09-19 - The speech pre-check reads the app's spend and cap under any of its names
 *     (services/ai-app-id.ts).
 *   v1.0.0 - 2026-09-19 - Configurable voice transport with cancellation and final accounting.
 */
import { createHash } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import {
  prepareAiCall, settleAiCall, getTodayUsage, AiCompletionError, planFor, recordFailedAttempts, type AiCallPlan,
} from './ai/completion.js';
import {
  providerFailureOf, providerReason, providerReasonFromText, providerStatusError, retryAfterHeader,
} from './ai/errors.js';
import { chatCompletionRaw, speechRaw, generationCost, listModels } from './openrouter.js';
import { openAiChat, speaksOpenAiChat } from './ai/gateway.js';
import { runRoute, type AiRoute } from './ai/route-run.js';
import type { AiCandidate } from './ai/route-plan.js';
import { checkSpeechVoice, speechAudioOf, speechFormatHint } from './ai-voice-audio.js';
import { callCost } from './ai/catalog/price.js';
import { servedProvenanceOf } from './ai-provenance-marks.js';
import { logger } from '../utils/logger.js';
import { emitChange } from './event-bus.js';
import { appSpentToday, appQuotaFor } from './ai-app-id.js';
import type { CallerClass } from './ai/policy.js';
import { resolveTtsVoice } from './ai-model-defaults.js';
import { requireAiCallTurn, type AiCallLimitMark } from './account-limits.js';

function policyCallerOf(o: VoicePolicyCaller): VoicePolicyCaller {
  return {
    caller: o.caller, ...(o.verifiedApp ? { verifiedApp: o.verifiedApp } : {}),
    ...(o.role ? { role: o.role } : {}),
  };
}

export type VoiceEmit = (event: Record<string, unknown>) => Promise<void>;
/** Whose call this is and the app its grant names, for the owner's model policy (routes/ai-policy.ts). */
export interface VoicePolicyCaller {
  caller: CallerClass; verifiedApp?: string;
  /** The AI role the call runs as (services/ai/roles.ts). A named model or provider wins over it. */
  role?: string;
}
export interface ReplyOptions extends VoicePolicyCaller {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  model?: string; app_id: string; temperature?: number; top_p?: number; max_tokens?: number;
  /** A provider id or type the call names: no fallback then. */
  provider?: string;
  reasoning?: { enabled?: boolean; effort?: 'low' | 'medium' | 'high'; max_tokens?: number; exclude?: boolean } | null;
  /** 'exempt' for node-internal work; absent, the call counts against the account's AI call limit
   *  (services/account-limits.ts). */
  limit?: AiCallLimitMark;
}
export interface SpeakOptions extends VoicePolicyCaller {
  /** Without a model the speech role decides (the provider's, the owner's, the node's); without a
   *  voice the provider's speech voice, then the owner's, then the node's default. */
  input: string; model?: string; app_id: string; voice?: string; response_format: 'pcm' | 'mp3'; speed: number; instructions?: string;
  /** A provider id or type the call names (and the provider test uses): no fallback then. */
  provider?: string;
  /** 'exempt' for node-internal work (the provider test, which counts itself); absent, the call
   *  counts against the account's AI call limit (services/account-limits.ts). */
  limit?: AiCallLimitMark;
}

/**
 * A provider's non-OK answer as the error runRoute classifies and providerFailureOf maps
 * (services/ai/errors.ts): the status, the reason read by the one policy (at most 4 KB, the JSON
 * message, redacted, 300 characters), and the Retry-After. Until 2026-10-08 the body was cancelled
 * unread and every speech refusal said only "HTTP 400" (aiprov plan, A2).
 */
async function statusFailure(response: Response, what: string): Promise<Error> {
  const reason = await providerReason(response);
  const retryAfter = retryAfterHeader(response.headers);
  return Object.assign(new Error(`${what} provider answered HTTP ${response.status}: ${reason}`), {
    status: response.status, providerMessage: reason, ...(retryAfter !== undefined ? { retryAfter } : {}),
  });
}

/** A failure of the provider after the first byte: the provider's fault, said as one (502). */
function streamFailure(message: string): AiCompletionError {
  return new AiCompletionError('PROVIDER_ERROR', 502, message);
}

/** The provider uses SSE; emit only text and terminal metadata, never hidden reasoning. */
async function* sse(response: Response) {
  const reader = response.body!.getReader(); const decoder = new TextDecoder(); let buffer = '';
  try {
    while (true) {
      const chunk = await reader.read(); buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      if (buffer.length > 2_000_000) throw streamFailure('A provider stream frame exceeds 2 MB.');
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim(); if (data === '[DONE]') return;
        if (data) {
          try { yield JSON.parse(data); } catch { throw streamFailure('The provider sent a stream frame that is not JSON.'); }
        }
      }
      if (chunk.done) { if (buffer.trim()) throw streamFailure('The provider stream ended inside a frame.'); return; }
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
}

/** The attempts that failed before the answer, or before the last failure, are written to usage. */
async function recordMoved(storage: Storage, config: AimeatConfig, gaii: string, plan: AiCallPlan, e: unknown, call: { appId: string; source: string }) {
  const moved = e as { route?: AiRoute; failed?: Array<{ candidate: AiCandidate; error: string; costUsd: number }> };
  if (moved.route?.fellBack && moved.failed) await recordFailedAttempts(storage, config, gaii, plan, moved.failed, call);
}

async function settled(storage: Storage, config: AimeatConfig, gaii: string, plan: AiCallPlan,
  options: { app_id: string }, content: string, cost: number, tokens: { prompt: number; completion: number }, source: string, contentHash?: string) {
  // STT, LLM and TTS can complete concurrently. recordAiUsage serializes the shared counter update.
  const result = await settleAiCall(storage, config, gaii, plan, {
    model: plan.model, promptTokens: tokens.prompt, completionTokens: tokens.completion,
    totalTokens: tokens.prompt + tokens.completion, costUsd: cost, content, contentHash, appId: options.app_id, source,
  });
  // The owner's usage memory changed, including when a disconnected call settles.
  emitChange('memory', gaii);
  return { usage: result.usage, budget: { daily_budget_usd: plan.dailyBudgetUsd,
    spent_today_usd: result.usage.total_cost_usd, remaining_usd: Math.max(0, plan.dailyBudgetUsd - result.usage.total_cost_usd) },
    provenance: result.provenance ? servedProvenanceOf(config, result.provenance, { full: true }) : undefined };
}

export async function streamReply(storage: Storage, config: AimeatConfig, gaii: string, options: ReplyOptions, signal: AbortSignal, emit: VoiceEmit): Promise<void> {
  // POST /v1/ai/stream and aimeat_voice_reply both arrive here: one count per account, before any spend.
  requireAiCallTurn(config, gaii, options.limit);
  const first = await prepareAiCall(storage, config, gaii, {
    model: options.model, appId: options.app_id, ...policyCallerOf(options),
    ...(options.provider ? { provider: options.provider, fallback: false } : {}),
  });
  // The owner's candidates in order, moving on only before the first byte (services/ai/route-run.ts);
  // an Anthropic provider answers through the gateway's converter, in the same SSE shape.
  let plan: AiCallPlan;
  let response: Response;
  try {
    const run = await runRoute({
      storage, gaii, capability: first.capability, candidates: first.candidates, chosenBy: first.chosenBy,
      allowFallback: first.allowFallback, rules: first.rules, signal,
      // A spent own key is tried once on the free router, as /v1/ai/complete does (aiprov plan, A7).
      ...(first.noCreditModel ? { noCreditModel: first.noCreditModel } : {}),
    }, async (c) => {
      const body = { model: c.model, messages: options.messages,
        temperature: options.temperature, top_p: options.top_p, max_tokens: options.max_tokens,
        ...(options.reasoning ? { reasoning: options.reasoning } : {}), stream: true, stream_options: { include_usage: true } };
      const r = speaksOpenAiChat(c.provider.type)
        ? await chatCompletionRaw(c.target.key, c.target.baseUrl, body, signal)
        : await openAiChat(c.target, c.model, body, signal);
      if (!r.ok) throw await statusFailure(r, 'The conversation');
      if (!r.body) throw Object.assign(new Error('The conversation provider sent no body.'), { status: 502 });
      return r;
    });
    plan = planFor(first, run.candidate);
    response = run.result;
    if (run.route.fellBack) await recordFailedAttempts(storage, config, gaii, first, run.failed, { appId: options.app_id, source: 'voice-complete' });
  } catch (e) {
    await recordMoved(storage, config, gaii, first, e, { appId: options.app_id, source: 'voice-complete' });
    // The one status table every AI path uses (services/ai/errors.ts).
    throw providerFailureOf(e);
  }
  let content = '', prompt = 0, completion = 0, cost: number | undefined, finish: string | null = null;
  let result;
  try {
    // `keySource` stays for the clients that read it; `key_source` is the spelling every done frame uses.
    await emit({ type: 'start', model: plan.model, keySource: plan.keyScope, key_source: plan.keyScope });
    for await (const event of sse(response)) {
      if (event.error) {
        const status = typeof event.error?.code === 'number' ? event.error.code : 502;
        throw providerStatusError(status >= 400 && status <= 599 ? status : 502, providerReasonFromText(JSON.stringify({ error: event.error })));
      }
      const choice = event.choices?.[0];
      if (typeof choice?.delta?.content === 'string') {
        content += choice.delta.content;
        if (content.length > 200000) throw new AiCompletionError('TOO_LARGE', 413, 'The answer passed 200 000 characters. Set a lower max_tokens.');
        await emit({ type: 'text', text: choice.delta.content });
      }
      if (choice?.finish_reason) finish = choice.finish_reason;
      if (event.usage) {
        prompt = event.usage.prompt_tokens ?? prompt; completion = event.usage.completion_tokens ?? completion;
        if (typeof event.usage.cost === 'number' && event.usage.cost >= 0) cost = event.usage.cost;
      }
    }
    if (!finish) throw streamFailure('The conversation stream ended without a finish reason.');
    if (!content.trim()) throw new AiCompletionError('EMPTY_COMPLETION', 502, `The model returned no text (finish_reason=${finish}).`);
  } finally {
    // A disconnected client does not erase what was already generated or paid for.
    if (!prompt) prompt = Math.ceil(options.messages.reduce((n, m) => n + m.content.length, 0) / 4);
    if (!completion) completion = Math.ceil(content.length / 4);
    // The same pricing every other text call uses (services/ai/catalog/price.ts): the provider's
    // charge, then the catalogue, then the table and the estimate.
    result = await settled(storage, config, gaii, plan, options, content,
      callCost({ type: plan.providerType, model: plan.model, promptTokens: prompt, completionTokens: completion, reported: cost }).costUsd,
      { prompt, completion }, 'voice-complete');
  }
  await emit({ type: 'done', model: plan.model, finish_reason: finish, truncated: finish === 'length', cost_exact: cost !== undefined, key_source: plan.keyScope, ...result });
}

const speechPrices = new Map<string, { at: number; price: number }>();
async function speechPrice(plan: AiCallPlan): Promise<number | undefined> {
  if (new URL(plan.baseUrl).hostname !== 'openrouter.ai') return undefined;
  const key = plan.baseUrl + '/' + plan.model; const cached = speechPrices.get(key);
  if (cached && Date.now() - cached.at < 300000) return cached.price;
  const models = await listModels(plan.key, plan.baseUrl, 'speech');
  const model = models.find(row => row.id === plan.model);
  const price = Number(model?.pricing?.prompt);
  if (!Number.isFinite(price) || price < 0) throw new AiCompletionError('NO_SPEECH_PRICE', 400, 'Select a speech model listed by the provider.');
  if (speechPrices.size > 200) speechPrices.clear();
  speechPrices.set(key, { at: Date.now(), price }); return price;
}

export async function streamSpeech(storage: Storage, config: AimeatConfig, gaii: string, options: SpeakOptions, signal: AbortSignal, emit: VoiceEmit): Promise<void> {
  // POST /v1/ai/speak and aimeat_voice_speak both arrive here: one count per account, before any spend.
  requireAiCallTurn(config, gaii, options.limit);
  // A spoken reply asks for the speech capability: the owner's policy list for speech applies to it.
  const first = await prepareAiCall(storage, config, gaii, {
    op: 'speak', model: options.model, appId: options.app_id, capability: 'speech', ...policyCallerOf(options),
    ...(options.provider ? { provider: options.provider, fallback: false } : {}),
  });
  // One candidate's whole preflight and request, before the first byte: its voice, the voice check
  // against the catalogue (A6), its price and the budget, then the provider. A failure here moves to
  // the next candidate when the owner's rules allow it; for speech that needs speechVoiceMayChange,
  // which prepareAiCall already folded into allowFallback (route-plan.ts). Until 2026-10-08 the
  // speech used the first candidate only, although the contract promised the fallback (A5).
  const attempt = async (c: AiCandidate) => {
    const plan = planFor(first, c);
    const voice = options.voice || c.provider.capabilities.speech?.voice || resolveTtsVoice(config, first.prefs);
    if (!voice) {
      throw new AiCompletionError('NO_TTS_VOICE', 400,
        'No voice is set for speech. Name one in the call (`voice`), set one for speech on your AI provider, or ask the operator for a node default.');
    }
    checkSpeechVoice(c, voice);
    const unitPrice = await speechPrice(plan);
    const estimate = (unitPrice ?? 0) * Array.from(options.input).length;
    const usage = await getTodayUsage(storage, gaii);
    const appSpent = appSpentToday(usage.per_app, options.app_id, gaii);
    const appLimit = appQuotaFor(first.prefs.app_quotas as Record<string, { daily_usd?: number }> | undefined, options.app_id, gaii, first.dailyBudgetUsd);
    if (usage.total_cost_usd + estimate > first.dailyBudgetUsd || appSpent + estimate > appLimit) {
      throw new AiCompletionError('QUOTA_EXHAUSTED', 402, 'This speech segment would exceed your AI budget.');
    }
    signal.throwIfAborted();
    // An extension provider (V6) answers its ai.speak action with the whole audio; it becomes a
    // Response here, so the streaming, the size cap, the hash and the settlement below apply unchanged.
    let extCost: number | undefined;
    let extAnswer: Record<string, unknown> | undefined;
    const response = c.provider.type === 'extension' && c.target.runExtension
      ? await (async () => {
        const r = await c.target.runExtension!('speak', { model: c.model, text: options.input, voice,
          format: options.response_format, speed: options.speed, ...(options.instructions ? { instructions: options.instructions } : {}) }, signal);
        if (typeof r.audio !== 'string' || !r.audio) throw Object.assign(new Error('The extension answered ai.speak without `audio`.'), { status: 502 });
        extCost = typeof r.costUsd === 'number' && r.costUsd >= 0 ? r.costUsd : undefined;
        extAnswer = r;
        const mime = typeof r.mimeType === 'string' && r.mimeType.startsWith('audio/') ? r.mimeType : options.response_format === 'mp3' ? 'audio/mpeg' : 'audio/pcm';
        return new Response(new Uint8Array(Buffer.from(r.audio, 'base64')), { headers: { 'content-type': mime } });
      })()
      : await speechRaw(plan.key, plan.baseUrl, { model: c.model, input: options.input,
        voice, response_format: options.response_format, speed: options.speed,
        ...(options.instructions ? { provider: { options: { openai: { instructions: options.instructions } } } } : {}) }, signal);
    if (!response.ok) throw await statusFailure(response, 'The speech');
    const contentType = response.headers.get('content-type') || '';
    if (!response.body || (!contentType.startsWith('audio/') && !contentType.startsWith('application/octet-stream'))) {
      await response.body?.cancel();
      throw Object.assign(new Error(`The speech provider did not answer with audio (content type '${contentType.slice(0, 80)}').`), { status: 502 });
    }
    return { response, plan, unitPrice, estimate, extCost, audio: speechAudioOf(c, options.response_format, contentType, extAnswer) };
  };

  let answer: Awaited<ReturnType<typeof attempt>>;
  let route: AiRoute;
  try {
    const run = await runRoute({
      storage, gaii, capability: first.capability, candidates: first.candidates, chosenBy: first.chosenBy,
      allowFallback: first.allowFallback, rules: first.rules, signal,
    }, attempt);
    answer = run.result;
    route = run.route;
    if (route.fellBack) await recordFailedAttempts(storage, config, gaii, first, run.failed, { appId: options.app_id, source: 'voice-speech' });
  } catch (e) {
    await recordMoved(storage, config, gaii, first, e, { appId: options.app_id, source: 'voice-speech' });
    // The one status table every AI path uses (services/ai/errors.ts). A model that does not make
    // mp3 refuses it every time: the refusal says to ask for pcm (A1).
    throw providerFailureOf(e, { hint: speechFormatHint(options.response_format) });
  }
  const { response, plan, unitPrice, estimate, extCost, audio } = answer;
  const generation = response.headers.get('x-generation-id');
  const reader = response.body!.getReader(); let size = 0, cost: number | undefined = extCost, result;
  const audioHash = createHash('sha256');
  try {
    await emit({ type: 'start', model: plan.model, format: options.response_format, audio, key_source: plan.keyScope, syntheticAudio: true });
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 16_000_000) throw new AiCompletionError('TOO_LARGE', 413, 'The speech passed 16 MB. Send a shorter input.');
      audioHash.update(chunk.value);
      for (let offset = 0; offset < chunk.value.length; offset += 32768) {
        await emit({ type: 'audio', data: Buffer.from(chunk.value.subarray(offset, offset + 32768)).toString('base64') });
      }
    }
    if (!size) throw streamFailure('The speech provider answered with no audio.');
  } finally {
    await reader.cancel().catch(error => logger.debug('[voice] cancelled audio reader', { error: String(error) })); reader.releaseLock();
    if (generation) {
      try { cost = await generationCost(plan.key, plan.baseUrl, generation); }
      catch (error) { logger.warn('[voice] exact speech cost unavailable; catalogue estimate retained', { error: String(error) }); }
    }
    result = await settled(storage, config, gaii, plan, options, '', cost ?? estimate, { prompt: 0, completion: 0 }, 'voice-speech',
      size ? 'sha256:' + audioHash.digest('hex') : undefined);
  }
  route.attempts[route.attempts.length - 1].costUsd = cost ?? estimate;
  await emit({ type: 'done', model: plan.model, bytes: size, audio, cost_usd: cost ?? estimate, key_source: plan.keyScope, cost_exact: cost !== undefined, cost_known: cost !== undefined || unitPrice !== undefined, syntheticAudio: true, route, ...result });
}
