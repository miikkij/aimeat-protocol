/**
 * @file src/auth/stream-credential.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The credential a long-lived connection was opened with, kept so the connection can ask
 *   later whether the node still honours it. A live event stream (routes/sse.ts) verifies its
 *   credential once, when its ticket is minted; this is the question it asks again while it runs, so
 *   a sign-out, a password change, a deleted agent, a revoked app grant or a deactivated account ends
 *   the stream (secaudit2026oct22, events-stream-outlives-revoked-credential). A token that merely
 *   expired is not a revocation here: the stream ends when the client closes it, as before.
 * @structure StreamCredential · streamCredentialOf(token) · streamCredentialRevoked(storage, cred)
 * @usage
 *   const credential = await streamCredentialOf(bearerToken);         // at ticket mint
 *   if (credential && await streamCredentialRevoked(storage, credential)) closeTheStream();
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22).
 */
import type { Storage } from '../storage/interface.js';
import { verifyJWT, type VerifiedToken } from './jwt.js';
import { credentialRevoked } from './credential-revoked.js';
import { resolvePat, PAT_PREFIX } from '../services/access-token.js';

/** The bearer value and, for a JWT, what it verified to when the connection opened. */
export interface StreamCredential {
  token: string;
  /** The verified claims of a JWT; absent for a personal access token, which storage answers for. */
  verified?: VerifiedToken;
}

/** The credential to keep for a connection opened with `token`, or null when it is neither kind. */
export async function streamCredentialOf(token: string | null | undefined): Promise<StreamCredential | null> {
  if (!token) return null;
  if (token.startsWith(PAT_PREFIX)) return { token };
  const verified = await verifyJWT(token);
  return verified ? { token, verified } : null;
}

/**
 * Whether the node has stopped honouring this credential: credentialRevoked() for a JWT (the token,
 * its session, its app grant, its ecosystem app, its agent, its account, a visitor's home peer), and
 * for a personal access token whether it still resolves.
 */
export async function streamCredentialRevoked(storage: Storage, cred: StreamCredential): Promise<boolean> {
  if (!cred.verified) return !(await resolvePat(storage, cred.token));
  return credentialRevoked(cred.token, cred.verified);
}
