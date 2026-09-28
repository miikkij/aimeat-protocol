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
 * @structure aiModelDefaults()
 * @usage
 *   import { aiModelDefaults } from './config-ai-models.js';
 *   const config = { ...aiModelDefaults(), ... };
 * @version-history
 *   v1.2.0 — 2026-09-28 — The operator's AI providers (System 2 plan, V3): aiProviders,
 *     aiBuiltinProviders, aiProviderEgress, aiProviderTypes and aiFixedBaseUrlOverrides; and
 *     aiLegacySettingsRoutes, the flag of the deprecated settings routes.
 *   v1.1.0 — 2026-09-28 — aiRecommendedModels (AIMEAT_AI_RECOMMENDED_MODELS), System 2 plan V2.
 *   v1.0.0 — 2026-09-28 — Extracted from config.ts (pure extraction; no behaviour change), ahead of
 *     the recommended-models setting of the System 2 plan.
 */
import type { AiCapabilityConfig } from './config-types-ai.js';

type AiModelSettings = Pick<AiCapabilityConfig,
  'openrouterInstanceKey' | 'chatFreeAllowanceUsd' | 'modelFreeFallback'
  | 'modelDefaultChat' | 'modelDefaultReasoning' | 'modelDefaultExecution'
  | 'modelDefaultVision' | 'modelDefaultStt' | 'modelDefaultImage' | 'sttLanguageDefault'
  | 'aiRecommendedModels' | 'aiProviders' | 'aiBuiltinProviders' | 'aiProviderEgress'
  | 'aiProviderTypes' | 'aiFixedBaseUrlOverrides' | 'aiLegacySettingsRoutes'>;

/** The node's AI key and model defaults, from the environment. */
export function aiModelDefaults(): AiModelSettings {
  return {
    openrouterInstanceKey: process.env.AIMEAT_OPENROUTER_INSTANCE_KEY ?? '',
    chatFreeAllowanceUsd: parseFloat(process.env.AIMEAT_CHAT_FREE_ALLOWANCE_USD ?? '0') || 0,
    modelFreeFallback: process.env.AIMEAT_MODEL_FREE_FALLBACK ?? 'openrouter/free',
    modelDefaultChat: process.env.AIMEAT_MODEL_DEFAULT_CHAT ?? '',
    modelDefaultReasoning: process.env.AIMEAT_MODEL_DEFAULT_REASONING ?? '',
    modelDefaultExecution: process.env.AIMEAT_MODEL_DEFAULT_EXECUTION ?? '',
    modelDefaultVision: process.env.AIMEAT_MODEL_DEFAULT_VISION ?? '',
    modelDefaultStt: process.env.AIMEAT_MODEL_DEFAULT_STT ?? '',
    modelDefaultImage: process.env.AIMEAT_MODEL_DEFAULT_IMAGE ?? '',
    sttLanguageDefault: process.env.AIMEAT_STT_LANGUAGE_DEFAULT ?? '',
    aiRecommendedModels: process.env.AIMEAT_AI_RECOMMENDED_MODELS ?? '',
    aiProviders: process.env.AIMEAT_AI_PROVIDERS ?? '',
    aiBuiltinProviders: process.env.AIMEAT_AI_BUILTIN_PROVIDERS ?? '',
    aiProviderEgress: process.env.AIMEAT_AI_PROVIDER_EGRESS ?? '',
    aiProviderTypes: process.env.AIMEAT_AI_PROVIDER_TYPES ?? '',
    aiFixedBaseUrlOverrides: process.env.AIMEAT_AI_FIXED_BASEURL_OVERRIDES ?? '',
    aiLegacySettingsRoutes: process.env.AIMEAT_AI_LEGACY_SETTINGS_ROUTES !== 'false',
  };
}
