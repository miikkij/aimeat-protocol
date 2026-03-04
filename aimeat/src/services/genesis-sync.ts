import { createHash } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

export interface GenesisSyncResult {
  peersChecked: number;
  peersUpdated: number;
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

  async function syncNow(): Promise<GenesisSyncResult> {
    const activePeers = await storage.listGenesisPeers({ status: 'active' });
    const localCsms = await storage.listCsms();

    // Compute catalogue hash: SHA-256 of sorted CSM names + service types
    const catalogueEntries = localCsms
      .map(csm => ({ name: csm.name, serviceType: csm.serviceType }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const catalogueHash = createHash('sha256')
      .update(JSON.stringify(catalogueEntries))
      .digest('hex');

    const now = new Date().toISOString();
    let peersUpdated = 0;

    for (const peer of activePeers) {
      await storage.updateGenesisPeer(peer.id, {
        lastSyncAt: now,
        catalogueHash,
        updatedAt: now,
      });
      peersUpdated++;
    }

    logger.info('Genesis sync completed', {
      peersChecked: activePeers.length,
      peersUpdated,
    });

    return {
      peersChecked: activePeers.length,
      peersUpdated,
      catalogueHash,
      syncedAt: now,
    };
  }

  return {
    start() {
      const intervalHours = config.genesisSyncIntervalHours;
      logger.info('Genesis sync scheduler started', { intervalHours });

      intervalTimer = setInterval(() => {
        syncNow().catch(err => {
          logger.error('Genesis sync failed', { error: (err as Error).message });
        });
      }, intervalHours * 3_600_000);

      // Initial sync 5s after start
      setTimeout(() => {
        syncNow().catch(err => {
          logger.error('Genesis initial sync failed', { error: (err as Error).message });
        });
      }, 5000);

      return intervalTimer;
    },

    stop() {
      if (intervalTimer) {
        clearInterval(intervalTimer);
        intervalTimer = null;
      }
    },

    syncNow,
  };
}
