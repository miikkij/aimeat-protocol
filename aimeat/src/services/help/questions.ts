/**
 * @file src/services/help/questions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Asking, finding and listing in Ask someone who knows.
 *
 *   FIND FIRST. `findHelp` answers kept answers that match (the next person need not ask at all) and
 *   the helpers who could answer, by name and matched topics. The skill tells an AI to call it before
 *   it asks anyone.
 *
 *   ASK IN THE PERSON'S NAME, AND SHOW IT FIRST. A person asks in person; an AI asks only when the
 *   person allowed it (`aiMaySend` for the AI they talk to, `agentsMayAsk` for an agent running on its
 *   own) and holds help:ask. The skill tells the AI to show the question before it calls `ask`.
 *
 *   THE SHARED LIST. A question nobody was found for may go on the shared list (audience 'board'),
 *   where any helper can take it; taking it sends it to them as an ordinary question.
 * @structure findHelp · askQuestion · takeFromBoard · listInbox · threadView · questionView
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-pyyd-apua-nodessa-yhteinen-avunpyynt-v-yl-ihmisille-ja-heid-).
 */
import type { HelpQuestionRecord, HelpRouteRecord, HelpAttachment, HelpParticipantRecord } from '../../storage/types/help.js';
import type { CallerContext } from '../caller-context.js';
import { HELP_ASK_SCOPE, HELP_ANSWER_SCOPE } from '../../utils/scope-coverage.js';
import { localAccountName } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { effectiveParticipant, participationRefusal } from './participants.js';
import { findCandidates } from './routing.js';
import { sendQuestion } from './delivery.js';
import { emitHelpChange, runHelpHook } from './events.js';
import { noteUnmatched } from './report.js';
import {
  addDays, cleanTopics, newQuestionId, refuse, text, topicsMatch, normalizeTopic,
  MAX_ATTACHMENTS, MAX_HELPERS_AT_ONCE, MAX_QUESTION, MAX_SUBJECT, MAX_TRIED,
  type HelpDeps, type HelpResult,
} from './rules.js';

/** What the asker sees of their question. Who passed is never in it. */
export function questionView(q: HelpQuestionRecord, routes: HelpRouteRecord[], names: Map<string, string>) {
  return {
    id: q.id, subject: q.subject, question: q.question, tried: q.tried, topics: q.topics, audience: q.audience,
    state: q.state, deadline: q.deadline, created_at: q.createdAt, closed_at: q.closedAt,
    answered_by: q.answeredBy, answered_by_name: q.answeredBy ? names.get(q.answeredBy) ?? null : null,
    answered_by_ai: q.answeredByAi, reward_morsels: q.rewardMorsels, saved: q.saved, stale: q.stale,
    // The helpers who answered, and the threads to read the answers in. A helper still deciding is
    // "waiting"; one who passed or timed out does not appear.
    answers: routes.filter(r => r.outcome === 'answered').map(r => ({
      helper: r.helperGhii, name: names.get(r.helperGhii) ?? null, conversation_id: r.conversationId,
      answer: r.answer, by_ai: r.answeredByAi, keep_allowed: r.keepAllowed,
    })),
    waiting: routes.some(r => r.outcome === 'pending'),
    conversation_ids: routes.filter(r => r.outcome === 'pending' || r.outcome === 'answered').map(r => r.conversationId),
  };
}

async function namesOf(deps: HelpDeps, ghiis: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const g of new Set(ghiis)) {
    const rec = await deps.storage.getGHIIByOwner(localAccountName(g));
    if (rec) out.set(g, rec.displayName || rec.username);
  }
  return out;
}

