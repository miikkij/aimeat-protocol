/**
 * @file src/auth/middleware.ts
 * @description Express auth middleware — extracts and verifies JWTs / Personal Access Tokens,
 *   attaches the resolved identity to req.auth, and gates routes by presence, role, scope, and
 *   principal type. Supports anonymous-mode fallback and browser PAT-to-cookie session bootstrap.
 *
 * @structure
 *   - initSessionAuth: startup wiring, a node's storage and config filed under its node id
 *     (./node-auth.ts, which also holds enableAnonymousAuth / isAnonymousMode /
 *     getAnonymousCredentials, re-exported here)
 *   - optionalAuth / requireAuth / requireAuthOrAnonymous: presence-level gates
 *   - requireRole / requireScope / requireExternalPrincipal / requireLocalSession: authorization gates
 *   - the account-security family (isOwnerPrincipal, isThirdPartyPrincipal, requireOwnerPrincipal)
 *     lives in ./account-security.ts and is re-exported here
 *   - resolvePatToken / maybeSetPatBrowserSession: Personal Access Token handling
 *   - the refusal path itself (deny401/deny403 and the audit context) lives in ./deny.ts
 *
 * @version-history
 *   2026-10-02 — requireScope notes the words it admitted a `*` agent for (services/scope-use.ts).
 *   2026-09-30 — requireAnyScope tells denyScope403 that any one scope would do (the agent refusal note).
 *   2026-09-29 — resolvePatToken marks the identity `via: 'pat'`, so classification reads it as an AI
 *     (TARGET-082 V4). What the token may do is unchanged.
 *   2026-09-26 — Every read of the storage and the config, and the anonymous fallback, is for the node
 *     the code runs as (./node-auth.ts): initSessionAuth files them under the node id, and a process
 *     that serves more than one node checks each node's credentials against that node's storage.
 *   2026-09-26 — requireAuth asks credentialRevoked of a token it verifies itself, the same questions
 *     optionalAuth asks, so every route gated by requireAuth refuses what optionalAuth refuses, with
 *     or without anonymous mode and however the router is mounted.
 *   2026-09-26 — credentialRevoked asks the account question (accountRefuses): a credential counts
 *     only while an account holds its owner name, the account is not deactivated, and the account is
 *     not newer than the credential (auth/credential-age.ts), in one read per token; an app grant's
 *     token counts from the grant's creation. The ecosystem app check compares to the millisecond
 *     when the token carries its issue time in milliseconds.
 *   2026-09-26 — credentialRevoked asks a fifth question: an ecosystem app's token counts only while
 *     the app record it names is there, active, and not newer than the token (ecosystemAppGone), so
 *     every credential of an app goes with its record, also when its account is deleted.
 *   2026-09-24 — requireOperatorPrincipal asks services/operator-principal.ts askOperator(), the operator
 *     question the tool surface and the services ask too (security audit A8-1). Its refusals and
 *     their codes are the same.
 *   2026-09-24 — Every federated test here is isForeignPrincipal(), the one question (utils/gaii.ts),
 *     and verifyJWT now reads a visitor as role 'federated' named by its home GHII, so these gates
 *     are the second line and the inline role checks elsewhere hold as well (secaudit 2026-09, F-1).
 *   2026-09-24 — requireRole and requireRoleOrScope refuse a federated session as a local role-holder:
 *     the 2026-09-08 requireScope fix covered the scope bypass, but requireRole('owner') still
 *     admitted a visitor from another node whose name matched a local account, and the door-by-door
 *     requireLocalSession sweep never reached the gate itself (secaudit 2026-09: A3-3, A10-1).
 *   2026-09-12 — isThirdPartyPrincipal(auth): whose SOFTWARE a principal is, beside isOwnerPrincipal's
 *     question of whether it may change the account. A read door with a half that suits a person's
 *     own agents and not a published product needed a question `owner` cannot answer, because all
 *     of them carry the person's name. GET /v1/ghii/me is the first caller. Adding it took this
 *     file past 800 lines, so the three account-security functions moved to ./account-security.ts
 *     as a pure extraction and are re-exported from here.
 *   2026-09-08 — requireScope: a federated session gets no owner bypass; its scope list is enforced.
 *   2026-09-06 — withCurrentScopes() (body in ./effective-scopes.ts): an agent's effective scopes are its token's INTERSECTED with
 *     its record's, resolved per request beside the revocation check and for the same stated reason.
 *     A JWT's scope list is a snapshot, a connector holds one for the life of its socket, and an
 *     owner who removed a permission watched it go on being honoured until that token expired — on
 *     every door, with nothing saying so. Intersection never union: a token deliberately narrower
 *     than the record (a scoped PAT, an app grant, a one-job mint) must stay narrow, so a word can
 *     only be taken away here. Adding one still needs a fresh credential.
 *   v1.9.0 — 2026-09-04 — isOwnerPrincipal(auth) is the requireOwnerPrincipal test as a value, and
 *     the middleware now calls it rather than restating it. For a handler whose other branch is
 *     legitimately open and therefore cannot take a door gate — POST /v1/invitations/:token/accept is
 *     the first — the alternative was a near-copy, which is precisely what this file's own docblock
 *     records going wrong three times over.
 *   v1.8.0 — 2026-08-23 — credentialRevoked() asks a FOURTH question (BR-04): is the owner this
 *     credential acts for deactivated. Uncached keyed read per authenticated request, same
 *     reasoning as the session check; federated principals excluded (their owner is remote and
 *     their home node refuses the attestation instead).
 *   v1.7.0 — 2026-08-23 — requireOperatorPrincipal() takes the scope word as a parameter, defaulting
 *     to the organism-repair one so its two existing call sites read as before. The compliance
 *     surface (BR-02) is the second door of this shape and needs two different words; a near-copy
 *     per door is how three copies of the scope test came to live in this file, none of them aware
 *     of the exception the vocabulary module holds. The refusal path moved to ./deny.ts in the same
 *     change, because this file was one line under the 800-line ceiling.
 *   v1.6.0 — 2026-08-15 — The three scope gates ask utils/scope-coverage.ts instead of each writing
 *     the wildcard rule out again. All three read `scopes.includes('*')` and passed, so the nine
 *     words in SCOPES_OUTSIDE_WILDCARD — which exist BECAUSE no wildcard may carry them — were
 *     honoured on the MCP surface, which asks that module, and waved through here. Behaviour is
 *     unchanged at every call site today (only share:manage is gated this way, and services/
 *     group-shares.ts already refused a `*` session behind the door); what changes is that the next
 *     route to name one of those words gets the answer the vocabulary says it should.
 *   v1.5.0 — 2026-08-15 — requireOperatorPrincipal(), the gate for the break-glass doors that reach
 *     across accounts. requireRole('operator') reads the TOKEN's roles, so it admits the operator's
 *     browser and refuses the operator's agents; this asks whether the ACCOUNT behind the principal
 *     is an operator, the way the aimeat_admin_* MCP tools already did, and then requires an exact
 *     scope word on top so the role alone does not arm every agent the operator owns.
 *   v1.4.0 — 2026-08-14 — requireRoleOrScope() says in its own doc that the role path makes the
 *     named scope decorative FOR THAT ROLE, which is how organism:write came to be enforced on the
 *     MCP tool surface and ignored on the three HTTP doors that write. Nothing executable changed
 *     here; the three organism routes moved to requireScope('organism:write').
 *   v1.3.0 — 2026-08-13 — The session-revocation check moved into optionalAuth(), where the token is
 *     actually verified. It lived in requireAuth() behind an early return that server.ts makes
 *     unconditional: optionalAuth() is mounted globally, so requireAuth() always found req.auth
 *     already set and returned at its first line. Session revocation was therefore enforced on no
 *     route at all — logout revoked the row and the bearer kept working, and deleting an agent could
 *     not end the ninety-day credential it held.
 *   v1.2.0 — 2026-08-11 — Security audit H-1/H-7: requireOwnerPrincipal(), the gate for the doors
 *     that decide who can get back INTO the account. Not one authenticated route under /v1/ghii
 *     carried a role gate, and every one of them keys off req.auth.owner — which holds the HUMAN's
 *     account name on agent, ecosystem and app-grant tokens alike.
 *   v1.1.0 — 2026-07-28 — Every AUTH_REQUIRED 401 goes through deny401(), which stamps the RFC 9728
 *     `WWW-Authenticate: Bearer resource_metadata="…"` hint for the origin the client reached.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { Request, Response, NextFunction } from 'express';
import { verifyJWT, isRevoked, type VerifiedToken } from './jwt.js';
import { OPERATOR_ORGANISM_REPAIR_SCOPE, scopeIsCovered } from '../utils/scope-coverage.js';
import { isForeignPrincipal, setThisNodeId } from '../utils/gaii.js';
import { setRefreshCookie, readRefreshCookie } from '../services/owner-session.js';
import { resolvePat, PAT_PREFIX } from '../services/access-token.js';
import type { AimeatConfig } from '../config.js';
import type { Storage, AppGrantRecord } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { deny401, deny403, denyScope403 } from './deny.js';
import { madeAfter, ownerRefuses, recordIssuedAt, tokenIssuedAt } from './credential-age.js';
import { withCurrentScopes } from './effective-scopes.js';
import { askOperator } from '../services/operator-principal.js';
import { noteScopeUse } from '../services/scope-use.js';
import { getAnonymousCredentials, isAnonymousMode, registerSessionAuth, sessionConfig, sessionStorage } from './node-auth.js';

export { enableAnonymousAuth, isAnonymousMode, getAnonymousCredentials } from './node-auth.js';

/**
 * Initialize session-aware auth middleware. Called once per node during server startup: the storage
 * the credential checks read and the config a refusal reads are filed under the node id, and every
 * read below takes those of the node the code runs as (./node-auth.ts). A production process serves
 * one node, so there it is that node's.
 */
