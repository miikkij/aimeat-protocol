/**
 * @file src/services/datapackage/versions-in-use.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which versions of a data package are still in use, and which the owner's retention
 *   policy removes next (plan doc-mvwxcas3dom3, D6.4). The owner's view of GET
 *   /v1/datapackages/{owner}/{name}/versions reads it; no second log is kept:
 *     - pinned: the live named shares that pin the version (the consent records, ../parties/shares.ts);
 *     - read: the served reads of outside parties in the last READ_WINDOW_DAYS, from the party read
 *       log (`party-reads.<yyyy-mm>`, ../parties/read-stats.ts). A read that named no version read the
 *       version that was newest at its time, and is placed on it;
 *     - removed_next: what the next publish would remove under the policy of the current version
 *       (./retention.ts doomedVersions), a pinned version never.
 * @structure READ_WINDOW_DAYS · VersionUse · versionsInUse
 * @usage const use = await versionsInUse(deps, ownerGhii, name, versions);
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D6.4).
 */
import type { StoreDeps, VersionEntry } from './store.js';
import { bare, descriptorKey, type Descriptor } from './contract.js';
import { doomedVersions, pinnedVersionsOf } from './retention.js';
import { readLogsOf } from '../parties/read-stats.js';
import { logger } from '../../utils/logger.js';

/** How far back a party read counts as use. */
export const READ_WINDOW_DAYS = 30;

/** What the owner learns about one version. */
export interface VersionUse {
    /** The live named shares that pin this version. */
    pinned_by_shares: string[];
    /** Served reads by outside parties in the last READ_WINDOW_DAYS. */
    party_reads_30d: number;
    last_party_read_at: string | null;
    /** True when the next publish removes this version under the retention policy. */
    removed_next: boolean;
}

/** The use of each version (by bare hash) and the policy it was computed under. */
export async function versionsInUse(
    deps: StoreDeps, ownerGhii: string, name: string, versions: VersionEntry[], now = new Date(),
): Promise<{ byHash: Map<string, VersionUse>; retention: { keep: number; unit: string } | null }> {
    const pinned = await pinnedVersionsOf(deps, ownerGhii, name);
    const byHash = new Map<string, VersionUse>();
    for (const v of versions) {
        const h = bare(v.contentHash);
        byHash.set(h, { pinned_by_shares: pinned.get(h) ?? [], party_reads_30d: 0, last_party_read_at: null, removed_next: false });
    }

    // Newest first: the version that was newest at a moment is the first one published at or before it.
    const timeline = [...versions].sort((a, b) => b.at.localeCompare(a.at));
    const since = now.getTime() - READ_WINDOW_DAYS * 86_400_000;
    for (const log of await readLogsOf(deps.storage, ownerGhii, now)) {
        for (const e of log.entries) {
            if (e.verdict !== 'served' || Date.parse(e.at) < since) continue;
            if (e.what !== name && !e.what.startsWith(`${name}/`)) continue;
            const placed = e.version ? null : (timeline.find(v => v.at <= e.at) ?? timeline[timeline.length - 1]);
            const h = e.version ? bare(e.version) : placed ? bare(placed.contentHash) : '';
            const use = byHash.get(h);
            if (!use) continue;
            use.party_reads_30d++;
            if (!use.last_party_read_at || e.at > use.last_party_read_at) use.last_party_read_at = e.at;
        }
    }

    // The policy of the current version: the next publish makes a new current, so every version stored
    // now is a candidate (./retention.ts).
    const current = versions.find(v => v.current);
    let retention: { keep: number; unit: string } | null = null;
    if (current) {
        const file = await deps.storage.getStorageFile(ownerGhii, descriptorKey(name, current.contentHash));
        let policy: Descriptor['aimeat']['retentionPolicy'];
        try {
            policy = file ? (JSON.parse(file.data.toString('utf8')) as Descriptor).aimeat.retentionPolicy : undefined;
        } catch (err) {
            // An unreadable descriptor states no policy; the list says retention_policy null.
            logger.warn('datapackage versions in use: the current descriptor is not readable JSON', { owner: ownerGhii, package: name, error: String(err) });
            policy = undefined;
        }
        if (policy) {
            retention = { keep: policy.keep, unit: policy.unit };
            const ordered = timeline.map(v => ({ hash: bare(v.contentHash), at: Date.parse(v.at) || 0 }));
            for (const d of doomedVersions(ordered, policy, now.getTime(), new Set(pinned.keys()))) {
                const use = byHash.get(d.hash);
                if (use) use.removed_next = true;
            }
        }
    }
    return { byHash, retention };
}
