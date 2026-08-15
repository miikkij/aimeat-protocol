/**
 * @file ai-model-defaults.ts
 * @description One rule for picking a model, for every role: the owner's own setting, then the
 *   instance default, then nothing.
 *
 *   The rule exists because an API key on its own does not make a node usable. Every model role is
 *   an owner-level setting, and several of them are an error rather than a fallback when unset, so a
 *   brand-new account on a node that pays for its own inference still cannot transcribe speech, read
 *   an image or make one until it visits a settings page it has no reason to know about. Speech is
 *   the sharpest case: an empty sttModel is NO_STT_MODEL, deliberately, because the chat model would
 *   otherwise be handed audio and answer with an opaque provider error.
 *
 *   Everything here is inert until an operator sets a default. With the environment untouched every
 *   role resolves to exactly what it resolved to before this file existed, which is what makes it
 *   safe to put in front of the existing selection rather than beside it.
 * @structure
 *   - ModelRole — the six roles a completion can ask for
 *   - resolveModelFor() — owner setting -> instance default -> undefined
 *   - resolveSttLanguage() — the same shape for the speech-to-text language hint
 * @usage
 *   const model = resolveModelFor(config, prefs, 'vision') ?? resolveModelFor(config, prefs, 'chat');
 * @version-history
 *   v1.0.0 — 2026-08-16 — Initial. Six roles plus the language hint.
 */
import type { AimeatConfig } from '../config.js';

/** The roles a caller can ask for. Each maps to one owner preference and one instance default. */
export type ModelRole = 'chat' | 'reasoning' | 'execution' | 'vision' | 'stt' | 'image';

/** The owner's `openrouter.settings` record, as it comes out of memory: free-form JSON. */
export type OwnerModelPrefs = Record<string, unknown>;

/** Which preference key holds the owner's choice for each role. */
const PREF_KEY: Record<ModelRole, string> = {
    chat: 'model',
    reasoning: 'reasoningModel',
    execution: 'executionModel',
    vision: 'visionModel',
    stt: 'sttModel',
    image: 'imageModel',
};

/** Which config field holds the instance default for each role. */
const CONFIG_KEY: Record<ModelRole, keyof AimeatConfig> = {
    chat: 'modelDefaultChat',
    reasoning: 'modelDefaultReasoning',
    execution: 'modelDefaultExecution',
    vision: 'modelDefaultVision',
    stt: 'modelDefaultStt',
    image: 'modelDefaultImage',
};

/** A setting counts only when it is a non-empty string; '' is how both layers say "not set". */
function usable(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * The model for one role, or undefined when neither layer names one.
 *
 * Undefined is a real answer and callers are expected to act on it: the completion path falls
 * through to the next role and finally to the vendor-neutral free router, while transcription
 * refuses by name. Substituting a chat model for a missing speech model would turn a clear local
 * refusal into an opaque upstream one, which is the trade this returns undefined to avoid.
 */
export function resolveModelFor(
    config: AimeatConfig, prefs: OwnerModelPrefs | undefined, role: ModelRole,
): string | undefined {
    return usable(prefs?.[PREF_KEY[role]]) ?? usable(config[CONFIG_KEY[role]]);
}

/**
 * The speech-to-text language hint, same order. Undefined means let the model detect the language,
 * which is the right answer for mixed-language speech and the reason this is a hint rather than a
 * setting with a hardcoded default.
 */
export function resolveSttLanguage(
    config: AimeatConfig, prefs: OwnerModelPrefs | undefined,
): string | undefined {
    return usable(prefs?.sttLanguage) ?? usable(config.sttLanguageDefault);
}
