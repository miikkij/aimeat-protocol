/**
 * @file public/views/admin/work-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin Work page in the poster face (design canvas "AIMEAT Admin Work"). Three
 *   sections in the order an operator asks: what is still waiting and whose morsels it holds, every
 *   item, and what a work item is.
 *
 *   IT DREW NOTHING FOR ITS WHOLE LIFE. The table read `data.work.items`; the shell stores the list
 *   as `data.workItems` and counts THAT array for the menu. So the menu said 9 and the table said
 *   "No work items", on every node, every time. The count and the rows are one array read in one
 *   place now, which is the only arrangement in which the two cannot disagree.
 *
 *   THE PAGE ANSWERS A QUESTION. A work item takes the requester's morsels when it is asked and
 *   returns them only on delivery or expiry, so the sum over the open items is money somebody is
 *   currently short of. An item open past its deadline is that money stuck AND evidence that the
 *   hourly sweep (runWorkTimeoutJob) is not running: it is the one row drawn in coral.
 *
 * @structure
 *   - WorkTab({ data, switchPage }) — the three sections
 *   - dur / deadlineWords — the countdown a row prints instead of a timestamp
 * @version-history
 *   v2.1.0 -- 2026-09-13 -- Compose the empty state's frame and B1 heading from poster.css.
 *   v2.0.0 — 2026-09-12 — The poster face, and the table drawing at all: the key it read has never
 *     existed on the shell's data. The cost object is read as an object (it was printed with a
 *     number formatter, which would have rendered [object Object] had a row ever appeared), the
 *     dingbat the morsel figure used is gone, and the empty state says what is true instead of
 *     contradicting the menu beside it.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { num, dt, Row, Badge, Empty } from './shared.js';
import { decorate, summarise, counts, search, FILTERS, PAGE } from './work-tab.model.js';

const W = (key, params) => t('dashboard.workPage.' + key, params);

/** The five chips, keyed by the filter ids FILTERS orders and counts() counts. */
const FILTER_LABEL = { all: 'fAll', open: 'fOpen', delivered: 'fDelivered', failed: 'fFailed', expired: 'fExpired' };

/** The status word's tone. The words themselves are the machine's and are never translated. */
const TONE = {
  pending: 'open', accepted: 'open', in_progress: 'open',
  delivered: 'done', failed: 'bad', expired: 'gone',
};

/**
 * "2 d", "20 h", "35 min" — the coarsest unit that still says something. The unit is a locale key
 * rather than a letter in the code: "2 d myöhässä" is not Finnish.
 */
function dur(ms) {
  const m = Math.max(0, Math.round(Math.abs(ms) / 60000));
  if (m >= 1440) return W('unitDay', { n: Math.round(m / 1440) });
  if (m >= 60) return W('unitHour', { n: Math.round(m / 60) });
  // "0 min left" is a reading nobody can act on; under a minute says the same thing and is true.
  return m < 1 ? W('unitUnder') : W('unitMin', { n: m });
}

/** What the last column says: how long is left, how long it is over, or when it ended. */
function deadlineWords(row) {
  if (row.open) {
    if (row.msLeft === null) return { text: W('noDeadline'), over: false };
    return row.msLeft < 0
      ? { text: W('over', { time: dur(row.msLeft) }), over: true }
      : { text: W('left', { time: dur(row.msLeft) }), over: false };
  }
  const ended = row.updatedAt ? Date.parse(row.updatedAt) : NaN;
  if (!Number.isFinite(ended)) return { text: '', over: false };
  return { text: W('ago', { time: dur(Date.now() - ended) }), over: false };
}

