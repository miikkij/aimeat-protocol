/**
 * @file src/config-ai-models.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which key pays for the node's AI and which model each role gets when nobody chose
 *   one: the node's OpenRouter key, the free allowance, the free fallback model and the per-role
 *   node defaults, read from the environment.
 *
 *   Its own file for the reason config-ai-jobs.ts and config-decide.ts are: config.ts is at the line
 *   ceiling, and everything here answers one question, which models the node itself offers. The
 *   fields are typed in config-types-ai.ts (AiCapabilityConfig), and the spread in loadConfig is
 *   where the compiler checks the two agree.
 * @structure aiModelDefaults() · AI_LEGACY_SETTINGS_ROUTES_REMOVED_IN · aiLegacySettingsRoutesAllowed()
 * @usage
 *   import { aiModelDefaults } from './config-ai-models.js';
 *   const config = { ...aiModelDefaults(), ... };
 * @version-history
 *   2026-10-25 — aiNodeKeyMaxOutputTokens (AIMEAT_AI_NODE_KEY_MAX_OUTPUT_TOKENS, default 32000, 0 = no
 *     limit; secaudit2026oct22, node-key-allowance-precheck-unbounded-call-cost).
 *   v1.6.1 — 2026-10-12 — /v1/ai/settings is not among the removed routes: it holds the budget.
 *   v1.6.0 — 2026-10-12 — AI_LEGACY_SETTINGS_ROUTES_REMOVED_IN (4.0.0): from it the legacy AI settings
 *     routes are off whatever AIMEAT_AI_LEGACY_SETTINGS_ROUTES says (Core 2026-11 HTTP-08).
 *   v1.5.0 — 2026-10-05 — aiNodeKeyWhenSpent, aiNodeKeyAccountDailyUsd, aiNodeKeyNodeDailyUsd: what the
 *     node's key does once a person's allowance is spent (secaudit 2026-10, AI-1).
 *   v1.4.0 — 2026-09-28 — Capabilities for apps and agents (System 2 plan, V5): modelDefaultTts,
 *     modelDefaultEmbed and ttsVoiceDefault.
 *   v1.3.0 — 2026-09-28 — The model catalogue (System 2 plan, V4): aiCatalogRefresh, aiPriceOverrides,
 *     aiCatalogSources.
 *   v1.2.0 — 2026-09-28 — The operator's AI providers (System 2 plan, V3): aiProviders,
 *     aiBuiltinProviders, aiProviderEgress, aiProviderTypes and aiFixedBaseUrlOverrides; and
 *     aiLegacySettingsRoutes, the flag of the deprecated settings routes.
 *   v1.1.0 — 2026-09-28 — aiRecommendedModels (AIMEAT_AI_RECOMMENDED_MODELS), System 2 plan V2.
 *   v1.0.0 — 2026-09-28 — Extracted from config.ts (pure extraction; no behaviour change), ahead of
 *     the recommended-models setting of the System 2 plan.
 */
import type { AiCapabilityConfig } from './config-types-ai.js';
import { getSoftwareVersion, versionAtLeast } from './utils/version.js';

/**
 * The release in which the AI settings routes from before providers (/v1/openrouter/settings,
 * /models, /test) are gone: from it they answer 410 whatever AIMEAT_AI_LEGACY_SETTINGS_ROUTES says
 * (routes/openrouter.ts legacyAiSettingsRoute). GET and POST /v1/ai/settings stay: the daily budget,
 * the per-app caps and the app allowlist have no successor under /v1/ai/providers.
 */
export const AI_LEGACY_SETTINGS_ROUTES_REMOVED_IN = '4.0.0';

/** Whether the legacy AI settings routes still answer: the setting, and only before the removal. */
export function aiLegacySettingsRoutesAllowed(
  config: Pick<AiCapabilityConfig, 'aiLegacySettingsRoutes'>, version: string = getSoftwareVersion(),
): boolean {
  return config.aiLegacySettingsRoutes && !versionAtLeast(version, AI_LEGACY_SETTINGS_ROUTES_REMOVED_IN);
}

