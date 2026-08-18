/**
 * @file src/services/email-verification-start.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Creates a pending 'registration' email verification (a 15-minute 6-digit code, stored
 *   hashed) and dispatches it when the node has email enabled. Two routes need exactly this and must
 *   stay identical: POST /v1/ghii (register with an address) and POST /v1/ghii/login/attach-email
 *   (an existing account completing one). /v1/ghii/verify-email finalises whichever started it,
 *   setting emailHash + verificationLevel 1.
 * @structure startRegistrationEmailVerification(storage, emailService, ownerName, email, locale?).
 * @usage const { verificationId, emailSent } = await startRegistrationEmailVerification(...);
 * @version-history
 *   v1.0.0 — 2026-08-07 — Lifted out of routes/ghii/register-login.ts when attach-email was split off,
 *     so both callers share one definition instead of the route file owning it.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import type { EmailService } from './email.js';

export async function startRegistrationEmailVerification(
    storage: Storage, emailService: EmailService | undefined,
    ownerName: string, email: string, locale?: string,
): Promise<{ verificationId: string; emailSent: boolean }> {
    const clean = email.toLowerCase().trim();
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const verificationId = randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    await storage.createEmailVerification({
        id: verificationId, ownerName,
        emailHash: createHash('sha256').update(clean).digest('hex'),
        code: createHash('sha256').update(code).digest('hex'),
        purpose: 'registration', status: 'pending', attempts: 0,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), createdAt: now, verifiedAt: null,
    });
    let emailSent = false;
    if (emailService?.enabled) { await emailService.sendVerificationCode(clean, code, locale); emailSent = true; }
    return { verificationId, emailSent };
}
