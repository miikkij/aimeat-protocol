/**
 * @file public/views/admin/extensions-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin Extensions page in the poster face (design canvas "AIMEAT Admin Extensions").
 *   The tab was called Services; an extension is what it lists, so that is what it is called now.
 *   Four numbered sections: what the installed extensions add and how much of it anything uses, the
 *   list behind a search and five filters, the extensions the release carries, and the form for
 *   writing a new one.
 *
 *   What changed against the list this replaces: every row now says what CALLS it. The list read
 *   has carried used_by since the dependency map was written and only the MCP surface showed it, so
 *   Uninstall was a guess. The HEALTHY badge is gone: nothing measures health, and the badge was
 *   the active flag wearing a word that promises monitoring this instance does not do.
 *
 * @structure
 *   - ExtensionsTab({ data, reload }) — the sections and the derived counts
 *   - RightNow: section 01, the six readings and the numeral strip
 *   - Section 02 in the tab: the search, the filters, the rows and the opened record
 *   - Sections 03 and 04 are in extensions-tab.add.js, the record in extensions-tab.record.js
 *
 * @version-history
 *   v3.0.0 — 2026-09-27 — Every part is a library component that gets data (admin page group G7):
 *     the sections are Section, the status and its six rows the Verdict with its Readings, the strip
 *     the FigureStrip, the filters the filter Tabs, the list the List with its Panel, the foot More.
 *     The page writes no class and loads no sheet of its own (admin-extensions.css is gone).
 *   v2.1.0 — 2026-09-13 — Compose existing section headings from shared poster B1.
 *   v2.0.0 — 2026-09-12 — The poster face, the name Extensions, and the three numbers an operator
 *     could not see: what calls each extension, which run on a clock, and which do neither.
 *   v1.2.0 — 2026-07-13 — Split sub-components into siblings for max-file-lines.
 */
import { h, Fragment } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, shortDate, Empty, Badge, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { Section } from '/components/Section.js';
import { Verdict, Readings } from '/components/Readings.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { List, Row, Name, Cell, Num, When, Doors, More } from '/components/List.js';
import { Tabs } from '/components/Tabs.js';
import { TextField } from '/components/TextField.js';
import { Action } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Tinted } from '/components/Figure.js';
import { Row as Line } from '/components/Layout.js';
import { uninstallExtension } from '/js/services/admin.js';
import ExtensionRecord from './extensions-tab.record.js';
import { Bundled, Scaffold } from './extensions-tab.add.js';

const X = (key, params) => t('admin.ext.' + key, params);

/** How many rows the list shows before the door adds more. */
const PAGE = 40;

/** A schedule whose cron starts with @ is a hook (at install, at activation), not a clock. */
function onAClock(ext) {
  return (ext.schedules || []).some(s => s.cron && !String(s.cron).startsWith('@'));
}
function callerCount(ext) {
  return (ext.used_by?.apps || 0) + (ext.used_by?.cortexes || 0);
}
/** Called by nothing and woken by nothing: the only set that is safe to read as removable. */
function isIdle(ext) {
  return callerCount(ext) === 0 && !onAClock(ext);
}

function countAll(list) {
  let active = 0, called = 0, clock = 0, idle = 0, actions = 0, instances = 0, supports = 0;
  const each = [];
  for (const e of list) {
    if (e.status === 'active') active++;
    if (callerCount(e) > 0) called++;
    if (onAClock(e)) clock++;
    if (isIdle(e)) idle++;
    const n = e.actionCount ?? (e.actions || []).length;
    actions += n;
    each.push(n);
    instances += e.instanceCount || e.instance_count || 0;
    if (e.instances) supports++;
  }
  // The median, not the mean: one extension with forty actions would make the average say that a
  // typical extension is large, and on this instance the largest has ten times the smallest.
  each.sort((a, b) => a - b);
  const mid = each.length ? (each.length % 2
    ? each[(each.length - 1) / 2]
    : Math.round((each[each.length / 2 - 1] + each[each.length / 2]) / 2)) : 0;
  return { total: list.length, active, called, clock, idle, actions, instances, supports, median: mid };
}

