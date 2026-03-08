/**
 * Genesis Sync Service — real catalogue exchange with cross-federation peers.
 * Per RFC v1.6 §13.11.7 (genesis sync) — replaces the Phase 3.4 stub.
 *
 * E.1: Fetches catalogues from active genesis peers, stores entries with
 *      `genesis:{genesisNodeId}:{entryId}` prefix, removes stale entries,
 *      and pushes local federable CSMs to peers.
 * E.3: Memory prefix subscriptions — syncs matching memory entries to peers.
 */

import type { AimeatConfig } from '../config.js';
import type { Storage, GenesisPeerRecord } from '../storage/interface.js';
import { computeCatalogueHash } from '../utils/catalogue-hash.js';
import { validateOutboundUrl } from '../utils/url-validator.js';
import { sign } from '../auth/keypair.js';
import { logger } from '../utils/logger.js';

/** System GAII used to store genesis catalogue entries as memory. */
const GENESIS_SYSTEM_GAII = '__genesis__';

export interface GenesisSyncResult {
  peersChecked: number;
  peersUpdated: number;
  peersFailed: number;
  entriesFetched: number;
  entriesStored: number;
  entriesRemoved: number;
  memorySubscriptionsSent: number;
  catalogueHash: string;
  syncedAt: string;
}

export interface GenesisSyncService {
  start(): NodeJS.Timeout;
  stop(): void;
  syncNow(): Promise<GenesisSyncResult>;
}

