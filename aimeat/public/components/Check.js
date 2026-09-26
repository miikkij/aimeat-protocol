/**
 * @file public/components/Check.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A check box, or a radio dot, with its words beside it (C5 of the component plan, the
 *   Field family): the Check line (.check-line, Jouni's decision "Check line": the words at the size
 *   and colour of the page's own text; the box and the dot are the browser's). The words are the
 *   children; the whole line is the control, so a press on the words ticks the box. A page passes
 *   the state and what happens; it never writes a class.
 *
 *   `checked`, `onChange(checked, event)` (a radio calls it only when it is picked, with true);
 *   `radio` with `name` for one of a set of radio dots; `hint` (a grey line under the words);
 *   `inline` (several checks side by side in a line of words instead of one per line); `disabled`,
 *   `title`, `id`, `ariaLabel` (for a check whose words are not enough to name it).
 *   A set of checks under one row label stands in a Field with `group` (components/Field.js).
 * @structure Check({ checked, onChange, radio, name, value, hint, inline, disabled, title, id, ariaLabel, children })
 * @usage html`<${Check} checked=${on} onChange=${setOn}>${t('x.autoRetry')}<//>`
 *        html`${langs.map((l) => html`<${Check} radio inline name="stt-lang" checked=${lang === l} onChange=${() => setLang(l)}>${word(l)}<//>`)}`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the check lines of the Settings pages as one component, with the
 *     layout most of them draw (a row, the box level with the words, .5rem between) (component plan C5).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');

export function Check({ checked, onChange, radio, name, value, hint, inline, disabled, title, id, ariaLabel, children }) {
  const change = onChange ? (e) => onChange(radio ? true : e.currentTarget.checked, e) : undefined;
  return html`
    <label class=${cx('check-line', 'check', inline && 'check--inline', hint && 'check--hint', disabled && 'check--off')} title=${title}>
      <input type=${radio ? 'radio' : 'checkbox'} id=${id} name=${name} value=${value} checked=${!!checked}
        disabled=${disabled} aria-label=${ariaLabel} onChange=${change} />
      ${hint ? html`<span class="check-words">${children}<span class="poster-hint">${hint}</span></span>` : children}
    </label>`;
}

export default Check;
