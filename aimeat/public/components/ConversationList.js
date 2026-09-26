/**
 * @file public/components/ConversationList.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The list of a person's conversations with people and agents (component plan C2,
 *   "Thread and Composer"): Messages' left column. The rows are the chat's rows (ThreadList's
 *   .poster-thread, by Jouni's decision "Conversation list"): the name in bold, the open one on the
 *   sun. Each row keeps what it has on main: its kind mark (a person's picture, or inside a group the
 *   word mark "ag", "#" or "·"), its date on the right of the name, the Tags (via an agent, sent to
 *   many, a folded group), the subject and the last message on the line under it, its unread count,
 *   why it was archived, and its archive square. Rows sit in sections (People, your agents, a rule's
 *   heading, the archive) and under a person's or an agent's heading (ThreadPerson), both of which
 *   close; a row that stands for several threads opens them with its disclosure; several rows are
 *   picked with the selection line. Contact requests wait at the top. A page passes the words, the
 *   numbers and what a press does; it never writes a class. The look is
 *   css/components/conversation-list.css over thread-list.css.
 * @structure ConversationList({ selecting, empty, children }) · ConversationTools({ count, children }) ·
 *   ConversationRequests({ label, count, children }) · ConversationRequest({ picture, name, presence,
 *   address, preview, children }) · ConversationSection({ kind, label, count, unread, open, onToggle,
 *   children }) · ConversationGroup({ open, onToggle, picture, name, presence, countLabel, unreadLabel,
 *   pick, archive, children }) · ConversationRow({ title, presence, mark, date, dateTitle, chips,
 *   subject, preview, why, unread, active, nested, selecting, selected, onOpen, openLabel, archive }) ·
 *   ConversationFold({ row, open, onToggle, label, closed, children }) · ConversationRows({ children })
 * @usage html`<${ConversationList} selecting=${sel}>
 *          <${ConversationSection} kind="people" label=${t('…')} count=${3} unread=${1} open=${o} onToggle=${…}>
 *            <${ConversationRow} title=${name} mark=${{ picture: ghii }} date=${'14.02'} dateTitle=${full}
 *              preview=${'You: hello'} unread=${1} active onOpen=${…}
 *              archive=${{ label: 'Archive', ariaLabel: 'Archive: Kalle', onClick: … }} /><//><//>`
 *   `mark`: { picture: seed } (a person) | { word: 'ag' } (inside a group). `archive.restore` draws the
 *   box with the arrow out of it. `pick` on a group: the "select all" word while selecting.
 *   `openLabel` on a row: its tooltip, the whole name where the row cuts it short (an agent's threads).
 * @version-history
 *   v1.2.0 — 2026-09-27 — A row's archive square no longer wears the chat's delete class, whose rule
 *     showed it on the open row: it shows under the pointer and on keyboard focus only, as on main.
 *   v1.1.0 — 2026-09-26 — ConversationRow `openLabel`: the row's tooltip (an agent's Messages tab
 *     titles each thread with its whole title or last message, as main does); additive.
 *   v1.0.0 — 2026-09-26 — Initial, from views/profile/inbox-tab/list-panel.js with its behaviour
 *     unchanged. Put back what the previous branch lost from main's rows: each row's kind mark (the
 *     picture, or "ag", "#", "·" inside a group), its date on the right of the name line, the unread
 *     count on the line under it, the subject as its own coral words; and the hovers: a row lights
 *     under the pointer, a person's name and a section's name turn coral, a row's and a group's
 *     archive square show under the pointer and on keyboard focus and take no press while hidden.
 *     A picture is the Avatar component (components/Avatar.js): the row size on a row and a request
 *     (main's 40px and 36px), its small size beside a group's heading (the lead's ruling: one avatar).
 */
import { h } from 'preact';
import htm from 'htm';
import { Avatar } from '/components/Avatar.js';
import { PresenceDot } from '/components/PresenceDot.js';
import { ThreadPerson } from '/components/ThreadList.js';
import { Action } from '/components/Action.js';
import { Mark } from '/components/Mark.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');

