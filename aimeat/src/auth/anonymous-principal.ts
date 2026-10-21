/**
 * @file src/auth/anonymous-principal.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Is this caller the node's shared anonymous principal? Answered from the IDENTITY, not
 *   only from the `anonymous` flag, and a route gate that refuses it.
 *
 *   WHY THE FLAG IS NOT ENOUGH. Two credentials stand for the shared anonymous principal. The identity
 *   optionalAuth injects for a request with no credential carries `anonymous: true`. The token that
 *   POST /v1/auth/anonymous mints carries no such claim (issueJWT does not sign it), so a guard that
 *   reads only `req.auth.anonymous` takes that token for an ordinary agent. The minted token is kept
 *   that way on purpose: requireAuth() refuses every flagged credential, and anonymous mode advertises
 *   POST /v1/memory and the anonymous/* storage upload with that token (test/e2e-anonymous.ts). Signing
 *   the claim would refuse those flows on every route. So a route that is for signed-in members only
 *   asks this question instead, and it answers for both credentials.
 *
 *   The identity is the one service-init.ts makes for the mode: the agent `shared#anonymous@<node>`
 *   of the account `anonymous`. That account name is reserved (utils/gaii.ts RESERVED_NAMES), so no
 *   person holds it, and a token minted while the mode was on is still recognised after the operator
 *   switches the mode off.
 * @structure ANONYMOUS_ACCOUNT · isAnonymousPrincipal(auth) · refuseAnonymousPrincipal(message?)
 * @usage router.get('/v1/catalogue/directory', requireAuth(), refuseAnonymousPrincipal(), requireScope('catalogue:read'), handler)
 * @version-history
 *   v1.1.0 — 2026-10-21 — Every guard that read only the `anonymous` flag asks this instead (the board
 *     roster and read routes, the agent card, the app legal pages, the device-auth approver, the
 *     member list, the profile and owner rosters, the bearer refresh, the requireOwnerPrincipal,
 *     operator, mailbox, REST-scope and AI-call 401s, and the other readers listed in the E1 report).
 *     requireAuth(), callerOf() and the classification reader kind keep the flag on purpose: the
 *     minted token is the principal that writes anonymous.* memory and storage.
 *   v1.0.0 — 2026-10-20 — Initial: the people directory refuses the minted anonymous token on REST and
 *     MCP (secaudit 2026-10, jwt.ts:issueJWT:anonymous-claim-not-signed).
 */
import type { Request, Response, NextFunction } from 'express';
import { isForeignPrincipal, localAccountOf } from '../utils/gaii.js';
import { getAnonymousCredentials } from './node-auth.js';
import { deny401 } from './deny.js';

/** The account the shared anonymous identity is made under (server-bootstrap/service-init.ts). */
export const ANONYMOUS_ACCOUNT = 'anonymous';

/** The fields of a verified token, or of an MCP session's principal, that this question reads. */
export interface AnonymousPrincipalView {
  sub?: string;
  owner?: string;
  anonymous?: boolean;
  federated?: boolean;
}

/**
 * True for the shared anonymous principal, whichever credential carries it: the injected identity
 * (flagged), and the token POST /v1/auth/anonymous mints (not flagged). A visitor from another node
 * never is: its `owner` is its home GHII.
 */
export function isAnonymousPrincipal(auth: AnonymousPrincipalView | null | undefined): boolean {
  if (!auth) return false;
  if (auth.anonymous === true) return true;
  if (isForeignPrincipal(auth)) return false;
  const { gaii } = getAnonymousCredentials();
  if (gaii && auth.sub === gaii) return true;
  // The account an MCP session's agent identity names on THIS node, when only the identity is known.
  const account = auth.owner ?? (auth.sub ? localAccountOf(auth.sub) : null);
  return account === ANONYMOUS_ACCOUNT;
}

const SIGNED_IN_ONLY = 'This is for signed-in members. The shared anonymous access of this node does not reach it. '
  + 'Sign in with your own account and try again.';

/**
 * Route gate: 401 AUTH_REQUIRED for the shared anonymous principal. Mount it after requireAuth(),
 * which already refuses the injected identity; this refuses the minted token too.
 */
export function refuseAnonymousPrincipal(message: string = SIGNED_IN_ONLY) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isAnonymousPrincipal(req.auth)) {
      deny401(req, res, message);
      return;
    }
    next();
  };
}

/** The refusal text, for a surface that answers in its own shape (an MCP tool). */
export const ANONYMOUS_PRINCIPAL_REFUSAL = SIGNED_IN_ONLY;
