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
 *   carries), and a sticky index of the domains and groups in place of the old chip cloud.
 *
 *   Knowing what a field IS. Every field has carried a description since the schema was written,
 *   and the page used to hide it under the mouse as a title tooltip. It is printed under the
 *   name now, translated where a translation exists (dashboard.cfgDesc_*), the schema's English
 *   otherwise.
 *
 *   Knowing you have unsaved work. The pinned row (v2.1.0) stays exactly as it was: on screen
 *   wherever you edit, counting what is unsaved, each change as old → new on request.
 *
 *   The layout (the pinned row, the index, one line per setting, the old → new list) is
 *   components/SettingsIndex.js; this file gives it the schema as data.
 * @structure
 *   - DOMAINS / domainOf — the grouping behind the index
 *   - choiceLabel / shownIn — a fixed value in words
 *   - fieldEditor — one field's editor by its type (a Select when the field has choices)
 *   - ConfigTab (default)
 * @version-history
 *   v3.3.2 -- 2026-10-09 -- The `docsign` section (document signing and signature checks) sits under identity.
 *   v3.3.1 -- 2026-10-08 -- The `visibility` section (AI visibility switches) sits under integrations.
 *   v3.3.0 -- 2026-10-02 -- The question mark that explains a setting: a SettingLine gets `help` ('config.' + path) when the locale has explain.config.<path> (hasExplain), so far the fourteen config.* terms, ai.model_default_embed among them (components/HelpTip.js).
 *   v3.2.0 -- 2026-09-30 -- `?q=` in the address opens the page with that search, so a link names one
 *     setting (the header's new-version notice links to node.update_check).
 *   v3.1.0 -- 2026-09-29 -- A string setting with `choices` (the API names its fixed values) is a Select:
 *     each value in words (dashboard.cfgOpt_<path>_<value>, the raw value otherwise), the raw value
 *     stored; the read-only value and the old → new list use the same words.
 *   v3.0.4 -- 2026-09-29 -- The classification section sits under Identity, after Consent (TARGET-082).
 *   v3.0.3 -- 2026-09-28 -- An unset read-only value or an empty list shows "(empty)", not "null" or an empty box; an object's preview ends in "..." only when it was cut.
 *   v3.0.2 -- 2026-09-28 -- No escHtml() on text preact renders: preact escapes text and attributes
 *     itself, so a setting's value, range, the unsaved-changes list (key, old and new value) or the
 *     save message with a quote or an ampersand showed as &quot; / &amp;.
 *   v3.0.1 -- 2026-09-27 -- Each domain opens with its band across the column again (Section group),
 *     and the index is the rail's light tone, both as main drew them (Jouni).
 *   v3.0.0 -- 2026-09-27 -- Library components only: the page is a SettingsIndex (pinned search and
 *     filters, the index as the contents rail, the old → new list), each field a SettingLine with
 *     its source as a status Mark and its editor a Check, TextField or TextArea, the groups Section,
 *     the banners asides. The page writes no class.
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
import { Badge, Empty, ExpandableHelp, ErrorBox } from './shared.js';
import { saveConfig, deleteConfig } from '/js/services/admin.js';
import { DecideKeyTest } from './decide-key-test.js';
import { SettingsIndex, SettingLine, ChangeList } from '/components/SettingsIndex.js';
import { Section } from '/components/Section.js';
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Code } from '/components/Mark.js';
import { Tinted } from '/components/Figure.js';
import { Tabs } from '/components/Tabs.js';
import { Check } from '/components/Check.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Select } from '/components/Select.js';

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
 * this puts those fifty sections under eight headings so the index can be read at a glance.
 * A section nobody has classified lands in `other` and still appears — a missing entry here must
 * never make a field unreachable.
 */
