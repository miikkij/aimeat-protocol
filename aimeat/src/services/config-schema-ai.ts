/**
 * @file src/services/config-schema-ai.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The System 2 AI settings on the admin Config tab: the operator's providers, the
 *   recommended models and the model catalogue. A pure move out of config-schema.ts (max-file-lines):
 *   CONFIG_FIELDS spreads these rows where they stood, so the Config tab lists them in the same order.
 * @structure SYSTEM2_AI_CONFIG_FIELDS
 * @version-history
 *   v1.1.1 — 2026-09-28 — Typed by AiCapabilityConfig, not AimeatConfig, which closed an import cycle.
 *   v1.1.0 — 2026-09-28 — The model catalogue (System 2 plan, V4): ai.catalog_refresh,
 *     ai.price_overrides, ai.catalog_sources.
 *   v1.0.0 — 2026-09-28 — Moved from config-schema.ts, unchanged.
 */
// The AI part of the config type, not AimeatConfig: config.ts reaches config-schema.ts, so importing
// it here would close an import cycle.
import type { AiCapabilityConfig } from '../config-types-ai.js';
import type { ConfigFieldShape } from './config-field-def.js';
import { parseRecommendedModels } from './ai/policy.js';
import { isJsonObject } from './config-schema-validators.js';

export const SYSTEM2_AI_CONFIG_FIELDS: ConfigFieldShape<keyof AiCapabilityConfig>[] = [
  // The operator's AI providers (System 2 plan, V3; services/ai/providers.ts). Immutable where an
  // address or a key name is at stake, as System 1's decide.providers and decide.provider_egress are.
  { key: 'aiProviders', dotPath: 'ai.providers', envVar: 'AIMEAT_AI_PROVIDERS', type: 'string', validate: v => typeof v === 'string', immutable: true, description: 'More AI providers of the node, as a JSON array of provider records (id, title, type, baseUrl, auth, capabilities). Auth is none or the NAME of an environment variable, never a key' },
  { key: 'aiBuiltinProviders', dotPath: 'ai.builtin_providers', envVar: 'AIMEAT_AI_BUILTIN_PROVIDERS', type: 'string', validate: v => typeof v === 'string' && /^[a-z,\s]*$/.test(v as string), immutable: true, description: 'Local AI servers to switch on, comma separated: lmstudio, ollama, llamacpp, at their usual ports on this machine', range: 'lmstudio,ollama,llamacpp' },
  { key: 'aiProviderEgress', dotPath: 'ai.provider_egress', envVar: 'AIMEAT_AI_PROVIDER_EGRESS', type: 'string', validate: v => typeof v === 'string', immutable: true, description: 'Exact addresses (scheme, host, port) of the operator\'s own local AI servers, comma separated. Only the node\'s own providers may reach them; an owner\'s provider never does', range: 'http://127.0.0.1:1234,http://ollama:11434' },
  { key: 'aiProviderTypes', dotPath: 'ai.provider_types', envVar: 'AIMEAT_AI_PROVIDER_TYPES', type: 'string', validate: v => typeof v === 'string' && /^[a-z,\s]*$/.test(v as string), immutable: false, description: 'Which fixed provider types this node allows, comma separated: openrouter, openai, anthropic, mistral, xai. Empty allows all five at their official addresses', range: 'openrouter,anthropic' },
  { key: 'aiFixedBaseUrlOverrides', dotPath: 'ai.fixed_baseurl_overrides', envVar: 'AIMEAT_AI_FIXED_BASEURL_OVERRIDES', type: 'string', validate: v => typeof v === 'string' && (!(v as string).trim() || isJsonObject(v as string)), immutable: true, description: 'Points a fixed provider type at another address, as JSON {"anthropic": "http://127.0.0.1:40699/v1"}, for a test stub. Refused on a public node' },
  { key: 'aiLegacySettingsRoutes', dotPath: 'ai.legacy_settings_routes', envVar: 'AIMEAT_AI_LEGACY_SETTINGS_ROUTES', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'The AI settings routes from before providers (/v1/openrouter/settings, /models, /test, /v1/ai/settings) still answer. Deprecated: they are removed in 4.0.0; off, they answer 410 Gone naming /v1/ai/providers' },
  { key: 'aiRecommendedModels', dotPath: 'ai.recommended_models', envVar: 'AIMEAT_AI_RECOMMENDED_MODELS', type: 'string', validate: v => typeof v === 'string' && parseRecommendedModels(v).problems.length === 0, immutable: false, description: 'The models this node recommends, per capability, as JSON: {"text": ["openrouter:anthropic/claude-opus-5.5"], "image": [...]}, in order. An owner who chooses the recommended models may use only these. Empty recommends nothing' },
  // The model catalogue (System 2 plan, V4; services/ai/catalog/).
  { key: 'aiCatalogRefresh', dotPath: 'ai.catalog_refresh', envVar: 'AIMEAT_AI_CATALOG_REFRESH', type: 'string', validate: v => v === 'weekly' || v === 'daily' || v === 'off', immutable: false, description: 'How often the node refreshes its model catalogue (what each model can do and costs) from models.dev, OpenRouter and LiteLLM: weekly, daily or off. Off keeps the list the build shipped with', range: 'weekly|daily|off' },
  { key: 'aiPriceOverrides', dotPath: 'ai.price_overrides', envVar: 'AIMEAT_AI_PRICE_OVERRIDES', type: 'string', validate: v => typeof v === 'string' && (!(v as string).trim() || isJsonObject(v as string)), immutable: false, description: 'Price corrections that win over the catalogue sources, as JSON {"anthropic:claude-opus-5-5": {"inPerMtok": 4, "outPerMtok": 20}}, in USD per million tokens (perImage, speechPerChar, transcriptionPerSecond per unit)' },
  { key: 'aiCatalogSources', dotPath: 'ai.catalog_sources', envVar: 'AIMEAT_AI_CATALOG_SOURCES', type: 'string', validate: v => typeof v === 'string' && (!(v as string).trim() || isJsonObject(v as string)), immutable: true, description: 'Other addresses for the catalogue sources, as JSON {"modelsDev": "...", "openRouter": "...", "liteLlm": "..."}, for a mirror or a test stub. Empty uses the public sources' },
];
