/**
 * @file src/services/extension-email.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The sandbox's `ctx.email` capability: the tiered rule for who an extension may email,
 *   and the stand-in for a road that cannot send mail. Moved out of services/extension-ctx.ts by pure
 *   extraction (max-file-lines); extension-ctx.ts re-exports both names, so every importer resolves
 *   unchanged.
 * @structure buildExtensionEmail() · unavailableEmail()
 * @usage email: buildExtensionEmail({ storage, config, extName, extConfig, ownerName, emailService })
 * @version-history
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
    return async (to, subject, body) => {
        if (!emailService?.enabled) {
            logger.warn(`[ext:${extName}] Email not available (SMTP not configured)`);
            return false;
        }
        if (extConfig?.emailPolicy === 'unrestricted') {
            return emailService.sendNotification(to, subject, body);
        }
        const ownerGhii = ownerName.includes('@') ? ownerName : `${ownerName}@${config.nodeId}`;
        const ghiiRec = await storage.getGHII(ownerGhii);
        if (ghiiRec?.notificationEmail === to && ghiiRec.emailVerifiedAt) {
            return emailService.sendNotification(to, subject, body);
        }
        // A consent to the extension installed under this name now, unexpired: an earlier install's
        // consent does not pass to the next one (services/extension-consent.ts; secaudit2026oct22).
        if (await extensionConsentHolds(storage, ownerGhii, 'extension_email', extName)) {
            return emailService.sendNotification(to, subject, body);
        }
        logger.warn(`[ext:${extName}] Email blocked: no authorization for recipient`);
        return false;
    };
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
