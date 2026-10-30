/**
 * @file src/services/goals/goals-advance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What moves an agent goal on after anything happened in it. One pure step reads the goal
 *   and answers the goal as it should now be plus the side effects to run: a waiting work whose works
 *   before it are done opens; a reaction whose works are done makes its next work (or, past the chain
 *   limit, a step that waits for the person's yes); a work named to an agent is taken for it; open work
 *   is offered to every agent that may take it, and after a short grace the first free one of them takes
 *   it (Jouni's choice 2 of 25.10.2026: offered to all, the first takes); a work nobody can take tells
 *   the owner once; a person's new step tells the owner once; a goal whose works are all finished is
 *   done; and the coordinator is woken by a task when something happened that it did not do itself.
 *   advanceGoal() writes that goal on its version and then runs the effects. Nothing here is called by
 *   itself: claimWork writes the goal and returns, so one advance never starts another.
 * @structure OFFER_GRACE_MS · NOBODY_MS · computeAdvance() · advanceGoal()
 * @usage await advanceGoal(deps, ownerGhii, goalId);
 * @version-history
 *   v1.2.1 — 2026-10-29 — A model work waiting for the owner's answer on its spending (spendAsk) stays
 *     waiting until it is answered (goals-model-spend.ts; secaudit2026oct26 round 8c).
 *   v1.2.0 — 2026-10-27 — A model work waiting for the owner's answer on a record (readAsk) stays
 *     waiting until it is answered (goals-model-reach.ts; secaudit2026oct26).
 *   v1.1.0 — 2026-10-25 — An open work with `runner: 'model'` is started by the node's model
 *     (goals-model.ts) inside the spending limit; a proposed goal does not move.
 *   v1.0.0 — 2026-10-25 — Initial (session cc-jouni-goals).
 */
import { logger } from '../../utils/logger.js';
import { emitDelivery } from '../event-bus.js';
import { notify } from '../notify.js';
import { materialiseAgentTask } from '../scheduler-agent-task.js';
import { UNCHANGED } from '../record-cas.js';
import { LIVE_TASK_STATUSES } from '../../storage/types/agents-messaging.js';
import { logEntry, readGoal, updateGoal, type GoalDeps } from './goals-store.js';
import { isFree, mayTake, ownerAgents, type GoalAgent } from './goals-agents.js';
import { claimWork, makeWork, appendWorks } from './goals-work.js';
import { runModelWork } from './goals-model.js';
import { goalSettled, trackingCode, workSettled, type GoalLogEntry, type GoalRecord, type GoalWork } from './goals-types.js';

/** Offered open work waits this long for an agent to take it before the first free one is given it. */
export const OFFER_GRACE_MS = 60_000;
/** Open work no agent took in this long is shown to the owner with the ways forward. */
export const NOBODY_MS = 15 * 60_000;

/** What happened that the coordinator did not do itself, and which it should think about. */
const WAKE_KINDS: ReadonlySet<GoalLogEntry['kind']> = new Set(['done', 'failed', 'declined', 'returned', 'answered', 'material', 'limit', 'changed', 'subgoal']);

export interface AdvanceEffects {
  assign: Array<{ workId: string; agent: string }>;
  /** Works the node's model starts (goals-model.ts runModelWork). */
  run: string[];
  offer: Array<{ workId: string; agents: GoalAgent[] }>;
  notify: Array<{ title: string; body: string; workId?: string }>;
  wake: boolean;
}

function roundOf(goal: GoalRecord): number { return goal.rounds?.count ?? 0; }

