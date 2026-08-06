/**
 * @file src/services/job-seeding.ts
 * @description Idempotently seeds the core scheduled-job records (with cron expressions) into storage
 *   at startup, creating each only if absent so restarts don't duplicate them; feature-gated jobs are
 *   seeded per config (consent, personal nodes, verification nonce cleanup).
 *
 * @structure
 *   - CoreJobDef: shape of a seeded job (id, name, coreHandler, cron)
 *   - seedCoreScheduledJobs(config, storage): builds the job list and createScheduledJob() for missing ones
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
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
    // Mark still-pending email invitations expired once their TTL passes (lazy checks also enforce this).
    { id: 'core:invitation-expiry', name: 'Invitation Expiry', coreHandler: 'invitation-expiry', cron: '*/10 * * * *' },
    // Operator storage-growth telemetry: capture a per-table row-count snapshot every hour.
    { id: 'core:storage-stats-snapshot', name: 'Storage Stats Snapshot', coreHandler: 'storage-stats-snapshot', cron: '0 * * * *' },
  ];

  if (config.consentEnabled) {
    jobs.push({ id: 'core:consent-expiry', name: 'Consent Expiry', coreHandler: 'consent-expiry', cron: '*/10 * * * *' });
    // Prune consent-audit entries past the retention window (config.consentAuditRetentionDays). Daily at 03:30.
    jobs.push({ id: 'core:consent-audit-prune', name: 'Consent Audit Prune', coreHandler: 'consent-audit-prune', cron: '30 3 * * *' });
  }

  if (config.personalNodesEnabled) {
    jobs.push({ id: 'core:mailbox-cleanup', name: 'Mailbox Cleanup', coreHandler: 'mailbox-cleanup', cron: '*/10 * * * *' });
  }

  if (config.emailEnabled) {
    // Onboarding rescue: hourly pass over day-old accounts with no MCP session (UX-remake v3, P3).
    jobs.push({ id: 'core:mcp-onboarding-rescue', name: 'MCP Onboarding Rescue', coreHandler: 'mcp-onboarding-rescue', cron: '15 * * * *' });
  }

  jobs.push({ id: 'core:capability-aggregation', name: 'Capability Aggregation', coreHandler: 'capability-aggregation', cron: '*/5 * * * *' });

  if (config.eudiwEnabled || config.ftnEnabled) {
    jobs.push({ id: 'core:nonce-cleanup', name: 'Verification Nonce Cleanup', coreHandler: 'nonce-cleanup', cron: '*/5 * * * *' });
  }

  // Agent task stall detection (Phase 1) -- runs every 5 minutes
  jobs.push({ id: 'core:task-stall-detection', name: 'Task Stall Detection', coreHandler: 'task-stall-detection', cron: '*/5 * * * *' });

  // Living Documents -- unattended pulse of due instances (per-instance charter cadence gates actual work)
  jobs.push({ id: 'core:living-pulse', name: 'Living Document Pulse', coreHandler: 'living-pulse', cron: '*/5 * * * *' });

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
