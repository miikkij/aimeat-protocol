/**
 * @file src/server-bootstrap/process-buffers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The process-level accumulators and listeners a node arms before it mounts a single
 *   route: the webhook dispatcher, the stats collector, the refusal log, the four write buffers and
 *   the cache-invalidation listener.
 *
 *   NONE OF IT MOUNTS A ROUTE, which is why it is not in routes-loader.ts. Pure extraction from
 *   that file, moved unchanged when it reached the 800-line ceiling and the next router could not
 *   be added at all. Same calls, same order, same comments.
 *
 *   ORDER IS PART OF THE CONTRACT. The refusal log is armed before any route exists, because the
 *   first thing a node does on a public address is refuse somebody and those refusals must not be
 *   lost. Callers keep this call ahead of route mounting for the same reason.
 * @structure initProcessBuffers(config, storage) -> { webhookDispatcher, stats }
 * @usage
 *   const { webhookDispatcher, stats } = await initProcessBuffers(config, storage);
 * @version-history
 *   v1.0.0 — 2026-08-27 — Pure extraction from routes-loader.ts (which was at 799 of 800 lines).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { createWebhookDispatcher } from '../services/webhook-dispatcher.js';
import { onChangeEvent } from '../services/event-bus.js';
import { invalidateTag } from '../services/cache.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { initStats } from '../services/stats.js';
import { configureAuthAudit } from '../services/auth-audit.js';
import { initTelemetryBuffer } from '../services/telemetry-buffer.js';
import { initUsageBuffer } from '../services/usage/usage-buffer.js';
import { initWriteTallyBuffer } from '../services/data-map/write-tally-buffer.js';
import { initConsentAuditBuffer } from '../services/consent-audit-buffer.js';

export interface ProcessBuffers {
  webhookDispatcher: ReturnType<typeof createWebhookDispatcher>;
  stats: Awaited<ReturnType<typeof initStats>>;
}

export async function initProcessBuffers(config: AimeatConfig, storage: Storage): Promise<ProcessBuffers> {
  // Webhook dispatcher for agent push notifications
  const webhookDispatcher = createWebhookDispatcher({ config, storage });

  // Statistics collector (with persistence via storage)
  const stats = await initStats(storage);

  // The refusal log. Wired before any route exists, because the first thing a node does on a public
  // address is refuse somebody, and the point of this file is that those refusals are not lost.
  configureAuthAudit(config);

  // In-memory accumulator for high-frequency agent signals (telemetry + heartbeat),
  // flushed to storage on an interval instead of per request.
  initTelemetryBuffer(storage);

  // The one write door for the usage call stream: every measured call, whichever surface it came
  // through, buffers here and flushes on an interval so a request never waits on a metrics write.
  initUsageBuffer(storage);
  // The write tally starts collecting here. It fills only from now on: the writer was never
  // recorded before this, so there is no history to seed it from.
  initWriteTallyBuffer(storage);

  // Off-request-path buffer for consent-audit writes (denials + grant/revoke mutations).
  initConsentAuditBuffer(storage);

  // Generic read-cache invalidation: translate every mutation (`emitChange(domain, ownerGaii?)`)
  // into cache tag drops. The broad `domain:<d>` tag is the safety net for write paths that don't
  // carry an owner; the owner-scoped tag is the precise drop when they do. Read paths opt in by
  // tagging their cached() entries with these same tags (see services/cache.ts).
  onChangeEvent((evt) => {
    invalidateTag(`domain:${evt.domain}`);
    if (evt.ownerGaii) {
      const owner = parseGaiiLoose(evt.ownerGaii).owner;
      if (owner) invalidateTag(`owner:${owner}:${evt.domain}`);
    }
  });

  return { webhookDispatcher, stats };
}
