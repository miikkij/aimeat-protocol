/**
 * @file src/auth/credential-revoked.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description credentialRevoked(): is this verified JWT still a credential? The per-request
 *   revocation check every code path that verifies a token asks (optionalAuth, requireAuth, the MCP
 *   endpoint, the WebSocket upgrade, the connect tunnel, device and OAuth approval), with the six
 *   storage questions it asks and the seventh, in-memory one about a visitor's home peer.
 * @structure credentialRevoked(token, verified) · sessionRevoked · standingAppGrant · accountRefuses ·
 *   patGone · ecosystemAppGone (the last five module-private)
 * @usage import { credentialRevoked } from './credential-revoked.js';   // re-exported by ./middleware.ts
 * @version-history
 *   2026-10-27 — credentialRevoked asks a NINTH question, first among the in-memory ones: the shared
 *     anonymous principal counts only while anonymous mode is on (secaudit2026oct26,
 *     isAnonymousMode:not-bound-to-live-config).
 *   2026-10-27 — standingAppGrant counts a grant given to an earlier holder of the author's name as
 *     gone, so the access tokens minted from it end with it (secaudit2026oct26,
 *     credential-revoked:app-grant-token-ignores-earlier-author).
 *   2026-10-25 — credentialRevoked asks an EIGHTH question (patGone): a JWT minted from a personal
 *     access token counts only while that token is neither revoked nor expired. It named no PAT row,
 *     so revoking the PAT reached nothing of it (secaudit2026oct22, exchanged-pat-jwt-outlives-revoke).
 *   v1.1.0 — 2026-10-20 — credentialRevoked asks a SEVENTH question (./visitor-peer.ts
 *     visitorPeerRefuses): a visitor's session counts only while the peer that vouched for it is an
 *     active peer that this node's policy still lets sign people in. The visitor token carries no
 *     session id, so removing or restricting the peer reached nothing of it (secaudit 2026-10,
 *     credentialRevoked:federated-visitor-not-bound-to-live-peer).
 *   v1.0.0 — 2026-10-20 — Moved unchanged from auth/middleware.ts (max-file-lines): credentialRevoked
 *     and the four questions it asks of storage. Their history stays in that file's header.
 */
import { isRevoked, type VerifiedToken } from './jwt.js';
import { isForeignPrincipal } from '../utils/gaii.js';
import type { AppGrantRecord } from '../storage/interface.js';
import { madeAfter, ownerRefuses, recordIssuedAt, tokenIssuedAt } from './credential-age.js';
import { agentGone } from './agent-alive.js';
import { visitorPeerRefuses } from './visitor-peer.js';
import { isAnonymousMode, sessionStorage } from './node-auth.js';
import { isAnonymousPrincipal } from './anonymous-principal.js';
import { grantGivenToEarlierAuthor } from '../services/app-grant-author.js';

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
 * The other two credential families are already answered per request: a raw PAT is resolved from
 * storage on every call and a JWT exchanged from one is answered by patGone(), and owner/agent
 * sessions go through sessionRevoked(). This is the third family, and
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
  if (!grant || grant.revoked === true) return false;
  // A grant given to the app of an EARLIER holder of the author's name covers nothing the current
  // holder publishes (services/app-grant-author.ts). The silent bridge, the refresh and the grant list
  // asked it; the access token minted from the grant before the erasure kept working until it
  // expired, at the same origin where the new holder's code runs (secaudit2026oct26,
  // credential-revoked:app-grant-token-ignores-earlier-author). One keyed owner read.
  if (await grantGivenToEarlierAuthor(storage, grant)) return false;
  return grant;
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
/**
 * Is the personal access token this JWT was minted from gone? The exchange and the PAT-backed refresh
 * cookie write the PAT's id into the `pat` claim; without it the JWT named no row, and revoking the
 * PAT left it working until its own expiry, long enough for an owner-level one to mint a fresh PAT
 * (secaudit2026oct22, exchanged-pat-jwt-outlives-revoke). A row that is revoked, expired or missing
 * ends it. The account question below covers a PAT whose account is gone. One keyed read per such
 * request, uncached for the same reason as the checks beside it.
 */
async function patGone(verified: VerifiedToken): Promise<boolean> {
  const storage = sessionStorage();
  if (!verified.pat || !storage) return false;
  const pat = await storage.getPatById(verified.pat);
  if (!pat || pat.revoked) return true;
  return !!pat.expiresAt && Date.now() >= Date.parse(pat.expiresAt);
}

async function ecosystemAppGone(verified: VerifiedToken): Promise<boolean> {
  const storage = sessionStorage();
  if (!verified.roles.includes('ecosystem') || !storage) return false;
  const app = await storage.getEcosystemApp(verified.sub);
  if (!app || app.status !== 'active') return true;
  return madeAfter(app.createdAt, tokenIssuedAt(verified));
}

/**
 * Is this credential dead? Eight ways a JWT stops being one, and an endpoint that asks fewer than
 * eight questions is one the revoked keep opening:
 *   - the exact token was revoked          (POST /v1/auth/revoke)
 *   - its session row was revoked          (sign out, sign out everywhere, deleting the agent)
 *   - its app grant was revoked            (the owner pressed Revoke on the app)
 *   - its ecosystem app is gone            (disconnected, or its account deleted)
 *   - its personal access token is gone    (revoked, expired; the JWT was exchanged from it)
 *   - its agent is gone                    (deleted, or registered again under the released name)
 *   - the account it acts for refuses it   (deleted, deactivated as BR-04 asks, or newer than the
 *                                           credential because the name was registered again)
 *   - a visitor's home peer no longer      (removed, emergency-removed, suspended, or federated
 *     carries its session                   sign-in switched off for it; ./visitor-peer.ts)
 *
 * Exported because verifying a JWT is not only Express's job. The WebSocket upgrade for the connect
 * tunnel (src/index-start.ts) cannot run middleware on a raw socket, so it verified the token by
 * hand — and asked none of these. A bearer revoked on every HTTP route still opened a tunnel and
 * received the on-connect backlog plus live pushes until its own exp. Any future code path that
 * verifies a token itself calls this rather than writing the rule out a fourth time.
 */
export async function credentialRevoked(token: string, verified: VerifiedToken): Promise<boolean> {
  if (await isRevoked(token)) return true;
  // The shared anonymous principal is a credential only while anonymous mode is on: a token minted
  // before the operator switched the mode off, or before a restart with it off, stops working then
  // (secaudit2026oct26; decision 2026-10-27). Memory only, so it runs before the storage reads.
  if (isAnonymousPrincipal(verified) && !isAnonymousMode()) return true;
  // The visitor question reads memory only, so it runs before the storage reads below.
  if (visitorPeerRefuses(verified)) return true;
  if (await sessionRevoked(verified)) return true;
  const grant = await standingAppGrant(verified);
  if (grant === false) return true;
  if (await ecosystemAppGone(verified)) return true;
  if (await patGone(verified)) return true;
  // The agent question (./agent-alive.ts). It reads storage only for an agent-role credential, and
  // it is what ends an MCP OAuth access token, which carries no session row for the delete to reach.
  if (await agentGone(sessionStorage(), verified)) return true;
  // The account question: a credential dies with its account even when the token itself was never
  // revoked. An MCP OAuth token carries no session row at all, and the erasure deletes the session
  // rows of the account on Postgres, so this is the check that ends those tokens.
  return accountRefuses(verified, grant);
}
