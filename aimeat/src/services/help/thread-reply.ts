/**
 * @file src/services/help/thread-reply.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Recording an answer to a question of Ask someone who knows, and the check the message
 *   path runs after every local delivery: a helper who simply replies in the thread a question opened
 *   has answered it. Its own file, importing nothing that sends a message, because
 *   services/message-send.ts loads it and services/help/delivery.ts sends through message-send.ts:
 *   the two in one file made an import cycle.
 * @structure updateQuestion · recordAnswer · noteThreadReply
 * @version-history
 *   v1.0.0 — 2026-11-14 — Moved out of respond.ts to break the cycle with message-send.ts.
 */
import type { HelpQuestionRecord, HelpRouteRecord } from '../../storage/types/help.js';
import { emitHelpChange } from './events.js';
import { MAX_ANSWER, type HelpDeps } from './rules.js';

/** Write the question with one change, retrying when another writer got there first. */
export async function updateQuestion(deps: HelpDeps, id: string, change: (q: HelpQuestionRecord) => HelpQuestionRecord | null): Promise<HelpQuestionRecord | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const q = await deps.storage.getHelpQuestion(id);
    if (!q) return null;
    const next = change(q);
    if (!next) return q;
    if (await deps.storage.updateHelpQuestion({ ...next, updatedAt: new Date().toISOString() }, q.version)) {
      return { ...next, version: q.version + 1 };
    }
  }
  return null;
}

/** Mark the route answered and the question answered (first answer wins `answeredBy`). */
export async function recordAnswer(deps: HelpDeps, q: HelpQuestionRecord, route: HelpRouteRecord, answer: string, byAi: boolean, keepAllowed: boolean): Promise<void> {
  const now = new Date().toISOString();
  await deps.storage.updateHelpRoute({ ...route, outcome: 'answered', outcomeAt: now, draft: null, answer, answeredByAi: byAi, keepAllowed });
  // The first answer names the question's helper; a second helper's answer stays on its own route.
  await updateQuestion(deps, q.id, cur => (cur.state === 'open'
    ? { ...cur, state: 'answered', answeredBy: route.helperGhii, answeredByAi: byAi, answer }
    : null));
  emitHelpChange(q.ownerGhii, route.helperGhii);
}

/**
 * A message was delivered in a thread. When the thread belongs to a question and the sender is the
 * helper it was sent to, that message is the helper's answer. Called by services/message-send.ts for
 * every local delivery into a named thread that is not the help service's own; cheap when the thread
 * is not a question's (one indexed read).
 */
export async function noteThreadReply(deps: HelpDeps, conversationId: string, senderGhii: string, body: string, sentByAgent?: string): Promise<void> {
  const route = await deps.storage.getHelpRouteByConversation(conversationId);
  if (!route || route.helperGhii !== senderGhii || route.outcome !== 'pending') return;
  const q = await deps.storage.getHelpQuestion(route.questionId);
  if (!q || (q.state !== 'open' && q.state !== 'answered')) return;
  await recordAnswer(deps, q, route, body.slice(0, MAX_ANSWER), !!sentByAgent, false);
}
