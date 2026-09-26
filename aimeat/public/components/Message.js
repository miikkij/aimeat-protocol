/**
 * @file public/components/Message.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One thing somebody said in a conversation, and the thread that holds them (component
 *   plan C2, "Thread and Composer"). A page passes the words and the facts about them as data and
 *   never writes a class. The look is css/components/message.css over the chat's turn
 *   (css/components/turn.css, .poster-turn), which Messages takes by Jouni's decision "Message".
 *
 *   A message (the default tone, Messages): the chat's turn, yours bold on the sun and the other
 *   side's beside the pale coral spine. Inside it, as Messages has always had them: the quoted message
 *   it answers (a press jumps to it), who wrote it in the row label's small capitals, the words
 *   (Markdown, or `plain` as written), what the page puts under the words (link previews), the
 *   questions it asks (`questions`, components/MessageQuestions.js), the files, and one line with
 *   the marks (a model wrote it, which model, a tracked reply's state), the time and the read marks. Under it: Copy and Listen, and the other actions behind one
 *   ⋯ square (CardMenu), so the line fits a phone.
 *
 *   Tones, each a meaning and the look its page has on main:
 *   - 'draft': a reply your AI wrote that waits for your yes, on your side in a dashed box, with a line
 *     above the words and the page's actions under them (Jouni: "dark mode totally unreadable", so the
 *     words take the text colour).
 *   - 'comment': a comment on a workspace record or document, framed on the grey ground: the head line
 *     (who, the notes after it, when), the words as written, the actions under them; `reply` indents
 *     it with a coral edge.
 *   - 'board': a reply to a board notice, beside a grey edge: who in typewriter, the words as written.
 * @structure Message(props) · Thread({ scrollRef, tone, capped, children }) · ThreadDay({ children }) ·
 *   ThreadTop({ children }) · ThreadForm({ children }) · Listen({ id, text }) · useSpeechPhase(id) ·
 *   flashMessage(domId)
 * @usage html`<${Thread} scrollRef=${ref}><${ThreadDay}>${'Today'}<//>
 *          <${Message} id=${'m-1'} mine who=${'You'} body=${md} time=${'14.02'} receipt=${{ mark: '✓✓', tone: 'read' }}
 *            marks=${[{ text: 'AI wrote this', tone: 'ai', title }]} copy=${md} copyLabel=${'Copy message'}
 *            listen=${{ id: 'msg:1', text: md }} menu=${[{ label: 'Reply', run }]} /><//>`
 *        html`<${Message} tone="comment" reply who=${author} whoNote=${['reply']} time=${when} body=${text} plain
 *          actions=${html`<${Action} small onClick=${…}>Reply<//>`} />`
 * @version-history
 *   v1.1.0 — 2026-09-26 — Thread `capped`: a thread that stands inside a page (an agent's Messages
 *     tab) scrolls after 400px instead of filling a column, as main's .pf-agd-msg-history did; additive.
 *   v1.0.0 — 2026-09-26 — Initial: Messages' message (MessageBubble in views/profile/inbox-tab), the
 *     suggested reply's dashed box, a workspace comment and a board reply as one component with
 *     tones. Put back what the previous branch lost from Messages: who wrote it and the time are
 *     inside the message again, as main has them (views/profile/inbox-tab/components.js MessageBubble:
 *     .inbox-bubble-who above the words, .inbox-bubble-meta with the time), with the marks and the
 *     read marks beside the time.
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Markdown } from '/components/Markdown.js';
import { CardMenu } from '/components/CardMenu.js';
import { Action } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { MessageFiles } from '/components/MessageFile.js';
import { MessageQuestions } from '/components/MessageQuestions.js';
import { isSpeechSupported, subscribeSpeech, getSpeechState, speak, stop, textToParagraphs } from '/js/services/speech-reader.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');

/** The reader phase for ONE id: '' when this id isn't the active reader, else 'speaking' | 'paused'.
 *  Every control subscribes independently; the engine only notifies on real phase changes (start /
 *  stop / pause / resume — never per spoken chunk), and an unchanged string is a no-op re-render. */
