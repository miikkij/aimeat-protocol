/**
 * @file src/services/goals/goals-model-reach.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which records a goal's model work may hand the node's model: each one with the reach of
 *   whoever named it in the goal, as POST /v1/ai/jobs reads a job's inputs with the reach of the one
 *   who starts it (ai-jobs/starter.ts jobReadViewer).
 *
 *   WHY. A model work reads the goal's material and earlier results into its prompt, and the job ran
 *   with no viewer, so a record was read across the whole owner scope with no visibility check. An
 *   agent without memory:read-as-owner, whose own read of the owner's or a sibling agent's private
 *   record is refused, attached that record as material, and the model's answer carried it back into
 *   the goal (secaudit2026oct26, goals:model-work-runs-as-owner-without-requesting-agent-authority).
 *
 *   WHO NAMED WHAT. A 'memory' or 'result' material names its `by`; an earlier work's deliverable
 *   names the agent that took that work. The owner in person, the node's own model and an agent that
 *   holds memory:read-as-owner read everything, so their records go to the model as before. An agent
 *   without that word reads its own records and the records at visibility owner, members or public
 *   (owner-scope-read.ts), the same as its own memory read. A record it may not read stops the work
 *   before any model is called, with a sentence that names memory:read-as-owner and the agent's page,
 *   and the refusal goes on the agent's card and in the owner's bell, where the owner ticks the word.
 * @structure modelWorkInputRefusal(deps, ownerGhii, goal, keys)
 * @usage const refused = await modelWorkInputRefusal(deps, ownerGhii, goal, body.memoryKeys); if (refused) throw refused.error;
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import { localAccountName, parseGAII, isGEAI } from '../../utils/gaii.js';
import { getOwnerScopeMemory } from '../owner-memory.js';
import { visibleToSameOwnerReader, READ_AS_OWNER_SCOPE } from '../owner-scope-read.js';
import { aiReadViewerOf, hiddenRecordError, type AiInputHiddenError } from '../ai-read-viewer.js';
import { saverAuthority } from '../workflow/trigger-authority.js';
import { agentPageUrl } from '../permission-ask.js';
import { noteAgentRefusal } from '../agent-refusals.js';
import type { GoalDeps } from './goals-store.js';
import { MODEL_TAKER, type GoalRecord } from './goals-types.js';

/** The agents of this account that named `key` in the goal, as GAIIs. The owner and the node's model are left out. */
function agentNamers(goal: GoalRecord, key: string, ownerName: string, nodeId: string): string[] {
  const out = new Set<string>();
  for (const m of goal.material) {
    if ((m.kind === 'memory' || m.kind === 'result') && m.ref === key && parseGAII(m.by) && !isGEAI(m.by)) out.add(m.by);
  }
  for (const w of goal.works) {
    const by = w.result?.by;
    if (w.result?.deliverableKey === key && by && by !== MODEL_TAKER) out.add(`${by}#${ownerName}@${nodeId}`);
  }
  return [...out];
}

/**
 * The refusal when a record the model work would read was named by an agent that may not read it,
 * or null. Asked before the job starts; nothing is read into a prompt before it answers.
 */
export async function modelWorkInputRefusal(
  deps: GoalDeps, ownerGhii: string, goal: GoalRecord, keys: readonly string[],
): Promise<{ error: AiInputHiddenError; agent: string } | null> {
  const ownerName = localAccountName(ownerGhii);
  const { nodeId, baseUrl } = deps.config;
  for (const key of keys) {
    const namers = agentNamers(goal, key, ownerName, nodeId);
    if (!namers.length) continue;
    const rec = await getOwnerScopeMemory(deps.storage, nodeId, ownerName, key);
    if (!rec) continue;
    for (const gaii of namers) {
      if (visibleToSameOwnerReader(rec, gaii)) continue;
      const now = await saverAuthority(deps.storage, { kind: 'agent', id: gaii });
      const name = parseGAII(gaii)?.agent ?? gaii;
      const viewer = aiReadViewerOf({ principal: gaii, owner: ownerName, roles: ['agent'], scopes: now.scopes },
        `The goal's model reads what ${name}, which named this record in the goal, may read. The agent's page: ${agentPageUrl(baseUrl, name)}`);
      if (!viewer || viewer.readsAll) continue;
      // On the agent's card and in the owner's bell, as a scheduled ai job's refused read is.
      noteAgentRefusal({ sub: gaii, roles: ['agent'] }, [READ_AS_OWNER_SCOPE], false, `goal ${goal.id}`);
      return { error: hiddenRecordError(key, viewer), agent: gaii };
    }
  }
  return null;
}
