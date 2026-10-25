/**
 * @file src/services/config-schema-features.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Config-tab rows for the features and limits that had none until 2026-10-25 (the seeded
 *   backlog of check:config-coverage): the AI compliance statement and speech limits, packages and
 *   templates, extension spending limits, capability publishing, federation peer availability,
 *   payments (x402) and e-invoicing, message retries, tasks, organism and workspace history caps,
 *   app screenshots, the home page's monetising room and the inactivity email.
 *
 *   Stored in the database. Most take effect at once, because the code reads them on every use; the
 *   ones read when the node starts or when the routes are mounted (the package, template, payment and
 *   e-invoice switches, the message retry interval, the screenshot job and the calibrator) take effect
 *   at the next start (`applies: 'restart'`); every row's readers were read on 2026-10-25. Immutable where
 *   the value decides where a key or a payment goes: the AI provider host allowlist (a decrypted key
 *   is sent only there), the x402 network, facilitator and chain address (they decide whether a
 *   payment is real), the e-invoice operator's address (its key goes there), and the AI provenance
 *   switch, whose legal coercion lives in the loader (config-ai-label.ts).
 * @structure FEATURE_CONFIG_FIELDS
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial.
 */
import type { AimeatConfig } from '../config-types.js';
import type { ConfigFieldShape } from './config-field-def.js';
import { oneOf, isEmptyOrHttpUrl } from './config-schema-validators.js';

const whole = (min: number) => (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= min;
const bool = (v: unknown): boolean => typeof v === 'boolean';
const text = (v: unknown): boolean => typeof v === 'string';
const urlOrNull = (v: unknown): boolean => v === null || isEmptyOrHttpUrl(v);
/** A list row that may be empty: every entry a non-empty word with no comma in it. */
const words = (v: unknown): boolean => Array.isArray(v) && v.every(s => typeof s === 'string' && s.trim() !== '' && !s.includes(','));
/** An object of name to text, the site key-value pairs. */
const textPairs = (v: unknown): boolean => !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v as Record<string, unknown>).every(x => typeof x === 'string');

