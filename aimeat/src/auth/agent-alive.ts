/**
 * @file src/auth/agent-alive.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The sixth credential-death question: is the AGENT this token acts for still there?
 *
 *   A credential dies with the principal it acts for, and until now an agent's death was carried
 *   only by its session rows (storage.revokeSessionsByGaii, which DELETE /v1/agents/:name calls).
 *   An MCP OAuth access token is minted with no session id (mcp/oauth.ts calls issueJWT without
 *   one, and auth/jwt.ts writes `jti` only when one is passed), so the delete reached nothing of it
 *   and answered sessions_revoked: 0. The deleted agent went on reading and writing in the owner's
 *   account, on its open MCP session and on a fresh one, for the rest of the token's TTL
 *   (secaudit 2026-10, mcp-oauth:access-token-without-session-survives-agent-delete).
 *
 *   WHO IS ASKED. Only an agent-role credential, so the lookup never runs for a principal it cannot
 *   answer for: an owner session, an operator, an app grant, an ecosystem app, the anonymous
 *   identity and a visitor from another node all return before it. That is the same combination
 *   auth/effective-scopes.ts withCurrentScopes reads an agent record for, for the same reason. A
 *   personal access token is excluded as well: a scoped one is minted with a sandboxed GAII that
 *   names no agent record, and the PAT row is what ends it.
 *
 *   TIME. A record made after the token was issued counts as gone too. An agent name is released
 *   for reuse with the agent, so an agent registered again under the old name is a NEW principal
 *   and the earlier token is not its credential. Compared through auth/credential-age.ts, exact to
 *   the millisecond on a token carrying `iat_ms` and in whole seconds on an older one, and a time
 *   that cannot be read answers no.
 * @structure agentGone(storage, verified) → boolean
 * @usage if (await agentGone(sessionStorage(), verified)) return true;
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial. The agent question in auth/middleware.ts credentialRevoked, in
 *     its own file because that one is at the 800-line ceiling.
 */
import type { Storage } from '../storage/interface.js';
import type { VerifiedToken } from './jwt.js';
import { isForeignPrincipal, parseGaiiLoose } from '../utils/gaii.js';
import { madeAfter, tokenIssuedAt } from './credential-age.js';

/**
 * Is the agent this credential acts for gone, or newer than the credential?
 *
 * Returns false, with no storage read, for every principal the question does not apply to. The
 * guards are ordered so the cheap ones run first: the role list decides before anything touches
 * storage, and a credential whose `sub` does not name an agent (`agent#owner@node`) is not looked
 * up at all. One keyed read per agent request otherwise, uncached for the reason the checks beside
 * it are uncached: an owner pressing Delete means now.
 */
export async function agentGone(storage: Storage | null, verified: VerifiedToken): Promise<boolean> {
  if (!storage || verified.anonymous || isForeignPrincipal(verified)) return false;
  // An agent and nothing else. `owner`, `operator` and `ecosystem` beside `agent` are the account
  // holder and the two sibling principal classes, whose permissions live somewhere other than an
  // agent record; `app_grant` names a granted app, answered by standingAppGrant.
  if (!verified.roles.includes('agent')) return false;
  if (verified.roles.includes('owner') || verified.roles.includes('operator')) return false;
  if (verified.roles.includes('ecosystem') || verified.app_grant) return false;
  // A personal access token is the fourth credential family and names no agent record. A scoped PAT
  // is minted with a sandboxed GAII of its own (`apptester-<id>#owner@node`, routes/access-tokens.ts)
  // and the token exchanged from it carries `via: 'pat'`; the PAT row is what revokes it, and
  // services/access-token.ts resolvePat asks the account question for it.
  if (verified.via === 'pat') return false;
  if (parseGaiiLoose(verified.sub).agent === '') return false;
  const agent = await storage.getAgent(verified.sub);
  if (!agent) return true;
  return madeAfter(agent.createdAt, tokenIssuedAt(verified));
}
