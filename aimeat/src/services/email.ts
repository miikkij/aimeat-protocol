/**
 * Email Service — Phase 1.1
 *
 * SMTP-based email delivery with retry logic and template support.
 * Privacy-first: never logs email addresses.
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
} from './email-templates.js';

export type { MatchSuggestion } from './email-templates.js';

export interface EmailService {
  readonly enabled: boolean;
  sendVerificationCode(to: string, code: string, locale?: string): Promise<boolean>;
  sendMagicLink(to: string, loginUrl: string, locale?: string): Promise<boolean>;
  sendNotification(to: string, subject: string, body: string): Promise<boolean>;
  sendMatchSuggestion(to: string, matches: import('./email-templates.js').MatchSuggestion[], locale?: string): Promise<boolean>;
  sendRaw(to: string, subject: string, html: string, text: string): Promise<boolean>;
}

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
    sendRaw: () => warn('sendRaw'),
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

    async sendRaw(to: string, subject: string, rawHtml: string, rawText: string): Promise<boolean> {
      return send(to, subject, rawHtml, rawText, 'group_send');
    },
  };
}
