/**
 * @file src/services/goals/goals-model-reach.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which records a goal's model work may hand the node's model: each one with the reach of
 *   whoever named it in the goal, as POST /v1/ai/jobs reads a job's inputs with the reach of the one
 *   who starts it (ai-jobs/starter.ts jobReadViewer). A record the namer may not read waits for the
 *   owner's one press; it is never read without it.
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
 *   (owner-scope-read.ts), the same as its own memory read.
 *
 *   THE ONE PRESS (the approval standard, services/approval-standard.ts). When such an agent named a
 *   private record, the work does not start: it waits (`status: 'waiting'`, `readAsk`, a reason the
 *   goal shows), and a request of kind `goal-model-read` asks the owner, in plain words, whether the
 *   model may read those records for that work. An agent holding memory:read-as-owner may answer for
 *   the owner; the agent that named them may not. Allow (apply-goal-model-read.ts): the work opens and
 *   runs with the records, as it did before this rule. Don't allow, or no answer before the request
 *   expires (settleModelReadAsks, from the minute sweep): the work opens and runs without them, and a
 *   work left with none of the records it was given stops with the reason. The agent hears the answer
 *   either way.
 * @structure modelWorkReadNeed · askOwnerForModelRead · allowModelRead · settleModelReadAsks · modelInputKeys
 * @usage
 *   const need = await modelWorkReadNeed(deps, ownerGhii, goal, work, keys);   // goals-model.ts, before the take
 *   if (need) return askOwnerForModelRead(deps, ownerGhii, goal, work, need);
 * @version-history
 *   v1.1.0 — 2026-10-27 — A record the namer may not read waits for the owner's one press instead of
 *     stopping the work (the coordinator's review of round 8).
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import { localAccountName, parseGAII, isGEAI } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { getOwnerScopeMemory } from '../owner-memory.js';
import { visibleToSameOwnerReader, READ_AS_OWNER_SCOPE } from '../owner-scope-read.js';
import { aiReadViewerOf } from '../ai-read-viewer.js';
import { saverAuthority } from '../workflow/trigger-authority.js';
import { agentSessionCaller } from '../caller-context.js';
import { fileAsk } from '../publish-requests/ask.js';
import { readPublishRequest } from '../publish-requests/store.js';
import { publishRequestExpired } from '../publish-requests/policy.js';
import { UNCHANGED } from '../record-cas.js';
import { logEntry, updateGoal, type GoalDeps } from './goals-store.js';
import { MODEL_TAKER, type GoalRecord, type GoalWork } from './goals-types.js';

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

const nameOf = (gaii: string) => parseGAII(gaii)?.agent ?? gaii;

/** The keys the model reads for `work`: the ones given, without those the owner left out. */
export function modelInputKeys(work: Pick<GoalWork, 'readLeftOut'>, keys: readonly string[]): string[] {
  const out = new Set(work.readLeftOut ?? []);
  return keys.filter(k => !out.has(k));
}

/**
 * The private records one agent named that it may not read, and that the owner has not allowed for
 * this work, or null. Asked before the work is taken; one agent at a time, so one request asks one thing.
 */
export async function modelWorkReadNeed(
  deps: GoalDeps, ownerGhii: string, goal: GoalRecord, work: GoalWork, keys: readonly string[],
): Promise<{ agent: string; keys: string[] } | null> {
  const ownerName = localAccountName(ownerGhii);
  const { nodeId } = deps.config;
  const allowed = new Set(work.readAllowed ?? []);
  let need: { agent: string; keys: string[] } | null = null;
  for (const key of keys) {
    if (allowed.has(key)) continue;
    const namers = agentNamers(goal, key, ownerName, nodeId).filter(g => !need || g === need.agent);
    if (!namers.length) continue;
    const rec = await getOwnerScopeMemory(deps.storage, nodeId, ownerName, key);
    if (!rec) continue;
    for (const gaii of namers) {
      if (visibleToSameOwnerReader(rec, gaii)) continue;
      const now = await saverAuthority(deps.storage, { kind: 'agent', id: gaii });
      // The agent as its own session would be, with the words it holds now (caller-context.ts).
      const agent = agentSessionCaller(gaii, ownerName, now.scopes, nodeId, deps.storage).auth;
      const viewer = aiReadViewerOf({ principal: gaii, owner: ownerName, roles: agent.roles, scopes: now.scopes });
      if (!viewer || viewer.readsAll) continue;
      need ??= { agent: gaii, keys: [] };
      need.keys.push(key);
      break;
    }
  }
  return need;
}

