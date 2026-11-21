/**
 * @file src/services/content/risk-types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shapes of the content risk marks (wish
 *   wish-sis-ll-n-riskimerkinn-t-merkit-n-metadatalla-alkuper-ist-ei-, plan
 *   docs/internal/content-risk-plan.md). The `risk` stage reads an item's words and writes marks BESIDE
 *   the item: the item itself is never changed, never deleted and never rewritten. A mark says where
 *   in the words a possible risk is (a text that tries to instruct an AI, hidden text, a false role,
 *   a link that asks for data, a request for another person's data, a long encoded block), and the
 *   marks are bound to the content hash they were read from, so a changed item reads as unmarked
 *   until it is read again.
 *
 *   PUBLIC CONTRACT. `ContentRisk` is what a reader receives beside the content (openapi.yaml
 *   components.schemas.ContentRisk, and every MCP read result that carries `content_risk`). An outside
 *   service relies on it: a marked item (`marked: true`, `use: 'prepare-only'`) may only produce a
 *   preparation for a person, never an act of its own. A field is added to it, never renamed or
 *   removed.
 *
 *   SETTINGS. `RiskSettings` is one layer's choice (the node's default, an organism, a workspace, a
 *   person); risk-settings.ts lays them over each other: the content's home decides its rules, an
 *   upper layer's floor (the operator's limits, a locked organism or workspace) holds, and a lower
 *   layer may tighten it (docs/internal/situated-ai/08, section 5).
 * @structure RiskKind · RISK_KINDS · RiskBehaviour · BEHAVIOURS · READ_BEHAVIOURS · behaviourRank ·
 *   RiskDetect · RiskPoint · RiskMark · RiskHold · RiskMarks · ContentRisk · RiskSettings · RiskLayer ·
 *   ResolvedRisk
 * @usage import type { RiskMarks, ContentRisk } from './risk-types.js';
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */

/** The six kinds of mark, each switched on or off on its own. */
export type RiskKind = 'ai-instruction' | 'hidden-text' | 'false-role' | 'exfil-link' | 'other-person-data' | 'encoded-block';
export const RISK_KINDS: readonly RiskKind[] = ['ai-instruction', 'hidden-text', 'false-role', 'exfil-link', 'other-person-data', 'encoded-block'];

/**
 * What a point does: nothing, a mark beside the content, a mark and one warning line for the reading
 * AI (and the mark shown to the owner), or a hold: outside content that is marked waits for the owner
 * or the workspace admin before other people's AIs get it. Nothing is changed or deleted by any of them.
 */
export type RiskBehaviour = 'off' | 'mark' | 'mark+warn' | 'hold';
export const BEHAVIOURS: readonly RiskBehaviour[] = ['off', 'mark', 'mark+warn', 'hold'];
/** A read has no hold: the hold is decided when the content arrives. */
export const READ_BEHAVIOURS: readonly RiskBehaviour[] = ['off', 'mark', 'mark+warn'];
/** Stricter is higher. */
export const behaviourRank = (b: RiskBehaviour): number => BEHAVIOURS.indexOf(b);

/** Rules alone (no model, no cost), or rules and a model (spends the AI allowance of whoever chose it). */
export type RiskDetect = 'rules' | 'rules+ai';

/** Where an item was marked. `request` is a person or their AI asking with aimeat_content_inspect. */
export type RiskPoint = 'intake' | 'shared-write' | 'read' | 'request';

/** One possible risk in an item's words. Offsets are UTF-16 code units in the text that was read. */
export interface RiskMark {
  kind: RiskKind;
  /** The rule that matched (`ai-instruction.ignore-previous`), or `model` for a model's mark. */
  rule: string;
  by: 'rules' | 'model';
  start: number;
  end: number;
  /** At most 160 characters around the match, with invisible characters written as \u{...}. */
  excerpt: string;
  /** A model's reason, in one sentence. */
  why?: string;
}

/** A hold: the item waits for the owner or the workspace admin before other people's AIs get it. */
export interface RiskHold {
  status: 'held' | 'released';
  since: string;
  /** Who may release it: 'owner' (the content's owner) or 'workspace' (the workspace's creator or an organism admin). */
  decidedBy?: string;
  decidedAt?: string;
}

/** The marks kept about one item, beside its other facts. */
export interface RiskMarks {
  v: 1;
  /** The hash of the words the marks were read from, "sha256:<hex>". Another hash: the marks are stale. */
  contentHash: string;
  detect: RiskDetect;
  point: RiskPoint;
  at: string;
  marks: RiskMark[];
  /** The kinds that were looked for. */
  kinds: RiskKind[];
  /** Set when only the first part of a long text was read. */
  truncatedAt?: number;
  /** The model that added marks, when detect was rules+ai and it answered. */
  model?: string;
  /** Why the model's part did not run, when it was asked for and did not. */
  modelSkipped?: string;
  hold?: RiskHold;
  /** Who wrote the content, when it was marked at a shared write. */
  writtenBy?: string;
  /** When the content itself expires (a board post): the entry goes at the record's next write after it. */
  expiresAt?: string;
}

/**
 * What a reader receives beside the content: the public contract (openapi.yaml ContentRisk).
 * `use` is 'prepare-only' whenever the item is marked: such an item may only produce a preparation
 * for a person, never an act of its own.
 */
export interface ContentRisk {
  v: 1;
  marked: boolean;
  use: 'prepare-only' | 'normal';
  kinds: RiskKind[];
  marks: RiskMark[];
  content_hash: string;
  detect: RiskDetect;
  /** When the marks were read; for a read with no stored marks, now. */
  checked_at: string;
  /** Where the marks were made: at intake, at a shared write, on this read, or on request. */
  point: RiskPoint;
  /** One line for the reading AI, present when the reader's setting is mark+warn and the item is marked. */
  warning?: string;
  /** Present when the item is held: its content is not in this answer. */
  held?: { since: string; release_with: string };
}

/** One layer's choice. Every field is optional: a missing field follows the layer above. */
export interface RiskSettings {
  enabled?: boolean;
  detect?: RiskDetect;
  on_intake?: RiskBehaviour;
  on_shared_write?: RiskBehaviour;
  on_read?: RiskBehaviour;
  kinds?: Partial<Record<RiskKind, boolean>>;
  /**
   * An organism or a workspace: its values are a floor for the layers under it (a workspace, a
   * person's own AIs), which may then only tighten them.
   */
  locked?: boolean;
}

/** A stored layer: its choice, who made it and when, and who pays for rules+ai at this layer. */
export interface RiskLayer extends RiskSettings {
  by?: string;
  at?: string;
  /** Who last set `detect` at this layer: the one who pays when it is rules+ai. */
  detectBy?: string;
}

/** What is in force for one item at one point, and where each part comes from. */
export interface ResolvedRisk {
  enabled: boolean;
  detect: RiskDetect;
  on_intake: RiskBehaviour;
  on_shared_write: RiskBehaviour;
  on_read: RiskBehaviour;
  kinds: RiskKind[];
  /** Whose AI allowance pays for the model's part: the person who chose rules+ai at the layer it came from. */
  aiPayer: string | null;
  /** Per field, the layer the value came from. */
  from: Record<'enabled' | 'detect' | 'on_intake' | 'on_shared_write' | 'on_read' | 'kinds', 'node' | 'floor' | 'organism' | 'workspace' | 'person'>;
}
