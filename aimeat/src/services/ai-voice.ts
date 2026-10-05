/**
 * @file ai-voice.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Metered text and speech streams sharing the existing AI preflight and settlement.
 * @structure streamReply, streamSpeech; bounded SSE parsing; speech price cache
 * @usage await streamReply(storage, config, principal, options, signal, emit)
 * @version-history
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
 *     ai-completion.ts, not a copy of its two numbers.
 *   v1.0.1 - 2026-09-19 - The speech pre-check reads the app's spend and cap under any of its names
 *     (services/ai-app-id.ts).
 *   v1.0.0 - 2026-09-19 - Configurable voice transport with cancellation and final accounting.
 */
import { createHash } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import {
  prepareAiCall, settleAiCall, getTodayUsage, AiCompletionError, planFor, recordFailedAttempts, type AiCallPlan,
} from './ai-completion.js';
import { chatCompletionRaw, speechRaw, generationCost, listModels } from './openrouter.js';
import { openAiChat, speaksOpenAiChat } from './ai/gateway.js';
import { runRoute } from './ai/route-run.js';
import { callCost } from './ai/catalog/price.js';
import { servedProvenanceOf } from './ai-provenance-marks.js';
import { logger } from '../utils/logger.js';
import { emitChange } from './event-bus.js';
import { appSpentToday, appQuotaFor } from './ai-app-id.js';
import type { CallerClass } from './ai/policy.js';
import { resolveTtsVoice } from './ai-model-defaults.js';

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
}
export interface SpeakOptions extends VoicePolicyCaller {
  /** Without a model the speech role decides (the provider's, the owner's, the node's); without a
   *  voice the provider's speech voice, then the owner's, then the node's default. */
  input: string; model?: string; app_id: string; voice?: string; response_format: 'pcm' | 'mp3'; speed: number; instructions?: string;
  /** A provider id or type the call names (and the provider test uses): no fallback then. */
  provider?: string;
}

async function checkResponse(response: Response): Promise<void> {
  if (response.ok && response.body) return;
  const status = response.status === 401 ? 401 : response.status === 429 ? 429 : 502;
  // Provider responses can echo credentials or request content. Keep the external error bounded and generic.
  await response.body?.cancel();
  throw new AiCompletionError('PROVIDER_ERROR', status, `Speech provider returned HTTP ${response.status}.`);
}