export function useSpeechPhase(id) {
  const [phase, setPhase] = useState(() => (getSpeechState().id === id ? getSpeechState().phase : ''));
  useEffect(() => {
    setPhase(getSpeechState().id === id ? getSpeechState().phase : '');
    return subscribeSpeech((s) => setPhase(s.id === id ? s.phase : ''));
  }, [id]);
  // Leaving the view (thread switch, tab change) must not leave a voice reading into an empty room.
  useEffect(() => () => { if (getSpeechState().id === id) stop(); }, [id]);
  return phase;
}

/** Listen, in the line under a message (the text tone of the action link, as the chat's turn has it):
 *  reads that one message; pressed while it reads, it stops. Drawn only when the browser can speak
 *  AND the message has something speakable (a message with only a file has no words to read, so the
 *  button is left out rather than offered to do nothing). */
export function Listen({ id, text }) {
  const phase = useSpeechPhase(id);
  if (!isSpeechSupported()) return null;
  const paragraphs = textToParagraphs(text);
  if (!paragraphs.length) return null;
  const on = phase === 'speaking' || phase === 'paused';
  const words = on ? t('inbox.speak.stop') : t('inbox.speak.message');
  return html`<${Action} tone="text" title=${words} ariaLabel=${words} pressed=${on}
    onClick=${() => (on ? stop() : speak(id, paragraphs))}>${on ? t('chat.stopListening') : t('inbox.speak.listen')}<//>`;
}

/** Jump to a message: scroll it into view inside its thread and let it show itself for a moment. */
export function flashMessage(domId) {
  const el = document.getElementById(domId);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('message--flash');
  setTimeout(() => el.classList.remove('message--flash'), 1400);
}

const STATUS_TONES = new Set(['fine', 'attention', 'danger', 'off']);

/** One mark beside the time: that a model wrote it (the coral Tag), which model (the plain Tag), or
 *  a state (the Status). */
function MessageMark({ mark }) {
  if (STATUS_TONES.has(mark.tone)) return html`<${Mark} kind="status" tone=${mark.tone} title=${mark.title}>${mark.text}<//>`;
  return html`<${Mark} tone=${mark.tone === 'ai' ? 'coral' : undefined} title=${mark.title}>${mark.text}<//>`;
}

/** The quoted message a reply answers; a press jumps to it. */
function Quote({ quote }) {
  return html`<button type="button" class="message-quote" onClick=${() => quote.onJump?.()} title=${quote.title}>
    <span class="message-quote-name">${quote.name || ''}</span>
    <span class="message-quote-text">${quote.text || ''}</span>
  </button>`;
}

/** The words: Markdown by default, as written with `plain`. */
function Words({ body, plain }) {
  return plain
    ? html`<p class="message-said">${body || ''}</p>`
    : html`<div class="message-words"><${Markdown} text=${body || ''} /></div>`;
}

/** The head line of a comment or a board reply: who, the notes after the name, when. */
function Head({ who, whoNote, time, timeTitle, board }) {
  const notes = (Array.isArray(whoNote) ? whoNote : whoNote ? [whoNote] : []).filter(Boolean);
  if (board) {
    return html`<div class="message-by"><b>${who || '?'}</b>${notes.map((n) => ` · ${n}`)}${time ? ` · ${time}` : ''}</div>`;
  }
  return html`<div class="message-head">
    <b>${who || '?'}</b>
    ${notes.map((n, i) => html`<span class="message-head-note" key=${i}> · ${n}</span>`)}
    <span class="poster-time" title=${timeTitle}> · ${time || ''}</span>
  </div>`;
}

