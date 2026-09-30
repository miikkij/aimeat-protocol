/**
 * @file src/storage/types/content-labels.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The stored form of a classification label (TARGET-082). A label is not inside the
 *   content it describes: it is its own row that points at the content, the way an AI provenance
 *   record does, so no workspace schema and no memory value changes, and a read can look the label
 *   up before it loads the value.
 *
 *   A row is addressed by (kind, scope, key):
 *     memory — scope is the owner identity of a personal key, or `organism:<id>` for an organism
 *              workspace key (whoever wrote the record, the label belongs to the organism's key);
 *     file   — scope is the owner identity, key is the storage key;
 *     row    — scope is `organism:<id>`, key is `<ws>/<space>/<rowId>`.
 *   `ownerGaii` names the person whose content it is, for erasure; it is null on organism content,
 *   which goes with the organism.
 * @structure ContentLabelKind · ContentLabelSource · ContentLabelSuggestion · ContentLabelEvent ·
 *   ContentLabelRow · ContentLabelTarget · ContentLabelListQuery
 * @usage import type { ContentLabelRow } from '../storage/interface.js';
 * @version-history
 *   v1.1.0 — 2026-09-30 — A suggestion carries the person's words an AI relayed (humanSaid) and the
 *     justification that came with them, for the PERSON_APPROVES suggestion (TARGET-082).
 *   v1.0.0 — 2026-09-29 — TARGET-082 V1. Initial.
 */

/** What a label points at. */
export type ContentLabelKind = 'memory' | 'file' | 'row';

/**
 * Who set the label. `human` is a person on their own screen; `human-via-ai` is an AI relaying a
 * person's own words (kept in `humanSaid`); `ai` and `rule` never lower a label and never change a
 * locked one; `default` is what a read reports for a target with no row, and what a stored row says
 * when it only carries a suggestion on top of the default label.
 */
export type ContentLabelSource = 'human' | 'human-via-ai' | 'ai' | 'rule' | 'default';

/** A change an AI or a rule proposed and could not make, waiting for a person. */
export interface ContentLabelSuggestion {
  label: string;
  by: string;
  at: string;
  source: 'ai' | 'rule';
  confidence?: number;
  reason?: string;
  /**
   * Why it did not apply: the label is a person's (HUMAN_LABEL), it would lower (CANNOT_LOWER), the
   * policy lets an AI only suggest (AI_SUGGESTS, BELOW_THRESHOLD), or an AI relayed a person's words
   * that lower the label or change one a person set, which the person accepts in their own session
   * (PERSON_APPROVES).
   */
  why: string;
  /** With PERSON_APPROVES: the person's own words the AI relayed, verbatim. */
  humanSaid?: string;
  /** With PERSON_APPROVES: the justification the AI relayed with them, used when the person accepts. */
  justification?: string;
}

/** One entry of a label's history, newest last, at most 50 kept. */
export interface ContentLabelEvent {
  at: string;
  by: string;
  source: ContentLabelSource;
  action: 'set' | 'suggest' | 'accept' | 'reject';
  from: string | null;
  to: string | null;
  justification?: string | null;
  humanSaid?: string | null;
  confidence?: number;
  reason?: string;
}

/** The address of one labelled thing. */
export interface ContentLabelTarget {
  kind: ContentLabelKind;
  scope: string;
  key: string;
}

/** One stored label. */
export interface ContentLabelRow extends ContentLabelTarget {
  id: string;
  ownerGaii: string | null;
  label: string;
  source: ContentLabelSource;
  locked: boolean;
  suggestion: ContentLabelSuggestion | null;
  justification: string | null;
  humanSaid: string | null;
  history: ContentLabelEvent[];
  setBy: string;
  updatedAt: string;
}

/** A page of one scope's labels, in key order. `after` is a key cursor (exclusive). */
export interface ContentLabelListQuery {
  scope: string;
  kind?: ContentLabelKind;
  after?: string;
  limit?: number;
}