/** Kept answers that match the words, best first: confirmed ones before stale ones. */
async function keptAnswers(deps: HelpDeps, words: string, topics: string[]) {
  const kept = await deps.storage.listHelpQuestions({ saved: true, states: ['solved'], limit: 1000 });
  const terms = normalizeTopic(words).split(' ').filter(w => w.length > 2);
  const scored = kept.map(q => {
    const hay = normalizeTopic(`${q.subject} ${q.question} ${q.answer} ${q.topics.join(' ')}`);
    const topicHits = topics.filter(t => q.topics.some(x => topicsMatch(t, x))).length;
    const wordHits = terms.filter(w => hay.includes(w)).length;
    return { q, score: topicHits * 3 + wordHits };
  }).filter(s => s.score > 0);
  scored.sort((a, b) => (Number(a.q.stale) - Number(b.q.stale)) || (b.score - a.score));
  const top = scored.slice(0, 5);
  const names = await namesOf(deps, top.map(s => s.q.answeredBy ?? '').filter(Boolean));
  return top.map(({ q }) => ({
    id: q.id, subject: q.subject, question: q.question, answer: q.answer, topics: q.topics,
    answered_by: q.answeredBy, answered_by_name: q.answeredBy ? names.get(q.answeredBy) ?? null : null,
    confirmed_at: q.savedConfirmedAt, stale: q.stale,
  }));
}

/** Kept answers and the helpers who could answer. Reads only what helpers chose to show. */
export async function findHelp(deps: HelpDeps, caller: CallerContext, body: Record<string, unknown>): Promise<HelpResult<{
  kept: Awaited<ReturnType<typeof keptAnswers>>;
  helpers: Array<{ ghii: string; name: string; matched: string[] }>;
  board_enabled: boolean;
}>> {
  const off = await participationRefusal(deps, caller);
  if (off) return off;
  if (!caller.has(HELP_ASK_SCOPE) && !caller.has(HELP_ANSWER_SCOPE)) {
    return refuse(403, 'SCOPE_DENIED', `Finding help needs the permission ${HELP_ASK_SCOPE}. The owner grants it on the Agents page.`);
  }
  const words = text(body.question, MAX_QUESTION) || text(body.query, MAX_QUESTION);
  const topics = cleanTopics(body.topics);
  if (!words && topics.length === 0) return refuse(400, 'INVALID_INPUT', 'Give the question or some topics to look for.');
  const kept = await keptAnswers(deps, words, topics);
  const candidates = await findCandidates(deps, { askerGhii: caller.ownerGhii, topics, text: words, exclude: new Set() });
  return {
    ok: true,
    data: {
      kept,
      helpers: candidates.slice(0, 10).map(c => ({ ghii: c.ghii, name: c.displayName, matched: c.matched })),
      board_enabled: deps.config.helpBoardEnabled,
    },
  };
}

/** May this caller ask in the owner's name? A refusal says why and what to do. */
async function askRefusal(deps: HelpDeps, caller: CallerContext) {
  const off = await participationRefusal(deps, caller);
  if (off) return off;
  if (!caller.has(HELP_ASK_SCOPE)) {
    return refuse(403, 'SCOPE_DENIED', `Asking in the owner's name needs the permission ${HELP_ASK_SCOPE}. The owner grants it on the Agents page.`);
  }
  const me = effectiveParticipant(deps, caller.ownerGhii, await deps.storage.getHelpParticipant(caller.ownerGhii));
  if (!me.asker) return refuse(403, 'ASKING_OFF', 'Asking is switched off in your choices. Switch "I want to ask" on, on the page Ask someone who knows.');
  if (!caller.isPerson) {
    const allowed = caller.via === 'unattended' ? me.agentsMayAsk : (me.aiMaySend || me.agentsMayAsk);
    if (!allowed) {
      return refuse(403, 'AI_MAY_NOT_ASK', 'Your owner has not allowed their AI to send questions in their name. Show them the question so they send it themselves, or ask them to allow it on the page Ask someone who knows.');
    }
  }
  return null;
}

/** Attachments in the direct-message shape, at most MAX_ATTACHMENTS. */
function attachmentsOf(raw: unknown): HelpAttachment[] {
  if (!Array.isArray(raw)) return [];
  const kinds = ['image', 'audio', 'video', 'file'];
  return raw.filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
    .filter(a => typeof a.storage_key === 'string' && typeof a.mime === 'string' && Number.isInteger(a.size) && kinds.includes(String(a.kind)))
    .slice(0, MAX_ATTACHMENTS)
    .map(a => ({ storage_key: String(a.storage_key).slice(0, 512), mime: String(a.mime).slice(0, 128), size: Number(a.size),
      kind: a.kind as HelpAttachment['kind'], ...(typeof a.name === 'string' ? { name: a.name.slice(0, 256) } : {}) }));
}

