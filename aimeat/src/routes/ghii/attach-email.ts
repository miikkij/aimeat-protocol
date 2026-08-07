/**
 * @file src/routes/ghii/attach-email.ts
 * @description POST /v1/ghii/login/attach-email — the way out of a chicken-and-egg: /v1/ghii/email/verify
 *   needs a session, but an account below verificationLevel 1 is held at the EMAIL_NOT_VERIFIED gate and
 *   can never get one. This endpoint re-verifies username+password itself (so nobody attaches an address
 *   to someone else's account), records the email, and sends a code; /v1/ghii/verify-email finalises it.
 *   Split out of register-login.ts, which sat at the max-file-lines cap.
 * @structure registerAttachEmailRoute(router, config, storage, emailService).
 * @usage registerAttachEmailRoute(router, config, storage, emailService);
 * @version-history
 *   v1.0.0 — 2026-08-07 — Extracted verbatim from register-login.ts (behaviour unchanged).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { EmailService } from '../../services/email.js';
import { success, error } from '../../middleware/envelope.js';
import { createHash } from 'node:crypto';
import { verifyPassword } from '../../services/password.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { startRegistrationEmailVerification } from '../../services/email-verification-start.js';

export function registerAttachEmailRoute(
    router: Router,
    config: AimeatConfig,
    storage: Storage,
    emailService: EmailService | undefined,
): void {
    router.post('/v1/ghii/login/attach-email', rateLimit({ max: config.loginRateLimitMax, windowMs: config.loginRateLimitWindowMs }), async (req, res) => {
        const { username, password, email } = req.body ?? {};

        if (!username || typeof username !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'username is required'));
            return;
        }
        if (!password || typeof password !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'password is required'));
            return;
        }
        if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'A valid email is required'));
            return;
        }

        // Accept full GHII — strip @node-id for local lookup (federated accounts are managed by their home node)
        let loginName = username.trim().toLowerCase();
        if (loginName.includes('@')) {
            const atIdx = loginName.indexOf('@');
            const nodePart = loginName.substring(atIdx + 1);
            loginName = loginName.substring(0, atIdx);
            if (nodePart !== config.nodeId) {
                res.status(400).json(error(config.nodeId, 'FEDERATION_UNSUPPORTED',
                    'Email setup must be completed on your home node.'));
                return;
            }
        }

        const ghii = `${loginName}@${config.nodeId}`;
        const ghiiRecord = await storage.getGHII(ghii);
        // Uniform failure for missing account / no password / wrong password — never reveal which.
        if (!ghiiRecord || !ghiiRecord.passwordHash) {
            res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Invalid username or password'));
            return;
        }

        // Per-account password lockout (mirror the login handler)
        if (ghiiRecord.passwordLockedUntil) {
            const lockExpires = new Date(ghiiRecord.passwordLockedUntil).getTime();
            if (Date.now() < lockExpires) {
                res.status(429).json(error(config.nodeId, 'PASSWORD_LOCKED',
                    `Account temporarily locked due to too many failed login attempts. Try again after ${ghiiRecord.passwordLockedUntil}`));
                return;
            }
            await storage.updateGHII(ghii, { passwordFailedAttempts: 0, passwordLockedUntil: undefined });
        }

        const valid = await verifyPassword(password, ghiiRecord.passwordHash);
        if (!valid) {
            const attempts = (ghiiRecord.passwordFailedAttempts ?? 0) + 1;
            const update: Record<string, unknown> = { passwordFailedAttempts: attempts };
            if (attempts >= config.passwordLockoutAttempts) {
                update.passwordLockedUntil = new Date(Date.now() + config.passwordLockoutMinutes * 60_000).toISOString();
            }
            await storage.updateGHII(ghii, update);
            res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Invalid username or password'));
            return;
        }
        if (ghiiRecord.passwordFailedAttempts) {
            await storage.updateGHII(ghii, { passwordFailedAttempts: 0, passwordLockedUntil: undefined });
        }

        // This endpoint is only for accounts still short of email verification. Once verified there is
        // nothing to complete — the user should just log in.
        if (ghiiRecord.verificationLevel >= 1) {
            res.status(409).json(error(config.nodeId, 'ALREADY_VERIFIED',
                'This account is already verified. Please sign in.'));
            return;
        }

        const normalizedEmail = email.toLowerCase().trim();
        const emailHash = createHash('sha256').update(normalizedEmail).digest('hex');

        // Reject if the email already belongs to a different account (email is a recovery handle).
        const emailOwner = await storage.getGHIIByEmailHash(emailHash);
        if (emailOwner && emailOwner.ghii !== ghii) {
            res.status(409).json(error(config.nodeId, 'EMAIL_TAKEN',
                'That email is already associated with another account.'));
            return;
        }

        // Attach the email now so notification/recovery work once the code is confirmed. emailHash +
        // verificationLevel are finalised by /v1/ghii/verify-email on a correct code.
        await storage.updateGHII(ghii, { notificationEmail: normalizedEmail, magicLinkEnabled: true });

        const { verificationId: verId, emailSent } = await startRegistrationEmailVerification(
            storage, emailService, loginName, normalizedEmail, ghiiRecord.locale);

        res.json(success(config.nodeId, {
            ok: true,
            verification_id: verId,
            email_sent: emailSent,
            message: 'Verification code sent',
        }, [
            { description: 'Confirm the code to finish setup', method: 'POST', url: '/v1/ghii/verify-email' },
        ]));
    });
}
