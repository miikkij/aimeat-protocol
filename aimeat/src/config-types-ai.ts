/**
 * @file config-types-ai.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The AI half of the node's configuration: which key pays, how much of it one person
 *   may use, which model each role gets, and how often an app may be rendered.
 *
 *   Its own file because config-types.ts reached the 800-line ceiling. A pure extraction — the fields
 *   are unchanged and AimeatConfig extends this — and a coherent one: everything here answers a
 *   question about the node's own AI capability rather than about storage, federation or quotas.
 * @structure AiCapabilityConfig — extended by AimeatConfig in config-types.ts
 * @usage config.modelDefaultChat, config.openrouterInstanceKey, … (unchanged; the split is invisible)
 * @version-history
 *   v1.5.0 — 2026-09-28 — modelDefaultTts, modelDefaultEmbed, ttsVoiceDefault (System 2 plan, V5).
 *   v1.4.0 — 2026-09-28 — The model catalogue (System 2 plan, V4): aiCatalogRefresh, aiPriceOverrides,
 *     aiCatalogSources.
 *   v1.3.0 — 2026-09-28 — The operator's AI providers (System 2 plan, V3): aiProviders,
 *     aiBuiltinProviders, aiProviderEgress, aiProviderTypes, aiFixedBaseUrlOverrides.
 *   v1.2.0 — 2026-09-28 — aiRecommendedModels: the operator's recommended models per capability
 *     (System 2 plan, V2).
 *   v1.1.0 — 2026-09-19 — Extends DecideConfig (config-decide.ts): the decision provider's settings,
 *     beside the text provider's and never inside them (TARGET-080).
 *   v1.0.0 — 2026-08-16 — Extracted from config-types.ts (pure extraction; no behaviour change).
 */
import type { DecideConfig } from './config-decide.js';

