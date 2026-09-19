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
 * @usage
 *   import type { AiDecisionRow } from '../storage/interface.js';
 * @version-history
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
  /** Who reviewed it (a GHII or GAII). */
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
  provider: 'typesafe';
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
  keyScope: 'own' | 'node';
  /** Id of the decision this answer was served from, when served from the cache. */
  cachedFrom?: string;
  review?: AiDecisionReview;
}

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
  record: AiDecisionRecord;
}

/** The owner's list filter. Newest first; `before` is a createdAt cursor (exclusive). */
export interface AiDecisionListQuery {
  ownerGhii: string;
  subject?: string;
  appId?: string;
  /** Default 50, max 200. */
  limit?: number;
  before?: string;
}
