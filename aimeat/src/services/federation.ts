/**
 * Federation service — background heartbeat, GAII resolution cache,
 * and peer health monitoring.
 */

import type { MeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

/** Cache of resolved GAIIs to their hosting node URL. TTL: 5 minutes. */
const gaiiCache = new Map<string, { nodeId: string; nodeUrl: string; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60_000;

export interface PeerInfo {
  nodeId: string;
  url: string;
  publicKey: string;
  status: string;
  addedAt: string;
  lastSeen: string;
}

/**
 * Resolve which node hosts a GAII. Checks local cache first, then local storage,
 * then falls back to asking peers.
 */
export async function resolveGaii(
  gaii: string,
  config: MeatConfig,
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
    return { nodeId: config.nodeId, nodeUrl: `http://localhost:${config.port}`, local: true };
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

/**
 * Start background heartbeat job. Pings all active peers every 5 minutes
 * and marks unresponsive peers as degraded.
 */
export function startHeartbeatJob(
  config: MeatConfig,
  peers: Map<string, PeerInfo>,
): ReturnType<typeof setInterval> {
  const INTERVAL_MS = 5 * 60_000;
  const TIMEOUT_MS = 10_000;

  return setInterval(async () => {
    const activePeers = [...peers.entries()].filter(([, p]) => p.status === 'active' || p.status === 'degraded');
    if (activePeers.length === 0) return;

    for (const [key, peer] of activePeers) {
      try {
        const resp = await fetch(`${peer.url}/v1/federation/ping`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from_node: config.nodeId }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (resp.ok) {
          peer.lastSeen = new Date().toISOString();
          peer.status = 'active';
        } else {
          peer.status = 'degraded';
          logger.warn(`Peer ${peer.nodeId} returned HTTP ${resp.status}`);
        }
      } catch (err) {
        const lastSeenMs = new Date(peer.lastSeen).getTime();
        const offlineMinutes = (Date.now() - lastSeenMs) / 60_000;

        if (offlineMinutes > 60) {
          peer.status = 'offline';
          logger.warn(`Peer ${peer.nodeId} offline for ${Math.round(offlineMinutes)} minutes`);
        } else {
          peer.status = 'degraded';
        }
      }
    }
  }, INTERVAL_MS);
}
