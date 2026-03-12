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
  if (config.consentEnabled) {
    scheduler.registerCoreHandler('consent-expiry', () => runConsentExpiryJob(storage));
  }
  if (config.personalNodesEnabled) {
    scheduler.registerCoreHandler('mailbox-cleanup', () => runMailboxCleanupJob(storage));
  }
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
          }).catch(() => { /* fire and forget */ });
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
