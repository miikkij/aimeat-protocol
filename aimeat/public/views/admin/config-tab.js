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
 *   v3.0.0 -- 2026-09-22 -- Composed from the shared component set: the search row is the shared
 *     toolbar, the index is the shared ink rail, domains and groups are sections, each field is a
 *     list row whose editor is a shared field, and an edited row sits on the sun. The page has no
 *     classes of its own, and the "●" marks (not one of the four glyphs) became a sun chip.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v2.3.0 -- 2026-09-13 -- Compose the configuration index rule from poster.css.
 *   v2.3.0 -- 2026-09-19 -- The `decide` group sits under AI, and SECTION_ACTIONS lets a section carry an
 *     action beside its fields: the decision model's key test is the first.
 *   v2.2.0 -- 2026-09-13 -- Compose domain and group headings with the shared B1 shape.
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
import { Section, Columns, Stack, Rail, ListRow, Toolbar, Field, Action, Chip, Surface, Text, scrollToId } from '/components/poster-parts.js';
import { saveConfig, deleteConfig } from '/js/services/admin.js';
import { DecideKeyTest } from './decide-key-test.js';

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
  { id: 'ai', groups: ['ai', 'decide', 'agent', 'tasks', 'mcp', 'cortex', 'calibrator'] },
  { id: 'money', groups: ['morsel_policy', 'commerce', 'marketplace', 'work', 'economy', 'portfolio'] },
  { id: 'identity', groups: ['auth', 'totp', 'eudiw', 'consent', 'security', 'moderation'] },
  { id: 'node', groups: ['node', 'storage', 'database_url', 'sqlite_path', 'admin_password', 'setup', 'consul', 'stats', 'metrics'] },
  { id: 'limits', groups: ['quotas', 'rate_limits', 'extensions', 'realtime'] },
  { id: 'federation', groups: ['federation', 'sync', 'personal_nodes', 'genesis', 'tunnel', 'msm'] },
  { id: 'integrations', groups: ['email', 'push', 'indexing', 'cors', 'site', 'portal', 'cookie_consent', 'connections'] },
];

/**
 * A section that needs an action of its own beside its fields, rendered under them. The decision
 * model's key is the first: a key an operator cannot test is a key they find out about from users.
 */
const SECTION_ACTIONS = {
  decide: DecideKeyTest,
};

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
  return html`<${Surface} kind="aside" role="status">
    ${paths.map(p => html`<${ListRow} key=${p} density="compact" name=${html`<${Text} kind="mono">${escHtml(p)}<//>`}
      value=${html`<${Text} kind="mono" tone="muted">${escHtml(shown(schema[p] && schema[p].value))}<//> <span aria-hidden="true">→</span> <strong>${escHtml(shown(pending[p]))}</strong>`} />`)}
  <//>`;
}

/** A range such as "1-1000" beside a number field. */
const rangeNote = (e) => (e.range ? html`<${Text} kind="mono" tone="muted">${escHtml(e.range)}<//>` : null);

