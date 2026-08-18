/**
 * @file config-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard Config tab — renders the mutable node config
 *   schema (GET /v1/admin/config) with per-type editors and persists changes
 *   via PUT /v1/admin/config.
 *
 *   TWO THINGS THIS PAGE HAS TO SOLVE BEYOND SHOWING FIELDS.
 *
 *   Finding one. There are over two hundred fields in forty-odd sections, so the page is longer
 *   than any screen and the browser's own find is the only navigation it had. The contents block at
 *   the top is grouped by domain rather than listing forty section names flat, because a flat list
 *   of forty is the same problem one scroll higher.
 *
 *   Knowing you have unsaved work. Editing a field did nothing until you scrolled back to the top
 *   and pressed Save, and the banner that said so was itself at the top — off screen exactly when
 *   it mattered. A person who edited three fields and navigated away lost all three and had no
 *   reason to suspect it. The pending bar is STICKY now, so it is on screen wherever you are
 *   editing, it counts what is unsaved, it lists each change as `old → new`, and every edited row
 *   is marked so you can find them again. Nothing about the save itself changed: the fix is that
 *   the page stops hiding the one control that commits your work.
 * @structure
 *   - DOMAINS / domainOf — the section-of-sections grouping behind the contents block
 *   - Toc — the contents block
 *   - PendingBar — the sticky unsaved-changes bar
 *   - FieldRow — one field's label, source badge and editor
 *   - ConfigTab (default)
 * @version-history
 *   v1.4.0 -- 2026-08-16 -- A grouped table of contents, and a sticky pending-changes bar that
 *     names each change as old → new. Both for the same reason: the page had grown past the point
 *     where "it is at the top" is an answer.
 *   v1.3.0 -- 2026-06-02 -- Admin design unification: inline error <div>
 *     replaced with shared <ErrorBox>; success message moved to the
 *     adm-config-result-ok class (no inline color/background styles).
 *   v1.2.0 -- 2026-05-31 -- Fix: inputs were bound to the saved value, not the
 *     pending edit, so toggling a checkbox / typing snapped straight back on
 *     re-render (looked un-editable). All inputs now reflect pending[path].
 *   v1.1.0 -- 2026-05-31 -- Add an editor for array-of-strings config fields
 *     (e.g. agent.system_principles): one item per line in a textarea, split
 *     back to an array on save. Previously object/array fields were read-only.
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
};

/**
 * Sections of sections. A dot-path's first segment is its section (`ai`, `rate_limits`, `email`);
 * this puts those forty sections under eight headings so the contents block can be read at a
 * glance. A section nobody has classified lands in `other` and still appears — a missing entry
 * here must never make a field unreachable.
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

/** Translate a config path — try dashboard.cfg_<dotpath>, else the raw path. */
function label(path) {
  const key = 'dashboard.cfg_' + path.replace(/\./g, '_');
  const val = t(key);
  return val !== key ? val : path;
}
function groupLabel(g) {
  const key = 'dashboard.cfgGroup_' + g;
  const val = t(key);
  return val !== key ? val : g.charAt(0).toUpperCase() + g.slice(1).replace(/_/g, ' ');
}
function domainLabel(id) {
  return tr('dashboard.cfgDomain_' + id, id.charAt(0).toUpperCase() + id.slice(1));
}

/** A value as a person reads it in the change list: a secret is never one of them (see the API). */
function shown(v) {
  if (v === '' || v === null || v === undefined) return tr('dashboard.cfgEmpty', '(empty)');
  if (typeof v === 'boolean') return v ? t('dashboard.enabled') : t('dashboard.disabled');
  const s = String(v);
  return s.length > 60 ? s.slice(0, 57) + '…' : s;
}

