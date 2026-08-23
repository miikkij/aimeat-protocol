/**
 * @file src/services/compliance-monthly-job.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The scheduled monthly compliance report: build last month, store it, tell the
 *   operator.
 *
 *   IT REPORTS THE MONTH THAT ENDED, NOT THE LAST THIRTY DAYS. The job fires on the first, so "the
 *   previous calendar month" is a closed period whose numbers will never change again. A rolling
 *   window filed under a month's name is a quiet lie in an archive somebody reads a year later,
 *   which is exactly the kind of document this whole feature exists to avoid producing.
 *
 *   IT DOES NOT OVERWRITE A MONTH WITH DIFFERENT NUMBERS SILENTLY. Re-running writes a new version
 *   of the same key, so the memory record's own version history holds the earlier answer. A stored
 *   compliance report that changed with no trace would be worse than none.
 *
 *   IT NOTIFIES THE OPERATORS, NOT EVERYONE. The report is node-wide, and the accounts entitled to
 *   read it are the ones the gate admits. A node with no operator writes the report and tells
 *   nobody, which is the right shape: the record exists for whoever is appointed later.
 * @structure
 *   - previousMonth(now) — `YYYY-MM` of the month before the given date, UTC
 *   - runComplianceMonthlyReport(config, storage) — the handler
 * @usage registered as the core handler `compliance-report-monthly` in services/core-jobs.ts
 * @version-history
 *   v1.0.0 — 2026-08-23 — BR-02, ring 1 (node-wide).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { buildComplianceReport } from './compliance-report.js';
import { writeStoredReport } from './compliance-register.js';
import { notify } from './notify.js';
import { logger } from '../utils/logger.js';

/** `YYYY-MM` of the calendar month before `now`, in UTC. */
export function previousMonth(now: Date): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-based, so this already IS the previous month's 1-based number
  return m === 0 ? `${y - 1}-12` : `${y}-${String(m).padStart(2, '0')}`;
}

export interface MonthlyReportResult {
  month: string;
  gaps: number;
  usecases: number;
  notified: number;
}

/**
 * Build the previous month's report, store it under `compliance.report.<YYYY-MM>`, and tell the
 * operators it is there.
 *
 * The notification carries the gap count rather than a summary of the report, because the gap count
 * is the only number that asks somebody to do something.
 */
export async function runComplianceMonthlyReport(
  config: AimeatConfig, storage: Storage,
): Promise<MonthlyReportResult> {
  const month = previousMonth(new Date());
  const report = await buildComplianceReport(storage, config, { month });
  await writeStoredReport(storage, config.nodeId, month, report);

  const owners = await storage.listOwners();
  const operators = owners.filter(o => o.roles.includes('operator'));
  for (const op of operators) {
    await notify(storage, `${op.name}@${config.nodeId}`, {
      type: 'compliance_report',
      title: `Compliance report for ${month} is ready`,
      body: report.gaps.length
        ? `${report.gaps.length} thing(s) need a look: activity nobody wrote down, or a use case with unanswered questions.`
        : 'Nothing in it needs a decision. It also names what it does not cover — read that part.',
      link: `/admin?tab=compliance&month=${month}`,
    });
  }

  logger.info('compliance: monthly report stored', {
    month, gaps: report.gaps.length, usecases: report.register.usecases.length, notified: operators.length,
  });
  return {
    month, gaps: report.gaps.length,
    usecases: report.register.usecases.length, notified: operators.length,
  };
}
