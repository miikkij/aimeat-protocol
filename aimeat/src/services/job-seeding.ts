/**
 * @file src/services/job-seeding.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Idempotently seeds the core scheduled-job records (with cron expressions) into storage
 *   at startup, creating each only if absent so restarts don't duplicate them; feature-gated jobs are
 *   seeded per config (consent, personal nodes, verification nonce cleanup).
 *
 * @structure
 *   - CoreJobDef: shape of a seeded job (id, name, coreHandler, cron)
 *   - seedCoreScheduledJobs(config, storage): builds the job list and createScheduledJob() for missing ones
 *
 * @version-history
 *   v1.9.0 — 2026-10-02 — Seed core:package-peer-cleanup (daily, 05:29): unused packages-only peers removed.
 *   v1.8.0 — 2026-10-02 — Seed core:package-renewals (daily, 05:13): automatic renewals of the package
 *     update services this node sold (package-renewals.ts).
 *   v1.7.0 — 2026-09-30 — Seed core:classification-audit-prune (nightly, 03:35) on every node; the
 *     prune had run inside core:consent-audit-prune, which exists only with consent on.
 *   v1.6.0 — 2026-09-29 — Seed core:classification-queue (hourly, :25): the Content Classifier's queue
 *     (TARGET-082 V3).
 *   v1.5.0 — 2026-09-28 — Seed core:package-upstream-check (daily, 04:41): installed packages brought up
 *     to what their source node serves.
 *   v1.4.0 — 2026-09-28 — Seed core:ai-catalog-refresh (daily, 04:17; refreshes when due, System 2 V4).
 *   v1.3.0 — 2026-09-25 — Seed core:usage-visit-retention (nightly, 03:40): the privacy notice's
 *     thirteen months for a visit record that names an account.
 *   v1.2.0 — 2026-09-19 — Seed core:ai-decision-prune (nightly, 03:20; TARGET-080).
 *   v1.1.0 — 2026-08-14 — Seed core:usage-rollup (every 5 min) and core:usage-archive (nightly).
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
    // The AI-job day logs, pruned to the retention window. 03:10, after the execution-log prune.
    { id: 'core:ai-job-log-prune', name: 'AI Job Log Prune', coreHandler: 'ai-job-log-prune', cron: '10 3 * * *' },
    // Decision records past AIMEAT_DECIDE_RETENTION_DAYS (TARGET-080). 03:20, after the two above.
    { id: 'core:ai-decision-prune', name: 'AI Decision Prune', coreHandler: 'ai-decision-prune', cron: '20 3 * * *' },
    { id: 'core:designbook-aging', name: 'Design Book Aging', coreHandler: 'designbook-aging', cron: '0 5 * * *' },
    // Daily at 04:17; the handler refreshes only when AIMEAT_AI_CATALOG_REFRESH says it is due.
    { id: 'core:ai-catalog-refresh', name: 'AI Model Catalogue Refresh', coreHandler: 'ai-catalog-refresh', cron: '17 4 * * *' },
    // Installed packages brought up to what their source node serves now (package-upstream-refresh.ts).
    // Daily at 04:41; the handler does nothing while package federation is off.
    { id: 'core:package-upstream-check', name: 'Package Update Check', coreHandler: 'package-upstream-check', cron: '41 4 * * *' },
    // Automatic renewals of the package update services this node sold (package-renewals.ts). Daily at
    // 05:13; three days before a date, once per period; nothing to do on a node that sells nothing.
    { id: 'core:package-renewals', name: 'Package Automatic Renewals', coreHandler: 'package-renewals', cron: '13 5 * * *' },
    // Packages-only peers nothing uses any more (no grant, nobody's seller, 30 days old) removed
    // (package-peer-limits.ts). Daily at 05:29; nothing to do on a node that is no repository.
    { id: 'core:package-peer-cleanup', name: 'Package Peer Cleanup', coreHandler: 'package-peer-cleanup', cron: '29 5 * * *' },
    // Mark still-pending email invitations expired once their TTL passes (lazy checks also enforce this).
    { id: 'core:invitation-expiry', name: 'Invitation Expiry', coreHandler: 'invitation-expiry', cron: '*/10 * * * *' },
    // Operator storage-growth telemetry: capture a per-table row-count snapshot every hour.
    { id: 'core:storage-stats-snapshot', name: 'Storage Stats Snapshot', coreHandler: 'storage-stats-snapshot', cron: '0 * * * *' },
    // The compliance report for the month that just ended. 04:00 on the first, after the nightly
    // usage rollup and archive at 03:xx, so the month it reports on is fully folded before it reads.
    { id: 'core:compliance-report-monthly', name: 'Monthly Compliance Report', coreHandler: 'compliance-report-monthly', cron: '0 4 1 * *' },
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
    // Once a day is the most this may ever run: the work is a fortnight-scale comparison, and a
    // more frequent pass buys nothing while multiplying the chance of a mistake reaching an inbox.
    // NOTE: seeding is create-if-absent — changing this cron does nothing to an existing DB.
    jobs.push({ id: 'core:inactivity-nudge', name: 'Inactivity Nudge', coreHandler: 'inactivity-nudge', cron: '40 9 * * *' });
  }

  jobs.push({ id: 'core:capability-aggregation', name: 'Capability Aggregation', coreHandler: 'capability-aggregation', cron: '*/5 * * * *' });

  if (config.eudiwEnabled || config.ftnEnabled) {
    jobs.push({ id: 'core:nonce-cleanup', name: 'Verification Nonce Cleanup', coreHandler: 'nonce-cleanup', cron: '*/5 * * * *' });
  }

  // Agent task stall detection (Phase 1) -- runs every 5 minutes
  jobs.push({ id: 'core:task-stall-detection', name: 'Task Stall Detection', coreHandler: 'task-stall-detection', cron: '*/5 * * * *' });

  // Living Documents -- unattended pulse of due instances (per-instance charter cadence gates actual work)
  jobs.push({ id: 'core:living-pulse', name: 'Living Document Pulse', coreHandler: 'living-pulse', cron: '*/5 * * * *' });

  // Usage telemetry. The fold every 5 minutes is what makes the serving layer's staleness a number
  // we can state (`computed_through`) rather than a shrug; the archive sweep runs nightly, off-peak,
  // because it moves rows in bulk. NOTE: seeding is create-if-absent, so changing a cron here does
  // nothing to a database that already has the job.
  jobs.push({ id: 'core:usage-rollup', name: 'Usage Rollup', coreHandler: 'usage-rollup', cron: '*/5 * * * *' });
  jobs.push({ id: 'core:usage-archive', name: 'Usage Archive Sweep', coreHandler: 'usage-archive', cron: '20 3 * * *' });
  // The privacy notice's thirteen months for a visit record that names an account. Nightly at 03:40,
  // after the archive sweep, so a row it folds is already where it will stay.
  jobs.push({ id: 'core:usage-visit-retention', name: 'Usage Visit Retention', coreHandler: 'usage-visit-retention', cron: '40 3 * * *' });
  // The Content Classifier's queue (TARGET-082 V3), hourly at :25. Seeded on every node, because
  // seeding is create-if-absent and an operator may turn classification on later; the handler reads
  // nothing while AIMEAT_CLASSIFICATION is off.
  jobs.push({ id: 'core:classification-queue', name: 'Classification Queue', coreHandler: 'classification-queue', cron: '25 * * * *' });
  // The classification audit log and the exceptions list past the retention in the node's
  // classification policy. Nightly at 03:35, on every node: until 2026-09-30 it ran inside
  // core:consent-audit-prune, which is seeded only with consent on.
  jobs.push({ id: 'core:classification-audit-prune', name: 'Classification Audit Prune', coreHandler: 'classification-audit-prune', cron: '35 3 * * *' });

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
