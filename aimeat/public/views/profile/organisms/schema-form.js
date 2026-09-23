/**
 * @file schema-form.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A form rendered from a JSON Schema — typed inputs (enum→select, integer→number,
 *   array→lines, boolean→checkbox, date/datetime→pickers, else text). Used by the workspace record
 *   spaces to add/edit drafts of any objectType. Extracted from organisms-tab.js, no behaviour change.
 * @structure SchemaForm
 * @usage import { SchemaForm } from '/views/profile/organisms/schema-form.js';
 * @version-history
 *   2026-09-22 -- Every input is the shared Field (its hint shows while the field is in use; a required
 *     field left empty at a save is the field's error); no class of its own.
 *   2026-09-13 -- V2w: compose remaining profile section top rules from poster.css.
 *   v1.0.0 — 2026-06-19 — Extracted from organisms-tab.js during the module split.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { getGhii } from '/js/services/auth.js';
import { Stack, Field, Action, Text } from '/components/poster-parts.js';

/* A form rendered from a JSON Schema — typed inputs (enum→select, integer→number,
 * array→lines, boolean→checkbox, else text). Works for any objectType, including ones a
 * generated manifest declares. New records pre-fill `id` (editable) and requester-style
 * fields ("x-default": "currentUser", or a requested_by/created_by-shaped name) with the
 * signed-in GHII. readOnly properties are agent-filled results — hidden here, shown only in
 * the record view. Labels/hints resolve manifest i18n (wsT) → schema description → raw key.
 * Save is always clickable: a failed attempt outlines the still-empty required fields. */
export function SchemaForm({ schema, busy, onSave, onCancel, initial, idPrefix, namespace, wsT }) {
  const props = (schema && schema.properties) || {};
  const editable = Object.entries(props).filter(([, def]) => !(def && def.readOnly));
  const required = new Set(((schema && schema.required) || []).filter(k => k !== 'id' && !(props[k] && props[k].readOnly)));
  const fieldNames = editable.map(([k]) => k);
  const [missing, setMissing] = useState(null); // required keys empty at the last save attempt
  // Seed from an existing record when editing (arrays → newline text for the textarea inputs).
  const [vals, setVals] = useState(() => {
    const out = {};
    for (const [k, def] of Object.entries(props)) {
      const v = initial && initial[k];
      if (v === undefined || v === null) continue;
      out[k] = Array.isArray(v) ? v.join('\n') : (def.type === 'boolean' ? !!v : String(v));
    }
    if (!initial) {
      if (props.id && out.id === undefined) out.id = `${idPrefix || 'rec'}-${Date.now().toString(36)}`;
      const me = getGhii() || '';
      for (const [k, def] of editable) {
        if (out[k] !== undefined || def.type !== 'string' || def.enum) continue;
        if (def['x-default'] === 'currentUser' || /^(requested_by|created_by|requester|author)$/i.test(k)) out[k] = me;
      }
    }
    return out;
  });
  const set = (k, v) => setVals(s => ({ ...s, [k]: v }));

  const buildValue = () => {
    const out = {};
    for (const [k, def] of Object.entries(props)) {
      const raw = vals[k];
      if (raw === undefined || raw === '') continue;
      if (def.type === 'integer' || def.type === 'number') out[k] = Number(raw);
      else if (def.type === 'boolean') out[k] = !!raw;
      else if (def.type === 'array') out[k] = String(raw).split('\n').map(s => s.trim()).filter(Boolean);
      else out[k] = raw;
    }
    return out;
  };

  const isEmpty = (k) => vals[k] === undefined || String(vals[k]).trim() === '';
  // Of the fields flagged at the last attempt, only the ones STILL empty stay outlined.
  const stillMissing = (missing || []).filter(isEmpty);
  const trySave = () => {
    const miss = [...required].filter(isEmpty);
    setMissing(miss.length ? miss : null);
    if (!miss.length) onSave(buildValue());
  };

  const labelOf = (k) => (wsT && wsT(`${namespace}.${k}`)) || k;
  const hintOf = (k, def) => (wsT && wsT(`${namespace}.${k}.hint`)) || def.description
    || (k === 'id' && !initial ? (t('organisms.autoIdHint') || 'Pre-filled automatically — change it if you want a memorable id.') : '');

  const control = (k, def, label, hint, error) => {
    const common = { key: k, label, hint: hint || undefined, error, value: vals[k] ?? '', onInput: e => set(k, e.target.value) };
    if (def.type === 'string' && Array.isArray(def.enum)) {
      return html`<${Field} ...${common} type="select" onInput=${undefined} onChange=${e => set(k, e.target.value)}
        options=${[{ value: '', label: '—' }, ...def.enum.map(o => ({ value: o, label: o }))]} />`;
    }
    // Date / datetime fields → native pickers (by schema format, or a name ending in _date).
    if (def.format === 'date-time') return html`<${Field} ...${common} type="datetime-local" />`;
    if (def.format === 'date' || (def.type === 'string' && !def.enum && /(_date$|^date$)/i.test(k))) return html`<${Field} ...${common} type="date" />`;
    if (def.type === 'integer' || def.type === 'number') return html`<${Field} ...${common} type="number" />`;
    if (def.type === 'array') return html`<${Field} ...${common} type="textarea" rows=${2} />`;
    return html`<${Field} ...${common} type="text" />`;
  };

  const field = (k, def) => {
    const label = labelOf(k) + (required.has(k) ? ' *' : '');
    if (def.type === 'boolean') {
      return html`<${Field} key=${k} type="checkbox" label=${label} value=${!!vals[k]} onChange=${e => set(k, e.target.checked)} />`;
    }
    const hint = hintOf(k, def);
    const suffix = def.type === 'array' ? ' (' + (t('organisms.onePerLine') || 'one per line') + ')' : '';
    // A required field still empty after a save attempt is marked as the field's error, in its words.
    return control(k, def, label + suffix, hint, stillMissing.includes(k) ? (hint || label) : undefined);
  };

  return html`
    <${Stack}>
      ${fieldNames.length === 0
        ? html`<${Text} tone="muted">${t('organisms.loading') || 'Loading...'}<//>`
        : fieldNames.map(k => field(k, props[k]))}
      ${stillMissing.length ? html`<${Text} tone="danger">${(t('organisms.fillRequired') || 'Please fill in the required fields: {fields}')
          .replace('{fields}', stillMissing.map(labelOf).join(', '))}<//>` : null}
      <${Stack} direction="wrap" align="center">
        <${Action} kind="primary" onClick=${trySave} disabled=${busy}>${t('organisms.saveDraft') || 'Save draft'}<//>
        <${Action} onClick=${onCancel}>${t('organisms.cancel') || 'Cancel'}<//>
      <//>
    <//>
  `;
}
