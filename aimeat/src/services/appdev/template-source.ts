/**
 * @file src/services/appdev/template-source.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The live app an app template grew out of. GET /v1/appdev/templates/:id and
 *   aimeat_app_template_get both read it here (CLAUDE.md, Backend: one capability, one
 *   implementation) and build their own source_app block from it. A failed read is logged and
 *   answered as no app, as both surfaces did before; `label` names the surface in the log line.
 * @structure templateSourceApp
 * @usage const app = await templateSourceApp(storage, config.nodeId, manifest.derivedFrom, 'proofs');
 * @version-history
 *   v1.0.0 — 2026-11-13 — Initial (structure programme unit 2).
 */
import type { Storage, AppRecord } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';

/** The template's source app on this node, or null when it is gone or the read failed. */
export async function templateSourceApp(
    storage: Storage, nodeId: string, derivedFrom: { owner: string; filename: string }, label: string,
): Promise<AppRecord | null> {
    const sourceOwnerGhii = `${derivedFrom.owner}@${nodeId}`;
    return storage.getApp(sourceOwnerGhii, derivedFrom.filename)
        .catch(err => { logger.warn(`${label}: continuing after a suppressed failure`, { error: String(err) }); return null; });
}
