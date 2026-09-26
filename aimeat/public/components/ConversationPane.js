/**
 * @file public/components/ConversationPane.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The messenger's frame (component plan C2, "Thread and Composer"): the two panes (the
 *   list of conversations beside the open one, one at a time on a phone with a way back, and over the
 *   whole screen while one is open), the open pane's column, its head (who, their presence, the
 *   subject, "sent by your agent", the address kept for a screen reader, and the head's ways on),
 *   the "replying to" bar over the composer, the line that says a conversation is read only, the
 *   compose fields, a scrolling part of a pane, and a strip across the pane (an agent's commands, a
 *   command to fill in, an agent's schedule). A page passes words and what a press does; it never
 *   writes a class. The look is css/components/conversation-pane.css.
 *
 *   The heights are measured, not guessed: the page's hook publishes the distance from the panes'
 *   top edge to the window's bottom as --conversation-desk-avail, and on a phone the visible height
 *   as --conversation-avail (views/profile/inbox-tab/use-thread-ux.js).
 * @structure Panes({ open, backLabel, onBack, side, children }) · Pane({ empty, page, children }) ·
 *   PaneHead({ picture, name, nameTitle, presence, subject, via, address, before, children }) ·
 *   PaneDoor({ mark, label, title, pressed, onClick }) · PaneFields({ children }) ·
 *   ReplyBar({ label, text, onJump, cancelLabel, onCancel }) · PaneNote({ children }) ·
 *   PaneScroll({ gap, children }) · PaneStrip({ grey, children })
 * @usage html`<${Panes} open=${mode !== 'idle'} backLabel=${t('inbox.back')} onBack=${goIdle} side=${list}>
 *          <${Pane}><${PaneHead} picture=${peer} name=${name} presence=${peer} subject=${s} address=${peer}>
 *            <${PaneDoor} label=${t('inbox.ai.replyWithAi')} onClick=${…} /><//>…<//><//>`
 *   `Pane page`: the pane as a page's column (the broadcast form, tracked responses, results): its
 *   height follows its words and its head is left out, as the page head already says it.
 *   A PaneDoor's words hide when the pane is narrow (below 620px of pane), its mark stays.
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial, moved with their values from css/views/inbox.css and
 *     inbox-poster.css (.inbox-body, .inbox-back, .inbox-side, .inbox-panel, .inbox-thread-head and
 *     its id, name, subject, via and address, .inbox-replybar*, .inbox-announce-note,
 *     .inbox-compose-fields, .inbox-tracked-list / .inbox-results, .inbox-cmdbar / -cmdfill / -sched
 *     strips, .inbox-empty, the phone's one-pane and full-screen rules and the pane's container query).
 */
import { h } from 'preact';
import htm from 'htm';
import { Avatar } from '/components/Avatar.js';
import { PresenceDot } from '/components/PresenceDot.js';
import { Action, Icon } from '/components/Action.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');

/** The two panes: the list (`side`) beside the open one (children). On a phone one at a time, the way
 *  back over the open one, and the open one over the whole screen. */
export function Panes({ open, backLabel, onBack, side, children }) {
  return html`
    <div class=${cx('conversation-panes', 'poster-row--thing', open && 'conversation-panes--open')}>
      <button type="button" class="conversation-panes-back" onClick=${onBack}>← ${backLabel}</button>
      <div class="conversation-panes-side">${side}</div>
      ${children}
    </div>`;
}

/** The open pane's column. `empty`: nothing is open, the words say what to do. `page`: the pane as a
 *  page's column. */
export function Pane({ empty, page, children }) {
  if (empty) {
    return html`<div class="conversation-pane conversation-pane--empty"><div class="conversation-pane-empty"><div>${children}</div></div></div>`;
  }
  return html`<div class=${cx('conversation-pane', page && 'conversation-pane--page')}>${children}</div>`;
}

/** The pane's head: who (a picture, the name with its presence word; the address is its tooltip and
 *  a line kept for a screen reader), the subject, "sent by your agent", and the head's ways on. */
export function PaneHead({ picture, name, nameTitle, presence, subject, via, address, before, children }) {
  return html`
    <div class="conversation-head">
      ${before}
      ${picture ? html`<${Avatar} seed=${picture} />` : null}
      <div class="conversation-head-id">
        <div class="conversation-head-name" title=${nameTitle}>${name}${presence ? html` <${PresenceDot} ghii=${presence} label=${true} />` : null}</div>
        ${subject ? html`<div class="conversation-head-subject">${subject}</div>` : null}
        ${via ? html`<div class="conversation-head-via">${via}</div>` : null}
        ${address ? html`<div class="conversation-head-address">${address}</div>` : null}
      </div>
      ${children}
    </div>`;
}

/** A way on in the pane's head: the small action link of a row; its words go when the pane is narrow,
 *  its mark (🔊) stays. */
export function PaneDoor({ mark, label, title, pressed, onClick }) {
  return html`<span class="conversation-head-door"><${Action} small row pressed=${pressed} title=${title} ariaLabel=${title || label} onClick=${onClick}>
    ${mark ? html`<span class="conversation-head-mark" aria-hidden="true">${mark}</span>` : null}<span class="conversation-head-word">${label}</span>
  <//></span>`;
}

/** The fields over a composer (to whom, the subject; a broadcast's choices). */
export function PaneFields({ children }) {
  return html`<div class="conversation-fields">${children}</div>`;
}

/** "Replying to …" over the composer while a quoted reply is written: a press on it jumps to the
 *  quoted message, ✕ drops the quote. */
export function ReplyBar({ label, text, onJump, cancelLabel, onCancel }) {
  return html`
    <div class="conversation-replybar">
      <button type="button" class="conversation-replybar-main" onClick=${onJump}>
        <span class="conversation-replybar-label">${label}</span>
        <span class="conversation-replybar-text">${text}</span>
      </button>
      <${Icon} small label=${cancelLabel} onClick=${onCancel}>✕<//>
    </div>`;
}

/** The line in the composer's place when a conversation is read only (an announcement, a
 *  conversation your agent had). */
export function PaneNote({ children }) {
  return html`<div class="conversation-pane-note">${children}</div>`;
}

/** A part of the pane that scrolls (tracked responses, a broadcast's results). */
export function PaneScroll({ children }) {
  return html`<div class="conversation-pane-scroll">${children}</div>`;
}

/** A strip across the pane under a hairline (an agent's commands); `grey` on the grey ground (a
 *  command to fill in, an agent's schedule). */
export function PaneStrip({ grey, children }) {
  return html`<div class=${cx('conversation-strip', grey && 'conversation-strip--grey')}>${children}</div>`;
}

export default Panes;
