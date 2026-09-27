/**
 * @file public/components/Select.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The drop-down of the Field family (C5 of the component plan): the browser's select in
 *   the Select field look (.select-field, css/components/select-field.css). A page passes the options
 *   as data and what happens on a pick; it never writes a class or an <option>. Given a `label` (or a
 *   `hint` or a `message`) it stands in a Field (components/Field.js).
 *
 *   `options`: an array of { value, label, disabled, title } or of [value, label] pairs or of plain
 *   strings (the value is the label); a { group, options } entry draws a named group (optgroup).
 *   `placeholder`: a first option with the value '' ("–", "Choose…"); `placeholderDisabled` makes it
 *   unpickable once something is chosen. `onChange(value, event)`. Named options: `fit` (as wide as
 *   its words, not its column), `invalid`, `disabled`, `ariaLabel`, `title`, `attention` (coral while
 *   something is chosen: a choice that widens what an act reaches, such as a broadcast's audience),
 *   `line` (no frame, the ink line under it, bold, the grey arrow: the old app catalogue's detail
 *   choice, at most 340px wide; with `fit` at least 150px).
 * @structure Select(props) · normalise(option)
 * @usage html`<${Select} label=${t('x.vis')} value=${vis} onChange=${setVis}
 *          options=${[['private', t('x.private')], ['public', t('x.public')]]} />`
 * @version-history
 *   v1.2.0 — 2026-09-27 — `line`: the old app catalogue's detail choice (select.modal-input: the ink
 *     line under it, 10px 32px 10px 14px, .88rem bold, the grey arrow); additive, appcat parity
 *     (sections-b), select-field.css .select-field--line.
 *   v1.1.0 — 2026-09-26 — `attention`: coral while a value is chosen (main's broadcast audience,
 *     .inbox-bc-audience--on); additive, fix pass.
 *   v1.0.0 — 2026-09-26 — Initial: the Settings selects as one component with options as data
 *     (component plan C5).
 */
import { h } from 'preact';
import htm from 'htm';
import { useFieldIds, inField, messageOf } from '/components/Field.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');

function normalise(o) {
  if (Array.isArray(o)) return { value: o[0], label: o[1] ?? o[0], disabled: o[2] };
  if (o !== null && typeof o === 'object') return { ...o, label: o.label ?? o.value };
  return { value: o, label: o };
}

function optionOf(o) {
  const n = normalise(o);
  const v = n.value === null || n.value === undefined ? '' : String(n.value);
  return html`<option key=${v} value=${v} disabled=${n.disabled} title=${n.title}>${n.label}</option>`;
}

export function Select(props) {
  const { id, value, options = [], placeholder, placeholderDisabled, fit, invalid, error, disabled, required, name,
    ariaLabel, title, onChange, onFocus, onBlur, attention, line } = props;
  const ids = useFieldIds(id);
  const bad = !!invalid || !!messageOf(props.message, error)?.error;
  const current = value === null || value === undefined ? '' : String(value);
  // attention (added by the fix pass): a choice that widens what an act reaches turns coral while it
  // is set (the operator's broadcast audience: every user of the node; main's .inbox-bc-audience--on).
  // line (added by appcat sections-b, parity): the underlined choice of the old app catalogue's
  // detail (select.modal-input), at most 340px; with `fit` as wide as its words, at least 150px.
  const control = html`<select id=${ids.id} name=${name}
    class=${cx('select-field', fit && 'select-field--fit', bad && 'select-field--invalid', attention && current !== '' && 'select-field--attention', line && 'select-field--line')}
    value=${current} disabled=${disabled} required=${required} title=${title}
    aria-label=${ariaLabel} aria-invalid=${bad ? 'true' : undefined}
    aria-describedby=${props.hint ? ids.hintId : undefined}
    onChange=${onChange ? (e) => onChange(e.currentTarget.value, e) : undefined} onFocus=${onFocus} onBlur=${onBlur}>
    ${placeholder !== undefined && placeholder !== null ? html`<option value="" disabled=${placeholderDisabled && current !== ''}>${placeholder}</option>` : null}
    ${options.map((o) => (o && typeof o === 'object' && !Array.isArray(o) && Array.isArray(o.options)
    ? html`<optgroup key=${`g-${o.group}`} label=${o.group}>${o.options.map(optionOf)}</optgroup>`
    : optionOf(o)))}
  </select>`;
  return inField(props, ids, control, false);
}

export default Select;
