/**
 * @file src/services/classification-exits.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a caller of the classification reader puts in its answer about what the reader
 *   decided (TARGET-082, review of V2 to V5). The reader (services/classification/reader.ts) decides;
 *   these helpers only name the result, so every exit names it the same way:
 *   - leaveMemories: reader.leave for memory records, with what stayed behind as
 *     `{ key, label, reason }`, for an answer to a caller who may see the keys (an export, a bundle).
 *   - leaveMemoriesToPeer: the same for federation, where the peer must not learn the keys: the
 *     answer carries a count and one reason, the keys go to this node's log only.
 *   - warningField / warningFieldSnake: the `classificationWarning` reader.show put on a record, as a
 *     field an answer spreads in (REST camelCase, MCP snake_case).
 *   - carryLabelToCopy: a copy of classified content keeps its source's label (never lower).
 * @structure LeftOut · Withheld · leftOutOf() · leaveMemories() · leaveMemoriesToPeer() ·
 *   warningField() · warningFieldSnake() · carryLabelToCopy()
 * @usage
 *   const { kept, leftOut } = await leaveMemories(reader, records, { kind: 'export', organismId: null });
 *   res.json(success(nodeId, { entries: kept, ...(leftOut.length ? { left_out: leftOut } : {}) }));
 * @version-history
 *   v1.0.0 — 2026-09-29 — TARGET-082 review: the multi-item exits say what stayed behind.
 */
import type { Storage, ContentLabelTarget } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { memoryTarget, labelsFor, setLabel, targetId, type LabelActor } from './classification/labels.js';
import { systemReader, type ContentReader, type EgressDestination } from './classification/reader.js';
import { classificationActiveFor, policyFor } from './classification/policy.js';
import { labelById } from './classification/defaults.js';
import { classificationWarningOf } from './classification/present-memory.js';
import { logger } from '../utils/logger.js';

type Deps = { storage: Storage; config: Pick<AimeatConfig, 'classificationMode' | 'nodeId'> };

/** One item that stayed behind: its key, its label id, and why. */
export interface LeftOut { key: string; label: string; reason: string }

/** What a peer is told about what stayed behind: how many, and why, never which. */
export interface Withheld { count: number; reason: string }

/** The reason a peer is told. The labels and keys stay on this node. */
export const WITHHELD_REASON = 'classified content that may not leave its organism';

/** The `left` of a reader.leave call, named by key. */
export function leftOutOf<T>(left: ReadonlyArray<{ item: T; label: string; reason: string }>, keyOf: (item: T) => string): LeftOut[] {
  return left.map(l => ({ key: keyOf(l.item), label: l.label, reason: l.reason }));
}

/** reader.leave for memory records, with what stayed behind named by key. Order is kept. */
export async function leaveMemories<T extends { ownerGaii: string; key: string }>(
  reader: ContentReader, records: readonly T[], where: EgressDestination,
): Promise<{ kept: T[]; leftOut: LeftOut[] }> {
  const { kept, left } = await reader.leave(records, r => memoryTarget(r.ownerGaii, r.key), where);
  return { kept, leftOut: leftOutOf(left, r => r.key) };
}

/**
 * Memory leaving this node for `peer`. The node's own reader decides (federation has no caller of
 * this node behind it). The peer is told a count and one reason; the keys are logged here, so a
 * record missing on the peer has a reason on this node.
 */
export async function leaveMemoriesToPeer<T extends { ownerGaii: string; key: string }>(
  deps: Deps, records: readonly T[], peer: string, what: string,
): Promise<{ kept: T[]; withheld: Withheld | null }> {
  const reader = systemReader(deps, `system@${deps.config.nodeId}`);
  const { kept, leftOut } = await leaveMemories(reader, records, { kind: 'federation', peer });
  if (!leftOut.length) return { kept, withheld: null };
  logger.info(`${what}: classified memory stayed on this node`, {
    peer, count: leftOut.length, keys: leftOut.slice(0, 20).map(l => l.key), labels: [...new Set(leftOut.map(l => l.label))],
  });
  return { kept, withheld: { count: leftOut.length, reason: WITHHELD_REASON } };
}

type Warning = { label: string; name: string; says: string };

/** `{ classificationWarning }` when reader.show put one on the record, else nothing. */
export function warningField(record: object): { classificationWarning?: Warning } {
  const w = classificationWarningOf(record);
  return w ? { classificationWarning: w } : {};
}

/** The same field, in the snake_case an MCP answer uses. */
export function warningFieldSnake(record: object): { classification_warning?: Warning } {
  const w = classificationWarningOf(record);
  return w ? { classification_warning: w } : {};
}

/**
 * A copy of classified content keeps its source's label (decided in the review of 2026-09-29): the
 * copy is labelled with the source's label by the node's rule, when classification is on for both
 * the source and the copy, and only when that is a raise. A person's own label on the copy is
 * never lowered; a lower source label changes nothing.
 *
 * Refuses (throws) when the source's label is not an active label of the copy's policy, because the
 * copy would otherwise read as less sensitive than its source.
 */
export async function carryLabelToCopy(deps: Deps, from: ContentLabelTarget, to: ContentLabelTarget): Promise<{ carried: string | null }> {
  if (deps.config.classificationMode === 'off' || targetId(from) === targetId(to)) return { carried: null };
  if (!(await classificationActiveFor(deps.storage, deps.config, from.scope))) return { carried: null };
  if (!(await classificationActiveFor(deps.storage, deps.config, to.scope))) return { carried: null };
  const fromPolicy = await policyFor(deps.storage, deps.config, from.scope);
  const sourceId = (await labelsFor(deps.storage, fromPolicy, [from])).get(targetId(from))?.label ?? fromPolicy.defaultLabel;
  const toPolicy = await policyFor(deps.storage, deps.config, to.scope);
  const source = labelById(toPolicy, sourceId);
  if (!source || source.status !== 'active') {
    throw new CopyLabelError(`The source is classified "${sourceId}", which is not an active label where the copy would go, so it is not copied.`);
  }
  const currentId = (await labelsFor(deps.storage, toPolicy, [to])).get(targetId(to))?.label ?? toPolicy.defaultLabel;
  const current = labelById(toPolicy, currentId);
  if (current && source.rank <= current.rank) return { carried: null };
  const rule: LabelActor = { principal: `system@${deps.config.nodeId}`, ownerGhii: `system@${deps.config.nodeId}`, ownerName: null, kind: 'rule' };
  const r = await setLabel(deps, rule, to, { label: source.id, reason: `copied from ${from.key}, classified ${source.name.en}` });
  return { carried: r.applied ? source.id : null };
}

/** The copy cannot carry its source's label. */
export class CopyLabelError extends Error {
  readonly code = 'CLASSIFIED';
  constructor(message: string) {
    super(message);
    this.name = 'CopyLabelError';
  }
}
