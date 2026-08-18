/**
 * @file src/routes/ghii/recovery.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GHII email-verification, password reset/change, and account recovery routes:
 *   POST /v1/ghii/email/verify, /email/confirm, /password/reset-request, /password/reset,
 *   /password/change, /account/recover. Extracted from src/routes/ghii.ts to satisfy max-file-lines.
 * @version-history
 *   v1.2.0 — 2026-08-11 — Security audit H-1/H-7: the password and the recovery address are behind
 *     requireOwnerPrincipal(). H-5 stopped a repointed address from opening the reset rail on the
 *     PREVIOUS address's verification mark; it left the loop, because the principal that repointed
 *     the address also owns the new mailbox and could confirm it. Every handler here keys off
 *     req.auth.owner, which is the human's account name on an agent, ecosystem or app-grant token.
 *   v1.1.0 — 2026-08-10 — Security audit H-5: changing notificationEmail un-verifies it. The
 *     unauthenticated reset flow mails its code to that address and gates only on emailVerifiedAt,
 *     a mark from the PREVIOUS address, so repointing it was an account-takeover step.
 *   v1.1.0 — 2026-07-19 — email/confirm refuses an email already verified on another account
 *     (EMAIL_TAKEN) — upholding one-email-per-account-per-node ahead of the DB unique index.
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/ghii.ts (max-file-lines)
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { EmailService } from '../../services/email.js';
import { requireAuth, requireOwnerPrincipal } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { emitChange } from '../../services/event-bus.js';
import { createHash, randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from '../../services/password.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { logger } from '../../utils/logger.js';
import { validatePasswordStrength } from '../../utils/password-validation.js';
import { promoteContactsForVerifiedEmail } from '../../services/contacts.js';

export function registerRecoveryRoutes(
    router: Router,
    config: AimeatConfig,
    storage: Storage,
    emailService: EmailService | undefined,
): void {
    // ── Phase 1.4 — Email Verification, Password Reset, Account Recovery ──

    // POST /v1/ghii/email/verify — Send verification code to verify email (account holder only)
    //
    // SECURITY (audit H-7): this writes notificationEmail AND returns the verification id, so one
    // principal could point the recovery address at its own mailbox, confirm it below, and then
    // have the unauthenticated reset rail mail a reset code there. Four calls, ending in a password
    // the person does not know, and it worked from an agent JWT, a GEAI token or an app grant
    // because every one of them carries the human's account name in req.auth.owner.
    router.post('/v1/ghii/email/verify', requireAuth(), requireOwnerPrincipal(), rateLimit({ max: 3, windowMs: 10 * 60 * 1000 }), async (req, res) => {
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

        // Store notificationEmail on GHII so we know what email to associate after confirmation.
        //
        // SECURITY (audit H-5): POST /v1/ghii/password/reset-request mails its code to
        // notificationEmail and gates only on emailVerifiedAt being set — a mark left over from the
        // PREVIOUS address. Writing a new address while that mark stands hands the account to
        // whoever controls the new mailbox, which is why this endpoint was an account-takeover step
        // rather than a settings change. Pointing the address somewhere new therefore un-verifies
        // it, and the recovery rail stays closed until the code below is confirmed. Re-sending to
        // the address already verified changes nothing.
        const ghii = `${ownerName}@${config.nodeId}`;
        const emailChanged = ghiiRecord.emailHash !== emailHash;
        await storage.updateGHII(ghii, {
            notificationEmail: normalizedEmail,
            ...(emailChanged ? { emailVerifiedAt: undefined, magicLinkEnabled: false } : {}),
        });

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

    // POST /v1/ghii/email/confirm — Confirm email verification code (account holder only)
    // The other half of the loop above: confirming is what re-opens the reset rail on the address.
    router.post('/v1/ghii/email/confirm', requireAuth(), requireOwnerPrincipal(), async (req, res) => {
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
        // One-email-per-account-per-node: don't claim an email hash already verified on another account
        // (clean 409 ahead of the DB partial-unique index backstop).
        const emailOwner = await storage.getGHIIByEmailHash(record.emailHash);
        if (emailOwner && emailOwner.ghii !== ghii) {
            res.status(409).json(error(config.nodeId, 'EMAIL_TAKEN', 'That email is already verified on another account.'));
            return;
        }
        // Find the email from the verification record's emailHash
        // We store the notificationEmail separately to keep it accessible
        await storage.updateGHII(ghii, {
            emailHash: record.emailHash,
            emailVerifiedAt: now,
            verificationLevel: 1,
            verificationMethod: 'email',
        });
        // Same binding, same consequence as the signup path: address-book entries that named this
        // address become this person (TARGET-063). Best-effort — recovery must never fail on it.
        await promoteContactsForVerifiedEmail(storage, record.emailHash, ghii)
            .catch(err => { logger.warn('recovery: contact promotion is best-effort', { error: String(err) }); });

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

    // POST /v1/ghii/password/change — Change password (account holder only)
    //
    // SECURITY (audit H-7): the current-password check below is gated on the account HAVING a
    // password, so on an account created through OAuth there was nothing to prove. Any principal of
    // that owner could set the first password and then sign in as the person with it. Closing the
    // passwordless branch itself needs its own design (there is nowhere to send a confirmation on
    // an account with no email); refusing every principal but the account holder closes the reach.
    router.post('/v1/ghii/password/change', requireAuth(), requireOwnerPrincipal(), rateLimit({ max: 5, windowMs: 10 * 60 * 1000 }), async (req, res) => {
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
                res.status(401).json(error(config.nodeId, 'WRONG_PASSWORD', 'That is not your current password. Try again, or reset it if you have forgotten it.'));
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
