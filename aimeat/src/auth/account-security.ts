/**
 * @file src/auth/account-security.ts
 * @description The three questions about a principal that are not "which account is this". Which
 *   PRINCIPAL of that account is calling (isOwnerPrincipal), whose SOFTWARE it is
 *   (isThirdPartyPrincipal), and the door that refuses everything but the first
 *   (requireOwnerPrincipal). Extracted from ./middleware.ts to satisfy max-file-lines; the bodies
 *   and their docblocks moved unchanged, and middleware.ts re-exports all three, so every existing
 *   import keeps working.
 * @version-history
 *   v1.0.0 — 2026-09-12 — Pure extraction from src/auth/middleware.ts (max-file-lines), on the day
 *     isThirdPartyPrincipal joined the family and pushed that file past 800.
 */
import type { Request, Response, NextFunction } from 'express';
import { ACCOUNT_SECURITY_SCOPE } from '../utils/scope-coverage.js';
import { logger } from '../utils/logger.js';
import { deny401, deny403 } from './deny.js';

/**
 * Require a principal that IS the account holder, rather than something acting on the account
 * holder's behalf. For the doors that decide who can get back INTO the account: the password, the
 * recovery address, the second factor, the identity proof, and deleting or exporting everything.
 *
 * WHY NOT requireRole('owner'). The `owner` role does not say which principal is calling. The agent
 * branch of POST /v1/auth/token used to mint an agent session carrying the human's owner (and
 * operator) roles, and the August 2026 audit removed that in the same run.
 *
 * NO MINT DOES IT ANY MORE, as of 2026-09-06, and the sentence that stood here naming the two
 * unauthenticated mints in routes/ghii/web-verify.ts was out of date: both have issued ['agent']
 * since August. The last one was POST /v1/setup/init, which minted ['agent','owner','operator'] onto
 * a token whose `sub` was an agent GAII; it issues an owner session now.
 *
 * WHICH CHANGES NOTHING ABOUT WHY THIS GATE IS SPELLED OUT. Every one of those was found after it
 * shipped, by somebody reading a mint rather than by a check. The exclusions below hold regardless
 * of who starts copying roles onto whom next, and that is the whole reason not to lean on a role
 * name here.
 *
 * WHY NOT "does the token carry a session id". A Personal Access Token the human minted for their
 * own browser produces owner tokens with NO session id (the PAT branch of POST /v1/auth/refresh),
 * so that test would sign real people out of their own account settings. An owner-level PAT passes
 * here, and that is correct: it is a credential the human created behind requireRole('owner').
 *
 * WHAT IS EXCLUDED. `agent` and `ecosystem` are external principals with their own identity; `app`
 * is a published app holding a scoped grant. All three carry the HUMAN's account name in
 * `req.auth.owner`, which is what every handler under /v1/ghii keys off, so without this gate all
 * three land on the human's record: set a password on an account that has none and then sign in as
 * them, point the recovery address at a mailbox they control and mail themselves a reset code, or
 * arm a second factor with a secret the human never sees.
 *
 * The one way in for an external principal is ACCOUNT_SECURITY_SCOPE, granted per agent by the
 * owner in the agent permission editor. It is tested as the EXACT string: no wildcard carries it
 * (utils/scope-coverage.ts), and no existing agent was grandfathered onto it, so an agent is here
 * only because the owner ticked that one box. An `app` is refused whatever it holds — an app grant
 * is consent to use the account, never consent to take it over — and the word is deliberately
 * absent from APP_GRANTABLE_SCOPES so an app cannot ask for it either.
 */
/**
 * The test requireOwnerPrincipal() makes, as a value rather than a door.
 *
 * A handler whose OTHER branch is legitimately open cannot take the middleware — POST
 * /v1/invitations/:token/accept is the first of those: the anonymous branch is how a person
 * registers from an emailed link, and it must stay open, while the signed-in branch joins an
 * existing account to an organism and should not be reachable by a machine acting in that person's
 * name. Such a handler asks this instead of restating the test, because the docblock above says what
 * a near-copy costs: three copies of the scope test once lived in this file and none of them knew
 * about the exception the vocabulary module was written to hold.
 */
export function isOwnerPrincipal(auth: Request['auth'] | undefined): boolean {
  if (!auth) return false;
  const roles = auth.roles;
  const isApp = roles.includes('app');
  if (roles.includes('owner') && !isApp && !roles.includes('agent') && !roles.includes('ecosystem')) return true;
  // Exact string, no wildcard. scope-coverage.ts enforces the same rule everywhere a scope is
  // proposed or approved; this line is that rule at the door itself.
  return !isApp && (auth.scopes ?? []).includes(ACCOUNT_SECURITY_SCOPE);
}

/**
 * Whose SOFTWARE is this, as opposed to whose NAME it acts under.
 *
 * `req.auth.owner` answers which person a principal acts for, and it is the right instrument for
 * every question of the form "may this caller reach that person's data". It cannot answer a second
 * question that some READ doors need: a person's own agent and a product some company published
 * both arrive carrying that person's name, and the person's relationship to the two is not the
 * same. An agent is theirs. An `app` grant or an `ecosystem` token is code somebody else wrote,
 * which they approved for a purpose and can revoke.
 *
 * Use it where a response has a half that is fine for a person's own machinery and wrong for a
 * third party's, and pair it with isOwnerPrincipal() so the person can still hand that half over
 * deliberately with ACCOUNT_SECURITY_SCOPE. It is NOT an authorization gate on its own: it says
 * nothing about which person is being read, and a door that skips the owner comparison is open
 * whatever this returns.
 */
export function isThirdPartyPrincipal(auth: Request['auth'] | undefined): boolean {
  if (!auth) return false;
  return auth.roles.includes('app') || auth.roles.includes('ecosystem');
}

export function requireOwnerPrincipal() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      deny401(req, res, 'Authentication required');
      return;
    }
    if (isOwnerPrincipal(req.auth)) {
      next();
      return;
    }
    logger.warn(`[account-security-denied] ${req.auth.sub} on ${req.method} ${req.path}`);
    deny403(req, res, 'ACCESS_DENIED', 'This changes how the account is signed into, so it is reserved to the account holder. ' +
      `An agent needs the "${ACCOUNT_SECURITY_SCOPE}" permission, which the owner grants per agent.`);
  };
}
