/**
 * @file ai-transcription.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Speech-to-text for a single owner. It runs the node's one gate: prepareAiCall
 *   (provider allowlist, app allowlist, model, key, daily budget), the gateway
 *   (services/ai/gateway.ts), settleAiCall (usage, allowance, provenance). One call is one
 *   transcription; the caller supplies bytes and gets text plus what it actually cost.
 * @structure
 *   - transcribeForOwner(storage, config, gaii, opts) — runs one transcription
 *   - STT_UNSET_MESSAGE — the one place the "no model chosen" wording lives
 * @usage
 *   import { transcribeForOwner } from '../services/ai-transcription.js';
 *   const r = await transcribeForOwner(storage, config, gaii, { audio, appId: 'inbox' });
 * @version-history
 *   v2.2.0 — 2026-09-28 — Takes `role`, the AI role the call runs as (services/ai/roles.ts).
 *   v2.1.0 — 2026-09-28 — Takes caller and verifiedApp for the owner's model policy (V2).
 *   v2.1.0 — 2026-09-28 — Providers (System 2 plan, V3): the owner's candidates are tried by their
 *     rules, a call may name a `provider`, the provider's own transcription language comes after the
 *     call's, the attempts that failed before a fallback are usage rows, and the result has `route`.
 *   v2.0.0 — 2026-09-28 — Through the shared gate (System 2 plan, V1): prepareAiCall with op
 *     'transcribe', the gateway's transcribeAudio(), settleAiCall. An agent's own key and the
 *     node's key can pay (the node's only when the operator named a node default transcription
 *     model), the node's allowance is drawn down, and a transcript gets a provenance record whose
 *     content hash is the SHA-256 of its text. Refusals, their order and their wording are unchanged.
 *   v1.x — 2026-09-19 — The allowlist and cap checks take the owner, so they match an app under any
 *     of its names (services/ai-app-id.ts).
 *   v1.x — 2026-08-16 — The speech model and the language hint fall back to the node's defaults
 *     before refusing. NO_STT_MODEL stays as the last answer rather than becoming a chat model:
 *     handing audio to a text model turns a clear local refusal into an opaque provider error.
 *     What changes is that a brand-new account on a configured node can use the microphone at all,
 *     where before it had to find a settings page first.
 *   v1.0.0 — 2026-08-01 — Initial version. Multipart transport (services/openrouter.ts transcribe),
 *     shared gate from ai-completion.ts, cost taken from the provider's reported usage.cost because
 *     for audio models it is the only trustworthy price signal.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { AiProvenanceRecordRow } from '../storage/interface.js';
import type { TranscriptionAudio } from './openrouter.js';
import {
  AiCompletionError, prepareAiCall, settleAiCall, planFor, recordFailedAttempts, type AiCallPlan,
} from './ai-completion.js';
import { transcribeAudio } from './ai/gateway.js';
import { runRoute, type AiRoute } from './ai/route-run.js';
import { callCost } from './ai/catalog/price.js';
import type { AiCandidate } from './ai/route-plan.js';
import { logger } from '../utils/logger.js';
import { resolveSttLanguage } from './ai-model-defaults.js';
import type { CallerClass } from './ai/policy.js';

/** Shown when the owner has no `sttModel`. Lives in services/ai/unset-model.ts since the gate refuses
 *  it; re-exported so the route, the message route and the UI copy point at the same instruction. */
export { STT_UNSET_MESSAGE } from './ai/unset-model.js';