/** Section 01: what the installed extensions add, and how much of it anything asks for. */
function RightNow({ c, oldestIdle }) {
  const badge = (type, n) => html`<${Badge} type=${type} label=${num(n)} />`;
  return html`
    <${Section} first num="01" title=${X('now.title')}>
      <${Verdict} word=${X('now.word', { n: num(c.active) })}
        line=${X('now.line', { actions: num(c.actions), idle: num(c.idle) })}
        stamp=${X('now.log', { total: num(c.total), off: num(c.total - c.active) })}>
        <${Readings} rows=${[
          { key: 'actions', name: X('now.actions'), why: X('now.actionsWhy'), mark: badge('healthy', c.actions), value: X('now.actionsVal', { n: num(c.median) }) },
          { key: 'called', name: X('now.called'), why: X('now.calledWhy'), mark: badge('healthy', c.called), value: X('now.ofTotal', { total: num(c.total) }) },
          { key: 'clock', name: X('now.clock'), why: X('now.clockWhy'), mark: badge(c.clock ? 'healthy' : 'muted', c.clock), value: X('now.clockVal') },
          { key: 'idle', name: X('now.idle'), why: X('now.idleWhy'), mark: badge(c.idle ? 'warning' : 'muted', c.idle), value: oldestIdle ? X('now.idleVal', { when: shortDate(oldestIdle) }) : '' },
          { key: 'off', name: X('now.off'), why: X('now.offWhy'), mark: badge(c.total - c.active ? 'warning' : 'muted', c.total - c.active), value: X('now.ofTotal', { total: num(c.total) }) },
          { key: 'instances', name: X('now.instances'), why: X('now.instancesWhy'), mark: badge('muted', c.instances), value: X('now.instancesVal', { n: num(c.supports) }), last: true },
        ]} />
      <//>
      <${FigureStrip} wrap items=${[
        { key: 'installed', n: num(c.total), label: X('strip.installed'), sub: X('strip.installedSub', { n: num(c.active) }) },
        { key: 'actions', n: num(c.actions), label: X('strip.actions'), sub: X('strip.actionsSub') },
        { key: 'clock', n: num(c.clock), label: X('strip.clock'), sub: X('strip.clockSub') },
        { key: 'idle', n: num(c.idle), tone: c.idle ? 'notice' : undefined, label: X('strip.idle'), sub: X('strip.idleSub') },
      ]} />
    <//>`;
}

/** Who calls an extension: each caller a way to narrow the list to it, or the clock, or nobody. */
function callersCell(e, users, type) {
  if (users.length > 0) {
    return html`<${Cell}>${users.map((n, i) => html`${i > 0 ? ', ' : ''}<${Action} tone="link" key=${n} onClick=${() => type(n)}>${n}<//>`)}<//>`;
  }
  if (onAClock(e)) return html`<${Cell} meta>${X('list.onlyClock')}<//>`;
  return html`<${Cell} meta><${Tinted} tone="notice">${X('list.nobody')}<//><//>`;
}

