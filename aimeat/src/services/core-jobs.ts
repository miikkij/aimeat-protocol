/**
 * @file src/services/core-jobs.ts
 * @description Defines and registers the node's built-in scheduled job handlers on the Scheduler —
 *   pure async functions (no setInterval) for daily allowance, work/dispute timeouts, TTL cleanups,
 *   consent expiry/prune, capability aggregation, task-stall detection, and the living-document pulse.
 *
 * @structure
 *   - registerCoreHandler(scheduler, config, storage): wires each core handler by name (feature-gated by config)
 *   - runDailyAllowanceJob / runWorkTimeoutJob / runMemoryTtlCleanupJob / runDisputeTimeoutJob / ...: the handlers
 *
 * @version-history
 *   v1.1.0 — 2026-07-16 — Register the workspace-version-compaction handler (retention P2; not
 *     seeded as a scheduled job — one-shot via the admin maintenance route, schedulable by operators).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { Scheduler } from './scheduler.js';
import { logger } from '../utils/logger.js';

/**
 * Register all core job handlers on the scheduler.
 */
export function registerCoreHandlers(
  scheduler: Scheduler,
  config: AimeatConfig,
  storage: Storage,
): void {
  scheduler.registerCoreHandler('daily-allowance', () => runDailyAllowanceJob(config, storage));
  scheduler.registerCoreHandler('work-timeout', () => runWorkTimeoutJob(config, storage));
  scheduler.registerCoreHandler('memory-ttl-cleanup', () => runMemoryTtlCleanupJob(storage));
  scheduler.registerCoreHandler('board-post-ttl-cleanup', () => runBoardPostTtlCleanupJob(storage));
  scheduler.registerCoreHandler('dispute-timeout', () => runDisputeTimeoutJob(config, storage));
  scheduler.registerCoreHandler('execution-log-prune', () => runExecutionLogPruneJob(config, storage));
  scheduler.registerCoreHandler('invitation-expiry', () => runInvitationExpiryJob(storage));
  if (config.consentEnabled) {
    scheduler.registerCoreHandler('consent-expiry', () => runConsentExpiryJob(storage));
    scheduler.registerCoreHandler('consent-audit-prune', () => runConsentAuditPruneJob(config, storage));
  }
  if (config.personalNodesEnabled) {
    scheduler.registerCoreHandler('mailbox-cleanup', () => runMailboxCleanupJob(storage));
  }
  scheduler.registerCoreHandler('capability-aggregation', async () => {
    const { runCapabilityAggregation } = await import('./capability-aggregator.js');
    await runCapabilityAggregation(config, storage);
  });
  // Run once at startup (non-blocking)
  import('./capability-aggregator.js')
    .then(m => m.runCapabilityAggregation(config, storage))
    .catch(err => logger.error('Startup capability aggregation failed', { error: String(err) }));
  if (config.eudiwEnabled || config.ftnEnabled) {
    scheduler.registerCoreHandler('nonce-cleanup', () => runNonceCleanupJob(storage));
  }
  // Agent task stall detection + agent connectivity checks
  scheduler.registerCoreHandler('task-stall-detection', async () => {
    const { detectStalledTasks, detectAgentStallConditions } = await import('./task-stall-detector.js');
    await detectStalledTasks(storage, config);
    await detectAgentStallConditions(storage);
  });
  // Living Documents — unattended self-fulfilled pulse of due instances
  scheduler.registerCoreHandler('living-pulse', async () => {
    const { scanAllDue } = await import('./living-pulse.js');
    await scanAllDue(storage, config, scheduler.getNotifyServices());
  });
  // Workspace version-history compaction: applies the retention window (AIMEAT_WS_MAX_VERSIONS /
  // manifest maxVersions) to EXISTING `.version.N` bloat. The publish path prunes incrementally;
  // this handler exists for the one-shot cleanup (admin maintenance route) or an operator-scheduled
  // sweep. Append-only spaces + workspaces without a readable manifest are never touched.
  scheduler.registerCoreHandler('workspace-version-compaction', async () => {
    const { compactWorkspaceVersions } = await import('./workspace-versions.js');
    await compactWorkspaceVersions(storage, config);
  });
  // Onboarding funnel rescue: one email to a day-old account with a verified email and no MCP
  // session yet (UX-remake v3, P3). The handler no-ops when the email service is disabled.
  scheduler.registerCoreHandler('mcp-onboarding-rescue', async () => {
    const { runMcpOnboardingRescueJob } = await import('./onboarding-funnel.js');
    await runMcpOnboardingRescueJob(config, storage);
  });
  // One friendly email to an account nobody has been seen on for a fortnight, with a prompt in it.
  // No-ops unless AIMEAT_INACTIVITY_NUDGE is on — unsolicited mail is never a deploy side effect.
  scheduler.registerCoreHandler('inactivity-nudge', async () => {
    const { runInactivityNudgeJob } = await import('./inactivity-nudge.js');
    await runInactivityNudgeJob(config, storage);
  });
  // Operator storage-growth telemetry: hourly per-table row-count snapshot (admin DB tab).
  scheduler.registerCoreHandler('storage-stats-snapshot', () => runStorageStatsSnapshotJob(storage));
  // Seed one snapshot at startup so the tab is never empty on a fresh boot (non-blocking).
  runStorageStatsSnapshotJob(storage).catch(err => logger.error('Startup storage-stats snapshot failed', { error: String(err) }));
}

