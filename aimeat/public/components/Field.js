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
 *     narrow screen); `plain`: the labels are plain bold words in ink, in the words' own case (a
 *     dialog form in the app catalogue's face); `beside`: each label at the left of its field, a thin
 *     rule under each row (the app catalogue's Settings rows); `chapter` (with `plain`): a form inside
 *     a chapter of the app catalogue's detail, its fields spaced as the old detail spaced them
 *     (`ruled`: opened in place under the heavy ink rule, the tool editor);
 *     `spaced` (with `plain chapter`): its one-line fields carry their own air (the About editor).
 *   - FormActions: `end` (the row at the right), `apart` (the first thing at the left, the rest at
 *     the right: a hint beside the send action).
 * @structure Field({ label, hint, message, error, wide, invalid, group, named, id, labelId, hintId, children }) ·
 *   Fields({ cols, children }) · FormActions({ end, apart, children }) · useFieldIds(id) · messageOf(m, error) ·
 *   hasFieldWords(props) · inField(props, ids, control, named)
 * @usage html`<${Fields} cols=${2}><${TextField} label=${t('x.name')} value=${v} onInput=${setV} /><//>`
 *        html`<${Field} label=${t('x.who')} hint=${t('x.whoHint')} group>…<//>`
 *        html`<${FormActions}><${Loud} control onClick=${save}>${t('x.save')}<//><//>`
 * @version-history
 *   v1.8.0 — 2026-09-27 — Fields `spaced` (with `plain chapter`: the old detail's About editor, its
 *     one-line fields and the rows under it spaced one by one); additive, form-fields.css
 *     .og-fields--spaced, appcat parity (sections-a).
 *   v1.7.0 — 2026-09-27 — Fields `column` (with `plain`: a detail's form in one column, 10px apart, the
 *     old .mk-author-form and .lg-editor) and `narrow` (520px at most, the reviewer's name); additive,
 *     form-fields.css .og-fields--column, .og-fields--narrow, appcat parity (sections-c).
 *   v1.6.0 — 2026-09-27 — Fields `chapter`: with `plain`, a form inside a chapter of the app
 *     catalogue's detail, its fields spaced as the old detail's (the Promote texts, the ODPS defaults,
 *     the tool editor), `ruled` for one opened in place under the heavy rule; additive,
 *     form-fields.css .og-fields--chapter and --ruled, appcat parity (sections-d).
 *   v1.5.0 — 2026-09-27 — Fields `beside`: each label at the left of its field, a rule under each row
 *     (the old app catalogue's Settings rows), for appcat; additive, form-fields.css .og-fields--beside.
 *   v1.4.0 — 2026-09-27 — Fields `plain`: the labels as plain bold words in ink (the app catalogue's
 *     dialog forms, the old page's .modal-label), for appcat; additive, form-fields.css .og-fields--plain.
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
export function Fields({ cols, plain, beside, chapter, ruled, column, narrow, spaced, children }) {
  // spaced (added by appcat sections-a, parity): with `plain chapter`, a form whose one-line fields
  // carry their own air, 4px under the label and 10px over what follows (the last 8px); a row of
  // doors right under it keeps 4px, its status line 8px, a grey line 10px (the old detail's About
  // editor, whose fields and rows were spaced one by one).
  // column (added by appcat sections-c, parity): with `plain`, a form whose parts stand in one column
  // 10px apart, each label 2px over its field, a hint in the chapter's grey line 10px under it, a
  // choice 260px at most (the old detail's .mk-author-form and .lg-editor). narrow: a short form of
  // one name, 520px at most, 14px of air above it and 8px under it (.mk-author-form).
  // chapter (added by appcat sections-d, parity): with `plain`, a form inside a chapter of the app
  // catalogue's detail (the old detail's label.dtl-stat-label and its inline fields): the form and
  // its fields are blocks whose margins meet as there, a field stands in the line under its label and
  // a many-line one 4px under it and 6px over what follows; `cols` 2 keeps two columns down to 900px,
  // 24px apart, `cols` 3 is two wide and a short third (a currency). `ruled` (sections-d): the form
  // opens in place under the heavy ink rule, 24px under what is above it (the old tool editor).
  // beside (added by appcat's dialogs, parity): each label at the left of its field, a thin rule
  // under each row (the old app catalogue's Settings rows, .settings-row).
  // cols 4 (added by page group G6): four short fields in a row, two on a narrower screen (an
  // offer's price: visibility, morsels, money, currency; main's .op-sell).
  // plain (added by appcat's dialogs): the labels are plain bold words in ink (the app catalogue's
  // dialog forms, the old page's .modal-label).
  return html`<div class=${cx('og-fields', cols === 2 && 'og-fields--2', cols === 3 && 'og-fields--3', cols === 4 && 'og-fields--4', plain && 'og-fields--plain', beside && 'og-fields--beside', chapter && 'og-fields--chapter', ruled && 'og-fields--ruled', column &&'og-fields--column', narrow && 'og-fields--narrow', spaced && 'og-fields--spaced')}>${children}</div>`;
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