export default function WorkTab({ data, switchPage }) {
  useViewCSS('/css/views/admin-work.css');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [oldestFirst, setOldestFirst] = useState(false);
  const [all, setAll] = useState(false);

  const nodeId = data.dash?.node_id || '';
  // THE SAME ARRAY THE MENU COUNTS. admin.js sets counts.work = data.workItems.length; reading any
  // other key is what made this page disagree with the number beside its own name.
  const items = useMemo(() => data.workItems || [], [data.workItems]);
  const rows = useMemo(() => decorate(items, { nodeId }), [items, nodeId]);
  const figures = useMemo(() => summarise(rows), [rows]);
  const chips = useMemo(() => counts(rows), [rows]);
  const found = useMemo(() => {
    const list = search(rows, filter, query);
    return oldestFirst ? [...list].reverse() : list;
  }, [rows, filter, query, oldestFirst]);

  if (!rows.length) {
    return html`
      <div class="og adm-work">
        <div class="adm-work-empty poster-frame">
          <h3 class="poster-section-title">${W('emptyTitle')}</h3>
          <p>${W('emptyWhy')}</p>
        </div>
      </div>`;
  }

  const shown = all ? found : found.slice(0, PAGE);
  const pending = figures.openRows.filter(r => r.status === 'pending' && !r.overdue);
  const working = figures.openRows.filter(r => r.status !== 'pending');

  const chip = (id, label) => html`
    <button type="button" class="adm-work-fchip ${filter === id ? 'on' : ''}"
      onClick=${() => { setFilter(id); setAll(false); }}>${label}</button>`;

  const held = (list) => W('heldVal', { count: num(list.reduce((n, r) => n + r.held, 0)) });

  return html`
    <div class="og adm-work">

      <section class="og-sec og-sec--first">
        <div class="og-sec-h">
          <h2>${W('waitingQ')}<small>01</small></h2>
          <div class="og-doors">
            <button type="button" class="og-door og-door--quiet" onClick=${() => {
    document.querySelector('.adm-work-acts-sec')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }}>${W('whatIsDoor')}</button>
          </div>
        </div>
        <div class="adm-ov-grid">
          <div>
            <div class="adm-ov-status ${figures.overdue ? 'danger' : ''}">${figures.open === 0
    ? W('waitingNone')
    : figures.open === 1 ? W('waitingOne') : W('waitingWord', { count: figures.open })}</div>
            <p class="adm-alert-line">${W('lead')}</p>
            <div class="adm-ov-up">
              ${W('leadItems', { count: num(figures.total) })}<br />
              ${W('leadHeld', { count: num(figures.held) })}<br />
              ${figures.overdue ? W('leadOverdue', { count: num(figures.overdue) }) : W('leadNoOverdue')}
            </div>
          </div>
          <div>
            ${figures.overdue > 0 && html`
              <${Row}
                title=${figures.overdue === 1 ? W('overdueTitleOne') : W('overdueTitle', { count: num(figures.overdue) })}
                why=${W('overdueWhy')}
                chip=${html`<${Badge} type="danger" label=${W('overdueBadge')} />`}
                value=${held(figures.overdueRows)} />`}
            ${pending.length > 0 && html`
              <${Row}
                title=${pending.length === 1 ? W('pendingTitleOne') : W('pendingTitle', { count: num(pending.length) })}
                why=${W('pendingWhy')}
                chip=${html`<${Badge} type="watch" label=${W('pendingBadge')} />`}
                value=${held(pending)}
                last=${working.length === 0} />`}
            ${working.length > 0 && html`
              <${Row}
                title=${working.length === 1 ? W('progressTitleOne') : W('progressTitle', { count: num(working.length) })}
                why=${W('progressWhy')}
                value=${held(working)}
                last=${true} />`}
            ${figures.open === 0 && html`
              <${Row} title=${W('quietTitle')} why=${W('quietWhy')} value=${num(figures.total)} last=${true} />`}
          </div>
        </div>
      </section>

      <div class="og-strip">
        <div><b>${num(figures.total)}</b><span>${W('stripItems')}</span><small>${W('stripItemsSub')}</small></div>
        <div><b>${num(figures.open)}</b><span>${W('stripWaiting')}</span><small>${W('stripWaitingSub')}</small></div>
        <div><b>${num(figures.held)}</b><span>${W('stripHeld')}</span><small>${W('stripHeldSub')}</small></div>
        <div><b class=${figures.overdue ? 'og-coral-num' : ''}>${num(figures.overdue)}</b><span>${W('stripOverdue')}</span><small>${W('stripOverdueSub')}</small></div>
      </div>

      <section class="og-sec">
        <div class="og-sec-h">
          <h2>${W('every')}<small>02</small></h2>
          <div class="og-doors">
            <button type="button" class="og-door og-door--quiet" onClick=${() => setOldestFirst(v => !v)}>
              ${oldestFirst ? W('orderNewest') : W('orderOldest')}</button>
          </div>
        </div>

        <div class="adm-work-find">
          <div class="adm-work-fld">
            <div class="adm-work-lbl">${W('find')}</div>
            <input type="search" class="adm-work-input" value=${query} placeholder=${W('findPlaceholder')}
              onInput=${e => { setQuery(e.target.value); setAll(false); }} />
          </div>
          <div class="adm-work-chips">
            ${FILTERS.map(id => chip(id, W(FILTER_LABEL[id], { count: num(chips[id]) })))}
          </div>
        </div>

        <div class="adm-work-row adm-work-row--head">
          <div class="adm-work-n">#</div>
          <div>${W('colCode')}</div>
          <div>${W('colStatus')}</div>
          <div>${W('colAction')}</div>
          <div>${W('colWho')}</div>
          <div class="adm-work-cost">${W('colCost')}</div>
          <div>${W('colDeadline')}</div>
        </div>

        ${shown.length === 0
    ? html`<${Empty} text=${W('none')} />`
    : shown.map((r, i) => {
      const when = deadlineWords(r);
      return html`
          <div class="adm-work-row ${r.overdue ? 'is-over' : ''}">
            <div class="adm-work-n">${String(oldestFirst ? found.length - i : i + 1).padStart(2, '0')}</div>
            <div class="adm-work-tc" title=${r.trackingCode}>${r.trackingCode}</div>
            <div class="adm-work-st adm-work-st--${TONE[r.status] || 'gone'}">${r.status}</div>
            <div class="adm-work-act">${r.action}</div>
            <div class="adm-work-who">
              <b title=${r.requester.foreign ? W('elsewhere') : null}>${r.requester.name}</b>
              <!-- The character itself: htm renders text as text, so an HTML entity here would
                   print as "&rarr;". One of the four glyphs the design language allows. -->
              <span>→</span>
              <b title=${r.provider.foreign ? W('elsewhere') : null} class=${r.provider.foreign ? 'is-far' : ''}>${r.provider.name}</b>
            </div>
            <div class="adm-work-cost ${r.held ? 'is-held' : ''}">${num(r.total)}</div>
            <div class="adm-work-left ${when.over ? 'is-over' : ''}" title=${dt(r.createdAt)}>${when.text}</div>
          </div>`;
    })}

        ${found.length > PAGE && html`
          <div class="adm-work-more">
            <span>${W('shown', { shown: num(shown.length), total: num(found.length) })}</span>
            ${!all && html`<button type="button" class="og-door" onClick=${() => setAll(true)}>${W('showRest')}</button>`}
          </div>`}
      </section>

      <section class="og-sec adm-work-acts-sec">
        <div class="og-sec-h">
          <h2>${W('actsTitle')}<small>03</small></h2>
          <div class="og-doors">
            <button type="button" class="og-door og-door--quiet" onClick=${() => switchPage('actions')}>${t('dashboard.actions')}</button>
          </div>
        </div>
        <div class="adm-work-two">
          <div class="og-box">
            <span class="og-box-label">${W('jobLabel')}</span>
            <div class="adm-work-flow">
              <i class="on">pending</i><s>→</s><i class="on">accepted</i><s>→</s><i class="on">in_progress</i><s>→</s><i class="on">delivered</i>
            </div>
            <p>${W('jobBody')}</p>
            <p class="adm-work-rule">${W('jobRule')}</p>
          </div>
          <div class="og-box og-box--solid">
            <span class="og-box-label">${W('moneyLabel')}</span>
            <p>${W('moneyBody')}</p>
            <p class="adm-work-rule">${W('moneyRule')}</p>
          </div>
        </div>
      </section>

    </div>`;
}