export interface TranscribeForOwnerOptions {
  audio: TranscriptionAudio;
  /** Model override. Without it the owner's configured `sttModel` is used. */
  model?: string;
  /** ISO-639-1 hint. Without it the owner's `sttLanguage`, and without that, auto-detect. */
  language?: string;
  /** Ask for segment timestamps (verbose_json). */
  verbose?: boolean;
  /** App/source attribution — enables the per-app allowlist and quota, and labels the spend. */
  appId?: string;
  temperature?: number;
  signal?: AbortSignal;
  /** The owner's agent that asked, by bare name: its own key pays first and its cap applies. The
   *  caller derives it from the principal (aiPayerOf), never from a request body. */
  agent?: string;
  /** Whose call this is and the app its grant names, for the owner's model policy. */
  caller?: CallerClass;
  verifiedApp?: string;
  /** A provider the call names (an id or a type), and the call's word on fallback. */
  provider?: string;
  fallback?: boolean;
  /** The AI role the call runs as (services/ai/roles.ts). A named model or provider wins over it. */
  role?: string;
}

export interface TranscribeForOwnerResult {
  text: string;
  model: string;
  language?: string;
  /** Audio duration as the provider measured it; 0 when it did not report one. */
  seconds: number;
  usage: { totalTokens: number; costUsd: number; costExact: boolean };
  budget: { dailyBudgetUsd: number; spentTodayUsd: number; remainingUsd: number };
  /** The provenance record minted for this transcript (content hash = SHA-256 of the text). Absent
   *  when provenance is off, minting failed, or the transcript is empty. */
  provenance?: AiProvenanceRecordRow;
  /** Which pocket paid: the agent's key, the owner's own, or the node's allowance. */
  keySource: 'agent' | 'own' | 'node';
  /** Who chose the provider, who answered, and every attempt (services/ai/route-run.ts). */
  route: AiRoute;
}

/**
 * Transcribe audio on behalf of an owner.
 *
 * Two deliberate differences from completeForOwner:
 *
 * 1. **No model fallback.** An unset `sttModel` is an error, not a reason to reach for the default
 *    model — that default is a text model, and sending it audio produces an opaque provider error
 *    instead of an instruction the owner can act on.
 * 2. **No cost estimate.** When the provider reports no cost we record 0 with costExact:false rather
 *    than deriving one from duration. Audio pricing in the catalogue is per-minute on one provider
 *    and per-hour on another with nothing distinguishing them, so a derived number would be
 *    confidently wrong. Zero-and-flagged is the honest answer.
 */
