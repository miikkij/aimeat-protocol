/**
 * @file src/services/two-step-setup.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The setup token of a required two-step enrolment (services/sign-in-policy.ts). When a
 *   password or emailed-link sign-in would succeed for an account the policy covers and the account
 *   has no TOTP armed, the route opens no session: it answers 403 TWO_STEP_SETUP_REQUIRED with a
 *   setup token, and the person enrols at POST /v1/ghii/login/two-step/start and /finish
 *   (routes/ghii/login-two-step.ts).
 *
 *   THE TOKEN. 32 random bytes, base64url. Only its SHA-256 is stored, in the verification-nonce
 *   table under type `two_step_setup`, the shape the emailed link's second factor uses
 *   (routes/ghii/login-link-second-factor.ts). Ten minutes, bound to one account (the payload names
 *   it, and the routes take no account name), single purpose (the type), single use (finish deletes
 *   it, and only the request whose delete removed the row goes on). Start writes the pending secret,
 *   encrypted, into the payload; the nonce table has no update, so the row is written again under the
 *   same key with its first expiry.
 * @structure SETUP_TOKEN_TYPE · SETUP_TOKEN_TTL_MS · SetupTicket · issueSetupToken() · readSetupTicket() ·
 *   storePendingSecret() · spendSetupTicket()
 * @usage const token = await issueSetupToken(storage, ghii, back);
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial (required two-step sign-in, IT review).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Storage, GHIIRecord } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

export const SETUP_TOKEN_TYPE = 'two_step_setup';
export const SETUP_TOKEN_TTL_MS = 10 * 60 * 1000;

/** What a setup token carries. `back` is the checked return address of an emailed link, or null. */
export interface SetupTicket {
  key: string;
  owner: string;
  back: string | null;
  /** The secret start made, encrypted as setupTotp() encrypts it; absent until start runs. */
  pendingSecret?: string;
  expiresAt: string;
}

const tokenKey = (raw: string): string => createHash('sha256').update(raw).digest('hex');

/** Make a setup token for this account and store its hash. Returns the raw token, given once. */
export async function issueSetupToken(storage: Storage, ghii: Pick<GHIIRecord, 'ownerName'>, back: string | null = null): Promise<{ token: string; expiresAt: string }> {
  const raw = randomBytes(32).toString('base64url');
  const now = Date.now();
  const expiresAt = new Date(now + SETUP_TOKEN_TTL_MS).toISOString();
  await storage.createVerificationNonce({
    id: randomUUID(), owner: ghii.ownerName, type: SETUP_TOKEN_TYPE, state: tokenKey(raw), nonce: '', redirectUri: '',
    payload: JSON.stringify({ owner: ghii.ownerName, back }),
    createdAt: new Date(now).toISOString(), expiresAt,
  });
  return { token: raw, expiresAt };
}

/**
 * The live ticket behind a raw token, or null for a token that is malformed, unknown, of another
 * type, or expired (an expired row is deleted here).
 */
export async function readSetupTicket(storage: Storage, raw: unknown): Promise<SetupTicket | null> {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
  const key = tokenKey(raw);
  const row = await storage.getVerificationNonce(key);
  if (!row || row.type !== SETUP_TOKEN_TYPE) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    await storage.deleteVerificationNonce(key);
    return null;
  }
  let p: { owner?: unknown; back?: unknown; pendingSecret?: unknown };
  try {
    p = JSON.parse(row.payload ?? '') as typeof p;
  } catch (err) {
    // A payload that does not parse is a ticket that does not exist; the row is this node's own, so say so.
    logger.warn('two-step-setup: a setup ticket payload did not parse and was read as none', { error: String(err) });
    return null;
  }
  if (typeof p.owner !== 'string' || !p.owner || p.owner !== row.owner) return null;
  return {
    key, owner: p.owner, back: typeof p.back === 'string' ? p.back : null, expiresAt: row.expiresAt,
    ...(typeof p.pendingSecret === 'string' && p.pendingSecret ? { pendingSecret: p.pendingSecret } : {}),
  };
}

/** Keep the secret start made in the ticket, under the same key and with the first expiry. */
export async function storePendingSecret(storage: Storage, ticket: SetupTicket, encryptedSecret: string): Promise<void> {
  const row = await storage.getVerificationNonce(ticket.key);
  if (!row) return;
  await storage.deleteVerificationNonce(ticket.key);
  await storage.createVerificationNonce({
    ...row, id: randomUUID(),
    payload: JSON.stringify({ owner: ticket.owner, back: ticket.back, pendingSecret: encryptedSecret }),
  });
}

/** Spend the ticket. True only for the request whose delete removed the row (single use under a race). */
export async function spendSetupTicket(storage: Storage, ticket: SetupTicket): Promise<boolean> {
  return !!(await storage.deleteVerificationNonce(ticket.key));
}