type AiModelSettings = Pick<AiCapabilityConfig,
  'openrouterInstanceKey' | 'chatFreeAllowanceUsd' | 'modelFreeFallback'
  | 'aiNodeKeyWhenSpent' | 'aiNodeKeyAccountDailyUsd' | 'aiNodeKeyNodeDailyUsd' | 'aiNodeKeyMaxOutputTokens'
  | 'modelDefaultChat' | 'modelDefaultReasoning' | 'modelDefaultExecution'
  | 'modelDefaultVision' | 'modelDefaultStt' | 'modelDefaultImage' | 'sttLanguageDefault'
  | 'modelDefaultTts' | 'modelDefaultEmbed' | 'ttsVoiceDefault'
  | 'aiRecommendedModels' | 'aiProviders' | 'aiBuiltinProviders' | 'aiProviderEgress'
  | 'aiProviderTypes' | 'aiFixedBaseUrlOverrides' | 'aiLegacySettingsRoutes'
  | 'aiCatalogRefresh' | 'aiPriceOverrides' | 'aiCatalogSources'>;

/** A non-negative amount from the environment, or `fallback` when it is missing or not a number. */
function nonNegative(raw: string | undefined, fallback: number): number {
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** The node's AI key and model defaults, from the environment. */
export function aiModelDefaults(): AiModelSettings {
  return {
    openrouterInstanceKey: process.env.AIMEAT_OPENROUTER_INSTANCE_KEY ?? '',
    chatFreeAllowanceUsd: parseFloat(process.env.AIMEAT_CHAT_FREE_ALLOWANCE_USD ?? '0') || 0,
    modelFreeFallback: process.env.AIMEAT_MODEL_FREE_FALLBACK ?? 'openrouter/free',
    aiNodeKeyWhenSpent: process.env.AIMEAT_AI_NODE_KEY_WHEN_SPENT === 'limits' ? 'limits' : 'refuse',
    aiNodeKeyAccountDailyUsd: nonNegative(process.env.AIMEAT_AI_NODE_KEY_ACCOUNT_DAILY_USD, 1),
    aiNodeKeyNodeDailyUsd: nonNegative(process.env.AIMEAT_AI_NODE_KEY_NODE_DAILY_USD, 10),
    aiNodeKeyMaxOutputTokens: Math.floor(nonNegative(process.env.AIMEAT_AI_NODE_KEY_MAX_OUTPUT_TOKENS, 32000)),
    modelDefaultChat: process.env.AIMEAT_MODEL_DEFAULT_CHAT ?? '',
    modelDefaultReasoning: process.env.AIMEAT_MODEL_DEFAULT_REASONING ?? '',
    modelDefaultExecution: process.env.AIMEAT_MODEL_DEFAULT_EXECUTION ?? '',
    modelDefaultVision: process.env.AIMEAT_MODEL_DEFAULT_VISION ?? '',
    modelDefaultStt: process.env.AIMEAT_MODEL_DEFAULT_STT ?? '',
    modelDefaultImage: process.env.AIMEAT_MODEL_DEFAULT_IMAGE ?? '',
    sttLanguageDefault: process.env.AIMEAT_STT_LANGUAGE_DEFAULT ?? '',
    modelDefaultTts: process.env.AIMEAT_MODEL_DEFAULT_TTS ?? '',
    modelDefaultEmbed: process.env.AIMEAT_MODEL_DEFAULT_EMBED ?? '',
    ttsVoiceDefault: process.env.AIMEAT_TTS_VOICE_DEFAULT ?? '',
    aiRecommendedModels: process.env.AIMEAT_AI_RECOMMENDED_MODELS ?? '',
    aiProviders: process.env.AIMEAT_AI_PROVIDERS ?? '',
    aiBuiltinProviders: process.env.AIMEAT_AI_BUILTIN_PROVIDERS ?? '',
    aiProviderEgress: process.env.AIMEAT_AI_PROVIDER_EGRESS ?? '',
    aiProviderTypes: process.env.AIMEAT_AI_PROVIDER_TYPES ?? '',
    aiFixedBaseUrlOverrides: process.env.AIMEAT_AI_FIXED_BASEURL_OVERRIDES ?? '',
    aiLegacySettingsRoutes: process.env.AIMEAT_AI_LEGACY_SETTINGS_ROUTES !== 'false'
      && !versionAtLeast(getSoftwareVersion(), AI_LEGACY_SETTINGS_ROUTES_REMOVED_IN),
    aiCatalogRefresh: process.env.AIMEAT_AI_CATALOG_REFRESH === 'daily' || process.env.AIMEAT_AI_CATALOG_REFRESH === 'off'
      ? process.env.AIMEAT_AI_CATALOG_REFRESH : 'weekly',
    aiPriceOverrides: process.env.AIMEAT_AI_PRICE_OVERRIDES ?? '',
    aiCatalogSources: process.env.AIMEAT_AI_CATALOG_SOURCES ?? '',
  };
}
