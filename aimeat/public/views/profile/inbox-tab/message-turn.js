/**
 * @file public/views/profile/inbox-tab/message-turn.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One message in a Messages conversation, drawn as the chat's turn (components/Turn.js
 *   classes, css/components/turn.css): your words bold on the sun, the other side's beside the pale
 *   coral spine, the sender's name above the words and the time under them with the read marks, Copy
 *   and Listen; the other six actions (reply, mark important, track a response, add to notebook,
 *   reply with AI, delete) open from one ⋯ square (CardMenu, inline). AttachmentItem is one attached
 *   file inside the message. Both moved out of components.js (the 800-line limit) when the message
 *   became the turn.
 * @structure AttachmentItem({ a, url, onOpenMarkdown, msgId, onTranscribe, canTranscribe }) ·
 *   MessageBubble({ msg, mine, who, … })
 * @usage import { MessageBubble } from './message-turn.js'; (components.js re-exports both)
 * @version-history
 *   v1.0.0 — 2026-09-26 — A message is the chat's turn (a unification: Jouni's decision "Message"):
 *     the frame and the picture beside the other side's words go; the name, the read marks and all
 *     eight actions stay, Copy and Listen in the line under the message, the other six behind ⋯.
 *     AttachmentItem moved here from components.js unchanged.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);

import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { CopyButton } from '/components/CopyButton.js';
import { CardMenu } from '/components/CardMenu.js';
import { Markdown } from '/components/Markdown.js';
import { MessageLinkPreviews } from '/components/LinkPreview.js';
import { InteractiveForm, InteractiveAnswered } from './interactive-form.js';
import { prepareBody, quoteSnippet, statusTick, timeShort, trackStateLabel, trackStatusClass, ATTACH_ICO, attachKind } from './helpers.js';
import { BubbleSpeakButton } from './read-aloud.js';
import { AudioAttachment } from './voice-parts.js';

/** One received/sent attachment. Images render as a thumbnail (click → full-size in a new tab);
 *  audio plays in place; PDF/video/file open natively in a new tab; markdown opens the in-app
 *  rendered viewer. Every ready attachment gets a download button. Not-yet-duplicated / expired
 *  attachments show their state. */
export function AttachmentItem({ a, url, onOpenMarkdown, msgId, onTranscribe, canTranscribe }) {
  const kind = attachKind(a);
  const name = a.name || a.storageKey;
  const ready = !!url && !a.expired;

  if (!ready) {
    // What the reader needs is not the machine's word for the state ("pending") but what happened to
    // them and whose move it is next. The chip carries the short form and the title the whole
    // sentence, because a chip is four words wide and the answer is longer than that.
    const status = a.expired ? t('inbox.attachmentExpired') : (a.mode !== 'duplicate' ? t('inbox.attachmentPending') : null);
    const help = a.expired ? t('inbox.attachmentExpiredHelp') : (a.mode !== 'duplicate' ? t('inbox.attachmentPendingHelp') : null);
    return html`<div class="inbox-attach-chip inbox-attach-chip--pending" title=${help || undefined}>
      <span class="inbox-attach-ico">${ATTACH_ICO[kind]}</span>
      <span class="inbox-attach-name">${escHtml(name)}</span>
      ${status ? html`<span class="inbox-attach-pending">${status}</span>` : null}
    </div>`;
  }

  const download = html`<a class="inbox-attach-dl" href=${url} download=${name} title=${t('inbox.attachmentDownload')}>⬇</a>`;

  if (kind === 'image') {
    return html`<div class="inbox-attach-item">
      <a class="inbox-attach-thumb-link" href=${url} target="_blank" rel="noopener" title=${t('inbox.attachmentOpen')}>
        <img class="inbox-attach-thumb" src=${url} alt=${escHtml(name)} loading="lazy" />
      </a>
      <div class="inbox-attach-cap"><span class="inbox-attach-name">${escHtml(name)}</span>${download}</div>
    </div>`;
  }
  if (kind === 'markdown') {
    return html`<div class="inbox-attach-chip">
      <button class="inbox-attach-open" onClick=${() => onOpenMarkdown?.(url, name)} title=${t('inbox.attachmentView')}>
        <span class="inbox-attach-ico">📄</span><span class="inbox-attach-name">${escHtml(name)}</span>
      </button>${download}
    </div>`;
  }
  if (kind === 'audio') {
    return html`<${AudioAttachment} a=${a} url=${url} name=${name} download=${download}
      msgId=${msgId} onTranscribe=${onTranscribe} canTranscribe=${canTranscribe} />`;
  }
  // pdf / video / file — let the browser open it in a new tab.
  return html`<div class="inbox-attach-chip">
    <a class="inbox-attach-open" href=${url} target="_blank" rel="noopener" title=${t('inbox.attachmentOpen')}>
      <span class="inbox-attach-ico">${ATTACH_ICO[kind]}</span><span class="inbox-attach-name">${escHtml(name)}</span>
    </a>${download}
  </div>`;
}