/** The goal as it should now be, and the effects to run once it is written. Pure. */
export function computeAdvance(goal: GoalRecord, agents: GoalAgent[], free: Set<string>, now = Date.now()): { goal: GoalRecord; effects: AdvanceEffects } {
  const effects: AdvanceEffects = { assign: [], run: [], offer: [], notify: [], wake: false };
  if (goalSettled(goal.status) || goal.status === 'paused' || goal.status === 'proposed') return { goal, effects };
  let g: GoalRecord = { ...goal, works: goal.works.map(w => ({ ...w })), log: [...goal.log], reactions: goal.reactions.map(r => ({ ...r })) };
  const nowIso = new Date(now).toISOString();
  const byId = () => new Map(g.works.map(w => [w.id, w]));

  // 1. A waiting work opens when the works before it are done.
  for (const w of g.works) {
    // A model work that waits for the owner's answer on a record (readAsk) or on its spending
    // (spendAsk) opens when it is answered.
    if (w.status === 'waiting' && !w.readAsk && !w.spendAsk && (w.after ?? []).every(a => byId().get(a)?.status === 'done')) {
      if (!w.waitUntil || Date.parse(w.waitUntil) <= now) w.status = 'open';
    }
  }

  // 2. Reactions: once per round, when the works they name are done.
  const round = roundOf(g);
  const rulesRun = g.substitute !== 'wait' || g.mode !== 'coordinator';
  if (rulesRun) {
    for (const r of g.reactions) {
      if (r.firedRounds.includes(round)) continue;
      const matched = r.when.works?.length
        ? r.when.works.map(id => byId().get(id)).filter((w): w is GoalWork => !!w)
        : g.works.filter(w => (w.round ?? 0) === round && !!r.when.wants && (w.wants ?? []).map(s => s.toLowerCase()).includes(r.when.wants.toLowerCase()));
      if (!matched.length || !matched.every(w => w.status === 'done')) continue;
      r.firedRounds = [...r.firedRounds, round];
      const hop = Math.max(...matched.map(w => w.hop)) + 1;
      const last = matched[matched.length - 1];
      // `after` names every work the reaction waited for, so the next work's task carries all their
      // results (goals-work.ts taskBody), not only the last one's.
      const spec = { title: r.then.title, description: r.then.description, kind: r.then.kind ?? 'agent', humanKind: r.then.humanKind, agent: r.then.agent, wants: r.then.wants, runner: r.then.runner, model: r.then.model, final: r.then.final, after: matched.map(w => w.id) };
      if (hop > g.limits.hops && spec.kind === 'agent') {
        const step = makeWork(g, { title: `Continue: ${spec.title}?`, description: `The work has passed ${hop - 1} times from one result to the next, which is this goal's limit. Approve to let it continue once more.`, kind: 'human', humanKind: 'approve' }, 'node', { held: spec, hop, round });
        g = appendWorks(g, [step]);
        g.log.push(logEntry('node', 'limit', `"${spec.title}" waits for your yes: the chain reached its limit of ${g.limits.hops}.`, { workId: step.id }));
      } else {
        const next = makeWork(g, spec, 'node', { hop, round, origin: { agent: last.claimedBy, work: last.id } });
        g = appendWorks(g, [next]);
        g.log.push(logEntry('node', 'reaction', `"${matched.map(w => w.title).join('", "')}" ${matched.length > 1 ? 'are' : 'is'} done, so "${next.title}" starts.`, { workId: next.id }));
      }
    }
  }

  // 3. Open agent work: a named agent gets it; open work is offered, then given to the first free agent.
  for (const w of g.works) {
    if (w.status !== 'open' || w.kind !== 'agent') continue;
    if (w.runner === 'model') {
      // The node's model does it, inside the goal's spending limit; at the limit it waits for the owner.
      if (!rulesRun) continue;
      if (g.limits.usd !== null && g.spent.usd >= g.limits.usd) {
        if (!w.limitAt) {
          w.limitAt = nowIso;
          g.log.push(logEntry('node', 'limit', `"${w.title}" waits: the goal has spent ${g.spent.usd.toFixed(2)} $ of its ${g.limits.usd} $.`, { workId: w.id }));
          effects.notify.push({ title: `"${w.title}" waits for a higher spending limit`, body: `The goal has spent ${g.spent.usd.toFixed(2)} $ of its ${g.limits.usd} $. Raise the limit to let the model do it.`, workId: w.id });
        }
        continue;
      }
      effects.run.push(w.id);
      continue;
    }
    if (w.agent) {
      if (rulesRun && agents.some(a => a.name === w.agent && !a.stopped)) effects.assign.push({ workId: w.id, agent: w.agent });
      continue;
    }
    const candidates = agents.filter(a => mayTake(g, w, a));
    if (!w.offeredAt) {
      w.offeredAt = nowIso;
      if (candidates.length) {
        effects.offer.push({ workId: w.id, agents: candidates });
        g.log.push(logEntry('node', 'offered', `"${w.title}" was offered to ${candidates.length} agent${candidates.length === 1 ? '' : 's'} that ${w.wants?.length ? `know ${w.wants.join(' or ')}` : 'may take it'}.`, { workId: w.id }));
      }
      continue;
    }
    const waited = now - Date.parse(w.offeredAt);
    if (rulesRun && waited >= OFFER_GRACE_MS) {
      const firstFree = candidates.find(a => free.has(a.name));
      if (firstFree) { effects.assign.push({ workId: w.id, agent: firstFree.name }); continue; }
    }
    if (waited >= NOBODY_MS && !w.nobodyAt) {
      w.nobodyAt = nowIso;
      effects.notify.push({ title: `No agent took "${w.title}"`, body: candidates.length ? 'Your agents that could take it are busy.' : `None of your agents ${w.wants?.length ? `knows ${w.wants.join(' or ')}` : 'may take it'}. Open the goal to choose how it gets done.`, workId: w.id });
    }
  }

  // 4. A person's new step tells the owner, once.
  for (const w of g.works) {
    if (w.kind === 'human' && w.status === 'open' && !w.notifiedAt) {
      w.notifiedAt = nowIso;
      effects.notify.push({ title: w.title, body: w.description || 'A step in your goal waits for you.', workId: w.id });
      g.log.push(logEntry('node', 'asked', `"${w.title}" waits for the owner.`, { workId: w.id }));
    }
  }

  // 5. Done: a goal without rounds whose works are all finished and at least one done.
  if (!g.rounds && g.doneWhen.kind === 'all-done' && g.works.length && g.works.every(w => workSettled(w.status)) && g.works.some(w => w.status === 'done')) {
    g.status = 'done';
    g.settledAt = nowIso;
    g.log.push(logEntry('node', 'finished', 'Every work is finished: the goal is done.'));
  }

  // 6. The coordinator wakes when something happened since its last wake that it did not do itself.
  if (g.mode === 'coordinator' && g.coordinator && !goalSettled(g.status)) {
    const since = g.wake?.at ?? '';
    const coordGaiiTail = `${g.coordinator}#`;
    effects.wake = g.log.some(e => e.at > since && WAKE_KINDS.has(e.kind) && !e.who.startsWith(coordGaiiTail));
  }

  const changed = JSON.stringify(g) !== JSON.stringify(goal);
  return { goal: changed ? g : goal, effects };
}

