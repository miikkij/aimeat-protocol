/**
 * @file src/config-smtp.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The outgoing mail settings: the SMTP server the node sends through, and whether a new
 *   account must confirm its address. A pure move out of config.ts (max-file-lines), unchanged: the
 *   spread stands where the nine lines stood.
 * @structure smtpDefaults()
 * @usage
 *   import { smtpDefaults } from './config-smtp.js';
 *   const config = { ...smtpDefaults(), ... };
 * @version-history
 *   v1.1.0 — 2026-10-31 — smtpReplyTo (AIMEAT_SMTP_REPLY_TO): the Reply-To of an agent's or app's report
 *     mail to its owner (Jouni, 2026-10-31 20.14).
 *   v1.0.0 — 2026-10-20 — Moved from config.ts, unchanged.
 */

/** The SMTP settings, from the environment. `emailEnabled` is true when a server is named. */
export function smtpDefaults() {
  return {
    smtpHost: process.env.AIMEAT_SMTP_HOST || null,
    smtpPort: parseInt(process.env.AIMEAT_SMTP_PORT ?? '587', 10),
    smtpUser: process.env.AIMEAT_SMTP_USER ?? null,
    smtpPass: process.env.AIMEAT_SMTP_PASS ?? null,
    smtpFrom: process.env.AIMEAT_SMTP_FROM ?? 'AIMEAT <noreply@localhost>',
    // Where a reply goes to the report an agent or an app mails its owner (Reply-To); null: the From.
    smtpReplyTo: process.env.AIMEAT_SMTP_REPLY_TO?.trim() || null,
    smtpSecure: process.env.AIMEAT_SMTP_SECURE === 'true',
    smtpRejectUnauthorized: process.env.AIMEAT_SMTP_REJECT_UNAUTHORIZED !== 'false',
    emailConfirmationRequired: process.env.AIMEAT_EMAIL_CONFIRMATION_REQUIRED === 'true',
    emailEnabled: !!(process.env.AIMEAT_SMTP_HOST),
  };
}
