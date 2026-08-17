/**
 * @file src/storage/types/account-events.ts
 * @description Record types for the per-owner "what has happened" window and its archive.
 *
 *   `kind` IS A KEY, NOT A SENTENCE. Every row is translated by the UI at render time, which is the
 *   contract services/home-feed.ts already keeps for its derived onboarding rows. A server that
 *   wrote English into the store would decide which language every reader gets, forever, and would
 *   make a translation a data migration.
 * @structure
 *   - AccountEventKind  -- the vocabulary, one entry per thing worth telling someone about
 *   - AccountEventRecord / AccountEventInput
 *   - AccountEventFilter / AccountEventTrimResult
 * @usage
 *   import type { AccountEventInput } from '../storage/interface.js';
 * @version-history
 *   v1.1.0 — 2026-08-17 — eight kinds the code already emits (consent grant/revoke, AI settings and key
 *     changes, workflow lifecycle): the union lost them in a merge and main failed typecheck.
 *   v1.0.0 — 2026-08-17 — Initial: account events as their own system, not as memory records.
 */

/**
 * What can happen. Adding a kind is a locale key in three files plus a call site; nothing else.
 *
 * Deliberately NOT one entry per mutation — the node performs hundreds, and a feed that reports all
 * of them reports nothing. These are the ones a person would want to be told about without asking.
 */
export type AccountEventKind =
  // Agents
  | 'agent_connected'
  | 'agent_removed'
  | 'agent_task_done'
  | 'agent_task_failed'
  // What they built
  | 'app_published'
  | 'app_updated'
  | 'workspace_record_published'
  // Who they are with
  | 'organism_joined'
  | 'organism_left'
  | 'organism_member_joined'
  // Money
  | 'payment_received'
  | 'payment_sent'
  | 'contract_started'
  | 'contract_ended'
  // Workflows
  | 'workflow_created'
  | 'workflow_updated'
  | 'workflow_deleted'
  | 'workflow_run_started'
  | 'workflow_run_finished'
  | 'workflow_run_failed'
  // Apps doing work
  //
  // `app_tool_first_use` and `app_tool_paid` rather than one row per call, deliberately. An app
  // tool can be invoked hundreds of times an hour; a row each would fill the window in minutes and
  // push everything else out, and the per-call record already exists in UsageCall. The FIRST time an
  // app uses a tool is news, and a call that COST something is always news. The nine-hundredth free
  // call is not.
  | 'app_tool_first_use'
  | 'app_tool_paid'
  // Money
  | 'checkout_completed'
  | 'checkout_cancelled'
  // AI
  //
  // `ai_spend_daily` is a digest for the same reason: one row per completion would be the loudest
  // thing on the account and the least interesting. What a person wants told is what a day cost.
  | 'ai_spend_daily'
  | 'ai_key_changed'
  | 'ai_settings_changed'
  // Permissions and limits
  | 'consent_granted'
  | 'consent_revoked'
  | 'app_granted'
  | 'app_revoked'
  | 'ai_budget_reached'
  // AI settings
  | 'ai_settings_changed'
  | 'ai_key_changed'
  // Workflows
  | 'workflow_created'
  | 'workflow_updated'
  | 'workflow_deleted'
  | 'workflow_run_started';

/** One thing that happened, as stored. */
export interface AccountEventRecord {
  id: string;
  /** Whose account. Always a GHII — an agent's events are its owner's events. */
  ownerGhii: string;
  /** ISO 8601 UTC. */
  at: string;
  kind: AccountEventKind;
  /** The exact principal that caused it (GHII / GAII / GEAI). '' when the node itself did. */
  actorGaii: string;
  /** Values the translated line interpolates: an agent's name, an app's title, an amount. */
  data: Record<string, string>;
  /** Where the row goes when clicked. '' when it points at nothing. */
  link: string;
  /** What this is about, so a later feature can group by subject without parsing `data`. */
  subject: string;
}

/** What a caller supplies. Everything optional defaults at the recorder. */
export interface AccountEventInput {
  ownerGhii: string;
  kind: AccountEventKind;
  actorGaii?: string;
  data?: Record<string, string>;
  link?: string;
  subject?: string;
  /** Override the timestamp (tests and backfills only). */
  at?: string;
}

/** Reading the window, or the archive behind it. */
export interface AccountEventFilter {
  ownerGhii: string;
  kind?: AccountEventKind;
  /** Inclusive ISO bounds. */
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/** What one trim moved out of the window. */
export interface AccountEventTrimResult {
  archived: number;
}