/** File the owner's question for `need`, and put the work to wait on it. Never throws. */
export async function askOwnerForModelRead(
  deps: GoalDeps, ownerGhii: string, goal: GoalRecord, work: GoalWork, need: { agent: string; keys: string[] },
): Promise<void> {
  const agent = nameOf(need.agent);
  const records = need.keys.map(k => `"${k}"`).join(', ');
  try {
    const filed = await fileAsk(deps, localAccountName(ownerGhii), { principal: need.agent, kind: 'agent', sub: need.agent }, {
      kind: 'goal-model-read',
      target: { goal: goal.id, work: work.id, keys: JSON.stringify(need.keys), agent: need.agent },
      title: `the private record${need.keys.length > 1 ? 's' : ''} ${records} for the work "${work.title}"`,
      name: need.keys.join(', '),
      change: { field: 'goal.model.read', from: null, to: 'allowed' },
      approval: {
        approver: 'owner',
        asks: `let AIMEAT's model read your private record${need.keys.length > 1 ? 's' : ''} ${records} for the work "${work.title}" of the goal "${goal.title}"`,
        why: `${agent} named ${need.keys.length > 1 ? 'these records' : 'this record'} in the goal, and ${agent} may not read your private records itself. `
          + `The model would use ${need.keys.length > 1 ? 'them' : 'it'} in its answer, which ${agent} can read. If you do not allow it, the work runs without ${need.keys.length > 1 ? 'them' : 'it'}.`,
        approve_scope: READ_AS_OWNER_SCOPE,
        change: { link: `/v1/profile?tab=agents&agent=${encodeURIComponent(agent)}`, key: 'approval_change.agent_page' },
        i18n: { key: 'approval_goal_model_read', vars: { agent, records: need.keys.join(', '), work: work.title, goal: goal.title } },
      },
    });
    const requestId = filed.ok ? filed.request.id : '';
    const reason = filed.ok
      ? `Waiting for the owner: ${agent} named ${records}, which ${agent} may not read, so the model reads ${need.keys.length > 1 ? 'them' : 'it'} only when the owner allows it.`
      : `Waiting: the owner could not be asked about ${records} (${filed.message}). The work runs without ${need.keys.length > 1 ? 'them' : 'it'} at the next minute.`;
    await updateGoal(deps, ownerGhii, goal.id, cur => {
      const w = cur.works.find(x => x.id === work.id);
      if (!w || w.status !== 'open' || w.readAsk) return UNCHANGED;
      return {
        ...cur,
        works: cur.works.map(x => x.id === work.id ? { ...x, status: 'waiting' as const, readAsk: { requestId, agent: need.agent, keys: need.keys }, reason } : x),
        log: [...cur.log, logEntry('node', 'asked', reason, { workId: work.id })],
      };
    });
  } catch (err) {
    logger.warn('goal: the owner could not be asked about a model work\'s records', { goalId: goal.id, workId: work.id, error: String(err) });
  }
}

/**
 * Settle the work's question: `allowed` adds its records to readAllowed, otherwise to readLeftOut,
 * and the work opens again. Answers whether the goal changed.
 */
export async function allowModelRead(
  deps: GoalDeps, ownerGhii: string, goalId: string, workId: string, requestId: string, allowed: boolean,
): Promise<boolean> {
  let changed = false;
  await updateGoal(deps, ownerGhii, goalId, cur => {
    const w = cur.works.find(x => x.id === workId);
    if (!w || w.status !== 'waiting' || !w.readAsk || w.readAsk.requestId !== requestId) return UNCHANGED;
    changed = true;
    const keys = w.readAsk.keys;
    const what = keys.map(k => `"${k}"`).join(', ');
    return {
      ...cur,
      works: cur.works.map(x => x.id !== workId ? x : {
        ...x, status: 'open' as const, readAsk: undefined, reason: undefined,
        ...(allowed ? { readAllowed: [...new Set([...(x.readAllowed ?? []), ...keys])] } : { readLeftOut: [...new Set([...(x.readLeftOut ?? []), ...keys])] }),
      }),
      log: [...cur.log, logEntry('node', 'decision', allowed
        ? `The owner allowed the model to read ${what} for "${w.title}".`
        : `The owner did not allow the model to read ${what}, so "${w.title}" runs without ${keys.length > 1 ? 'them' : 'it'}.`, { workId })],
    };
  });
  return changed;
}

/**
 * The minute sweep's part: a question declined, expired, closed as outdated or never filed opens its
 * work without the records. An allowed one was settled by its approval (apply-goal-model-read.ts).
 */
export async function settleModelReadAsks(deps: GoalDeps, ownerGhii: string, goal: GoalRecord): Promise<void> {
  for (const w of goal.works.filter(x => x.status === 'waiting' && x.readAsk)) {
    const ask = w.readAsk!;
    const request = ask.requestId ? await readPublishRequest(deps.storage, ownerGhii, ask.requestId) : null;
    if (request && request.state === 'awaiting_owner' && !publishRequestExpired(request, Date.now())) continue;
    await allowModelRead(deps, ownerGhii, goal.id, w.id, ask.requestId, request?.state === 'approved');
  }
}