export default function ExtensionsTab({ data, reload }) {
  const [toast, showErr, , clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState(null);

  const uninstall = useCallback((ext) => {
    const users = [...(ext.used_by?.app_names || []), ...(ext.used_by?.cortex_names || [])];
    const ask = users.length
      ? X('uninstallAskUsed', { name: ext.name, list: users.join(', ') })
      : X('uninstallAsk', { name: ext.name });
    confirm(ask, async () => {
      try { await uninstallExtension(ext.name); setOpen(null); reload(); } catch (e) { showErr(e.message); }
    }, { danger: true });
  }, [confirm, reload, showErr]);

  const pick = useCallback((next) => { setFilter(next); setLimit(PAGE); }, []);
  const type = useCallback((next) => { setQuery(next); setLimit(PAGE); }, []);

  const list = data.extensions?.extensions || [];
  if (!list.length) return html`<${Empty} text=${X('none')} />`;

  const c = countAll(list);
  const idleInstalls = list.filter(isIdle).map(e => e.installedAt).filter(Boolean).sort();
  const q = query.trim().toLowerCase();
  const rows = list
    .filter(e => {
      if (filter === 'called') return callerCount(e) > 0;
      if (filter === 'clock') return onAClock(e);
      if (filter === 'idle') return isIdle(e);
      if (filter === 'off') return e.status !== 'active';
      return true;
    })
    .filter(e => !q || [e.name, e.description, e.author, ...(e.used_by?.app_names || []), ...(e.used_by?.cortex_names || [])]
      .some(v => String(v || '').toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const shown = rows.slice(0, limit);
  const more = rows.length > shown.length;

  return html`
    <${Fragment}>
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      <${RightNow} c=${c} oldestIdle=${idleInstalls[0]} />

      <${Section} num="02" title=${X('list.title')} doors=${html`<${Note} kind="meta" inline>${X('list.sorted')}<//>`}>
        <${Line} wrap gap="section" align="end" below="medium">
          <${TextField} search id="adm-ex-q" size="medium" label=${X('list.find')} value=${query}
            placeholder=${X('list.findPlaceholder')} onInput=${type} />
          <${Tabs} tone="filter" label=${X('list.title')} value=${filter} onSelect=${pick} items=${[
            { value: 'all', label: X('chip.all'), count: num(c.total) },
            { value: 'called', label: X('chip.called'), count: num(c.called) },
            { value: 'clock', label: X('chip.clock'), count: num(c.clock) },
            { value: 'idle', label: X('chip.idle'), count: num(c.idle), attention: true },
            { value: 'off', label: X('chip.off'), count: num(c.total - c.active) },
          ]} />
        <//>

        <${List} cols="name-desc-count-when-doors" empty=${X('list.nothing')}
          head=${[X('col.extension'), X('col.calledBy'), { label: X('col.actions'), num: true }, X('col.installed'), '']}>
          ${shown.map(e => {
            const isOpen = open === e.name;
            const users = [...(e.used_by?.app_names || []), ...(e.used_by?.cortex_names || [])];
            const toggle = () => setOpen(isOpen ? null : e.name);
            return html`
              <${Row} key=${e.name} open=${isOpen}>
                <${Name} onOpen=${toggle} attention=${isOpen} desc=${e.description || X('noDescription')}
                  after=${e.status !== 'active' ? html` <${Mark} tone="coral">${X('switchedOff')}<//>` : null}>${e.name}<//>
                ${callersCell(e, users, type)}
                <${Num}>${num(e.actionCount ?? (e.actions || []).length)}<//>
                <${When}>${shortDate(e.installedAt)}<//>
                <${Doors}><${Action} small row soft onClick=${toggle}>${isOpen ? X('close') : X('open')}<//><//>
                ${isOpen ? html`<${ExtensionRecord} ext=${e} onClose=${() => setOpen(null)}
                  onUninstall=${uninstall} onReload=${reload} />` : null}
              <//>`;
          })}
        <//>

        <${More} label=${X('list.more', { n: num(Math.min(PAGE, rows.length - shown.length)) })}
          onMore=${more ? () => setLimit(l => l + PAGE) : null}
          note=${X('list.shown', { shown: num(shown.length), total: num(rows.length) }) + (rows.length !== c.total ? X('list.ofAll', { total: num(c.total) }) : '')} />
        <${Note}>${X('list.note')}<//>
      <//>

      <${Bundled} installedNames=${new Set(list.map(e => e.name))} onReload=${reload} />
      <${Scaffold} onReload=${reload} />
      <${ConfirmUI} />
    <//>`;
}
