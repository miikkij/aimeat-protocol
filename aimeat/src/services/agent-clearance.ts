/**
 * @file src/services/agent-clearance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An agent's clearance, set (plan doc-mvdipuyqraas, L2.1 and L2.3): the highest
 *   classification label the agent may read. One implementation behind PATCH
 *   /v1/agents/:name/clearance, the node MCP tool aimeat_operator_agent_configure and its connector
 *   and CLI copies, which call that route. What the reader does with it is
 *   services/classification/clearance.ts.
 *
 *   THE VALUE. A label id of the policy that applies to the agent's owner (the node's, merged with
 *   the owner's own level), active, or null for no limit. Stored as the id, so the rank is read from
 *   the policy at each read and a renamed label keeps working.
 *
 *   WHO. The owner, or another agent of the same owner holding `agent:permissions` (the route asks
 *   the word; the owner in person is not asked it). Never the agent itself, in either direction: an
 *   agent that could change its own limit would make the limit a request. Another owner, an app, an
 *   ecosystem app and a visitor from another node are refused.
 *
 *   A LOOSENING WAITS FOR THE OWNER IN PERSON. Raising the clearance, or removing it, lets the agent
 *   read more, so only the owner signed in themselves makes that change, as with the other
 *   loosenings (agent scopes, the classification switch). An agent holding agent:permissions may
 *   lower another agent's clearance, or set one where there was none.
 *
 *   THE RECORD. Every change is one row of the owner's classification audit log: action `changed`,
 *   key `agent.clearance:<gaii>`, the new label (or `none`), purpose `<from> → <to>`.
 *
 *   NEW AGENTS. newAgentClearance(config) is what each place that creates an agent spreads into the
 *   record: the node's classification.agent_clearance_default, or nothing (decision 10.5: no limit).
 * @structure ClearanceOutcome · newAgentClearance() · clearanceView() · setAgentClearance()
 * @usage
 *   await storage.createAgent({ ..., ...agentListingTags(config), ...newAgentClearance(config) });
 *   const out = await setAgentClearance({ storage, config }, callerOf(req, config.nodeId, storage), name, 'sisainen');
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvdipuyqraas, L2.1, L2.3).
 */
import type { AimeatConfig } from '../config.js';
import type { AgentRecord } from '../storage/interface.js';
import type { CallerContext } from './caller-context.js';
import { resolveAgentTarget, type AgentWriteDeps } from './agent-profile-write.js';
import { labelById, type ClassificationPolicy } from './classification/defaults.js';
import { policyFor } from './classification/policy.js';
import { recordClassificationAudit } from './classification/audit.js';
import { emitChange } from './event-bus.js';
import { logger } from '../utils/logger.js';

export type ClearanceOutcome =
  | { ok: true; agent: AgentRecord; from: string | null; changed: boolean }
  | { ok: false; status: 400 | 403 | 404 | 500; code: 'INVALID_INPUT' | 'AGENT_NOT_FOUND' | 'ACCESS_DENIED' | 'PERSON_REQUIRED' | 'UPDATE_FAILED'; message: string };

/** The clearance a new agent starts with: the node's setting, or nothing (no limit). */
export function newAgentClearance(config: Pick<AimeatConfig, 'agentClearanceDefault'>): { clearance?: string } {
  return config.agentClearanceDefault ? { clearance: config.agentClearanceDefault } : {};
}

/** The rank a clearance stands for: no clearance is above every label; one the policy lost is below all. */
function rankOf(policy: ClassificationPolicy, id: string | null): number {
  if (id === null) return Number.POSITIVE_INFINITY;
  return labelById(policy, id)?.rank ?? -1;
}

/**
 * What an agent's view carries about its clearance: the id, and the label's names when the policy
 * has it. `null` is no limit.
 */
