/**
 * @file src/services/goals/goals-model-spend.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whose permission a goal's model work spends the owner's AI allowance under: the agent's
 *   that asked for the work, with the same word that agent needs to start an AI job on the owner's
 *   allowance itself (ai:use, auth/ai-gate.ts). Without it the work waits for the owner's one press.
 *
 *   WHY. A model work runs as a background AI job on the owner's key and allowance (goals-model.ts).
 *   POST /v1/ai/jobs asks an agent for ai:use before a job starts; the goal path did not, so an agent
 *   with task:write and no ai:use spent the owner's allowance through a goal (secaudit2026oct26 round
 *   8c, goals:model-work-runs-as-owner-without-requesting-agent-authority, background-05).
 *
 *   WHO ASKED. The work's `createdBy` when it is an agent of this owner. A work the node made (a
 *   reaction, a clock round, a step after a held chain) carries the goal's own author: the agent that
 *   created the goal, unless the owner approved that goal as a proposal, which is the owner's own act
 *   (purpose rule 4). The owner in person asks nothing. An agent holding ai:use, or one the owner
 *   already allowed for this goal (`modelSpendAllowed`), runs as before.
 *
 *   THE ONE PRESS (services/approval-standard.ts). The work waits (`status: 'waiting'`, `spendAsk`, a
 *   reason the goal shows), and a request of kind `goal-model-spend` asks the owner in plain words. An
 *   agent holding ai:use may answer for the owner; the asking agent may not. Allow
 *   (apply-goal-model-spend.ts): the agent joins the goal's modelSpendAllowed and the work runs, as it
 *   did before this rule; later model works that agent asks for in this goal run without asking.
 *   Don't allow, or no answer before the request expires (settleModelSpendAsks, from the minute
 *   sweep): this work stops with the reason. The agent hears the answer either way.
 * @structure modelWorkRequester · modelWorkSpendNeed · askOwnerForModelSpend · answerModelSpend · settleModelSpendAsks
 * @usage
 *   const agent = await modelWorkSpendNeed(deps, ownerGhii, goal, work);   // goals-model.ts, before the take
 *   if (agent) return askOwnerForModelSpend(deps, ownerGhii, goal, work, agent);
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (secaudit2026oct26 round 8c, background-05).
 */
import { localAccountName, localAccountOf, parseGAII, isGEAI } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { scopeIsCovered } from '../../utils/scope-coverage.js';
import { saverAuthority } from '../workflow/trigger-authority.js';
import { fileAsk } from '../publish-requests/ask.js';
import { readPublishRequest } from '../publish-requests/store.js';
import { publishRequestExpired } from '../publish-requests/policy.js';
import { UNCHANGED } from '../record-cas.js';
import { logEntry, updateGoal, type GoalDeps } from './goals-store.js';
import type { GoalRecord, GoalWork } from './goals-types.js';

/** The word an agent needs to start an AI job on the owner's allowance (auth/ai-gate.ts). */
export const AI_USE_SCOPE = 'ai:use';

const nameOf = (gaii: string) => parseGAII(gaii)?.agent ?? gaii;

/** True for an agent principal of this owner (not an app, not another node's namesake). */
function ownAgent(principal: string | undefined, ownerName: string): boolean {
  return !!principal && !!parseGAII(principal) && !isGEAI(principal) && localAccountOf(principal) === ownerName;
}

/** True when the owner approved this goal as a proposal: the works in it are the owner's own yes. */
function approvedByOwner(goal: GoalRecord): boolean {
  if (goal.approvedAt) return true;
  // A goal approved before approvedAt was kept: the approve action's log line, by the owner.
  return goal.log.some(e => e.who === 'owner' && e.kind === 'changed' && e.what.startsWith('The owner approved the proposed goal'));
}

/** The agent whose permission `work` spends the owner's allowance under, or null for the owner's own. */
export function modelWorkRequester(goal: GoalRecord, work: GoalWork, ownerName: string): string | null {
  if (ownAgent(work.createdBy, ownerName)) return work.createdBy;
  if (work.createdBy === 'node' && ownAgent(goal.createdBy, ownerName) && !approvedByOwner(goal)) return goal.createdBy;
  return null;
}

/**
 * The agent that asked for this model work and may not spend the owner's allowance itself, when the
 * owner has not allowed it for this goal; otherwise null and the work runs as before.
 */
export async function modelWorkSpendNeed(deps: GoalDeps, ownerGhii: string, goal: GoalRecord, work: GoalWork): Promise<string | null> {
  const agent = modelWorkRequester(goal, work, localAccountName(ownerGhii));
  if (!agent || (goal.modelSpendAllowed ?? []).includes(agent)) return null;
  const now = await saverAuthority(deps.storage, { kind: 'agent', id: agent });
  return scopeIsCovered(now.scopes, AI_USE_SCOPE) ? null : agent;
}

