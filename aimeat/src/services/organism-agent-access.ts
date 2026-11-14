/**
 * @file src/services/organism-agent-access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which of its members' agents an organism admits (OrganismRecord.agentAccess).
 *
 *   A member's agents act with the member's rights: memberships are keyed by the bare owner name,
 *   and almost every gate resolves the caller's owner and asks about that owner's membership. That
 *   is the right default for a team's own area, and the wrong one for an area that brings in outside
 *   people: an owner with 29 agents brings all 29 into a customer's space, and the member list shows
 *   every one of them to the customer (reported by omnituinen, 2026-09-28).
 *
 *   With agentAccess 'listed', only the agents on `agentGaiis` are admitted, and every other agent is
 *   treated as a non-member. The rule is subtractive only: it never gives an agent a right its owner
 *   does not have. It applies to agents (`name#owner@node`) and to nothing else: the owner signed in
 *   in person, an app acting under an app grant (its principal is the owner's own id), and an
 *   ecosystem app (which has its own data-area allowlist, services/ecosystem-access.ts) are not
 *   agents here.
 *
 *   Where it is enforced: once for every REST route under /v1/organisms/:id (routes/organisms.ts),
 *   once for every node MCP tool that takes `organism_id` (mcp/organism-agent-gate.ts), and in the
 *   shared gates reached from elsewhere: canReadWorkspace (services/workspace/access.ts), the
 *   `organism.*` key gate (services/organism-namespace-access.ts) and consent to an organism
 *   (services/consent.ts).
 * @structure agentAccessOf(), agentBarred(), organismsAdmitting(), attachedAsParticipant(), participantRefusalMessage(),
 *   agentBarredMessage(), barredAgentFor()
 * @usage if (agentBarred(organism, req.auth?.sub)) → refuse as for a non-member
 * @version-history
 *   v1.2.0 — 2026-11-13 — organismsAdmitting(): the one filter the agent's organism lists ask
 *     (structure programme 2026-11, unit 7).
 *   v1.1.0 — 2026-11-10 — attachedAsParticipant takes the owner's membership: an agent whose owner is
 *     an active member acts with the owner's rights in both modes, so attaching it never narrows it.
 *     participantRefusalMessage says what the narrow rule allows and how to get past it.
 *   v1.0.0 — 2026-09-28 — Initial.
 *   v1.0.1 — 2026-09-28 — agentBarred and barredAgentFor test that the principal is a string before
 *     reading it; any other value is no agent, as a missing one is (CodeQL
 *     js/type-confusion-through-parameter-tampering, alerts 1676 and 1677).
 */
import type { Storage, OrganismRecord, OrganismMembershipRecord } from '../storage/interface.js';
import { isGEAI } from '../utils/gaii.js';

export const AGENT_ACCESS_VALUES = ['all', 'listed'] as const;
export type AgentAccess = typeof AGENT_ACCESS_VALUES[number];

/** The organism's setting, with the default an unset column reads as. */
export function agentAccessOf(organism: Pick<OrganismRecord, 'agentAccess'> | null | undefined): AgentAccess {
  return organism?.agentAccess === 'listed' ? 'listed' : 'all';
}

/** Is `principal` an agent this organism does not admit? False for anything that is not an agent. */
export function agentBarred(
  organism: Pick<OrganismRecord, 'agentAccess' | 'agentGaiis'> | null | undefined,
  principal: string | null | undefined,
): boolean {
  // A type test, not a truthiness test: a caller can pass a request value, which may be an array.
  if (!organism || agentAccessOf(organism) !== 'listed' || typeof principal !== 'string' || !principal) return false;
  if (isGEAI(principal) || !principal.includes('#')) return false;
  return !(organism.agentGaiis ?? []).includes(principal);
}

/**
 * The organisms of a member list that admit `principal`: an organism that does not admit an agent is
 * not one it works in, and its name is its own. aimeat_organism_list, GET /v1/organisms?member= and
 * GET /v1/organisms/waiting list an agent its owner's organisms through this; until 2026-11-13 the
 * second listed an agent the organisms that bar it (structure programme 2026-11, unit 7).
 */
export function organismsAdmitting<T extends Pick<OrganismRecord, 'agentAccess' | 'agentGaiis'>>(
  organisms: T[], principal: string | null | undefined,
): T[] {
  return organisms.filter(o => !agentBarred(o, principal));
}

/**
 * Is this agent on `agentGaiis` as an organism-level participant only, which some gates give less
 * than a member (the shared area and a read of meta, no workspace)?
 *
 * Being on the list never takes a right away. An agent whose owner is an active member acts with the
 * owner's rights in both modes, so the answer is false for it, and `ownerMembership` is the owner's
 * membership row (null when there is none). The narrow rule is for an agent the organism admits
 * although its owner is not a member, and only where the organism admits every member's agent. Where
 * it admits only listed agents, an agent whose owner is not a member gets nothing, as before.
 *
 * Until 2026-11-10 the answer ignored the owner: with agentAccess 'all', attaching the creator's own
 * agent in the Agents section took every workspace write away from it, and setting 'listed' gave it
 * back (wish-organismiin-liitetty-agentti-ei-saa-menett-omistajansa-ty-ti).
 */
export function attachedAsParticipant(
  organism: Pick<OrganismRecord, 'agentAccess' | 'agentGaiis'>, principal: string,
  ownerMembership: Pick<OrganismMembershipRecord, 'status'> | null | undefined,
): boolean {
  if (ownerMembership?.status === 'active') return false;
  return agentAccessOf(organism) !== 'listed' && (organism.agentGaiis ?? []).includes(principal);
}

/** The refusal an organism-level participant hears for anything outside the shared area. */
export function participantRefusalMessage(organism: Pick<OrganismRecord, 'name'>, principal: string): string {
  return `${principal} is attached to the organism "${organism.name}", but its owner is not an active member of it. `
    + 'Such an agent reads and writes the organism\'s shared area and reads its meta records, and reaches no workspace. '
    + 'To work in a workspace, its owner joins the organism (an owner or admin invites them), and the workspace\'s creator gives the owner the contributor role.';
}

/** The refusal, in words the agent can act on and pass to its owner. */
export function agentBarredMessage(organism: Pick<OrganismRecord, 'name'>, principal: string): string {
  return `The organism "${organism.name}" admits only the agents its owners have listed, and ${principal} is not one of them. `
    + 'The owner of this agent, or an owner or admin of the organism, can add it in the Agents section of the organism\'s page.';
}

/** Loads the organism and answers the same question; null when the organism is gone or admits the caller. */
export async function barredAgentFor(
  storage: Pick<Storage, 'getOrganism'>, organismId: string, principal: string | null | undefined,
): Promise<OrganismRecord | null> {
  if (typeof principal !== 'string' || !principal.includes('#')) return null;
  const organism = await storage.getOrganism(organismId);
  return organism && agentBarred(organism, principal) ? organism : null;
}
