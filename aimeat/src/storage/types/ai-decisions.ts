/**
 * @file src/storage/types/ai-decisions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The stored form of an AI decision (TARGET-080, AIMEAT.decide). A sibling of the AI
 *   provenance register: provenance says what AI MADE, a decision row says what AI DECIDED. One row
 *   per call to the decision model, not one per question, because the questions of one call were
 *   answered together against one state and are only meaningful together.
 *
 *   The canonical DOCUMENT is `record` (an `aimeat.decision/v1`). The columns beside it are AIMEAT's
 *   own authorization and lookup metadata: `ownerGhii` decides who may read the row, `cacheKey`
 *   finds an earlier identical call, `subject` lists the decisions about one thing.
 *
 *   The personal data rule: `questions` and `stateHash` describe what was SENT, which is the scrubbed
 *   form. The real state is not stored; `scrubbedState` is stored only when the owner asked for it.
 *   `answers` carry real option names again, because the scrubber's mapping was applied on the way
 *   back, and that is what a reviewer needs to read.
 *
 *   Unlike provenance, a decision row AGES OUT: deleteAiDecisionsBefore() is the lifecycle, and the
 *   only field that may change after the write is `record.review` (a person confirmed or overrode it).
 * @structure
 *   - AiDecisionQuestionType — the three Jev question types
 *   - AiDecisionAnswer / AiDecisionQuestion / AiDecisionReview — parts of the document
 *   - AiDecisionRecord — the aimeat.decision/v1 document
 *   - AiDecisionRow — one stored row
 *   - AiDecisionListQuery — the owner's list filter
 *   - AiDecisionStatsQuery / AiDecisionStats / AiDecisionStatsGroup — the quality counts
 * @usage
 *   import type { AiDecisionRow } from '../storage/interface.js';
 * @version-history
 *   v1.2.1 — 2026-09-25 — A review's `by` names an app by its GEAI, and is never the principal that
 *     asked for the decision unless that is the owner in person. No field changed.
 *   v1.2.0 — 2026-09-23 — Decision providers: a row carries `provider` and `providerKind`, a key
 *     scope may be 'none', and the list filters and the quality numbers group by provider.
 *   v1.1.0 — 2026-09-20 — Decision rules: a row carries `rule`, `ruleVersion`, `outcome` and
 *     `keyScope` (which now also says 'agent'), the list filters by rule and by principal, and the
 *     quality numbers are counted in the store.
 *   v1.0.0 — 2026-09-19 — TARGET-080. Initial.
 */

/** The three question types the decision model answers. */
export type AiDecisionQuestionType = 'noul' | 'choice' | 'score';

/** One answer, restored to real option names. `value` is the noul (0..1), the choice or the score. */
export interface AiDecisionAnswer {
  type: AiDecisionQuestionType;
  value: number | string;
  probabilities?: Record<string, number>;
  confidence?: number;
  legend?: Record<string, unknown>;
}

/** One question as SENT to the model (scrubbed). */
export interface AiDecisionQuestion {
  type: AiDecisionQuestionType;
  instructions: unknown;
  criteria?: unknown;
}

/** A person's verdict on a decision after the fact. */
export interface AiDecisionReview {
  outcome: 'confirmed' | 'overridden';
  /** Who reviewed it: the owner's GHII in person, an agent's GAII, or an app's GEAI. Never the
   *  principal that asked for the decision, unless that is the owner in person. */
  by: string;
  /** ISO timestamp. */
  at: string;
  note?: string;
  /** The value the reviewer put in place of the model's answer, when overridden. */
  override?: unknown;
}

