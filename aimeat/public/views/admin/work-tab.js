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
 *   v2.3.0 — 2026-09-27 — On the library components (page group G5): the sections are Sections, the
 *     verdict and its readings the Verdict and Reading, the strip the FigureStrip, the find the search
 *     field with the filter Tabs, the items the List (the row past its deadline carries the coral rail,
 *     its deadline the coral time, a held cost the warn colour, the status the Status mark), "show the
 *     rest" the More line, the two closing boxes SettingBoxes with the lifecycle as Marks. The page
 *     sheet admin-work.css goes; the file writes no class and no style.
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
import { Section } from '/components/Section.js';
import { Verdict } from '/components/Readings.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { List, Row as ListRow, Name, Cell, Num, When, More } from '/components/List.js';
import { Action } from '/components/Action.js';
import { Mark, Marks } from '/components/Mark.js';
import { Figure, Tinted } from '/components/Figure.js';
import { Box, SettingBox } from '/components/Box.js';
import { Note } from '/components/Note.js';
import { Tabs } from '/components/Tabs.js';
import { TextField } from '/components/TextField.js';
import { CardGrid } from '/components/Card.js';
import { Row as Line, Stack } from '/components/Layout.js';
import { scrollToSection } from '/components/Rail.js';

const W = (key, params) => t('dashboard.workPage.' + key, params);

/** The five chips, keyed by the filter ids FILTERS orders and counts() counts. */
const FILTER_LABEL = { all: 'fAll', open: 'fOpen', delivered: 'fDelivered', failed: 'fFailed', expired: 'fExpired' };

/** The status word's tone. The words themselves are the machine's and are never translated. */
const TONE = {
  pending: 'open', accepted: 'open', in_progress: 'open',
  delivered: 'done', failed: 'bad', expired: 'gone',
};

/** Each tone as the Status mark says it: open waits (attention), done is fine, bad is danger. */
const MARK_TONE = { open: 'attention', done: 'fine', bad: 'danger', gone: 'off' };

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
      <${Box} name=${W('emptyTitle')}>
        <${Note}>${W('emptyWhy')}<//>
      <//>`;
  }

  const shown = all ? found : found.slice(0, PAGE);
  const pending = figures.openRows.filter(r => r.status === 'pending' && !r.overdue);
  const working = figures.openRows.filter(r => r.status !== 'pending');

  const held = (list) => W('heldVal', { count: num(list.reduce((n, r) => n + r.held, 0)) });

  const head = ['#', W('colCode'), W('colStatus'), W('colAction'), W('colWho'), { label: W('colCost'), num: true }, W('colDeadline')];

  return html`
    <${Section} first id="adm-work-waiting" num="01" title=${W('waitingQ')}
      doors=${html`<${Action} small soft onClick=${() => scrollToSection('adm-work-acts')}>${W('whatIsDoor')}<//>`}>
      <${Verdict} tone=${figures.overdue ? 'danger' : undefined}
        word=${figures.open === 0
          ? W('waitingNone')
          : figures.open === 1 ? W('waitingOne') : W('waitingWord', { count: figures.open })}
        line=${W('lead')}
        stamp=${html`
          ${W('leadItems', { count: num(figures.total) })}<br />
          ${W('leadHeld', { count: num(figures.held) })}<br />
          ${figures.overdue ? W('leadOverdue', { count: num(figures.overdue) }) : W('leadNoOverdue')}`}>
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
      <//>
    <//>

    <${FigureStrip} wrap items=${[
      { key: 'items', n: num(figures.total), label: W('stripItems'), sub: W('stripItemsSub') },
      { key: 'open', n: num(figures.open), label: W('stripWaiting'), sub: W('stripWaitingSub') },
      { key: 'held', n: num(figures.held), label: W('stripHeld'), sub: W('stripHeldSub') },
      { key: 'over', n: num(figures.overdue), tone: figures.overdue ? 'notice' : undefined, label: W('stripOverdue'), sub: W('stripOverdueSub') },
    ]} />

    <${Section} num="02" title=${W('every')}
      doors=${html`<${Action} small soft onClick=${() => setOldestFirst(v => !v)}>
        ${oldestFirst ? W('orderNewest') : W('orderOldest')}<//>`}>

      <${Line} wrap gap="large" align="end" below="large">
        <${TextField} search label=${W('find')} value=${query} placeholder=${W('findPlaceholder')}
          onInput=${(v) => { setQuery(v); setAll(false); }} />
        <${Tabs} tone="filter" label=${W('find')} value=${filter}
          onSelect=${(id) => { setFilter(id); setAll(false); }}
          items=${FILTERS.map(id => ({ value: id, label: W(FILTER_LABEL[id], { count: num(chips[id]) }) }))} />
      <//>

      <${List} cols="n-id-state-name-who-n-when" head=${head} labels empty=${html`<${Empty} text=${W('none')} />`}>
        ${shown.map((r, i) => {
          const when = deadlineWords(r);
          return html`
            <${ListRow} key=${r.trackingCode || i} rail=${r.overdue ? 'notice' : undefined}>
              <${Num}><${Figure} small n=${String(oldestFirst ? found.length - i : i + 1).padStart(2, '0')} /><//>
              <${Cell} meta clip title=${r.trackingCode}>${r.trackingCode}<//>
              <${Cell}><${Mark} kind="status" tone=${MARK_TONE[TONE[r.status] || 'gone']}>${r.status}<//><//>
              <${Name}>${r.action}<//>
              <${Cell} meta>
                <b title=${r.requester.foreign ? W('elsewhere') : null}>${r.requester.name}</b>
                ${' → '}
                <b title=${r.provider.foreign ? W('elsewhere') : null}>${r.provider.foreign
                  ? html`<${Tinted} tone="notice">${r.provider.name}<//>`
                  : r.provider.name}</b>
              <//>
              <${Num}>${r.held ? html`<${Tinted} tone="warn">${num(r.total)}<//>` : num(r.total)}<//>
              <${When} warn=${when.over} title=${dt(r.createdAt)}>${when.text}<//>
            <//>`;
        })}
      <//>

      ${found.length > PAGE && html`
        <${More} label=${W('showRest')} onMore=${!all ? () => setAll(true) : null}
          note=${W('shown', { shown: num(shown.length), total: num(found.length) })} />`}
    <//>

    <${Section} id="adm-work-acts" num="03" title=${W('actsTitle')}
      doors=${html`<${Action} small soft onClick=${() => switchPage('actions')}>${t('dashboard.actions')}<//>`}>
      <${CardGrid} cols="two">
        <${SettingBox} label=${W('jobLabel')}>
          <${Stack} gap="small">
            <${Marks}><${Mark}>pending<//><span>→</span><${Mark}>accepted<//><span>→</span><${Mark}>in_progress<//><span>→</span><${Mark}>delivered<//><//>
            <span>${W('jobBody')}</span>
            <b>${W('jobRule')}</b>
          <//>
        <//>
        <${SettingBox} label=${W('moneyLabel')} irreversible>
          <${Stack} gap="small">
            <span>${W('moneyBody')}</span>
            <b>${W('moneyRule')}</b>
          <//>
        <//>
      <//>
    <//>`;
}