/** The contents block: jump straight to a section, without reading forty names in a row. */
function Toc({ domains, onJump }) {
  if (domains.length === 0) return null;
  return html`
    <details class="adm-card adm-cfg-toc" open>
      <summary class="adm-cfg-toc-summary">${tr('dashboard.cfgToc', 'Sections')}</summary>
      <div class="adm-cfg-toc-body">
        ${domains.map(([domain, groups]) => html`
          <div class="adm-cfg-toc-domain" key=${domain}>
            <div class="adm-cfg-toc-domain-name">${domainLabel(domain)}</div>
            <div class="adm-cfg-toc-links">
              ${groups.map(([g, items]) => html`
                <button type="button" class="adm-cfg-toc-link" key=${g} onClick=${() => onJump(g)}>
                  ${groupLabel(g)} <span class="adm-cfg-toc-count">${items.length}</span>
                </button>
              `)}
            </div>
          </div>
        `)}
      </div>
    </details>
  `;
}

/**
 * The unsaved-changes bar.
 *
 * Sticky on purpose: this is the answer to "I changed four things and nothing happened". It says
 * how many are pending, what each one would become, and carries the only two buttons that end the
 * state it describes.
 */
function PendingBar({ paths, pending, schema, onSave, onCancel, saving }) {
  if (paths.length === 0) return null;
  return html`
    <div class="adm-config-changes adm-cfg-pending" role="status">
      <div class="adm-cfg-pending-head">
        <strong>${tr('dashboard.cfgUnsaved', '{n} unsaved change(s)').replace('{n}', paths.length)}</strong>
        <span class="adm-cfg-pending-hint">${tr('dashboard.cfgUnsavedHint', 'Nothing is stored until you save.')}</span>
        <span class="adm-cfg-pending-actions">
          <button class="adm-btn-action" onClick=${onSave} disabled=${saving}>${t('dashboard.saveChanges')}</button>
          ${' '}
          <button class="adm-btn-action" onClick=${onCancel} disabled=${saving}>${t('dashboard.cancelLabel')}</button>
        </span>
      </div>
      <ul class="adm-cfg-pending-list">
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

/** One field: what it is, where its value came from, and the editor for its type. */
function FieldRow({ path: p, entry: e, editable, pending, onChange, onReset }) {
  const edited = p in pending;
  const val = edited ? pending[p] : e.value;
  return html`
    <div class=${'adm-hrow' + (edited ? ' adm-cfg-row-edited' : '')} id=${'cfgf-' + p.replace(/\./g, '-')}>
      <span class="adm-hmetric" title=${e.description}>
        ${label(p)}
        ${e.source && html` <span class="adm-badge adm-badge-${SOURCE_BADGE[e.source] || 'idle'}" style="font-size:.6rem;vertical-align:middle">${e.source}</span>`}
        ${edited && html` <span class="adm-cfg-edited-dot" title=${tr('dashboard.cfgEdited', 'Edited, not saved')}>●</span>`}
      </span>
      <span>
        ${!e.mutable
          ? (typeof e.value === 'boolean'
            ? html`${e.value ? html`<${Badge} type="healthy" /> ${t('dashboard.yesLabel')}` : html`<${Badge} type="critical" /> ${t('dashboard.noLabel')}`}`
            : html`<code>${escHtml(String(e.value))}</code> <span class="adm-text-dim adm-text-xs">${t('dashboard.readOnly')}</span>`)
          : e.type === 'boolean'
            ? html`<label style="cursor:pointer"><input type="checkbox" checked=${val} onChange=${ev => onChange(p, ev.target.checked)} disabled=${!editable} /> ${val ? t('dashboard.enabled') : t('dashboard.disabled')}</label>`
            : e.type === 'integer'
              ? html`<input type="number" value=${val} style="width:120px" onInput=${ev => onChange(p, parseInt(ev.target.value))} disabled=${!editable} />${e.range ? html` <span class="adm-text-dim adm-text-xs">${escHtml(e.range)}</span>` : null}`
              : e.type === 'float'
                ? html`<input type="number" step="0.01" value=${val} style="width:120px" onInput=${ev => onChange(p, parseFloat(ev.target.value))} disabled=${!editable} />${e.range ? html` <span class="adm-text-dim adm-text-xs">${escHtml(e.range)}</span>` : null}`
                : e.type === 'string'
                  ? html`<input type="text" value=${val || ''} style="width:250px" onInput=${ev => onChange(p, ev.target.value)} disabled=${!editable} />`
                  : e.type === 'object'
                    ? (Array.isArray(e.value)
                        ? html`<textarea class="adm-config-array-edit" rows="4" disabled=${!editable}
                                  value=${pending[p] !== undefined ? pending[p] : e.value.join('\n')}
                                  onInput=${ev => onChange(p, ev.target.value)}
                                  placeholder=${t('dashboard.cfgOnePerLine')}></textarea>
                               <div class="adm-text-dim adm-text-xs">${t('dashboard.cfgOnePerLine')}</div>`
                        : html`<code style="font-size:.75rem">${escHtml(JSON.stringify(e.value)).substring(0, 100)}...</code>`)
                    : html`<code>${escHtml(String(e.value))}</code>`
        }
        ${e.canReset && editable && html` <button class="adm-btn-sm" onClick=${() => onReset(p)}>${t('dashboard.cfgReset')}</button>`}
      </span>
    </div>
  `;
}

export default function ConfigTab({ data, reload }) {
  // Hooks must run unconditionally before any early return (Rules of Hooks).
  const [pending, setPending] = useState({});
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);

  const s = data.configSchema;
  if (!s || !s.schema) return html`<${Empty} text=${t('dashboard.configNotAvailable')} />`;

  const schema = s.schema;
  const editable = s.editable !== false;

  // Group by first path segment, then those groups by domain for the contents block.
  const groups = {};
  for (const path in schema) {
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
  const tocDomains = domainOrder.map(d => [d, byDomain.get(d)]);

  function jumpTo(group) {
    const el = document.getElementById('cfg-' + group);
    if (!el) return;
    // A collapsed section still has to be reachable: scrolling to a closed <details> lands on a
    // one-line summary and looks like the jump did nothing.
    if (el instanceof HTMLDetailsElement) el.open = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  return html`
    <!-- Read-only banner for in-memory storage -->
    ${!editable && html`
      <div class="adm-config-readonly-banner">
        <p>${t('dashboard.cfgReadOnlyBanner')}</p>
        <${ExpandableHelp} title=${t('dashboard.cfgReadOnlyHelpTitle')}>
          <p>${t('dashboard.cfgReadOnlyHelpDetail')}</p>
        </${ExpandableHelp}>
      </div>
    `}

    ${result && (result.ok
      ? html`<div class="adm-config-result-ok adm-mb-md adm-text-base">${escHtml(result.msg)}</div>`
      : html`<div class="adm-mb-md"><${ErrorBox} message=${result.msg} /></div>`)}

    ${editable && html`<${PendingBar} paths=${pendingKeys} pending=${pending} schema=${schema}
      onSave=${save} onCancel=${cancel} saving=${saving} />`}

    <${Toc} domains=${tocDomains} onJump=${jumpTo} />

    ${domainOrder.map(domain => html`
      <div class="adm-cfg-domain" key=${domain}>
        <h3 class="adm-cfg-domain-head">${domainLabel(domain)}</h3>
        ${byDomain.get(domain).map(([g, items]) => {
          const helpKey = 'dashboard.cfgHelp_' + g;
          const helpText = t(helpKey);
          const hasHelp = helpText !== helpKey;
          const editedHere = items.filter(({ path }) => path in pending).length;
          return html`
          <details class="adm-card adm-mb-sm" id=${'cfg-' + g} key=${g} open>
            <summary style="cursor:pointer;font-weight:600;font-size:.95rem;padding:8px 0">
              ${groupLabel(g)}
              ${editedHere > 0 && html` <span class="adm-cfg-edited-dot">● ${editedHere}</span>`}
            </summary>
            ${hasHelp && html`<${ExpandableHelp} title=${t('dashboard.cfgHelpTitle')}><p>${helpText}</p></${ExpandableHelp}>`}
            <div class=${!editable ? 'adm-config-readonly' : ''} style="padding:8px 0">
              ${items.map(({ path: p, entry: e }) => html`
                <${FieldRow} key=${p} path=${p} entry=${e} editable=${editable}
                  pending=${pending} onChange=${onChange} onReset=${resetConfig} />
              `)}
            </div>
          </details>
        `})}
      </div>
    `)}
  `;
}
