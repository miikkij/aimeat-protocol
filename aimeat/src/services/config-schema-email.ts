/**
 * @file src/services/config-schema-email.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The config rows for outgoing mail (config-smtp.ts): the SMTP server, its TLS choices,
 *   whether a new account confirms its address, and the two secrets shown only as configured. A pure
 *   move out of config-schema.ts (max-file-lines), unchanged: the spread stands where the rows stood.
 * @structure EMAIL_CONFIG_FIELDS
 * @usage import { EMAIL_CONFIG_FIELDS } from './config-schema-email.js';
 * @version-history
 *   v1.3.0 — 2026-11-04 — email.smtp_connect_timeout_ms (default 10 s) and email.smtp_socket_timeout_ms
 *     (default 60 s), 0 the mail library's own limits (codebase analysis 2026-11-03, HA stage 1).
 *   v1.2.0 — 2026-11-02 — email.reports_per_sender_day: the daily mail limit per agent or app, default 10,
 *     0 no limit (secaudit2026nov02d round 13).
 *   v1.1.0 — 2026-10-31 — email.reply_to: the Reply-To of an agent's or app's report mail to its owner,
 *     a valid address or empty (Jouni, 2026-10-31 20.14).
 *   v1.0.0 — 2026-10-20 — Moved from config-schema.ts, unchanged.
 */
import type { smtpDefaults } from '../config-smtp.js';
import type { ConfigFieldShape } from './config-field-def.js';
import { isValidEmail } from '../utils/email-validator.js';

// The keys are named by the loader that reads them (config-smtp.ts), as the data access rows do:
// naming AimeatConfig here would close an import cycle through config-sealing.ts.
export const EMAIL_CONFIG_FIELDS: ConfigFieldShape<keyof ReturnType<typeof smtpDefaults>>[] = [
  // ── Email (Phase 1.1, mutable) ──
  { key: 'emailEnabled', dotPath: 'email.enabled', envVar: 'AIMEAT_EMAIL_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Email service enabled (requires SMTP host)' },
  { key: 'emailConfirmationRequired', dotPath: 'email.confirmation_required', envVar: 'AIMEAT_EMAIL_CONFIRMATION_REQUIRED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Require email confirmation for registration' },
  { key: 'smtpHost', dotPath: 'email.smtp_host', envVar: 'AIMEAT_SMTP_HOST', type: 'string', validate: v => v === null || typeof v === 'string', immutable: false, description: 'SMTP server hostname' },
  { key: 'smtpPort', dotPath: 'email.smtp_port', envVar: 'AIMEAT_SMTP_PORT', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 65535, immutable: false, description: 'SMTP server port', range: '1-65535' },
  { key: 'smtpFrom', dotPath: 'email.smtp_from', envVar: 'AIMEAT_SMTP_FROM', type: 'string', validate: v => typeof v === 'string' && (v as string).length > 0, immutable: false, description: 'SMTP From address' },
  { key: 'smtpReplyTo', dotPath: 'email.reply_to', envVar: 'AIMEAT_SMTP_REPLY_TO', type: 'string', validate: v => v === null || v === '' || (typeof v === 'string' && isValidEmail(v)), immutable: false, description: 'Where a reply goes to a report an agent or an app mails its owner (Reply-To), such as a support address somebody reads. Empty: replies go to the From address. Other mail is unchanged' },
  { key: 'emailReportsPerSenderDay', dotPath: 'email.reports_per_sender_day', envVar: 'AIMEAT_EMAIL_REPORTS_PER_SENDER_DAY', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 10000, immutable: false, description: 'How many mails one agent or app may cause its owner in a day: the reports it mails and the results its delivering schedules send. Past the limit the mail is not sent, and the bell still gets each one. 0: no limit', range: '0-10000' },
  { key: 'smtpSecure', dotPath: 'email.smtp_secure', envVar: 'AIMEAT_SMTP_SECURE', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Use implicit TLS (port 465). Set false for STARTTLS (port 587).' },
  { key: 'smtpRejectUnauthorized', dotPath: 'email.smtp_reject_unauthorized', envVar: 'AIMEAT_SMTP_REJECT_UNAUTHORIZED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Reject unauthorized TLS certificates. Set false for self-signed certs or STARTTLS.' },
  { key: 'smtpConnectTimeoutMs', dotPath: 'email.smtp_connect_timeout_ms', envVar: 'AIMEAT_SMTP_CONNECT_TIMEOUT_MS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 600_000, immutable: false, applies: 'restart', description: 'How long one send attempt waits for the mail server to answer, in milliseconds: first the connection, then the server\'s greeting, each within this time. A server that does not answer in time counts as a failed attempt, and the send is tried again. 0: the mail library\'s own limit of 2 minutes', range: '0-600000' },
  { key: 'smtpSocketTimeoutMs', dotPath: 'email.smtp_socket_timeout_ms', envVar: 'AIMEAT_SMTP_SOCKET_TIMEOUT_MS', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 3_600_000, immutable: false, applies: 'restart', description: 'How long a connection to the mail server may stay silent while a mail is sent, in milliseconds. Past it, the attempt fails and the send is tried again. 0: the mail library\'s own limit of 10 minutes', range: '0-3600000' },

  // ── Email secrets (immutable — read-only in admin) ──
  { key: 'smtpUser', dotPath: 'email.smtp_user', envVar: 'AIMEAT_SMTP_USER', type: 'string', validate: () => true, immutable: true, description: 'SMTP username (secret)', adminDisplay: 'configured' },
  { key: 'smtpPass', dotPath: 'email.smtp_pass', envVar: 'AIMEAT_SMTP_PASS', type: 'string', validate: () => true, immutable: true, description: 'SMTP password (secret)', adminDisplay: 'configured' },
];