/**
 * One message as the chat's turn. `mine` is the person's own side (the sun); the other side is a
 * person or their agent (the spine). The six actions that are not Copy or Listen are one ⋯ menu, so
 * the line under the message fits a phone; delete stays last, in the menu's danger tone, because it is
 * the only one that cannot be undone and it asks before it acts.
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
  const more = [
    onQuote ? { label: `↩ ${t('inbox.quoteReply')}`, run: () => onQuote(msg) } : null,
    { label: `${starred ? '⭐' : '☆'} ${t('inbox.markImportant')}`, run: () => onStar?.(msg) },
    { label: `🔗 ${t('inbox.trackResponse')}${trk ? ` — ${trk.text}` : ''}`, run: () => onTrack?.(msg) },
    { label: `📓 ${t('inbox.parkToNotebook')}`, run: () => onPark?.(msg) },
    { label: `✨ ${t('inbox.ai.replyToMessage')}`, run: () => onReplyAi?.(msg) },
    onDelete ? { label: t('inbox.deleteMessage'), run: () => onDelete(msg), danger: true } : null,
  ].filter(Boolean);
  return html`
    <div id=${domId} class=${`poster-turn poster-turn--${mine ? 'user' : 'agent'} inbox-turn`}>
      ${who ? html`<span class="poster-label poster-turn-who">${escHtml(who)}</span>` : null}
      <div class="poster-turn-body">
        ${quoted ? html`<button class="inbox-bubble-quote" onClick=${() => onJumpTo?.(quoted.id)} title=${t('inbox.quoteJump')}>
          <span class="inbox-quote-name">${escHtml(quotedName || '')}</span>
          <span class="inbox-quote-text">${escHtml(quoteSnippet(quoted.body))}</span>
        </button>` : null}
        <${Markdown} text=${prepareBody(msg.body, urls, expiredIds)} />
        ${showLinkPreviews ? html`<${MessageLinkPreviews} msg=${msg} />` : null}
        ${msg.interactive?.role === 'questions' ? (
          answeredWith
            ? html`<${InteractiveAnswered} spec=${msg.interactive} answers=${answeredWith.answers || {}} />`
            : html`<${InteractiveForm} spec=${msg.interactive} submitting=${submitting}
                onSubmit=${(answers) => onAnswer?.(msg, answers)} />`
        ) : null}
        ${nonInline.length > 0 && html`
          <div class="inbox-attach-row">
            ${nonInline.map(a => html`<${AttachmentItem} key=${a.id} a=${a} url=${urls[a.id]}
              onOpenMarkdown=${onOpenMarkdown} msgId=${msg.id}
              onTranscribe=${onTranscribe} canTranscribe=${canTranscribe} />`)}
          </div>`}
      </div>
      <div class="poster-time poster-turn-meta">
        ${trk ? html`<span class=${trackStatusClass(trk.tone)} title=${t('inbox.trackResponse')}>🔗 ${trk.text}</span>` : null}
        <!-- That a model wrote this at all, which is a different fact from WHICH model and arrives
             far more often: an agent's message is stamped whether or not it names one, and until
             now a stamped message with no model name looked exactly like a message a person typed.
             Absence stays silent on purpose — no record means nothing was claimed, and "a human
             wrote this" is not something the node is in a position to say. -->
        ${msg.ai ? html`<span class="poster-chip poster-chip--coral" title=${t('inbox.aiRecorded')}>${
          msg.ai.level === 'ai-generated' ? t('inbox.aiWrote') : t('inbox.aiAssisted')
        }</span>` : null}
        <!-- Which model wrote this, when an AI wrote it and named one. The name is the agent's own
             claim (the node cannot verify it), so the tooltip says so rather than the badge
             implying a measurement. -->
        ${msg.ai?.model ? html`<span class="poster-chip"
          title=${t('inbox.modelClaimed', { model: msg.ai.model })}>${escHtml(msg.ai.model)}</span>` : null}
        <span>${timeShort(msg.createdAt)}</span>
        ${mine && msg.status ? html`<span class=${`inbox-tick${msg.status === 'read' ? ' inbox-tick--read' : ''}${(msg.status === 'failed' || msg.status === 'undeliverable') ? ' inbox-tick--err' : ''}`}>${statusTick(msg.status)}</span>` : null}
        <!-- Copies the raw markdown the sender wrote — that is what pastes usefully into an AI
             chat or a document; the rendered body's presigned image URLs are transient. -->
        <${CopyButton} text=${String(msg.body || '')} className="poster-action poster-action--text"
          label="⧉" copiedLabel="✓"
          title=${t('inbox.copyMessage')} copiedTitle=${t('common.copied')}
          ariaLabel=${t('inbox.copyMessage')} />
        <${BubbleSpeakButton} msgId=${msg.id} body=${msg.body} />
        <${CardMenu} inline=${mine ? 'end' : 'start'} actions=${more} label=${t('inbox.cover.more') || 'More'} />
      </div>
    </div>`;
}
