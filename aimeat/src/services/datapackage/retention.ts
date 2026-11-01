/**
 * @file src/services/datapackage/retention.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's retention policy of a data package: which versions a publish removes, and
 *   which the next publish would remove. Moved out of ./store.ts (which had reached the line ceiling)
 *   with one rule added: A VERSION A NAMED SHARE PINS IS NEVER REMOVED (plan doc-mvwxcas3dom3, D6.4).
 *   An outside party whose share pins a version reads exactly those bytes until the share ends, so the
 *   version stays, outside the count, until no live share pins it; the next publish after that removes
 *   it when the policy says so.
 *
 *   FOUR RULES, because this deletes published data at a permanent address:
 *   1. IT ONLY RUNS WHEN THE OWNER ASKED. No policy means keep everything, for ever.
 *   2. THE CURRENT VERSION IS NEVER PRUNED, whatever the arithmetic says. `keep: 0` removes every old
 *      version and leaves the one the pointer names.
 *   3. A PRUNED VERSION IS GONE, and a consumer pinned to it by address gets a 404 rather than different
 *      bytes. A named share's pin is the exception above, because the node knows that reader.
 *   4. WHAT WAS REMOVED IS RETURNED AND LOGGED.
 * @structure RetentionPolicy · VersionAge · doomedVersions · pinnedVersionsOf · pruneOldVersions
 * @usage const removed = await pruneOldVersions(deps, ownerGhii, name, policy, contentHash);
 * @version-history
 *   v1.1.0 — 2026-11-01 — The newest version of each interface a live EXCHANGE contract pins is kept too,
 *     named `contract:<entitlement id>` (plan D5.1).
 *   v1.0.0 — 2026-11-01 — pruneOldVersions moved from ./store.ts unchanged; doomedVersions extracted as
 *     the pure half, shared with the versions list; a version a live named share pins is kept (D6.4).
 */
import type { Storage } from '../../storage/interface.js';
import { bare, packageKeyRoot, type PublishInput } from './contract.js';
import { isLiveShare, packageOfPattern, shareMetaOf } from '../parties/shares.js';
import { logger } from '../../utils/logger.js';
import { localAccountName } from '../../utils/gaii.js';
import { listEntitlementsByProvider } from '../metered-entitlements.js';
import { contractVersionHashes, datapackageCoordinate } from '../exchange-datapackage.js';

export type RetentionPolicy = NonNullable<PublishInput['retentionPolicy']>;

/** The store this needs; ./store.ts imports this file, so its StoreDeps is not imported back. */
type StoreDeps = { storage: Storage };

/** One version for the arithmetic: its bare hash and when its files landed (ms). */
export interface VersionAge { hash: string; at: number }

/**
 * The versions the policy removes, of `ordered` (newest first), which holds the versions OTHER than
 * the one that stays current. `keep` counts versions including the current one, which is what an owner
 * means by "keep the last 30", so the others list is trimmed to keep-1. A version in `pinned` is never
 * removed and does not take a place in the count.
 */
export function doomedVersions(ordered: VersionAge[], policy: RetentionPolicy, nowMs: number, pinned: ReadonlySet<string>): VersionAge[] {
    const keep = Number(policy.keep);
    if (!Number.isFinite(keep) || keep < 0) return [];
    const candidates = ordered.filter(v => !pinned.has(bare(v.hash)));
    if (policy.unit === 'months') {
        const cutoff = nowMs - keep * 30 * 24 * 3600_000;
        return candidates.filter(v => v.at < cutoff);
    }
    return candidates.slice(Math.max(0, keep - 1));
}

/** The bare hashes the owner's live named shares of `name` pin. */
export async function pinnedVersionsOf(deps: StoreDeps, ownerGhii: string, name: string): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    const consents = await deps.storage.listConsents(ownerGhii, { status: 'active' });
    for (const c of consents) {
        if (!c.recipient.startsWith('party:') || packageOfPattern(c.dataPattern) !== name || !isLiveShare(c)) continue;
        const pin = shareMetaOf(c).pinnedVersion;
        if (!pin) continue;
        const h = bare(pin);
        out.set(h, [...(out.get(h) ?? []), c.id]);
    }
    // A live EXCHANGE contract reads the versions of the interface it pins (plan D5.1): the newest of
    // them stays, so the contract always has a version to read after the schemas changed.
    const coord = datapackageCoordinate(localAccountName(ownerGhii), name);
    const contracts = (await listEntitlementsByProvider(deps.storage, ownerGhii))
        .filter(e => e.ext === coord.ext && e.state !== 'revoked' && e.surface?.kind === 'datapackage');
    const byIface = new Map<number, string[]>();
    for (const e of contracts) if (e.surface?.kind === 'datapackage') byIface.set(e.surface.ifaceVersion, [...(byIface.get(e.surface.ifaceVersion) ?? []), `contract:${e.entitlementId}`]);
    for (const [iface, ids] of byIface) {
        const newest = (await contractVersionHashes(deps.storage, ownerGhii, name, iface))[0];
        if (newest) out.set(bare(newest), [...(out.get(bare(newest)) ?? []), ...ids]);
    }
    return out;
}

/**
 * Apply the owner's retention policy after a new version is live: keep the newest N versions, or
 * everything published within the last N months, and remove the rest, except a version a live named
 * share pins. Answers the removed versions as `sha256:<hex>`.
 */
export async function pruneOldVersions(
    deps: StoreDeps, ownerGhii: string, name: string, policy: RetentionPolicy, currentHash: string,
): Promise<string[]> {
    const keep = Number(policy.keep);
    if (!Number.isFinite(keep) || keep < 0) return [];

    // Every stored file of this package, grouped into versions by the hash segment of its key.
    const root = `${packageKeyRoot(name)}/`;
    const files = (await deps.storage.listStorageFiles(ownerGhii))
        .filter(f => f.key.startsWith(root) && !f.key.endsWith('/latest.json'));
    const versions = new Map<string, { keys: string[]; at: number }>();
    for (const f of files) {
        const hash = f.key.slice(root.length).split('/')[0];
        if (!/^[a-f0-9]{64}$/.test(hash)) continue;
        const at = Date.parse(f.createdAt);
        const entry = versions.get(hash) ?? { keys: [], at: 0 };
        entry.keys.push(f.key);
        entry.at = Math.max(entry.at, Number.isFinite(at) ? at : 0);
        versions.set(hash, entry);
    }

    const current = bare(currentHash);
    const ordered = [...versions.entries()]
        .filter(([hash]) => hash !== current)   // rule 2
        .sort((a, b) => b[1].at - a[1].at)      // newest first
        .map(([hash, v]) => ({ hash, at: v.at }));
    const pinned = await pinnedVersionsOf(deps, ownerGhii, name);
    const doomed = doomedVersions(ordered, policy, Date.now(), new Set(pinned.keys()));

    const removed: string[] = [];
    for (const { hash } of doomed) {
        for (const key of versions.get(hash)?.keys ?? []) await deps.storage.deleteStorageFile(ownerGhii, key);
        removed.push(`sha256:${hash}`);
    }
    if (removed.length) {
        logger.info('datapackage: retention removed old versions', {
            package: `${ownerGhii}/${name}`, policy: `${policy.keep} ${policy.unit}`,
            removed: removed.length, versions: removed, kept_for_shares: pinned.size,
        });
    }
    return removed;
}
