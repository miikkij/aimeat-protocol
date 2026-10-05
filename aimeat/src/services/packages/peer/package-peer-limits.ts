/**
 * @file services/packages/peer/package-peer-limits.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two parts of finding F that were left open (docs/specs/package-sale-design.md,
 *   section 6, items 2 and 4): a node-wide cap on the packages-only peers a repository registers, and
 *   the removal of the ones nothing uses any more.
 *
 *   WHICH PEERS. Only those a package path registered on this node for another node: a grant, a signed
 *   sale or a named seller (peer-origin.ts sources package-grant, package-sale, package-seller), still at
 *   the contact tier with messaging off. A peer the operator raised, and a repository this node buys
 *   from, are never counted and never removed.
 *
 *   THE CAP (`packagePeerCap`, AIMEAT_PACKAGE_PEER_CAP, default 500). A new registration beyond it is
 *   refused with 409 PACKAGE_PEER_CAP, before anything is written, and the operator is told once per cap
 *   value on the Security page. A node already registered or already waiting is never refused by it.
 *
 *   THE CLEANUP (the daily core job `package-peer-cleanup`). A packages-only peer that holds no
 *   entitlement to any package here, is nobody's seller, and was registered more than 30 days ago is
 *   removed with its recorded origin, so its node id is free again. Thirty days leave room for a grant
 *   revoked by mistake to be given again without the node proving its card a second time.
 * @structure PACKAGE_PEER_SOURCES · DEFAULT_PACKAGE_PEER_CAP · packagePeerCount() · capRefusal() ·
 *   cleanupPackagePeers()
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial (package sale design, phase 5: finding F's cap and cleanup).
 */
import type { AimeatConfig } from '../../../config.js';
import type { Storage } from '../../../storage/interface.js';
import type { PeerInfo } from '../../federation.js';
import { listPeerOrigins, listPendingPeers, NS_PEER_ORIGIN, type PeerOriginSource } from '../../peer-origin.js';
import { recordSecurityIncident } from '../../security-incident.js';
import { removePeer } from '../../federation-peer-remove.js';
import { logger } from '../../../utils/logger.js';

export const PACKAGE_PEER_SOURCES: ReadonlySet<PeerOriginSource> = new Set<PeerOriginSource>(['package-grant', 'package-sale', 'package-seller']);
export const DEFAULT_PACKAGE_PEER_CAP = 500;
const UNUSED_AFTER_MS = 30 * 86_400_000;

/** A peer still packages-only: the contact tier with messaging off, as registerPackagePeer made it. */
const packagesOnly = (p: PeerInfo | undefined): boolean => !!p && p.tier === 'contact' && p.allowMessaging === false;

/** The packages-only peers a package path registered here, and the registrations still waiting. */
export async function packagePeerCount(storage: Storage, peers: Map<string, PeerInfo>): Promise<number> {
    const origins = await listPeerOrigins(storage);
    let n = 0;
    for (const [nodeId, o] of origins) if (PACKAGE_PEER_SOURCES.has(o.source) && packagesOnly(peers.get(nodeId))) n++;
    for (const p of await listPendingPeers(storage)) if (PACKAGE_PEER_SOURCES.has(p.source)) n++;
    return n;
}

type Refusal = { ok: false; status: number; code: string; message: string };

/**
 * The refusal for one more registration when the cap is reached, or null. The operator is told once
 * per cap value. Never throws: a failure to count lets the registration through and is logged.
 */
export async function capRefusal(
    deps: { storage: Storage; peers: Map<string, PeerInfo>; thisNodeId?: string }, cap: number,
): Promise<Refusal | null> {
    try {
        const count = await packagePeerCount(deps.storage, deps.peers);
        if (count < cap) return null;
        const marker = `cap-reached.${cap}`;
        if (deps.thisNodeId && !(await deps.storage.getMemory(NS_PEER_ORIGIN, marker))) {
            await recordSecurityIncident(deps.storage, { nodeId: deps.thisNodeId }, {
                type: 'federation_peer', code: 'PACKAGE_PEER_CAP', actorGhii: 'system', source: 'package-peer-limits',
                detail: `This repository holds ${count} packages-only peers, the most AIMEAT_PACKAGE_PEER_CAP (${cap}) allows, so a new customer or seller node is refused. `
                    + 'Unused ones are removed after 30 days; raise the cap if the repository serves more customers.',
            });
            const now = new Date().toISOString();
            await deps.storage.setMemory({
                key: marker, ownerGaii: NS_PEER_ORIGIN, value: { cap, count, at: now }, visibility: 'private',
                tags: ['peer-cap'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
            });
        }
        return { ok: false, status: 409, code: 'PACKAGE_PEER_CAP', message: `This repository serves as many nodes as its operator allows (${cap}). Nothing was granted; ask the operator to raise the limit.` };
    } catch (err) {
        logger.warn('package-peer-limits: the cap could not be counted; the registration goes ahead', { error: String(err) });
        return null;
    }
}

/**
 * Remove the packages-only peers nothing uses: no entitlement names the node, it is nobody's seller,
 * and it was registered more than 30 days ago. Returns the node ids removed. Never throws.
 */
export async function cleanupPackagePeers(
    deps: { storage: Storage; config: AimeatConfig; peers: Map<string, PeerInfo> }, now = Date.now(),
): Promise<string[]> {
    const { storage } = deps;
    const removed: string[] = [];
    try {
        const used = new Set<string>();
        for (const row of await storage.listMemory('package-entitlements', { prefix: 'entitlements.' })) {
            for (const nodeId of Object.keys((row.value as { nodes?: Record<string, unknown> } | undefined)?.nodes ?? {})) used.add(nodeId);
        }
        for (const row of await storage.listMemory('package-entitlements', { prefix: 'sellers.' })) {
            for (const nodeId of Object.keys((row.value as { nodes?: Record<string, unknown> } | undefined)?.nodes ?? {})) used.add(nodeId);
        }
        for (const [nodeId, o] of await listPeerOrigins(storage)) {
            if (!PACKAGE_PEER_SOURCES.has(o.source) || used.has(nodeId) || !packagesOnly(deps.peers.get(nodeId))) continue;
            if (now - Date.parse(o.provenAt) < UNUSED_AFTER_MS) continue;
            const out = await removePeer(deps, nodeId, { emergency: true, notifyNetwork: false, reason: 'package_peer_unused' });
            if (out.ok) removed.push(nodeId);
        }
    } catch (err) {
        logger.warn('package-peer-limits: the cleanup stopped part-way', { error: String(err), removed });
    }
    return removed;
}
