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
 *   2026-10-18 — firstNoticeFor writes the slot with updateRecord, on the version it read.
 *   v1.0.0 — 2026-10-02 — Moved from package-upstream-refresh.ts (package sale design, phase 5).
 */
import type { Storage } from '../../../storage/interface.js';
import { updateRecord, UNCHANGED } from '../../record-cas.js';

/** Where the owner was last told about a version, per install: one record per install, system namespace. */
export const NS_UPDATE_NOTICES = 'package-update-notices';

/** True the first time this install is told about this version; false every time after. */
export async function firstNoticeFor(storage: Storage, instanceId: string, version: string): Promise<boolean> {
    // Decided on the version that was read (updateRecord): of two callers at once, one writes the slot
    // and is answered true, and the other re-reads it and is answered false.
    let first = false;
    await updateRecord(storage, NS_UPDATE_NOTICES, instanceId,
        v => (v && typeof v === 'object' ? v as { version?: string } : undefined),
        prev => {
            first = prev?.version !== version;
            return first ? { version, noticedAt: new Date().toISOString() } : UNCHANGED;
        }, { tag: 'package-update-notice' });
    return first;
}