/**
 * Ask. The question goes to the best one or two helpers (or the people named), or onto the shared list
 * when `to_board` is true. When nobody is found and the shared list is on, the answer says so and the
 * question is kept open nowhere: the asker decides whether to put it on the list.
 */
export async function askQuestion(deps: HelpDeps, caller: CallerContext, body: Record<string, unknown>): Promise<HelpResult<{
  question: ReturnType<typeof questionView>; sent_to: Array<{ ghii: string; name: string; matched: string[] }>;
  nobody_found: boolean;
}>> {
  const no = await askRefusal(deps, caller);
  if (no) return no;
  const question = text(body.question, MAX_QUESTION);
  if (!question) return refuse(400, 'INVALID_INPUT', 'question is the question itself, in the asker\'s words.');
  const subject = text(body.subject, MAX_SUBJECT) || question.split('\n')[0].slice(0, MAX_SUBJECT);
  const topics = cleanTopics(body.topics);
  const toBoard = body.to_board === true;
  if (toBoard && !deps.config.helpBoardEnabled) return refuse(409, 'BOARD_OFF', 'The shared list is switched off on this node.');
  const count = Math.min(MAX_HELPERS_AT_ONCE, Math.max(1, Number(body.helpers ?? 1) || 1));

  let named: string[] | undefined;
  if (Array.isArray(body.people) && body.people.length) {
    named = [];
    for (const p of body.people.slice(0, MAX_HELPERS_AT_ONCE)) {
      if (typeof p !== 'string' || !p.trim()) continue;
      const g = await deps.storage.getGHIIByOwner(localAccountName(p.trim()));
      if (!g) return refuse(404, 'NOT_FOUND', `There is no member called ${p} on this node.`);
      named.push(g.ghii);
    }
  }

  const now = new Date().toISOString();
  const q: HelpQuestionRecord = {
    id: newQuestionId(), ownerGhii: caller.ownerGhii, askedBy: caller.principal, subject, question,
    tried: text(body.tried, MAX_TRIED), topics, attachments: attachmentsOf(body.attachments),
    audience: toBoard ? 'board' : 'people', state: 'open', answeredBy: null, answeredByAi: false, answer: '',
    thanks: '', rewardMorsels: 0, saved: false, savedConfirmedAt: null, stale: false,
    deadline: addDays(now, deps.config.helpQuestionDays), remindedAt: null, version: 1,
    createdAt: now, updatedAt: now, closedAt: null,
  };

  const candidates = toBoard ? [] : await findCandidates(deps, {
    askerGhii: caller.ownerGhii, topics, text: `${subject} ${question}`, exclude: new Set([caller.ownerGhii]), named, now,
  });
  if (named && candidates.length < named.length) {
    const missing = named.filter(n => !candidates.some(c => c.ghii === n));
    return refuse(409, 'NOT_A_HELPER', `${missing.map(m => localAccountName(m)).join(', ')} cannot take a question now: they have not chosen to receive questions from you, are away, or have reached their weekly limit.`);
  }
  if (!toBoard && candidates.length === 0) {
    // Counted for the operator's report (topics only): this is where a topic without a helper shows.
    await noteUnmatched(deps, topics.length ? topics : [subject])
      .catch(err => logger.warn('help: an unmatched question was not counted', { error: String(err) }));
    return {
      ok: true,
      data: { question: questionView({ ...q, state: 'cancelled' }, [], new Map()), sent_to: [], nobody_found: true },
    };
  }

  await deps.storage.createHelpQuestion(q);
  const sentTo: Array<{ ghii: string; name: string; matched: string[] }> = [];
  const routes: HelpRouteRecord[] = [];
  for (const c of candidates.slice(0, named ? named.length : count)) {
    const r = await sendQuestion(deps, q, c.ghii, c.matched);
    if (!r.ok) {
      if (routes.length === 0) {
        await deps.storage.updateHelpQuestion({ ...q, state: 'cancelled', closedAt: now, updatedAt: now }, q.version);
        return r;
      }
      continue;
    }
    routes.push(r.data);
    sentTo.push({ ghii: c.ghii, name: c.displayName, matched: c.matched });
  }
  emitHelpChange(caller.ownerGhii, ...sentTo.map(s => s.ghii));
  runHelpHook(deps, 'post_help_question', { question_id: q.id, state: q.state, topics: q.topics });
  const names = new Map(sentTo.map(s => [s.ghii, s.name]));
  return { ok: true, data: { question: questionView(q, routes, names), sent_to: sentTo, nobody_found: false } };
}