export const FEATURE_CONFIG_FIELDS: ConfigFieldShape<keyof AimeatConfig>[] = [
  // ── AI: the compliance statement, provenance and speech limits ──
  { key: 'aiProvenance', dotPath: 'ai.provenance', envVar: 'AIMEAT_AI_PROVENANCE', type: 'boolean', validate: bool, immutable: true, description: 'Record how AI-generated content was made. From 4.0.0 a public node records it whatever this says; only a local node may switch it off. Set in the environment' },
  { key: 'aiProvenanceDetail', dotPath: 'ai.provenance_detail', envVar: 'AIMEAT_AI_PROVENANCE_DETAIL', type: 'string', ...oneOf('full', 'minimal'), immutable: false, description: 'How much a provenance record says: full names the model and the steps, minimal only that AI was used' },
  { key: 'aiProviderAllowlist', dotPath: 'ai.provider_allowlist', envVar: 'AIMEAT_AI_PROVIDER_ALLOWLIST', type: 'object', list: true, validate: words, immutable: true, description: 'Hosts an AI provider address may point at before a stored key is sent (openrouter.ai, api.openai.com). Empty allows any public host. Set in the environment' },
  { key: 'aiCopSections', dotPath: 'ai.cop_sections', envVar: 'AIMEAT_AI_COP_SECTIONS', type: 'object', list: true, validate: words, immutable: false, description: 'Sections of the EU General-Purpose AI Code of Practice this node\'s operator has signed, as the AI statement publishes them. Empty claims none' },
  { key: 'aiCopSignedOn', dotPath: 'ai.cop_signed_on', envVar: 'AIMEAT_AI_COP_SIGNED_ON', type: 'string', validate: v => typeof v === 'string' && (v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v)), immutable: false, description: 'Date the operator signed the Code of Practice (2026-08-01). Empty unless sections are set' },
  { key: 'aiSupervisoryName', dotPath: 'ai.supervisory_name', envVar: 'AIMEAT_AI_SUPERVISORY_NAME', type: 'string', validate: text, immutable: false, description: 'The AI market supervisory authority the AI statement names (in Finland Traficom). Not the data-protection authority' },
  { key: 'aiSupervisoryUrl', dotPath: 'ai.supervisory_url', envVar: 'AIMEAT_AI_SUPERVISORY_URL', type: 'string', validate: isEmptyOrHttpUrl, immutable: false, description: 'Address of that authority' },
  { key: 'sttMaxMb', dotPath: 'ai.stt_max_mb', envVar: 'AIMEAT_STT_MAX_MB', type: 'number', validate: whole(1), immutable: false, description: 'Largest recording speech-to-text takes, in megabytes (default 25)', range: '1-500' },
  { key: 'sttMaxSeconds', dotPath: 'ai.stt_max_seconds', envVar: 'AIMEAT_STT_MAX_SECONDS', type: 'number', validate: whole(1), immutable: false, description: 'Longest recording speech-to-text takes, in seconds (default 600)', range: '1-7200' },
  { key: 'voiceMsgMaxSeconds', dotPath: 'ai.voice_message_max_seconds', envVar: 'AIMEAT_VOICE_MSG_MAX_SECONDS', type: 'number', validate: whole(1), immutable: false, description: 'Longest voice message, in seconds (default 300)', range: '1-3600' },
  { key: 'calibratorEnabled', dotPath: 'ai.calibrator_enabled', envVar: 'AIMEAT_CALIBRATOR_ENABLED', type: 'boolean', validate: bool, immutable: false, applies: 'restart', description: 'Offer the prompt calibrator' },

  // ── Packages and templates ──
  { key: 'packagesEnabled', dotPath: 'packages.enabled', envVar: 'AIMEAT_PACKAGES_ENABLED', type: 'boolean', validate: bool, immutable: false, applies: 'restart', description: 'Packages: bundles of apps, extensions, cortexes and skills people install together' },
  { key: 'packageCreateRole', dotPath: 'packages.create_role', envVar: 'AIMEAT_PACKAGE_CREATE_ROLE', type: 'string', ...oneOf('owner', 'operator'), immutable: false, description: 'Who may make a package: every account owner, or the operator only' },
  { key: 'packageMaxSizeMb', dotPath: 'packages.max_size_mb', envVar: 'AIMEAT_PACKAGE_MAX_SIZE_MB', type: 'number', validate: whole(1), immutable: false, description: 'Largest package, in megabytes (default 50)', range: '1-2000' },
  { key: 'packageMaxComponents', dotPath: 'packages.max_components', envVar: 'AIMEAT_PACKAGE_MAX_COMPONENTS', type: 'number', validate: whole(1), immutable: false, description: 'Most parts in one package (default 20)', range: '1-500' },
  { key: 'packageMaxPerAuthor', dotPath: 'packages.max_per_author', envVar: 'AIMEAT_PACKAGE_MAX_PER_AUTHOR', type: 'number', validate: whole(1), immutable: false, description: 'Most packages one account may publish (default 50)', range: '1-10000' },
  { key: 'packageFederationEnabled', dotPath: 'packages.federation_enabled', envVar: 'AIMEAT_PACKAGE_FEDERATION_ENABLED', type: 'boolean', validate: bool, immutable: false, applies: 'restart', description: 'Show packages of federated nodes here and offer this node\'s to them' },
  { key: 'templatesEnabled', dotPath: 'packages.templates_enabled', envVar: 'AIMEAT_TEMPLATES_ENABLED', type: 'boolean', validate: bool, immutable: false, applies: 'restart', description: 'Templates: app starting points people fork' },
  { key: 'templateReviewsEnabled', dotPath: 'packages.template_reviews_enabled', envVar: 'AIMEAT_TEMPLATE_REVIEWS_ENABLED', type: 'boolean', validate: bool, immutable: false, description: 'People may review a template' },
  { key: 'templateDiscussionsEnabled', dotPath: 'packages.template_discussions_enabled', envVar: 'AIMEAT_TEMPLATE_DISCUSSIONS_ENABLED', type: 'boolean', validate: bool, immutable: false, description: 'People may discuss a template' },

  // ── Extensions and capabilities ──
  { key: 'extensionMaxDebitPerCall', dotPath: 'extensions.max_debit_per_call', envVar: 'AIMEAT_EXT_MAX_DEBIT', type: 'number', validate: whole(0), immutable: false, description: 'Most morsels of pacing one call of an extension action may take (default 100)', range: '0-1000000' },
  { key: 'extensionMaxPayMorsels', dotPath: 'extensions.max_pay_morsels', envVar: 'AIMEAT_EXT_MAX_PAY_MORSELS', type: 'number', validate: whole(0), immutable: false, description: 'Highest pacing price an extension\'s action may state in its manifest; a larger one is refused at install (default 10000)', range: '0-100000000' },
  { key: 'capabilityPublishing', dotPath: 'features.capability_publishing', envVar: 'AIMEAT_CAPABILITY_PUBLISHING', type: 'string', ...oneOf('disabled', 'self_only', 'moderated', 'open'), immutable: false, description: 'Who may add a capability to the registry: disabled is the operator only, self_only lets people add private ones, moderated lets them add public ones that wait for the operator\'s review, open lets them add public ones' },
  { key: 'capabilityWebhooks', dotPath: 'features.capability_webhooks', envVar: 'AIMEAT_CAPABILITY_WEBHOOKS', type: 'string', ...oneOf('disabled', 'allowlist_only', 'open'), immutable: false, description: 'Capabilities that call a webhook: none, only to the domains listed below, or any public address' },
  { key: 'capabilityWebhookDomainAllowlist', dotPath: 'features.capability_webhook_domain_allowlist', envVar: 'AIMEAT_CAPABILITY_WEBHOOK_DOMAIN_ALLOWLIST', type: 'object', list: true, validate: words, immutable: false, description: 'Domains a capability webhook may call when webhooks are allowlist_only' },

  // ── Federation peers ──
  { key: 'federationAvailabilityWindowDays', dotPath: 'federation.availability_window_days', envVar: 'AIMEAT_FEDERATION_AVAILABILITY_WINDOW_DAYS', type: 'number', validate: whole(1), immutable: false, description: 'Days over which a peer\'s uptime is counted (default 30)', range: '1-365' },
  { key: 'federationAvailabilityPermanentThreshold', dotPath: 'federation.availability_permanent_threshold', envVar: 'AIMEAT_FEDERATION_AVAILABILITY_PERMANENT_THRESHOLD', type: 'number', validate: v => whole(0)(v) && (v as number) <= 100, immutable: false, description: 'Uptime percent at which a peer counts as permanent rather than temporary (default 90)', range: '0-100' },
  { key: 'federationAvailabilityMinSamples', dotPath: 'federation.availability_min_samples', envVar: 'AIMEAT_FEDERATION_AVAILABILITY_MIN_SAMPLES', type: 'number', validate: whole(1), immutable: false, description: 'Heartbeats a peer needs before its uptime is judged (default 288)', range: '1-100000' },

  // ── Payments and invoicing ──
  { key: 'x402Enabled', dotPath: 'commerce.x402_enabled', envVar: 'AIMEAT_X402_ENABLED', type: 'boolean', validate: bool, immutable: false, applies: 'restart', description: 'Accept x402 stablecoin payments for a USD price' },
  { key: 'x402Network', dotPath: 'commerce.x402_network', envVar: 'AIMEAT_X402_NETWORK', type: 'string', validate: text, immutable: true, description: 'x402 network (base-sepolia for testing, base for real money). Set in the environment' },
  { key: 'x402FacilitatorUrl', dotPath: 'commerce.x402_facilitator_url', envVar: 'AIMEAT_X402_FACILITATOR_URL', type: 'string', validate: isEmptyOrHttpUrl, immutable: true, description: 'x402 facilitator that confirms a payment. It decides whether a payment is real, so it is set in the environment' },
  { key: 'x402RpcUrl', dotPath: 'commerce.x402_rpc_url', envVar: 'AIMEAT_X402_RPC_URL', type: 'string', validate: isEmptyOrHttpUrl, immutable: true, description: 'Chain address the node checks a payment against. Set in the environment' },
  { key: 'finvoiceOperator', dotPath: 'commerce.finvoice_operator', envVar: 'AIMEAT_FINVOICE_OPERATOR', type: 'string', validate: v => v === '' || v === 'mock' || v === 'rest', immutable: false, applies: 'restart', description: 'E-invoice operator: empty is off, mock is a test stand-in, rest a gateway at the address below' },
  { key: 'finvoiceOperatorUrl', dotPath: 'commerce.finvoice_operator_url', envVar: 'AIMEAT_FINVOICE_OPERATOR_URL', type: 'string', validate: urlOrNull, immutable: true, description: 'Address of the e-invoice gateway. Its key is sent there, so it is set in the environment' },
  { key: 'finvoiceOperatorApiKey', dotPath: 'commerce.finvoice_operator_key', envVar: 'AIMEAT_FINVOICE_OPERATOR_KEY', type: 'string', validate: v => v === null || typeof v === 'string', immutable: false, description: 'Key of the e-invoice gateway (secret)', adminDisplay: 'configured' },

  // ── Messages, tasks and history ──
  { key: 'outboundDailyLimit', dotPath: 'email.outbound_daily_limit', envVar: 'AIMEAT_OUTBOUND_DAILY_LIMIT', type: 'number', validate: whole(0), immutable: false, description: 'Most messages one account may send out in 24 hours (default 200)', range: '0-100000' },
  { key: 'messageRetryIntervalMs', dotPath: 'federation.message_retry_interval_ms', envVar: 'AIMEAT_MESSAGE_RETRY_INTERVAL_MS', type: 'number', validate: whole(1000), immutable: false, applies: 'restart', description: 'How often a message to another node that did not arrive is tried again, in milliseconds (default 60000)', range: '1000-86400000' },
  { key: 'messageRetryTtlHours', dotPath: 'federation.message_retry_ttl_hours', envVar: 'AIMEAT_MESSAGE_RETRY_TTL_HOURS', type: 'number', validate: whole(1), immutable: false, description: 'Hours a message to another node is tried before it is marked undeliverable (default 168)', range: '1-8760' },
  { key: 'taskStallThresholdMinutes', dotPath: 'tasks.stall_threshold_minutes', envVar: 'AIMEAT_TASK_STALL_THRESHOLD_MINUTES', type: 'number', validate: whole(1), immutable: false, description: 'Minutes without progress after which a running task counts as stalled (default 120)', range: '1-100000' },
  { key: 'executionLogRetentionDays', dotPath: 'tasks.execution_log_retention_days', envVar: 'AIMEAT_EXECUTION_LOG_RETENTION_DAYS', type: 'number', validate: whole(1), immutable: false, description: 'Days the execution log of workflow and action runs is kept (default 30)', range: '1-3650' },
  { key: 'organismDecisionLogCap', dotPath: 'quota.organism_decision_log_cap', envVar: 'AIMEAT_ORGANISM_DECISION_LOG_CAP', type: 'number', validate: whole(0), immutable: false, description: 'Decision log entries kept per organism; the oldest go first (default 500, 0 keeps all)', range: '0-1000000' },
  { key: 'workspaceMaxVersions', dotPath: 'quota.workspace_max_versions', envVar: 'AIMEAT_WS_MAX_VERSIONS', type: 'number', validate: whole(0), immutable: false, description: 'Earlier versions kept of each workspace record when it is published again (default 20, 0 keeps all)', range: '0-10000' },

  // ── Apps and the home page ──
  { key: 'appAssetProbe', dotPath: 'apps.asset_probe', envVar: 'AIMEAT_APP_ASSET_PROBE', type: 'boolean', validate: bool, immutable: false, description: 'Before an app is published, check that the scripts and styles it loads from this node exist. Off only where the node cannot reach itself' },
  { key: 'screenshotAutoCapture', dotPath: 'apps.screenshot_auto', envVar: 'AIMEAT_SCREENSHOT_AUTO', type: 'boolean', validate: bool, immutable: false, applies: 'restart', description: 'Take a picture of each published app by itself, for its card' },
  { key: 'screenshotIntervalMin', dotPath: 'apps.screenshot_interval_min', envVar: 'AIMEAT_SCREENSHOT_INTERVAL_MIN', type: 'number', validate: whole(1), immutable: false, applies: 'restart', description: 'Minutes between rounds of app pictures (default 15)', range: '1-10080' },
  { key: 'screenshotSettleMs', dotPath: 'apps.screenshot_settle_ms', envVar: 'AIMEAT_SCREENSHOT_SETTLE_MS', type: 'number', validate: whole(0), immutable: false, description: 'Milliseconds to wait after an app loads before its picture is taken (default 6000)', range: '0-60000' },
  { key: 'screenshotOnDemandPerHour', dotPath: 'apps.screenshot_on_demand_per_hour', envVar: 'AIMEAT_SCREENSHOT_ONDEMAND_PER_HOUR', type: 'number', validate: whole(0), immutable: false, description: 'App pictures one account may ask for in an hour (default 20)', range: '0-10000' },
  { key: 'homeRoomMonetise', dotPath: 'site.home_room_monetise', envVar: 'AIMEAT_HOME_ROOM_MONETISE', type: 'boolean', validate: bool, immutable: false, description: 'Show the front page\'s third room, which sells. Off until the operator has checked that it leads somewhere' },
  { key: 'siteKv', dotPath: 'site.kv', envVar: 'AIMEAT_SITE_KV', type: 'object', validate: textPairs, immutable: false, description: 'Values the site templates read by name, as JSON {"name": "text"}. Each AIMEAT_SITE_KV_<NAME> variable adds one and wins over the same name here' },
  { key: 'inactivityNudge', dotPath: 'features.inactivity_nudge', envVar: 'AIMEAT_INACTIVITY_NUDGE', type: 'boolean', validate: bool, immutable: false, description: 'Email a person who has not been here for two weeks. Off by default: it is mail nobody asked for' },
];
