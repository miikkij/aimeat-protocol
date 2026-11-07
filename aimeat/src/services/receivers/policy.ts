/**
 * @file src/services/receivers/policy.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may make receivers on this node: the setting receivers.mode
 *   (AIMEAT_RECEIVERS_MODE), decided by the developer on 2026-11-07. `off`: no receiver is made and
 *   every receiver answers 503. `operator`: a new receiver waits for an operator's approval. `self`:
 *   the owner's word is enough. When the operator has not chosen, a node whose content is for its
 *   signed-in accounts only (an organisation node, contentAccess 'signed-in') asks the operator, and
 *   any other node lets the owner decide.
 * @structure ReceiversMode · RECEIVERS_MODES · receiversModeOf
 * @usage if (receiversModeOf(config) === 'off') …
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial (wish-vastaanottimet-receivers-ulkopuolinen-ohjelma-kirjoittaa-yht).
 */
import type { AimeatConfig } from '../../config.js';

export const RECEIVERS_MODES = ['off', 'operator', 'self'] as const;
export type ReceiversMode = typeof RECEIVERS_MODES[number];

/** The mode in force: the operator's choice, else the default of the node's kind. */
export function receiversModeOf(config: Pick<AimeatConfig, 'contentAccess' | 'receiversMode'>): ReceiversMode {
    const chosen = config.receiversMode;
    if (chosen && chosen !== 'auto' && (RECEIVERS_MODES as readonly string[]).includes(chosen)) return chosen;
    return config.contentAccess === 'signed-in' ? 'operator' : 'self';
}
