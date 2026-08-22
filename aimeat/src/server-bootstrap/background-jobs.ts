/**
 * @file src/server-bootstrap/background-jobs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Everything the node starts running for itself once the routes are mounted: the
 *   scheduler and its seeded jobs, the workflow engine's watchdog, genesis sync, cache cleanup,
 *   catalogue/memory sync, the cross-node message retry, and the tracked-response registry.
 *
 *   WHY IT IS NOT IN routes-loader.ts. None of this mounts a route. It sat there because it had to
 *   run after the routers and that file was where the wiring already was, and it grew until the
 *   file hit the 800-line ceiling and the next route could not be added without moving something.
 *   This is that move: the code is unchanged, the order is unchanged, only its home is different.
 *
 *   ORDER IS LOAD-BEARING IN ONE PLACE. The extension-schedule backfill is awaited BEFORE
 *   scheduler.start(), because the first thing start() does is fire every @activate job on the
 *   node, and a job stored before its owner scope was stamped refuses at run time. Everything else
 *   here is independent and fire-and-forget.
 * @structure BackgroundJobDeps · startBackgroundJobs(deps)
 * @usage
 *   import { startBackgroundJobs } from './background-jobs.js';
 *   startBackgroundJobs({ config, storage, peers, scheduler, workflowEngine, webhookDispatcher,
 *                         pushService, emailService });
 * @version-history
 *   v1.0.0 — 2026-08-22 — Pure extraction from routes-loader.ts (which was at the line ceiling).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import type { Scheduler } from '../services/scheduler.js';
import type { WorkflowEngine } from '../services/workflow/engine.js';
import type { createWebhookDispatcher } from '../services/webhook-dispatcher.js';
import type { createPushService } from '../services/push.js';
import type { createEmailService } from '../services/email.js';
import { logger } from '../utils/logger.js';
import { createGenesisSyncService } from '../services/genesis-sync.js';
import { startCacheCleanupJob } from '../services/cache-cleanup.js';
import { startSyncScheduler } from '../services/sync-scheduler.js';
import { startMessageRetryJob } from '../services/message-delivery.js';
import { startTrackedResponseReconciler, evaluateTrackedKey } from '../services/tracked-response.js';
import { rebuildTrackRegistry, isTracked } from '../services/track-registry.js';
import { onMemoryWrittenEvent } from '../services/event-bus.js';
import { seedCoreScheduledJobs } from '../services/job-seeding.js';
import { backfillExtensionJobOwnerScope } from '../services/extension-schedules.js';

export interface BackgroundJobDeps {
  config: AimeatConfig;
  storage: Storage;
  peers: Map<string, PeerInfo>;
  scheduler: Scheduler;
  workflowEngine: WorkflowEngine;
  webhookDispatcher: ReturnType<typeof createWebhookDispatcher>;
  pushService: ReturnType<typeof createPushService>;
  emailService: ReturnType<typeof createEmailService>;
}

/** Start the node's own recurring work. Called from mountRoutes() after the routers are up. */
export function startBackgroundJobs(deps: BackgroundJobDeps): void {
  const {
    config, storage, peers, scheduler, workflowEngine,
    webhookDispatcher, pushService, emailService,
  } = deps;

  // Seed core scheduled jobs (idempotent — only creates if not already present)
  seedCoreScheduledJobs(config, storage).catch(err =>
    logger.error('Failed to seed core scheduled jobs', { error: String(err) }));

  // Wire dispatch + notification deps for ai/agent_task schedules before start.
  scheduler.setWebhookDispatcher(webhookDispatcher);
  scheduler.setPushService(pushService);

  // Wire the workflow engine's deps + start its watchdog (advances in-flight runs after restart).
  workflowEngine.setWebhookDispatcher(webhookDispatcher);
  workflowEngine.setPushService(pushService);
  workflowEngine.setEmailService(emailService);
  workflowEngine.start().catch(err => logger.error('WorkflowEngine start failed', { error: String(err) }));

  // Start the scheduler (loads enabled jobs from storage). The backfill runs FIRST and is awaited:
  // an extension job stored before its owner scope was stamped refuses at run time, and the first
  // thing start() does is fire every @activate job on the node.
  backfillExtensionJobOwnerScope(config, storage)
    .catch(err => logger.error('Extension job owner-scope backfill failed', { error: String(err) }))
    .then(() => scheduler.start())
    .catch(err => logger.error('Scheduler start failed', { error: String(err) }));

  // Genesis Sync Scheduler (Phase 3.4)
  const genesisSyncService = createGenesisSyncService(config, storage);
  if (genesisSyncService) {
    genesisSyncService.start();
  }

  // Cache Cleanup Scheduler (G.1) — prunes expired federated/replica/genesis memory entries hourly
  startCacheCleanupJob(config, storage);

  // Sync Scheduler (B.4) — coordinates catalogue sync + memory replication based on syncMode
  startSyncScheduler(config, storage, peers);

  // Direct-message federation retry — re-attempts queued cross-node messages (DECISION #6)
  startMessageRetryJob(config, storage, peers);

  // Memory Contracts — Tracked Responses: rebuild the reactive watched-key registry from live
  // contracts, react to writes on watched keys (event-driven), and run the safety-net reconciler.
  rebuildTrackRegistry(storage).catch(err => logger.error('Track registry rebuild failed', { error: String(err) }));
  onMemoryWrittenEvent(evt => {
    if (!isTracked(evt.key)) return;   // O(1) gate — only watched keys do any work
    evaluateTrackedKey({ config, storage, peers }, evt.key)
      .catch(err => logger.warn('tracked-response reactive evaluate failed', { error: String(err) }));
  });
  startTrackedResponseReconciler(config, storage, peers);
}
