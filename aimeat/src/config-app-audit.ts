/**
 * @file src/config-app-audit.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How much of each app's audit log a node keeps when an owner sets no limit of their
 *   own. Read by services/app-audit-archive.ts; set by AIMEAT_APP_AUDIT_KEEP and the Config tab row
 *   apps.audit_keep_default. Mixed into AimeatConfig (config-types.ts), as UpdateCheckConfig is.
 * @structure AppAuditConfig
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial (IAM round 2 leftover 7).
 */

export interface AppAuditConfig {
  /** How many entries of each app's audit log an owner keeps when they set no limit of their own.
   *  0 = all, the default: audit information is kept (services/app-audit-archive.ts). */
  appAuditKeepDefault: number;
}
