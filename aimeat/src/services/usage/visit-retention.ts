/**
 * @file src/services/usage/visit-retention.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Keeps the privacy notice's promise about visits to published apps: a record that an
 *   account opened an app names that account for thirteen months, and after that only counts
 *   without names remain, so the app's owner keeps their long-term figures.
 *
 *   WHAT A VISIT RECORD IS, EXACTLY. Every open of a published app is one usage call with surface
 *   'app' (services/usage/record-app-open.ts), keyed by the visitor's account when somebody was
 *   signed in. That row lives in the hot table and then in the archive, and the rollup fold projects
 *   it into cuts. The call cuts keyed by a person are of three kinds, and
 *   test/unit/visit-retention.test.ts fails when a new one is left out of this list:
 *     - APP_VISIT_ROLLUP_CUTS (call.app.visitor, call.owner.tool, call.owner.surface): keyed by the
 *       person AND the surface, so a row with surface 'app' is a visit and nothing else. Folded.
 *     - APP_USE_CUT (call.owner.app): keyed by the person and the app without the surface, so one
 *       row holds the person's opens of the app together with their paid calls to its tools. Only
 *       the opens move; a paid call stays with whoever paid.
 *     - ACCOUNT_ACTIVITY_CUTS (call.owner, call.actor): an account's total of every kind of call,
 *       naming no app. No visit can be read out of them, so they are the account's own activity and
 *       keep the name, like every other call record.
 *   Nothing else is touched: no other surface, no billing row, no LLM ledger row, and no cut that
 *   does not name a person (the node-wide counts, and the author's own traffic in
 *   call.provider.coordinate, which names the app's owner and never the visitor).
 *
 *   FOLDED, NOT DELETED. The account is replaced by USAGE_FOLDED_VISITOR, which says "somebody was
 *   signed in", so the owner's split between signed-in and anonymous opens survives per app and per
 *   day. A raw row keeps its day and loses its time of day. A folded rollup row carries how many
 *   people were folded into it, so the report can still say how many different people came that
 *   day. Across days it cannot: after the fold nobody can tell whether one day's visitor came back
 *   on another, so a report over several folded days counts each day's people.
 *
 *   NEVER AHEAD OF THE ROLLUP FOLD. A day is folded once it is past the cutoff AND the fold's
 *   cursor has passed it. An open the rollup has not counted yet would otherwise be counted later
 *   under the marker, and that day's number of people would come out wrong. A node whose fold has
 *   never run folds nothing.
 * @structure
 *   - VISIT_NAME_RETENTION_MONTHS / ACCOUNT_ACTIVITY_CUTS
 *   - visitNameCutoffDay(now) -- the first day that still keeps its names
 *   - runVisitRetentionJob(storage, now?) -- bounded sweeps until nothing is left to fold
 * @usage
 *   scheduler.registerCoreHandler('usage-visit-retention', () => runVisitRetentionJob(storage));
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial, with the thirteen-month rule in the privacy notice.
 */
import type { Storage, UsageVisitFoldResult } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';

/** How long a visit record may name the visitor's account. The privacy notice says thirteen months. */
export const VISIT_NAME_RETENTION_MONTHS = 13;

/**
 * The call cuts keyed by a person that are NOT visit records: an account's total of every kind of
 * call, which names no app. Listed so the test can tell a decision from an oversight.
 */
export const ACCOUNT_ACTIVITY_CUTS = ['call.owner', 'call.actor'] as const;

/** Rows per table per sweep. One sweep is one short transaction per place. */
const BATCH = 2_000;
/** Sweeps per run. A backlog larger than this is worked off across nights rather than in one. */
const MAX_SWEEPS = 50;

/**
 * The first day (YYYY-MM-DD, UTC) that still keeps its names: the same day of the month thirteen
 * months back, or that month's last day when it is shorter. Every day before it is folded.
 */
export function visitNameCutoffDay(now: Date): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() - VISIT_NAME_RETENTION_MONTHS;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(now.getUTCDate(), daysInMonth))).toISOString().slice(0, 10);
}

export interface VisitRetentionResult extends UsageVisitFoldResult {
  /** The first day that kept its names on this run, or null when the rollup fold has not run yet. */
  beforeDay: string | null;
}

export async function runVisitRetentionJob(storage: Storage, now: Date = new Date()): Promise<VisitRetentionResult> {
  const total: UsageVisitFoldResult = { hotRows: 0, archiveRows: 0, rollupRows: 0, appUseRows: 0 };

  const cursor = await storage.getUsageCursor('call');
  if (!cursor?.lastTs) return { ...total, beforeDay: null };
  const cutoff = visitNameCutoffDay(now);
  // The day the cursor stands on is not finished yet, so it is not folded either.
  const cursorDay = cursor.lastTs.slice(0, 10);
  const beforeDay = cursorDay < cutoff ? cursorDay : cutoff;

  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    const r = await storage.foldNamedAppVisits({ beforeDay, batch: BATCH });
    total.hotRows += r.hotRows;
    total.archiveRows += r.archiveRows;
    total.rollupRows += r.rollupRows;
    total.appUseRows += r.appUseRows;
    if (r.hotRows + r.archiveRows + r.rollupRows === 0) break;
  }

  if (total.hotRows + total.archiveRows + total.rollupRows > 0) {
    logger.info('visit-retention: folded the account out of old app visits', { beforeDay, ...total });
  }
  return { ...total, beforeDay };
}