export function createGenesisSyncService(config: AimeatConfig, storage: Storage): GenesisSyncService | null {
  if (!config.crossFederationEnabled) {
    logger.info('Genesis sync disabled');
    return null;
  }

  let intervalTimer: NodeJS.Timeout | null = null;

  /**
   * Fetch catalogue from a genesis peer's cross-catalogue endpoint.
   */
  async function fetchPeerCatalogue(peer: GenesisPeerRecord): Promise<{
    entries: Array<Record<string, unknown>>;
    catalogueHash?: string;
    error?: string;
  }> {
    try {
      const urlCheck = await validateOutboundUrl(peer.genesisUrl);
      if (!urlCheck.valid) {
        return { entries: [], error: `SSRF blocked: ${urlCheck.reason}` };
      }

      const resp = await fetch(`${peer.genesisUrl}/v1/federation/cross-catalogue`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(config.federationTimeoutMs),
      });

      if (!resp.ok) {
        return { entries: [], error: `HTTP ${resp.status}` };
      }

      const body = await resp.json() as {
        data?: {
          entries?: Array<Record<string, unknown>>;
          catalogue_hash?: string;
        };
      };

      return {
        entries: body.data?.entries ?? [],
        catalogueHash: body.data?.catalogue_hash,
      };
    } catch (err) {
      return {
        entries: [],
        error: err instanceof Error ? err.message : 'unknown error',
      };
    }
  }

  /**
   * Push local federable CSMs to a genesis peer via POST.
   */
  async function pushLocalCatalogue(peer: GenesisPeerRecord): Promise<{ success: boolean; error?: string }> {
    try {
      const urlCheck = await validateOutboundUrl(peer.genesisUrl);
      if (!urlCheck.valid) {
        return { success: false, error: `SSRF blocked: ${urlCheck.reason}` };
      }

      const csms = await storage.listCsms();
      const federableCsms = csms.filter(c => c.federate === true);

      const allActions = await storage.listActions();
      const federableActions = allActions.filter(action =>
        federableCsms.some(csm => {
          const def = csm.definition as { service?: { type?: string } };
          return action.category === def?.service?.type || action.tags.includes(`csm:${csm.name}`);
        }) || action.tags.some(t => t.startsWith('federate:')),
      );

      const catalogueHash = await computeCatalogueHash(storage);

      const payload = {
        source_node: config.nodeId,
        entries: federableActions.map(a => ({
          id: a.id,
          type: 'action',
          provider_gaii: a.providerGaii,
          display_name: a.displayName,
          description: a.description,
          category: a.category,
          pricing: {
            base_morsels: a.pricing.baseMorsels,
            per_unit: a.pricing.perUnit,
          },
          tags: a.tags,
          semantic: a.semantic,
        })),
        csms: federableCsms.map(c => ({
          name: c.name,
          service_type: c.serviceType,
        })),
        catalogue_hash: catalogueHash,
      };

      // Sign the push payload
      const nodeKey = await storage.getNodeKey();
      let pushSignature: string | undefined;
      if (nodeKey?.privateKey) {
        pushSignature = await sign(nodeKey.privateKey, JSON.stringify(payload));
      }

      const resp = await fetch(`${peer.genesisUrl}/v1/federation/genesis-catalogue-ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, signature: pushSignature }),
        signal: AbortSignal.timeout(config.federationTimeoutMs),
      });

      // 404 is acceptable — peer may not support ingest endpoint yet
      if (resp.status === 404) {
        return { success: true }; // graceful degradation
      }

      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        return { success: false, error: `HTTP ${resp.status}: ${body}` };
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'unknown error' };
    }
  }

  /**
   * Store fetched genesis catalogue entries as memory records.
   * Returns count of new/updated entries.
   */
  async function storeGenesisEntries(
    peerId: string,
    entries: Array<Record<string, unknown>>,
  ): Promise<{ stored: number; removed: number }> {
    const now = new Date().toISOString();
    const genesisPrefix = `genesis:${peerId}:`;
    let stored = 0;

    // Build set of incoming entry keys for stale detection
    const incomingKeys = new Set<string>();

    // Ensure system GAII agent exists
    const agents = await storage.listAgents();
    const systemAgent = agents.find(a => a.gaii === GENESIS_SYSTEM_GAII);
    if (!systemAgent) {
      try {
        await storage.createAgent({
          name: '__genesis__',
          owner: '__system__',
          gaii: GENESIS_SYSTEM_GAII,
          publicKey: '',
          displayName: 'Genesis Sync System',
          capabilities: ['genesis-sync'],
          createdAt: now,
          lastSeen: now,
          trustScore: 100,
          morselBalance: 0,
        });
      } catch {
        // Agent may already exist from another concurrent sync
      }
    }

    for (const entry of entries) {
      const entryId = (entry.id ?? entry.name ?? `entry-${stored}`) as string;
      const key = `${genesisPrefix}${entryId}`;
      incomingKeys.add(key);

      await storage.setMemory({
        key,
        ownerGaii: GENESIS_SYSTEM_GAII,
        value: {
          ...entry,
          source_genesis: peerId,
          fetched_at: now,
        },
        visibility: 'public',
        tags: ['genesis', `genesis:${peerId}`],
        ttlHours: config.genesisMemoryCacheTtlHours || null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      stored++;
    }

    // Remove stale entries: keys with this genesis prefix that are no longer in the remote catalogue
    let removed = 0;
    try {
      const existingEntries = await storage.listMemory(GENESIS_SYSTEM_GAII, { prefix: genesisPrefix });
      for (const existing of existingEntries) {
        if (!incomingKeys.has(existing.key)) {
          await storage.deleteMemory(GENESIS_SYSTEM_GAII, existing.key);
          removed++;
        }
      }
    } catch {
      // listMemory with prefix may not return results if no entries exist yet
    }

    return { stored, removed };
  }

  /**
   * E.3: Sync memory entries matching subscribed prefixes to a genesis peer.
   * Reads `subscribe_memory_prefixes` from peer metadata (stored as memory).
   */
  async function syncSubscribedMemory(peer: GenesisPeerRecord): Promise<number> {
    // Check if peer has subscribed prefixes (stored in peer metadata)
    const subscriptionKey = `genesis:${peer.genesisNodeId}:subscriptions`;
    const subscriptionRecord = await storage.getMemory(GENESIS_SYSTEM_GAII, subscriptionKey);

    if (!subscriptionRecord) return 0;

    const subscriptions = subscriptionRecord.value as { prefixes?: string[] };
    if (!subscriptions.prefixes || subscriptions.prefixes.length === 0) return 0;

    let totalSent = 0;

    // Gather all agents' memories matching subscribed prefixes
    const agents = await storage.listAgents();

    for (const prefix of subscriptions.prefixes) {
      for (const agent of agents) {
        if (agent.gaii === GENESIS_SYSTEM_GAII) continue; // skip system agent

        try {
          const memories = await storage.listMemory(agent.gaii, { prefix, visibility: 'public' });

          for (const memory of memories) {
            // Skip federation-managed entries
            if (memory.key.startsWith('replica:') || memory.key.startsWith('federated:') ||
                memory.key.startsWith('genesis:') || memory.key.startsWith('expiring:') ||
                memory.key.includes('._conflict_')) {
              continue;
            }

            // Check for active federation consent
            const consents = await storage.listConsents(agent.gaii);
            const hasConsent = consents.some(c =>
              c.status === 'active' && c.scope === 'federation',
            );
            if (!hasConsent) continue;

            // Push to peer
            try {
              const urlCheck = await validateOutboundUrl(peer.genesisUrl);
              if (!urlCheck.valid) continue;

              const payload = {
                source_node: config.nodeId,
                source_genesis: config.nodeId,
                gaii: agent.gaii,
                key: memory.key,
                value: memory.value,
                visibility: memory.visibility,
                version: memory.version,
                timestamp: memory.updatedAt,
              };

              const nodeKey = await storage.getNodeKey();
              let memSig: string | undefined;
              if (nodeKey?.privateKey) {
                memSig = await sign(nodeKey.privateKey, JSON.stringify(payload));
              }

              await fetch(`${peer.genesisUrl}/v1/federation/replicate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...payload, signature: memSig }),
                signal: AbortSignal.timeout(config.federationTimeoutMs),
              });

              totalSent++;
            } catch {
              // Skip individual failures
            }
          }
        } catch {
          // Skip agent on error
        }
      }
    }

    return totalSent;
  }

  /**
   * Main sync cycle — fetches from peers, stores entries, pushes local catalogue.
   */
  async function syncNow(): Promise<GenesisSyncResult> {
    const activePeers = await storage.listGenesisPeers({ status: 'active' });
    const catalogueHash = await computeCatalogueHash(storage);
    const now = new Date().toISOString();

    let peersUpdated = 0;
    let peersFailed = 0;
    let totalFetched = 0;
    let totalStored = 0;
    let totalRemoved = 0;
    let totalMemorySubs = 0;

    for (const peer of activePeers) {
      try {
        // 1. Fetch catalogue from peer
        const fetchResult = await fetchPeerCatalogue(peer);

        if (fetchResult.error) {
          logger.warn(`Genesis sync: failed to fetch from ${peer.genesisNodeId}`, {
            error: fetchResult.error,
          });
          peersFailed++;
          continue;
        }

        totalFetched += fetchResult.entries.length;

        // 2. Store fetched entries locally with genesis: prefix
        const storeResult = await storeGenesisEntries(peer.genesisNodeId, fetchResult.entries);
        totalStored += storeResult.stored;
        totalRemoved += storeResult.removed;

        // 3. Push local federable catalogue to peer
        const pushResult = await pushLocalCatalogue(peer);
        if (!pushResult.success) {
          logger.warn(`Genesis sync: failed to push to ${peer.genesisNodeId}`, {
            error: pushResult.error,
          });
        }

        // 4. E.3: Sync subscribed memory prefixes
        const memorySent = await syncSubscribedMemory(peer);
        totalMemorySubs += memorySent;

        // 5. Update peer sync metadata
        await storage.updateGenesisPeer(peer.id, {
          lastSyncAt: now,
          catalogueHash: fetchResult.catalogueHash ?? catalogueHash,
          updatedAt: now,
        });
        peersUpdated++;
      } catch (err) {
        peersFailed++;
        logger.warn(`Genesis sync: error syncing with ${peer.genesisNodeId}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info('Genesis sync completed', {
      peersChecked: activePeers.length,
      peersUpdated,
      peersFailed,
      entriesFetched: totalFetched,
      entriesStored: totalStored,
      entriesRemoved: totalRemoved,
      memorySubscriptionsSent: totalMemorySubs,
    });

    return {
      peersChecked: activePeers.length,
      peersUpdated,
      peersFailed,
      entriesFetched: totalFetched,
      entriesStored: totalStored,
      entriesRemoved: totalRemoved,
      memorySubscriptionsSent: totalMemorySubs,
      catalogueHash,
      syncedAt: now,
    };
  }

  return {
    start() {
      const intervalHours = config.genesisSyncIntervalHours;
      logger.info('Genesis sync scheduler started', { intervalHours });

      // Recurring sync with jitter (±25% to prevent thundering herd)
      const baseMs = intervalHours * 3_600_000;

      function scheduleNext(): void {
        const jitter = baseMs * 0.25 * (Math.random() * 2 - 1);
        const nextMs = Math.max(60_000, baseMs + jitter);
        intervalTimer = setTimeout(() => {
          syncNow().catch(err => {
            logger.error('Genesis sync failed', { error: (err as Error).message });
          }).finally(() => {
            scheduleNext();
          });
        }, nextMs);
      }

      // Initial sync 30s after start (allow server startup to complete)
      const initialTimer = setTimeout(() => {
        syncNow().catch(err => {
          logger.error('Genesis initial sync failed', { error: (err as Error).message });
        });
      }, 30_000);

      scheduleNext();

      return initialTimer;
    },

    stop() {
      if (intervalTimer) {
        clearTimeout(intervalTimer);
        intervalTimer = null;
      }
    },

    syncNow,
  };
}