export function initSessionAuth(storage: Storage, config?: AimeatConfig): void {
  registerSessionAuth(storage, config ?? null);
  // So localAccountName (utils/gaii.ts) can tell this node's identities from a visitor's home GHII.
  setThisNodeId(config?.nodeId ?? null);
}

const _lastSeenCache = new Map<string, number>();
const LAST_SEEN_THROTTLE_MS = 5 * 60_000;

function touchAgentLastSeen(auth: VerifiedToken): void {
  const storage = sessionStorage();
  if (!storage) return;
  const isAgent = auth.roles.includes('agent');
  const isEco = auth.roles.includes('ecosystem');
  if (!isAgent && !isEco) return;
  const id = auth.sub;
  const now = Date.now();
  const last = _lastSeenCache.get(id) ?? 0;
  if (now - last < LAST_SEEN_THROTTLE_MS) return;
  // One permanent entry per agent/eco principal otherwise (memory audit 2026-08-17): past the
  // cap, drop entries whose throttle window has long passed — they re-enter on next sight.
  if (_lastSeenCache.size >= 10_000) {
    for (const [k, seen] of _lastSeenCache) {
      if (now - seen > LAST_SEEN_THROTTLE_MS * 2) _lastSeenCache.delete(k);
    }
  }
  _lastSeenCache.set(id, now);
  const iso = new Date(now).toISOString();
  // Best-effort liveness bookkeeping on the hot auth path: a failure must not fail the request, but
  // it must not be invisible either — a lastSeen that silently stops updating reads as "the agent is
  // gone" in every fleet view. The throttle above bounds how often this can log.
  const lastSeenFailed = (err: unknown) =>
    logger.warn('lastSeen update failed; fleet views will show this principal as stale', { id, error: String(err) });
  if (isEco) {
    storage.updateEcosystemApp(id, { lastSeen: iso }).catch(lastSeenFailed);
  } else {
    storage.updateAgent(id, { lastSeen: iso }).catch(lastSeenFailed);
  }
}

