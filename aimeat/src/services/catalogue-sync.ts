/**
 * @file src/services/catalogue-sync.ts
 * @description Catalogue Sync Service — outbound diff-based catalogue push to
 *   federation peers (RFC v1.6 §13.11.3 delta sync, §13.11.6 triggering). Tracks
 *   per-peer sync state, computes catalogue hashes, and signs payloads with the node
 *   Ed25519 key before POSTing federable CSMs to each peer.
 *
 * @structure
 *   - PeerSyncState / getPeerSyncState / resetPeerSyncState: in-memory per-peer sync tracking
 *   - CatalogueSyncResult: shape of a per-peer sync outcome
 *   - syncCatalogueToPeer(peer, config, storage): diff, hash, sign, and push to one peer
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */

import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { sign } from '../auth/keypair.js';
import { computeCatalogueHash } from '../utils/catalogue-hash.js';
import { validateOutboundUrl } from '../utils/url-validator.js';
import { logger } from '../utils/logger.js';

/** Per-peer sync metadata. */
export interface PeerSyncState {
  lastSyncAt: string | null;
  lastCatalogueHash: string | null;
  consecutiveFailures: number;
  lastError: string | null;
}

/** In-memory sync state per peer. */
const peerSyncStates = new Map<string, PeerSyncState>();

/** Get sync state for a peer (creates default if missing). */
export function getPeerSyncState(peerId: string): PeerSyncState {
  let state = peerSyncStates.get(peerId);
  if (!state) {
    state = { lastSyncAt: null, lastCatalogueHash: null, consecutiveFailures: 0, lastError: null };
    peerSyncStates.set(peerId, state);
  }
  return state;
}

/** Reset sync state for a peer (e.g. after re-peering). */
export function resetPeerSyncState(peerId: string): void {
  peerSyncStates.delete(peerId);
}

export interface CatalogueSyncResult {
  peer_node_id: string;
  entries_sent: number;
  incremental: boolean;
  catalogue_hash: string;
  success: boolean;
  resync_required: boolean;
  error?: string;
}

/**
 * Sync catalogue to a single peer.
 * 1. Read local CSMs where federate: true
 * 2. If lastSyncAt exists: only include entries with updatedAt > lastSyncAt
 * 3. Compute catalogue hash for verification
 * 4. Sign payload with node Ed25519 key
 * 5. POST to peer's /v1/federation/catalogue-sync
 */
