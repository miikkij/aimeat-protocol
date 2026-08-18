/**
 * @file email.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Email service -- SMTP-based email delivery with retry logic, template support,
 *   and privacy-first logging (never logs email addresses). Supports verification codes,
 *   magic links, notifications, match suggestions, and raw HTML emails.
 * @structure
 *   - EmailService interface (sendVerificationCode, sendMagicLink, sendNotification, sendMatchSuggestion, sendInvite, sendRaw)
 *   - withRetry() exponential backoff helper
 *   - createDisabledService() stub for when SMTP is not configured
 *   - createEmailService() factory (configures nodemailer transport)
 * @usage
 *   import { createEmailService } from '../services/email.js';
 *   const email = createEmailService(config);
 *   await email.sendVerificationCode(to, code, 'en');
 * @version-history
 *   v1.0.0 -- 2026-04-10 -- Initial email service with SMTP transport
 *   v1.1.0 -- 2026-05-01 -- Add retry logic, match suggestion emails, raw send
 *   v1.2.0 -- 2026-05-21 -- Add stats counter instrumentation (email_sent, email_failed, email_retried)
 *   v1.3.0 -- 2026-06-15 -- Add a process-wide active-service handle (set/getActiveEmailService) so the
 *     agent-task completion hook (B6) can reuse the configured transport without re-threading it.
 *   v1.4.0 -- 2026-07-04 -- Add sendInvite() for email invitations to unregistered users.
 *   v1.5.0 -- 2026-07-07 -- Add sendKeyInvite()/sendKeyCredentials() for provisioned-code access keys
 *     and the first-login durable-credentials email (TARGET-011).
 *   v1.6.0 -- 2026-08-06 -- Add sendWithAttachments() (invoice PDFs via the outbound door) with
 *     reply-to + display-name support: the envelope sender stays the node's own address
 *     (SPF/DKIM), the business's name and reply address ride on top.
 */

