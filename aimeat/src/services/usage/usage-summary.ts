/**
 * @file src/services/usage/usage-summary.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's usage report read, with its argument handling, in one place: GET
 *   /v1/admin/usage/summary and the MCP tool aimeat_admin_usage both call readUsageSummary(), so a
 *   report name, a day, a default window or an owner name is read the same way whichever interface
 *   asked. The caller gates on the operator role before it calls this; nothing here checks it.
 * @structure UsageSummaryInput · UsageSummaryResult · readUsageSummary(storage, nodeId, input)
 * @usage
 *   const r = await readUsageSummary(storage, config.nodeId, { report: 'tool', from, to });
 *   if (!r.ok) return res.status(400).json(error(config.nodeId, r.code, r.message));
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial: moved out of routes/admin/usage.ts so aimeat_admin_usage reads the
 *     same reports with the same validation.
 */
import type { Storage } from '../../storage/interface.js';
import { readUsageReport, UnknownReportError, dayNDaysAgo, type UsageReport } from './usage-read.js';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The parameters as the caller has them: query strings from the route, typed values from MCP. */
export interface UsageSummaryInput {
  /** A NODE_REPORTS name, or an OWNER_REPORTS name with `owner`. Defaults to `day`. */
  report?: string;
  /** A bare account name or a full GHII. Absent or empty: the node-wide report. */
  owner?: string;
  /** Inclusive days, YYYY-MM-DD. Default: 30 days ago and today. */
  from?: string;
  to?: string;
  /** `hour` asks for the hour grain; anything else is the day grain. */
  grain?: string;
  /** `false` (or the string `'false'`) leaves the per-bucket series out. */
  series?: boolean | string;
  /** The most groups to return; the report clamps it to 1..2000. */
  limit?: number | string;
}

export type UsageSummaryResult =
  | { ok: true; data: UsageReport }
  | { ok: false; code: 'INVALID_INPUT'; message: string };

/** Read one operator usage report. A bad day or an unknown report name is INVALID_INPUT. */
export async function readUsageSummary(
  storage: Storage, nodeId: string, input: UsageSummaryInput,
): Promise<UsageSummaryResult> {
  const report = input.report ?? 'day';
  const owner = input.owner ? input.owner : null;
  const from = input.from ?? dayNDaysAgo(30);
  const to = input.to ?? dayNDaysAgo(0);
  if (!ISO_DAY.test(from) || !ISO_DAY.test(to)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'from and to must be YYYY-MM-DD' };
  }
  const grain = input.grain === 'hour' ? 'hour' : 'day';

  try {
    const data = await readUsageReport(storage, {
      report,
      scope: owner ? 'owner' : 'node',
      // A bare owner name and a full GHII both work; the operator types whichever they have.
      ownerGhii: owner ? (owner.includes('@') ? owner : `${owner}@${nodeId}`) : undefined,
      from, to, grain,
      series: input.series !== false && input.series !== 'false',
      limit: Number(input.limit) || undefined,
    });
    return { ok: true, data };
  } catch (err) {
    if (err instanceof UnknownReportError) return { ok: false, code: 'INVALID_INPUT', message: err.message };
    throw err;
  }
}
