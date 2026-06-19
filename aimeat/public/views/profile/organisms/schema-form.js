/**
 * @file schema-form.js
 * @description A form rendered from a JSON Schema — typed inputs (enum→select, integer→number,
 *   array→lines, boolean→checkbox, date/datetime→pickers, else text). Used by the workspace record
 *   spaces to add/edit drafts of any objectType. Extracted from organisms-tab.js, no behaviour change.
 * @structure SchemaForm
 * @usage import { SchemaForm } from '/views/profile/organisms/schema-form.js';
 * @version-history
 *   v1.0.0 — 2026-06-19 — Extracted from organisms-tab.js during the module split.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { getGhii } from '/js/services/auth.js';

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

  const control = (k, def) => {
    if (def.type === 'string' && Array.isArray(def.enum)) {
      return html`<select class="input-field input-sm" value=${vals[k] ?? ''} onChange=${e => set(k, e.target.value)}>
          <option value="">—</option>${def.enum.map(o => html`<option value=${o} key=${o}>${o}</option>`)}
        </select>`;
    }
    // Date / datetime fields → native pickers (by schema format, or a name ending in _date).
    if (def.format === 'date-time') {
      return html`<input type="datetime-local" class="input-field input-sm" value=${vals[k] ?? ''} onInput=${e => set(k, e.target.value)} />`;
    }
    if (def.format === 'date' || (def.type === 'string' && !def.enum && /(_date$|^date$)/i.test(k))) {
      return html`<input type="date" class="input-field input-sm" value=${vals[k] ?? ''} onInput=${e => set(k, e.target.value)} />`;
    }
    if (def.type === 'integer' || def.type === 'number') {
      return html`<input type="number" class="input-field input-sm" value=${vals[k] ?? ''} onInput=${e => set(k, e.target.value)} />`;
    }
    if (def.type === 'array') {
      return html`<textarea class="input-field input-sm" rows="2" value=${vals[k] ?? ''} onInput=${e => set(k, e.target.value)}></textarea>`;
    }
    return html`<input type="text" class="input-field input-sm" value=${vals[k] ?? ''} onInput=${e => set(k, e.target.value)} />`;
  };

  const field = (k, def) => {
    const label = labelOf(k) + (required.has(k) ? ' *' : '');
    if (def.type === 'boolean') {
      return html`<label class="pj-field pj-field-inline" key=${k}><input type="checkbox" checked=${!!vals[k]} onChange=${e => set(k, e.target.checked)} /><span>${label}</span></label>`;
    }
    const hint = hintOf(k, def);
    const suffix = def.type === 'array' ? ' (' + (t('organisms.onePerLine') || 'one per line') + ')' : '';
    return html`<label class="pj-field ${stillMissing.includes(k) ? 'pj-field-invalid' : ''}" key=${k}>
      <span>${label}${suffix}</span>
      ${hint ? html`<span class="pj-field-hint">${hint}</span>` : null}
      ${control(k, def)}</label>`;
  };

  return html`
    <div class="create-form pj-draft-form">
      <div class="flex-col">
        ${fieldNames.length === 0
          ? html`<div class="pj-empty">${t('organisms.loading') || 'Loading...'}</div>`
          : fieldNames.map(k => field(k, props[k]))}
        ${stillMissing.length ? html`<div class="pj-form-error">${(t('organisms.fillRequired') || 'Please fill in the required fields: {fields}')
            .replace('{fields}', stillMissing.map(labelOf).join(', '))}</div>` : null}
        <div class="form-actions">
          <button class="btn-primary btn-sm" onClick=${trySave} disabled=${busy}>${t('organisms.saveDraft') || 'Save draft'}</button>
          <button class="btn-ghost btn-sm" onClick=${onCancel}>${t('organisms.cancel') || 'Cancel'}</button>
        </div>
      </div>
    </div>
  `;
}
