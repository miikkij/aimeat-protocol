/**
 * @file src/routes/ghii/recovery.ts
 * @description GHII email-verification, password reset/change, and account recovery routes:
 *   POST /v1/ghii/email/verify, /email/confirm, /password/reset-request, /password/reset,
 *   /password/change, /account/recover. Extracted from src/routes/ghii.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/ghii.ts (max-file-lines)
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { EmailService } from '../../services/email.js';
import { requireAuth } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { emitChange } from '../../services/event-bus.js';
import { createHash, randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from '../../services/password.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { logger } from '../../utils/logger.js';
import { validatePasswordStrength } from '../../utils/password-validation.js';

export function registerRecoveryRoutes(
    router: Router,
    config: AimeatConfig,
    storage: Storage,
    emailService: EmailService | undefined,
): void {
    // ── Phase 1.4 — Email Verification, Password Reset, Account Recovery ──

    // POST /v1/ghii/email/verify — Send verification code to verify email (auth required)
    router.post('/v1/ghii/email/verify', requireAuth(), rateLimit({ max: 3, windowMs: 10 * 60 * 1000 }), async (req, res) => {
        const ownerName = req.auth!.owner;
        const { email } = req.body ?? {};

        if (!email || typeof email !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'email is required'));
            return;
        }

        // Basic email format validation
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Invalid email format'));
            return;
        }

        const ghiiRecord = await storage.getGHIIByOwner(ownerName);
        if (!ghiiRecord) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No GHII profile found'));
            return;
        }

        const normalizedEmail = email.toLowerCase().trim();
        const emailHash = createHash('sha256').update(normalizedEmail).digest('hex');
        const code = String(Math.floor(100000 + Math.random() * 900000));
        const codeHash = createHash('sha256').update(code).digest('hex');
        const now = new Date().toISOString();
        const verId = randomBytes(16).toString('hex');

        await storage.createEmailVerification({
            id: verId,
            ownerName,
            emailHash,
            code: codeHash,
            purpose: 'email_verification',
            status: 'pending',
            attempts: 0,
            expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min
            createdAt: now,
            verifiedAt: null,
        });

        // Store notificationEmail on GHII so we know what email to associate after confirmation
        const ghii = `${ownerName}@${config.nodeId}`;
        await storage.updateGHII(ghii, { notificationEmail: normalizedEmail });

        // Send verification email if service is available
        if (emailService?.enabled) {
            const locale = ghiiRecord.locale;
            await emailService.sendVerificationCode(normalizedEmail, code, locale);
        }

        res.json(success(config.nodeId, {
            ok: true,
            message: 'Verification code sent',
            verification_id: verId,
        }));
    });

    // POST /v1/ghii/email/confirm — Confirm email verification code (auth required)
    router.post('/v1/ghii/email/confirm', requireAuth(), async (req, res) => {
        const ownerName = req.auth!.owner;
        const { code, verification_id } = req.body ?? {};

        if (!code || typeof code !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'code is required'));
            return;
        }

        // Find the most recent pending email_verification for this owner
        let record;
        if (verification_id && typeof verification_id === 'string') {
            record = await storage.getEmailVerification(verification_id);
            if (record && record.ownerName !== ownerName) record = null;
        } else {
            record = await storage.getActiveEmailVerification(ownerName, 'email_verification');
        }

        if (!record || record.status !== 'pending') {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No pending verification found'));
            return;
        }

        if (new Date(record.expiresAt).getTime() < Date.now()) {
            await storage.updateEmailVerification(record.id, { status: 'expired' });
            res.status(400).json(error(config.nodeId, 'EXPIRED', 'Verification code has expired'));
            return;
        }

        if (record.attempts >= 5) {
            res.status(429).json(error(config.nodeId, 'TOO_MANY_ATTEMPTS', 'Too many failed attempts'));
            return;
        }

        const codeHash = createHash('sha256').update(code).digest('hex');
        if (codeHash !== record.code) {
            await storage.updateEmailVerification(record.id, { attempts: record.attempts + 1 });
            res.status(400).json(error(config.nodeId, 'INVALID_CODE', 'Invalid verification code'));
            return;
        }

        // Mark as verified
        const now = new Date().toISOString();
        await storage.updateEmailVerification(record.id, {
            status: 'verified',
            verifiedAt: now,
        });

        // Update GHII with verified email info
        const ghii = `${ownerName}@${config.nodeId}`;
        // Find the email from the verification record's emailHash
        // We store the notificationEmail separately to keep it accessible
        await storage.updateGHII(ghii, {
            emailHash: record.emailHash,
            emailVerifiedAt: now,
            verificationLevel: 1,
            verificationMethod: 'email',
        });

        res.json(success(config.nodeId, {
            ok: true,
            verified: true,
        }));
        emitChange('ghii');
    });

    // POST /v1/ghii/password/reset-request — Request password reset (NO auth)
    router.post('/v1/ghii/password/reset-request', rateLimit({ max: 3, windowMs: 10 * 60 * 1000 }), async (req, res) => {
        const { username } = req.body ?? {};

        if (!username || typeof username !== 'string') {
            // Always return same response to not reveal if account exists
            res.json(success(config.nodeId, {
                ok: true,
                message: 'If account has verified email, code was sent',
            }));
            return;
        }

        const ghii = `${username}@${config.nodeId}`;
        const ghiiRecord = await storage.getGHII(ghii);

        if (ghiiRecord && ghiiRecord.notificationEmail && ghiiRecord.emailVerifiedAt && emailService?.enabled) {
            const code = String(Math.floor(100000 + Math.random() * 900000));
            const codeHash = createHash('sha256').update(code).digest('hex');
            const now = new Date().toISOString();
            const verId = randomBytes(16).toString('hex');

            await storage.createEmailVerification({
                id: verId,
                ownerName: username,
                emailHash: ghiiRecord.emailHash ?? '',
                code: codeHash,
                purpose: 'password_reset',
                status: 'pending',
                attempts: 0,
                expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min
                createdAt: now,
                verifiedAt: null,
            });

            const sent = await emailService.sendVerificationCode(ghiiRecord.notificationEmail, code, ghiiRecord.locale);
            if (sent) {
                logger.info('Password reset code sent successfully');
            } else {
                logger.warn('Password reset code email failed to send');
            }
        } else if (ghiiRecord) {
            logger.info(`Password reset skipped: email=${!!ghiiRecord.notificationEmail} verified=${!!ghiiRecord.emailVerifiedAt} service=${!!emailService?.enabled}`);
        }

        // Always return same response to not reveal if account exists
        res.json(success(config.nodeId, {
            ok: true,
            message: 'If account has verified email, code was sent',
        }));
    });

    // POST /v1/ghii/password/reset — Reset password with code (NO auth)
    router.post('/v1/ghii/password/reset', rateLimit({ max: 3, windowMs: 10 * 60 * 1000 }), async (req, res) => {
        const { username, code, newPassword } = req.body ?? {};

        if (!username || typeof username !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'username is required'));
            return;
        }
        if (!code || typeof code !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'code is required'));
            return;
        }
        if (!newPassword || typeof newPassword !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'newPassword is required'));
            return;
        }

        // Validate password strength
        const pwErr = validatePasswordStrength(newPassword);
        if (pwErr) {
            res.status(400).json(error(config.nodeId, 'WEAK_PASSWORD', pwErr));
            return;
        }

        // Find pending password_reset verification for this user
        const record = await storage.getActiveEmailVerification(username, 'password_reset');
        if (!record || record.status !== 'pending') {
            res.status(400).json(error(config.nodeId, 'INVALID_CODE', 'Invalid or expired reset code'));
            return;
        }

        if (new Date(record.expiresAt).getTime() < Date.now()) {
            await storage.updateEmailVerification(record.id, { status: 'expired' });
            res.status(400).json(error(config.nodeId, 'EXPIRED', 'Reset code has expired'));
            return;
        }

        if (record.attempts >= 5) {
            res.status(429).json(error(config.nodeId, 'TOO_MANY_ATTEMPTS', 'Too many failed attempts'));
            return;
        }

        const codeHash = createHash('sha256').update(code).digest('hex');
        if (codeHash !== record.code) {
            await storage.updateEmailVerification(record.id, { attempts: record.attempts + 1 });
            res.status(400).json(error(config.nodeId, 'INVALID_CODE', 'Invalid reset code'));
            return;
        }

        // Code valid — update password
        const newHash = await hashPassword(newPassword);
        const ghii = `${username}@${config.nodeId}`;
        await storage.updateGHII(ghii, { passwordHash: newHash });

        // Mark verification as used
        await storage.updateEmailVerification(record.id, {
            status: 'verified',
            verifiedAt: new Date().toISOString(),
        });

        res.json(success(config.nodeId, {
            ok: true,
            message: 'Password reset successful',
        }));
        emitChange('ghii');
    });

    // POST /v1/ghii/password/change — Change password (requires auth)
    router.post('/v1/ghii/password/change', requireAuth(), rateLimit({ max: 5, windowMs: 10 * 60 * 1000 }), async (req, res) => {
        const ownerName = req.auth!.owner;
        const { current_password, new_password } = req.body ?? {};

        if (!new_password || typeof new_password !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'new_password is required'));
            return;
        }

        const ghii = `${ownerName}@${config.nodeId}`;
        const ghiiRecord = await storage.getGHII(ghii);
        if (!ghiiRecord) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No GHII profile found'));
            return;
        }

        // Accounts created via OAuth (e.g. Google sign-in) have no password yet. In that
        // case this endpoint sets the initial password — no current password is required,
        // since there is nothing to verify against. Once a password exists, the current
        // one must be supplied and verified.
        if (ghiiRecord.passwordHash) {
            if (!current_password || typeof current_password !== 'string') {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'current_password is required'));
                return;
            }
            const valid = await verifyPassword(current_password, ghiiRecord.passwordHash);
            if (!valid) {
                res.status(401).json(error(config.nodeId, 'WRONG_PASSWORD', 'Current password is incorrect'));
                return;
            }
        }

        const pwErr = validatePasswordStrength(new_password);
        if (pwErr) {
            res.status(400).json(error(config.nodeId, 'WEAK_PASSWORD', pwErr));
            return;
        }

        const newHash = await hashPassword(new_password);
        await storage.updateGHII(ghii, { passwordHash: newHash });

        res.json(success(config.nodeId, {
            ok: true,
            message: 'Password changed successfully',
        }));
        emitChange('ghii');
    });

    // POST /v1/ghii/account/recover — Send username to verified email (NO auth)
    router.post('/v1/ghii/account/recover', rateLimit({ max: 3, windowMs: 10 * 60 * 1000 }), async (req, res) => {
        const { email } = req.body ?? {};

        if (email && typeof email === 'string') {
            const normalizedEmail = email.toLowerCase().trim();
            const emailHash = createHash('sha256').update(normalizedEmail).digest('hex');
            const ghiiRecord = await storage.getGHIIByEmailHash(emailHash);

            if (ghiiRecord && ghiiRecord.notificationEmail && emailService?.enabled) {
                const locale = ghiiRecord.locale;
                const subject = locale === 'fi' ? 'AIMEAT-tilisi käyttäjätunnus' : 'Your AIMEAT Username';
                const body = locale === 'fi'
                    ? `Käyttäjätunnuksesi on: ${ghiiRecord.username}\n\nJos et pyytänyt tätä, voit ohittaa tämän viestin.`
                    : `Your username is: ${ghiiRecord.username}\n\nIf you did not request this, you can safely ignore this email.`;
                await emailService.sendNotification(ghiiRecord.notificationEmail, subject, body);
            }
        }

        // Always return same response to not reveal if account exists
        res.json(success(config.nodeId, {
            ok: true,
        }));
    });
}
