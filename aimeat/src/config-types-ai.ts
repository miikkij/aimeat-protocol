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
 *   v1.0.0 — 2026-08-16 — Extracted from config-types.ts (pure extraction; no behaviour change).
 */

export interface AiCapabilityConfig {
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
  /** ISO-639-1 hint for speech-to-text when the owner has set none. Empty = let the model detect. */
  sttLanguageDefault: string;
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
   * (`app_quotas.<app>.daily_usd` and the daily budget in services/ai-completion.ts).
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
