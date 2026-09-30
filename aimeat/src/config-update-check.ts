/**
 * @file src/config-update-check.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether this node asks npm for a newer AIMEAT, and where it asks. Read by
 *   services/node-update-check.ts, which the operator's header notice, GET /v1/admin/node-update
 *   and the aimeat_admin_node_update MCP tool all call.
 *
 *   ON BY DEFAULT. A node that never learns a newer version exists keeps running the old one, and
 *   its operator finds out from a bug report. The check is one small read of the public registry,
 *   at most once every six hours and only when an operator opens a page, and it sends nothing about
 *   the node. An operator who does not want it, or whose
 *   node may not reach the internet, turns it off in the Config tab or with AIMEAT_UPDATE_CHECK=false.
 *
 *   THE SOURCE is empty by default, which means registry.npmjs.org for the version and unpkg.com
 *   for the new version's change log. A base URL here replaces both: it must answer
 *   `/aimeat/latest` like the registry and `/aimeat@<version>/dist/public/changelog.json` like
 *   unpkg. That is for a node behind a package mirror, and for the E2E suite's stub.
 * @structure UpdateCheckConfig · updateCheckDefaults()
 * @usage
 *   import { updateCheckDefaults } from './config-update-check.js';
 *   const config = { ...updateCheckDefaults(), ... };
 * @version-history
 *   v1.0.0 — 2026-09-30 — Initial: AIMEAT_UPDATE_CHECK and AIMEAT_UPDATE_CHECK_SOURCE.
 */

/** Named here rather than in config-types.ts, which is at the line ceiling; AimeatConfig extends it. */
export interface UpdateCheckConfig {
  /** Ask npm for a newer AIMEAT and tell the operators. Default true. */
  updateCheck: boolean;
  /** Base URL that replaces registry.npmjs.org and unpkg.com. Empty (default) uses those two. */
  updateCheckSource: string;
}

export function updateCheckDefaults(): UpdateCheckConfig {
  return {
    updateCheck: process.env.AIMEAT_UPDATE_CHECK !== 'false',
    updateCheckSource: (process.env.AIMEAT_UPDATE_CHECK_SOURCE ?? '').trim(),
  };
}
