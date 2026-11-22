/**
 * @file src/services/help/close.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The asker ends a question: solved (with thanks, naming whose answer solved it, and
 *   whether the answer may be kept for others), cancelled, or given more time.
 *
 *   MORSELS FOR THE HELPER. When the operator has them on, the helper whose answer solved the question
 *   gets `helpReward` morsels, `helpRewardKnowledge` more when the answer is kept for others, and the
 *   operator's share for an answer the helper's AI wrote. Two caps keep it honest: the helper's monthly
 *   total, and the rewarded questions between the same two people in a month. Morsels pace what agents
 *   may push into the store; they are not a payment (Jouni, 2026-11-14: the reward is there to make people work together).
 *
 *   KEPT FOR OTHERS ONLY WITH BOTH. The asker asks for it and the helper allowed it on their answer;
 *   the kept answer carries the helper's name and is confirmed by them every `helpReviewMonths`.
 * @structure closeQuestion · rewardFor
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-pyyd-apua-nodessa-yhteinen-avunpyynt-v-yl-ihmisille-ja-heid-).
 */
import { randomUUID } from 'node:crypto';
import type { HelpQuestionRecord, HelpRouteRecord } from '../../storage/types/help.js';
import type { CallerContext } from '../caller-context.js';
import { HELP_ASK_SCOPE } from '../../utils/scope-coverage.js';
import { localAccountName } from '../../utils/gaii.js';
import { emitChange } from '../event-bus.js';
import { notify } from '../notify.js';
import { participationRefusal } from './participants.js';
import { sendStatusLine } from './delivery.js';
import { emitHelpChange, runHelpHook } from './events.js';
import { addDays, monthStart, refuse, text, MAX_THANKS, type HelpDeps, type HelpResult } from './rules.js';

type CloseAction = 'solved' | 'cancel' | 'extend';

/** The morsels this solved question earns its helper, after both caps. */
export async function rewardFor(deps: HelpDeps, q: HelpQuestionRecord, helperGhii: string, byAi: boolean, kept: boolean): Promise<number> {
  const c = deps.config;
  if (!c.helpRewardEnabled) return 0;
  let amount = c.helpReward + (kept ? c.helpRewardKnowledge : 0);
  if (byAi) amount = c.helpRewardAi === 'none' ? 0 : c.helpRewardAi === 'half' ? Math.floor(amount / 2) : amount;
  if (amount <= 0) return 0;
  const since = monthStart(new Date().toISOString());
  // The same asker and helper: at most helpRewardPairCap rewarded questions this month.
  const askersQuestions = await deps.storage.listHelpQuestionsByOwner(q.ownerGhii, { limit: 500 });
  const pair = askersQuestions.filter(x => x.id !== q.id && x.answeredBy === helperGhii && x.rewardMorsels > 0 && (x.closedAt ?? '') >= since).length;
  if (pair >= c.helpRewardPairCap) return 0;
  // The helper's month: at most helpRewardMonthlyCap morsels from help.
  const routes = await deps.storage.listHelpRoutesForHelper(helperGhii, { since: addDays(since, -62), limit: 1000 });
  let month = 0;
  for (const id of new Set(routes.map(r => r.questionId))) {
    if (id === q.id) continue;
    const x = await deps.storage.getHelpQuestion(id);
    if (x && x.answeredBy === helperGhii && (x.closedAt ?? '') >= since) month += x.rewardMorsels;
  }
  return Math.max(0, Math.min(amount, c.helpRewardMonthlyCap - month));
}

/** Credit the helper once per question: the tracking code is the question id. */
async function credit(deps: HelpDeps, helperGhii: string, q: HelpQuestionRecord, amount: number): Promise<void> {
  const code = `help-${q.id}`;
  if (await deps.storage.findTransactionByTrackingCode(helperGhii, code, 'help-reward')) return;
  const ok = await deps.storage.creditBalance(helperGhii, amount);
  if (!ok) return;
  await deps.storage.addTransaction({
    id: `tx-${randomUUID()}`, gaii: helperGhii, type: 'help-reward', amount, trackingCode: code,
    timestamp: new Date().toISOString(),
  });
  emitChange('wallet', helperGhii);
}

