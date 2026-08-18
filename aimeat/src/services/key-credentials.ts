/**
 * @file key-credentials.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description First-login credential issuance for provisioned-code ("key") accounts. A code key
 *   provisions an account whose emailed code IS its bootstrap password (see routes/organisms.ts).
 *   That code carries a leading "EXChex-" (a dash) and was never run through the strength validator,
 *   so it is a poor durable password AND its displayed form (an uppercase EXC_VIP_NN display name)
 *   does not match the real login username. On the account's FIRST successful sign-in we therefore
 *   ISSUE durable credentials: a freshly generated, validator-clean, dash-free password that replaces
 *   the code, delivered to the user as the exact login username + password. Delivery is BOTH:
 *     1. returned to the just-authenticated owner in the login response (so the entry surface — e.g.
 *        M-ROOM — can show it, and so it survives a disabled/failed mail transport), and
 *     2. emailed (best effort).
 *   The rotation runs exactly once, gated by the invitation flipping from pending → accepted.
 * @structure IssuedKeyCredentials; issueFirstLoginKeyCredentials(storage, config, ghii).
 * @usage const cred = await issueFirstLoginKeyCredentials(storage, config, ghiiRecord); // null if N/A
 * @version-history
 *   v1.0.0 — 2026-07-07 — Initial (TARGET-011 VIP-session: real login + clear credentials).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, GHIIRecord } from '../storage/interface.js';
import { hashPassword } from './password.js';
import { generateReadablePassword } from '../utils/password-generation.js';
import { getActiveEmailService } from './email.js';
import { logger } from '../utils/logger.js';

export interface IssuedKeyCredentials {
  username: string;   // exact login username (bare owner name), shown verbatim
  password: string;   // freshly issued, validator-clean, dash-free password
  email_sent: boolean;
}

/**
 * If `ghii` is a provisioned-code account signing in for the first time, rotate its bootstrap code to
 * a durable clean password, flip the invitation to accepted (so this happens once), and return the
 * issued credentials (also emailed, best effort). Returns null for any account not created by a code
 * key or already activated. Never throws — a failure here must not break login.
 */
export async function issueFirstLoginKeyCredentials(
  storage: Storage,
  config: AimeatConfig,
  ghii: GHIIRecord,
): Promise<IssuedKeyCredentials | null> {
  try {
    const inv = await storage.getCodeInvitationByProvisionedOwner(ghii.username);
    // Only a code invite whose credentials have NOT yet been issued qualifies. acceptedBy is the
    // once-only gate; we deliberately leave status as 'pending' (code-key activation is derived from
    // lastLoginAt, the per-inviter quota counts pending keys, and the keys list filters on pending —
    // flipping status here would silently free a quota slot and drop the key from that list).
    if (!inv || inv.acceptedBy) return null;

    // Issue the durable credential and rotate the password away from the dash-carrying code.
    const password = generateReadablePassword();
    const passwordHash = await hashPassword(password);
    await storage.updateGHII(ghii.ghii, { passwordHash });

    // Record activation on the invite (acceptedBy/acceptedAt only) — the once-only gate for this
    // rotation, without touching status.
    const now = new Date().toISOString();
    await storage.updateInvitation(inv.id, { acceptedAt: now, acceptedBy: ghii.username });

    // Deliver by email too (best effort — the credentials are already in the login response).
    let emailSent = false;
    const emailSvc = getActiveEmailService();
    const to = ghii.notificationEmail || inv.email;
    if (emailSvc?.enabled && to) {
      const org = inv.organismId ? await storage.getOrganism(inv.organismId) : null;
      emailSent = await emailSvc.sendKeyCredentials(to, {
        username: ghii.username,
        password,
        orgName: org?.name || 'AIMEAT',
        loginUrl: config.baseUrl,
      }, ghii.locale);
    }

    return { username: ghii.username, password, email_sent: emailSent };
  } catch (err) {
    logger.warn('First-login key-credential issuance failed', { error: (err as Error).message });
    return null;
  }
}
