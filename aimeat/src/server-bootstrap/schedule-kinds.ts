/**
 * @file src/server-bootstrap/schedule-kinds.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The schedule kinds whose executor is handed to the Scheduler at boot instead of being a
 *   branch in scheduler.ts: each one's run reaches back into services the Scheduler is imported by, so
 *   the Scheduler cannot import it without an import cycle.
 *     refinery     one mail refinery batch (services/refinery/scheduled-job.ts)
 *     ai           a server-side model call whose answer goes through the shared memory write
 *     dataproduct  one data product build (services/dataproduct/scheduled-job.ts)
 *   Moved out of service-init.ts by extraction when the dataproduct kind joined, at its 800-line limit.
 * @structure registerScheduleKinds(scheduler, storage, config)
 * @usage registerScheduleKinds(scheduler, storage, config);
 * @version-history
 *   v1.0.0 — 2026-11-01 — The refinery and ai registrations moved here unchanged from service-init.ts;
 *     the dataproduct kind added (plan doc-mvwxcas3dom3, D9.5).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { Scheduler } from '../services/scheduler.js';
import { runRefineryJob } from '../services/refinery/scheduled-job.js';
import { runAiJob } from '../services/scheduler-ai-job.js';
import { runDataproductJob } from '../services/dataproduct/scheduled-job.js';

export function registerScheduleKinds(scheduler: Scheduler, storage: Storage, config: AimeatConfig): void {
  scheduler.registerKindExecutor('refinery', (job) => runRefineryJob(storage, config, job));
  // The `ai` kind for the same reason: it writes its answer through the shared memory write
  // service, which reaches the Scheduler, so the Scheduler cannot import it (secaudit 2026-10).
  scheduler.registerKindExecutor('ai', (job) => runAiJob(storage, config, job));
  scheduler.registerKindExecutor('dataproduct', (job) => runDataproductJob(storage, config, job));
}
