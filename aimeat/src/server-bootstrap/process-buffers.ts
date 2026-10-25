/**
 * @file src/server-bootstrap/process-buffers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The process-level accumulators and listeners a node arms before it mounts a single
 *   route: the webhook dispatcher, the stats collector, the refusal log, the five write buffers and
 *   the cache-invalidation listener.
 *
 *   NONE OF IT MOUNTS A ROUTE, which is why it is not in routes-loader.ts. Pure extraction from
 *   that file, moved unchanged when it reached the 800-line ceiling and the next router could not
 *   be added at all. Same calls, same order, same comments.
 *
 *   ORDER IS PART OF THE CONTRACT. The refusal log is armed before any route exists, because the
 *   first thing a node does on a public address is refuse somebody and those refusals must not be
 *   lost. Callers keep this call ahead of route mounting for the same reason.
 * @structure initProcessBuffers(config, storage) -> { webhookDispatcher, stats } · flushProcessBuffers()
 * @usage
 *   const { webhookDispatcher, stats } = await initProcessBuffers(config, storage);
 *   await flushProcessBuffers(); // at shutdown
 * @version-history
 *   2026-10-25 — The usage and tally buffers take their flush intervals from the config, and the usage
 *     settings are bound (services/usage/usage-settings.ts), so the admin Config tab reaches them.
 *   2026-10-17 — initAgentRefusals gets the listener that asks the person when a refusal opens
 *     (services/permission-ask-notice.ts).
 *   2026-10-15 — flushProcessBuffers: the shutdown flush of the write buffers, moved from
 *     index-start.ts, and the agent refusal notes flushed with them (feature-list audit #30).
 *   v1.1.0 — 2026-10-02 — initScopeUse: the record of the permissions each `*` agent uses.
 *   v1.0.0 — 2026-08-27 — Pure extraction from routes-loader.ts (which was at 799 of 800 lines).
 *   v1.0.1 — 2026-09-26 — The owner in the cache tag comes from localAccountName (utils/gaii.ts),
 *     which keeps an identity of another node whole, so it never names the local namesake
 *     (secaudit 2026-09, F-1).
 *   v1.0.2 — 2026-09-26 — The cache-invalidation listener runs as this node (runAsNode), so the owner
 *     tag is cut for this node when another node in the same process emits. One node per process in
 *     production, so nothing there changes.
 *   v1.1.0 — 2026-09-29 — The classification audit buffer is armed with the others (TARGET-082 V4).
 *   v1.2.0 — 2026-09-30 — The agent refusal notes are armed with the refusal log (services/agent-refusals.ts).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { createWebhookDispatcher } from '../services/webhook-dispatcher.js';
import { onChangeEvent } from '../services/event-bus.js';
import { invalidateTag } from '../services/cache.js';
import { localAccountName, runAsNode } from '../utils/gaii.js';
import { initStats } from '../services/stats.js';
import { configureAuthAudit } from '../services/auth-audit.js';
import { initTelemetryBuffer } from '../services/telemetry-buffer.js';
import { initUsageBuffer } from '../services/usage/usage-buffer.js';
import { bindUsageSettings } from '../services/usage/usage-settings.js';
import { initWriteTallyBuffer } from '../services/data-map/write-tally-buffer.js';
import { initConsentAuditBuffer } from '../services/consent-audit-buffer.js';
import { initClassificationAudit } from '../services/classification/audit.js';
import { initAgentRefusals } from '../services/agent-refusals.js';
import { sendPermissionAsk } from '../services/permission-ask-notice.js';
import { initScopeUse } from '../services/scope-use.js';

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
  // The flush intervals are read here once (usage.buffer_ms, usage.tally_buffer_ms: they take effect at
  // the next start); the usage windows and batches are read from the bound config on each run.
  bindUsageSettings(config);
  initUsageBuffer(storage, config.usageBufferMs);
  // The write tally starts collecting here. It fills only from now on: the writer was never
  // recorded before this, so there is no history to seed it from.
  initWriteTallyBuffer(storage, config.tallyBufferMs);
  // Which permissions each `*` agent uses, for the narrowing its owner is offered and for when `*`
  // starts to hold its tasks (services/scope-use.ts). Like the tally, it fills only from now on.
  initScopeUse(storage);

  // Off-request-path buffer for consent-audit writes (denials + grant/revoke mutations).
  initConsentAuditBuffer(storage);
  // Off-request-path buffer for the classification audit log (TARGET-082 V4): shown, used, refused
  // and changed, merged per reader, item, action and minute.
  initClassificationAudit(storage);
  // The agent refusal notes: a scope refusal of an agent goes on its card and its open tasks
  // (services/agent-refusals.ts). Armed with the refusal log, before any route can refuse. A newly
  // opened refusal the person can allow with one press asks them in the bell and by email
  // (services/permission-ask-notice.ts).
  initAgentRefusals(storage, (owner, agent, words) => sendPermissionAsk({ storage, config }, owner, agent, words));

  // Generic read-cache invalidation: translate every mutation (`emitChange(domain, ownerGaii?)`)
  // into cache tag drops. The broad `domain:<d>` tag is the safety net for write paths that don't
  // carry an owner; the owner-scoped tag is the precise drop when they do. Read paths opt in by
  // tagging their cached() entries with these same tags (see services/cache.ts).
  // The bus calls a listener as whoever emitted the event, which in a process that serves more than
  // one node can be another node, so this one runs as THIS node and cuts the owner for it. A
  // production process serves one node, so nothing there changes.
  onChangeEvent((evt) => runAsNode(config.nodeId, () => {
    invalidateTag(`domain:${evt.domain}`);
    if (evt.ownerGaii) {
      const owner = localAccountName(evt.ownerGaii);
      if (owner) invalidateTag(`owner:${owner}:${evt.domain}`);
    }
  }));

  return { webhookDispatcher, stats };
}

/**
 * Write what every buffer armed above still holds, at shutdown. One list beside the one that arms
 * them, so a buffer added to initProcessBuffers has its flush next to it. The agent refusal notes
 * were armed and never flushed here, so a refusal inside its one-minute window was lost when the
 * process stopped (feature-list audit #30).
 */
export async function flushProcessBuffers(): Promise<void> {
  const { shutdownTelemetryBuffer } = await import('../services/telemetry-buffer.js');
  await shutdownTelemetryBuffer();
  const { shutdownUsageBuffer } = await import('../services/usage/usage-buffer.js');
  await shutdownUsageBuffer();
  const { shutdownScopeUse } = await import('../services/scope-use.js');
  await shutdownScopeUse();
  const { shutdownWriteTallyBuffer } = await import('../services/data-map/write-tally-buffer.js');
  await shutdownWriteTallyBuffer();
  const { shutdownConsentAuditBuffer } = await import('../services/consent-audit-buffer.js');
  await shutdownConsentAuditBuffer();
  const { shutdownClassificationAudit } = await import('../services/classification/audit.js');
  await shutdownClassificationAudit();
  const { flushAgentRefusals } = await import('../services/agent-refusals.js');
  await flushAgentRefusals();
}