/** The provider uses SSE; emit only text and terminal metadata, never hidden reasoning. */
async function* sse(response: Response) {
  const reader = response.body!.getReader(); const decoder = new TextDecoder(); let buffer = '';
  try {
    while (true) {
      const chunk = await reader.read(); buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      if (buffer.length > 2_000_000) throw new Error('Provider stream frame exceeds 2 MB');
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim(); if (data === '[DONE]') return;
        if (data) yield JSON.parse(data);
      }
      if (chunk.done) { if (buffer.trim()) throw new Error('Incomplete provider stream frame'); return; }
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
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
    }, async (c) => {
      const body = { model: c.model, messages: options.messages,
        temperature: options.temperature, top_p: options.top_p, max_tokens: options.max_tokens,
        ...(options.reasoning ? { reasoning: options.reasoning } : {}), stream: true, stream_options: { include_usage: true } };
      const r = speaksOpenAiChat(c.provider.type)
        ? await chatCompletionRaw(c.target.key, c.target.baseUrl, body, signal)
        : await openAiChat(c.target, c.model, body, signal);
      if (!r.ok) { await r.body?.cancel(); throw Object.assign(new Error(`Speech provider returned HTTP ${r.status}.`), { status: r.status }); }
      return r;
    });
    plan = planFor(first, run.candidate);
    response = run.result;
    if (run.route.fellBack) await recordFailedAttempts(storage, config, gaii, first, run.failed, { appId: options.app_id, source: 'voice-complete' });
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (typeof status !== 'number') throw e;
    throw new AiCompletionError('PROVIDER_ERROR', status === 401 ? 401 : status === 429 ? 429 : 502, `Speech provider returned HTTP ${status}.`);
  }
  await checkResponse(response);
  let content = '', prompt = 0, completion = 0, cost: number | undefined, finish: string | null = null;
  let result;
  try {
    await emit({ type: 'start', model: plan.model, keySource: plan.keyScope });
    for await (const event of sse(response)) {
      if (event.error) throw new Error('Conversation provider failed during the stream');
      const choice = event.choices?.[0];
      if (typeof choice?.delta?.content === 'string') {
        content += choice.delta.content;
        if (content.length > 200000) throw new Error('Conversation answer exceeds 200k characters');
        await emit({ type: 'text', text: choice.delta.content });
      }
      if (choice?.finish_reason) finish = choice.finish_reason;
      if (event.usage) {
        prompt = event.usage.prompt_tokens ?? prompt; completion = event.usage.completion_tokens ?? completion;
        if (typeof event.usage.cost === 'number' && event.usage.cost >= 0) cost = event.usage.cost;
      }
    }
    if (!finish) throw new Error('Conversation stream ended without a finish reason');
    if (!content.trim()) throw new Error('Conversation model returned no text');
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
  await emit({ type: 'done', model: plan.model, finish_reason: finish, truncated: finish === 'length', cost_exact: cost !== undefined, ...result });
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
  // A spoken reply asks for the speech capability: the owner's policy list for speech applies to it.
  const plan = await prepareAiCall(storage, config, gaii, {
    op: 'speak', model: options.model, appId: options.app_id, capability: 'speech', ...policyCallerOf(options),
    ...(options.provider ? { provider: options.provider, fallback: false } : {}),
  });
  const voice = options.voice || plan.candidates[0]?.provider.capabilities.speech?.voice || resolveTtsVoice(config, plan.prefs);
  if (!voice) {
    throw new AiCompletionError('NO_TTS_VOICE', 400,
      'No voice is set for speech. Name one in the call (`voice`), set one for speech on your AI provider, or ask the operator for a node default.');
  }
  const unitPrice = await speechPrice(plan);
  const estimate = (unitPrice ?? 0) * Array.from(options.input).length;
  const usage = await getTodayUsage(storage, gaii);
  const appSpent = appSpentToday(usage.per_app, options.app_id, gaii);
  const appLimit = appQuotaFor(plan.prefs.app_quotas as Record<string, { daily_usd?: number }> | undefined, options.app_id, gaii, plan.dailyBudgetUsd);
  if (usage.total_cost_usd + estimate > plan.dailyBudgetUsd || appSpent + estimate > appLimit) {
    throw new AiCompletionError('QUOTA_EXHAUSTED', 402, 'This speech segment would exceed your AI budget.');
  }
  signal.throwIfAborted();
  // An extension provider (V6) answers its ai.speak action with the whole audio; it becomes a
  // Response here, so the streaming, the size cap, the hash and the settlement below apply unchanged.
  let extCost: number | undefined;
  const response = plan.providerType === 'extension' && plan.target.runExtension
    ? await (async () => {
      const r = await plan.target.runExtension!('speak', { model: plan.model, text: options.input, voice,
        format: options.response_format, speed: options.speed, ...(options.instructions ? { instructions: options.instructions } : {}) }, signal);
      if (typeof r.audio !== 'string' || !r.audio) throw new AiCompletionError('PROVIDER_ERROR', 502, 'The extension answered ai.speak without `audio`.');
      extCost = typeof r.costUsd === 'number' && r.costUsd >= 0 ? r.costUsd : undefined;
      const mime = typeof r.mimeType === 'string' && r.mimeType.startsWith('audio/') ? r.mimeType : options.response_format === 'mp3' ? 'audio/mpeg' : 'audio/pcm';
      return new Response(new Uint8Array(Buffer.from(r.audio, 'base64')), { headers: { 'content-type': mime } });
    })()
    : await speechRaw(plan.key, plan.baseUrl, { model: plan.model, input: options.input,
      voice, response_format: options.response_format, speed: options.speed,
      ...(options.instructions ? { provider: { options: { openai: { instructions: options.instructions } } } } : {}) }, signal);
  await checkResponse(response);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.startsWith('audio/') && !contentType.startsWith('application/octet-stream')) {
    await response.body!.cancel(); throw new Error('Speech provider did not return audio');
  }
  const generation = response.headers.get('x-generation-id');
  const reader = response.body!.getReader(); let size = 0, cost: number | undefined = extCost, result;
  const audioHash = createHash('sha256');
  try {
    await emit({ type: 'start', model: plan.model, format: options.response_format, syntheticAudio: true });
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 16_000_000) throw new Error('Speech segment exceeds 16 MB');
      audioHash.update(chunk.value);
      for (let offset = 0; offset < chunk.value.length; offset += 32768) {
        await emit({ type: 'audio', data: Buffer.from(chunk.value.subarray(offset, offset + 32768)).toString('base64') });
      }
    }
    if (!size) throw new Error('Speech provider returned empty audio');
  } finally {
    await reader.cancel().catch(error => logger.debug('[voice] cancelled audio reader', { error: String(error) })); reader.releaseLock();
    if (generation) {
      try { cost = await generationCost(plan.key, plan.baseUrl, generation); }
      catch (error) { logger.warn('[voice] exact speech cost unavailable; catalogue estimate retained', { error: String(error) }); }
    }
    result = await settled(storage, config, gaii, plan, options, '', cost ?? estimate, { prompt: 0, completion: 0 }, 'voice-speech',
      size ? 'sha256:' + audioHash.digest('hex') : undefined);
  }
  await emit({ type: 'done', model: plan.model, bytes: size, cost_usd: cost ?? estimate, key_source: plan.keyScope, cost_exact: cost !== undefined, cost_known: cost !== undefined || unitPrice !== undefined, syntheticAudio: true, ...result });
}
