/**
 * @file src/services/help/respond.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a helper does with a question sent to them: answer it, approve the draft their AI
 *   wrote, pass it ("I have no time", shown to nobody), refer it to someone else, or confirm that a kept
 *   answer still holds.
 *
 *   THE AI LEVEL IS ENFORCED HERE, NOT IN THE SKILL. A person in person answers freely. An agent
 *   holding help:answer: with the helper's level `off` it is refused; with `draft` its answer is stored
 *   as a draft the helper approves; with `auto` it is sent when the question's topics fall in the
 *   helper's own auto topics (and the operator allows it), and drafted otherwise. An answer an AI sent
 *   is marked as written by that agent in both mailboxes (Jouni, 2026-11-14: "ensimmäiseen versioon").
 *
 *   A REPLY IN THE THREAD COUNTS. A helper who simply answers in the message thread has answered:
 *   thread-reply.ts noteThreadReply is called by the message path after it delivers a message in a
 *   thread that belongs to a question (services/message/send.ts).
 * @structure routeOnward · respondToQuestion
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-pyyd-apua-nodessa-yhteinen-avunpyynt-v-yl-ihmisille-ja-heid-).
 */
import type { HelpQuestionRecord } from '../../storage/types/help.js';
import type { CallerContext } from '../caller-context.js';
import { HELP_ANSWER_SCOPE } from '../../utils/scope-coverage.js';
import { localAccountName, parseGaiiLoose } from '../../utils/gaii.js';
import { notify } from '../notify.js';
import { effectiveParticipant, participationRefusal } from './participants.js';
import { findCandidates } from './routing.js';
import { sendAnswer, sendQuestion } from './delivery.js';
import { emitHelpChange } from './events.js';
import { updateQuestion, recordAnswer } from './thread-reply.js';
import { refuse, text, topicsMatch, MAX_ANSWER, type HelpDeps, type HelpResult } from './rules.js';

type Action = 'answer' | 'approve' | 'pass' | 'refer' | 'confirm_kept';
const ACTIONS: readonly Action[] = ['answer', 'approve', 'pass', 'refer', 'confirm_kept'];

/** Send the question to the next helper after a pass, a refusal or a timeout; false when nobody is left. */
export async function routeOnward(deps: HelpDeps, q: HelpQuestionRecord, named?: string): Promise<boolean> {
  const routes = await deps.storage.listHelpRoutes(q.id);
  if (routes.some(r => r.outcome === 'pending') && !named) return true;
  const exclude = new Set([q.ownerGhii, ...routes.map(r => r.helperGhii)]);
  const candidates = await findCandidates(deps, {
    askerGhii: q.ownerGhii, topics: q.topics, text: `${q.subject} ${q.question}`, exclude,
    ...(named ? { named: [named] } : {}),
  });
  const next = candidates[0];
  if (!next) return false;
  const r = await sendQuestion(deps, q, next.ghii, next.matched);
  if (r.ok) emitHelpChange(q.ownerGhii, next.ghii);
  return r.ok;
}

/** The answer an agent may send on its own, or null when it must be a draft. */
function agentMaySend(deps: HelpDeps, q: HelpQuestionRecord, aiMode: string, autoTopics: string[]): boolean {
  if (aiMode !== 'auto' || !deps.config.helpAiAutoAllowed) return false;
  return q.topics.some(t => autoTopics.some(a => topicsMatch(t, a)));
}

