/**
 * @file ai-model-defaults.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   - ModelRole — the eight roles a call can ask for
 *   - resolveModelFor() — owner setting -> instance default -> undefined
 *   - resolveSttLanguage() — the same shape for the speech-to-text language hint
 *   - resolveTtsVoice() — the same shape for the speech voice
 * @usage
 *   const model = resolveModelFor(config, prefs, 'vision') ?? resolveModelFor(config, prefs, 'chat');
 * @version-history
 *   v1.3.0 — 2026-10-02 — An owner's `model` of 'openrouter/free' counts only when the owner chose it
 *     (`modelChosen: true`, written by PUT /v1/openrouter/settings with an explicit model). Until this
 *     version a key-only save wrote the free router as the default, and it then came before the
 *     node's default: an owner who saved their own key had every call downgraded to a free model.
 *     Ruled by Jouni on 2026-10-02: an own key uses the node's default model unless the owner chose
 *     one, and a free model only when chosen.
 *   v1.2.0 — 2026-09-28 — The owner's `ttsModel`, `embedModel` and `ttsVoice` are no longer read: no page
 *     or route wrote them, and the owner sets speech and embeddings on a provider (AI roles, plan
 *     brief-tekoalyn-roolit). The node's defaults for both stay.
 *   v1.1.0 — 2026-09-28 — Roles tts and embed, and the speech voice (System 2 plan, V5).
 *   v1.0.0 — 2026-08-16 — Initial. Six roles plus the language hint.
 */
import type { AimeatConfig } from '../config.js';

/** The roles a caller can ask for. Each maps to one owner preference and one instance default. */
export type ModelRole = 'chat' | 'reasoning' | 'execution' | 'vision' | 'stt' | 'image' | 'tts' | 'embed';

/** The owner's `openrouter.settings` record, as it comes out of memory: free-form JSON. */
export type OwnerModelPrefs = Record<string, unknown>;

/**
 * Which preference key holds the owner's choice for each role. Speech and embeddings have none: no
 * page or route ever wrote an owner's `ttsModel` or `embedModel`, and the owner sets both as a model on
 * a provider's capability (AI roles, 2026-09-28). Only the node's default applies to them here.
 */
const PREF_KEY: Partial<Record<ModelRole, string>> = {
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
    tts: 'modelDefaultTts',
    embed: 'modelDefaultEmbed',
};

/** A setting counts only when it is a non-empty string; '' is how both layers say "not set". */
function usable(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
}

/** The model a key-only save wrote as the chat default until 2026-10-02 (routes/openrouter.ts). */
export const IMPLICIT_FREE_MODEL = 'openrouter/free';

/**
 * Whether the record's `model` is the free router NOBODY chose: written by a key-only save before
 * 2026-10-02, with no `modelChosen` mark. The same test the boot migration uses to clear it
 * (services/openrouter-settings-migration.ts), so a record the migration has not reached yet
 * resolves the same way.
 */
export function holdsImplicitFreeModel(prefs: OwnerModelPrefs | undefined): boolean {
    return prefs?.model === IMPLICIT_FREE_MODEL && prefs?.modelChosen !== true;
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
    const pref = PREF_KEY[role];
    const own = pref ? usable(prefs?.[pref]) : undefined;
    // The free router an old key-only save wrote is not a choice: the node's default comes first.
    const chosen = role === 'chat' && own !== undefined && holdsImplicitFreeModel(prefs) ? undefined : own;
    return chosen ?? usable(config[CONFIG_KEY[role]]);
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

/**
 * The speech voice when the provider's speech capability names none: the node's default. The owner's
 * `ttsVoice` is not read: nothing ever wrote it, and the owner sets the voice on the provider.
 */
export function resolveTtsVoice(
    config: AimeatConfig, _prefs?: OwnerModelPrefs,
): string | undefined {
    return usable(config.ttsVoiceDefault);
}