const Chevron = ({ open }) => html`<svg class=${`conversation-chev${open ? ' is-open' : ''}`} viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
  <path d="M3.2 1.6 6.6 5 3.2 8.4" fill="none" stroke="currentColor" stroke-width="1.8" /></svg>`;
/** A box with the lid on (archive) or an arrow leaving it (restore). */
const BoxIcon = ({ restore }) => html`<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6">
  <rect x="1.8" y="2.2" width="12.4" height="3.4" /><path d="M3 5.6v8.2h10V5.6" />
  ${restore ? html`<path d="M8 12V7.6M5.9 9.5 8 7.4l2.1 2.1" />` : html`<path d="M6.2 8.4h3.6" />`}</svg>`;

/** The archive square beside a row or a group heading. */
function ArchiveSquare({ archive, extra }) {
  return html`<button type="button" class=${cx('poster-icon', 'poster-icon--small', 'conversation-act', extra)}
    title=${archive.label} aria-label=${archive.ariaLabel || archive.label}
    onClick=${archive.onClick}><${BoxIcon} restore=${archive.restore} /></button>`;
}

/** The column. `selecting` keeps the selection line at the top while many rows are picked; `empty`
 *  is the quiet line it says when there is no conversation yet. */
export function ConversationList({ selecting, empty, children }) {
  return html`<div class=${cx('conversation-list', selecting && 'conversation-list--selecting')}>
    ${children}
    ${empty ? html`<p class="poster-quiet conversation-list-empty">${empty}</p>` : null}
  </div>`;
}

/** Rows standing alone, outside a section (a sent broadcast's results list). */
export function ConversationRows({ children }) {
  return html`<div class="poster-thread-list">${children}</div>`;
}

/** The line of the list's own actions (select, archive the selected…), and how many are picked. */
export function ConversationTools({ count, children }) {
  return html`<div class="conversation-tools">
    ${count ? html`<span class="conversation-tools-count">${count}</span>` : null}
    ${children}
  </div>`;
}