export async function closeQuestion(deps: HelpDeps, caller: CallerContext, questionId: string, body: Record<string, unknown>): Promise<HelpResult<{
  question_id: string; state: string; reward_morsels: number; kept: boolean; deadline: string;
}>> {
  const off = await participationRefusal(deps, caller);
  if (off) return off;
  if (!caller.has(HELP_ASK_SCOPE)) return refuse(403, 'SCOPE_DENIED', `Closing a question needs the permission ${HELP_ASK_SCOPE}.`);
  const action = (body.action ?? 'solved') as CloseAction;
  if (!['solved', 'cancel', 'extend'].includes(action)) return refuse(400, 'INVALID_INPUT', 'action is solved, cancel or extend.');
  const q = await deps.storage.getHelpQuestion(questionId);
  if (!q || q.ownerGhii !== caller.ownerGhii) return refuse(404, 'NOT_FOUND', 'You have no question with this id.');
  if (q.state !== 'open' && q.state !== 'answered') return refuse(409, 'CLOSED', `This question is already ${q.state}.`);
  const routes = await deps.storage.listHelpRoutes(q.id);
  const now = new Date().toISOString();

  if (action === 'extend') {
    const days = Math.min(30, Math.max(1, Number(body.days ?? deps.config.helpQuestionDays) || deps.config.helpQuestionDays));
    const deadline = addDays(now > q.deadline ? now : q.deadline, days);
    if (!(await deps.storage.updateHelpQuestion({ ...q, deadline, remindedAt: null, updatedAt: now }, q.version))) {
      return refuse(409, 'CHANGED', 'The question changed a moment ago. Read it again and retry.');
    }
    emitHelpChange(q.ownerGhii);
    return { ok: true, data: { question_id: q.id, state: q.state, reward_morsels: 0, kept: false, deadline } };
  }

  if (action === 'cancel') {
    if (!(await deps.storage.updateHelpQuestion({ ...q, state: 'cancelled', closedAt: now, updatedAt: now }, q.version))) {
      return refuse(409, 'CHANGED', 'The question changed a moment ago. Read it again and retry.');
    }
    for (const r of routes.filter(x => x.outcome === 'pending')) {
      await deps.storage.updateHelpRoute({ ...r, outcome: 'closed', outcomeAt: now });
      await sendStatusLine(deps, q, r, 'help.msg.cancelled');
    }
    emitHelpChange(q.ownerGhii, ...routes.map(r => r.helperGhii));
    return { ok: true, data: { question_id: q.id, state: 'cancelled', reward_morsels: 0, kept: false, deadline: q.deadline } };
  }

  // solved: whose answer solved it. Default: the first helper who answered.
  const named = text(body.helper, 200);
  const helperGhii = named ? (await deps.storage.getGHIIByOwner(localAccountName(named)))?.ghii ?? '' : q.answeredBy ?? '';
  const solving: HelpRouteRecord | undefined = routes.find(r => r.helperGhii === helperGhii && r.outcome === 'answered');
  if (helperGhii && !solving) return refuse(409, 'NOT_ANSWERED', 'That helper has not answered this question.');
  const kept = !!solving && body.keep === true && solving.keepAllowed;
  const reward = solving ? await rewardFor(deps, q, solving.helperGhii, solving.answeredByAi, kept) : 0;
  const thanks = text(body.thanks, MAX_THANKS);
  const next: HelpQuestionRecord = {
    ...q, state: 'solved', closedAt: now, updatedAt: now, thanks,
    answeredBy: solving?.helperGhii ?? q.answeredBy, answeredByAi: solving?.answeredByAi ?? q.answeredByAi,
    answer: solving?.answer ?? q.answer, rewardMorsels: reward, saved: kept, savedConfirmedAt: kept ? now : null, stale: false,
  };
  // The conditional write is the once-only guard: a second "solved" finds the version moved and stops
  // here, so the reward below is credited once.
  if (!(await deps.storage.updateHelpQuestion(next, q.version))) {
    return refuse(409, 'CHANGED', 'The question changed a moment ago. Read it again and retry.');
  }
  if (solving && reward > 0) await credit(deps, solving.helperGhii, next, reward);
  for (const r of routes) {
    if (r.outcome === 'pending') await deps.storage.updateHelpRoute({ ...r, outcome: 'closed', outcomeAt: now });
    if (r.outcome === 'answered' || r.outcome === 'pending') {
      const mine = solving && r.id === solving.id;
      await sendStatusLine(deps, next, r, mine && reward > 0 ? 'help.msg.solvedReward' : 'help.msg.solved', { morsels: reward });
    }
  }
  if (solving) {
    await notify(deps.storage, solving.helperGhii, {
      type: 'help_thanks', title: `Your answer solved a question: ${q.subject}`,
      body: reward > 0 ? `You got ${reward} morsels.` : 'Thank you for helping.',
      link: `/v1/profile#inbox/${solving.conversationId}`,
      i18n: { key: reward > 0 ? 'help_thanks_reward' : 'help_thanks', vars: { subject: q.subject, morsels: reward } },
    });
  }
  emitHelpChange(q.ownerGhii, ...routes.map(r => r.helperGhii));
  runHelpHook(deps, 'post_help_solved', { question_id: q.id, state: 'solved', topics: q.topics });
  return { ok: true, data: { question_id: q.id, state: 'solved', reward_morsels: reward, kept, deadline: q.deadline } };
}
