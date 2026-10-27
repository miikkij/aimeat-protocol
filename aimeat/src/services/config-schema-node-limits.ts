/**
 * @file src/services/config-schema-node-limits.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The config rows of the limits in config-node-limits.ts. Its own file because
 *   config-schema.ts is at the line ceiling; spread into the schema after the MCP rows. Every row is
 *   mutable, so the operator changes it from the Config tab or through chat (PUT /v1/admin/config),
 *   and every limit has the value that turns it off.
 * @structure NODE_LIMITS_CONFIG_FIELDS
 * @usage import { NODE_LIMITS_CONFIG_FIELDS } from './config-schema-node-limits.js';
 * @version-history
 *   v1.4.0 — 2026-10-27 — federation.introductions_per_hour (secaudit2026oct26, unbounded pending peering requests).
 *   v1.3.0 — 2026-10-25 — apps.held_label_days and apps.held_labels_per_owner (secaudit2026oct22,
 *     app-label-recycled-after-delete).
 *   v1.2.0 — 2026-10-25 — email.company_smtp_private_hosts (secaudit2026oct22, sendAsCompany:smtp-host-address-class).
 *   v1.1.0 — 2026-10-25 — auth.device_authorize_email_limit and auth.device_authorize_email_max
 *     (secaudit2026oct22, device-authorize-email-owner-oracle).
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22): mcp.unused_client_days.
 */
import type { NodeLimitsConfig } from '../config-node-limits.js';
import type { ConfigFieldShape } from './config-field-def.js';

/** A whole number of 0 or more, where 0 turns the limit off. */
const wholeOrOff = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 0;

export const NODE_LIMITS_CONFIG_FIELDS: ConfigFieldShape<keyof NodeLimitsConfig>[] = [
  { key: 'mcpUnusedClientDays', dotPath: 'mcp.unused_client_days', envVar: 'AIMEAT_MCP_UNUSED_CLIENT_DAYS', type: 'number', validate: wholeOrOff, immutable: false,
    description: 'Days after which an MCP client registration that no sign-in finished (no refresh token, no remembered approval) is deleted by the daily cleanup. A client that is in use is never deleted. 0 keeps every registration',
    range: '0-3650' },
  { key: 'deviceAuthEmailLimit', dotPath: 'auth.device_authorize_email_limit', envVar: 'AIMEAT_DEVICE_AUTHORIZE_EMAIL_LIMIT', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false,
    description: 'Count the email form of an agent connection (an account named by its email address) per network address, so nobody can test many addresses for an account here. Off is no limit. The account-name form is never counted' },
  { key: 'deviceAuthEmailMax', dotPath: 'auth.device_authorize_email_max', envVar: 'AIMEAT_DEVICE_AUTHORIZE_EMAIL_MAX', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && v >= 1, immutable: false,
    description: 'Email-form agent connections one network address may start in 10 minutes while the limit is on',
    range: '1-1000' },
  { key: 'companySmtpPrivateHosts', dotPath: 'email.company_smtp_private_hosts', envVar: 'AIMEAT_COMPANY_SMTP_PRIVATE_HOSTS', type: 'object', list: true,
    validate: v => Array.isArray(v) && v.every(s => typeof s === 'string' && s.trim() !== '' && !s.includes(',') && s.length <= 253), immutable: false,
    description: 'Mail servers on a private network that a company may send through: host names, addresses or networks (10.0.5.0/24), one per line (comma separated in the environment). Any other private address is refused. Empty: public mail servers only, and loopback on a local node' },
  { key: 'appHeldLabelDays', dotPath: 'apps.held_label_days', envVar: 'AIMEAT_APP_HELD_LABEL_DAYS', type: 'number', validate: wholeOrOff, immutable: false,
    description: 'Days a removed app\'s own address stays held for its owner, so no other owner\'s app is served where its visitors\' browser data is. Then the daily job releases it. 0 holds it until you release it on the Subdomains page',
    range: '0-3650' },
  { key: 'appHeldLabelsPerOwner', dotPath: 'apps.held_labels_per_owner', envVar: 'AIMEAT_APP_HELD_LABELS_PER_OWNER', type: 'number', validate: wholeOrOff, immutable: false,
    description: 'The most held addresses of removed apps one owner keeps; past it the one held longest is released first. 0 = no limit',
    range: '0-10000' },
  { key: 'federationIntroductionsPerHour', dotPath: 'federation.introductions_per_hour', envVar: 'AIMEAT_FEDERATION_INTRODUCTIONS_PER_HOUR', type: 'number', validate: wholeOrOff, immutable: false,
    description: 'Peering requests one address may leave for the operator per hour through an introduction. A node that introduces itself again with the same key keeps one waiting request. Past the limit the node is told when to try again. 0 = no limit',
    range: '0-100000' },
];
