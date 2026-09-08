/**
 * @file src/services/genesis-peering.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Service managing cross-federation "genesis" peerings — request/approve/suspend/remove
 *   peer records, and compute network-reach statistics. The cross-node catalogue is aggregated by
 *   the route (routes/federation-genesis.ts), not here.
 *
 * @structure
 *   - GenesisPeeringService: interface for the peering lifecycle + stats read
 *   - createGenesisPeeringService(config, storage): implementation enforcing maxGenesisPeers + uniqueness
 *   - getNetworkStats: totals peers/organisms/owners/agents and derives networkReach
 *
 * @version-history
 *   v1.1.0 — 2026-09-08 — getCrossCatalogue removed: no caller, the route builds its own aggregate.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, GenesisPeerRecord } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

export interface GenesisPeeringService {
  requestPeering(genesisNodeId: string, genesisUrl: string, publicKey: string): Promise<GenesisPeerRecord>;
  approvePeering(id: string): Promise<GenesisPeerRecord | null>;
  suspendPeering(id: string): Promise<GenesisPeerRecord | null>;
  removePeering(id: string): Promise<boolean>;
  getNetworkStats(): Promise<Record<string, unknown>>;
}

export function createGenesisPeeringService(config: AimeatConfig, storage: Storage): GenesisPeeringService {
  return {
    async requestPeering(genesisNodeId, genesisUrl, publicKey) {
      const existing = await storage.getGenesisPeerByNodeId(genesisNodeId);
      if (existing) {
        throw new Error('Peering already exists with this node');
      }
      const peers = await storage.listGenesisPeers();
      if (peers.length >= config.maxGenesisPeers) {
        throw new Error('Maximum genesis peers reached');
      }
      const now = new Date().toISOString();
      logger.info(`Genesis peering requested from ${genesisNodeId} at ${genesisUrl}`);
      return storage.createGenesisPeer({
        id: randomUUID(),
        genesisNodeId,
        genesisUrl,
        publicKey,
        status: 'pending',
        lastSyncAt: now,
        catalogueHash: '',
        createdAt: now,
        updatedAt: now,
      });
    },

    async approvePeering(id) {
      return storage.updateGenesisPeer(id, {
        status: 'active',
        updatedAt: new Date().toISOString(),
      });
    },

    async suspendPeering(id) {
      return storage.updateGenesisPeer(id, {
        status: 'suspended',
        updatedAt: new Date().toISOString(),
      });
    },

    async removePeering(id) {
      return storage.deleteGenesisPeer(id);
    },

    async getNetworkStats() {
      const peers = await storage.listGenesisPeers();
      const activePeers = peers.filter(p => p.status === 'active');
      const organisms = await storage.listOrganisms();
      const owners = await storage.listOwners();
      const agents = await storage.listAgents();

      return {
        localNode: config.nodeId,
        totalGenesisPeers: peers.length,
        activeGenesisPeers: activePeers.length,
        localOrganisms: organisms.length,
        localOwners: owners.length,
        localAgents: agents.length,
        networkReach: activePeers.length + 1, // +1 for self
        lastUpdated: new Date().toISOString(),
      };
    },
  };
}
