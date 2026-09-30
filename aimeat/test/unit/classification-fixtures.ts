/**
 * @file test/unit/classification-fixtures.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared set-up for the classification unit tests. Since 2026-09-30 no default label
 *   hides content from an AI (option B, decided by Jouni: "Säilytetään tila 'piilotettu' omistajan
 *   valintana, mutta mikään oletusluokitus ei käytä sitä."), so a test that proves what happens to
 *   hidden content first stores a node policy in which the operator chose 'hidden' for a label.
 *   hideFromAiOnNode() is that operator's choice, written straight to the node's policy record.
 * @structure HIDDEN_LABEL · hideFromAiOnNode()
 * @usage beforeEach(async () => { storage = new SqliteStorage(':memory:'); await hideFromAiOnNode(storage, N); });
 * @version-history
 *   v1.0.0 — 2026-09-30 — Initial: the tests that relied on the default hiding set it up explicitly.
 */
import type { Storage } from '../../src/storage/interface.js';
import { DEFAULT_LABELS } from '../../src/services/classification/defaults.js';
import { NODE_POLICY_KEY } from '../../src/services/classification/policy.js';

/** The label the tests hide from AI: the node's highest default label, as an operator would pick. */
export const HIDDEN_LABEL = 'erittain-luottamuksellinen';

/**
 * Store a node policy in which the labels `ids` hide content from an AI, everything else as the
 * defaults. Overwrites any node policy the store holds.
 */
export async function hideFromAiOnNode(storage: Storage, nodeId: string, ids: readonly string[] = [HIDDEN_LABEL]): Promise<void> {
  const labels = DEFAULT_LABELS.map(l => ({ ...l, name: { ...l.name }, ...(ids.includes(l.id) ? { aiVisibility: 'hidden' as const } : {}) }));
  const at = '2026-09-30T00:00:00.000Z';
  await storage.setMemory({
    key: NODE_POLICY_KEY, ownerGaii: `system@${nodeId}`, value: { policy: { labels }, history: [], proposal: null },
    visibility: 'private', tags: ['classification-policy'], ttlHours: null, version: 1, createdAt: at, updatedAt: at,
  });
}
