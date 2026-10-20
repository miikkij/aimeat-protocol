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
 *   v1.0.0 — 2026-10-20 — Moved from config-schema.ts, unchanged.
 */
import type { AimeatConfig } from '../config.js';
import type { ConfigFieldShape } from './config-field-def.js';

export const EMAIL_CONFIG_FIELDS: ConfigFieldShape<keyof AimeatConfig>[] = [
  // ── Email (Phase 1.1, mutable) ──
  { key: 'emailEnabled', dotPath: 'email.enabled', envVar: 'AIMEAT_EMAIL_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Email service enabled (requires SMTP host)' },
  { key: 'emailConfirmationRequired', dotPath: 'email.confirmation_required', envVar: 'AIMEAT_EMAIL_CONFIRMATION_REQUIRED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Require email confirmation for registration' },
  { key: 'smtpHost', dotPath: 'email.smtp_host', envVar: 'AIMEAT_SMTP_HOST', type: 'string', validate: v => v === null || typeof v === 'string', immutable: false, description: 'SMTP server hostname' },
  { key: 'smtpPort', dotPath: 'email.smtp_port', envVar: 'AIMEAT_SMTP_PORT', type: 'number', validate: v => typeof v === 'number' && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 65535, immutable: false, description: 'SMTP server port', range: '1-65535' },
  { key: 'smtpFrom', dotPath: 'email.smtp_from', envVar: 'AIMEAT_SMTP_FROM', type: 'string', validate: v => typeof v === 'string' && (v as string).length > 0, immutable: false, description: 'SMTP From address' },
  { key: 'smtpSecure', dotPath: 'email.smtp_secure', envVar: 'AIMEAT_SMTP_SECURE', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Use implicit TLS (port 465). Set false for STARTTLS (port 587).' },
  { key: 'smtpRejectUnauthorized', dotPath: 'email.smtp_reject_unauthorized', envVar: 'AIMEAT_SMTP_REJECT_UNAUTHORIZED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Reject unauthorized TLS certificates. Set false for self-signed certs or STARTTLS.' },

  // ── Email secrets (immutable — read-only in admin) ──
  { key: 'smtpUser', dotPath: 'email.smtp_user', envVar: 'AIMEAT_SMTP_USER', type: 'string', validate: () => true, immutable: true, description: 'SMTP username (secret)', adminDisplay: 'configured' },
  { key: 'smtpPass', dotPath: 'email.smtp_pass', envVar: 'AIMEAT_SMTP_PASS', type: 'string', validate: () => true, immutable: true, description: 'SMTP password (secret)', adminDisplay: 'configured' },
];