// Personal Access Tokens are presented as a Bearer credential (Authorization: Bearer
// aimeat_pat_...). They are recognised transparently by the auth middleware so an agent
// is authenticated by the header alone — like a logged-in user — with no app/client changes.

/**
 * Resolve a Personal Access Token to a verified identity (operator/owner act as the owner
 * GHII; otherwise a scoped agent identity; roles re-derived from the owner's CURRENT roles).
 * Returns null if missing/revoked/expired. Records usage without blocking the request.
 */
async function resolvePatToken(token: string): Promise<VerifiedToken | null> {
  const storage = sessionStorage();
  if (!storage) return null;
  const r = await resolvePat(storage, token);
  if (!r) return null;
  storage.touchPat(r.patId, new Date().toISOString())
    .catch(err => logger.warn('PAT lastUsed update failed; the token will look unused', { patId: r.patId, error: String(err) }));
  return {
    sub: r.sub,
    owner: r.owner,
    node: '',
    roles: r.roles,
    scopes: r.scopes,
    exp: r.expiresAt ? Math.floor(Date.parse(r.expiresAt) / 1000) : Math.floor(Date.now() / 1000) + 3600,
    // Classification reads a PAT as an AI (services/classification/reader-kind.ts). Set here, where
    // the token is resolved, so every PAT carries it without being issued again. Grants nothing.
    via: 'pat',
  };
}

/**
 * For a BROWSER request carrying an owner/operator PAT, set the httpOnly refresh cookie to the
 * PAT itself (once) so the webapp boots "logged in" via the cookie — like a normal login,
 * without re-sending the header on every request. The refresh endpoint validates the PAT
 * cookie on every refresh, so revoking the token takes effect immediately. Skipped for scoped
 * tokens, non-browsers, /v1/auth/* (which manage their own cookies), and when a cookie exists.
 */
function maybeSetPatBrowserSession(req: Request, res: Response, rawToken: string, patAuth: VerifiedToken): void {
  const config = sessionConfig();
  if (!config) return;
  if (!patAuth.roles.includes('owner')) return;
  if (req.path.startsWith('/v1/auth/')) return;
  if (!String(req.headers['user-agent'] || '').includes('Mozilla')) return;
  if (readRefreshCookie(req)) return;
  setRefreshCookie(req, res, config, rawToken);
}

// Extend Express Request with auth info
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: VerifiedToken;
    }
  }
}

/**
 * Has this token's session been ended? True only for a token that names a session the store has and
 * has marked revoked; a token with no `jti`, or one naming a session nobody tracked, is unaffected.
 */
async function sessionRevoked(verified: VerifiedToken): Promise<boolean> {
  const storage = sessionStorage();
  if (!verified.sessionId || !storage) return false;
  return storage.isSessionRevoked(verified.sessionId);
}

