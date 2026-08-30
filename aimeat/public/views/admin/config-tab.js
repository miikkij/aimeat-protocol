/**
 * @file config-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard Config tab in the poster face (design canvas "AIMEAT Hallinnan
 *   kolme sivua") — renders the mutable node config schema (GET /v1/admin/config) with per-type
 *   editors and persists changes via PUT /v1/admin/config.
 *
 *   THREE THINGS THIS PAGE HAS TO SOLVE BEYOND SHOWING FIELDS.
 *
 *   Finding one. Nearly three hundred fields in fifty sections. The page carries a SEARCH that
 *   filters by the human name, the raw key and the description, an "only changed" filter that
 *   shows what this node has been tuned away from its defaults (the source every row already
 *   carries), and a sticky left index of the domains and groups in place of the old chip cloud.
 *
 *   Knowing what a field IS. Every field has carried a description since the schema was written,
 *   and the page used to hide it under the mouse as a title tooltip. It is printed under the
 *   name now, translated where a translation exists (dashboard.cfgDesc_*), the schema's English
 *   otherwise.
 *
 *   Knowing you have unsaved work. The sticky pending bar (v1.4.0) stays exactly as it was: on
 *   screen wherever you edit, counting what is unsaved, each change as old → new.
 * @structure
 *   - DOMAINS / domainOf — the grouping behind the left index
 *   - PendingBar — the sticky unsaved-changes bar
 *   - FieldRow — one field: name, key, description, source, editor
 *   - ConfigTab (default)
 * @version-history
 *   v2.1.0 -- 2026-08-31 -- The save controls move into the pinned search row and the old→new
 *     list opens from a word there; the fixed bottom overlay that covered the content is gone.
 *   v2.0.0 -- 2026-08-31 -- The poster face: search over name/key/description, the only-changed
 *     filter, the description visible under the name, the chip-cloud contents replaced by a
 *     sticky left index, sections under ink rules. The pending bar is unchanged by design.
 *   v1.5.0 -- 2026-08-18 -- Sealed settings read as sealed (docs/plans/sealed-config-plan.md).
 *   v1.4.0 -- 2026-08-16 -- A grouped table of contents, and a sticky pending-changes bar that
 *     names each change as old → new.
 *   v1.2.0 -- 2026-05-31 -- Inputs reflect pending[path] (edits no longer snap back).
 *   v1.1.0 -- 2026-05-31 -- Array-of-strings editor (one item per line).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Badge, Empty, ExpandableHelp, ErrorBox } from './shared.js';
import { saveConfig, deleteConfig } from '/js/services/admin.js';

// Map config source to Badge type for visual distinction
const SOURCE_BADGE = {
  database: 'healthy',
  env: 'info',
  file: 'private',
  consul: 'watch',
  default: 'idle',
  // Set by whoever runs this node. Deliberately not one of the four provenance colours: for a
  // sealed row, where the value came from is not the answer the operator is after.
  sealed: 'critical',
};

/**
 * Sections of sections. A dot-path's first segment is its section (`ai`, `rate_limits`, `email`);
 * this puts those fifty sections under eight headings so the left index can be read at a glance.
 * A section nobody has classified lands in `other` and still appears — a missing entry here must
 * never make a field unreachable.
 */
const DOMAINS = [
  { id: 'ai', groups: ['ai', 'agent', 'tasks', 'mcp', 'cortex', 'calibrator'] },
  { id: 'money', groups: ['morsel_policy', 'commerce', 'marketplace', 'work', 'economy', 'portfolio'] },
  { id: 'identity', groups: ['auth', 'totp', 'eudiw', 'consent', 'security', 'moderation'] },
  { id: 'node', groups: ['node', 'storage', 'database_url', 'sqlite_path', 'admin_password', 'setup', 'consul', 'stats', 'metrics'] },
  { id: 'limits', groups: ['quotas', 'rate_limits', 'extensions', 'realtime'] },
  { id: 'federation', groups: ['federation', 'sync', 'personal_nodes', 'genesis', 'tunnel', 'msm'] },
  { id: 'integrations', groups: ['email', 'push', 'indexing', 'cors', 'site', 'portal', 'cookie_consent', 'connections'] },
];

