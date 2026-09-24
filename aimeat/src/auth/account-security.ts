/**
 * @file src/auth/account-security.ts
 * @description The three questions about a principal that are not "which account is this". Which
 *   PRINCIPAL of that account is calling (isOwnerPrincipal), whose SOFTWARE it is
 *   (isThirdPartyPrincipal), and the door that refuses everything but the first
 *   (requireOwnerPrincipal). Extracted from ./middleware.ts to satisfy max-file-lines; the bodies
 *   and their docblocks moved unchanged, and middleware.ts re-exports all three, so every existing
 *   import keeps working.
 * @version-history
 *   v1.3.0 — 2026-09-24 — isOwnerPrincipal returns false for a federated session: a visitor from
 *     another node whose name matches a local account is never the account holder, so every
 *     requireOwnerPrincipal door refuses it (secaudit 2026-09: A3-1, A3-3).
 *   v1.2.0 — 2026-09-20 — requireOwnerPrincipal(reason): a door that is not about signing in says
 *     what it is and what the caller's own way in is.
 *   v1.1.0 — 2026-09-14 — isSignedInCaller(auth): is there anybody behind this call, on a node that
 *     hands passers-by a credential. `!req.auth` is not that question in anonymous mode, and two
 *     doors reading a setting called `authenticated` had it wrong.
 *   v1.0.1 — 2026-09-13 — requireOwnerPrincipal's 401 also refuses the anonymous identity.
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
  // A federated session is a visitor from another node whose `owner` is the local part of their home
  // name and may equal a LOCAL account's name (routes/ghii/register-login.ts). It is never the local
  // account holder in person, so it is never an owner principal — this is the root of the
  // namesake-takeover class, closed here for every requireOwnerPrincipal door at once (secaudit
  // 2026-09: A3-1/A3-3). requireRole('owner') refuses it too; a federated visitor's reach is its
  // granted scopes, not the account.
  if (auth.federated) return false;
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
/**
 * Is there a PERSON or an agent behind this call, as opposed to nobody?
 *
 * `!req.auth` is not that question on this node. In anonymous mode the middleware hands every
 * caller with no credential a shared anonymous identity, so `req.auth` is set for a passer-by and
 * the absence test never matches — which is how a setting that says "signed-in callers only"
 * answered anybody who asked. /v1/stats and /v1/metrics both read `authenticated` that way, and the
 * two doors that got it right (owner-mailbox-gate.ts, account-security.ts's own 401) spelled the
 * pair out by hand. Named here so the next door asks the question rather than re-deriving it.
 * Found by the AI triage of 2026-09-13.
 */
export function isSignedInCaller(auth: Request['auth'] | undefined): boolean {
  return !!auth && !auth.anonymous;
}

export function isThirdPartyPrincipal(auth: Request['auth'] | undefined): boolean {
  if (!auth) return false;
  return auth.roles.includes('app') || auth.roles.includes('ecosystem');
}

/**
 * @param reason What this door is, in the person's terms, when "how the account is signed into" is
 *   not what it changes. The default is written for the sign-in doors this gate was built for, and
 *   on any other door it misleads: a decision rule answered it with "an agent needs the
 *   account:security permission", which is true of the gate and the wrong instruction for an agent,
 *   whose way in is to propose. A door that is not about signing in passes its own sentence.
 */
export function requireOwnerPrincipal(reason?: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    // `!req.auth` alone is not the test: optionalAuth runs globally and, in anonymous mode, injects
    // a shared identity, so an unauthenticated caller arrives here truthy. Nobody signed in as
    // nobody changes how an account is signed into (invariant 6).
    if (!req.auth || req.auth.anonymous) {
      deny401(req, res, 'Authentication required');
      return;
    }
    if (isOwnerPrincipal(req.auth)) {
      next();
      return;
    }
    logger.warn(`[account-security-denied] ${req.auth.sub} on ${req.method} ${req.path}`);
    deny403(req, res, 'ACCESS_DENIED', reason
      ?? ('This changes how the account is signed into, so it is reserved to the account holder. '
        + `An agent needs the "${ACCOUNT_SECURITY_SCOPE}" permission, which the owner grants per agent.`));
  };
}