/** A helper takes a question from the shared list; it is sent to them as an ordinary question. */
export async function takeFromBoard(deps: HelpDeps, caller: CallerContext, id: string): Promise<HelpResult<{ conversation_id: string }>> {
  const off = await participationRefusal(deps, caller);
  if (off) return off;
  if (!caller.has(HELP_ANSWER_SCOPE)) return refuse(403, 'SCOPE_DENIED', `Taking a question needs the permission ${HELP_ANSWER_SCOPE}.`);
  const me = effectiveParticipant(deps, caller.ownerGhii, await deps.storage.getHelpParticipant(caller.ownerGhii));
  if (!me.helper) return refuse(403, 'NOT_A_HELPER', 'Switch "Others may ask me" on before you take a question.');
  const q = await deps.storage.getHelpQuestion(id);
  if (!q || q.audience !== 'board' || q.state !== 'open') return refuse(404, 'NOT_FOUND', 'That question is not on the shared list any more.');
  if (q.ownerGhii === caller.ownerGhii) return refuse(409, 'OWN_QUESTION', 'This is your own question.');
  const moved = await deps.storage.updateHelpQuestion({ ...q, audience: 'people', updatedAt: new Date().toISOString() }, q.version);
  if (!moved) return refuse(409, 'TAKEN', 'Someone took this question a moment ago.');
  const matched = q.topics.filter(t => me.topics.some(x => topicsMatch(t, x)));
  const r = await sendQuestion(deps, { ...q, audience: 'people', version: q.version + 1 }, caller.ownerGhii, matched);
  if (!r.ok) return r;
  emitHelpChange(q.ownerGhii, caller.ownerGhii);
  return { ok: true, data: { conversation_id: r.data.conversationId } };
}

/**
 * The caller's side of the feature in one read: questions sent to them (with any draft their AI
 * wrote), their own questions, and the shared list when they are a helper.
 */
export async function listInbox(deps: HelpDeps, caller: CallerContext, opts: { include_closed?: boolean } = {}): Promise<HelpResult<{
  me: HelpParticipantRecord; asked_of_me: unknown[]; mine: unknown[]; board: unknown[];
}>> {
  const off = await participationRefusal(deps, caller);
  if (off) return off;
  if (!caller.has(HELP_ANSWER_SCOPE) && !caller.has(HELP_ASK_SCOPE)) {
    return refuse(403, 'SCOPE_DENIED', `Reading these needs the permission ${HELP_ANSWER_SCOPE} or ${HELP_ASK_SCOPE}.`);
  }
  const me = caller.ownerGhii;
  const routes = await deps.storage.listHelpRoutesForHelper(me, { limit: 200 });
  const asked: unknown[] = [];
  const askerIds: string[] = [];
  for (const r of routes) {
    const q = await deps.storage.getHelpQuestion(r.questionId);
    if (!q) continue;
    const open = r.outcome === 'pending' && q.state === 'open';
    if (!opts.include_closed && !open && r.outcome !== 'answered') continue;
    askerIds.push(q.ownerGhii);
    asked.push({
      question_id: q.id, conversation_id: r.conversationId, subject: q.subject, question: q.question, tried: q.tried,
      topics: q.topics, asker: q.ownerGhii, state: q.state, my_outcome: r.outcome, routed_at: r.routedAt,
      deadline: q.deadline, draft: r.draft ? { answer: r.draft.answer, at: r.draft.at } : null,
      my_answer: r.answer || null, solved_by_me: q.state === 'solved' && q.answeredBy === me,
    });
  }
  const mineQ = await deps.storage.listHelpQuestionsByOwner(me, { limit: 100 });
  const mine: unknown[] = [];
  const helperIds: string[] = [];
  const routesByQ = new Map<string, HelpRouteRecord[]>();
  for (const q of mineQ) {
    if (!opts.include_closed && !['open', 'answered'].includes(q.state)) continue;
    const rs = await deps.storage.listHelpRoutes(q.id);
    routesByQ.set(q.id, rs);
    helperIds.push(...rs.map(r => r.helperGhii));
  }
  const names = await namesOf(deps, [...askerIds, ...helperIds]);
  for (const a of asked as Array<{ asker: string; asker_name?: string }>) a.asker_name = names.get(a.asker) ?? localAccountName(a.asker);
  for (const q of mineQ) if (routesByQ.has(q.id)) mine.push(questionView(q, routesByQ.get(q.id)!, names));

  let board: unknown[] = [];
  const p = effectiveParticipant(deps, me, await deps.storage.getHelpParticipant(me));
  if (deps.config.helpBoardEnabled && p.helper) {
    const open = await deps.storage.listHelpQuestions({ audience: 'board', states: ['open'], limit: 100 });
    board = open.filter(q => q.ownerGhii !== me).map(q => ({
      question_id: q.id, subject: q.subject, question: q.question, topics: q.topics, created_at: q.createdAt, deadline: q.deadline,
      fits_me: q.topics.some(t => p.topics.some(x => topicsMatch(t, x))),
    }));
  }
  return { ok: true, data: { me: p, asked_of_me: asked, mine, board } };
}