/**
 * An app grant's ACCESS token carries no session id, so the check above cannot see it: revoking the
 * grant cleared the refresh token and nothing else, and the 15-minute access token kept reading and
 * writing the owner's memory until it expired on its own. The owner is told otherwise in as many
 * words — locales/en.json `profile.apps.revokeConfirm`: "It loses access immediately."
 *
 * The other two credential families are already answered per request: a PAT is resolved from storage
 * on every call, and owner/agent sessions go through sessionRevoked(). This is the third family, and
 * it was the only one where the button and the behaviour disagreed.
 *
 * One keyed read per app-token request, uncached for the same reason sessionRevoked() is: the row is
 * written by whoever pressed Revoke, and "immediately" is the promise being kept. A grant that has
 * disappeared counts as revoked — an app whose grant row is gone has nothing to act for. Returns the
 * grant while it stands, null for a token that names none, and false for a revoked or missing one.
 */
async function standingAppGrant(verified: VerifiedToken): Promise<AppGrantRecord | null | false> {
  const storage = sessionStorage();
  if (!verified.app_grant || !storage) return null;
  const grant = await storage.getAppGrant(verified.app_grant);
  return !grant || grant.revoked === true ? false : grant;
}

/**
 * Does the ACCOUNT this credential acts for refuse it? Every principal family — owner session, agent,
 * ecosystem app, app grant, MCP OAuth token — carries the bare local owner name in `owner`, so one
 * read answers for all of them (auth/credential-age.ts ownerRefuses): no account holds the name, the
 * account is deactivated (BR-04), or the account was made after the credential, because the name was
 * released and registered again. An app grant's tokens are minted from the grant, a refreshed one
 * long after it, so for them the grant's creation is the credential's. Uncached for the same reason
 * the session check is: an IdP saying "this person left" means now.
 *
 * Federated principals are excluded: their `owner` is their home GHII, an account of a DIFFERENT
 * node that this owners table does not hold, and their home node refuses the attestation instead
 * (federation-auth.ts). So are an anonymous identity and a token that names no owner.
 */
async function accountRefuses(verified: VerifiedToken, grant: AppGrantRecord | null): Promise<boolean> {
  const storage = sessionStorage();
  if (isForeignPrincipal(verified) || verified.anonymous || !verified.owner || !storage) return false;
  const owner = await storage.getOwner(verified.owner);
  return ownerRefuses(owner, grant ? recordIssuedAt(grant.createdAt) : tokenIssuedAt(verified));
}

/**
 * Is the ecosystem app this token names gone? An app acts under `eco:<app>#<owner>@<node>`, built
 * from the account name, and the name is released for reuse. So a token counts only while its app
 * record is there and active, and only when the record is not newer than the token: a record made
 * later is a later connection that reuses the identity, and the older token is not its credential.
 * One keyed read per ecosystem request, uncached for the same reason as the checks above.
 */
async function ecosystemAppGone(verified: VerifiedToken): Promise<boolean> {
  const storage = sessionStorage();
  if (!verified.roles.includes('ecosystem') || !storage) return false;
  const app = await storage.getEcosystemApp(verified.sub);
  if (!app || app.status !== 'active') return true;
  return madeAfter(app.createdAt, tokenIssuedAt(verified));
}

/**
 * Is this credential dead? Five ways a JWT stops being one, and an endpoint that asks fewer than
 * five questions is one the revoked keep opening:
 *   - the exact token was revoked          (POST /v1/auth/revoke)
 *   - its session row was revoked          (sign out, sign out everywhere, deleting the agent)
 *   - its app grant was revoked            (the owner pressed Revoke on the app)
 *   - its ecosystem app is gone            (disconnected, or its account deleted)
 *   - the account it acts for refuses it   (deleted, deactivated as BR-04 asks, or newer than the
 *                                           credential because the name was registered again)
 *
 * Exported because verifying a JWT is not only Express's job. The WebSocket upgrade for the connect
 * tunnel (src/index-start.ts) cannot run middleware on a raw socket, so it verified the token by
 * hand — and asked none of these. A bearer revoked on every HTTP route still opened a tunnel and
 * received the on-connect backlog plus live pushes until its own exp. Any future door that verifies
 * a token itself calls this rather than writing the rule out a fourth time.
 */
export async function credentialRevoked(token: string, verified: VerifiedToken): Promise<boolean> {
  if (await isRevoked(token)) return true;
  if (await sessionRevoked(verified)) return true;
  const grant = await standingAppGrant(verified);
  if (grant === false) return true;
  if (await ecosystemAppGone(verified)) return true;
  // The account question: a credential dies with its account even when the token itself was never
  // revoked. An MCP OAuth token carries no session row at all, and the erasure deletes the session
  // rows of the account on Postgres, so this is the check that ends those tokens.
  return accountRefuses(verified, grant);
}

/**
 * Optional auth middleware — parses JWT if present, does not reject if absent.
 * Use requireAuth() or requireRole() for endpoints that need auth.
 */
