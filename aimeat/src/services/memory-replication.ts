/**
 * Memory Replication Service — consent-based memory replication to federation peers.
 * Per RFC v1.6 §13.11.4 (replication protocol) and §13.11.5 (queue).
 */

import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { sign } from '../auth/keypair.js';
import { validateOutboundUrl } from '../utils/url-validator.js';
import { logger } from '../utils/logger.js';

export interface ReplicationResult {
  peer_node_id: string;
  entries_sent: number;
  entries_failed: number;
  consent_denied: number;
  success: boolean;
  error?: string;
}

/** Per-key per-peer replication tracking. */
const replicationState = new Map<string, string>(); // `${peerId}:${gaii}:${key}` → lastSyncAt

function replicationTrackingKey(peerId: string, gaii: string, key: string): string {
  return `${peerId}:${gaii}:${key}`;
}

/**
 * Check if a memory entry is eligible for federation replication.
 * Requirements:
 * 1. visibility: 'public'
 * 2. Active consent with scope 'federation' exists
 */
export async function isEligibleForReplication(
  storage: Storage,
  ownerGaii: string,
  key: string,
): Promise<{ eligible: boolean; consentId?: string }> {
  // Get the memory entry
  const memory = await storage.getMemory(ownerGaii, key);
  if (!memory) return { eligible: false };

  // Must be public visibility
  if (memory.visibility !== 'public') return { eligible: false };

  // Check for active federation consent
  const consents = await storage.listConsents(ownerGaii);
  const federationConsent = consents.find(c =>
    c.status === 'active' &&
    c.scope === 'federation' &&
    matchesPattern(key, c.dataPattern),
  );

  if (!federationConsent) return { eligible: false };

  return { eligible: true, consentId: federationConsent.id };
}

/**
 * Simple glob pattern matching for consent data patterns.
 * Supports: exact match, * (single segment), ** (multi-segment)
 */
function matchesPattern(key: string, pattern: string): boolean {
  if (pattern === '*') return true;
  if (pattern === key) return true;

  // Convert glob to regex
  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '##DOUBLE##')
    .replace(/\*/g, '[^.]*')
    .replace(/##DOUBLE##/g, '.*');

  try {
    return new RegExp(`^${regexStr}$`).test(key);
  } catch {
    return key === pattern;
  }
}

/**
 * Replicate a single memory entry to a specific peer.
 */
