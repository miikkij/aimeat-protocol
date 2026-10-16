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
 *   IT DOES NOT OVERWRITE A MONTH WITH DIFFERENT NUMBERS SILENTLY. Should the same month be written
 *   again, it is a new version of the same key, so the memory record's own version history holds the
 *   earlier answer. A stored compliance report that changed with no trace would be worse than none.
 *
 *   IT DECIDES BY WHAT IS STORED, NOT BY THE DAY IT RUNS. The months owed are the ones after the
 *   newest stored monthly report, up to the month that ended (at most MAX_MONTHS_MADE_UP). So a run
 *   that comes late, because the node was down at 04:00 on the first and the scheduler caught the
 *   fire up at start (scheduler-catch-up.ts), makes up the month it owes, and a second run in the
 *   same month writes nothing and tells nobody again. A report of this moment is the snapshot below.
 *
 *   IT NOTIFIES THE OPERATORS, NOT EVERYONE. The report is node-wide, and the accounts entitled to
 *   read it are the ones the gate admits. A node with no operator writes the report and tells
 *   nobody, which is the right shape: the record exists for whoever is appointed later.
 *   A SNAPSHOT SAVED BY HAND IS THE SAME THING WITH A DIFFERENT PERIOD. It covers a rolling window
 *   ending now rather than a closed month, and its id says so, so the two never get confused in the
 *   list a year later. It notifies nobody: the person who pressed the button is already looking at
 *   the page.
 * @structure
 *   - previousMonth(now) — `YYYY-MM` of the month before the given date, UTC
 *   - monthsOwed(target, newestStored) — the months a run still has to write, oldest first
 *   - runComplianceMonthlyReport(config, storage, now) — the handler
 *   - saveComplianceSnapshot(config, storage, opts) — keep the report as it stands right now
 * @usage registered as the core handler `compliance-report-monthly` in services/core-jobs.ts
 * @version-history
 *   2026-10-16 — The months to write are decided by the newest stored monthly report: a late run
 *     makes up the month it owes (at most three), a month already stored is not written or
 *     announced again (QA audit E4-07).
 *   v1.1.2 — 2026-10-05 — The operator accounts are found with isOperatorAccount (secaudit 2026-10, C2).
 *   v1.1.1 — 2026-10-02 — The notification linked to /admin, which the SPA has no route for, so it
 *     opened the front page. It links to /v1/admin now.
 *   v1.1.0 — 2026-08-23 — saveComplianceSnapshot: the schedule was the only thing that could keep a
 *     report, so a person who wanted this moment had to wait for the first of next month.
 *   v1.0.0 — 2026-08-23 — BR-02, ring 1 (node-wide).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { buildComplianceReport } from './compliance-report.js';
import { writeStoredReport, snapshotIdFor, listStoredReports } from './compliance-register.js';
import { notify } from './notify.js';
import { logger } from '../utils/logger.js';
import { isOperatorAccount } from '../utils/operator-account.js';

/** `YYYY-MM` of the calendar month before `now`, in UTC. */
export function previousMonth(now: Date): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-based, so this already IS the previous month's 1-based number
  return m === 0 ? `${y - 1}-12` : `${y}-${String(m).padStart(2, '0')}`;
}

/** The most owed months one run makes up. A node down for longer gets the newest three. */
export const MAX_MONTHS_MADE_UP = 3;

/** `YYYY-MM` of the month before a `YYYY-MM`. */
function monthBefore(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * The months a run still has to write, oldest first: those after `newestStored` up to and including
 * `target`, the newest MAX_MONTHS_MADE_UP of them. With nothing stored, only `target`: a new node
 * does not write reports for months before it existed.
 */
export function monthsOwed(target: string, newestStored: string | null, max = MAX_MONTHS_MADE_UP): string[] {
  if (!newestStored) return [target];
  const owed: string[] = [];
  for (let m = target; m > newestStored && owed.length < max; m = monthBefore(m)) owed.unshift(m);
  return owed;
}

export interface MonthlyReportResult {
  /** The month that ended, which this run is about. */
  month: string;
  /** The months this run wrote, oldest first; empty when every owed month was already stored. */
  written: string[];
  /** Gaps and use cases of the newest month written (0 when nothing was written). */
  gaps: number;
  usecases: number;
  notified: number;
}

/**
 * Build each owed month's report, store it under `compliance.report.<YYYY-MM>`, and tell the
 * operators it is there. A month already stored is not built, written or announced again.
 *
 * The notification carries the gap count rather than a summary of the report, because the gap count
 * is the only number that asks somebody to do something.
 */
export async function runComplianceMonthlyReport(
  config: AimeatConfig, storage: Storage, now: Date = new Date(),
): Promise<MonthlyReportResult> {
  const month = previousMonth(now);
  const stored = await listStoredReports(storage, config.nodeId);
  const newestStored = stored.find(r => r.kind === 'monthly')?.id ?? null;   // newest first
  const owed = monthsOwed(month, newestStored);
  if (owed.length === 0) {
    logger.info('compliance: the monthly report for this month is already stored', { month });
    return { month, written: [], gaps: 0, usecases: 0, notified: 0 };
  }

  const owners = await storage.listOwners();
  const operators = owners.filter(isOperatorAccount);
  let last = { gaps: 0, usecases: 0 };
  for (const m of owed) {
    const report = await buildComplianceReport(storage, config, { month: m });
    await writeStoredReport(storage, config.nodeId, m, report);
    for (const op of operators) {
      await notify(storage, `${op.name}@${config.nodeId}`, {
        type: 'compliance_report',
        title: `Compliance report for ${m} is ready`,
        body: report.gaps.length
          ? `${report.gaps.length} thing(s) need a look: activity nobody wrote down, or a use case with unanswered questions.`
          : 'Nothing in it needs a decision. It also names what it does not cover — read that part.',
        // The admin page is the SPA route /v1/admin; /admin is no route and opens the front page.
        link: `/v1/admin?tab=compliance&month=${m}`,
      });
    }
    last = { gaps: report.gaps.length, usecases: report.register.usecases.length };
    logger.info('compliance: monthly report stored', { month: m, ...last, notified: operators.length });
  }
  return { month, written: owed, ...last, notified: operators.length };
}

export interface SnapshotResult {
  id: string;
  kind: 'manual';
  generated_at: string;
  period: { from: string; to: string };
  gaps: number;
  usecases: number;
}

/**
 * Keep the report as it stands right now.
 *
 * The window is the one the caller was looking at, because a snapshot taken from a page showing
 * ninety days and stored as thirty would misdescribe itself the moment somebody opens it again.
 * Everything else is the monthly job's path: the same builder, the same key prefix, the same
 * overwrite-writes-a-new-version behaviour if a second one lands in the same minute.
 */
export async function saveComplianceSnapshot(
  config: AimeatConfig, storage: Storage, opts: { sinceDays?: number; now?: Date } = {},
): Promise<SnapshotResult> {
  const now = opts.now ?? new Date();
  const id = snapshotIdFor(now);
  const report = await buildComplianceReport(storage, config, { sinceDays: opts.sinceDays });
  await writeStoredReport(storage, config.nodeId, id, report);

  logger.info('compliance: snapshot stored', {
    id, gaps: report.gaps.length, usecases: report.register.usecases.length,
  });
  return {
    id,
    kind: 'manual',
    generated_at: report.scope.generated_at,
    period: { from: report.scope.period.from, to: report.scope.period.to },
    gaps: report.gaps.length,
    usecases: report.register.usecases.length,
  };
}
