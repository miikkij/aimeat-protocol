/**
 * @file src/services/federation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Federation service — resolves which peer node hosts a GAII (with a 5-minute cache),
 *   runs the background heartbeat, and tracks per-peer health/availability across federated nodes.
 *
 * @structure
 *   - PeerInfo: shape of a known peer (keys, trust tier, availability, heartbeat stats, versions)
 *   - resolveGaii: cache → local storage → peer lookup to find a GAII's hosting node
 *   - gaiiCache/peerFailures: in-memory resolution cache and consecutive-failure counters
 *
 * @version-history
 *   v1.1.0 — 2026-08-10 — Security audit H-13/H-14: LIVENESS_RECOVERABLE and OPERATOR_PARKED, the peer
 *     statuses a liveness signal may lift and the ones only an operator may leave.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */

/**
 * Federation service — background heartbeat, GAII resolution cache,
 * and peer health monitoring.
 */

import { createHash } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { sign } from '../auth/keypair.js';
import { computeCatalogueHash } from '../utils/catalogue-hash.js';
import { recordHeartbeatOutcome } from './federation-availability.js';
import { getSoftwareVersion } from '../utils/version.js';
import type { ServiceSummary } from '../utils/service-summary.js';
import { logger } from '../utils/logger.js';

/** Cache of resolved GAIIs to their hosting node URL. TTL: 5 minutes. Expiry used to be
 * checked only on read, so every GAII ever resolved kept a permanent entry (memory audit
 * 2026-08-17); pruneGaiiCache runs on write and a hard cap backstops a resolve storm. */