export async function transcribeForOwner(
  storage: Storage,
  config: AimeatConfig,
  gaii: string,
  opts: TranscribeForOwnerOptions,
): Promise<TranscribeForOwnerResult> {
  const bytes = opts.audio?.data;
  if (!bytes || bytes.length === 0) {
    throw new AiCompletionError('INVALID_BODY', 400, 'audio is required.');
  }
  const maxBytes = config.sttMaxMb * 1024 * 1024;
  if (bytes.length > maxBytes) {
    throw new AiCompletionError('AUDIO_TOO_LARGE', 400,
      `Audio is ${(bytes.length / 1048576).toFixed(1)} MB; this node accepts up to ${config.sttMaxMb} MB for transcription.`);
  }

  // Owner setting, then the node's default, then a refusal by name (the gate words it). The
  // refusal stays: handing audio to a chat model turns a clear local error into an opaque provider one.
  const plan = await prepareAiCall(storage, config, gaii, {
    op: 'transcribe', model: opts.model, appId: opts.appId, ...(opts.agent ? { agent: opts.agent } : {}),
    ...(opts.caller ? { caller: opts.caller } : {}), ...(opts.verifiedApp ? { verifiedApp: opts.verifiedApp } : {}),
    ...(opts.provider ? { provider: opts.provider } : {}), ...(opts.fallback !== undefined ? { fallback: opts.fallback } : {}),
    ...(opts.role ? { role: opts.role } : {}),
  });
  let result;
  let answered: AiCallPlan;
  let route: AiRoute;
  try {
    const run = await runRoute({
      storage, gaii, capability: plan.capability, candidates: plan.candidates, chosenBy: plan.chosenBy,
      allowFallback: plan.allowFallback, rules: plan.rules, ...(opts.signal ? { signal: opts.signal } : {}),
    }, (c) => {
      // The call's language, then the provider's own for transcription, then the owner's, then the node's.
      const language = opts.language || c.provider.capabilities.transcription?.language || resolveSttLanguage(config, plan.prefs);
      return transcribeAudio({
        target: c.target, model: c.model, audio: opts.audio,
        ...(language ? { language } : {}),
        ...(opts.verbose ? { verbose: true } : {}),
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
    });
    result = run.result;
    answered = planFor(plan, run.candidate);
    route = run.route;
    if (route.fellBack) await recordFailedAttempts(storage, config, gaii, plan, run.failed, { appId: opts.appId, source: 'ai-transcribe' });
  } catch (e) {
    const moved = e as { route?: AiRoute; failed?: Array<{ candidate: AiCandidate; error: string; costUsd: number }> };
    if (moved.route?.fellBack && moved.failed) await recordFailedAttempts(storage, config, gaii, plan, moved.failed, { appId: opts.appId, source: 'ai-transcribe' });
    const status = (e as { status?: number }).status;
    if (status === 401) throw new AiCompletionError('INVALID_API_KEY', 401, 'API key was rejected by the provider.');
    if (status === 429) throw new AiCompletionError('RATE_LIMITED', 429, 'Provider rate limit hit. Try again later.');
    throw new AiCompletionError('PROVIDER_ERROR', 502, (e as Error).message);
  }

  const seconds = result.usage?.seconds ?? 0;
  const totalTok = result.usage?.total_tokens
    ?? ((result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0));
  // The provider's own charge, then the catalogue's price per second (LiteLLM's, measured in its own
  // unit), never a per-minute guess from OpenRouter's number (services/ai/catalog/types.ts).
  const price = callCost({ type: answered.providerType, model: result.model, requestedModel: answered.model, seconds, reported: result.usage?.cost_usd });
  const costExact = price.costSource === 'provider';
  const costUsd = price.costUsd;

  // The duration ceiling can only be checked here: nothing before the response knows how long the
  // audio was. The charge already happened, so this warns rather than throws — refusing to return
  // text the owner has paid for would waste the money twice.
  if (config.sttMaxSeconds > 0 && seconds > config.sttMaxSeconds) {
    logger.warn(`[stt] gaii=${gaii} transcribed ${seconds}s, over the ${config.sttMaxSeconds}s guideline (model=${answered.model})`);
  }

  const settled = await settleAiCall(storage, config, gaii, answered, {
    // Speech-to-text is priced per second rather than per token, so the token split is whatever the
    // provider reported and the authoritative number is the cost. Named here anyway so a
    // transcription is not a hole in the per-model report.
    model: result.model, promptTokens: 0, completionTokens: totalTok, totalTokens: totalTok,
    costUsd, content: result.text, appId: opts.appId, source: 'ai-transcribe',
    units: { seconds }, costSource: price.costSource, priceRef: price.priceRef,
  });
  const updated = settled.usage;
  const dailyBudget = plan.dailyBudgetUsd;

  logger.info(`[stt] gaii=${gaii} app=${opts.appId || '_unknown'} model=${result.model} seconds=${seconds} chars=${result.text.length} cost=$${costUsd.toFixed(6)} day_total=$${updated.total_cost_usd.toFixed(4)}`);

  return {
    text: result.text,
    model: result.model,
    language: result.language,
    seconds,
    usage: { totalTokens: totalTok, costUsd, costExact },
    budget: {
      dailyBudgetUsd: dailyBudget,
      spentTodayUsd: updated.total_cost_usd,
      remainingUsd: Math.max(0, dailyBudget - updated.total_cost_usd),
    },
    ...(settled.provenance ? { provenance: settled.provenance } : {}),
    keySource: answered.keyScope,
    route: { ...route, attempts: route.attempts.map(a => a.ok ? { ...a, costUsd } : a) },
  };
}
