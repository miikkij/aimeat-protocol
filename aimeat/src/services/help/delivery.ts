/**
 * @file src/services/help/delivery.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How a question, an answer and the closing line travel: as ordinary direct messages in a
 *   thread of their own, so the helper reads and answers them where they read every other message
 *   (Jouni, 2026-11-14: "tämä vain olisi erilainen message tyyppi tai sisältö siellä messages
 *   threadissa"). The question is sent in the ASKER's name with `kind: 'help-question'`; the line that
 *   closes it carries `kind: 'help-status'`. Both kinds are set here and nowhere a client reaches.
 *
 *   THE HELPER CHOSE TO RECEIVE QUESTIONS, so the first-contact gate does not hold the question back:
 *   choosing to be a helper is the acceptance. The node's per-account send limit does not count it
 *   either; the helper's own weekly limit is the limit here.
 *
 *   EACH HELPER HAS A THREAD OF THEIR OWN. Two helpers asked at once get two threads, not a group: a
 *   pass stays invisible, and nobody waits for a group invitation to be accepted.
 * @structure sendQuestion · sendAnswer · sendStatusLine · questionBody
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-pyyd-apua-nodessa-yhteinen-avunpyynt-v-yl-ihmisille-ja-heid-).
 */
import { randomUUID } from 'node:crypto';
import type { HelpQuestionRecord, HelpRouteRecord } from '../../storage/types/help.js';
import { sendDirectMessage, mapMessageAttachments } from '../message-send.js';
import { createT, toLocale } from '../../i18n.js';
import { localAccountName } from '../../utils/gaii.js';
import { newRouteId, type HelpDeps, type HelpResult, refuse } from './rules.js';

/**
 * The recipient's language, for the few words the node adds around the other person's own text. A
 * recipient who never chose one reads the sender's language, which is the language the text itself
 * is in, rather than English beside it.
 */
async function localeOf(deps: HelpDeps, ghii: string, fallbackGhii?: string) {
  const g = await deps.storage.getGHIIByOwner(localAccountName(ghii));
  if (g?.locale || !fallbackGhii) return createT(toLocale(g?.locale));
  const f = await deps.storage.getGHIIByOwner(localAccountName(fallbackGhii));
  return createT(toLocale(f?.locale));
}

/** The message a helper receives: the question, what was tried, the topics, in the asker's words. */
export async function questionBody(deps: HelpDeps, q: HelpQuestionRecord, helperGhii: string, matched: string[]): Promise<string> {
  const t = await localeOf(deps, helperGhii, q.ownerGhii);
  const parts = [q.question];
  if (q.tried) parts.push(`${t('help.msg.tried')}\n${q.tried}`);
  if (q.topics.length) parts.push(`${t('help.msg.topics')} ${q.topics.join(', ')}`);
  if (matched.length) parts.push(t('help.msg.why', { topics: matched.join(', ') }));
  return parts.join('\n\n');
}

/**
 * Send the question to one helper and record the route. The thread is new (a fresh id with the
 * question's subject), and the route names it, so a reply in that thread is known to answer this
 * question.
 */
export async function sendQuestion(deps: HelpDeps, q: HelpQuestionRecord, helperGhii: string, matched: string[],
  via?: { referredBy?: string }): Promise<HelpResult<HelpRouteRecord>> {
  const conversationId = randomUUID();
  const body = await questionBody(deps, q, helperGhii, matched);
  const sent = await sendDirectMessage({ storage: deps.storage, config: deps.config, peers: new Map() }, {
    senderGhii: q.ownerGhii, recipientGhii: helperGhii, subject: q.subject, body, conversationId,
    kind: 'help-question', skipContactGate: true, sendLimit: 'exempt',
    ...(q.attachments.length ? { attachments: mapMessageAttachments(q.attachments.map(a => ({ ...a, inline: false })), q.ownerGhii, deps.config.nodeId) } : {}),
    ...(q.askedBy !== q.ownerGhii ? { actingGaii: q.askedBy } : {}),
  });
  if (!sent.ok) {
    if (sent.code === 'ATTACHMENT_NOT_FOUND') return refuse(400, 'ATTACHMENT_NOT_FOUND', `An attached file was not found: ${sent.reason ?? 'check the storage key'}.`);
    return refuse(409, sent.code, sent.reason ?? 'The question could not be delivered to this helper.');
  }
  const route: HelpRouteRecord = {
    id: newRouteId(), questionId: q.id, helperGhii, conversationId: sent.message.conversationId,
    routedAt: new Date().toISOString(), outcome: 'pending', outcomeAt: null, referredTo: via?.referredBy ?? null,
    draft: null, answer: '', answeredByAi: false, keepAllowed: false,
  };
  await deps.storage.addHelpRoute(route);
  return { ok: true, data: route };
}

/** The helper's answer, sent in the helper's name into the question's thread. */
export async function sendAnswer(deps: HelpDeps, q: HelpQuestionRecord, route: HelpRouteRecord, answer: string,
  byAgent?: { gaii: string; name: string }): Promise<HelpResult<{ messageId: string }>> {
  const sent = await sendDirectMessage({ storage: deps.storage, config: deps.config, peers: new Map() }, {
    senderGhii: route.helperGhii, recipientGhii: q.ownerGhii, body: answer, conversationId: route.conversationId,
    skipContactGate: true, sendLimit: 'exempt', helpHandled: true,
    ...(byAgent ? { sentByAgent: byAgent.gaii, sentByAgentName: byAgent.name } : {}),
  });
  if (!sent.ok) return refuse(409, sent.code, sent.reason ?? 'The answer could not be delivered.');
  return { ok: true, data: { messageId: sent.message.id } };
}

/** The closing line, from the asker to the helper, in the helper's language. */
export async function sendStatusLine(deps: HelpDeps, q: HelpQuestionRecord, route: HelpRouteRecord,
  key: 'help.msg.solved' | 'help.msg.solvedReward' | 'help.msg.cancelled' | 'help.msg.expired', vars: Record<string, string | number> = {}): Promise<void> {
  const t = await localeOf(deps, route.helperGhii, q.ownerGhii);
  const lines = [t(key, vars)];
  if (q.thanks && key !== 'help.msg.cancelled' && key !== 'help.msg.expired') lines.push(q.thanks);
  await sendDirectMessage({ storage: deps.storage, config: deps.config, peers: new Map() }, {
    senderGhii: q.ownerGhii, recipientGhii: route.helperGhii, body: lines.join('\n\n'), conversationId: route.conversationId,
    kind: 'help-status', skipContactGate: true, sendLimit: 'exempt',
  });
}
