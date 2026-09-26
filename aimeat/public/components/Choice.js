/**
 * @file public/components/Choice.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Picking one of a few settings, or several, as a field (C5 of the component plan, the
 *   Field family). Jouni's decision "Choice" (2026-09-23): the answers are tabs, underlined words, the
 *   chosen one on the sun (.poster-tab, .is-on); the background pattern tiles keep their look as the
 *   `tile` tone; the question box's answers are tabs too (Jouni's decision "Question box"). The boxed
 *   answers with a name and a line under it (.poster-choice: a new agent's shape, a schedule's kind, a
 *   calibration's option) are the `boxed` cut. A page passes the options as data, the value and what
 *   happens; it never writes a class. The tabs are drawn by the page family's Tabs
 *   (components/Tabs.js, kind 'choice' or 'toggle'), so a choosing row has one keyboard and one look
 *   wherever it stands; the Choice adds what a field needs: the row label, hint and message, and the
 *   answer that can be taken back.
 *
 *   `options`: [{ value, label, hint, disabled, title, count, attention }] or [value, label] pairs; a value may be null.
 *   `attention` on an option (tab row only): the risky answer in the tab's attention tone (a key that
 *   acts as the owner, a key that never expires).
 *   One answer: `value`, `onChange(value, event)`; `clearable` lets a press on the chosen answer take
 *   it back (onChange with ''). Several: `multi`, `value` an array, `onChange(values, event)`.
 *   Named options: `tone` = 'tile' | 'filter' | 'fold' (the Tabs' tones); `boxed` with `cols` = 2 | 3 | 4 (the boxes side by side,
 *   fewer on a narrow screen) and `dot` (a radio dot in each box; `name` groups them); `disabled`;
 *   `ariaLabel` when it has no `label`. Field words (`label`, `hint`, `message`, `wide`) stand it in
 *   a Field whose label names the group. `children` stand after the answers in the same row (a field
 *   for an answer of one's own).
 *   Keys: the arrow keys move between the answers (Home and End to the ends, in the tab row); Space
 *   and Enter pick, as on any button; a boxed answer with its radio dot keeps the browser's keys.
 * @structure Choice(props) · norm(option)
 * @usage html`<${Choice} label=${c('fLifetime')} value=${ttl} onChange=${setTtl}
 *          options=${[['72', c('life3')], ['168', c('life7')]]} />`
 *        html`<${Choice} boxed cols=${4} ariaLabel=${t('x.shape')} value=${shape} onChange=${setShape}
 *          options=${shapes.map((s) => ({ value: s.id, label: s.name, hint: s.desc }))} />`
 * @version-history
 *   v1.1.0 — 2026-09-26 — An option's `attention` reaches its tab (G3, additive: the Access token
 *     form's risky levels and "never expires", coral on main).
 *   v1.0.0 — 2026-09-26 — Initial: the choose-one rows of the Settings forms (.pf-tabs of .poster-tab,
 *     the og-choice group, the tile and filter tones, the .poster-choice boxes) as one component
 *     (component plan C5).
 */
import { h } from 'preact';
import htm from 'htm';
import { useFieldIds, inField, hasFieldWords } from '/components/Field.js';
import { Tabs } from '/components/Tabs.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');
const TONES = new Set(['tile', 'filter', 'fold']);
const COLS = new Set([2, 3, 4]);

function norm(o) {
  if (Array.isArray(o)) return { value: o[0], label: o[1] ?? String(o[0]), disabled: o[2] };
  if (o !== null && typeof o === 'object') return o;
  return { value: o, label: String(o) };
}

/** The arrow keys walk the answers, skipping the ones that cannot be picked. */
function walk(e) {
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
  // A radio dot and a field of one's own keep the browser's own arrow keys.
  if (!step || e.target.matches?.('input, textarea, select')) return;
  const row = e.currentTarget;
  const all = [...row.querySelectorAll('[data-choice]')].filter((b) => !b.disabled);
  const at = all.indexOf(document.activeElement?.closest('[data-choice]'));
  if (at < 0) return;
  e.preventDefault();
  const next = all[(at + step + all.length) % all.length];
  (next.matches('button') ? next : next.querySelector('input'))?.focus();
}

export function Choice(props) {
  const { id, options = [], value, multi, clearable, onChange, tone, boxed, cols, dot, name, disabled, ariaLabel, children } = props;
  const ids = useFieldIds(id);
  const picks = multi ? (Array.isArray(value) ? value : []) : null;
  const isOn = (v) => (multi ? picks.includes(v) : value === v);
  const press = (v, e) => {
    if (!onChange) return;
    if (multi) onChange(isOn(v) ? picks.filter((x) => x !== v) : [...picks, v], e);
    else if (clearable && value === v) onChange('', e);
    else onChange(v, e);
  };
  const named = hasFieldWords(props) && props.label;
  const roleOf = multi ? undefined : 'radio';
  if (!boxed) {
    // The tabs are the page family's Tabs (components/Tabs.js), with its keys; the Choice adds the
    // field words and the answer that can be taken back.
    const items = options.map(norm).map((o) => ({ value: o.value, label: o.label, title: o.title, disabled: o.disabled, count: o.count, attention: o.attention, key: String(o.value) }));
    const row = html`<${Tabs} items=${items} value=${value} tone=${TONES.has(tone) ? tone : undefined} kind=${multi ? 'toggle' : 'choice'}
      disabled=${disabled} label=${named ? undefined : ariaLabel} labelledBy=${named ? ids.labelId : undefined}
      onSelect=${(v) => press(v)}>${children}<//>`;
    return inField(props, ids, row, true);
  }
  const answers = options.map(norm).map((o) => {
    const on = isOn(o.value);
    const off = disabled || o.disabled;
    const key = String(o.value);
    if (boxed && dot) {
      return html`<label key=${key} class=${cx('poster-choice', 'choice-dot', on && 'on')} title=${o.title} data-choice>
        <input type="radio" name=${name || ids.id} checked=${on} disabled=${off} onChange=${(e) => press(o.value, e)} />
        <span><b>${o.label}</b>${o.hint ? html`<small>${o.hint}</small>` : null}</span>
      </label>`;
    }
    return html`<button type="button" key=${key} class=${cx('poster-choice', on && 'on')} title=${o.title} disabled=${off} data-choice
      role=${roleOf} aria-checked=${multi ? undefined : (on ? 'true' : 'false')} aria-pressed=${multi ? (on ? 'true' : 'false') : undefined}
      onClick=${(e) => press(o.value, e)}><b>${o.label}</b>${o.hint || null}</button>`;
  });
  const cls = cx('choice', 'choice--boxed', COLS.has(cols) && `choice--cols-${cols}`);
  const control = html`<div class=${cls} id=${ids.id} role=${multi ? 'group' : 'radiogroup'}
    aria-label=${named ? undefined : ariaLabel} aria-labelledby=${named ? ids.labelId : undefined}
    aria-describedby=${props.hint ? ids.hintId : undefined} onKeyDown=${walk}>${answers}${children}</div>`;
  return inField(props, ids, control, true);
}

export default Choice;
