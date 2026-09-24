/**
 * @file src/services/operator-principal.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Is THIS PRINCIPAL the node operator? The one question every operator check asks,
 *   on every door: the HTTP operator gate, the tool surface, and the services both of them call.
 *
 *   WHY THE PRINCIPAL AND NOT THE ACCOUNT. The operator role lives on the owner record, and an agent
 *   acts in its owner's name, so most checks asked "is the owner an operator". That armed every
 *   agent, app grant and ecosystem app an operator had ever connected with the operator's reach,
 *   whatever the operator had granted it (security audit A8-1): an agent holding social:write could
 *   delete another person's board, one holding capability:write could rewrite another person's
 *   capability, one holding cortex:write could claim another person's namespace.
 *
 *   THE RULE. The operator in person passes: an owner session or a personal token of an operator
 *   account. Anything acting FOR the operator (an agent, an app grant, an ecosystem app) passes only
 *   while it holds the exact word: operator:admin, unless the door names an operator word of its own
 *   (operator:organism-repair, compliance:read, compliance:write, site:layout-write). No wildcard
 *   carries any of them (utils/scope-coverage.ts). A session from another node never passes:
 *   operator power stops at this node's own door.
 *
 *   THE ORDER. The account first, as the outer gate, because a word means nothing on an account that
 *   does not run the node. The word second.
 *
 *   WHICH PRINCIPAL IT IS. A door that holds the session's roles passes them, and must: an app
 *   grant's `sub` is its owner's GHII, and only the role says it is not the person. Without roles the
 *   identity's own shape decides: a GAII or a GEAI acts for someone, a GHII or a bare name is the
 *   person. The operator in person is read off the token's roles when there are roles to read,
 *   because they were minted from the owner record and are kept current (auth/effective-scopes.ts).
 * @structure OperatorCaller · OperatorAnswer · askOperator(storage, caller, word) ·
 *   operatorName(storage, caller, word) · resolveOperatorAgentName(storage, gaii, scopes, word) ·
 *   OPERATOR_AGENT_REFUSAL
 * @usage
 *   const name = await operatorName(storage, { sub: agentGaii, roles: ['agent'], scopes });
 *   if (!name) return refuse(OPERATOR_AGENT_REFUSAL);
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (security audit A8-1): one question for every operator check.
 *     resolveOperatorAgentName and OPERATOR_AGENT_REFUSAL moved here from owner-lifecycle.ts, which
 *     re-exports them, and resolveOperatorName, which asked the account alone, is gone.
 */
import type { Storage } from '../storage/interface.js';
import { ECO_PREFIX, isForeignPrincipal, localAccountName } from '../utils/gaii.js';
import { OPERATOR_ADMIN_SCOPE, scopeIsCovered } from '../utils/scope-coverage.js';

/** A principal as any door can describe it. */
export interface OperatorCaller {
  /** The principal as it identifies itself: a GAII, a GEAI, an owner GHII, or a bare owner name. */
  sub: string;
  /** The account name behind it (`req.auth.owner`), when the door has it. Read off `sub` otherwise. */
  owner?: string;
  /** The session's roles, when the door has them. A door that has them passes them. */
  roles?: readonly string[];
  /** The session's granted words. Something acting for the operator passes only on the exact word. */
  scopes?: readonly string[];
  /** A session signed in from another node. */
  federated?: boolean;
}

/** The answer, with the reason when it is no, so a door can word its refusal. */
export type OperatorAnswer =
  | { ok: true; name: string; inPerson: boolean }
  | { ok: false; why: 'visitor' | 'not-operator' | 'needs-word' };

/** The roles that mean the principal acts for someone rather than being them. */
const ACTS_FOR_SOMEONE = ['agent', 'app', 'ecosystem'];

function actsForSomeone(caller: OperatorCaller): boolean {
  if (caller.roles) {
    const roles = caller.roles;
    return roles.some((r) => ACTS_FOR_SOMEONE.includes(r)) || !(roles.includes('owner') || roles.includes('operator'));
  }
  return caller.sub.includes('#') || caller.sub.startsWith(ECO_PREFIX);
}

/**
 * Is this principal the node operator, for a door that asks `word`? See the file header for the
 * rule. Reads the owner record at most once, and not at all for the operator in person holding roles.
 */
export async function askOperator(
  storage: Storage, caller: OperatorCaller, word: string = OPERATOR_ADMIN_SCOPE,
): Promise<OperatorAnswer> {
  if (isForeignPrincipal(caller)) return { ok: false, why: 'visitor' };
  const delegated = actsForSomeone(caller);
  const name = localAccountName(caller.owner ?? caller.sub);
  if (!name) return { ok: false, why: 'not-operator' };

  if (!delegated && caller.roles) {
    return caller.roles.includes('operator')
      ? { ok: true, name, inPerson: true }
      : { ok: false, why: 'not-operator' };
  }

  const record = await storage.getOwner(name);
  if (!record?.roles.includes('operator')) return { ok: false, why: 'not-operator' };
  if (!delegated) return { ok: true, name: record.name, inPerson: true };
  // scopeIsCovered() rather than includes(): it is the one place that knows these words sit outside
  // every wildcard, so '*' and 'operator:*' never pass here.
  return scopeIsCovered(caller.scopes ?? [], word)
    ? { ok: true, name: record.name, inPerson: false }
    : { ok: false, why: 'needs-word' };
}

/** The operator's bare account name when askOperator() says yes, else null. */
export async function operatorName(
  storage: Storage, caller: OperatorCaller, word: string = OPERATOR_ADMIN_SCOPE,
): Promise<string | null> {
  const answer = await askOperator(storage, caller, word);
  return answer.ok ? answer.name : null;
}

/**
 * The tool surface's form of the question. A tool session is always an agent, so the caller is its
 * GAII with the session's scopes. The tool surface also leaves an operator tool unregistered for a
 * session without the word (the TOOL_SCOPES entry); this is the second of two gates, because a node
 * run with AIMEAT_MCP_ENFORCE_SCOPES=false registers every tool, and a gate that disappears with a
 * logging switch is not one.
 */
export function resolveOperatorAgentName(
  storage: Storage, callerGaii: string, scopes: readonly string[], word: string = OPERATOR_ADMIN_SCOPE,
): Promise<string | null> {
  return operatorName(storage, { sub: callerGaii, roles: ['agent'], scopes }, word);
}

/** What an operator tool answers when the question says no. It names both halves of the test, so
 *  the agent can tell the person what to change rather than guess which half failed. */
export const OPERATOR_AGENT_REFUSAL = 'This is for the node operator\'s own agent, and only with the '
  + `"${OPERATOR_ADMIN_SCOPE}" permission, which the operator ticks for that agent in its settings. `
  + '"Full access" does not include it.';