export async function replicateMemoryToPeer(
  peer: PeerInfo,
  ownerGaii: string,
  key: string,
  config: AimeatConfig,
  storage: Storage,
): Promise<{ success: boolean; error?: string }> {
  const memory = await storage.getMemory(ownerGaii, key);
  if (!memory) return { success: false, error: 'Memory entry not found' };

  // Check eligibility
  const eligibility = await isEligibleForReplication(storage, ownerGaii, key);
  if (!eligibility.eligible) {
    return { success: false, error: 'Entry not eligible for replication' };
  }

  try {
    const urlCheck = await validateOutboundUrl(peer.url);
    if (!urlCheck.valid) {
      return { success: false, error: `SSRF blocked: ${urlCheck.reason}` };
    }

    const payload = {
      source_node: config.nodeId,
      gaii: ownerGaii,
      key,
      value: memory.value,
      visibility: memory.visibility,
      version: memory.version,
      timestamp: memory.updatedAt,
      consent_ref: eligibility.consentId,
    };

    // Sign the payload
    const nodeKey = await storage.getNodeKey();
    let replicateSignature: string | undefined;
    if (nodeKey?.privateKey) {
      const signPayload = JSON.stringify({
        source_node: payload.source_node,
        gaii: payload.gaii,
        key: payload.key,
        value: payload.value,
        visibility: payload.visibility,
        version: payload.version,
        timestamp: payload.timestamp,
      });
      replicateSignature = await sign(nodeKey.privateKey, signPayload);
    }

    const resp = await fetch(`${peer.url}/v1/federation/replicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, signature: replicateSignature }),
      signal: AbortSignal.timeout(config.federationTimeoutMs),
    });

    if (resp.ok) {
      // Track successful replication
      const trackKey = replicationTrackingKey(peer.nodeId, ownerGaii, key);
      replicationState.set(trackKey, new Date().toISOString());
      return { success: true };
    } else {
      const body = await resp.text().catch(() => '');
      return { success: false, error: `HTTP ${resp.status}: ${body}` };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'unknown error' };
  }
}

/**
 * Replicate all eligible memories to all active peers.
 * Called during scheduled sync cycles.
 */
export async function replicateMemoryToAllPeers(
  config: AimeatConfig,
  storage: Storage,
  peers: Map<string, PeerInfo>,
): Promise<ReplicationResult[]> {
  const activePeers = [...peers.values()].filter(p => p.status === 'active');
  if (activePeers.length === 0) return [];

  // Gather all agents and their memory entries
  const agents = await storage.listAgents();
  const results: ReplicationResult[] = [];

  for (const peer of activePeers) {
    let entriesSent = 0;
    let entriesFailed = 0;
    let consentDenied = 0;

    for (const agent of agents) {
      try {
        const memories = await storage.listMemory(agent.gaii, {});
        const publicMemories = memories.filter(m => m.visibility === 'public');

        for (const memory of publicMemories) {
          // Skip federation-managed entries
          if (memory.key.startsWith('replica:') || memory.key.startsWith('federated:') ||
              memory.key.startsWith('genesis:') || memory.key.startsWith('expiring:') ||
              memory.key.includes('._conflict_')) {
            continue;
          }

          // Check if already synced and unchanged
          const trackKey = replicationTrackingKey(peer.nodeId, agent.gaii, memory.key);
          const lastSync = replicationState.get(trackKey);
          if (lastSync && new Date(lastSync) >= new Date(memory.updatedAt)) {
            continue; // Already synced, no changes
          }

          // Check eligibility
          const eligibility = await isEligibleForReplication(storage, agent.gaii, memory.key);
          if (!eligibility.eligible) {
            consentDenied++;
            continue;
          }

          // Replicate
          const result = await replicateMemoryToPeer(peer, agent.gaii, memory.key, config, storage);
          if (result.success) {
            entriesSent++;
          } else {
            entriesFailed++;
          }
        }
      } catch {
        // Skip agent on error
      }
    }

    results.push({
      peer_node_id: peer.nodeId,
      entries_sent: entriesSent,
      entries_failed: entriesFailed,
      consent_denied: consentDenied,
      success: entriesFailed === 0,
    });

    if (entriesSent > 0 || entriesFailed > 0) {
      logger.info(`Memory replication to peer ${peer.nodeId}`, {
        sent: entriesSent,
        failed: entriesFailed,
        consent_denied: consentDenied,
      });
    }
  }

  return results;
}

/**
 * Enqueue a memory entry for replication via the replication queue.
 * Called from memory write handlers when an eligible entry is created/updated.
 */
export async function enqueueMemoryReplication(
  ownerGaii: string,
  key: string,
  config: AimeatConfig,
  storage: Storage,
  peers: Map<string, PeerInfo>,
): Promise<void> {
  // Only in instant or hybrid mode
  if (config.syncMode === 'bulk') return;

  const eligibility = await isEligibleForReplication(storage, ownerGaii, key);
  if (!eligibility.eligible) return;

  const activePeerIds = [...peers.values()]
    .filter(p => p.status === 'active')
    .map(p => p.nodeId);

  if (activePeerIds.length === 0) return;

  await storage.enqueueReplication({
    type: 'memory_replicate',
    targetPeers: activePeerIds,
    payload: { gaii: ownerGaii, key, consent_ref: eligibility.consentId },
    createdAt: new Date().toISOString(),
  });
}
