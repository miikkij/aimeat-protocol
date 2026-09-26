/**
 * @file public/components/OpenCard.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One thing of a list, opened in place as a card of its own (design canvas "Your
 *   Agents", header B): its name as a full-width headline with the ▼ that closes it, under it the
 *   thing's words (its id line, its marks, and what a mark opens under them) and at the right its side
 *   (a sticker with the one way to change it, links out), then lines that say one thing with a way to
 *   change it, a notice, the tabs sorted into labelled groups, and the panel of the chosen tab. The
 *   card ends in the heavy ink rule, so the next row of the list starts on its own.
 *
 *   It owns its behaviour: a press on the headline or on the free part of the mast closes the card;
 *   a press inside the words, the side, or any part under the mast belongs to that part and does not
 *   close it. A page passes data and its parts; it never writes a class. Its look is
 *   css/components/open-card.css with poster.css's section title, row, panel and heavy rule.
 *
 *   OpenCard({ title, onClose, id, marks, more, side, children }): `id` is the first line under the
 *   name (a control that copies the thing's id), `marks` the row of marks (tags, statuses, a switch,
 *   a tag field), `more` a line the full width of the words under the marks (the list a mark opened),
 *   `side` the column at the right. `onClose` omitted: the headline closes nothing (a card that is the
 *   whole window).
 *   CardLine({ label, children, below }): one line in the card between two hairlines: a row label, the
 *   words and their way to change them, and `below` (a control that opens under the line).
 *   TabGroups({ groups, value, onSelect }): the card's tabs in labelled groups; a group is
 *   { key, label, items: [{ value, label, dot }] }, `dot` a mark that something unseen waits there
 *   ('new', or 'failed' in the danger colour). Groups with no items are left out. The arrow keys move
 *   along a group's tabs (Tabs).
 *   CardPanel({ children }): the chosen tab's content under the sun edge (poster.css .poster-panel).
 * @structure OpenCard(props) · CardLine(props) · TabGroups(props) · CardPanel(props)
 * @usage html`<${OpenCard} title=${name} onClose=${close} id=${html`<${GaiiChip} gaii=${gaii} />`}
 *          marks=${marks} side=${html`<${Sticker} figure=${access}>…<//>`}>
 *          <${CardLine} label=${t('x.runs')} below=${open && html`<${RunModeSwitch} …/>`}>${words} <${Action} …/><//>
 *          <${TabGroups} groups=${groups} value=${tab} onSelect=${setTab} />
 *          <${CardPanel}>${content}<//>
 *        <//>`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the opened agent of the Agents page (agp-card, agp-mast, agp-runs,
 *     agp-nav, agp-panel in views/profile/agents/agent-card.js and css/views/agents-poster.css), as a
 *     component with its behaviour (page group G1a).
 */
import { h } from 'preact';
import htm from 'htm';
import { Tabs } from '/components/Tabs.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');
const stop = (e) => e.stopPropagation();

export function OpenCard({ title, onClose, id, marks, more, side, children }) {
  const close = onClose || undefined;
  return html`
    <div class="open-card poster-row--thing">
      <h2 class=${cx('poster-section-title', 'open-card-title', close && 'open-card-title--closes')} onClick=${close}><span class="open-card-caret" aria-hidden="true">▼</span>${title}</h2>
      <div class=${cx('open-card-mast', close && 'open-card-mast--closes')} onClick=${close}>
        <div class="open-card-words">
          ${id ? html`<div class="open-card-id" onClick=${stop}>${id}</div>` : null}
          ${marks ? html`<div class="open-card-marks" onClick=${stop}>${marks}</div>` : null}
          ${more ? html`<div class="open-card-more poster-chips" onClick=${stop}>${more}</div>` : null}
        </div>
        ${side ? html`<div class="open-card-side" onClick=${stop}>${side}</div>` : null}
      </div>
      <div class="open-card-body" onClick=${stop}>${children}</div>
    </div>`;
}

export function CardLine({ label, below, children }) {
  return html`
    <div class="poster-row open-card-line">
      ${label ? html`<span class="poster-label">${label}</span>` : null}
      ${children}
      ${below ? html`<div class="open-card-line-below">${below}</div>` : null}
    </div>`;
}

const DOTS = { new: 'status-dot', failed: 'status-dot status-dot--error' };

export function TabGroups({ groups, value, onSelect }) {
  const shown = (groups || []).filter((g) => g && (g.items || []).length > 0);
  return html`
    <div class="open-card-tabs">
      ${shown.map((g) => html`
        <div class="open-card-tab-group" key=${g.key}>
          <span class="poster-label">${g.label}</span>
          <${Tabs} kind="view" label=${g.label} value=${value} onSelect=${onSelect}
            items=${g.items.map((it) => ({
              value: it.value, key: it.value,
              label: DOTS[it.dot] ? html`${it.label}<span class=${DOTS[it.dot]}></span>` : it.label,
            }))} />
        </div>`)}
    </div>`;
}

export function CardPanel({ children }) {
  return html`<div class="open-card-panel poster-panel">${children}</div>`;
}

export default OpenCard;