function domainOf(group) {
  for (const d of DOMAINS) if (d.groups.includes(group)) return d.id;
  return 'other';
}

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/** Translate a config path — try dashboard.cfg_<dotpath>, else the raw path's last segment. */
function label(path) {
  const key = 'dashboard.cfg_' + path.replace(/\./g, '_');
  const val = t(key);
  return val !== key ? val : path;
}
/** The description a person reads: translated where a translation exists, the schema's English otherwise. */
function descOf(path, entry) {
  return tr('dashboard.cfgDesc_' + path.replace(/\./g, '_'), entry.description || '');
}
function groupLabel(g) {
  const key = 'dashboard.cfgGroup_' + g;
  const val = t(key);
  return val !== key ? val : g.charAt(0).toUpperCase() + g.slice(1).replace(/_/g, ' ');
}
function domainLabel(id) {
  return tr('dashboard.cfgDomain_' + id, id.charAt(0).toUpperCase() + id.slice(1));
}
/** Where the value came from, as a person reads it: default, changed on this node, environment… */
function sourceWord(src) {
  return tr('dashboard.cfgSrc_' + src, src);
}

/** A value as a person reads it in the change list: a secret is never one of them (see the API). */
function shown(v) {
  if (v === '' || v === null || v === undefined) return tr('dashboard.cfgEmpty', '(empty)');
  if (typeof v === 'boolean') return v ? t('dashboard.enabled') : t('dashboard.disabled');
  const s = String(v);
  return s.length > 60 ? s.slice(0, 57) + '…' : s;
}

/**
 * The old→new list of unsaved changes. It opens from a word in the pinned row rather than
 * covering the page: the controls that matter (the count, Save, Cancel) are always in sight up
 * there, and the details arrive only when asked for.
 */
function PendingList({ paths, pending, schema }) {
  return html`
    <div class="adm-cfg-listbox" role="status">
      <ul>
        ${paths.map(p => html`
          <li key=${p}>
            <code>${escHtml(p)}</code>
            <span class="adm-cfg-pending-was">${escHtml(shown(schema[p] && schema[p].value))}</span>
            <span aria-hidden="true">→</span>
            <strong>${escHtml(shown(pending[p]))}</strong>
          </li>
        `)}
      </ul>
    </div>
  `;
}

/** One field: its name, its key, what it does, where its value came from, and the editor. */
function FieldRow({ path: p, entry: e, editable, pending, onChange, onReset }) {
  const edited = p in pending;
  const val = edited ? pending[p] : e.value;
  const desc = descOf(p, e);
  return html`
    <div class=${'adm-cfg-frow' + (edited ? ' adm-cfg-row-edited' : '')} id=${'cfgf-' + p.replace(/\./g, '-')}>
      <span class="adm-cfg-fname">
        ${label(p)}
        ${edited && html` <span class="adm-cfg-edited-dot" title=${tr('dashboard.cfgEdited', 'Edited, not saved')}>●</span>`}
        <code>${p}</code>
        ${desc && html`<span class="adm-cfg-fdesc">${desc}</span>`}
      </span>
      <span class="adm-cfg-fsrc">${e.source && html`<span class=${'adm-badge adm-badge-' + (SOURCE_BADGE[e.source] || 'idle')}>${sourceWord(e.source)}</span>`}</span>
      <span class="adm-cfg-fedit">
        ${!e.mutable
          ? (typeof e.value === 'boolean'
            ? html`${e.value ? html`<${Badge} type="healthy" /> ${t('dashboard.yesLabel')}` : html`<${Badge} type="critical" /> ${t('dashboard.noLabel')}`}${e.sealed ? html` <span class="adm-text-dim adm-text-xs">${t('dashboard.cfgSealed')}</span>` : null}`
            : html`<code>${escHtml(String(e.value))}</code> <span class="adm-text-dim adm-text-xs">${e.sealed ? t('dashboard.cfgSealed') : t('dashboard.readOnly')}</span>`)
          : e.type === 'boolean'
            ? html`<label class="adm-cfg-check"><input type="checkbox" checked=${val} onChange=${ev => onChange(p, ev.target.checked)} disabled=${!editable} /> ${val ? t('dashboard.enabled') : t('dashboard.disabled')}</label>`
            : e.type === 'integer'
              ? html`<input type="number" value=${val} onInput=${ev => onChange(p, parseInt(ev.target.value))} disabled=${!editable} />${e.range ? html`<span class="adm-cfg-frange">${escHtml(e.range)}</span>` : null}`
              : e.type === 'float'
                ? html`<input type="number" step="0.01" value=${val} onInput=${ev => onChange(p, parseFloat(ev.target.value))} disabled=${!editable} />${e.range ? html`<span class="adm-cfg-frange">${escHtml(e.range)}</span>` : null}`
                : e.type === 'string'
                  ? html`<input type="text" value=${val || ''} onInput=${ev => onChange(p, ev.target.value)} disabled=${!editable} />`
                  : e.type === 'object'
                    ? (Array.isArray(e.value)
                        ? html`<textarea class="adm-config-array-edit" rows="4" disabled=${!editable}
                                  value=${pending[p] !== undefined ? pending[p] : e.value.join('\n')}
                                  onInput=${ev => onChange(p, ev.target.value)}
                                  placeholder=${t('dashboard.cfgOnePerLine')}></textarea>
                               <div class="adm-text-dim adm-text-xs">${t('dashboard.cfgOnePerLine')}</div>`
                        : html`<code class="adm-text-xs">${escHtml(JSON.stringify(e.value)).substring(0, 100)}...</code>`)
                    : html`<code>${escHtml(String(e.value))}</code>`
        }
      </span>
      <span>${e.canReset && editable && e.mutable ? html`<button class="adm-btn-sm" onClick=${() => onReset(p)}>${t('dashboard.cfgReset')}</button>` : null}</span>
    </div>
  `;
}

