/**
 * @file email.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Email service -- SMTP-based email delivery with retry logic, template support,
 *   and privacy-first logging (never logs email addresses). Supports verification codes,
 *   magic links, notifications, invitations, access keys and raw HTML emails.
 * @structure
 *   - EmailService interface (sendVerificationCode, sendMagicLink, sendNotification, sendInvite, sendKeyInvite, sendKeyCredentials, sendRaw, sendWithAttachments)
 *   - the retries: services/email-outbox.ts createMailSender (stored outbox, unchanged schedule)
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
 *   v1.7.0 -- 2026-09-08 -- sendWithAttachments() passes opts.headers to sendMail(). It had taken
 *     the parameter and dropped it since v1.6.0, so an AI disclosure declared on POST
 *     /v1/outbound/send never reached a message sent through the node's own transport, while the
 *     mailbox and company-SMTP paths carried it. Found by test/e2e-email-delivery.ts, the first
 *     suite to run this service at all. Same commit removes sendMatchSuggestion(), which had no
 *     caller anywhere in src/.
 *   2026-10-25 -- sendNotification() renders through textNotificationEmailHtml(): the subject and
 *     body are escaped and line breaks kept (secaudit2026oct22).
 *   2026-10-31 -- sendNotification() takes `replyTo`, which the owner's report mail sets from
 *     email.reply_to (Jouni, 2026-10-31 20.14).
 *   2026-11-04 -- createEmailService(config, storage): with storage, a mail whose first attempt failed
 *     keeps its retries in the stored outbox, so a restart resumes them (email-outbox.ts; codebase
 *     analysis 2026-11-03, HA stage 1 item 1.5). withRetry moved there unchanged in schedule.
 */

import { createTransport, type Transporter } from 'nodemailer';
import type { AimeatConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import type { Storage } from '../storage/interface.js';
import { setNodeEmailFooter } from './email-templates.js';
import { createMailSender } from './email-outbox.js';
import {
  verificationEmailHtml,
  magicLinkEmailHtml,
  textNotificationEmailHtml,
  inviteEmailHtml,
  inviteEmailSubject,
  keyInviteEmailHtml,
  keyInviteEmailSubject,
  keyCredentialsEmailHtml,
  keyCredentialsEmailSubject,
} from './email-templates.js';

// Declared beside the sender that stores it (email-outbox.ts), so the two files do not import each other.
export type { EmailAttachment } from './email-outbox.js';
import type { EmailAttachment } from './email-outbox.js';

export interface EmailService {
  readonly enabled: boolean;
  sendVerificationCode(to: string, code: string, locale?: string): Promise<boolean>;
  sendMagicLink(to: string, loginUrl: string, locale?: string): Promise<boolean>;
  /** `replyTo`: where a reply goes, when not the From address (email.reply_to on an owner's report). */
  sendNotification(to: string, subject: string, body: string, opts?: { replyTo?: string | null }): Promise<boolean>;
  sendInvite(to: string, args: import('./email-templates.js').InviteEmailArgs, locale?: string): Promise<boolean>;
  sendKeyInvite(to: string, args: import('./email-templates.js').KeyInviteEmailArgs, locale?: string): Promise<boolean>;
  sendKeyCredentials(to: string, args: import('./email-templates.js').KeyCredentialsEmailArgs, locale?: string): Promise<boolean>;
  sendRaw(to: string, subject: string, html: string, text: string): Promise<boolean>;
  /** Attachment-carrying send (outbound door / invoice PDFs). Envelope from stays the node's; fromName + replyTo carry the business identity. */
  sendWithAttachments(to: string, subject: string, html: string, text: string, attachments: EmailAttachment[], opts?: { replyTo?: string; fromName?: string; headers?: Record<string, string> }): Promise<boolean>;
}

/**
 * Process-wide handle to the active EmailService, set once during service init. Lets per-request
 * surfaces that aren't threaded the instance (e.g. the agent-task completion hook, B6) reuse the
 * single configured transport instead of constructing a parallel one. Mirrors getActiveScheduler().
 */
let _activeEmailService: EmailService | null = null;
export function setActiveEmailService(svc: EmailService): void { _activeEmailService = svc; }
export function getActiveEmailService(): EmailService | null { return _activeEmailService; }

// ── Retries ──────────────────────────────────────────────
// The retry schedule is unchanged (1 s, 3 s, 9 s; four attempts). The retries run through the stored
// outbox (services/email-outbox.ts) when the service has storage and the node an encryption key, so
// a restart inside the 13 s resumes them; otherwise in memory as before.

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
    sendInvite: () => warn('sendInvite'),
    sendKeyInvite: () => warn('sendKeyInvite'),
    sendKeyCredentials: () => warn('sendKeyCredentials'),
    sendRaw: () => warn('sendRaw'),
    sendWithAttachments: () => warn('sendWithAttachments'),
  };
}

// ── Factory ──────────────────────────────────────────────

export function createEmailService(config: AimeatConfig, storage?: Storage | null): EmailService {
  // The operator's own mail foot, read from the live config at each render (operator.email_footer).
  setNodeEmailFooter(() => config.operator?.emailFooter ?? '');
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

  // One attempt, its retries and their log lines and counters (services/email-outbox.ts).
  const sendMail = createMailSender(transporter, { config, storage });

  async function send(to: string, subject: string, html: string, text: string, type: string, replyTo?: string | null): Promise<boolean> {
    return sendMail({ from, to, subject, html, text, type, ...(replyTo ? { replyTo } : {}) });
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

    async sendNotification(to: string, subject: string, body: string, opts?: { replyTo?: string | null }): Promise<boolean> {
      // Plain text from an extension, an agent or a workflow: escaped, line breaks kept.
      const { html, text } = textNotificationEmailHtml(subject, body);
      return send(to, subject, html, text, 'notification', opts?.replyTo);
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

    async sendWithAttachments(to: string, subject: string, html: string, text: string, attachments: EmailAttachment[], opts?: { replyTo?: string; fromName?: string; headers?: Record<string, string> }): Promise<boolean> {
      // Display name is quoted-escaped; the address itself is always the node's configured from.
      const fromHeader = opts?.fromName ? `"${opts.fromName.replaceAll('"', "'")}" <${from}>` : from;
      return sendMail({
        from: fromHeader, to, subject, html, text, type: 'outbound',
        ...(opts?.replyTo ? { replyTo: opts.replyTo } : {}),
        // The disclosure header rides here. It was accepted in the signature and dropped before
        // the wire until 2026-09-08, so a caller that declared AI authorship on the outbound
        // door got a message with no mark on it, and the two other send paths (a person's own
        // mailbox, a company's SMTP) carried the same header correctly. A disclosure that
        // appears on some paths and not others is worse than none, because it makes the
        // messages without it look human-written.
        ...(opts?.headers && Object.keys(opts.headers).length ? { headers: opts.headers } : {}),
        attachments,
      });
    },
  };
}