export function Message({
  id, mine, tone, reply, who, whoNote, label, quote, body, plain, time, timeTitle, receipt, marks,
  questions, files, onOpenText, onTranscribe, canTranscribe, copy, copyLabel, listen, menu, menuLabel, actions, children,
}) {
  if (tone === 'comment') {
    return html`<div id=${id} class=${cx('message', 'message--comment', reply && 'message--reply')}>
      <${Head} who=${who} whoNote=${whoNote} time=${time} timeTitle=${timeTitle} />
      <${Words} body=${body} plain=${plain} />
      ${actions ? html`<div class="message-foot">${actions}</div>` : null}
    </div>`;
  }
  if (tone === 'board') {
    return html`<div id=${id} class="message message--board">
      <${Head} board who=${who} whoNote=${whoNote} time=${time} />
      <${Words} body=${body} plain=${plain} />
      ${actions ? html`<div class="message-foot">${actions}</div>` : null}
    </div>`;
  }
  if (tone === 'draft') {
    return html`<div id=${id} class="message message--draft">
      <div class="message-draft">
        ${label ? html`<div class="message-draft-label">${label}</div>` : null}
        <${Words} body=${body} plain=${plain} />
        ${children}
        ${actions ? html`<div class="message-draft-actions">${actions}</div>` : null}
      </div>
    </div>`;
  }

  // The message: the chat's turn, with who and when inside it.
  const hasMeta = (marks && marks.length) || time || receipt?.mark;
  const hasActions = (copy !== undefined && copy !== null) || listen || (menu && menu.length);
  return html`
    <div id=${id} class=${cx('poster-turn', mine ? 'poster-turn--user' : 'poster-turn--agent', 'message')}>
      <div class="poster-turn-body message-body">
        ${quote ? html`<${Quote} quote=${quote} />` : null}
        ${who ? html`<span class="poster-label poster-label--block message-who">${who}</span>` : null}
        <${Words} body=${body} plain=${plain} />
        ${children}
        ${questions ? html`<${MessageQuestions} ...${questions} />` : null}
        <${MessageFiles} files=${files} onOpenText=${onOpenText} onTranscribe=${onTranscribe} canTranscribe=${canTranscribe} />
        ${hasMeta ? html`<div class="message-meta">
          ${(marks || []).filter(Boolean).map((m, i) => html`<${MessageMark} key=${i} mark=${m} />`)}
          ${time ? html`<${Mark} kind="time" title=${timeTitle}>${time}<//>` : null}
          ${receipt?.mark ? html`<span class=${cx('message-receipt', receipt.tone && `message-receipt--${receipt.tone}`)} title=${receipt.title}>${receipt.mark}</span>` : null}
        </div>` : null}
      </div>
      ${hasActions ? html`<div class="poster-turn-meta message-actions">
        ${/* The raw text the sender wrote: that is what pastes usefully into an AI chat or a
              document; the drawn words' presigned picture addresses are short-lived. */''}
        ${copy !== undefined && copy !== null ? html`<${Action} tone="text" copy=${String(copy)} copiedLabel="✓"
          copiedTitle=${t('common.copied')} title=${copyLabel} ariaLabel=${copyLabel}>⧉<//>` : null}
        ${listen ? html`<${Listen} id=${listen.id} text=${listen.text} />` : null}
        ${menu && menu.length ? html`<${CardMenu} inline=${mine ? 'end' : 'start'} actions=${menu} label=${menuLabel} />` : null}
      </div>` : null}
    </div>`;
}

/**
 * The thread. The default is Messages' scrolling column (the page holds `scrollRef` to follow the
 * newest message); `tone="comments"` is the comments under a workspace record or document, under a
 * hairline.
 */
export function Thread({ scrollRef, tone, capped, children }) {
  if (tone === 'comments') return html`<div class="message-comments">${children}</div>`;
  return html`<div class=${cx('message-thread', capped && 'message-thread--capped')} ref=${scrollRef}>${children}</div>`;
}

/** The day a run of messages was written, between them. */
export function ThreadDay({ children }) {
  return html`<div class="message-thread-day"><span>${children}</span></div>`;
}

/** A line at the top of the thread, centred (the way to the older messages). */
export function ThreadTop({ children }) {
  return html`<div class="message-thread-top">${children}</div>`;
}

/** The form under a thread of comments: its fields and its loud action, one under the other. */
export function ThreadForm({ children }) {
  return html`<div class="message-thread-form">${children}</div>`;
}

export default Message;
