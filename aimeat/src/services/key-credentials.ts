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
 *     2. emailed (best effort), to the account's own address when the account has proven it.
 *   The rotation runs exactly once, gated by the invitation flipping from pending → accepted.
 *
 *   THE MAIL WAITS FOR A PROVEN ADDRESS. The address a code key names is chosen by whoever minted the
 *   key, and signing in with the key does not prove that the holder reads it, so the credentials mail
 *   is an owner mail like every other mail to the account's address (mail-gate.ts kind `owner`,
 *   owner-mail-address.ts provenOwnerAddress). When the address is not proven at the first sign-in,
 *   the issued password is kept sealed with the node's data key (encryption.ts encryptBound) in the
 *   pseudo-owner namespace NS_HELD, one record per account under HELD_KEY_PREFIX, which the data key's
 *   re-encrypt job lists (key-reencrypt/sources.ts), and the login response says so
 *   (`email_held`, `email_note`). When the account then proves its address (routes/ghii/web-verify.ts,
 *   routes/ghii/recovery.ts), sendHeldKeyCredentials mails it once and deletes the record. A record is
 *   deleted unsent when the account's password changed since it was issued (the mailed password would
 *   no longer sign in), and it lapses after HELD_TTL_HOURS.
 * @structure IssuedKeyCredentials · NS_HELD · HELD_TTL_HOURS · issueFirstLoginKeyCredentials ·
 *   sendHeldKeyCredentials
 * @usage
 *   const cred = await issueFirstLoginKeyCredentials(storage, config, ghiiRecord); // null if N/A
 *   await sendHeldKeyCredentials(storage, config, ghii);                           // after the address is proven
 * @version-history
 *   v1.1.1 — 2026-11-05 — A held record's key is HELD_KEY_PREFIX and the GHII, so the re-encrypt job of
 *     decision 4a lists and reseals it (codebase analysis 2026-11-03, decisions 4a and 14a of 2026-11-05).
 *   v1.1.0 — 2026-11-05 — The credentials mail goes as an owner mail, to the proven address only; an
 *     unproven address holds the password until the address is verified (codebase analysis
 *     2026-11-03, decision 14a of 2026-11-05).
 *   2026-11-04 — The running mail service is read from nodeContext() (services/node-context.ts) in place of
 *     getActiveEmailService (codebase analysis 2026-11-03, item D-i).
 *   v1.0.1 — 2026-11-04 — The credentials mail goes through mail-gate.ts sendMail as sign-in mail
 *     (codebase analysis 2026-11-03, item B3).
 *   v1.0.0 — 2026-07-07 — Initial (TARGET-011 VIP-session: real login + clear credentials).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, GHIIRecord } from '../storage/interface.js';
import type { InvitationRecord } from '../storage/repositories/invitation.repository.js';
import { hashPassword } from './password.js';
import { generateReadablePassword } from '../utils/password-generation.js';
import { nodeContext } from './node-context.js';
import { sendMail, type MailMessage } from './mail-gate.js';
import { getEncryptionKey, encryptBound, decryptBound } from './encryption.js';
import { provenOwnerAddress } from './owner-mail-address.js';
import { logger } from '../utils/logger.js';

export interface IssuedKeyCredentials {
  username: string;   // exact login username (bare owner name), shown verbatim
  password: string;   // freshly issued, validator-clean, dash-free password
  email_sent: boolean;
  /** Present when the mail was not sent because the account's address is not proven yet. */
  email_held?: boolean;
  /** Present with email_held: what happens to the mail, in a sentence the entry surface shows. */
  email_note?: string;
}

/**
 * Pseudo-owner namespace of the held credentials, one record per account. It has no '@', so no memory
 * route or tool addresses it (as services/agent-port-redirect.ts NS_AGENT_PORT).
 */
export const NS_HELD = 'key-credentials-held';

/**
 * The key of an account's held record is this prefix and its GHII. The prefix is what lets the data
 * key's re-encrypt job (key-reencrypt/sources.ts) list every held record, since it lists memory by key
 * prefix.
 */
export const HELD_KEY_PREFIX = 'key-credentials-held.';
export const heldKey = (ghii: string): string => `${HELD_KEY_PREFIX}${ghii}`;

/** How long a held password waits for the address to be verified. */
export const HELD_TTL_HOURS = 30 * 24;

const HELD_NOTE = 'The email with these sign-in details was not sent, because this account\'s email address is not verified yet. '
  + 'It is sent when you verify the address. Keep the password shown here until then.';
const NOT_HELD_NOTE = 'The email with these sign-in details was not sent, because this account\'s email address is not verified yet. '
  + 'Keep the password shown here: this node cannot send it later.';

