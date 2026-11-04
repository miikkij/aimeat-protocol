/**
 * @file src/config-types-smtp.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The outgoing mail settings (config-smtp.ts smtpDefaults()). Mixed into AimeatConfig,
 *   which had reached the 800-line ceiling; the fields moved here verbatim, beside the two SMTP time
 *   limits that pushed it over.
 * @structure SmtpConfig
 * @usage export interface AimeatConfig extends SmtpConfig { … }
 * @version-history
 *   v1.0.0 — 2026-11-04 — Extracted from config-types.ts (max-file-lines), with smtpConnectTimeoutMs and
 *     smtpSocketTimeoutMs (codebase analysis 2026-11-03, HA stage 1).
 */

export interface SmtpConfig {
  // Email / SMTP (Phase 1.1)
  smtpHost: string | null;
  smtpPort: number;
  smtpUser: string | null;
  smtpPass: string | null;
  smtpFrom: string;
  /** The Reply-To of a report an agent or an app mails its owner; null: replies go to the From. */
  smtpReplyTo: string | null;
  /** Mails one agent or app may cause its owner in 24 hours (notification-create.ts mailOwnerFrom); 0: no limit. */
  emailReportsPerSenderDay: number;
  smtpSecure: boolean;
  smtpRejectUnauthorized: boolean;
  /** How long one SMTP attempt waits to connect, and again for the greeting, in ms; 0: the library's own 2 minutes. */
  smtpConnectTimeoutMs: number;
  /** How long an open SMTP connection may stay silent, in ms; 0: the library's own 10 minutes. */
  smtpSocketTimeoutMs: number;
  emailConfirmationRequired: boolean;
  emailEnabled: boolean;
}