/** File the owner's question for `agent`, and put the work to wait on it. Never throws. */
export async function askOwnerForModelSpend(deps: GoalDeps, ownerGhii: string, goal: GoalRecord, work: GoalWork, agent: string): Promise<void> {
  const who = nameOf(agent);
  try {
    const filed = await fileAsk(deps, localAccountName(ownerGhii), { principal: agent, kind: 'agent', sub: agent }, {
      kind: 'goal-model-spend',
      target: { goal: goal.id, work: work.id, agent },
      title: `AIMEAT's model doing the work "${work.title}" on your AI allowance`,
      name: work.title,
      change: { field: 'goal.model.spend', from: null, to: 'allowed' },
      approval: {
        approver: 'owner',
        asks: `let AIMEAT's model do the work "${work.title}" of the goal "${goal.title}" on your AI allowance, and later model works ${who} asks for in this goal`,
        why: `${who} asked for this work, and ${who} does not have the AI permission, so it may not spend your AI allowance itself. `
          + 'If you do not allow it, this work does not run.',
        approve_scope: AI_USE_SCOPE,
        change: { link: `/v1/profile?tab=agents&agent=${encodeURIComponent(who)}`, key: 'approval_change.agent_page' },
        i18n: { key: 'approval_goal_model_spend', vars: { agent: who, work: work.title, goal: goal.title } },
      },
    });
    const requestId = filed.ok ? filed.request.id : '';
    const reason = filed.ok
      ? `Waiting for the owner: ${who} asked for this work and may not spend the owner's AI allowance itself, so the model does it when the owner allows it.`
      : `Waiting: the owner could not be asked whether ${who} may spend the AI allowance (${filed.message}). The work stops at the next minute.`;
    await updateGoal(deps, ownerGhii, goal.id, cur => {
      const w = cur.works.find(x => x.id === work.id);
      if (!w || w.status !== 'open' || w.spendAsk) return UNCHANGED;
      return {
        ...cur,
        works: cur.works.map(x => x.id === work.id ? { ...x, status: 'waiting' as const, spendAsk: { requestId, agent }, reason } : x),
        log: [...cur.log, logEntry('node', 'asked', reason, { workId: work.id })],
      };
    });
  } catch (err) {
    logger.warn('goal: the owner could not be asked about a model work\'s spending', { goalId: goal.id, workId: work.id, error: String(err) });
  }
}

/**
 * Settle the work's question. Allowed: the agent joins the goal's modelSpendAllowed and the work
 * opens. Not allowed: the work stops with the reason. Answers whether the goal changed.
 */
export async function answerModelSpend(
  deps: GoalDeps, ownerGhii: string, goalId: string, workId: string, requestId: string, allowed: boolean,
): Promise<boolean> {
  let changed = false;
  await updateGoal(deps, ownerGhii, goalId, cur => {
    const w = cur.works.find(x => x.id === workId);
    if (!w || w.status !== 'waiting' || !w.spendAsk || w.spendAsk.requestId !== requestId) return UNCHANGED;
    changed = true;
    const agent = w.spendAsk.agent;
    const who = nameOf(agent);
    const settledAt = new Date().toISOString();
    return {
      ...cur,
      ...(allowed ? { modelSpendAllowed: [...new Set([...(cur.modelSpendAllowed ?? []), agent])] } : {}),
      works: cur.works.map(x => x.id !== workId ? x : allowed
        ? { ...x, status: 'open' as const, spendAsk: undefined, reason: undefined }
        : { ...x, status: 'failed' as const, spendAsk: undefined, settledAt, reason: `The owner did not allow ${who} to spend the AI allowance on this work.` }),
      log: [...cur.log, logEntry('node', 'decision', allowed
        ? `The owner allowed AIMEAT's model to do "${w.title}" and the model works ${who} asks for in this goal on the AI allowance.`
        : `The owner did not allow ${who} to spend the AI allowance on "${w.title}", so it does not run.`, { workId })],
    };
  });
  return changed;
}

/**
 * The minute sweep's part: a question declined, expired, closed as outdated or never filed stops its
 * work. An allowed one was settled by its approval (apply-goal-model-spend.ts).
 */
export async function settleModelSpendAsks(deps: GoalDeps, ownerGhii: string, goal: GoalRecord): Promise<void> {
  for (const w of goal.works.filter(x => x.status === 'waiting' && x.spendAsk)) {
    const ask = w.spendAsk!;
    const request = ask.requestId ? await readPublishRequest(deps.storage, ownerGhii, ask.requestId) : null;
    if (request && request.state === 'awaiting_owner' && !publishRequestExpired(request, Date.now())) continue;
    await answerModelSpend(deps, ownerGhii, goal.id, w.id, ask.requestId, request?.state === 'approved');
  }
}