const DOMAINS = [
  { id: 'ai', groups: ['ai', 'decide', 'agent', 'tasks', 'mcp', 'cortex', 'calibrator'] },
  { id: 'money', groups: ['morsel_policy', 'commerce', 'marketplace', 'work', 'economy', 'portfolio'] },
  { id: 'identity', groups: ['auth', 'totp', 'eudiw', 'docsign', 'consent', 'classification', 'security', 'moderation'] },
  { id: 'node', groups: ['node', 'storage', 'database_url', 'sqlite_path', 'admin_password', 'setup', 'consul', 'stats', 'metrics'] },
  { id: 'limits', groups: ['quotas', 'rate_limits', 'extensions', 'realtime'] },
  { id: 'federation', groups: ['federation', 'sync', 'personal_nodes', 'genesis', 'tunnel', 'msm'] },
  { id: 'integrations', groups: ['email', 'push', 'indexing', 'cors', 'site', 'portal', 'cookie_consent', 'connections', 'visibility'] },
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
/** Whether the locale has an explanation for the setting (explain.config.<path>), so its SettingLine gets the question mark. */
function hasExplain(path) {
  const key = 'explain.config.' + path + '.title';
  return t(key) !== key;
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
/** One of a setting's fixed values as a person reads it: dashboard.cfgOpt_<path>_<value>, the raw value otherwise. */
function choiceLabel(path, value) {
  return tr('dashboard.cfgOpt_' + path.replace(/\./g, '_') + '_' + value, String(value));
}
/** Whether a schema entry is a pick from fixed values (the API's `choices`) rather than free text. */
const hasChoices = (e) => !!e && Array.isArray(e.choices) && e.choices.length > 0;

/** A value as a person reads it in the change list: a secret is never one of them (see the API). */
function shown(v) {
  if (v === '' || v === null || v === undefined) return tr('dashboard.cfgEmpty', '(empty)');
  if (typeof v === 'boolean') return v ? t('dashboard.enabled') : t('dashboard.disabled');
  const s = String(v);
  return s.length > 60 ? s.slice(0, 57) + '…' : s;
}
/** shown(), with a fixed value in its words rather than the raw value the API stores. */
function shownIn(path, e, v) {
  return hasChoices(e) && typeof v === 'string' && v !== '' ? choiceLabel(path, v) : shown(v);
}

/** An object value in one line: the first 100 characters, with "..." only when something was cut. */
function jsonPreview(v) {
  const s = JSON.stringify(v) ?? '';
  return s.length > 100 ? s.substring(0, 100) + '...' : s;
}

/** The mark that a field is edited and not saved. */
const editedMark = (words) => html`<${Tinted} tone="warn">${words}<//>`;

/** One field's editor, by its type; a field the node does not let this page change says why. */
function fieldEditor(p, e, val, editable, pending, onChange) {
  const range = e.range ? html`<${Note} kind="meta" inline mono>${e.range}<//>` : null;
  if (!e.mutable) {
    if (typeof e.value === 'boolean') {
      return html`${e.value ? html`<${Badge} type="healthy" /> ${t('dashboard.yesLabel')}` : html`<${Badge} type="critical" /> ${t('dashboard.noLabel')}`}${e.sealed ? html` <${Note} kind="meta" inline>${t('dashboard.cfgSealed')}<//>` : null}`;
    }
    // An unset value or an empty list reads as the change list's "(empty)", never as the word "null"
    // or an empty box; a list reads as its items.
    const unset = e.value === null || e.value === undefined || e.value === '' || (Array.isArray(e.value) && e.value.length === 0);
    const shownValue = unset ? tr('dashboard.cfgEmpty', '(empty)') : Array.isArray(e.value) ? e.value.join(', ') : shownIn(p, e, String(e.value));
    return html`<${Code}>${shownValue}<//> <${Note} kind="meta" inline>${e.sealed ? t('dashboard.cfgSealed') : t('dashboard.readOnly')}<//>`;
  }
  if (e.type === 'boolean') {
    return html`<${Check} checked=${val} onChange=${(on) => onChange(p, on)} disabled=${!editable}>${val ? t('dashboard.enabled') : t('dashboard.disabled')}<//>`;
  }
  if (e.type === 'integer') {
    return html`<${TextField} type="number" size="short" ariaLabel=${label(p)} value=${val} onInput=${(v) => onChange(p, parseInt(v))} disabled=${!editable} />${range}`;
  }
  if (e.type === 'float') {
    return html`<${TextField} type="number" size="short" step="0.01" ariaLabel=${label(p)} value=${val} onInput=${(v) => onChange(p, parseFloat(v))} disabled=${!editable} />${range}`;
  }
  if (e.type === 'string' && hasChoices(e)) {
    // The pick shows each value in words and stores the raw value. A stored value the list does not
    // name (set before the list existed) stays in the list and picked, so the select never shows the
    // first option as if it were the setting; an unset value shows "(empty)" until a pick.
    const current = val === null || val === undefined ? '' : String(val);
    const values = current && !e.choices.includes(current) ? [...e.choices, current] : e.choices;
    return html`<${Select} fit ariaLabel=${label(p)} value=${current} disabled=${!editable}
      placeholder=${current === '' ? tr('dashboard.cfgEmpty', '(empty)') : undefined} placeholderDisabled
      options=${values.map(v => [v, choiceLabel(p, v)])} onChange=${(v) => onChange(p, v)} />`;
  }
  if (e.type === 'string') {
    return html`<${TextField} size="medium" ariaLabel=${label(p)} value=${val || ''} onInput=${(v) => onChange(p, v)} disabled=${!editable} />`;
  }
  if (e.type === 'object') {
    return Array.isArray(e.value)
      ? html`<${TextArea} code rows=${4} ariaLabel=${label(p)} disabled=${!editable}
          value=${pending[p] !== undefined ? pending[p] : e.value.join('\n')}
          onInput=${(v) => onChange(p, v)}
          placeholder=${t('dashboard.cfgOnePerLine')} />
        <${Note} kind="meta">${t('dashboard.cfgOnePerLine')}<//>`
      : html`<${Code}>${jsonPreview(e.value)}<//>`;
  }
  return html`<${Code}>${String(e.value)}<//>`;
}

export default function ConfigTab({ data, reload }) {
  // Hooks must run unconditionally before any early return (Rules of Hooks).
  const [pending, setPending] = useState({});
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);
  // `?q=` opens the page already searched: a link to one setting (the new-version notice's
  // "Open the setting") lands on that setting rather than on the whole index.
  const [q, setQ] = useState(() => new URLSearchParams(location.search).get('q') || '');
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

  // Group by first path segment, then those groups by domain for the index.
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

  // The pinned row's unsaved status: the count, save, cancel, and the word that opens the list.
  const status = editable && pendingKeys.length > 0 ? html`
    <${Tinted} tone="notice" strong>${tr('dashboard.cfgUnsaved', '{n} unsaved change(s)').replace('{n}', pendingKeys.length)}<//>
    <${Loud} control onClick=${save} disabled=${saving}>${t('dashboard.saveChanges')}<//>
    <${Action} small onClick=${cancel} disabled=${saving}>${t('dashboard.cancelLabel')}<//>
    <${Action} small soft expanded=${showChanges} onClick=${() => setShowChanges(!showChanges)}>
      ${showChanges ? tr('dashboard.cfgHideChanges', 'Hide the changes') : tr('dashboard.cfgShowChanges', 'What changes?')}
    <//>` : null;

  const before = html`
    ${editable && showChanges && pendingKeys.length > 0 && html`<${ChangeList} items=${pendingKeys.map(p => ({
      key: p, code: p, was: shownIn(p, schema[p], schema[p] && schema[p].value), now: shownIn(p, schema[p], pending[p]),
    }))} />`}

    ${!editable && html`
      <${Note} kind="aside" size="small">
        ${t('dashboard.cfgReadOnlyBanner')}
        <${ExpandableHelp} title=${t('dashboard.cfgReadOnlyHelpTitle')}>
          ${t('dashboard.cfgReadOnlyHelpDetail')}
        <//>
      <//>`}

    ${s.sealed && s.sealed.length > 0 && html`<${Note} kind="aside" size="small">${t('dashboard.cfgSealedBanner')}<//>`}

    ${result && (result.ok
      ? html`<${Note} kind="message">${result.msg}<//>`
      : html`<${ErrorBox} message=${result.msg} />`)}`;

  const index = domainOrder.map(domain => ({
    key: domain,
    label: domainLabel(domain),
    items: byDomain.get(domain).map(([g, items]) => ({
      key: g,
      label: html`${groupLabel(g)}${editedIn(items) > 0 ? html` ${editedMark('●')}` : null}`,
      count: items.length,
      onClick: () => jumpTo(g),
    })),
  }));

  return html`
    <${SettingsIndex}
      search=${{ value: q, onInput: setQ, placeholder: tr('dashboard.cfgSearch', 'Search settings…') }}
      filters=${html`<${Tabs} value=${onlyChanged} onSelect=${setOnlyChanged} items=${[
        { value: true, label: tr('dashboard.cfgOnlyChanged', 'Only changed ({n})').replace('{n}', changedTotal) },
        { value: false, label: tr('dashboard.cfgAll', 'All') },
      ]} />`}
      status=${status}
      before=${before}
      index=${index}
      indexLabel=${tr('dashboard.cfgToc', 'Sections')}
      empty=${tr('dashboard.cfgNoMatches', 'No setting matches.')}>
      ${domainOrder.map((domain, di) => html`
        <${Section} group key=${domain} first=${di === 0} title=${domainLabel(domain)}>
          ${byDomain.get(domain).map(([g, items]) => {
            const helpKey = 'dashboard.cfgHelp_' + g;
            const helpText = t(helpKey);
            const hasHelp = helpText !== helpKey;
            const editedHere = editedIn(items);
            const changedHere = items.filter(({ entry }) => isChanged(entry)).length;
            const SectionAction = SECTION_ACTIONS[g];
            return html`
              <${Section} key=${g} id=${'cfg-' + g} title=${groupLabel(g)}
                count=${html`${(items.length === 1 ? tr('dashboard.cfgSecCountOne', '{n} setting') : tr('dashboard.cfgSecCount', '{n} settings')).replace('{n}', items.length)}${changedHere ? ' · ' + tr('dashboard.cfgSecChanged', '{n} changed').replace('{n}', changedHere) : ''}${editedHere > 0 ? html` ${editedMark(`● ${editedHere}`)}` : ''}`}>
                ${hasHelp && html`<${ExpandableHelp} title=${t('dashboard.cfgHelpTitle')}>${helpText}<//>`}
                ${items.map(({ path: p, entry: e }) => {
                  const edited = p in pending;
                  const val = edited ? pending[p] : e.value;
                  return html`<${SettingLine} key=${p} id=${'cfgf-' + p.replace(/\./g, '-')}
                    name=${label(p)} help=${hasExplain(p) ? 'config.' + p : undefined} flag=${edited ? '●' : null} flagTitle=${tr('dashboard.cfgEdited', 'Edited, not saved')}
                    code=${p} desc=${descOf(p, e)}
                    source=${e.source && html`<${Badge} type=${SOURCE_BADGE[e.source] || 'idle'} label=${sourceWord(e.source)} />`}
                    editor=${fieldEditor(p, e, val, editable, pending, onChange)}
                    end=${e.canReset && editable && e.mutable ? html`<${Action} small onClick=${() => resetConfig(p)}>${t('dashboard.cfgReset')}<//>` : null} />`;
                })}
                ${SectionAction && html`<${SectionAction} />`}
              <//>`;
          })}
        <//>`)}
    <//>
  `;
}
