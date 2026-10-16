/**
 * @file src/services/workspace-opened.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description When each page of a workspace was last opened, so a page nobody reads any more can be
 *   told apart from one that is read every day (Jouni, 2026-10-16: both page kinds). It is how a
 *   workspace's pages go stale: a page neither opened nor changed for PAGE_STALE_DAYS is marked, and
 *   its archiving is offered (the workspace index carries `last_opened` and `stale`).
 *
 *   ONE RECORD PER WORKSPACE, `organism.{id}.w.{ws}.meta.opened`, a map of `<space>/<id>` to a day
 *   (`YYYY-MM-DD`). A day, not a moment: the record is written at most once per page per day, so a
 *   page read a thousand times today costs one write, and a key per page or per view would be the
 *   shape memory-contracts rules out. Stored under the identity that holds the copy that counts, or
 *   with none yet the one that registered the workspace, as the share is.
 * @structure markPageOpened() · markPagesOpened() · readOpened() · isPageStale()
 * @usage
 *   await markPageOpened(storage, config, orgId, ws, 'docs', docId);   // best-effort, never throws
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { readWorkspaceMetaRecord, findWorkspaceRegistration } from './workspace-meta-read.js';
import { PAGE_STALE_DAYS } from './html-page.js';
import { logger } from '../utils/logger.js';

/** Pages one record remembers; past it the days longest ago are dropped. */
const OPENED_MAX = 5000;

/** The day pages were last opened, keyed `<space>/<id>`. Empty when nothing was recorded. */
export async function readOpened(storage: Storage, config: AimeatConfig, orgId: string, ws: string): Promise<Record<string, string>> {
    const v = (await readWorkspaceMetaRecord(storage, orgId, ws, 'meta.opened', config.nodeId))?.value;
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, string> : {};
}

/** Record that one page was opened today (markPagesOpened). */
export function markPageOpened(storage: Storage, config: AimeatConfig, orgId: string, ws: string, space: string, id: string): Promise<void> {
    return markPagesOpened(storage, config, orgId, ws, [{ space, id }]);
}

/**
 * Record that these pages were opened today: one read and at most one write, whatever their number,
 * and none when each already says today. Best-effort, because a reader must never fail to see a page
 * for want of this line.
 */
export async function markPagesOpened(
    storage: Storage, config: AimeatConfig, orgId: string, ws: string, pages: Array<{ space: string; id: string }>,
): Promise<void> {
    if (pages.length === 0) return;
    try {
        const day = new Date().toISOString().slice(0, 10);
        const key = `organism.${orgId}.w.${ws}.meta.opened`;
        const existing = await readWorkspaceMetaRecord(storage, orgId, ws, 'meta.opened', config.nodeId);
        const map = existing?.value && typeof existing.value === 'object' && !Array.isArray(existing.value)
            ? { ...(existing.value as Record<string, string>) } : {};
        let changed = false;
        for (const p of pages) {
            const page = `${p.space}/${p.id}`;
            if (map[page] !== day) { map[page] = day; changed = true; }
        }
        if (!changed) return;
        const names = Object.keys(map);
        if (names.length > OPENED_MAX) {
            for (const n of names.sort((a, b) => (map[a] < map[b] ? -1 : 1)).slice(0, names.length - OPENED_MAX)) delete map[n];
        }
        const owner = existing?.ownerGaii ?? (await findWorkspaceRegistration(storage, orgId, ws))?.record.ownerGaii;
        if (!owner) return;
        const now = new Date().toISOString();
        await storage.setMemory({
            key, ownerGaii: owner, value: map, visibility: 'private', tags: ['opened'], ttlHours: null,
            version: existing ? existing.version + 1 : 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
        });
    } catch (err) {
        logger.warn('markPagesOpened: best-effort', { orgId, ws, pages: pages.length, error: String(err) });
    }
}

/** Neither opened nor changed for PAGE_STALE_DAYS. A page with no recorded open counts from its last change. */
export function isPageStale(lastOpenedDay: string | undefined, updatedAt: string | undefined, nowMs: number = Date.now()): boolean {
    const opened = lastOpenedDay ? Date.parse(`${lastOpenedDay}T00:00:00Z`) : NaN;
    const changed = updatedAt ? Date.parse(updatedAt) : NaN;
    const latest = Math.max(Number.isFinite(opened) ? opened : 0, Number.isFinite(changed) ? changed : 0);
    if (latest === 0) return false;
    return nowMs - latest > PAGE_STALE_DAYS * 86_400_000;
}