interface HeldRecord { sealed: string; invitationId: string; passwordHash: string }

/** The context a held password is sealed under: it opens only for this account and this key invitation. */
export const heldContext = (ghii: string, invitationId: string): string => `key-credentials-held:${ghii}:${invitationId}`;

/** The credentials mail, as the first sign-in and the held send both write it. */
async function credentialsMessage(storage: Storage, config: AimeatConfig, inv: InvitationRecord, ghii: GHIIRecord, password: string): Promise<MailMessage> {
  const org = inv.organismId ? await storage.getOrganism(inv.organismId) : null;
  return { form: 'key-credentials', args: {
    username: ghii.username,
    password,
    orgName: org?.name || 'AIMEAT',
    loginUrl: config.baseUrl,
  }, locale: ghii.locale };
}

/** Keep the issued password, sealed, until the account proves its address. False when the node has no data key. */
async function holdCredentials(storage: Storage, config: AimeatConfig, inv: InvitationRecord, ghii: GHIIRecord, password: string, passwordHash: string): Promise<boolean> {
  const key = getEncryptionKey(config);
  if (!key) return false;
  const now = new Date().toISOString();
  const value: HeldRecord = { sealed: encryptBound(password, key, heldContext(ghii.ghii, inv.id)), invitationId: inv.id, passwordHash };
  await storage.setMemory({
    key: heldKey(ghii.ghii), ownerGaii: NS_HELD, value, visibility: 'private', tags: ['system'],
    ttlHours: HELD_TTL_HOURS, version: 1, createdAt: now, updatedAt: now,
  });
  return true;
}

/**
 * If `ghii` is a provisioned-code account signing in for the first time, rotate its bootstrap code to
 * a durable clean password, flip the invitation to accepted (so this happens once), and return the
 * issued credentials (also emailed, best effort, to a proven address; else held until the address is
 * proven). Returns null for any account not created by a code key or already activated. Never throws —
 * a failure here must not break login.
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

    // Deliver by email too (best effort — the credentials are already in the login response), to the
    // account's address when it is proven; otherwise the password waits for the address.
    const emailSvc = nodeContext().email;
    if (!emailSvc?.enabled) return { username: ghii.username, password, email_sent: false };
    const outcome = await sendMail(emailSvc, { kind: 'owner', account: ghii }, await credentialsMessage(storage, config, inv, ghii, password));
    if (outcome !== 'no_address') return { username: ghii.username, password, email_sent: outcome === 'sent' };
    const held = await holdCredentials(storage, config, inv, ghii, password, passwordHash);
    return { username: ghii.username, password, email_sent: false, email_held: held, email_note: held ? HELD_NOTE : NOT_HELD_NOTE };
  } catch (err) {
    logger.warn('First-login key-credential issuance failed', { error: (err as Error).message });
    return null;
  }
}

/**
 * Mail the credentials held for `ghii`, once its address is proven. Called where an address is
 * verified, beside applyAppInvitesForVerifiedEmail, and best-effort in the same way: it never throws.
 * While the address is still not proven the record keeps waiting. Once it is, the record is deleted
 * whatever follows, so the mail goes at most once; nothing is sent when the password changed since it
 * was issued or when the record lapsed. Answers whether a mail left.
 */
export async function sendHeldKeyCredentials(storage: Storage, config: AimeatConfig, ghii: string): Promise<boolean> {
  try {
    const row = await storage.getMemory(NS_HELD, heldKey(ghii));
    if (!row) return false;
    const rec = await storage.getGHII(ghii);
    // Still unproven: the record keeps waiting (the callers call this after the address is proven).
    if (rec && !provenOwnerAddress(rec)) return false;
    await storage.deleteMemory(NS_HELD, heldKey(ghii));
    const held = row.value as HeldRecord | null;
    const lapsed = !!row.createdAt && Date.now() > Date.parse(row.createdAt) + HELD_TTL_HOURS * 3_600_000;
    if (!held?.sealed || lapsed) return false;
    // A password the person has changed since no longer signs in, and is not mailed.
    if (!rec || rec.passwordHash !== held.passwordHash) return false;
    const inv = await storage.getCodeInvitationByProvisionedOwner(rec.username);
    const key = getEncryptionKey(config);
    if (!inv || inv.id !== held.invitationId || !key) return false;
    const password = decryptBound(held.sealed, key, heldContext(ghii, inv.id));
    const emailSvc = nodeContext().email;
    return await sendMail(emailSvc, { kind: 'owner', account: rec }, await credentialsMessage(storage, config, inv, rec, password)) === 'sent';
  } catch (err) {
    logger.warn('Held key-credential mail failed', { error: (err as Error).message });
    return false;
  }
}