/** One field: its name, its key, what it does, where its value came from, and the editor. */
function FieldRow({ path: p, entry: e, editable, pending, onChange, onReset }) {
  const edited = p in pending;
  const val = edited ? pending[p] : e.value;
  const desc = descOf(p, e);
  const name = label(p);
  const readOnlyNote = (word) => html`<${Text} kind="caption" tone="muted">${word}<//>`;
  const editor = !e.mutable
    ? (typeof e.value === 'boolean'
      ? html`${e.value ? html`<${Badge} type="healthy" /> <span>${t('dashboard.yesLabel')}</span>` : html`<${Badge} type="critical" /> <span>${t('dashboard.noLabel')}</span>`}${e.sealed ? readOnlyNote(t('dashboard.cfgSealed')) : null}`
      : html`<${Text} kind="mono">${escHtml(String(e.value))}<//> ${readOnlyNote(e.sealed ? t('dashboard.cfgSealed') : t('dashboard.readOnly'))}`)
    : e.type === 'boolean'
      ? html`<${Field} type="checkbox" label=${val ? t('dashboard.enabled') : t('dashboard.disabled')} value=${val} onChange=${ev => onChange(p, ev.target.checked)} disabled=${!editable} />`
      : e.type === 'integer'
        ? html`<${Field} type="number" ariaLabel=${name} width="narrow" value=${val} onInput=${ev => onChange(p, parseInt(ev.target.value))} disabled=${!editable} />${rangeNote(e)}`
        : e.type === 'float'
          ? html`<${Field} type="number" step="0.01" ariaLabel=${name} width="narrow" value=${val} onInput=${ev => onChange(p, parseFloat(ev.target.value))} disabled=${!editable} />${rangeNote(e)}`
          : e.type === 'string'
            ? html`<${Field} ariaLabel=${name} value=${val || ''} onInput=${ev => onChange(p, ev.target.value)} disabled=${!editable} passwordManager=${false} />`
            : e.type === 'object'
              ? (Array.isArray(e.value)
                  ? html`<${Field} type="textarea" ariaLabel=${name} rows=${4} disabled=${!editable}
                      value=${pending[p] !== undefined ? pending[p] : e.value.join('\n')}
                      onInput=${ev => onChange(p, ev.target.value)}
                      placeholder=${t('dashboard.cfgOnePerLine')} hint=${t('dashboard.cfgOnePerLine')} />`
                  : html`<${Text} kind="mono">${escHtml(JSON.stringify(e.value)).substring(0, 100)}...<//>`)
              : html`<${Text} kind="mono">${escHtml(String(e.value))}<//>`;
  return html`<${ListRow} id=${'cfgf-' + p.replace(/\./g, '-')} selected=${edited} density="compact"
    name=${name} nameTitle=${edited ? tr('dashboard.cfgEdited', 'Edited, not saved') : undefined} detail=${p}
    value=${html`<${Stack} direction="horizontal" align="center" density="compact">
      ${e.source && html`<${Badge} type=${SOURCE_BADGE[e.source] || 'idle'} label=${sourceWord(e.source)} />`}${editor}
    <//>`}
    actions=${e.canReset && editable && e.mutable ? html`<${Action} kind="text" onClick=${() => onReset(p)}>${t('dashboard.cfgReset')}<//>` : null}>
    ${desc ? html`<${Text} kind="caption" tone="muted">${desc}<//>` : null}
  <//>`;
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
    scrollToId('cfg-' + group);
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

  const edits = (n) => (n > 0 ? html`<${Chip} tone="sun" title=${tr('dashboard.cfgEdited', 'Edited, not saved')}>${n}<//>` : null);

  // The index: each domain a label, each group a word that brings its section up, with its count.
  const rail = html`<${Rail} kind="index" title=${tr('dashboard.cfgToc', 'Sections')} label=${tr('dashboard.cfgToc', 'Sections')}>
    <${Stack}>${domainOrder.map(domain => html`<${Stack} key=${domain} density="compact">
      <${Text} kind="label">${domainLabel(domain)}<//>
      ${byDomain.get(domain).map(([g, items]) => html`<${Stack} key=${g} direction="wrap" align="between" density="compact">
        <${Action} kind="text" onClick=${() => jumpTo(g)}>${groupLabel(g)}<//>
        <${Stack} direction="horizontal" align="center" density="compact">${edits(editedIn(items))}<${Text} kind="mono">${items.length}<//><//>
      <//>`)}
    <//>`)}<//>
  <//>`;

  return html`<${Stack}>
    <${Toolbar} label=${tr('dashboard.cfgSearch', 'Search settings…')}
      search=${{ ariaLabel: tr('dashboard.cfgSearch', 'Search settings…'), placeholder: tr('dashboard.cfgSearch', 'Search settings…'), value: q, onInput: ev => setQ(ev.target.value) }}
      filters=${[
        { id: 'changed', label: tr('dashboard.cfgOnlyChanged', 'Only changed ({n})').replace('{n}', changedTotal), selected: onlyChanged, onClick: () => setOnlyChanged(true) },
        { id: 'all', label: tr('dashboard.cfgAll', 'All'), selected: !onlyChanged, onClick: () => setOnlyChanged(false) },
      ]}
      actions=${editable && pendingKeys.length > 0 && html`<${Stack} direction="wrap" align="center" role="status">
        <strong>${tr('dashboard.cfgUnsaved', '{n} unsaved change(s)').replace('{n}', pendingKeys.length)}</strong>
        <${Action} kind="primary" onClick=${save} disabled=${saving}>${t('dashboard.saveChanges')}<//>
        <${Action} onClick=${cancel} disabled=${saving}>${t('dashboard.cancelLabel')}<//>
        <${Action} kind="text" expanded=${showChanges} onClick=${() => setShowChanges(!showChanges)}>
          ${showChanges ? tr('dashboard.cfgHideChanges', 'Hide the changes') : tr('dashboard.cfgShowChanges', 'What changes?')}
        <//>
      <//>`} />
    ${editable && showChanges && pendingKeys.length > 0 && html`<${PendingList} paths=${pendingKeys} pending=${pending} schema=${schema} />`}

    ${!editable && html`<${Surface} kind="aside"><${Stack} density="compact">
      <${Text}>${t('dashboard.cfgReadOnlyBanner')}<//>
      <${ExpandableHelp} title=${t('dashboard.cfgReadOnlyHelpTitle')}>
        <${Text}>${t('dashboard.cfgReadOnlyHelpDetail')}<//>
      <//>
    <//><//>`}

    ${s.sealed && s.sealed.length > 0 && html`<${Surface} kind="aside"><${Text}>${t('dashboard.cfgSealedBanner')}<//><//>`}

    ${result && (result.ok
      ? html`<${Surface} kind="aside" tone="success" role="status"><${Text}>${escHtml(result.msg)}<//><//>`
      : html`<${ErrorBox} message=${result.msg} />`)}

    ${domainOrder.length === 0 && html`<${Text} tone="muted">${tr('dashboard.cfgNoMatches', 'No setting matches.')}<//>`}

    ${domainOrder.length > 0 && html`<${Columns} layout="trailing" collapse=${900}>
      ${rail}
      <${Stack}>
        ${domainOrder.map(domain => html`<${Section} key=${domain} title=${domainLabel(domain)} size="small">
          ${byDomain.get(domain).map(([g, items]) => {
            const helpKey = 'dashboard.cfgHelp_' + g;
            const helpText = t(helpKey);
            const hasHelp = helpText !== helpKey;
            const editedHere = editedIn(items);
            const changedHere = items.filter(({ entry }) => isChanged(entry)).length;
            return html`<${Section} id=${'cfg-' + g} key=${g} density="compact" title=${groupLabel(g)}
              count=${tr('dashboard.cfgSecCount', '{n} settings').replace('{n}', items.length) + (changedHere ? ' · ' + tr('dashboard.cfgSecChanged', '{n} changed').replace('{n}', changedHere) : '')}
              actions=${edits(editedHere)}>
              ${hasHelp && html`<${ExpandableHelp} title=${t('dashboard.cfgHelpTitle')}><${Text}>${helpText}<//><//>`}
              <div>
                ${items.map(({ path: p, entry: e }) => html`
                  <${FieldRow} key=${p} path=${p} entry=${e} editable=${editable}
                    pending=${pending} onChange=${onChange} onReset=${resetConfig} />
                `)}
              </div>
              ${SECTION_ACTIONS[g] && html`<${SECTION_ACTIONS[g]} />`}
            <//>`;
          })}
        <//>`)}
      <//>
    <//>`}
  <//>`;
}