export interface AiCapabilityConfig extends DecideConfig {
  /**
   * The goose binary the chat agent runs as a child process (`goose acp`, ACP over stdio). Empty
   * (the default) disables the chat entirely, which is what every node does until an operator
   * installs one.
   *
   * Stdio rather than `goose serve` over HTTP, and that was measured: the HTTP transport accepts
   * requests but delivers no session/update notifications, so every turn is silent. Stdio also
   * needs no port, no shared secret and no loopback surface to protect.
   */
  gooseBin: string;
  /**
   * How many chat conversations stay open before the oldest rolls into a per-month archive record.
   * A memory namespace holds 1000 keys, and one key per conversation forever would spend them: five
   * a day is 1825 in a year.
   */
  chatMaxLiveThreads: number;
  /** GOOSE_PATH_ROOT for the child: its own config and session store, away from any human's. */
  goosePathRoot: string;
  /** The provider key the agent calls with. Who may spend it is decided before a turn starts. */
  gooseProviderApiKey: string;
  /**
   * Which provider and model the chat agent runs on, handed to the child as GOOSE_PROVIDER and
   * GOOSE_MODEL. Empty (the default) leaves goose's own configuration alone, which is what every
   * node did before these existed.
   *
   * The node sets them for two reasons rather than one. The obvious one is that an operator should
   * not have to edit a second configuration file to change the model. The other is that the node
   * cannot otherwise NAME the model that answered: ACP reports a stop reason and a token count and
   * not a model, so `ChatTurn.model` stayed empty and the chip that says which model answered never
   * appeared. What the node sets, the node can write down.
   */
  gooseProvider: string;
  gooseModel: string;
  /**
   * Extra environment variable NAMES the chat agent child may see, beside the allow-list in
   * services/goose-env.ts. For a host that runs goose on another provider and passes that
   * provider's key in the environment. Read from the environment only, never from the admin screen.
   */
  gooseEnvPassthrough: string[];
  /**
   * This node's own OpenRouter key, used for a person who has not brought one. Empty (the default)
   * means the node pays for nothing and everyone brings their own, which is how every node behaved
   * before this existed.
   *
   * Shared by everyone here, so the node meters each person itself (services/ai-allowance.ts). That
   * is the shape OpenRouter's terms allow: the node runs its own product on its own key, and nobody
   * is handed raw API access.
   */
  openrouterInstanceKey: string;
  /** Free starting allowance in USD, applied once per person. 0 (the default) grants nothing. */
  chatFreeAllowanceUsd: number;
  /**
   * What the node's key does for a person whose allowance is spent (services/ai-allowance.ts
   * nodeKeyStanding). 'refuse' (the default): it pays for nothing more, whatever model the call
   * names; a call that names none still gets the free fallback model. 'limits': it keeps paying, up
   * to the two daily ceilings below. The operator decides (Jouni, 2026-10-05; secaudit 2026-10 AI-1).
   */
  aiNodeKeyWhenSpent: 'refuse' | 'limits';
  /** In 'limits' mode: the most one account's calls may cost the node's key in one day (UTC), USD. */
  aiNodeKeyAccountDailyUsd: number;
  /** In 'limits' mode: the most all accounts' calls together may cost the node's key in one day, USD. */
  aiNodeKeyNodeDailyUsd: number;
  /**
   * Model used when someone on the node's key has spent their allowance. Empty means refuse instead
   * of degrading. A free model is a worse answer, not a wrong one, as long as the person is told.
   */
  modelFreeFallback: string;
  /**
   * Instance-level model defaults, one per role. Read only when the OWNER has not chosen a model of
   * their own: owner setting, then this, then a refusal that names what to set. Empty (the default)
   * means the node states no preference and behaves exactly as it did before these existed.
   *
   * They belong with the instance API key rather than beside it. A key alone does not let a new
   * person speak, read an image or make one, because every model role is an owner-level setting and
   * an unset one is an error rather than a fallback — speech-to-text is the sharpest case, where a
   * brand-new account cannot use the microphone at all until it visits a settings page it has no
   * reason to know about. That is the wrong order.
   */
  modelDefaultChat: string;
  modelDefaultReasoning: string;
  modelDefaultExecution: string;
  modelDefaultVision: string;
  modelDefaultStt: string;
  modelDefaultImage: string;
  /** Speech (text to speech) and embeddings, the two roles V5 of the System 2 plan adds. The node's
   *  key pays for either only when the operator named its model here (ruling J4). */
  modelDefaultTts: string;
  modelDefaultEmbed: string;
  /** The voice a speech call gets when neither the call nor the owner named one. Empty = the call names it. */
  ttsVoiceDefault: string;
  /** ISO-639-1 hint for speech-to-text when the owner has set none. Empty = let the model detect. */
  sttLanguageDefault: string;
  /**
   * The models this operator recommends, per capability, as JSON: `{ "text": ["openrouter:…"], … }`
   * with `<type>:<model id>` references in order (services/ai/policy.ts). No model names live in
   * code: a fresh node recommends nothing (Jouni, 2026-09-28), and the list restricts nobody until
   * an owner chooses it as their model policy (`ai.policy.models` mode `recommended`).
   */
  aiRecommendedModels: string;
  /**
   * More AI providers of the operator's, as a JSON array of provider records (services/ai/
   * providers.ts, System 2 plan V3). `auth` is `none` or the NAME of an environment variable, never a
   * key, the rule System 1's AIMEAT_DECIDE_PROVIDERS has.
   */
  aiProviders: string;
  /** Built-in local examples the operator switches on, comma separated: lmstudio, ollama, llamacpp. */
  aiBuiltinProviders: string;
  /**
   * Exact origins (scheme, host, port) of the operator's own local AI servers. Only the operator's
   * providers at a listed origin may reach it although it is private; an owner's provider never
   * uses the list.
   */
  aiProviderEgress: string;
  /**
   * Which fixed provider types (openrouter, openai, anthropic, mistral, xai) this node allows, comma
   * separated. Empty allows all five at their official addresses, whatever the host allowlist says
   * (Jouni, 2026-09-28): the address of a fixed type cannot be changed, so a key cannot leak through
   * it. Set, only the listed types are allowed.
   */
  aiProviderTypes: string;
  /**
   * JSON `{ "<fixed type>": "<address>" }` that points a fixed type somewhere else, for a test stub or
   * a development proxy. Refused on a public node (the posture check says so), because the fixed
   * address is the reason a key sent to a fixed type cannot leak.
   */
  aiFixedBaseUrlOverrides: string;
  /**
   * DEPRECATED ROUTES, NAMED WITH THEIR FLAG, DEFAULT AND REMOVAL (security-development-dna.md,
   * "Deprecated is not removed"): the AI settings routes from before providers (/v1/openrouter/
   * settings, /models, /test, /v1/ai/settings). True (the default) keeps them answering; false makes
   * them 410 Gone naming /v1/ai/providers. They are removed in 4.0.0.
   */
  aiLegacySettingsRoutes: boolean;
  /**
   * How often the node refreshes its model catalogue from the public sources (services/ai/catalog/,
   * System 2 plan V4): weekly (the default), daily, or off. Off keeps the seed the build shipped with.
   */
  aiCatalogRefresh: 'weekly' | 'daily' | 'off';
  /**
   * The operator's price corrections, as JSON `{ "<type>:<model id>": { "inPerMtok": 3, ... } }`. They
   * win over every source, so a wrong catalogue price is fixed without waiting for the source.
   */
  aiPriceOverrides: string;
  /** Other addresses for the catalogue sources, as JSON `{ "modelsDev"?, "openRouter"?, "liteLlm"? }`. For a test stub or a mirror. */
  aiCatalogSources: string;
  /** How many on-demand app screenshots one owner may ask for per hour. Rendering is the most
   *  expensive thing this node does per request, and an unthrottled render is a denial-of-service
   *  shape, which is why the batch job never had a request path at all until this existed. */
  screenshotOnDemandPerHour: number;