import { createTransport, type Transporter } from 'nodemailer';
import type { AimeatConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { getStats } from './stats.js';
import {
  verificationEmailHtml,
  magicLinkEmailHtml,
  notificationEmailHtml,
  matchSuggestionEmailHtml,
  inviteEmailHtml,
  inviteEmailSubject,
  keyInviteEmailHtml,
  keyInviteEmailSubject,
  keyCredentialsEmailHtml,
  keyCredentialsEmailSubject,
} from './email-templates.js';

export type { MatchSuggestion } from './email-templates.js';

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface EmailService {
  readonly enabled: boolean;
  sendVerificationCode(to: string, code: string, locale?: string): Promise<boolean>;
  sendMagicLink(to: string, loginUrl: string, locale?: string): Promise<boolean>;
  sendNotification(to: string, subject: string, body: string): Promise<boolean>;
  sendMatchSuggestion(to: string, matches: import('./email-templates.js').MatchSuggestion[], locale?: string): Promise<boolean>;
  sendInvite(to: string, args: import('./email-templates.js').InviteEmailArgs, locale?: string): Promise<boolean>;
  sendKeyInvite(to: string, args: import('./email-templates.js').KeyInviteEmailArgs, locale?: string): Promise<boolean>;
  sendKeyCredentials(to: string, args: import('./email-templates.js').KeyCredentialsEmailArgs, locale?: string): Promise<boolean>;
  sendRaw(to: string, subject: string, html: string, text: string): Promise<boolean>;
  /** Attachment-carrying send (outbound door / invoice PDFs). Envelope from stays the node's; fromName + replyTo carry the business identity. */
  sendWithAttachments(to: string, subject: string, html: string, text: string, attachments: EmailAttachment[], opts?: { replyTo?: string; fromName?: string }): Promise<boolean>;
}

/**
 * Process-wide handle to the active EmailService, set once during service init. Lets per-request
 * surfaces that aren't threaded the instance (e.g. the agent-task completion hook, B6) reuse the
 * single configured transport instead of constructing a parallel one. Mirrors getActiveScheduler().
 */
let _activeEmailService: EmailService | null = null;
export function setActiveEmailService(svc: EmailService): void { _activeEmailService = svc; }
export function getActiveEmailService(): EmailService | null { return _activeEmailService; }

// ── Retry helper ─────────────────────────────────────────

const RETRY_DELAYS = [1_000, 3_000, 9_000]; // exponential backoff: 1s, 3s, 9s

async function withRetry<T>(fn: () => Promise<T>, label: string, emailType?: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < RETRY_DELAYS.length) {
        const delay = RETRY_DELAYS[attempt];
        logger.warn(`Email send failed (${label}), retry ${attempt + 1}/${RETRY_DELAYS.length} in ${delay}ms`);
        if (emailType) getStats()?.incrementTyped('email_retried', emailType);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

// ── Disabled service (returned when SMTP is not configured) ──

function createDisabledService(): EmailService {
  const warn = (method: string) => {
    logger.warn(`Email service disabled: ${method} called but SMTP is not configured`);
    return Promise.resolve(false);
  };
  return {
    enabled: false,
    sendVerificationCode: () => warn('sendVerificationCode'),
    sendMagicLink: () => warn('sendMagicLink'),
    sendNotification: () => warn('sendNotification'),
    sendMatchSuggestion: () => warn('sendMatchSuggestion'),
    sendInvite: () => warn('sendInvite'),
    sendKeyInvite: () => warn('sendKeyInvite'),
    sendKeyCredentials: () => warn('sendKeyCredentials'),
    sendRaw: () => warn('sendRaw'),
    sendWithAttachments: () => warn('sendWithAttachments'),
  };
}

// ── Factory ──────────────────────────────────────────────

export function createEmailService(config: AimeatConfig): EmailService {
  if (!config.emailEnabled) {
    logger.info('Email service disabled (no SMTP host configured)');
    return createDisabledService();
  }

  const transporter: Transporter = createTransport({
    host: config.smtpHost!,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: config.smtpUser ? {
      user: config.smtpUser,
      pass: config.smtpPass ?? '',
    } : undefined,
    tls: {
      rejectUnauthorized: config.smtpRejectUnauthorized,
    },
  });

  const from = config.smtpFrom;

  async function send(to: string, subject: string, html: string, text: string, type: string): Promise<boolean> {
    try {
      await withRetry(
        () => transporter.sendMail({ from, to, subject, html, text }),
        subject,
        type,
      );
      // Never log email addresses (privacy)
      logger.info(`Email sent successfully: ${subject}`);
      getStats()?.incrementTyped('email_sent', type);
      return true;
    } catch (err) {
      // Never log email addresses (privacy)
      logger.error(`Email send failed after retries: ${subject}`, { error: (err as Error).message });
      getStats()?.incrementTyped('email_failed', type);
      return false;
    }
  }

  return {
    enabled: true,

    async sendVerificationCode(to: string, code: string, locale?: string): Promise<boolean> {
      const { html, text } = verificationEmailHtml(code, locale);
      const subject = locale === 'fi' ? 'AIMEAT-vahvistuskoodisi' : 'Your AIMEAT Verification Code';
      return send(to, subject, html, text, 'verification');
    },

    async sendMagicLink(to: string, loginUrl: string, locale?: string): Promise<boolean> {
      const { html, text } = magicLinkEmailHtml(loginUrl, locale);
      const subject = locale === 'fi' ? 'AIMEAT-kirjautumislinkkisi' : 'Your AIMEAT Login Link';
      return send(to, subject, html, text, 'magic_link');
    },

    async sendNotification(to: string, subject: string, body: string): Promise<boolean> {
      const { html, text } = notificationEmailHtml(subject, body);
      return send(to, subject, html, text, 'notification');
    },

    async sendMatchSuggestion(to: string, matches: import('./email-templates.js').MatchSuggestion[], locale?: string): Promise<boolean> {
      const { html, text } = matchSuggestionEmailHtml(matches, locale);
      const subject = locale === 'fi' ? 'Uusia ehdotuksia AIMEAT:ssa' : 'New Match Suggestions on AIMEAT';
      return send(to, subject, html, text, 'match_suggestion');
    },

    async sendInvite(to: string, args: import('./email-templates.js').InviteEmailArgs, locale?: string): Promise<boolean> {
      const { html, text } = inviteEmailHtml(args, locale);
      const subject = inviteEmailSubject(args.orgName, locale);
      return send(to, subject, html, text, 'invitation');
    },

    async sendKeyInvite(to: string, args: import('./email-templates.js').KeyInviteEmailArgs, locale?: string): Promise<boolean> {
      const { html, text } = keyInviteEmailHtml(args, locale);
      const subject = keyInviteEmailSubject(args.orgName, locale);
      return send(to, subject, html, text, 'key_invitation');
    },

    async sendKeyCredentials(to: string, args: import('./email-templates.js').KeyCredentialsEmailArgs, locale?: string): Promise<boolean> {
      const { html, text } = keyCredentialsEmailHtml(args, locale);
      const subject = keyCredentialsEmailSubject(args.orgName, locale);
      return send(to, subject, html, text, 'key_credentials');
    },

    async sendRaw(to: string, subject: string, rawHtml: string, rawText: string): Promise<boolean> {
      return send(to, subject, rawHtml, rawText, 'group_send');
    },

    async sendWithAttachments(to: string, subject: string, html: string, text: string, attachments: EmailAttachment[], opts?: { replyTo?: string; fromName?: string }): Promise<boolean> {
      try {
        // Display name is quoted-escaped; the address itself is always the node's configured from.
        const fromHeader = opts?.fromName ? `"${opts.fromName.replaceAll('"', "'")}" <${from}>` : from;
        await withRetry(
          () => transporter.sendMail({
            from: fromHeader, to, subject, html, text,
            replyTo: opts?.replyTo,
            attachments: attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
          }),
          subject,
          'outbound',
        );
        logger.info(`Email sent successfully: ${subject}`);   // never log addresses (privacy)
        getStats()?.incrementTyped('email_sent', 'outbound');
        return true;
      } catch (err) {
        logger.error(`Email send failed after retries: ${subject}`, { error: (err as Error).message });
        getStats()?.incrementTyped('email_failed', 'outbound');
        return false;
      }
    },
  };
}
