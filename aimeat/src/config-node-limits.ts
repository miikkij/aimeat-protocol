/**
 * @file src/config-node-limits.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator settings that keep one account's use of what the node shares from reaching
 *   every other account: unused MCP client registrations, the email form of device authorization,
 *   the per-app labels a removed app holds, and the private SMTP hosts a company may send through.
 *   Its own file because config.ts and config-types.ts are at the line ceiling. Each limit has a
 *   value that turns it off (0, or false), and each is a row in services/config-schema-node-limits.ts,
 *   so it is set from the Config tab or through chat (PUT /v1/admin/config).
 * @structure NodeLimitsConfig · nodeLimitsDefaults()
 * @usage
 *   import { nodeLimitsDefaults } from './config-node-limits.js';
 *   const config = { ...nodeLimitsDefaults(), ... };
 * @version-history
 *   v1.4.0 — 2026-10-27 — federationIntroductionsPerHour (secaudit2026oct26, unbounded pending peering requests).
 *   2026-10-27 — realtimeEchatMaxRooms and realtimeMaxDocsPerRoom (secaudit2026oct26,
 *     anonymous-room-cap-exhaustion and yjsSnapshots:unbounded).
 *   v1.3.0 — 2026-10-25 — appHeldLabelDays and appHeldLabelsPerOwner (secaudit2026oct22, app-label-recycled-after-delete).
 *   v1.2.0 — 2026-10-25 — companySmtpPrivateHosts (secaudit2026oct22, sendAsCompany:smtp-host-address-class).
 *   v1.1.0 — 2026-10-25 — deviceAuthEmailLimit and deviceAuthEmailMax (secaudit2026oct22,
 *     device-authorize-email-owner-oracle).
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22): mcpUnusedClientDays.
 */

/** Declared here, not picked from AimeatConfig, so this file imports nothing (config-decide.ts gives the reason). */
export interface NodeLimitsConfig {
  /**
   * Days after which a dynamically registered MCP OAuth client (POST /v1/mcp/register) that holds no
   * refresh token and no remembered approval is deleted by the daily core job mcp-client-cleanup.
   * AIMEAT_MCP_UNUSED_CLIENT_DAYS, default 30; 0 keeps every registration.
   */
  mcpUnusedClientDays: number;
  /**
   * Whether the email form of device authorization (POST /v1/agents/device-authorize with `owner`
   * an email address) is counted per network address. AIMEAT_DEVICE_AUTHORIZE_EMAIL_LIMIT, default
   * on; off is no limit. The account-name form is never counted.
   */
  deviceAuthEmailLimit: boolean;
  /** How many email-form requests one network address may make in 10 minutes while the limit is on.
   *  AIMEAT_DEVICE_AUTHORIZE_EMAIL_MAX, default 20 (the contacts lookup allowance per account). */
  deviceAuthEmailMax: number;
  /**
   * The mail servers a company may send through although they are on a private network: host names,
   * addresses, or networks in CIDR form (`mail.internal`, `10.0.5.7`, `10.0.5.0/24`). A company's SMTP
   * host outside public address space and outside this list is refused (services/company/
   * smtp-host-check.ts). Loopback stays allowed on a node in local mode. AIMEAT_COMPANY_SMTP_PRIVATE_HOSTS,
   * comma separated, default empty.
   */
  companySmtpPrivateHosts: string[];
  /**
   * Days a removed app's own address (its per-app label) stays held for its owner before the daily
   * core job held-label-release releases it for anyone (services/held-app-labels.ts).
   * AIMEAT_APP_HELD_LABEL_DAYS, default 90; 0 holds it until the operator releases it.
   */
  appHeldLabelDays: number;
  /**
   * The most held addresses one owner keeps; past it the one held longest is released first.
   * AIMEAT_APP_HELD_LABELS_PER_OWNER, default 20; 0 is no limit.
   */
  appHeldLabelsPerOwner: number;
  /**
   * Introductions that end in a pending peering request, per network address and hour
   * (POST /v1/federation/peer/introduce takes no sign-in). AIMEAT_FEDERATION_INTRODUCTIONS_PER_HOUR,
   * default 30; 0 is no limit (secaudit2026oct26).
   */
  federationIntroductionsPerHour: number;
  /**
   * The most rooms anonymous echat visitors may hold open together, inside realtime.max_rooms, so
   * visitors without an account cannot take every room the node's apps use.
   * AIMEAT_REALTIME_ECHAT_MAX_ROOMS, default 50; 0 is no separate limit.
   */
  realtimeEchatMaxRooms: number;
  /**
   * The most shared documents one realtime room keeps the latest state of for late joiners
   * (services/realtime-yjs.ts). AIMEAT_REALTIME_MAX_DOCS_PER_ROOM, default 64; 0 is no limit.
   */
  realtimeMaxDocsPerRoom: number;
}

/** A whole number from the environment, or the default when it is unset or not a whole number of 0 or more. */
function wholeOr(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== '' && Number.isInteger(n) && n >= 0 ? n : fallback;
}

export function nodeLimitsDefaults(env: NodeJS.ProcessEnv = process.env): NodeLimitsConfig {
  return {
    mcpUnusedClientDays: wholeOr(env.AIMEAT_MCP_UNUSED_CLIENT_DAYS, 30),
    deviceAuthEmailLimit: env.AIMEAT_DEVICE_AUTHORIZE_EMAIL_LIMIT !== 'false',
    deviceAuthEmailMax: Math.max(1, wholeOr(env.AIMEAT_DEVICE_AUTHORIZE_EMAIL_MAX, 20)),
    companySmtpPrivateHosts: (env.AIMEAT_COMPANY_SMTP_PRIVATE_HOSTS ?? '').split(',').map(s => s.trim()).filter(Boolean),
    appHeldLabelDays: wholeOr(env.AIMEAT_APP_HELD_LABEL_DAYS, 90),
    appHeldLabelsPerOwner: wholeOr(env.AIMEAT_APP_HELD_LABELS_PER_OWNER, 20),
    federationIntroductionsPerHour: wholeOr(env.AIMEAT_FEDERATION_INTRODUCTIONS_PER_HOUR, 30),
    realtimeEchatMaxRooms: wholeOr(env.AIMEAT_REALTIME_ECHAT_MAX_ROOMS, 50),
    realtimeMaxDocsPerRoom: wholeOr(env.AIMEAT_REALTIME_MAX_DOCS_PER_ROOM, 64),
  };
}
