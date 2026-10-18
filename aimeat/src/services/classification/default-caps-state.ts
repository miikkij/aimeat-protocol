/**
 * @file src/services/classification/default-caps-state.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether this node takes the default audience caps of decision 10.1 (plan
 *   doc-mvdipuyqraas, L5.1): the record that says so, and the default labels with the caps put on
 *   them. policy.ts reads it when the node has no stored policy of its own; default-caps.ts writes it.
 *
 *   ONE RECORD, `classification.default-caps` of `system@<node>`, written once at the first start of
 *   a build that knows the caps (default-caps.ts settleDefaultCapsAtStart):
 *     node 'new'      the start found no stored node policy and no account: the node is new, and the
 *                     default labels carry their caps from the first request on.
 *     node 'running'  the start found a stored node policy or an account: the node ran before, and
 *                     nothing it does changes until the operator approves a cap on the Security page.
 *                     `pending` says the offer still waits for classification to be switched on.
 *   A node with no record (a start that could not write it, or code that reads a policy without a
 *   started node) takes no cap: without evidence the node is new, it keeps the behaviour it had.
 *
 *   A STORED POLICY WINS. Once the node stores a policy (the operator saves it, or approves a cap),
 *   the caps are the stored labels' own `maxAudience`, and this record is not read for them.
 * @structure DEFAULT_CAPS_KEY · DefaultCapsState · readDefaultCapsState() · labelsWithDefaultCaps()
 * @usage
 *   const state = await readDefaultCapsState(storage, nodeId);
 *   const labels = state?.node === 'new' ? labelsWithDefaultCaps(policy.labels) : policy.labels;
 * @version-history
 *   v1.1.0 — 2026-10-18 — `pending`: the offer of a node that ran before waits while classification is off.
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvdipuyqraas, L5.1).
 */
import type { Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { DEFAULT_LABEL_CAPS, type ClassificationLabel } from './defaults.js';

/** The record of system@<node> that says whether this node takes the default caps. */
export const DEFAULT_CAPS_KEY = 'classification.default-caps';

export interface DefaultCapsState {
  node: 'new' | 'running';
  /** When the start decided it. */
  at: string;
  /** What the start found, in words: the evidence for `node`. */
  evidence: string;
  /**
   * 'running' only: true while the offer waits for classification to be switched on (it was off when
   * the node was found to have run before); false or absent once the offer was made.
   */
  pending?: boolean;
  /** The labels whose default cap was offered to the operator ('running' only). */
  offered: string[];
  /** The Security page incident that carries the offer, or null when nothing was offered. */
  incident: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The record, or null when the node has none. Never throws. */
export async function readDefaultCapsState(storage: Storage, nodeId: string): Promise<DefaultCapsState | null> {
  try {
    const v = (await storage.getMemory(`system@${nodeId}`, DEFAULT_CAPS_KEY))?.value;
    if (!isObj(v) || (v.node !== 'new' && v.node !== 'running')) return null;
    return v as unknown as DefaultCapsState;
  } catch (err) {
    logger.warn('classification: the default caps record could not be read; no default cap applies', { nodeId, error: String(err) });
    return null;
  }
}

/** The labels with each default label's cap of decision 10.1 put on it; other labels as they are. */
export function labelsWithDefaultCaps(labels: ClassificationLabel[]): ClassificationLabel[] {
  return labels.map(l => (l.id in DEFAULT_LABEL_CAPS ? { ...l, maxAudience: DEFAULT_LABEL_CAPS[l.id] ?? null } : l));
}