export async function syncCatalogueToPeer(
  peer: PeerInfo,
  config: AimeatConfig,
  storage: Storage,
): Promise<CatalogueSyncResult> {
  const syncState = getPeerSyncState(peer.nodeId);
  const catalogueHash = await computeCatalogueHash(storage);

  try {
    // 1. Read local CSMs where federate: true
    const csms = await storage.listCsms();
    const federableCsms = csms.filter(c => c.federate === true);

    // 2. Gather all actions from federable CSMs
    const allActions = await storage.listActions();
    const federableActions = allActions.filter(action => {
      // Include actions from agents belonging to federable CSMs
      return federableCsms.some(csm => {
        const def = csm.definition as { service?: { type?: string } };
        return action.category === def?.service?.type || action.tags.includes(`csm:${csm.name}`);
      }) || action.tags.some(t => t.startsWith('federate:'));
    });

    // 3. Filter for delta sync if we have a lastSyncAt
    let actionsToSync = federableActions;
    const isIncremental = !!syncState.lastSyncAt;

    if (isIncremental) {
      const sinceDate = new Date(syncState.lastSyncAt!);
      actionsToSync = federableActions.filter(a => new Date(a.updatedAt) > sinceDate);
    }

    // 4. Build the payload
    const payload = {
      source_node: config.nodeId,
      actions: actionsToSync.map(a => ({
        id: a.id,
        provider_gaii: a.providerGaii,
        display_name: a.displayName,
        description: a.description,
        category: a.category,
        input_schema: a.inputSchema,
        output_schema: a.outputSchema,
        pricing: {
          base_morsels: a.pricing.baseMorsels,
          per_unit: a.pricing.perUnit,
        },
        tags: a.tags,
        semantic: a.semantic,
        created_at: a.createdAt,
        updated_at: a.updatedAt,
      })),
      since_timestamp: syncState.lastSyncAt,
      catalogue_hash: catalogueHash,
    };

    // 5. Sign the payload
    const nodeKey = await storage.getNodeKey();
    let payloadSignature: string | undefined;
    if (nodeKey?.privateKey) {
      const signPayload = JSON.stringify({
        source_node: payload.source_node,
        actions: payload.actions,
        since_timestamp: payload.since_timestamp,
        catalogue_hash: payload.catalogue_hash,
      });
      payloadSignature = await sign(nodeKey.privateKey, signPayload);
    }

    // 6. SSRF validation
    const urlCheck = await validateOutboundUrl(peer.url);
    if (!urlCheck.valid) {
      throw new Error(`SSRF blocked: ${urlCheck.reason}`);
    }

    // 7. POST to peer
    const resp = await fetch(`${peer.url}/v1/federation/catalogue-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, signature: payloadSignature }),
      signal: AbortSignal.timeout(config.federationTimeoutMs),
    });

    if (!resp.ok) {
      // eslint-disable-next-line aimeat/no-silent-catch -- the body is read only to enrich an error message that is already being reported; an unreadable body is honestly reported as empty
      const body = await resp.text().catch(() => '');
      throw new Error(`Peer returned HTTP ${resp.status}: ${body}`);
    }

    const responseData = await resp.json() as {
      data?: {
        synced?: number;
        updated?: number;
        resync_required?: boolean;
      };
    };

    const resyncRequired = responseData.data?.resync_required === true;

    // Update sync state on success
    syncState.lastSyncAt = new Date().toISOString();
    syncState.lastCatalogueHash = catalogueHash;
    syncState.consecutiveFailures = 0;
    syncState.lastError = null;

    logger.info(`Catalogue sync to peer ${peer.nodeId} completed`, {
      entries_sent: actionsToSync.length,
      incremental: isIncremental,
      synced: responseData.data?.synced,
      updated: responseData.data?.updated,
      resync_required: resyncRequired,
    });

    return {
      peer_node_id: peer.nodeId,
      entries_sent: actionsToSync.length,
      incremental: isIncremental,
      catalogue_hash: catalogueHash,
      success: true,
      resync_required: resyncRequired,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    syncState.consecutiveFailures++;
    syncState.lastError = msg;

    logger.warn(`Catalogue sync to peer ${peer.nodeId} failed`, {
      error: msg,
      consecutiveFailures: syncState.consecutiveFailures,
    });

    return {
      peer_node_id: peer.nodeId,
      entries_sent: 0,
      incremental: !!syncState.lastSyncAt,
      catalogue_hash: '',
      success: false,
      resync_required: false,
      error: msg,
    };
  }
}

/**
 * Sync catalogue to all active peers, respecting concurrent sync limit.
 */
export async function syncCatalogueToAllPeers(
  config: AimeatConfig,
  storage: Storage,
  peers: Map<string, PeerInfo>,
): Promise<CatalogueSyncResult[]> {
  const activePeers = [...peers.values()].filter(p => p.status === 'active');
  if (activePeers.length === 0) return [];

  const results: CatalogueSyncResult[] = [];
  const concurrency = config.maxConcurrentSyncs;

  // Process in batches of maxConcurrentSyncs
  for (let i = 0; i < activePeers.length; i += concurrency) {
    const batch = activePeers.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(peer => syncCatalogueToPeer(peer, config, storage)),
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);

        // If resync_required, queue a full resync by resetting state
        if (result.value.resync_required) {
          resetPeerSyncState(result.value.peer_node_id);
        }
      } else {
        results.push({
          peer_node_id: 'unknown',
          entries_sent: 0,
          incremental: false,
          catalogue_hash: '',
          success: false,
          resync_required: false,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    }
  }

  return results;
}

/**
 * Enqueue catalogue sync for a specific peer to the replication queue.
 */
export async function enqueueCatalogueSync(
  peerId: string,
  config: AimeatConfig,
  storage: Storage,
): Promise<string> {
  const id = await storage.enqueueReplication({
    type: 'catalogue_sync',
    targetPeers: [peerId],
    payload: { trigger: 'manual', timestamp: new Date().toISOString() },
    createdAt: new Date().toISOString(),
  });

  return id;
}
