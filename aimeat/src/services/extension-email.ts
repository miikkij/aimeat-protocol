/**
 * @file src/services/extension-email.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The sandbox's `ctx.email` capability: the tiered rule for who an extension may email,
 *   and the stand-in for a road that cannot send mail. Moved out of services/extension-ctx.ts by pure
 *   extraction (max-file-lines); extension-ctx.ts re-exports both names, so every importer resolves
 *   unchanged.
 * @structure buildExtensionEmail() · MULTI_RECIPIENT_REFUSAL · isSingleRecipient() · unavailableEmail()
 * @usage email: buildExtensionEmail({ storage, config, extName, extConfig, ownerName, emailService })
 * @version-history
 *   v1.1.0 — 2026-10-25 — One message names one recipient: a `to` with several addresses is refused
 *     with a sentence telling the script to send one per recipient, so each recipient passes its own
 *     tier check. A send the tiers allow draws on the account's hourly allowance, the operator setting
 *     extensions.email_per_hour (200 by default, 0 no limit); past it the send is refused naming the
 *     setting (secaudit2026oct22, lead 325).
 *   v1.0.0 — 2026-10-25 — Moved from services/extension-ctx.ts. Tier 1 asks extensionConsentHolds
 *     (services/extension-consent.ts): the consent counts only when granted at or after the current
 *     extension's install and not expired, so a new install of a freed name inherits no earlier
 *     consent (secaudit2026oct22, extension-uninstall:name-keyed-consents-survive-reinstall).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { ExtensionCtx } from './extension-runtime.js';
import type { EmailService } from './email.js';
import { logger } from '../utils/logger.js';
import { extensionConsentHolds } from './extension-consent.js';
import { rateBuckets } from './rate-buckets.js';
import { EXT_EMAIL_PER_HOUR_DEFAULT } from '../config-extension-load.js';

/**
 * The tiered email capability, which is the one place a sandboxed script can reach a stranger.
 * Three ways to be allowed, checked in this order:
 *   Tier 2 — the operator set `emailPolicy: 'unrestricted'` on this extension's config. Only the
 *            operator can write that, and manifest config strips `__` keys, so a guest cannot.
 *   Tier 0 — the recipient IS the owner's own verified notification address.
 *   Tier 1 — the owner granted an `extension_email` consent naming this extension.
 * Anything else is refused and logged. Written once here because it was written three times before,
 * and a rule about who may be emailed is not a thing to keep re-deriving.
 */
export function buildExtensionEmail(deps: {
    storage: Storage;
    config: AimeatConfig;
    extName: string;
    extConfig: Record<string, unknown> | undefined;
    /** Bare owner name whose consents and verified address decide the answer. */
    ownerName: string;
    emailService: EmailService | undefined;
}): NonNullable<ExtensionCtx['email']> {
    const { storage, config, extName, extConfig, ownerName, emailService } = deps;
    const ownerGhii = ownerName.includes('@') ? ownerName : `${ownerName}@${config.nodeId}`;
    // A send the tier rule allowed: the account's allowance first, then the mail service.
    const send = (to: string, subject: string, body: string): Promise<boolean> => {
        takeExtensionEmail(config, ownerGhii);
        return emailService!.sendNotification(to, subject, body);
    };
    return async (to, subject, body) => {
        // One message names one recipient, so each recipient passes its own tier check below
        // (secaudit2026oct22, lead 325). Refused before anything else, with what to do instead.
        if (!isSingleRecipient(to)) throw new Error(MULTI_RECIPIENT_REFUSAL);
        if (!emailService?.enabled) {
            logger.warn(`[ext:${extName}] Email not available (SMTP not configured)`);
            return false;
        }
        if (extConfig?.emailPolicy === 'unrestricted') {
            return send(to, subject, body);
        }
        const ghiiRec = await storage.getGHII(ownerGhii);
        if (ghiiRec?.notificationEmail === to && ghiiRec.emailVerifiedAt) {
            return send(to, subject, body);
        }
        // A consent to the extension installed under this name now, unexpired: an earlier install's
        // consent does not pass to the next one (services/extension-consent.ts; secaudit2026oct22).
        if (await extensionConsentHolds(storage, ownerGhii, 'extension_email', extName)) {
            return send(to, subject, body);
        }
        logger.warn(`[ext:${extName}] Email blocked: no authorization for recipient`);
        return false;
    };
}

/** What a script is told when its `to` names more than one recipient. */
export const MULTI_RECIPIENT_REFUSAL = 'INVALID_INPUT: ctx.email sends one message to one recipient, and "to" names several. '
    + 'Send one message per recipient: call ctx.email once for each address.';

/**
 * Whether `to` names exactly one address, the way a mail library splits a recipient list: quoted
 * display names and comments set aside, no list separator (`,` `;`), no group (`:`), no line break,
 * and one `@`. `"Smith, John" <john@example.com>` is one recipient.
 */
export function isSingleRecipient(to: unknown): boolean {
    if (typeof to !== 'string') return false;
    const bare = to.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/\([^()]*\)/g, '');
    return !/[,;:\r\n]/.test(bare) && (bare.match(/@/g)?.length ?? 0) === 1;
}

/** One fixed one-hour window per account, the arithmetic every limiter on this node shares. */
const emailHour = rateBuckets(60 * 60_000);

/**
 * Count one ctx.email send against the account, or throw the refusal that names the setting. The
 * allowance is the operator setting extensions.email_per_hour (200 by default, 0 no limit), shared by
 * every extension that sends for the account (secaudit2026oct22, lead 325).
 */
function takeExtensionEmail(config: AimeatConfig, accountGhii: string): void {
    const max = config.extensionEmailPerHour ?? EXT_EMAIL_PER_HOUR_DEFAULT;
    if (max <= 0) return;
    const counted = emailHour(accountGhii, max);
    if (!counted.ok) {
        throw new Error(`RATE_LIMITED: this account's extensions have sent ${max} emails in the last hour, the most this server allows `
            + `(the operator setting extensions.email_per_hour). Try again in ${counted.retryAfterSec} seconds, or ask the operator to raise the setting.`);
    }
}

/** An email capability for a road that genuinely cannot send one. Returns false rather than being
 *  absent, so a script that calls `ctx.email(…)` gets the answer it always got instead of a
 *  TypeError. MCP uses this. */
export function unavailableEmail(extName: string, reason: string): NonNullable<ExtensionCtx['email']> {
    return async () => {
        logger.warn(`[ext:${extName}] Email not available (${reason})`);
        return false;
    };
}
