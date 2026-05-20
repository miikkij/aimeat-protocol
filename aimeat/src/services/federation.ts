/**
 * Federation service — background heartbeat, GAII resolution cache,
 * and peer health monitoring.
 */

import { createHash } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { sign } from '../auth/keypair.js';
import { computeCatalogueHash } from '../utils/catalogue-hash.js';
import { logger } from '../utils/logger.js';

/** Cache of resolved GAIIs to their hosting node URL. TTL: 5 minutes. */
const gaiiCache = new Map<string, { nodeId: string; nodeUrl: string; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60_000;

/** Consecutive failure counter per peer (for health tracking). */
const peerFailures = new Map<string, number>();

export interface PeerInfo {
    nodeId: string;
    url: string;
    publicKey: string;
    status: string;
    addedAt: string;
    lastSeen: string;
    shareCatalogue: boolean;
    replicateMemory: boolean;
    allowRouting: boolean;
    peerMode: 'federation' | 'private';
}

/**
 * Resolve which node hosts a GAII. Checks local cache first, then local storage,
 * then falls back to asking peers.
 */
export async function resolveGaii(
    gaii: string,
    config: AimeatConfig,
    storage: Storage,
    peers: Map<string, PeerInfo>,
): Promise<{ nodeId: string; nodeUrl: string; local: boolean } | null> {
    // 1. Cache check
    const cached = gaiiCache.get(gaii);
    if (cached && Date.now() < cached.expiresAt) {
        return { nodeId: cached.nodeId, nodeUrl: cached.nodeUrl, local: cached.nodeId === config.nodeId };
    }

    // 2. Local check
    const localAgent = await storage.getAgent(gaii);
    if (localAgent) {
        return { nodeId: config.nodeId, nodeUrl: config.baseUrl, local: true };
    }

    // 2b. Check personal nodes anchored to this operator
    const personalNodes = await storage.listPersonalNodes();
    for (const pn of personalNodes) {
        if (pn.agentGaiis.includes(gaii)) {
            gaiiCache.set(gaii, { nodeId: pn.nodeId, nodeUrl: config.baseUrl, expiresAt: Date.now() + CACHE_TTL_MS });
            return { nodeId: pn.nodeId, nodeUrl: config.baseUrl, local: false };
        }
    }

    // 3. Parse node hint from GAII (agent#owner@node)
    const atIdx = gaii.lastIndexOf('@');
    if (atIdx !== -1) {
        const nodeHint = gaii.substring(atIdx + 1);
        const peer = [...peers.values()].find(p => p.nodeId === nodeHint && p.status === 'active');
        if (peer) {
            gaiiCache.set(gaii, { nodeId: nodeHint, nodeUrl: peer.url, expiresAt: Date.now() + CACHE_TTL_MS });
            return { nodeId: nodeHint, nodeUrl: peer.url, local: false };
        }
    }

    // 4. Broadcast resolve to peers
    const activePeers = [...peers.values()].filter(p => p.status === 'active');
    for (const peer of activePeers) {
        try {
            const resp = await fetch(`${peer.url}/v1/agents/${encodeURIComponent(gaii)}`, {
                signal: AbortSignal.timeout(5_000),
            });
            if (resp.ok) {
                gaiiCache.set(gaii, { nodeId: peer.nodeId, nodeUrl: peer.url, expiresAt: Date.now() + CACHE_TTL_MS });
                return { nodeId: peer.nodeId, nodeUrl: peer.url, local: false };
            }
        } catch {
            // Continue to next peer
        }
    }

    return null;
}

/** Cached catalogue hash per peer for change detection. */
const peerCatalogueHashes = new Map<string, string>();

/** Start time for uptime reporting. */
const startedAt = Date.now();

/**
 * Callback invoked when a peer recovers from unreachable/offline → active.
 * Set by sync infrastructure (Phase B) when ready.
 */
let onPeerRecovery: ((peerId: string) => void) | null = null;

/** Register a callback for peer recovery events (used by catalogue sync). */
export function setOnPeerRecovery(cb: (peerId: string) => void): void {
    onPeerRecovery = cb;
}

/**
 * Compute a per-peer stagger offset within the heartbeat interval.
 * Uses SHA-256(localNodeId + peerNodeId) mod interval to distribute heartbeats.
 */
function peerStaggerMs(localNodeId: string, peerNodeId: string, intervalMs: number): number {
    const hash = createHash('sha256').update(localNodeId + peerNodeId).digest();
    const offset = hash.readUInt32BE(0) % intervalMs;
    return offset;
}

/**
 * Start background heartbeat job. Pings all active peers with signed heartbeats
 * containing catalogue hash and stats. Uses jittered scheduling (±25%) and
 * per-peer stagger to prevent thundering herd.
 */
export function startHeartbeatJob(
    config: AimeatConfig,
    storage: Storage,
    peers: Map<string, PeerInfo>,
): ReturnType<typeof setInterval> {
    const BASE_INTERVAL_MS = 5 * 60_000;
    const TIMEOUT_MS = config.federationTimeoutMs;

    async function heartbeatCycle(): Promise<void> {
        // ── De-peering grace period enforcement ──
        const depeeringPeers = [...peers.entries()].filter(([, p]) => p.status === 'depeering');
        for (const [key, peer] of depeeringPeers) {
            const graceEnd = (peer as PeerInfo & { depeerGraceEnd?: string }).depeerGraceEnd;
            if (graceEnd && new Date(graceEnd).getTime() <= Date.now()) {
                peers.delete(key);
                storage.deleteFederationPeer(key).catch(() => {});
                logger.info(`Peer ${peer.nodeId} purged after de-peering grace period expired`);
            }
        }

        // ── Heartbeat active/degraded peers ──
        const activePeers = [...peers.entries()].filter(([, p]) => p.status === 'active' || p.status === 'degraded');
        if (activePeers.length === 0) return;

        // Compute stats once per cycle
        const catalogueHash = await computeCatalogueHash(storage);
        const nodeKey = await storage.getNodeKey();
        const agents = await storage.listAgents();
        const actions = await storage.listActions();

        for (const [key, peer] of activePeers) {
            // Per-peer stagger: skip this peer if not yet due
            const stagger = peerStaggerMs(config.nodeId, peer.nodeId, BASE_INTERVAL_MS);
            const cyclePhase = Date.now() % BASE_INTERVAL_MS;
            if (Math.abs(cyclePhase - stagger) > BASE_INTERVAL_MS * 0.3) continue;

            try {
                const payload = {
                    node_id: config.nodeId,
                    timestamp: new Date().toISOString(),
                    version: 'v1',
                    stats: {
                        agents_active: agents.length,
                        actions_published: actions.length,
                        uptime_hours: (Date.now() - startedAt) / 3_600_000,
                        catalogue_hash: catalogueHash,
                    },
                };

                // Sign heartbeat payload with node Ed25519 key
                const payloadJson = JSON.stringify(payload);
                const signature = nodeKey
                    ? await sign(nodeKey.privateKey, payloadJson)
                    : undefined;

                const resp = await fetch(`${peer.url}/v1/federation/ping`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...payload, signature }),
                    signal: AbortSignal.timeout(TIMEOUT_MS),
                });

                if (resp.ok) {
                    const previousStatus = peer.status;
                    peer.lastSeen = new Date().toISOString();
                    peer.status = 'active';
                    peerFailures.set(key, 0);
                    storage.saveFederationPeer(peer).catch(() => {});

                    // Detect catalogue hash mismatch for sync triggering
                    const cachedHash = peerCatalogueHashes.get(key);
                    if (cachedHash && cachedHash !== catalogueHash) {
                        logger.info(`Catalogue hash changed for peer ${peer.nodeId}, sync may be needed`);
                    }
                    peerCatalogueHashes.set(key, catalogueHash);

                    // Recovery trigger: peer came back from unreachable/offline
                    if ((previousStatus === 'offline' || previousStatus === 'unreachable') && onPeerRecovery) {
                        logger.info(`Peer ${peer.nodeId} recovered from ${previousStatus}, triggering re-sync`);
                        onPeerRecovery(key);
                    }
                } else {
                    const failures = (peerFailures.get(key) ?? 0) + 1;
                    peerFailures.set(key, failures);
                    if (failures >= 10) {
                        peer.status = 'offline';
                        logger.warn(`Peer ${peer.nodeId} offline after ${failures} consecutive failures`);
                    } else if (failures >= 3) {
                        peer.status = 'degraded';
                        logger.warn(`Peer ${peer.nodeId} degraded after ${failures} consecutive failures`);
                    }
                    storage.saveFederationPeer(peer).catch(() => {});
                }
            } catch {
                const failures = (peerFailures.get(key) ?? 0) + 1;
                peerFailures.set(key, failures);
                if (failures >= 10) {
                    peer.status = 'offline';
                    logger.warn(`Peer ${peer.nodeId} offline after ${failures} consecutive failures`);
                } else if (failures >= 3) {
                    peer.status = 'degraded';
                }
                storage.saveFederationPeer(peer).catch(() => {});
            }
        }
    }

    // Jittered scheduling: ±25% random offset per cycle
    function scheduleNext(): void {
        const jitter = BASE_INTERVAL_MS * 0.25 * (Math.random() * 2 - 1);
        const nextMs = Math.max(30_000, BASE_INTERVAL_MS + jitter);
        setTimeout(() => {
            heartbeatCycle().catch(err => {
                logger.error('Heartbeat cycle failed', { error: (err as Error).message });
            });
            scheduleNext();
        }, nextMs);
    }

    scheduleNext();

    // Return an interval handle for compatibility (actual scheduling is via setTimeout chain)
    return setInterval(() => {}, 2_147_483_647);
}
