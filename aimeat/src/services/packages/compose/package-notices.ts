/**
 * @file services/packages/compose/package-notices.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether an installed copy's owner was already told about one thing, so a nightly job
 *   tells them once and not every night. One record per notice slot in the system namespace
 *   `package-update-notices`, which no principal addresses. Moved out of package-upstream-refresh.ts
 *   unchanged, so the withdrawal service (package-withdrawals.ts) uses it without an import cycle.
 * @structure NS_UPDATE_NOTICES · firstNoticeFor()
 * @version-history
 *   v1.0.0 — 2026-10-02 — Moved from package-upstream-refresh.ts (package sale design, phase 5).
 */
import type { Storage } from '../../../storage/interface.js';

/** Where the owner was last told about a version, per install: one record per install, system namespace. */
export const NS_UPDATE_NOTICES = 'package-update-notices';

/** True the first time this install is told about this version; false every time after. */
export async function firstNoticeFor(storage: Storage, instanceId: string, version: string): Promise<boolean> {
    const prev = await storage.getMemory(NS_UPDATE_NOTICES, instanceId);
    if ((prev?.value as { version?: string } | undefined)?.version === version) return false;
    const now = new Date().toISOString();
    await storage.setMemory({
        key: instanceId, ownerGaii: NS_UPDATE_NOTICES, value: { version, noticedAt: now },
        visibility: 'private', tags: ['package-update-notice'], ttlHours: null,
        version: prev ? prev.version + 1 : 1, createdAt: prev?.createdAt ?? now, updatedAt: now,
    });
    return true;
}