  // ── AI jobs (a model call with a handle, running in the background) ──
  /**
   * How many AI jobs may be calling a provider at once, node-wide. This protects the PROCESS
   * against a pathological case and nothing else: a running job holds one HTTPS socket and its
   * prompt, no sandbox and no CPU.
   *
   * There is deliberately no per-owner or per-app concurrency cap beside it. Every owner spends
   * their own key, so one owner's fifty jobs cost no other owner anything; a per-owner cap would
   * punish someone with thirty apps for having thirty apps, and a per-app cap would punish an app
   * for fanning out ten perspectives on one question, which is the point of the feature. The right
   * currency for "this app is using too much" is money, and that control already exists
   * (`app_quotas.<app>.daily_usd` and the daily budget in services/ai/completion.ts).
   */
  aiJobSlots: number;
  /**
   * The node-wide wait line. `AI_JOB_QUEUE_FULL` (503 + Retry-After) fires here, which is the one
   * refusal of the four that means "come back shortly" rather than "something is wrong".
   *
   * It exists because the per-owner brake below cannot bound a node: owners × 200 is unbounded, and
   * a queued job still holds its assembled prompt. Sized above the per-owner brake on purpose, so
   * one owner looping trips their own cap first and everyone else keeps being served.
   */
  aiJobMaxQueued: number;
  /**
   * The biggest assembled prompt (the prompt text plus every `input_keys` record read into it) one
   * job may carry. THIS is the number that multiplies with concurrency: one memory value may be
   * 1024 kB, so an unbounded assembly is megabytes of live heap held for the whole call.
   */
  aiJobMaxPromptBytes: number;
  /**
   * How many jobs one owner may have QUEUED. Not a fairness knob — fairness is the round-robin
   * ordering in services/slot-pool.ts — but an abuse brake that sits high and is only expected to
   * fire when something is looping. The message says so.
   */
  aiJobMaxQueuedPerOwner: number;
  /** How deep an on_done chain may go before it is stopped. A chain that called itself this many
   *  times is looping, and the parent records why it stopped rather than reporting success. */
  aiJobMaxChain: number;
  /** How many days of `ai.jobs.log.<YYYY-MM-DD>` to keep. The key ceiling is 1000 per principal by
   *  default, so a finished job folds into a per-day record and the per-day records are pruned. */
  aiJobLogRetentionDays: number;
}
