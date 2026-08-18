/**
 * @file src/services/trust-broadcast.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Trust Advisory Broadcast Service (RFC v1.5 §13.5) — signs a trust advisory
 *   (warning/suspend/ban) with the node's Ed25519 key and POSTs it to every active federation peer,
 *   with each outbound URL validated by safeFetch-style URL checks, returning a per-peer delivery report.
 *
 * @structure
 *   - TrustAdvisory: signed advisory shape (target node, type, reason, issuer, timestamp, signature)
 *   - BroadcastResult: aggregate delivery report (per-peer success/failure counts)
 *   - broadcastTrustAdvisory: builds, signs, and fans out the advisory to all peers
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */

import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { sign } from '../auth/keypair.js';
import { validateOutboundUrl } from '../utils/url-validator.js';
import { logger } from '../utils/logger.js';

export interface TrustAdvisory {
  target_node: string;
  advisory_type: 'warning' | 'suspend' | 'ban';
  reason: string;
  evidence_hash?: string;
  issued_by: string;
  timestamp: string;
  signature?: string;
}

export interface BroadcastResult {
  advisory: TrustAdvisory;
  deliveries: Array<{
    peer_node_id: string;
    success: boolean;
    error?: string;
  }>;
  total_peers: number;
  successful: number;
  failed: number;
}

/**
 * Broadcast a trust advisory to all active federation peers.
 * Signs the advisory with the node's Ed25519 key and POSTs to each peer.
 */
export async function broadcastTrustAdvisory(
  advisory: Omit<TrustAdvisory, 'issued_by' | 'timestamp' | 'signature'>,
  config: AimeatConfig,
  storage: Storage,
  peers: Map<string, PeerInfo>,
): Promise<BroadcastResult> {
  const now = new Date().toISOString();
  const fullAdvisory: TrustAdvisory = {
    ...advisory,
    issued_by: config.nodeId,
    timestamp: now,
  };

  // Sign the advisory with node key
  const nodeKey = await storage.getNodeKey();
  if (nodeKey?.privateKey) {
    const payloadToSign = JSON.stringify({
      target_node: fullAdvisory.target_node,
      advisory_type: fullAdvisory.advisory_type,
      reason: fullAdvisory.reason,
      evidence_hash: fullAdvisory.evidence_hash,
      issued_by: fullAdvisory.issued_by,
      timestamp: fullAdvisory.timestamp,
    });
    fullAdvisory.signature = await sign(nodeKey.privateKey, payloadToSign);
  }

  const activePeers = [...peers.values()].filter(p => p.status === 'active');
  const deliveries: BroadcastResult['deliveries'] = [];
  let successful = 0;
  let failed = 0;

  for (const peer of activePeers) {
    try {
      // SSRF validation
      const urlCheck = await validateOutboundUrl(peer.url);
      if (!urlCheck.valid) {
        deliveries.push({ peer_node_id: peer.nodeId, success: false, error: `SSRF blocked: ${urlCheck.reason}` });
        failed++;
        continue;
      }

      const resp = await fetch(`${peer.url}/v1/federation/trust-advisory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullAdvisory),
        signal: AbortSignal.timeout(config.federationTimeoutMs),
      });

      if (resp.ok) {
        deliveries.push({ peer_node_id: peer.nodeId, success: true });
        successful++;
        logger.info(`Trust advisory delivered to peer ${peer.nodeId}`, {
          advisory_type: fullAdvisory.advisory_type,
          target_node: fullAdvisory.target_node,
        });
      } else {
        // eslint-disable-next-line aimeat/no-silent-catch -- the body is read only to enrich an error message that is already being reported; an unreadable body is honestly reported as empty
        const body = await resp.text().catch(() => '');
        deliveries.push({ peer_node_id: peer.nodeId, success: false, error: `HTTP ${resp.status}: ${body}` });
        failed++;
        logger.warn(`Trust advisory delivery failed to peer ${peer.nodeId}: HTTP ${resp.status}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      deliveries.push({ peer_node_id: peer.nodeId, success: false, error: msg });
      failed++;
      logger.warn(`Trust advisory delivery error to peer ${peer.nodeId}: ${msg}`);
    }
  }

  logger.info('Trust advisory broadcast completed', {
    target_node: fullAdvisory.target_node,
    advisory_type: fullAdvisory.advisory_type,
    total_peers: activePeers.length,
    successful,
    failed,
  });

  return {
    advisory: fullAdvisory,
    deliveries,
    total_peers: activePeers.length,
    successful,
    failed,
  };
}

/**
 * Enqueue a trust advisory to the replication queue for reliable delivery.
 */
export async function enqueueTrustAdvisory(
  advisory: Omit<TrustAdvisory, 'issued_by' | 'timestamp' | 'signature'>,
  config: AimeatConfig,
  storage: Storage,
  peers: Map<string, PeerInfo>,
): Promise<string> {
  const activePeerIds = [...peers.values()]
    .filter(p => p.status === 'active')
    .map(p => p.nodeId);

  const id = await storage.enqueueReplication({
    type: 'trust_advisory',
    targetPeers: activePeerIds,
    payload: {
      ...advisory,
      issued_by: config.nodeId,
      timestamp: new Date().toISOString(),
    },
    createdAt: new Date().toISOString(),
  });

  return id;
}