/**
 * The question behind one message thread, as this caller may see it: the helper sees the question,
 * why it came to them, their draft and what they may do; the asker sees their question's state.
 * Anyone else gets NOT_FOUND, as if there were no such thread.
 */
export async function threadView(deps: HelpDeps, caller: CallerContext, conversationId: string): Promise<HelpResult<unknown>> {
  const off = await participationRefusal(deps, caller);
  if (off) return off;
  const route = await deps.storage.getHelpRouteByConversation(conversationId);
  const q = route ? await deps.storage.getHelpQuestion(route.questionId) : null;
  if (!route || !q) return refuse(404, 'NOT_FOUND', 'No question lives in this thread.');
  const me = caller.ownerGhii;
  if (route.helperGhii === me) {
    if (!caller.has(HELP_ANSWER_SCOPE)) return refuse(403, 'SCOPE_DENIED', `Reading this needs the permission ${HELP_ANSWER_SCOPE}.`);
    const p = effectiveParticipant(deps, me, await deps.storage.getHelpParticipant(me));
    const names = await namesOf(deps, [q.ownerGhii]);
    return {
      ok: true,
      data: {
        role: 'helper', question_id: q.id, subject: q.subject, question: q.question, tried: q.tried, topics: q.topics,
        attachments: q.attachments.map(a => ({ name: a.name ?? null, kind: a.kind })),
        asker: q.ownerGhii, asker_name: names.get(q.ownerGhii) ?? null, state: q.state, my_outcome: route.outcome,
        why: q.topics.filter(t => p.topics.some(x => topicsMatch(t, x))), deadline: q.deadline,
        draft: route.draft ? { answer: route.draft.answer, at: route.draft.at } : null,
        my_answer: route.answer || null, keep_allowed: route.keepAllowed,
        may: { answer: q.state === 'open' || q.state === 'answered', pass: route.outcome === 'pending', refer: route.outcome === 'pending' },
      },
    };
  }
  if (q.ownerGhii === me) {
    if (!caller.has(HELP_ASK_SCOPE) && !caller.has(HELP_ANSWER_SCOPE)) return refuse(403, 'SCOPE_DENIED', `Reading this needs the permission ${HELP_ASK_SCOPE}.`);
    const routes = await deps.storage.listHelpRoutes(q.id);
    const names = await namesOf(deps, routes.map(r => r.helperGhii));
    return { ok: true, data: { role: 'asker', ...questionView(q, routes, names) } };
  }
  return refuse(404, 'NOT_FOUND', 'No question lives in this thread.');
}
