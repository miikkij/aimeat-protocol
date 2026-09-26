/**
 * @file public/views/profile/inbox-tab/message-turn.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One message in a Messages conversation, given to the Message component
 *   (components/Message.js) as data: who wrote it, the words with their inline pictures resolved, the
 *   quoted message it answers, the link previews under the words, the questions it asks, the files, the
 *   marks (a tracked reply's state, that a model wrote it, which model), the time and the read marks,
 *   and the actions: Copy and Listen in the line under it, the other six behind ⋯ (Jouni's decision
 *   "Message"). This file draws no markup of its own.
 * @structure MessageBubble({ msg, mine, who, … })
 * @usage import { MessageBubble } from './message-turn.js'; (components.js re-exports it)
 * @version-history
 *   v1.1.0 — 2026-09-26 — The message is the Message component; this file only turns a message record
 *     into its data. AttachmentItem moved into the component (components/MessageFile.js). Who wrote
 *     it and the time are inside the message again, as main has them.
 *   v1.0.0 — 2026-09-26 — A message is the chat's turn (a unification: Jouni's decision "Message"):
 *     the frame and the picture beside the other side's words go; the name, the read marks and all
 *     eight actions stay, Copy and Listen in the line under the message, the other six behind ⋯.
 *     AttachmentItem moved here from components.js unchanged.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);

import { t } from '/js/i18n.js';
import { Message } from '/components/Message.js';
import { MessageLinkPreviews } from '/components/LinkPreview.js';
import { prepareBody, quoteSnippet, statusTick, timeShort, trackStateLabel, trackStatusTone, attachKind } from './helpers.js';

/**
 * One message. `mine` is the person's own side (the sun); the other side is a person or their agent
 * (the spine). Delete stays last in the ⋯ menu, in its danger tone, because it is the only action that
 * cannot be undone and it asks before it acts.
 */
export function MessageBubble({ msg, mine, who, urlMap, starred, onStar, onTrack, onPark, onReplyAi, onQuote, onDelete, quoted, quotedName, onJumpTo, domId, tracked, onOpenMarkdown, answeredWith, onAnswer, submitting, showLinkPreviews, onTranscribe, canTranscribe }) {
  const nonInline = (msg.attachments || []).filter(a => !a.inline);
  const expiredIds = new Set((msg.attachments || []).filter(a => a.expired).map(a => a.id));
  // urlMap is keyed by `${messageId}::${attachmentId}` because per-message attachment ids (at0, at1…)
  // aren't unique across messages. Build THIS message's flat { attId → url } view so prepareBody's cid
  // resolution and the thumbnails only ever see their own message's attachments.
  const urls = {};
  for (const a of (msg.attachments || [])) {
    const u = urlMap[`${msg.id}::${a.id}`];
    if (u) urls[a.id] = u;
  }
  const trk = tracked ? trackStateLabel(tracked.state) : null;
  const status = mine ? msg.status : null;
  const menu = [
    onQuote ? { label: `↩ ${t('inbox.quoteReply')}`, run: () => onQuote(msg) } : null,
    { label: `${starred ? '⭐' : '☆'} ${t('inbox.markImportant')}`, run: () => onStar?.(msg) },
    { label: `🔗 ${t('inbox.trackResponse')}${trk ? ` — ${trk.text}` : ''}`, run: () => onTrack?.(msg) },
    { label: `📓 ${t('inbox.parkToNotebook')}`, run: () => onPark?.(msg) },
    { label: `✨ ${t('inbox.ai.replyToMessage')}`, run: () => onReplyAi?.(msg) },
    onDelete ? { label: t('inbox.deleteMessage'), run: () => onDelete(msg), danger: true } : null,
  ].filter(Boolean);
  // A file not yet copied to the reader says so; an expired one says it is gone.
  const files = nonInline.map(a => ({
    ...a, url: urls[a.id], kind: attachKind(a),
    state: a.expired ? 'expired' : (a.mode !== 'duplicate' ? 'pending' : null),
  }));
  const marks = [
    trk ? { text: `🔗 ${trk.text}`, title: t('inbox.trackResponse'), tone: trackStatusTone(trk.tone) } : null,
    // That a model wrote this at all, which is a different fact from WHICH model and arrives far more
    // often: an agent's message is stamped whether or not it names one. Absence stays silent on
    // purpose — no record means nothing was claimed.
    msg.ai ? { text: msg.ai.level === 'ai-generated' ? t('inbox.aiWrote') : t('inbox.aiAssisted'), title: t('inbox.aiRecorded'), tone: 'ai' } : null,
    // Which model wrote this, when an AI wrote it and named one. The name is the agent's own claim
    // (the node cannot verify it), so the tooltip says so rather than the mark implying a measurement.
    msg.ai?.model ? { text: msg.ai.model, title: t('inbox.modelClaimed', { model: msg.ai.model }), tone: 'model' } : null,
  ].filter(Boolean);

  return html`<${Message} id=${domId} mine=${mine} who=${who}
    quote=${quoted ? { name: quotedName || '', text: quoteSnippet(quoted.body), title: t('inbox.quoteJump'), onJump: () => onJumpTo?.(quoted.id) } : null}
    body=${prepareBody(msg.body, urls, expiredIds)}
    files=${files} onOpenText=${onOpenMarkdown} canTranscribe=${canTranscribe}
    onTranscribe=${onTranscribe ? (attId) => onTranscribe(msg.id, attId) : null}
    marks=${marks} time=${timeShort(msg.createdAt)}
    receipt=${status ? { mark: statusTick(status), tone: status === 'read' ? 'read' : (status === 'failed' || status === 'undeliverable') ? 'error' : null } : null}
    copy=${String(msg.body || '')} copyLabel=${t('inbox.copyMessage')}
    listen=${{ id: `msg:${msg.id}`, text: msg.body }}
    menu=${menu} menuLabel=${t('inbox.cover.more') || 'More'}
    questions=${msg.interactive?.role === 'questions' ? {
      spec: msg.interactive, answers: answeredWith ? (answeredWith.answers || {}) : undefined,
      submitting, onSubmit: (answers) => onAnswer?.(msg, answers),
    } : null}>
    ${showLinkPreviews ? html`<${MessageLinkPreviews} msg=${msg} />` : null}
  <//>`;
}