export function optionalAuth() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = extractToken(req);
    if (token) {
      if (token.startsWith(PAT_PREFIX)) {
        const patAuth = await resolvePatToken(token);
        if (patAuth) {
          req.auth = patAuth;
          maybeSetPatBrowserSession(req, res, token, patAuth);
        }
      } else if (await isRevoked(token)) {
        req.auth = undefined;
      } else {
        const verified = await verifyJWT(token);
        // SECURITY: the session check belongs HERE, not only in requireAuth(). This middleware is
        // mounted globally (server.ts), so requireAuth() finds req.auth already set and returns at
        // its first line — its own session check has therefore never run on a single route. That
        // made session revocation decorative everywhere: logout revoked the row and the bearer kept
        // working, and deleting an agent could not end the credential it held.
        //
        // Uncached on purpose. The token-hash cache in jwt.ts can afford 60 seconds because the
        // revoking caller writes its own entry; here the revocation happens in storage, and an owner
        // pressing Delete means now. One keyed read per authenticated request that carries a jti.
        if (verified && !(await credentialRevoked(token, verified))) {
          // The scope list on the token is what the agent held when it was minted; the record is
          // what it holds now. Narrowed here, once, so every door downstream — routes, the MCP
          // surface, the tunnel's forwarded calls — reads the same answer without asking again.
          req.auth = await withCurrentScopes(sessionStorage(), verified);
        }
      }
    }
    // Anonymous mode: inject anonymous identity when no auth present
    if (!req.auth && isAnonymousMode()) {
      const anonymous = getAnonymousCredentials();
      req.auth = {
        sub: anonymous.gaii,
        owner: anonymous.owner,
        node: '',
        roles: ['agent'],
        exp: Math.floor(Date.now() / 1000) + 86400,
        scopes: ['memory:read', 'catalogue:read', 'social:read'],
        anonymous: true,
      };
    }
    next();
  };
}

/**
 * Require authentication. Returns 401 if no valid JWT.
 * If req.auth is already set (e.g. by optionalAuth() in anonymous mode), skips token check.
 */
export function requireAuth() {
  return async (req: Request, res: Response, next: NextFunction) => {
    // If auth was already resolved by global optionalAuth() (e.g. anonymous mode)
    if (req.auth) {
      touchAgentLastSeen(req.auth);
      // SECURITY: Reject anonymous credentials — requireAuth() requires real authentication
      if (req.auth.anonymous) {
        deny401(req, res, 'This endpoint requires authentication');
        return;
      }
      next();
      return;
    }

    const token = extractToken(req);
    if (!token) {
      deny401(req, res, 'Authentication required');
      return;
    }

    // Personal Access Token presented as a Bearer credential — authenticate via the
    // header transparently (no app/client changes; acts like a logged-in user).
    if (token.startsWith(PAT_PREFIX)) {
      const patAuth = await resolvePatToken(token);
      if (!patAuth) {
        deny401(req, res, 'Invalid or revoked access token');
        return;
      }
      req.auth = patAuth;
      maybeSetPatBrowserSession(req, res, token, patAuth);
      touchAgentLastSeen(patAuth);
      next();
      return;
    }

    if (await isRevoked(token)) {
      deny401(req, res, 'Token has been revoked');
      return;
    }

    const verified = await verifyJWT(token);
    if (!verified) {
      deny401(req, res, 'Invalid or expired token');
      return;
    }

    // This code path verifies the token itself, so it asks every question optionalAuth() asks
    // (credentialRevoked): the exact token, its session row, its app grant, its ecosystem app and
    // the account it acts for. It runs whenever no identity was set before it: when optionalAuth()
    // ran and set none, with anonymous mode off, and when this middleware is mounted without
    // optionalAuth() ahead of it (a unit test, a router mounted on its own).
    if (await credentialRevoked(token, verified)) {
      deny401(req, res, 'The credential is no longer valid');
      return;
    }

    // The same narrowing optionalAuth does, on the same code path and for the same reason: a
    // permission the owner removed is not honoured here either.
    req.auth = await withCurrentScopes(sessionStorage(), verified);
    touchAgentLastSeen(verified);
    next();
  };
}

/**
 * Require authentication OR anonymous credentials.
 * Use for endpoints that should be accessible in anonymous mode
 * (e.g. public catalogue searches, board reads, directory listing).
 */
export function requireAuthOrAnonymous() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      deny401(req, res, 'Authentication required');
      return;
    }
    // Allow both authenticated and anonymous
    next();
  };
}

/**
 * Require a specific role. Must be used after requireAuth().
 * Federated sessions are blocked from operator role access.
 */
export function requireRole(role: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      deny401(req, res, 'Authentication required');
      return;
    }

    // A federated session is a visitor from another node. Until 2026-09-24 its role list was
    // ['owner'] by the mint's courtesy and its `owner` the local part of its home name, which can
    // equal a LOCAL account's name; verifyJWT now reads it as role 'federated', named by its home GHII
    // (utils/gaii.ts isForeignPrincipal). It holds no local role here: its real reach is the
    // federation scopes, enforced by requireScope, and the pull/push/list-home doors it needs are
    // behind requireAuth, not this gate. Refused by name as well as by role, so the refusal says why
    // (secaudit 2026-09: A3-1/A3-3/A10-1). requireRoleOrScope still admits it on a scope it holds.
    if (isForeignPrincipal(req.auth)) {
      deny403(req, res, 'FORBIDDEN', 'A session from another node holds no local role here');
      return;
    }

    // Role hierarchy: operator > owner > (agent | ecosystem).
    // `agent` and `ecosystem` are SIBLING external-principal classes: neither satisfies the other.
    // Owner/operator may act for their own agents AND their own ecosystem connections.
    const hasRole = req.auth.roles.includes(role) ||
      (role === 'agent' && req.auth.roles.includes('owner')) ||
      (role === 'agent' && req.auth.roles.includes('operator')) ||
      (role === 'ecosystem' && req.auth.roles.includes('owner')) ||
      (role === 'ecosystem' && req.auth.roles.includes('operator')) ||
      (role === 'owner' && req.auth.roles.includes('operator'));

    if (!hasRole) {
      deny403(req, res, 'ACCESS_DENIED', `Role "${role}" required`);
      return;
    }

    next();
  };
}

