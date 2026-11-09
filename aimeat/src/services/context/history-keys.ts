/**
 * @file src/services/context/history-keys.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which memory keys keep their earlier versions, and how many. A person's contexts
 *   (`context.<slug>`) and their ontology modules (`vocab.ctx.<name>…`) are rewritten whole by an AI,
 *   and one bad write used to lose what was there with no way back: the bin protects against a
 *   delete, not against an overwrite. Writes to these keys are marked trackable, so storage archives
 *   the version each write replaces (memory_history), and aimeat_memory_history reads them back.
 *
 *   LIFECYCLE. A key keeps its newest HISTORY_KEEP earlier versions; older ones are pruned after each
 *   write. When the key itself is purged from the bin, its history goes with it
 *   (purgeDeletedMemory), so a deleted context leaves nothing behind.
 * @structure HISTORY_PREFIXES · HISTORY_KEEP · keepsHistory()
 * @usage
 *   if (keepsHistory(key)) record.trackable = true;
 * @version-history
 *   v1.0.0 — 2026-11-09 — Initial (wish-oma-konteksti-muoto-syntyy-k-yt-ss-n-kym-pyynn-st).
 */

/** Key prefixes whose writes keep the replaced version. */
export const HISTORY_PREFIXES = ['context.', 'vocab.ctx.'] as const;

/** Earlier versions kept per key; older ones are pruned after a write. */
export const HISTORY_KEEP = 50;

/** True when writes to this key keep the version they replace. */
export function keepsHistory(key: string): boolean {
    return HISTORY_PREFIXES.some(p => key.startsWith(p));
}
