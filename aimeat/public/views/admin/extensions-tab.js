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
 *   - RightNow: section 01, the six rows and the numeral band
 *   - List: section 02, the toolbar, the rows and the opened record
 *   - Sections 03 and 04 are in extensions-tab.add.js, the record in extensions-tab.record.js
 *
 * @version-history
 *   v3.0.0 -- 2026-09-22 -- Composed from the shared component set: sections, a toolbar with the five
 *     filters, list rows that open the record in place, and the numeral band. The page's own sheet is
 *     gone, so a theme or a part changes here with every other page.
 *   v2.1.0 — 2026-09-13 — Compose existing section headings from shared poster B1.
 *   v2.0.0 — 2026-09-12 — The poster face, the name Extensions, and the three numbers an operator
 *     could not see: what calls each extension, which run on a clock, and which do neither.
 *   v1.2.0 — 2026-07-13 — Split sub-components into siblings for max-file-lines.
 */
import { h } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, shortDate, Empty, Badge, Row, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { Section, Columns, Stack, ListRow, Toolbar, NumeralBand, Action, Text, Chip } from '/components/poster-parts.js';
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
  return html`<${Section} title=${X('now.title')} count="01">
    <${Stack}>
      <${Columns} layout="trailing" collapse=${900}>
        <${Stack} density="compact">
          <${Text} kind="number" size="large">${X('now.word', { n: num(c.active) })}<//>
          <${Text} kind="lead">${X('now.line', { actions: num(c.actions), idle: num(c.idle) })}<//>
          <${Text} kind="mono" tone="muted">${X('now.log', { total: num(c.total), off: num(c.total - c.active) })}<//>
        <//>
        <div>
          <${Row} title=${X('now.actions')} why=${X('now.actionsWhy')}
            chip=${html`<${Badge} type="healthy" label=${num(c.actions)} />`}
            value=${X('now.actionsVal', { n: num(c.median) })} />
          <${Row} title=${X('now.called')} why=${X('now.calledWhy')}
            chip=${html`<${Badge} type="healthy" label=${num(c.called)} />`}
            value=${X('now.ofTotal', { total: num(c.total) })} />
          <${Row} title=${X('now.clock')} why=${X('now.clockWhy')}
            chip=${html`<${Badge} type=${c.clock ? 'healthy' : 'muted'} label=${num(c.clock)} />`}
            value=${X('now.clockVal')} />
          <${Row} title=${X('now.idle')} why=${X('now.idleWhy')}
            chip=${html`<${Badge} type=${c.idle ? 'warning' : 'muted'} label=${num(c.idle)} />`}
            value=${oldestIdle ? X('now.idleVal', { when: shortDate(oldestIdle) }) : ''} />
          <${Row} title=${X('now.off')} why=${X('now.offWhy')}
            chip=${html`<${Badge} type=${c.total - c.active ? 'warning' : 'muted'} label=${num(c.total - c.active)} />`}
            value=${X('now.ofTotal', { total: num(c.total) })} />
          <${Row} title=${X('now.instances')} why=${X('now.instancesWhy')}
            chip=${html`<${Badge} type="muted" label=${num(c.instances)} />`}
            value=${X('now.instancesVal', { n: num(c.supports) })} />
        </div>
      <//>
      <${NumeralBand} tone="plain" items=${[
        { label: X('strip.installed'), value: num(c.total), note: X('strip.installedSub', { n: num(c.active) }) },
        { label: X('strip.actions'), value: num(c.actions), note: X('strip.actionsSub') },
        { label: X('strip.clock'), value: num(c.clock), note: X('strip.clockSub') },
        { label: X('strip.idle'), value: num(c.idle), note: X('strip.idleSub'), tone: c.idle ? 'coral' : undefined },
      ]} />
    <//>
  <//>`;
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

  const filterOf = (id, label, count) => ({ id, label: `${label} ${num(count)}`, selected: filter === id, onClick: () => pick(id) });

  return html`<${Stack}>
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <${RightNow} c=${c} oldestIdle=${idleInstalls[0]} />

    <${Section} title=${X('list.title')} count="02" actions=${html`<${Text} kind="caption" tone="muted">${X('list.sorted')}<//>`}>
      <${Stack}>
        <${Toolbar} label=${X('list.find')}
          search=${{ label: X('list.find'), placeholder: X('list.findPlaceholder'), value: query, onInput: e => type(e.target.value) }}
          filters=${[
            filterOf('all', X('chip.all'), c.total),
            filterOf('called', X('chip.called'), c.called),
            filterOf('clock', X('chip.clock'), c.clock),
            filterOf('idle', X('chip.idle'), c.idle),
            filterOf('off', X('chip.off'), c.total - c.active),
          ]} />

        ${shown.length === 0 && html`<${Text} kind="caption" tone="muted">${X('list.nothing')}<//>`}

        <div>
          ${shown.map(e => {
            const isOpen = open === e.name;
            const users = [...(e.used_by?.app_names || []), ...(e.used_by?.cortex_names || [])];
            const toggle = () => setOpen(isOpen ? null : e.name);
            return html`<${ListRow} key=${e.name} name=${e.name} onOpen=${toggle} open=${isOpen}
              detail=${e.description || X('noDescription')} detailKind="text"
              value=${html`<${Stack} density="compact" align="end">
                ${e.status !== 'active' && html`<${Chip} tone="muted">${X('switchedOff')}<//>`}
                <${Text} kind="mono">${X('actionsCount', { n: num(e.actionCount ?? (e.actions || []).length) })}<//>
                <${Text} kind="caption" tone="muted">${X('col.installed')} ${shortDate(e.installedAt)}<//>
              <//>`}
              actions=${html`<${Action} expanded=${isOpen} onClick=${toggle}>${isOpen ? X('close') : X('open')}<//>`}>
              <${Stack}>
                <${Stack} direction="wrap" align="center" density="compact">
                  <${Text} kind="label">${X('col.calledBy')}<//>
                  ${users.length > 0
                    ? users.map(n => html`<${Action} key=${n} kind="text" onClick=${() => type(n)}>${n}<//>`)
                    : onAClock(e)
                      ? html`<${Text} kind="mono">${X('list.onlyClock')}<//>`
                      : html`<${Text} kind="mono" tone="coral">${X('list.nobody')}<//>`}
                <//>
                ${isOpen && html`<${ExtensionRecord} ext=${e} onClose=${() => setOpen(null)}
                  onUninstall=${uninstall} onReload=${reload} />`}
              <//>
            <//>`;
          })}
        </div>

        <${Stack} direction="horizontal" align="between">
          <${Text} kind="mono" tone="muted">${X('list.shown', { shown: num(shown.length), total: num(rows.length) })}${
            rows.length !== c.total ? X('list.ofAll', { total: num(c.total) }) : ''}<//>
          ${rows.length > shown.length && html`<${Action} onClick=${() => setLimit(l => l + PAGE)}>
            ${X('list.more', { n: num(Math.min(PAGE, rows.length - shown.length)) })}<//>`}
        <//>
        <${Text} kind="caption" tone="muted">${X('list.note')}<//>
      <//>
    <//>

    <${Bundled} installedNames=${new Set(list.map(e => e.name))} onReload=${reload} />
    <${Scaffold} onReload=${reload} />
    <${ConfirmUI} />
  <//>`;
}
