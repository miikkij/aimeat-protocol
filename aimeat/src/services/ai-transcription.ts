/**
 * @file ai-transcription.ts
 * @description Speech-to-text for a single owner, using their own encrypted provider key. The
 *   sibling of ai-completion.ts and deliberately its mirror image: same preflight (provider
 *   allowlist, app allowlist, key decrypt, daily budget), same usage record, same typed error. One
 *   call is one transcription; the caller supplies bytes and gets text plus what it actually cost.
 * @structure
 *   - transcribeForOwner(storage, config, gaii, opts) — runs one transcription
 *   - STT_UNSET_MESSAGE — the one place the "no model chosen" wording lives
 * @usage
 *   import { transcribeForOwner } from '../services/ai-transcription.js';
 *   const r = await transcribeForOwner(storage, config, gaii, { audio, appId: 'inbox' });
 * @version-history
 *   v1.0.0 — 2026-08-01 — Initial version. Multipart transport (services/openrouter.ts transcribe),
 *     shared gate from ai-completion.ts, cost taken from the provider's reported usage.cost because
 *     for audio models it is the only trustworthy price signal.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { transcribe, DEFAULT_BASE_URLS, type ProviderType, type TranscriptionAudio } from './openrouter.js';
import {
  AiCompletionError, assertProviderAllowed, assertAppAllowed, decryptOwnerKey,
  assertWithinBudget, recordAiUsage, todayKey, type UsageRecord,
} from './ai-completion.js';
import { logger } from '../utils/logger.js';

/** Shown when the owner has no `sttModel`. Kept here so the route, the message route and the UI copy
 *  all point at the same instruction. */
export const STT_UNSET_MESSAGE =
  'No transcription model selected. Choose one in Settings → OpenRouter (for example openai/whisper-large-v3).';

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
}

export interface TranscribeForOwnerResult {
  text: string;
  model: string;
  language?: string;
  /** Audio duration as the provider measured it; 0 when it did not report one. */
  seconds: number;
  usage: { totalTokens: number; costUsd: number; costExact: boolean };
  budget: { dailyBudgetUsd: number; spentTodayUsd: number; remainingUsd: number };
}

const emptyUsage = (): UsageRecord => ({
  date: todayKey(), total_cost_usd: 0, total_calls: 0, total_tokens: 0,
  audio_seconds: 0, per_app: {}, updated_at: new Date().toISOString(),
});

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

  const [apiKeyRecord, prefsRecord, usageRecord] = await Promise.all([
    storage.getMemory(gaii, 'openrouter.apikey'),
    storage.getMemory(gaii, 'openrouter.settings'),
    storage.getMemory(gaii, `ai-usage.${gaii}.${todayKey()}`),
  ]);
  const prefs = (prefsRecord?.value as Record<string, unknown>) ?? {};
  const provider = (prefs.provider as ProviderType) || 'openrouter';
  const baseUrl = (prefs.baseUrl as string) || DEFAULT_BASE_URLS[provider];

  assertProviderAllowed(config, baseUrl);
  assertAppAllowed(prefs, opts.appId);

  const model = opts.model || (typeof prefs.sttModel === 'string' ? prefs.sttModel : '');
  if (!model) throw new AiCompletionError('NO_STT_MODEL', 400, STT_UNSET_MESSAGE);

  const decryptedKey = decryptOwnerKey(config, apiKeyRecord?.value, provider);

  const usage = (usageRecord?.value as UsageRecord | undefined) ?? emptyUsage();
  const dailyBudget = assertWithinBudget(usage, prefs, opts.appId);

  const language = opts.language || (typeof prefs.sttLanguage === 'string' ? prefs.sttLanguage : undefined) || undefined;

  let result;
  try {
    result = await transcribe(decryptedKey, model, opts.audio, baseUrl, { language, verbose: opts.verbose });
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 401) throw new AiCompletionError('INVALID_API_KEY', 401, 'API key was rejected by the provider.');
    if (status === 429) throw new AiCompletionError('RATE_LIMITED', 429, 'Provider rate limit hit. Try again later.');
    throw new AiCompletionError('PROVIDER_ERROR', 502, (e as Error).message);
  }

  const seconds = result.usage?.seconds ?? 0;
  const totalTok = result.usage?.total_tokens
    ?? ((result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0));
  const costExact = typeof result.usage?.cost_usd === 'number';
  const costUsd = costExact ? result.usage!.cost_usd! : 0;

  // The duration ceiling can only be checked here: nothing before the response knows how long the
  // audio was. The charge already happened, so this warns rather than throws — refusing to return
  // text the owner has paid for would waste the money twice.
  if (config.sttMaxSeconds > 0 && seconds > config.sttMaxSeconds) {
    logger.warn(`[stt] gaii=${gaii} transcribed ${seconds}s, over the ${config.sttMaxSeconds}s guideline (model=${model})`);
  }

  const updated = await recordAiUsage(storage, gaii, usage, {
    costUsd, tokens: totalTok, audioSeconds: seconds, appId: opts.appId,
    // Speech-to-text is priced per second rather than per token, so the token split is whatever the
    // provider reported and the authoritative number is the cost. Named here anyway so a
    // transcription is not a hole in the per-model report.
    model: result.model, provider, promptTokens: 0, completionTokens: totalTok,
    source: 'ai-transcribe',
  });

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
  };
}
