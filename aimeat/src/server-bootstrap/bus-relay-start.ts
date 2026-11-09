/**
 * @file src/server-bootstrap/bus-relay-start.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Start the event bus between this node's processes (services/bus-relay.ts) with the
 *   registries each process keeps in memory, so a decision the operator made on one process is in
 *   force on all of them within the time a NOTIFY takes, and not at their next restart:
 *     federation peers   `federation`          services/federation-peer-reload.ts reloadPeers
 *     internet openings  `internet-openings`   services/internet-opening/opening-registry.ts refreshOpenings
 *     maintenance mode   `maintenance`         services/maintenance-cache.ts refresh (the 5 s re-read stays)
 *     stored settings    `config`              services/config-reload.ts
 *   Each registry was loaded at boot before this runs. On SQLite (one process per database) it starts
 *   nothing.
 * @structure startNodeBusRelay(deps)
 * @usage await startNodeBusRelay({ storage, config, peers, maintenance });   // initializeServices
 *   With several processes per node (node.processes = multiple) each registry also has a stored mark
 *   that a timer compares, so a lost event is made good within REGISTRY_RESYNC_MS.
 * @version-history
 *   v1.1.0 — 2026-11-08 — Several processes: registry marks and the resync timer (secaudit2026nov08 round 14).
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, HA stage 2, e2-bus).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import type { MaintenanceCache } from '../services/maintenance-cache.js';
import { startBusRelay, type RemoteReload } from '../services/bus-relay.js';
import { reloadPeers } from '../services/federation-peer-reload.js';
import { refreshOpenings } from '../services/internet-opening/opening-registry.js';
import { createStoredConfigReload } from '../services/config-reload.js';
import { singleProcess } from '../services/process-lease.js';
import { logger } from '../utils/logger.js';

export interface BusRelayDeps {
  storage: Storage;
  config: AimeatConfig;
  peers: Map<string, PeerInfo>;
  maintenance: MaintenanceCache;
}

/** Start the relay for this node, when its storage has a wire. Never throws: the node runs without it. */
export async function startNodeBusRelay(deps: BusRelayDeps): Promise<void> {
  const { storage, config, peers, maintenance } = deps;
  if (!storage.busWire) return;
  try {
    const settings = createStoredConfigReload(config, storage);
    await settings.prime();
    const reloads: RemoteReload[] = [
      { name: 'federation peers', domains: ['federation'], run: async () => { await reloadPeers(storage, peers, config.nodeId); } },
      { name: 'internet openings', domains: ['internet-openings'], run: () => refreshOpenings({ storage, config }) },
      { name: 'maintenance', domains: ['maintenance'], run: () => maintenance.refresh() },
      { name: 'settings', domains: ['config'], run: async () => { await settings.reload(); } },
    ];
    // Several processes per node: the registries also carry stored marks a timer compares, so a lost
    // event cannot keep a removed peer or a closed opening in force (services/bus-relay.ts).
    await startBusRelay(storage, config.nodeId, reloads, { severalProcesses: !singleProcess(config) });
  } catch (err) {
    logger.error('bus: the event bus between this node\'s processes did not start; this process runs on its own', { error: String(err) });
  }
}
