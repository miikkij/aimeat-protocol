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
 *   - RightNow: section 01, the six rows and the numeral strip
 *   - List: section 02, the search, the chips, the rows and the opened record
 *   - Sections 03 and 04 are in extensions-tab.add.js, the record in extensions-tab.record.js
 *
 * @version-history
 *   v2.0.0 — 2026-09-12 — The poster face, the name Extensions, and the three numbers an operator
 *     could not see: what calls each extension, which run on a clock, and which do neither.
 *   v1.2.0 — 2026-07-13 — Split sub-components into siblings for max-file-lines.
 */
import { h } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { num, shortDate, Empty, Badge, Row, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
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
  return html`
    <section class="og-sec og-sec--first">
      <div class="og-sec-h"><h2>${X('now.title')}<small>01</small></h2></div>
      <div class="adm-ov-grid">
        <div>
          <div class="adm-ov-status">${X('now.word', { n: num(c.active) })}</div>
          <p class="adm-alert-line">${X('now.line', { actions: num(c.actions), idle: num(c.idle) })}</p>
          <div class="adm-ov-up">${X('now.log', { total: num(c.total), off: num(c.total - c.active) })}</div>
        </div>
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
          <${Row} title=${X('now.instances')} why=${X('now.instancesWhy')} last=${true}
            chip=${html`<${Badge} type="muted" label=${num(c.instances)} />`}
            value=${X('now.instancesVal', { n: num(c.supports) })} />
        </div>
      </div>
      <div class="og-strip">
        <div><b>${num(c.total)}</b><span>${X('strip.installed')}</span><small>${X('strip.installedSub', { n: num(c.active) })}</small></div>
        <div><b>${num(c.actions)}</b><span>${X('strip.actions')}</span><small>${X('strip.actionsSub')}</small></div>
        <div><b>${num(c.clock)}</b><span>${X('strip.clock')}</span><small>${X('strip.clockSub')}</small></div>
        <div><b class=${c.idle ? 'og-coral-num' : ''}>${num(c.idle)}</b><span>${X('strip.idle')}</span><small>${X('strip.idleSub')}</small></div>
      </div>
    </section>`;
}

export default function ExtensionsTab({ data, reload }) {
  useViewCSS('/css/views/admin-extensions.css');
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

  const chip = (id, label, count, coral) => html`
    <button type="button" class="adm-ex-chip ${filter === id ? 'on' : ''} ${coral ? 'adm-ex-chip--coral' : ''}"
      aria-pressed=${filter === id ? 'true' : 'false'} onClick=${() => pick(id)}>${label}<b>${num(count)}</b></button>`;

  return html`
    <div class="og adm-ex">
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      <${RightNow} c=${c} oldestIdle=${idleInstalls[0]} />

      <section class="og-sec">
        <div class="og-sec-h">
          <h2>${X('list.title')}<small>02</small></h2>
          <div class="og-doors"><span class="og-door og-door--quiet">${X('list.sorted')}</span></div>
        </div>

        <div class="adm-ex-find">
          <div class="og-field">
            <label class="og-label" for="adm-ex-q">${X('list.find')}</label>
            <input id="adm-ex-q" class="og-input" type="search" value=${query}
              placeholder=${X('list.findPlaceholder')} onInput=${e => type(e.target.value)} />
          </div>
          <div class="adm-ex-chips">
            ${chip('all', X('chip.all'), c.total)}
            ${chip('called', X('chip.called'), c.called)}
            ${chip('clock', X('chip.clock'), c.clock)}
            ${chip('idle', X('chip.idle'), c.idle, true)}
            ${chip('off', X('chip.off'), c.total - c.active)}
          </div>
        </div>

        <div class="adm-ex-row adm-ex-row--head">
          <div>${X('col.extension')}</div><div class="adm-ex-uses">${X('col.calledBy')}</div>
          <div class="adm-ex-n">${X('col.actions')}</div><div class="adm-ex-when">${X('col.installed')}</div><div></div>
        </div>

        ${shown.length === 0 && html`<p class="adm-ex-note">${X('list.nothing')}</p>`}

        ${shown.map(e => {
    const isOpen = open === e.name;
    const users = [...(e.used_by?.app_names || []), ...(e.used_by?.cortex_names || [])];
    return html`
      <div class="adm-ex-row ${isOpen ? 'adm-ex-row--open' : ''}">
        <div>
          <button type="button" class="adm-ex-nm ${isOpen ? 'is-open' : ''}"
            onClick=${() => setOpen(isOpen ? null : e.name)}>${e.name}</button>
          ${e.status !== 'active' && html`<span class="adm-ex-mark adm-ex-mark--off">${X('switchedOff')}</span>`}
          <span class="adm-ex-desc">${e.description || X('noDescription')}</span>
        </div>
        <div class="adm-ex-uses">
          ${users.length > 0
    ? users.map((n, i) => html`${i > 0 ? ', ' : ''}<button type="button" onClick=${() => type(n)}>${n}</button>`)
    : onAClock(e)
      ? html`<span class="adm-ex-uses--clock">${X('list.onlyClock')}</span>`
      : html`<span class="adm-ex-uses--none">${X('list.nobody')}</span>`}
        </div>
        <div class="adm-ex-n">${num(e.actionCount ?? (e.actions || []).length)}</div>
        <div class="adm-ex-when">${shortDate(e.installedAt)}</div>
        <div class="adm-ex-go">
          <button type="button" class="og-door og-door--quiet" onClick=${() => setOpen(isOpen ? null : e.name)}>
            ${isOpen ? X('close') : X('open')}
          </button>
        </div>
      </div>
      ${isOpen && html`<${ExtensionRecord} ext=${e} onClose=${() => setOpen(null)}
        onUninstall=${uninstall} onReload=${reload} />`}`;
  })}

        <div class="adm-ex-foot">
          <span>${X('list.shown', { shown: num(shown.length), total: num(rows.length) })}${
  rows.length !== c.total ? X('list.ofAll', { total: num(c.total) }) : ''}</span>
          ${rows.length > shown.length && html`
            <button type="button" class="og-door og-door--quiet" onClick=${() => setLimit(l => l + PAGE)}>
              ${X('list.more', { n: num(Math.min(PAGE, rows.length - shown.length)) })}
            </button>`}
        </div>
        <p class="adm-ex-note">${X('list.note')}</p>
      </section>

      <${Bundled} installedNames=${new Set(list.map(e => e.name))} onReload=${reload} />
      <${Scaffold} onReload=${reload} />
      <${ConfirmUI} />
    </div>`;
}