// The account-security family — which PRINCIPAL of an account is calling, whose SOFTWARE it is,
// and the door that admits only the first — lives in ./account-security.ts, moved there unchanged
// when this file passed 800 lines. Re-exported so every existing import of it still resolves here.
export { isOwnerPrincipal, isThirdPartyPrincipal, isSignedInCaller, requireOwnerPrincipal } from './account-security.js';

/**
 * Require the NODE OPERATOR, or something the operator explicitly sent. For the break-glass doors
 * that reach across accounts: repairing an organism whose owner is unreachable is the first of them.
 *
 * WHY NOT requireRole('operator'). That tests the token's own role list, so it admits the operator's
 * browser session and refuses the operator's AGENTS — and an agent should be able to do what a
 * person can. This gate asks the question one level up: is the ACCOUNT behind this principal an
 * operator account? The four `aimeat_admin_*` MCP tools already resolve the operator that way
 * (mcp/core-admin.ts), so the two surfaces now agree instead of disagreeing by accident.
 *
 * WHY A SCOPE ON TOP. The role alone would hand every one of the operator's agents a node-wide
 * capability the moment it exists, and that is the shape of the incident this door was built for: an
 * agent with no scope limit called the ownership transfer during a test run and gave away the node's
 * own development organism. The word is tested as the EXACT string — no wildcard carries it
 * (SCOPES_OUTSIDE_WILDCARD), nobody was grandfathered onto it, and `app` principals are refused
 * outright, because an app grant is consent to use the account and never consent to act as the node.
 *
 * WHY THE WORD IS A PARAMETER. Organism repair was the first door of this shape and is the default,
 * so its two call sites read exactly as before. The compliance report (BR-02) is the second, and it
 * needs two different words for reading and writing. A near-copy of this function per door is how
 * three copies of the scope test came to live in this file, none of them knowing about the exception
 * the vocabulary module was written to hold — so the door varies by its word, not by its code.
 *
 * Federated sessions are refused for the same reason requireRole('operator') refuses them: operator
 * power stops at this node's own front door.
 *
 * THE DECISION IS askOperator() (services/operator-principal.ts), the one operator question every door
 * asks, tool surface included; this gate keeps its own refusals and their codes.
 */
export function requireOperatorPrincipal(storage: Storage, scope: string = OPERATOR_ORGANISM_REPAIR_SCOPE) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      deny401(req, res, 'Authentication required');
      return;
    }
    if (isForeignPrincipal(req.auth)) {
      deny403(req, res, 'FORBIDDEN', 'Federated sessions cannot access operator functions');
      return;
    }
    if (req.auth.roles.includes('app')) {
      deny403(req, res, 'ACCESS_DENIED', 'An app grant cannot carry operator functions');
      return;
    }
    // The operator in person passes; anything acting for an operator account passes on the exact word.
    const answer = await askOperator(storage, {
      sub: req.auth.sub, owner: req.auth.owner, roles: req.auth.roles, scopes: req.auth.scopes,
    }, scope);
    if (!answer.ok && answer.why !== 'needs-word') {
      deny403(req, res, 'ACCESS_DENIED', 'Node operator required');
      return;
    }
    if (!answer.ok) {
      logger.warn(`[operator-scope-denied] ${req.auth.sub} on ${req.method} ${req.path}`);
      denyScope403(req, res, [scope], `Scope "${scope}" required. The node operator grants it per agent, `
        + 'and no wildcard carries it.');
      return;
    }
    next();
  };
}

/**
 * Require a scoped EXTERNAL principal — an agent (GAII) OR an ecosystem app (GEAI). Owner/operator
 * also pass (they act for their own external principals, exactly as with requireRole('agent')).
 * Use this on routes that legitimately serve either external principal (e.g. the memory CRUD a GEAI
 * uses to deposit refined data). This is a strict SUPERSET of requireRole('agent') — it only widens
 * access to add the ecosystem role, so agent/owner behavior is unchanged. Scopes are still enforced
 * separately by requireScope() for both agents and GEAIs.
 */
