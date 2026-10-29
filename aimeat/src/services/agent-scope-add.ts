/**
 * @file src/services/agent-scope-add.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description May this caller add these permissions to another of the owner's agents, and the
 *   record each addition leaves for the owner. PATCH /v1/agents/:name/scopes and the node MCP tool
 *   aimeat_operator_agent_configure ask the same function, so the two surfaces cannot disagree.
 *
 *   WHY. An agent holding agent:permissions could only narrow a sibling's list, so an owner's AI
 *   that found an agent missing a permission could say what was wrong and could not fix it; the
 *   owner had to open eight agent pages by hand while a workflow stood still for a week (Jouni,
 *   2026-10-29: "haluan jatkossa että sinä pystyt tekemään tämmöisen muutoksen";
 *   wish-omistajan-ai-voi-lis-t-agenttien-oikeuksia-kun-omistaja-niin).
 *
 *   THE RULES, for a caller that is not the owner in person:
 *     1. The caller holds agent:permissions-add (PERMISSIONS_ADD_SCOPE). Its scopes are narrowed to
 *        its agent record on every request (auth/effective-scopes.ts), so the owner takes the word
 *        away on the agent's page and the next call is refused, whatever the token still carries.
 *     2. Every added word is one the caller holds itself. This is
 *        the rule the device-authorization auto-approve already keeps (routes/agents/device-auth.ts):
 *        an agent passes on only what it already holds, so the owner decides the widest reach by
 *        what they gave this one agent.
 *     3. agent:permissions-add itself is never passed on. Who may add permissions is the owner's
 *        choice per agent, made signed in themselves.
 *     4. Never to itself. It holds every word it could add already.
 *   The node's ceiling for agents (config.maxAgentScopes) is asked by the route before this.
 *
 *   WHAT THE OWNER SEES. Every addition is one line on the account feed (`agent_permissions_added`,
 *   with the archive behind it) and one notice in the bell, naming which agent gave which agent
 *   what, and where to take it back.
 * @structure ScopeAdditionCaller · ScopeAdditionCheck · checkScopeAddition(caller, target, wanted) ·
 *   recordScopeAddition(deps, byGaii, target, added)
 * @usage
 *   const check = checkScopeAddition({ gaii, scopes, inPerson }, agent, scopes);
 *   if (!check.ok) return res.status(403).json(error(nodeId, check.code, check.message, 403, check.details));
 *   await recordScopeAddition({ storage, config }, gaii, updated, check.added);
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (wish-omistajan-ai-voi-lis-t-agenttien-oikeuksia-kun-omistaja-niin).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { AgentRecord } from '../storage/types/identity.js';
import { PERMISSIONS_ADD_SCOPE, scopeIsCovered, uncoveredScopes } from '../utils/scope-coverage.js';
import { recordAccountEvent } from './account-events.js';
import { notify } from './notify.js';
import { agentPageUrl } from './permission-ask.js';
import { ownerGhiiOf, parseGAII } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

/** Who asks to change an agent's permissions. */
export interface ScopeAdditionCaller {
  /** The exact principal: an agent's GAII, or the owner's GHII. */
  gaii: string;
  /** The caller's scopes, narrowed to its agent record (auth/effective-scopes.ts). */
  scopes: readonly string[];
  /** The account holder in person, who sets any list the ceiling allows. */
  inPerson: boolean;
}

export type ScopeAdditionCheck =
  | { ok: true; added: string[] }
  | { ok: false; code: string; message: string; details: Record<string, unknown> };

/**
 * The words of `wanted` the target does not hold yet, when this caller may add them; otherwise
 * the refusal. Nothing is written here.
 */
export function checkScopeAddition(
  caller: ScopeAdditionCaller,
  target: AgentRecord,
  wanted: readonly string[],
): ScopeAdditionCheck {
  const added = uncoveredScopes(target.defaultScopes ?? [], wanted);
  if (added.length === 0 || caller.inPerson) return { ok: true, added };

  // The caller's scopes are already narrowed to its agent record on every request, REST and MCP
  // alike (auth/effective-scopes.ts withCurrentScopes), so a word the owner took away on the
  // agent's page is gone here though a token minted before still names it.
  const holds = (w: string) => scopeIsCovered(caller.scopes, w);

  if (!holds(PERMISSIONS_ADD_SCOPE)) {
    return {
      ok: false, code: 'SCOPE_ADDITION_REFUSED',
      message: "This agent can only take permissions away from another agent. To let it add them, "
        + "your owner ticks 'Add permissions to your other agents' on this agent's page; "
        + "otherwise they add the permission on the other agent's page.",
      details: { added, needs: PERMISSIONS_ADD_SCOPE },
    };
  }
  if (target.gaii === caller.gaii) {
    return {
      ok: false, code: 'SCOPE_ADDITION_REFUSED',
      message: 'An agent cannot add permissions to itself. Ask your owner to add them on your page.',
      details: { added },
    };
  }
  if (added.includes(PERMISSIONS_ADD_SCOPE)) {
    return {
      ok: false, code: 'PERSON_REQUIRED',
      message: "Only your owner, signed in themselves, lets an agent add permissions to other agents. They tick it on that agent's page.",
      details: { added: [PERMISSIONS_ADD_SCOPE] },
    };
  }
  const notHeld = added.filter((w) => !holds(w));
  if (notHeld.length > 0) {
    return {
      ok: false, code: 'SCOPE_NOT_HELD',
      message: `An agent can only give permissions it has itself, and this one does not have ${notHeld.join(', ')}. `
        + "Your owner can add them on the other agent's page, or give them to this agent first.",
      details: { added, not_held: notHeld },
    };
  }
  return { ok: true, added };
}

/** An agent's name for the owner's feed; the whole identity when it is not an agent's. */
function nameOf(gaii: string): string {
  return parseGAII(gaii)?.agent ?? gaii;
}

/**
 * Tell the owner that one of their agents added permissions to another: a line on the account feed
 * and a notice in the bell. Called after the write, for an agent caller only. Never throws: the
 * permissions are already saved, and each record logs its own failure.
 */
export async function recordScopeAddition(
  deps: { storage: Storage; config: AimeatConfig },
  byGaii: string,
  target: AgentRecord,
  added: readonly string[],
): Promise<void> {
  if (added.length === 0) return;
  const { storage, config } = deps;
  const ownerGhii = ownerGhiiOf(target.gaii);
  const by = nameOf(byGaii);
  const words = added.join(', ');
  const page = agentPageUrl(config.baseUrl, target.name);
  const link = page.slice(page.indexOf('/v1/'));
  logger.info('An agent added permissions to another agent', { by: byGaii, target: target.gaii, added });
  await recordAccountEvent(storage, {
    ownerGhii,
    kind: 'agent_permissions_added',
    actorGaii: byGaii,
    data: { by, name: target.name, words },
    link,
    subject: target.gaii,
  }, config);
  try {
    await notify(storage, ownerGhii, {
      type: 'agent_permissions_added',
      title: `${by} gave ${target.name} new permissions`,
      body: `${by} added these permissions to ${target.name}: ${words}. You can take them away on ${target.name}'s page. `
        + `On ${by}'s page you can also stop it from adding permissions.`,
      link,
      i18n: { key: 'agent_permissions_added', vars: { by, agent: target.name, words } },
      actions: [{ id: 'open', label: `Open ${target.name}'s page`, kind: 'navigate', link, style: 'primary', i18n: { key: 'agent_permissions_added.open', vars: { agent: target.name } } }],
    });
  } catch (err) {
    logger.warn('agent-scope-add: the bell notice could not be written', { target: target.gaii, error: String(err) });
  }
}
