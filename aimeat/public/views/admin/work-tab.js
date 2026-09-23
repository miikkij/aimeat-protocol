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
 *   v3.0.0 -- 2026-09-22 -- Composed from the shared set and admin-work.css deleted: Sections, the
 *     waiting word a heading, the strip a NumeralBand, the search and five filters a Toolbar, the
 *     items the shared Table with the status as a Chip in its tone and a late item's row and deadline
 *     in the danger tone (rowTones), the two explanations asides.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v2.2.0 — 2026-09-13 — Compose shared poster headings in the populated view.
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
import { num, dt, Row, Badge, Empty } from './shared.js';
import { decorate, summarise, counts, search, FILTERS, PAGE } from './work-tab.model.js';
import { Section, Columns, Stack, Toolbar, NumeralBand, Table, Surface, Action, Chip, Text, scrollToId } from '/components/poster-parts.js';

/** The id of the third section, which the first section's door scrolls to. */
const ACTS_ID = 'adm-work-acts';

const W = (key, params) => t('dashboard.workPage.' + key, params);

/** The five chips, keyed by the filter ids FILTERS orders and counts() counts. */
const FILTER_LABEL = { all: 'fAll', open: 'fOpen', delivered: 'fDelivered', failed: 'fFailed', expired: 'fExpired' };

/** The status chip's tone. The words themselves are the machine's and are never translated. */
const TONE = {
  pending: 'sun', accepted: 'sun', in_progress: 'sun',
  delivered: 'success', failed: 'danger', expired: 'muted',
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
      <${Section} title=${W('emptyTitle')}>
        <${Text}>${W('emptyWhy')}<//>
      <//>`;
  }

  const shown = all ? found : found.slice(0, PAGE);
  const pending = figures.openRows.filter(r => r.status === 'pending' && !r.overdue);
  const working = figures.openRows.filter(r => r.status !== 'pending');

  const held = (list) => W('heldVal', { count: num(list.reduce((n, r) => n + r.held, 0)) });

  const filters = FILTERS.map(id => ({
    id, label: W(FILTER_LABEL[id], { count: num(chips[id]) }), selected: filter === id,
    onClick: () => { setFilter(id); setAll(false); },
  }));

  const tableRows = shown.map((r, i) => {
    const when = deadlineWords(r);
    return [
      { text: String(oldestFirst ? found.length - i : i + 1).padStart(2, '0'), mono: true },
      { text: r.trackingCode, mono: true, title: r.trackingCode },
      html`<${Chip} tone=${TONE[r.status] || 'muted'}>${r.status}<//>`,
      { text: r.action, mono: true },
      html`<${Stack} direction="wrap" density="compact" align="center">
        <${Text} kind="mono" title=${r.requester.foreign ? W('elsewhere') : null}>${r.requester.name}<//>
        <!-- The character itself: htm renders text as text, so an HTML entity here would
             print as "&rarr;". One of the four glyphs the design language allows. -->
        <${Text} kind="mono" tone="muted">→<//>
        <${Text} kind="mono" tone=${r.provider.foreign ? 'muted' : 'plain'} title=${r.provider.foreign ? W('elsewhere') : null}>${r.provider.name}<//>
      <//>`,
      { text: html`<${Text} kind="mono" tone=${r.held ? 'coral' : 'plain'}>${num(r.total)}<//>`, align: 'end' },
      html`<${Text} kind="mono" tone=${when.over ? 'danger' : 'plain'} title=${dt(r.createdAt)}>${when.text}<//>`,
    ];
  });

  return html`
    <${Stack}>
      <${Section} title=${W('waitingQ')} count="01"
        actions=${html`<${Action} onClick=${() => scrollToId(ACTS_ID)}>${W('whatIsDoor')}<//>`}>
        <${Columns} layout="trailing" collapse=${900}>
          <${Stack} density="compact">
            <${Text} kind="heading" tone=${figures.overdue ? 'coral' : 'plain'}>${figures.open === 0
    ? W('waitingNone')
    : figures.open === 1 ? W('waitingOne') : W('waitingWord', { count: figures.open })}<//>
            <${Text}>${W('lead')}<//>
            <${Stack} density="compact">
              <${Text} kind="mono" tone="muted">${W('leadItems', { count: num(figures.total) })}<//>
              <${Text} kind="mono" tone="muted">${W('leadHeld', { count: num(figures.held) })}<//>
              <${Text} kind="mono" tone="muted">${figures.overdue ? W('leadOverdue', { count: num(figures.overdue) }) : W('leadNoOverdue')}<//>
            <//>
          <//>
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
        <//>
      <//>

      <${NumeralBand} tone="plain" items=${[
        { label: W('stripItems'), value: num(figures.total), note: W('stripItemsSub') },
        { label: W('stripWaiting'), value: num(figures.open), note: W('stripWaitingSub') },
        { label: W('stripHeld'), value: num(figures.held), note: W('stripHeldSub') },
        { label: W('stripOverdue'), value: num(figures.overdue), note: W('stripOverdueSub'), tone: figures.overdue ? 'coral' : undefined },
      ]} />

      <${Section} title=${W('every')} count="02"
        actions=${html`<${Action} onClick=${() => setOldestFirst(v => !v)}>${oldestFirst ? W('orderNewest') : W('orderOldest')}<//>`}>
        <${Toolbar} label=${W('every')} filters=${filters}
          search=${{ label: W('find'), placeholder: W('findPlaceholder'), value: query, onInput: e => { setQuery(e.target.value); setAll(false); } }} />

        ${shown.length === 0
    ? html`<${Empty} text=${W('none')} />`
    : html`<${Table} collapse=${600} headers=${['#', W('colCode'), W('colStatus'), W('colAction'), W('colWho'), W('colCost'), W('colDeadline')]}
        rows=${tableRows} rowTones=${shown.map(r => (r.overdue ? 'danger' : undefined))} />`}

        ${found.length > PAGE && html`
          <${Stack} direction="horizontal" align="between">
            <${Text} kind="mono" tone="muted">${W('shown', { shown: num(shown.length), total: num(found.length) })}<//>
            ${!all && html`<${Action} onClick=${() => setAll(true)}>${W('showRest')}<//>`}
          <//>`}
      <//>

      <${Section} id=${ACTS_ID} title=${W('actsTitle')} count="03"
        actions=${html`<${Action} onClick=${() => switchPage('actions')}>${t('dashboard.actions')}<//>`}>
        <${Columns} collapse=${900}>
          <${Surface} kind="aside">
            <${Stack} density="compact">
              <${Text} kind="label">${W('jobLabel')}<//>
              <${Stack} direction="wrap" density="compact" align="center">
                <${Chip} tone="sun">pending<//><${Text} kind="mono">→<//><${Chip} tone="sun">accepted<//><${Text} kind="mono">→<//>
                <${Chip} tone="sun">in_progress<//><${Text} kind="mono">→<//><${Chip} tone="sun">delivered<//>
              <//>
              <${Text}>${W('jobBody')}<//>
              <${Text} kind="caption" tone="muted">${W('jobRule')}<//>
            <//>
          <//>
          <${Surface} kind="aside" tone="danger">
            <${Stack} density="compact">
              <${Text} kind="label">${W('moneyLabel')}<//>
              <${Text}>${W('moneyBody')}<//>
              <${Text} kind="caption" tone="muted">${W('moneyRule')}<//>
            <//>
          <//>
        <//>
      <//>
    <//>`;
}