export function clearanceView(policy: ClassificationPolicy, agent: Pick<AgentRecord, 'clearance'>):
  { clearance: string | null; clearance_label: { id: string; name: { fi: string; en: string; es: string }; rank: number } | null } {
  const id = agent.clearance ?? null;
  const label = labelById(policy, id);
  return { clearance: id, clearance_label: label ? { id: label.id, name: label.name, rank: label.rank } : null };
}

/**
 * Set or clear the clearance of `identifier` (a name under the caller's owner, or a whole GAII).
 * Refuses, in this order: a caller that is not the owner or the owner's agent, an agent that is not
 * there, another owner's agent, the agent itself, a label the policy does not have, and a loosening
 * by anyone but the owner in person. Setting the value it already has answers ok with
 * `changed: false`. `dryRun` answers what the call would do and writes nothing.
 */
export async function setAgentClearance(
  deps: AgentWriteDeps, caller: CallerContext, identifier: string, clearance: unknown,
  /** dryRun: every check and no write, so the MCP tool's propose step shows only what will apply. */
  opts: { dryRun?: boolean } = {},
): Promise<ClearanceOutcome> {
  if (clearance !== null && typeof clearance !== 'string') {
    return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'clearance is the id of a classification, or null for no limit.' };
  }
  const next = clearance === null || clearance === '' ? null : clearance;
  if (!caller.inPerson && caller.kind !== 'agent') {
    return { ok: false, status: 403, code: 'ACCESS_DENIED', message: 'Only the owner, or one of the owner\'s agents, sets what an agent may read.' };
  }
  const gaii = resolveAgentTarget(deps.config, caller.owner, identifier);
  const agent = await deps.storage.getAgent(gaii);
  if (!agent) return { ok: false, status: 404, code: 'AGENT_NOT_FOUND', message: `Agent not found: ${identifier}` };
  if (agent.owner !== caller.owner) {
    return { ok: false, status: 403, code: 'ACCESS_DENIED', message: 'You can only set what your own agents may read.' };
  }
  if (!caller.inPerson && caller.principal === gaii) {
    return { ok: false, status: 403, code: 'ACCESS_DENIED',
      message: 'An agent cannot change what it may read itself. Ask the owner, on the agent\'s page.' };
  }

  const ownerGhii = caller.ownerGhii;
  const policy = await policyFor(deps.storage, deps.config, ownerGhii);
  if (next !== null) {
    const label = labelById(policy, next);
    if (!label || label.status !== 'active') {
      const ids = policy.labels.filter(l => l.status === 'active').sort((a, b) => a.rank - b.rank).map(l => l.id);
      return { ok: false, status: 400, code: 'INVALID_INPUT', message: `There is no classification "${next}". Choose one of: ${ids.join(', ')}, or null for no limit.` };
    }
  }

  const from = agent.clearance ?? null;
  if (from === next) return { ok: true, agent, from, changed: false };
  if (!caller.inPerson && rankOf(policy, next) > rankOf(policy, from)) {
    return { ok: false, status: 403, code: 'PERSON_REQUIRED',
      message: 'Letting an agent read more is the owner\'s decision. The owner raises it or removes the limit on the agent\'s page, signed in themselves. An agent can only lower it.' };
  }
  if (opts.dryRun) return { ok: true, agent: { ...agent, clearance: next }, from, changed: true };

  const updated = await deps.storage.updateAgent(gaii, { clearance: next });
  if (!updated) return { ok: false, status: 500, code: 'UPDATE_FAILED', message: 'What the agent may read could not be saved. Try again in a moment.' };

  recordClassificationAudit({
    scope: ownerGhii, ownerGaii: ownerGhii, kind: 'memory', key: `agent.clearance:${gaii}`, label: next ?? 'none',
    reader: caller.principal, readerKind: caller.inPerson ? 'human' : 'ai', action: 'changed',
    purpose: `${from ?? 'none'} → ${next ?? 'none'}`,
  });
  logger.info('Agent clearance changed', { event: 'agent.clearance', gaii, by: caller.principal, from, to: next });
  emitChange('agents');
  return { ok: true, agent: updated, from, changed: true };
}