/** Is the coordinator's wake task still waiting or running? */
async function wakeLive(deps: GoalDeps, goal: GoalRecord): Promise<boolean> {
  const id = goal.wake?.taskId;
  if (!id) return false;
  const task = await deps.storage.getAgentTask(id);
  return !!task && (LIVE_TASK_STATUSES as readonly string[]).includes(task.status);
}

/** Write what computeAdvance answers and run its effects. Safe to call after any change. */
export async function advanceGoal(deps: GoalDeps, ownerGhii: string, goalId: string): Promise<GoalRecord | null> {
  const first = await readGoal(deps, ownerGhii, goalId);
  if (!first || goalSettled(first.status) || first.status === 'proposed') return first;
  const agents = await ownerAgents(deps, first.owner);
  const free = new Set<string>();
  for (const a of agents) if (!a.stopped && await isFree(deps, a.gaii)) free.add(a.name);

  let effects: AdvanceEffects = { assign: [], run: [], offer: [], notify: [], wake: false };
  const goal = await updateGoal(deps, ownerGhii, goalId, cur => {
    const out = computeAdvance(cur, agents, free);
    effects = out.effects;
    return out.goal === cur ? UNCHANGED : out.goal;
  });

  for (const a of effects.assign) {
    try {
      await claimWork(deps, ownerGhii, goal.owner, goalId, a.workId, a.agent, 'node');
    } catch (err) {
      logger.info('goal: the node could not give a work to an agent', { goalId, workId: a.workId, agent: a.agent, error: String(err) });
    }
  }
  for (const workId of effects.run) await runModelWork(deps, ownerGhii, goalId, workId);
  for (const o of effects.offer) {
    const work = goal.works.find(w => w.id === o.workId);
    for (const agent of o.agents) {
      emitDelivery({ target: agent.gaii, kind: 'goal_work_offered', id: `${goalId}:${o.workId}`, payload: { goal_id: goalId, goal: goal.title, work_id: o.workId, title: work?.title, wants: work?.wants ?? [], claim: { tool: 'aimeat_goal_work', action: 'claim' } } });
    }
  }
  for (const n of effects.notify) {
    await notify(deps.storage, ownerGhii, { type: 'goal_waiting', title: n.title.slice(0, 200), body: n.body.slice(0, 500), link: `/v1/home?goal=${goalId}` })
      .catch(err => logger.warn('goal: telling the owner failed', { goalId, error: String(err) }));
  }
  if (effects.wake && goal.coordinator && !(await wakeLive(deps, goal))) {
    await wakeCoordinator(deps, ownerGhii, goal);
  }
  return readGoal(deps, ownerGhii, goalId);
}

/** Give the coordinator a task that says what happened since its last wake. */
async function wakeCoordinator(deps: GoalDeps, ownerGhii: string, goal: GoalRecord): Promise<void> {
  const name = goal.coordinator!;
  const agents = await ownerAgents(deps, goal.owner);
  const agent = agents.find(a => a.name === name);
  if (!agent || agent.stopped) return;
  const since = goal.wake?.at ?? '';
  const news = goal.log.filter(e => e.at > since && WAKE_KINDS.has(e.kind)).slice(-15).map(e => `- ${e.what}`).join('\n');
  const at = new Date().toISOString();
  try {
    const taskId = await materialiseAgentTask(deps.storage, { config: deps.config, emitResourceUpdated: () => {} }, {
      owner: ownerGhii,
      agentGaii: agent.gaii,
      agentName: name,
      parentRef: `goal:${goal.id}`,
      title: `Goal "${goal.title}": something happened`,
      description: `You coordinate the goal "${goal.statement}". Since your last look:\n${news}\n\nRead it with aimeat_goal_get (goal_id ${goal.id}), decide what moves it towards done, and act with aimeat_goal_set and aimeat_goal_work. Say why in the reason field of every change. Complete this task with what you decided.`,
      verification: { userExpects: goal.doneWhen.text || goal.statement, technicalChecks: [] },
      workTrackingCode: trackingCode(goal.id, 'coord'),
      startedBy: `Woken by the goal "${goal.title}"`,
    });
    await updateGoal(deps, ownerGhii, goal.id, cur => ({ ...cur, wake: { at, taskId } }));
  } catch (err) {
    logger.warn('goal: waking the coordinator failed', { goalId: goal.id, error: String(err) });
  }
}
