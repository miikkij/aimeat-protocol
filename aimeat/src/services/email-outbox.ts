/**
 * @file src/services/email-outbox.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One mail through the node's own SMTP transport, with its retries kept in the stored
 *   outbox (services/outbox.ts) so a restart inside the retry window resumes them. The schedule
 *   (1 s, 3 s, 9 s), the log lines and the counters (email_sent, email_retried, email_failed) are
 *   the ones services/email.ts had in withRetry, unchanged.
 *
 *   THE STORED MAIL IS ENCRYPTED. A waiting mail can hold a sign-in link or a verification code, so
 *   it is stored only as ciphertext bound to its outbox entry (encryption.ts encryptBound), and only
 *   while it waits: the entry is deleted when the mail is sent or the last attempt failed. A node
 *   without an encryption key, or a service made without storage, retries in memory as before.
 * @structure EmailAttachment · MailPayload · createMailSender
 * @usage
 *   const sendMail = createMailSender(transporter, { config, storage });
 *   const ok = await sendMail({ from, to, subject, html, text, type: 'notification' });
 * @version-history
 *   v1.0.0 -- 2026-11-04 -- Initial (codebase analysis 2026-11-03, HA stage 1 item 1.5).
 */
import type { Transporter } from 'nodemailer';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { getStats } from './stats.js';
import { encryptBound, decryptBound, getEncryptionKey } from './encryption.js';
import { deliverWithRetries, registerOutboxHandler } from './outbox.js';

const RETRY_DELAYS = [1_000, 3_000, 9_000]; // exponential backoff: 1s, 3s, 9s

/** Long enough for nodemailer's own timeouts on one attempt, so a slow send is not taken over. */
const MAIL_LEASE_MS = 3 * 60_000;

/** A file attached to a mail (services/email.ts sendWithAttachments re-exports this type). */
export interface EmailAttachment {
    filename: string;
    content: Buffer;
    contentType: string;
}

export interface MailPayload {
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
    /** The counter's type (verification, notification, outbound, ...). */
    type: string;
    replyTo?: string | null;
    headers?: Record<string, string>;
    attachments?: EmailAttachment[];
    /** The last attempt's error, for the final log line. Not stored. */
    lastError?: string;
}

interface SealedAttachment { filename: string; contentType: string; content: string }

const contextOf = (id: string) => `outbox:mail:${id}`;

/**
 * The send function of one email service. With `storage`, the retries are kept in the stored outbox;
 * without it (a service made for one request) they run in memory.
 */
export function createMailSender(
    transporter: Transporter, deps: { config: AimeatConfig; storage?: Storage | null },
): (mail: MailPayload) => Promise<boolean> {
    const key = getEncryptionKey(deps.config);
    registerOutboxHandler<MailPayload>('mail', {
        delays: RETRY_DELAYS,
        leaseMs: MAIL_LEASE_MS,
        async attempt(m) {
            try {
                await transporter.sendMail({
                    from: m.from, to: m.to, subject: m.subject, html: m.html, text: m.text,
                    ...(m.replyTo ? { replyTo: m.replyTo } : {}),
                    ...(m.headers && Object.keys(m.headers).length ? { headers: m.headers } : {}),
                    ...(m.attachments ? { attachments: m.attachments.map(a => ({ filename: a.filename, content: a.content, contentType: a.contentType })) } : {}),
                });
            } catch (err) {
                // A failed attempt: the retry's own log line follows (onRetry), or the final one.
                m.lastError = (err as Error).message;
                logger.debug(`Email attempt failed: ${m.subject}`, { error: m.lastError });
                return false;
            }
            // Never log email addresses (privacy)
            logger.info(`Email sent successfully: ${m.subject}`);
            getStats()?.incrementTyped('email_sent', m.type);
            return true;
        },
        onRetry(m, attemptNo, delay) {
            logger.warn(`Email send failed (${m.subject}), retry ${attemptNo}/${RETRY_DELAYS.length} in ${delay}ms`);
            getStats()?.incrementTyped('email_retried', m.type);
        },
        async onExhausted(m) {
            // Never log email addresses (privacy)
            logger.error(`Email send failed after retries: ${m.subject}`, { error: m.lastError });
            getStats()?.incrementTyped('email_failed', m.type);
        },
        seal(m, id) {
            if (!key) return null;
            const rest: Partial<MailPayload> = { ...m };
            delete rest.lastError;
            delete rest.attachments;
            const attachments = m.attachments;
            const sealedAttachments: SealedAttachment[] | undefined = attachments?.map(a => ({
                filename: a.filename, contentType: a.contentType, content: a.content.toString('base64'),
            }));
            return { sealed: encryptBound(JSON.stringify({ ...rest, ...(sealedAttachments ? { attachments: sealedAttachments } : {}) }), key, contextOf(id)) };
        },
        open(stored, id) {
            if (!key) throw new Error('no encryption key to open a stored mail');
            const sealed = (stored as { sealed?: unknown } | null)?.sealed;
            if (typeof sealed !== 'string') throw new Error('not a stored mail');
            const { attachments, ...plain } = JSON.parse(decryptBound(sealed, key, contextOf(id))) as Omit<MailPayload, 'attachments'> & { attachments?: SealedAttachment[] };
            return {
                ...plain,
                ...(attachments ? { attachments: attachments.map(a => ({ filename: a.filename, contentType: a.contentType, content: Buffer.from(a.content, 'base64') })) } : {}),
            };
        },
    });
    return (mail) => deliverWithRetries(deps.storage ?? null, deps.config.nodeId, 'mail', mail);
}
