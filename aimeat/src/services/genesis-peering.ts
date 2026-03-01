import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, GenesisPeerRecord } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

export interface GenesisPeeringService {
  requestPeering(genesisNodeId: string, genesisUrl: string, publicKey: string): Promise<GenesisPeerRecord>;
  approvePeering(id: string): Promise<GenesisPeerRecord | null>;
  suspendPeering(id: string): Promise<GenesisPeerRecord | null>;
  removePeering(id: string): Promise<boolean>;
  getCrossCatalogue(): Promise<Record<string, unknown>[]>;
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

    async getCrossCatalogue() {
      // Aggregate catalogues from all active genesis peers
      const activePeers = await storage.listGenesisPeers({ status: 'active' });
      const catalogues: Record<string, unknown>[] = [];

      // Add local catalogue entries
      const localCsms = await storage.listCsms();
      for (const csm of localCsms) {
        catalogues.push({
          type: 'csm',
          name: csm.name,
          serviceType: csm.serviceType,
          sourceNode: config.nodeId,
          federated: true,
        });
      }

      // Add entries from active peers (in production, these would be fetched via sync)
      for (const peer of activePeers) {
        catalogues.push({
          type: 'genesis_peer',
          nodeId: peer.genesisNodeId,
          url: peer.genesisUrl,
          status: peer.status,
          lastSyncAt: peer.lastSyncAt,
        });
      }

      return catalogues;
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