const gaiiCache = new Map<string, { nodeId: string; nodeUrl: string; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60_000;
const GAII_CACHE_MAX = 5000;

function pruneGaiiCache(): void {
  const now = Date.now();
  for (const [k, v] of gaiiCache) {
    if (v.expiresAt <= now) gaiiCache.delete(k);
  }
  while (gaiiCache.size >= GAII_CACHE_MAX) {
    gaiiCache.delete(gaiiCache.keys().next().value as string);
  }
}

/** Consecutive failure counter per peer (for health tracking). */
const peerFailures = new Map<string, number>();

/** Peer statuses a liveness signal (ping/heartbeat) may lift back to active. A peer parked by an
 * operator decision (depeering, suspended) or still in admission (pending, approved) is NOT here:
 * proving you are up is not the same as being welcome. Audit H-14.
 */
/** Peer statuses that only an operator action may leave. A key exchange, a heartbeat or any other
 * peer-driven request must not lift a peer out of these. Audit H-13.
 */
export const OPERATOR_PARKED = new Set(['depeering', 'suspended']);

export const LIVENESS_RECOVERABLE = new Set(['active', 'degraded', 'offline', 'unreachable']);

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
    /** May this peer deliver direct messages, read receipts and attachment grants here? */
    allowMessaging: boolean;
    /** May this peer's operator announce to EVERY human on this node at once? */
    allowBroadcast: boolean;
    /** May this peer move morsels onto this node's ledger? */
    allowSettlement: boolean;
    peerMode: 'federation' | 'private';
    allowFederatedAuth: boolean;
    federationAuthScopes: string[];
    /** Trust tier (see services/federation-tiers.ts). Absent → 'member'. `contact` is the floor:
     *  messages and nothing else. */
    tier?: 'genesis' | 'member' | 'visiting' | 'contact';
    /** Does this node's `support@operators` resolve to THIS peer? Deliberately NOT a TierFlag: it is
     *  a per-link routing decision rather than a capability, so a tier change never flips it. */
    supportUpstream?: boolean;
    /** Availability label derived from heartbeat uptime (Phase B): 'temporary' | 'permanent' | 'unknown'. */
    availability?: 'temporary' | 'permanent' | 'unknown';
    /** Optional expiry for time-limited visiting peers (populated/enforced in Phase B). */
    expiresAt?: string | null;
    /** Lifetime successful / attempted heartbeats + windowed availability (Phase B). */
    heartbeatOk?: number;
    heartbeatTotal?: number;
    availabilityWindow?: string | null;
    availabilityPct?: number | null;
    /** Peer's AIMEAT software version (from heartbeat) — federation version visibility. */
    softwareVersion?: string | null;
    /** Hash of the peer's node-card, for change-detection when assembling the federation book. */
    nodeCardHash?: string | null;
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
            pruneGaiiCache();
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
        } catch (err) {
            // Continue to next peer
          logger.warn('resolveGaii: continuing after a suppressed failure', { error: String(err) });
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
/** Cached service summary hashes per peer for change detection. */
const peerSummaryHashes = new Map<string, string>();

export function startHeartbeatJob(
    config: AimeatConfig,
    storage: Storage,
    peers: Map<string, PeerInfo>,
    networkDirectory?: Map<string, ServiceSummary>,
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
                storage.deleteFederationPeer(key).catch(err => { logger.warn('graceEnd: continuing after a suppressed failure', { error: String(err) }); });
                networkDirectory?.delete(key);
                peerSummaryHashes.delete(key);
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

        // Availability-measurement options (Phase B uptime tracking)
        const availOpts = {
            windowDays: config.federationAvailabilityWindowDays,
            permanentThreshold: config.federationAvailabilityPermanentThreshold,
            minSamples: config.federationAvailabilityMinSamples,
        };

        for (const [key, peer] of activePeers) {
            // Per-peer stagger: skip this peer if not yet due
            const stagger = peerStaggerMs(config.nodeId, peer.nodeId, BASE_INTERVAL_MS);
            const cyclePhase = Date.now() % BASE_INTERVAL_MS;
            if (Math.abs(cyclePhase - stagger) > BASE_INTERVAL_MS * 0.3) continue;

            try {
                // A heartbeat says "I am up". `stats` says how many agents and actions this node
                // has and hashes its catalogue, which is discovery data: a peer we share no
                // catalogue with should not be counting our people. Liveness is still sent, because
                // deliverDirectMessage refuses an offline peer and a contact link needs to work.
                const payload = {
                    node_id: config.nodeId,
                    timestamp: new Date().toISOString(),
                    version: 'v1',
                    software_version: getSoftwareVersion(),
                    stats: peer.shareCatalogue === false ? {
                        uptime_hours: (Date.now() - startedAt) / 3_600_000,
                    } : {
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
                    recordHeartbeatOutcome(peer, true, new Date(), availOpts);
                    storage.saveFederationPeer(peer).catch(err => { logger.warn('uptime_hours: continuing after a suppressed failure', { error: String(err) }); });

                    // Detect catalogue hash mismatch for sync triggering
                    const cachedHash = peerCatalogueHashes.get(key);
                    if (cachedHash && cachedHash !== catalogueHash) {
                        logger.info(`Catalogue hash changed for peer ${peer.nodeId}, sync may be needed`);
                    }
                    peerCatalogueHashes.set(key, catalogueHash);

                    // ── Network directory: detect service summary hash changes ──
                    if (networkDirectory && peer.shareCatalogue && peer.peerMode !== 'private') {
                        try {
                            const pingBody = await resp.json() as {
                                data?: { service_summary_hash?: string };
                            };
                            const remoteSummaryHash = pingBody?.data?.service_summary_hash;

                            if (remoteSummaryHash) {
                                const cachedSummaryHash = peerSummaryHashes.get(key);

                                if (cachedSummaryHash !== remoteSummaryHash) {
                                    // Hash changed or first time -- fetch full summary
                                    logger.info(`Service summary hash changed for peer ${peer.nodeId}, fetching summary`);
                                    try {
                                        const summaryResp = await fetch(
                                            `${peer.url}/v1/federation/service-summary`,
                                            {
                                                headers: {
                                                    'Accept': 'application/json',
                                                    'x-source-node': config.nodeId,
                                                },
                                                signal: AbortSignal.timeout(TIMEOUT_MS),
                                            },
                                        );

                                        if (summaryResp.ok) {
                                            const summaryBody = await summaryResp.json() as {
                                                data?: ServiceSummary;
                                            };

                                            if (summaryBody?.data) {
                                                networkDirectory.set(key, summaryBody.data);
                                                peerSummaryHashes.set(key, remoteSummaryHash);
                                                logger.info(`Updated network directory for peer ${peer.nodeId}`, {
                                                    actions: summaryBody.data.actions?.length ?? 0,
                                                    agents: summaryBody.data.agents?.length ?? 0,
                                                    boards: summaryBody.data.boards?.length ?? 0,
                                                    csms: summaryBody.data.csms?.length ?? 0,
                                                });
                                            }
                                        }
                                    } catch (summaryErr) {
                                        logger.warn(`Failed to fetch service summary from peer ${peer.nodeId}`, {
                                            error: summaryErr instanceof Error ? summaryErr.message : String(summaryErr),
                                        });
                                    }
                                }
                            }
                        } catch (err) {
                            // Non-critical: ping response parse error for summary hash
                          logger.warn('uptime_hours: continuing after a suppressed failure', { error: String(err) });
                        }
                    }

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
                        networkDirectory?.delete(key);
                        peerSummaryHashes.delete(key);
                        logger.warn(`Peer ${peer.nodeId} offline after ${failures} consecutive failures`);
                    } else if (failures >= 3) {
                        peer.status = 'degraded';
                        logger.warn(`Peer ${peer.nodeId} degraded after ${failures} consecutive failures`);
                    }
                    recordHeartbeatOutcome(peer, false, new Date(), availOpts);
                    storage.saveFederationPeer(peer).catch(err => { logger.warn('failures: continuing after a suppressed failure', { error: String(err) }); });
                }
            } catch {
                const failures = (peerFailures.get(key) ?? 0) + 1;
                peerFailures.set(key, failures);
                if (failures >= 10) {
                    peer.status = 'offline';
                    networkDirectory?.delete(key);
                    peerSummaryHashes.delete(key);
                    logger.warn(`Peer ${peer.nodeId} offline after ${failures} consecutive failures`);
                } else if (failures >= 3) {
                    peer.status = 'degraded';
                }
                recordHeartbeatOutcome(peer, false, new Date(), availOpts);
                storage.saveFederationPeer(peer).catch(err => { logger.warn('failures: continuing after a suppressed failure', { error: String(err) }); });
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