/** The contact requests: a heading with their number, then one card each. */
export function ConversationRequests({ label, count, children }) {
  return html`
    <div class="conversation-list-heading poster-day-title">${label} ${count ? html`<${Mark} kind="count" tone="waiting">${count}<//>` : null}</div>
    ${children}`;
}

/** One contact request: who, their address, what they wrote, and the page's answers (children). */
export function ConversationRequest({ picture, name, presence, address, preview, children }) {
  return html`
    <div class="conversation-request">
      <div class="conversation-request-top">
        <${Avatar} seed=${picture} />
        <div class="conversation-request-id">
          <div class="conversation-request-name">${name} ${presence ? html`<${PresenceDot} ghii=${presence} />` : null}</div>
          <div class="conversation-request-address">${address}</div>
        </div>
      </div>
      <div class="conversation-request-preview">${preview || ''}</div>
      <div class="conversation-request-actions">${children}</div>
    </div>`;
}

/**
 * A section (People, your agents, a rule's heading, the archive): a heading that closes what is under
 * it and still says how many and how many are unread while closed.
 */
export function ConversationSection({ kind, label, count, unread, open, onToggle, children }) {
  return html`
    <div class=${cx('conversation-section', kind && `conversation-section--${kind}`)}>
      <button type="button" class="conversation-section-head poster-day-title" aria-expanded=${open ? 'true' : 'false'} onClick=${onToggle}>
        <${Chevron} open=${open} />
        <span class="conversation-section-name">${label}</span>
        <${Mark} kind="count" tone="tally">${count}<//>
        ${unread > 0 ? html`<${Mark} kind="count" tone="waiting">${unread}<//>` : null}
      </button>
      ${open ? html`<div class="poster-thread-list">${children}</div>` : null}
    </div>`;
}

/**
 * A person's or an agent's conversations under their heading (ThreadList's person tone): the arrow,
 * the picture, the name, the presence word and the two numbers, named; the square beside it archives
 * or brings back all of them, and while selecting the word beside it picks all of them.
 */
export function ConversationGroup({ open, onToggle, picture, name, presence, countLabel, unreadLabel, pick, archive, children }) {
  return html`
    <div class="conversation-group">
      <div class="conversation-group-bar">
        <${ThreadPerson} expanded=${open} onClick=${onToggle}>
          <${Chevron} open=${open} />
          <${Avatar} seed=${picture} size="small" />
          <span class="poster-thread-person-name">${name}</span>
          ${presence ? html`<${PresenceDot} ghii=${presence} label=${true} />` : null}
          <${Mark} kind="count" tone="tally">${countLabel}<//>
          ${unreadLabel ? html`<${Mark} kind="count" tone="waiting">${unreadLabel}<//>` : null}
        <//>
        ${pick
          ? html`<span class="conversation-group-pick"><${Action} tone="quiet" onClick=${pick.onClick}>${pick.label}<//></span>`
          : archive ? html`<${ArchiveSquare} archive=${archive} extra="conversation-group-act" />` : null}
      </div>
      ${open ? children : null}
    </div>`;
}

/**
 * One conversation. `nested` = inside a person's or an agent's group; `mark` = its kind mark;
 * `chips` = its Tags on the name line; `subject` and `preview` = the line under the name.
 */
export function ConversationRow({
  title, presence, mark, date, dateTitle, chips, subject, preview, why, unread,
  active, nested, selecting, selected, onOpen, openLabel, archive,
}) {
  return html`
    <div class=${cx('poster-thread', 'conversation-row', active && 'poster-thread--active', nested && 'conversation-row--nested', selected && 'conversation-row--selected')}>
      <button type="button" class="conversation-row-open" title=${openLabel || undefined}
        aria-pressed=${selecting ? (selected ? 'true' : 'false') : undefined} onClick=${onOpen}>
        ${selecting ? html`<span class="conversation-check" aria-hidden="true">${selected ? '✓' : ''}</span>` : null}
        ${mark?.picture ? html`<${Avatar} seed=${mark.picture} />`
          : mark?.word ? html`<span class="conversation-row-mark">${mark.word}</span>` : null}
        <span class="conversation-row-main">
          <span class="conversation-row-line">
            <span class="poster-thread-title conversation-row-name">${title} ${presence ? html`<${PresenceDot} ghii=${presence} />` : ''}</span>
            ${(chips || []).filter(Boolean).map((c, i) => html`<${Mark} key=${i}>${c}<//>`)}
            ${date ? html`<${Mark} kind="time" title=${dateTitle}>${date}<//>` : null}
          </span>
          ${subject || preview || unread > 0 ? html`<span class="conversation-row-line">
            ${subject ? html`<span class="conversation-row-subject">${subject}</span>` : null}
            <span class="poster-thread-sub conversation-row-preview">${preview || ''}</span>
            ${unread > 0 ? html`<${Mark} kind="count" tone="waiting">${unread}<//>` : null}
          </span>` : null}
          ${why ? html`<span class="conversation-row-why">${why}</span>` : null}
        </span>
      </button>
      ${archive ? html`<${ArchiveSquare} archive=${archive} />` : null}
    </div>`;
}

/**
 * A row that stands for several threads (copies of one broadcast, copies with one subject, a fold
 * rule), with the rest behind a disclosure. Closed by default: a person who wants the single threads
 * asks for them. `closed` hides the disclosure while selecting.
 */
export function ConversationFold({ row, open, onToggle, label, closed, children }) {
  return html`
    <div class="conversation-fold">
      ${row}
      ${closed ? null : html`<button type="button" class="conversation-fold-toggle" aria-expanded=${open ? 'true' : 'false'}
        onClick=${onToggle}>${label}</button>`}
      ${open && !closed ? children : null}
    </div>`;
}

export default ConversationList;