export function requireExternalPrincipal() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      deny401(req, res, 'Authentication required');
      return;
    }
    const roles = req.auth.roles;
    // `app` is a third scoped external-principal class (H-2 app grants): a user-published app
    // holding an explicit, scoped grant token. Like agent/ecosystem it is scope-enforced by
    // requireScope() (no owner bypass — its role is not 'owner'), so widening here only lets a
    // granted app reach the same data CRUD an agent/GEAI uses, never escalating its scopes.
    // A visitor from another node is an outside principal here too, and like an agent it reaches
    // these doors only on the scopes this node granted its peer (requireScope gives it no owner
    // bypass). It held roles ['owner'] and passed on that until 2026-09-24; it passes by name now,
    // under its own home identity (secaudit 2026-09, F-1).
    const ok = roles.includes('agent') || roles.includes('ecosystem') ||
      roles.includes('app') || roles.includes('owner') || roles.includes('operator') ||
      isForeignPrincipal(req.auth);
    if (!ok) {
      deny403(req, res, 'ACCESS_DENIED', 'Agent, ecosystem-app, or app principal required');
      return;
    }
    next();
  };
}

/**
 * Build an "agent record missing" response. Use this in route handlers AFTER
 * `storage.getAgent(...)` returns null, when the request is authenticated.
 *
 * Why this exists: a signed agent JWT can outlive the agent record itself --
 * the owner can delete an agent from the Profile UI without revoking the
 * token, and the token will keep authenticating fine (valid signature, valid
 * exp, no revocation entry) while every storage.getAgent() lookup returns
 * null. Bare "Agent not found" is misleading in that state because it sounds
 * like the agent name was mistyped; the real cause is that the local
 * connector cache + token are stale relative to the server. This helper
 * detects the desync (caller's GAII matches the missing agent) and returns
 * AGENT_NOT_REGISTERED with a concrete recovery hint pointing at
 * `aimeat connect add`. For all other callers (owner sessions looking up
 * someone else's agent, or genuine unknown names) the standard NOT_FOUND is
 * returned.
 */
export function agentNotFoundResponse(
  req: Request,
  agentName: string,
  expectedGaii: string,
  config: { nodeId: string; baseUrl: string },
): { status: number; code: string; message: string } {
  const isAgentSession = req.auth?.roles.includes('agent') === true;
  const callerGaii = req.auth?.sub;
  if (isAgentSession && callerGaii === expectedGaii) {
    return {
      status: 404,
      code: 'AGENT_NOT_REGISTERED',
      message:
        `Your token is valid but agent '${agentName}' has no record on node ${config.nodeId}. ` +
        `The agent was likely deleted server-side. Re-register with: ` +
        `aimeat connect add --agent ${agentName} --owner ${req.auth?.owner ?? '<owner>'} --url ${config.baseUrl}`,
    };
  }
  return {
    status: 404,
    code: 'NOT_FOUND',
    message: `Agent '${agentName}' not found`,
  };
}

/**
 * Require a local (non-federated) session. Returns 403 for federated sessions.
 * Use on endpoints that should not be accessible to federated users
 * (e.g., agent creation on remote nodes).
 */
export function requireLocalSession() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isForeignPrincipal(req.auth)) {
      deny403(req, res, 'FORBIDDEN', 'This action requires a local session');
      return;
    }
    next();
  };
}

// Generator scopes (agent-driven service generation):
// generator:read    — read projects, interview specs, components, session state
// generator:write   — create projects, save interview spec, submit blueprint and components
// generator:execute — claim/release sessions, register and activate components, write logs

/**
 * Require specific scopes. Must be used after requireAuth().
 * Checks if the agent's JWT scopes include the required scopes.
 * Supports exact match, domain wildcards (memory:*), and global wildcard (*).
 * Owner/operator role bypasses scope checks (they act as owners, not scoped agents).
 * Agents with explicit scopes are always enforced, even if their owner is an operator.
 */
/**
 * Pass if the caller satisfies requireRole(role) OR carries one of `scopes`. Lets a role-'app' (H-2)
 * or ecosystem session with an explicit owner-granted scope do what the named role can do.
 *
 * READ THIS BEFORE REACHING FOR IT. The role path runs FIRST and unconditionally, so for the role
 * named here the scope is DECORATIVE: an agent passed requireRoleOrScope('agent', 'organism:write')
 * whether or not its owner ticked organism:write. That was measured on a running node — an agent
 * holding seven explicit scopes without the word could not even SEE aimeat_organism_create on its
 * MCP surface, because the tool surface filters on that same word at registration, and the same
 * agent got 201 Created from POST /v1/organisms. Enforced on the surface the owner reads, ignored on
 * the door that writes: security DNA invariant 15.
 *
 * So this helper is right only where the ROLE is the permission and the scope WIDENS it to a
 * principal class that does not carry that role. requireRoleOrScope('owner', 'agent:delete') is that
 * shape: the owner may delete their own agent by being the owner, and a fleet-managing agent may do
 * it on the explicit word. It is the wrong shape whenever the scope is meant to bind the same
 * principals the role already admits — there, use requireScope(), which keeps the owner-session
 * bypass and refuses an agent that lacks the word. The three organism write doors moved to
 * requireScope on 2026-08-14 for exactly that reason; see routes/organisms/crud.ts.
 */