export default function ConfigTab({ data, reload }) {
  // Hooks must run unconditionally before any early return (Rules of Hooks).
  const [pending, setPending] = useState({});
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [showChanges, setShowChanges] = useState(false);

  const s = data.configSchema;
  if (!s || !s.schema) return html`<${Empty} text=${t('dashboard.configNotAvailable')} />`;

  const schema = s.schema;
  const editable = s.editable !== false;

  // "Changed" is what the source already says: anything not sitting on its default.
  const isChanged = (e) => !!e.source && e.source !== 'default';
  const changedTotal = Object.values(schema).filter(isChanged).length;

  // The search reads the three things a person might remember: the human name, the raw key,
  // and the description (translated or not). Everything is already in the browser.
  const needle = q.trim().toLowerCase();
  const matches = (path, entry) => {
    if (onlyChanged && !isChanged(entry)) return false;
    if (!needle) return true;
    return path.toLowerCase().includes(needle)
      || label(path).toLowerCase().includes(needle)
      || descOf(path, entry).toLowerCase().includes(needle)
      || (entry.description || '').toLowerCase().includes(needle);
  };

  // Group by first path segment, then those groups by domain for the left index.
  const groups = {};
  for (const path in schema) {
    if (!matches(path, schema[path])) continue;
    const group = path.split('.')[0];
    if (!groups[group]) groups[group] = [];
    groups[group].push({ path, entry: schema[path] });
  }
  const groupEntries = Object.entries(groups);
  const byDomain = new Map();
  for (const entry of groupEntries) {
    const d = domainOf(entry[0]);
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d).push(entry);
  }
  const domainOrder = [...DOMAINS.map(d => d.id), 'other'].filter(d => byDomain.has(d));

  function jumpTo(group) {
    const el = document.getElementById('cfg-' + group);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function onChange(path, value) {
    setPending(prev => ({ ...prev, [path]: value }));
  }

  async function save() {
    const changes = Object.entries(pending).map(([path, value]) => {
      const entry = schema[path];
      // Array-of-strings fields (e.g. agent.system_principles) are edited as
      // one item per line; split the raw text back into an array on save so it
      // matches what the API validator expects.
      if (entry && entry.type === 'object' && Array.isArray(entry.value) && typeof value === 'string') {
        return { path, value: value.split('\n').map(l => l.trim()).filter(Boolean) };
      }
      return { path, value };
    });
    if (!changes.length) return;
    setSaving(true);
    try {
      const r = await saveConfig(changes);
      setResult({ ok: true, msg: t('dashboard.savedChanges').replace('{count}', r.data.applied.length) });
      setPending({});
      reload();
    } catch (err) {
      setResult({ ok: false, msg: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function resetConfig(path) {
    try {
      await deleteConfig(path);
      setResult({ ok: true, msg: t('dashboard.cfgResetDone').replace('{path}', path) });
      reload();
    } catch (err) {
      setResult({ ok: false, msg: err.message });
    }
  }

  function cancel() {
    setPending({});
    setResult(null);
  }

  const pendingKeys = Object.keys(pending);
  const editedIn = (items) => items.filter(({ path }) => path in pending).length;

  return html`
    <div class="og">
      <div class="adm-cfg-tools">
        <label class="adm-cfg-searchwrap">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-4-4"></path></svg>
          <input type="search" value=${q} placeholder=${tr('dashboard.cfgSearch', 'Search settings…')} onInput=${ev => setQ(ev.target.value)} />
        </label>
        <button type="button" class=${'adm-cfg-filter' + (onlyChanged ? ' on' : '')} onClick=${() => setOnlyChanged(true)}>
          ${tr('dashboard.cfgOnlyChanged', 'Only changed ({n})').replace('{n}', changedTotal)}
        </button>
        <button type="button" class=${'adm-cfg-filter' + (onlyChanged ? '' : ' on')} onClick=${() => setOnlyChanged(false)}>
          ${tr('dashboard.cfgAll', 'All')}
        </button>
        ${editable && pendingKeys.length > 0 && html`
          <span class="adm-cfg-pending-mini" role="status">
            <strong>${tr('dashboard.cfgUnsaved', '{n} unsaved change(s)').replace('{n}', pendingKeys.length)}</strong>
            <button class="adm-btn" onClick=${save} disabled=${saving}>${t('dashboard.saveChanges')}</button>
            <button class="adm-btn-action" onClick=${cancel} disabled=${saving}>${t('dashboard.cancelLabel')}</button>
            <button type="button" class="adm-cfg-filter" onClick=${() => setShowChanges(!showChanges)}>
              ${showChanges ? tr('dashboard.cfgHideChanges', 'Hide the changes') : tr('dashboard.cfgShowChanges', 'What changes?')}
            </button>
          </span>`}
      </div>
      ${editable && showChanges && pendingKeys.length > 0 && html`<${PendingList} paths=${pendingKeys} pending=${pending} schema=${schema} />`}

      <!-- Read-only banner for in-memory storage -->
      ${!editable && html`
        <div class="adm-config-readonly-banner">
          <p>${t('dashboard.cfgReadOnlyBanner')}</p>
          <${ExpandableHelp} title=${t('dashboard.cfgReadOnlyHelpTitle')}>
            <p>${t('dashboard.cfgReadOnlyHelpDetail')}</p>
          </${ExpandableHelp}>
        </div>
      `}

      ${s.sealed && s.sealed.length > 0 && html`
        <div class="adm-config-readonly-banner">
          <p>${t('dashboard.cfgSealedBanner')}</p>
        </div>
      `}

      ${result && (result.ok
        ? html`<div class="adm-config-result-ok adm-mb-md adm-text-base">${escHtml(result.msg)}</div>`
        : html`<div class="adm-mb-md"><${ErrorBox} message=${result.msg} /></div>`)}

      ${domainOrder.length === 0 && html`<div class="adm-cfg-noresult">${tr('dashboard.cfgNoMatches', 'No setting matches.')}</div>`}

      ${domainOrder.length > 0 && html`
      <div class="adm-cfg-body">
        <nav class="adm-cfg-rail" aria-label=${tr('dashboard.cfgToc', 'Sections')}>
          ${domainOrder.map(domain => html`
            <div key=${domain}>
              <div class="d">${domainLabel(domain)}</div>
              ${byDomain.get(domain).map(([g, items]) => html`
                <button type="button" class="g" key=${g} onClick=${() => jumpTo(g)}>
                  <span>${groupLabel(g)}${editedIn(items) > 0 ? html` <span class="adm-cfg-edited-dot">●</span>` : null}</span>
                  <em>${items.length}</em>
                </button>`)}
            </div>`)}
        </nav>
        <div>
          ${domainOrder.map(domain => html`
            <div class="adm-cfg-domain" key=${domain}>
              <h3 class="adm-cfg-domain-head2">${domainLabel(domain)}</h3>
              ${byDomain.get(domain).map(([g, items]) => {
                const helpKey = 'dashboard.cfgHelp_' + g;
                const helpText = t(helpKey);
                const hasHelp = helpText !== helpKey;
                const editedHere = editedIn(items);
                const changedHere = items.filter(({ entry }) => isChanged(entry)).length;
                return html`
                <section class="adm-cfg-sec" id=${'cfg-' + g} key=${g}>
                  <div class="adm-cfg-sec-h">
                    <h2>${groupLabel(g)}</h2>
                    <small>${tr('dashboard.cfgSecCount', '{n} settings').replace('{n}', items.length)}${changedHere ? ' · ' + tr('dashboard.cfgSecChanged', '{n} changed').replace('{n}', changedHere) : ''}${editedHere > 0 ? html` <span class="adm-cfg-edited-dot">● ${editedHere}</span>` : ''}</small>
                  </div>
                  ${hasHelp && html`<${ExpandableHelp} title=${t('dashboard.cfgHelpTitle')}><p>${helpText}</p></${ExpandableHelp}>`}
                  <div class=${!editable ? 'adm-config-readonly' : ''}>
                    ${items.map(({ path: p, entry: e }) => html`
                      <${FieldRow} key=${p} path=${p} entry=${e} editable=${editable}
                        pending=${pending} onChange=${onChange} onReset=${resetConfig} />
                    `)}
                  </div>
                </section>
              `})}
            </div>
          `)}
        </div>
      </div>`}
    </div>
  `;
}
