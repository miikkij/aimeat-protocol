/**
 * @file src/services/value/reports.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The report names the usage reports gained without a new tool or route: `value`
 *   (services/value/report.ts) for a person and for the operator, and `rhythm`
 *   (services/value/usage-rhythm.ts) for the operator, and `data` (services/value/data-report.ts) for a
 *   person and for the operator. GET /v1/usage/summary and aimeat_usage_report
 *   call readOwnerReport; GET /v1/admin/usage/summary and aimeat_admin_usage reach the node-wide ones
 *   through services/usage/usage-summary.ts. Every other name goes to readUsageReport as before.
 * @structure readOwnerReport
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-n-hy-ty-n-kyy-kulu-hy-ty-ja-k-yt-n-rytmi, phase 2).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { readUsageReport, type ReadUsageArgs, type UsageReport } from '../usage/usage-read.js';
import { readValueReport, type ValueReport } from './report.js';
import { readDataReport, type DataReport } from './data-report.js';

/** One owner report: the value report for `value`, a usage report for every other name. */
export async function readOwnerReport(
  deps: { storage: Storage; config: AimeatConfig },
  args: ReadUsageArgs & { scope: 'owner'; ownerGhii: string },
): Promise<UsageReport | ValueReport | DataReport> {
  if (args.report === 'value') {
    return readValueReport(deps, { kind: 'own', ownerGhii: args.ownerGhii }, { from: args.from, to: args.to });
  }
  if (args.report === 'data') {
    return readDataReport(deps.storage, deps.config.nodeId, { kind: 'own', ownerGhii: args.ownerGhii }, { from: args.from, to: args.to });
  }
  return readUsageReport(deps.storage, args);
}