export async function respondToQuestion(deps: HelpDeps, caller: CallerContext, questionId: string, body: Record<string, unknown>): Promise<HelpResult<{
  outcome: 'answered' | 'drafted' | 'passed' | 'referred' | 'confirmed'; question_id: string; conversation_id: string;
}>> {
  const off = await participationRefusal(deps, caller);
  if (off) return off;
  if (!caller.has(HELP_ANSWER_SCOPE)) {
    return refuse(403, 'SCOPE_DENIED', `Answering in the owner's name needs the permission ${HELP_ANSWER_SCOPE}. The owner grants it on the Agents page.`);
  }
  const action = (body.action ?? 'answer') as Action;
  if (!ACTIONS.includes(action)) return refuse(400, 'INVALID_INPUT', `action is one of ${ACTIONS.join(', ')}.`);
  const q = await deps.storage.getHelpQuestion(questionId);
  const me = caller.ownerGhii;
  const routes = q ? await deps.storage.listHelpRoutes(q.id) : [];
  const route = routes.filter(r => r.helperGhii === me).sort((a, b) => b.routedAt.localeCompare(a.routedAt))[0];
  if (!q || !route) return refuse(404, 'NOT_FOUND', 'No question with this id was sent to you.');
  const p = effectiveParticipant(deps, me, await deps.storage.getHelpParticipant(me));
  const agent = !caller.isPerson;
  const conversation_id = route.conversationId;

  if (action === 'confirm_kept') {
    if (q.answeredBy !== me || !q.saved) return refuse(409, 'NOT_KEPT', 'Only the helper whose answer is kept for others confirms it.');
    await updateQuestion(deps, q.id, cur => ({ ...cur, savedConfirmedAt: new Date().toISOString(), stale: false }));
    emitHelpChange(me);
    return { ok: true, data: { outcome: 'confirmed', question_id: q.id, conversation_id } };
  }

  if (q.state !== 'open' && q.state !== 'answered') return refuse(409, 'CLOSED', `This question is ${q.state}; nothing more can be done with it.`);

  if (action === 'pass' || action === 'refer') {
    if (route.outcome !== 'pending') return refuse(409, 'ALREADY_DONE', 'You have already answered, passed or referred this question.');
    if (agent && p.aiMode !== 'auto') return refuse(403, 'PERSON_REQUIRED', 'Only the helper decides to pass or refer, unless they let their AI answer on its own.');
    const now = new Date().toISOString();
    if (action === 'pass') {
      await deps.storage.updateHelpRoute({ ...route, outcome: 'passed', outcomeAt: now, draft: null });
      await routeOnward(deps, q);
      emitHelpChange(me, q.ownerGhii);
      return { ok: true, data: { outcome: 'passed', question_id: q.id, conversation_id } };
    }
    const toName = text(body.to, 200);
    const to = toName ? await deps.storage.getGHIIByOwner(localAccountName(toName)) : null;
    if (!to) return refuse(400, 'INVALID_INPUT', 'to is the member you refer the question to (their account name).');
    if (to.ghii === q.ownerGhii || to.ghii === me) return refuse(400, 'INVALID_INPUT', 'Refer the question to someone other than you or the asker.');
    const sent = await routeOnward(deps, q, to.ghii);
    if (!sent) return refuse(409, 'NOT_A_HELPER', `${to.displayName || to.username} cannot take a question now: they have not chosen to receive questions from this person, are away, or have reached their weekly limit.`);
    await deps.storage.updateHelpRoute({ ...route, outcome: 'referred', outcomeAt: now, referredTo: to.ghii, draft: null });
    emitHelpChange(me, q.ownerGhii, to.ghii);
    return { ok: true, data: { outcome: 'referred', question_id: q.id, conversation_id } };
  }

  // answer or approve
  if (route.outcome !== 'pending' && route.outcome !== 'answered') return refuse(409, 'ALREADY_DONE', 'You passed or referred this question.');
  const keepAllowed = body.keep_allowed === true;
  let answer = text(body.answer, MAX_ANSWER);
  if (action === 'approve') {
    if (agent) return refuse(403, 'PERSON_REQUIRED', 'Only the helper approves a draft.');
    if (!route.draft) return refuse(409, 'NO_DRAFT', 'There is no draft to approve.');
    answer = answer || route.draft.answer;
  }
  if (!answer) return refuse(400, 'INVALID_INPUT', 'answer is the text of the answer.');

  if (agent) {
    if (p.aiMode === 'off') return refuse(403, 'AI_OFF', 'This helper answers every question themselves. Tell them about the question instead of answering it.');
    if (!agentMaySend(deps, q, p.aiMode, p.autoTopics)) {
      await deps.storage.updateHelpRoute({ ...route, draft: { answer, by: caller.principal, at: new Date().toISOString() } });
      await notify(deps.storage, me, {
        type: 'help_draft', title: `A draft answer waits for you: ${q.subject}`,
        body: 'Your AI wrote a draft. Read it and send it, change it, or write your own.',
        link: `/v1/profile#inbox/${route.conversationId}`,
        i18n: { key: 'help_draft', vars: { subject: q.subject } },
      });
      emitHelpChange(me);
      return { ok: true, data: { outcome: 'drafted', question_id: q.id, conversation_id } };
    }
  }

  const byAgent = agent || (action === 'approve' && route.draft)
    ? { gaii: agent ? caller.principal : route.draft!.by, name: parseGaiiLoose(agent ? caller.principal : route.draft!.by).agent || 'AI' }
    : undefined;
  const sent = await sendAnswer(deps, q, route, answer, byAgent);
  if (!sent.ok) return sent;
  await recordAnswer(deps, q, route, answer, !!byAgent, keepAllowed);
  return { ok: true, data: { outcome: 'answered', question_id: q.id, conversation_id } };
}