export function requireRoleOrScope(role: string, ...scopes: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) { deny401(req, res, 'Authentication required'); return; }
    const roles = req.auth.roles;
    // Role path — mirrors requireRole(role) exactly (owner/operator satisfy 'agent'; operator satisfies 'owner').
    // A federated session takes the SCOPE path only: its ['owner'] role is a visitor's, not a local
    // role (see requireRole above), so a board or memory door it reaches it reaches by holding the
    // scope this node granted the peer, never by the role. Without this a federated namesake passed
    // every requireRoleOrScope('owner', …) door on the role alone (secaudit 2026-09).
    if (!isForeignPrincipal(req.auth) && (roles.includes(role) ||
        (role === 'agent' && (roles.includes('owner') || roles.includes('operator'))) ||
        (role === 'owner' && roles.includes('operator')))) { next(); return; }
    // Scope path — any authenticated principal carrying the grant. The wildcard rule is
    // scopeIsCovered()'s, not this function's; see requireScope below for why that matters.
    const have = req.auth.scopes ?? [];
    if (scopes.some(s => scopeIsCovered(have, s))) { next(); return; }
    deny403(req, res, 'ACCESS_DENIED', `Requires role '${role}' or one of scopes: [${scopes.join(', ')}]`);
  };
}

export function requireScope(...requiredScopes: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      deny401(req, res, 'Authentication required');
      return;
    }

    // Owner-role requests bypass scope checks (owners act on behalf of all their agents).
    // But agent- AND ecosystem-role requests MUST respect scopes, even if their owner is an
    // operator: a GEAI is a scoped external principal and must NEVER receive the owner bypass.
    // Nor a FEDERATED session: its owner role is the mint's courtesy and its scope list is what the
    // receiving node granted; until 2026-09-08 the role waved a memory:read visitor past a write.
    if (req.auth.roles.includes('owner') && !isForeignPrincipal(req.auth) &&
        !req.auth.roles.includes('agent') && !req.auth.roles.includes('ecosystem')) {
      next();
      return;
    }

    const agentScopes = req.auth.scopes;

    // The rule for "does this principal hold that word" lives in utils/scope-coverage.ts and is asked
    // here rather than restated: the exact string, `{domain}:*`, `*` — and, for the words in
    // SCOPES_OUTSIDE_WILDCARD, the exact string ALONE. Restated here it read `includes('*')` first and
    // returned, so a `*` agent was admitted to words that exist precisely because no wildcard may
    // carry them (the password door, the reserved memory keys, the operator break-glass, the six
    // own-tick words), while the MCP surface — which does ask that module — refused the same agent for
    // the same word. Enforced on one surface and not the other is invariant 15, and a copied rule is
    // how it happens: three copies of this test lived in this file, and none of them knew about the
    // exception the module was written to hold.
    for (const required of requiredScopes) {
      if (!scopeIsCovered(agentScopes, required)) {
        logger.warn(`[scope-denied] ${req.auth.sub} needs "${required}", has [${agentScopes.join(', ')}] on ${req.method} ${req.path}`);
        denyScope403(req, res, [required], `Scope "${required}" required. Agent scopes: [${agentScopes.join(', ')}]`);
        return;
      }
    }
    // A `*` agent's admitted words feed the narrowing its owner is offered (services/scope-use.ts).
    if (req.auth.roles.includes('agent') && agentScopes.includes('*')) noteScopeUse(req.auth.sub, requiredScopes);

    next();
  };
}

/**
 * Like requireScope, but ANY of the listed scopes is enough.
 *
 * requireScope is an AND, which is the right default: a route that needs two permissions needs
 * both. This is for the case where two DIFFERENT principals legitimately reach the same route by
 * different routes of trust — an owner reading their own connections with `connections:read`, and a
 * granted app reading the same list with `connections:use` because it may publish to one and
 * therefore has to be able to name one.
 *
 * A named guard rather than an inline check in the route: the owner bypass and the domain wildcard
 * are security logic, and security logic copied into a handler is security logic that drifts.
 */
export function requireAnyScope(...acceptableScopes: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      deny401(req, res, 'Authentication required');
      return;
    }
    if (req.auth.roles.includes('owner') &&
        !req.auth.roles.includes('agent') && !req.auth.roles.includes('ecosystem')) {
      next();
      return;
    }
    const held = req.auth.scopes;
    if (acceptableScopes.some((required) => scopeIsCovered(held, required))) {
      next();
      return;
    }
    logger.warn(`[scope-denied] ${req.auth.sub} needs any of "${acceptableScopes.join('", "')}", has [${held.join(', ')}] on ${req.method} ${req.path}`);
    // ANY of them is enough, so the header lists them all and the client picks. A header naming one
    // would send a client to ask for a permission it may not need.
    denyScope403(req, res, acceptableScopes, `One of these scopes is required: ${acceptableScopes.join(', ')}. Agent scopes: [${held.join(', ')}]`, undefined, true);
  };
}

function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  // SECURITY: JWT tokens must NOT be accepted via URL query parameters.
  // Tokens in URLs are logged in access logs, browser history, and referrer headers.
  return null;
}

// The refusal path lives in ./deny.ts — extracted for max-file-lines.
