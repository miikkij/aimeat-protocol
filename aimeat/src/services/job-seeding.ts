import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

interface CoreJobDef {
  id: string;
  name: string;
  coreHandler: string;
  cron: string;
}

/**
 * Seed core scheduled jobs into storage (idempotent -- only creates if not already present).
 */
export async function seedCoreScheduledJobs(config: AimeatConfig, storage: Storage): Promise<void> {
  const jobs: CoreJobDef[] = [
    { id: 'core:daily-allowance', name: 'Daily Allowance', coreHandler: 'daily-allowance', cron: '0 0 * * *' },
    { id: 'core:work-timeout', name: 'Work Timeout Expiry', coreHandler: 'work-timeout', cron: '* * * * *' },
    { id: 'core:memory-ttl-cleanup', name: 'Memory TTL Cleanup', coreHandler: 'memory-ttl-cleanup', cron: '*/5 * * * *' },
    { id: 'core:board-post-ttl-cleanup', name: 'Board Post TTL Cleanup', coreHandler: 'board-post-ttl-cleanup', cron: '*/10 * * * *' },
    { id: 'core:dispute-timeout', name: 'Dispute Auto-Escalation', coreHandler: 'dispute-timeout', cron: '0 * * * *' },
    { id: 'core:execution-log-prune', name: 'Execution Log Prune', coreHandler: 'execution-log-prune', cron: '0 3 * * *' },
  ];

  if (config.consentEnabled) {
    jobs.push({ id: 'core:consent-expiry', name: 'Consent Expiry', coreHandler: 'consent-expiry', cron: '*/10 * * * *' });
  }

  if (config.personalNodesEnabled) {
    jobs.push({ id: 'core:mailbox-cleanup', name: 'Mailbox Cleanup', coreHandler: 'mailbox-cleanup', cron: '*/10 * * * *' });
  }

  const now = new Date().toISOString();
  for (const def of jobs) {
    const existing = await storage.getScheduledJob(def.id);
    if (!existing) {
      await storage.createScheduledJob({
        id: def.id,
        name: def.name,
        type: 'core',
        coreHandler: def.coreHandler,
        cron: def.cron,
        enabled: true,
        createdBy: `system@${config.nodeId}`,
        createdAt: now,
        updatedAt: now,
      });
      logger.info(`Seeded core scheduled job: ${def.id} (${def.cron})`);
    }
  }
}