/** Capture one storage-size snapshot (per-table row counts + total) and prune snapshots older than 30 days. */
export async function runStorageStatsSnapshotJob(storage: Storage): Promise<void> {
  const counts = await storage.getTableRowCounts();
  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
  const now = new Date().toISOString();
  await storage.saveStorageStatsSnapshot({ id: `storagestats-${now}`, capturedAt: now, counts, totalRows });
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);   // keep ~30 days of hourly snapshots
  await storage.pruneStorageStatsSnapshots(cutoff.toISOString());
  logger.info(`Storage-stats snapshot captured: ${Object.keys(counts).length} tables, ${totalRows} rows`);
}

// ── Core Job Handlers (pure async, no setInterval) ─────────────────

async function runDailyAllowanceJob(config: AimeatConfig, storage: Storage): Promise<void> {
  const agents = await storage.listAgents();
  for (const agent of agents) {
    await storage.creditBalanceCapped(agent.gaii, config.dailyAllowance, config.dailyAllowanceCap);
  }
  logger.info(`Daily allowance credited to ${agents.length} agents`);
}

async function runWorkTimeoutJob(_config: AimeatConfig, storage: Storage): Promise<void> {
  const allWork = await storage.listAllWork();
  const now = Date.now();
  for (const work of allWork) {
    if (['pending', 'accepted', 'in_progress'].includes(work.status)) {
      if (new Date(work.ttlExpiresAt).getTime() < now) {
        const { returnEscrow } = await import('./morsel.js');
        await returnEscrow(storage, work);
        await storage.updateWork(work.trackingCode, {
          status: 'expired',
          updatedAt: new Date().toISOString(),
        });

        if (work.callbackUrl) {
          const body = JSON.stringify({
            event: 'work.expired',
            tracking_code: work.trackingCode,
            status: 'expired',
            timestamp: new Date().toISOString(),
          });
          fetch(work.callbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            signal: AbortSignal.timeout(10_000),
          }).catch(err => { logger.warn('runWorkTimeoutJob: fire and forget', { error: String(err) }); });
        }

        logger.info(`Work ${work.trackingCode} expired (TTL exceeded)`);
      }
    }
  }
}

async function runMemoryTtlCleanupJob(storage: Storage): Promise<void> {
  const now = Date.now();
  const allAgents = await storage.listAgents();
  for (const agent of allAgents) {
    const memories = await storage.listMemory(agent.gaii);
    for (const mem of memories) {
      if (mem.ttlHours) {
        const expiresAt = new Date(mem.createdAt).getTime() + mem.ttlHours * 3_600_000;
        if (now > expiresAt) {
          await storage.deleteMemory(agent.gaii, mem.key);
        }
      }
    }
  }
}

async function runBoardPostTtlCleanupJob(storage: Storage): Promise<void> {
  const boards = await storage.listBoards();
  for (const board of boards) {
    await storage.listPosts(board.id, { limit: 10000 });
  }
}

