/**
 * @file public/components/Field.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The frame every field of a form stands in (C5 of the component plan, the Field
 *   family): the row label over the control, the grey hint under it, and the line the form says
 *   after it acted (done or refused). Fields lays fields out in a column or in two columns;
 *   FormActions is the row of actions at the foot of a form. A page passes words and named options;
 *   it never writes a class. The controls (TextField, TextArea, Select, Check, Choice, TagInput,
 *   ModelPicker, FileDrop) take the same field words (`label`, `hint`, `message`) and stand in a
 *   Field themselves when they are given a label, so a page seldom writes Field by hand.
 *
 *   The look is the one most Settings pages draw (og-field: a column, the coral row label on top,
 *   the hint under the control), counted in the family's notes (kit/field.md); the label is the row
 *   label (.poster-label, Jouni's decision "Row label"). css/components/form-fields.css (og-fields,
 *   og-field, og-actions) and css/components/field.css (the field's own options).
 *
 *   Named options:
 *   - Field: `labelNote` (a small typewriter word beside the label: a count), `wide` (spans both columns of a two-column Fields), `invalid` (the label in the danger
 *     colour: a required field left empty), `group` (the control is a set of buttons or boxes, so the
 *     label names a group instead of pointing at one control; the controls of the family pass
 *     `named` instead, when the set inside names itself by the label), `message` (words, or { text, error })
 *     and `error` (the message is a refusal).
 *   - Fields: `cols` = 2 for two columns, 3 for three short fields side by side (one column on a
 *     narrow screen).
 *   - FormActions: `end` (the row at the right), `apart` (the first thing at the left, the rest at
 *     the right: a hint beside the send action).
 * @structure Field({ label, hint, message, error, wide, invalid, group, named, id, labelId, hintId, children }) ·
 *   Fields({ cols, children }) · FormActions({ end, apart, children }) · useFieldIds(id) · messageOf(m, error) ·
 *   hasFieldWords(props) · inField(props, ids, control, named)
 * @usage html`<${Fields} cols=${2}><${TextField} label=${t('x.name')} value=${v} onInput=${setV} /><//>`
 *        html`<${Field} label=${t('x.who')} hint=${t('x.whoHint')} group>…<//>`
 *        html`<${FormActions}><${Loud} control onClick=${save}>${t('x.save')}<//><//>`
 * @version-history
 *   v1.3.0 — 2026-09-26 — Fields `cols` 4: four short fields in a row, two under 1100px (an offer's
 *     price on the Offers page, main's .op-sell), additive (page group G6).
 *   v1.1.0 — 2026-09-26 — Fields `cols` 3: three short fields in a row (an agent's crew: the
 *     capabilities, the model, the temperature and the process), additive (page group G1a).
 *   v1.2.0 — 2026-09-26 — Field `labelNote`: a small typewriter word beside the row label (a
 *     calibration's prompt: "1234 characters"), additive (page group G4). Given to Field by hand.
 *   v1.0.0 — 2026-09-26 — Initial: one Field for the label, hint and message every Settings form
 *     draws in its own wrapper (og-field, ap-field, cp-field, ex-field, mc-field, pj-field,
 *     pf-dr-field, pf-or-field, sch-form-row, inbox-form-row, form-row, op-field, pf-edit-label…),
 *     with the look most of them have (component plan C5).
 */
import { h } from 'preact';
import { useId } from 'preact/hooks';
import htm from 'htm';
import { Note } from '/components/Note.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');

/** The ids a field's parts share: the control's own (the page's `id` wins), its hint's and its label's. */
export function useFieldIds(id) {
  const auto = useId();
  const base = id || `f${auto.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return { id: base, hintId: `${base}-hint`, labelId: `${base}-label`, msgId: `${base}-msg` };
}

/** A message given as words, or as { text, error } (the shape the Settings pages keep their messages in). */
export function messageOf(message, error) {
  if (message === null || message === undefined || message === false || message === '') return null;
  if (typeof message === 'object' && !Array.isArray(message) && 'text' in message) {
    return message.text ? { text: message.text, error: !!message.error } : null;
  }
  return { text: message, error: !!error };
}

/**
 * The field's frame. With `group`, the label names the group of controls inside (role group, labelled
 * by the label); otherwise the label points at the control whose id is `id`.
 */
export function Field({ label, labelNote, hint, message, error, wide, invalid, group, named, id, labelId: givenLabelId, hintId, children }) {
  const msg = messageOf(message, error);
  const cls = cx('og-field', 'field', wide && 'field--wide', invalid && 'field--invalid');
  const own = useId();
  const labelId = givenLabelId || `fl${own.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  // `named`: the control inside is a set that names itself by the label's id (a Choice, a TagInput).
  const lab = label === undefined || label === null || label === ''
    ? null
    : group || named
      ? html`<span class="poster-label" id=${labelId}>${label}${labelNote ? html`<small class="field-label-note">${labelNote}</small>` : null}</span>`
      : html`<label class="poster-label" for=${id} id=${labelId}>${label}${labelNote ? html`<small class="field-label-note">${labelNote}</small>` : null}</label>`;
  return html`
    <div class=${cls} role=${group && lab ? 'group' : undefined} aria-labelledby=${group && lab ? labelId : undefined}>
      ${lab}
      ${children}
      ${hint ? html`<span class="poster-hint" id=${hintId}>${hint}</span>` : null}
      ${msg ? html`<${Note} kind="message" error=${msg.error}>${msg.text}<//>` : null}
    </div>`;
}

/** Fields in a column, or in two columns (`cols` 2) that fold to one on a narrow screen. */
export function Fields({ cols, children }) {
  // cols 4 (added by page group G6): four short fields in a row, two on a narrower screen (an
  // offer's price: visibility, morsels, money, currency; main's .op-sell).
  return html`<div class=${cx('og-fields', cols === 2 && 'og-fields--2', cols === 3 && 'og-fields--3', cols === 4 && 'og-fields--4')}>${children}</div>`;
}

/** The row of actions at the foot of a form: the send action first, then the quieter ones, a message last. */
export function FormActions({ end, apart, children }) {
  return html`<div class=${cx('og-actions', end && 'og-actions--end', apart && 'og-actions--apart')}>${children}</div>`;
}

/** Whether a control was given words that need a Field around it. */
export function hasFieldWords(props) {
  const { label, hint, message, error, wide } = props;
  return !(label === undefined || label === null || label === '') || !!hint || !!messageOf(message, error) || !!wide;
}

/**
 * For the controls of the family: stand the control in a Field when it has field words, or give it
 * back bare. `named`: the control is a set that names itself by the label's id (ids.labelId).
 */
export function inField(props, ids, control, named) {
  const { label, hint, message, error, wide, invalid } = props;
  if (!hasFieldWords(props)) return control;
  return html`<${Field} label=${label} hint=${hint} message=${messageOf(message, error)} wide=${wide} invalid=${invalid}
    named=${named} id=${ids.id} labelId=${ids.labelId} hintId=${ids.hintId}>${control}<//>`;
}

export default Field;
