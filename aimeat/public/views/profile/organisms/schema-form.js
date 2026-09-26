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
 *   v1.11.0 -- 2026-09-26 -- Every part is a kit component (page group G2a): the form is the Fields with the TextField, TextArea, Select and Check, each with its row label, its hint under the control, and `invalid` for a required field left empty; the refusal is the Note's message, the foot the FormActions. The heavy rule of the create form goes: the form stands in the record's opened panel or box, which frames it. The page writes no class.
 *   v1.10.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.9.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.8.0 -- 2026-09-25 -- Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.7.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.6.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.5.0 -- 2026-09-25 -- The line a form says after it acted is the Form message; a refusal is its error tone (UI consolidation phase 5, a unification).
 *   v1.4.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.3.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.2.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.1.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-13 -- V2w: compose remaining profile section top rules from poster.css.
 *   v1.0.0 — 2026-06-19 — Extracted from organisms-tab.js during the module split.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { getGhii } from '/js/services/auth.js';
import { Fields, FormActions } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Check } from '/components/Check.js';
import { Note } from '/components/Note.js';
import { Action, Loud } from '/components/Action.js';

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

  // One field: its control with the row label, the hint, and the danger colour while a required
  // field stays empty after a save attempt. A boolean is a check line with the label as its words.
  const field = (k, def) => {
    const label = labelOf(k) + (required.has(k) ? ' *' : '');
    if (def.type === 'boolean') {
      return html`<${Check} key=${k} checked=${!!vals[k]} onChange=${(on) => set(k, on)}>${label}<//>`;
    }
    const hint = hintOf(k, def) || undefined;
    const suffix = def.type === 'array' ? ' (' + (t('organisms.onePerLine') || 'one per line') + ')' : '';
    const words = { key: k, label: label + suffix, hint, invalid: stillMissing.includes(k) };
    const value = vals[k] ?? '';
    const put = (v) => set(k, v);
    if (def.type === 'string' && Array.isArray(def.enum)) {
      return html`<${Select} ...${words} value=${value} onChange=${put} placeholder="—" options=${def.enum.map(o => [o, o])} />`;
    }
    // Date / datetime fields → native pickers (by schema format, or a name ending in _date).
    if (def.format === 'date-time') return html`<${TextField} ...${words} type="datetime-local" value=${value} onInput=${put} />`;
    if (def.format === 'date' || (def.type === 'string' && !def.enum && /(_date$|^date$)/i.test(k))) {
      return html`<${TextField} ...${words} type="date" value=${value} onInput=${put} />`;
    }
    if (def.type === 'integer' || def.type === 'number') return html`<${TextField} ...${words} type="number" value=${value} onInput=${put} />`;
    if (def.type === 'array') return html`<${TextArea} ...${words} rows=${2} value=${value} onInput=${put} />`;
    return html`<${TextField} ...${words} type="text" value=${value} onInput=${put} />`;
  };

  return html`
    <${Fields}>
      ${fieldNames.length === 0
        ? html`<${Note} kind="loading">${t('organisms.loading') || 'Loading...'}<//>`
        : fieldNames.map(k => field(k, props[k]))}
      ${stillMissing.length ? html`<${Note} kind="message" error>${(t('organisms.fillRequired') || 'Please fill in the required fields: {fields}')
          .replace('{fields}', stillMissing.map(labelOf).join(', '))}<//>` : null}
      <${FormActions}>
        <${Loud} control onClick=${trySave} disabled=${busy}>${t('organisms.saveDraft') || 'Save draft'}<//>
        <${Action} small onClick=${onCancel}>${t('organisms.cancel') || 'Cancel'}<//>
      <//>
    <//>
  `;
}