async function runDisputeTimeoutJob(_config: AimeatConfig, storage: Storage): Promise<void> {
  const now = Date.now();
  const SEVEN_DAYS = 7 * 24 * 3_600_000;
  const THIRTY_DAYS = 30 * 24 * 3_600_000;

  const allWork = await storage.listAllWork();
  for (const work of allWork) {
    if (work.status !== 'disputed' && work.status !== 'contested' && work.status !== 'escalated') continue;

    const dispute = await storage.getDisputeByTrackingCode(work.trackingCode);
    if (!dispute) continue;

    const disputeAge = now - new Date(dispute.createdAt).getTime();

    if ((dispute.status === 'open' || dispute.status === 'contested') && disputeAge > SEVEN_DAYS) {
      await storage.updateDispute(dispute.id, {
        status: 'escalated',
        updatedAt: new Date().toISOString(),
      });

      const log = await storage.getDisputeAuditLog(dispute.id);
      const prevHash = log.length > 0 ? log[log.length - 1].hash : '0';
      const { createHash } = await import('node:crypto');
      const entryData = JSON.stringify({ event: 'auto_escalated', actor: 'system', timestamp: new Date().toISOString() });
      const hash = createHash('sha256').update(prevHash + entryData).digest('hex');

      await storage.addDisputeAuditEntry(dispute.id, {
        sequence: log.length + 1,
        event: 'escalated',
        actor: 'system',
        timestamp: new Date().toISOString(),
        data: { reason: 'Auto-escalated after 7 days without resolution' },
        hash,
        previousHash: prevHash,
      });

      logger.info(`Dispute ${dispute.id} auto-escalated after 7 days`);
    }

    if (dispute.status === 'escalated' && disputeAge > THIRTY_DAYS) {
      const { returnEscrow } = await import('./morsel.js');
      await returnEscrow(storage, work);

      await storage.updateDispute(dispute.id, {
        status: 'resolved',
        ruling: {
          ruling: 'timeout',
          distribution: { toRequester: work.cost.total, toProvider: 0, burned: 0 },
          reason: 'Auto-resolved: dispute timed out after 30 days',
        },
        updatedAt: new Date().toISOString(),
      });

      await storage.updateWork(work.trackingCode, {
        status: 'settled',
        updatedAt: new Date().toISOString(),
      });

      const log = await storage.getDisputeAuditLog(dispute.id);
      const prevHash = log.length > 0 ? log[log.length - 1].hash : '0';
      const { createHash } = await import('node:crypto');
      const entryData = JSON.stringify({ event: 'timeout_resolved', actor: 'system', timestamp: new Date().toISOString() });
      const hash = createHash('sha256').update(prevHash + entryData).digest('hex');

      await storage.addDisputeAuditEntry(dispute.id, {
        sequence: log.length + 1,
        event: 'timeout_resolved',
        actor: 'system',
        timestamp: new Date().toISOString(),
        data: { reason: 'Auto-resolved after 30 days without operator ruling' },
        hash,
        previousHash: prevHash,
      });

      logger.info(`Dispute ${dispute.id} auto-resolved (timeout after 30 days)`);
    }
  }
}

async function runMailboxCleanupJob(storage: Storage): Promise<void> {
  const removed = await storage.cleanExpiredMailboxItems();
  if (removed > 0) logger.info(`Mailbox cleanup: removed ${removed} expired items`);
}

async function runConsentExpiryJob(storage: Storage): Promise<void> {
  const { expireConsents } = await import('./consent.js');
  await expireConsents(storage);
}

async function runNonceCleanupJob(storage: Storage): Promise<void> {
  const cleaned = await storage.cleanExpiredNonces();
  if (cleaned > 0) logger.info(`Nonce cleanup: removed ${cleaned} expired verification nonces`);
}

async function runInvitationExpiryJob(storage: Storage): Promise<void> {
  const expired = await storage.cleanupExpiredInvitations(new Date().toISOString());
  if (expired > 0) logger.info(`Invitation expiry: marked ${expired} email invitations expired`);
}

async function runExecutionLogPruneJob(config: AimeatConfig, storage: Storage): Promise<void> {
  const days = config.executionLogRetentionDays > 0 ? config.executionLogRetentionDays : 30;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const pruned = await storage.pruneExecutionLogs(cutoff);
  if (pruned > 0) logger.info(`Pruned ${pruned} execution log entries older than ${days} days`);
}

async function runConsentAuditPruneJob(config: AimeatConfig, storage: Storage): Promise<void> {
  const days = config.consentAuditRetentionDays;
  if (!days || days <= 0) return; // 0/disabled = keep forever
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const pruned = await storage.pruneConsentAudit(cutoff);
  if (pruned > 0) logger.info(`Pruned ${pruned} consent-audit entries older than ${days} days`);
}