/** The aimeat.decision/v1 document. */
export interface AiDecisionRecord {
  spec: 'aimeat.decision/v1';
  /** The pinned, versioned model id that ANSWERED (from the response, not the request). */
  model: string;
  /** The decision provider's id (services/decide/providers.ts). Every record before 2026-09-23 says 'typesafe'. */
  provider: string;
  /** Where it ran. Absent on records written before providers existed, which were all hosted. */
  providerKind?: AiDecisionProviderKind;
  /** As SENT (scrubbed). */
  questions: Record<string, AiDecisionQuestion>;
  /** Restored to real option names. */
  answers: Record<string, AiDecisionAnswer>;
  /** Thresholds in force at decision time, as the caller stated them. */
  thresholds: Record<string, unknown> | null;
  /** What the decision gated, in the caller's words. */
  gates: string | null;
  /** What it was about (a memory key, a record id). */
  subject: string | null;
  /** `sha256:<hex>` of the SCRUBBED state as sent. */
  stateHash: string;
  /** Only when the owner asked to store it. */
  scrubbedState?: unknown;
  scrub: { removed: Record<string, number>; total: number };
  usage: { inputTokens: number; costUsd: number };
  requestId: string | null;
  keyScope: AiDecisionKeyScope;
  /** Id of the decision this answer was served from, when served from the cache. */
  cachedFrom?: string;
  review?: AiDecisionReview;
  /** The bands of the decision rule that ran, as they stood at decision time. */
  bands?: { act: number; ask: number };
  /**
   * Set when a rule ran for an agent whose gate is switched on. `stopped` is true when the outcome
   * was under the act band, so the action became a task for the owner; `task` is that task's id.
   */
  gate?: { on: true; stopped: boolean; task?: string };
}

/** Whose key paid: the agent's own, the owner's own, the node's, or none (a provider that takes no key). */
export type AiDecisionKeyScope = 'agent' | 'own' | 'node' | 'none';

/** Where the provider runs: elsewhere, or on this machine. */
export type AiDecisionProviderKind = 'hosted' | 'local';

/** What a decision rule's bands made of the answers: act, ask a person, or stop. */
export type AiDecisionOutcome = 'act' | 'ask' | 'stop';

/** One stored decision row. */
export interface AiDecisionRow {
  id: string;
  ownerGhii: string;
  /** Who made the call (GHII, GAII or GEAI). */
  principal: string;
  appId: string | null;
  subject: string | null;
  cacheKey: string;
  model: string;
  /** ISO timestamp; the list cursor and the lifecycle cut both read it. */
  createdAt: string;
  /** The decision rule that ran (`decide.rules.<id>`), or null for a call that named none. */
  rule: string | null;
  /** The rule's version at decision time: it is bumped on every question change. */
  ruleVersion: number | null;
  /** What the rule's bands made of the answers. Null without a rule. */
  outcome: AiDecisionOutcome | null;
  /** Whose key paid. A column as well as a record field, so the quality view can count by it. */
  keyScope: AiDecisionKeyScope;
  /** Which provider answered. A column, so the quality numbers group by it; 'typesafe' for older rows. */
  provider: string;
  /** Where that provider ran. 'hosted' for older rows. */
  providerKind: AiDecisionProviderKind;
  record: AiDecisionRecord;
}

/** The owner's list filter. Newest first; `before` is a createdAt cursor (exclusive). */
export interface AiDecisionListQuery {
  ownerGhii: string;
  subject?: string;
  appId?: string;
  /** Only decisions one rule made. */
  rule?: string;
  /** Only decisions one principal asked for (a GAII, for the agent's own page). */
  principal?: string;
  /** Only decisions one provider answered. */
  provider?: string;
  /** Default 50, max 200. */
  limit?: number;
  before?: string;
}

/** Which decisions a quality count covers: one rule, one principal, one provider, or any mix. */
export interface AiDecisionStatsQuery {
  ownerGhii: string;
  rule?: string;
  principal?: string;
  provider?: string;
}

/** What a quality count is grouped by. */
export type AiDecisionStatsGroupBy = 'rule' | 'principal' | 'provider';

/**
 * The quality numbers for a rule or an agent, counted in the store so they are exact however many
 * decisions there are. Cache hits are counted as decisions and cost nothing.
 */
export interface AiDecisionStats {
  decisions: number;
  outcomes: { act: number; ask: number; stop: number };
  /** Decisions where a switched-on gate turned the action into a task for the owner. */
  gateStops: number;
  /** Decisions a person reviewed and overrode. */
  overridden: number;
  confirmed: number;
  costUsd: number;
  /** createdAt of the newest decision, or null when there is none. */
  lastAt: string | null;
}

/** One row of a grouped quality count: the numbers for one rule (or one principal). */
export interface AiDecisionStatsGroup extends AiDecisionStats {
  key: string;
}
