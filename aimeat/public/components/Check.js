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
 *   `pill`: one of several small framed choices side by side, on the sun while ticked (a set of
 *   options to add to something: the app catalogue's capability packs); `onFocus`, `onBlur`,
 *   `onMouseEnter`, `onMouseLeave` for a page that says what the pointed or focused one is.
 *   `ruled`: one choice of a list, a thin rule under it, the words a step smaller in grey and their
 *   bold part (<strong>) in ink (the app catalogue's copy protection flags).
 *   `strong`: a choice that decides what a form does, bold words and a larger box (the app
 *   catalogue's "List in EXCHANGE").
 *   `help`: a term whose question mark (components/HelpTip.js) stands after the line, outside the
 *   <label>, explaining what ticking it does.
 *   A set of checks under one row label stands in a Field with `group` (components/Field.js).
 * @structure Check({ checked, onChange, radio, name, value, hint, help, inline, pill, ruled, strong, disabled, title, id, ariaLabel,
 *   onFocus, onBlur, onMouseEnter, onMouseLeave, children })
 * @usage html`<${Check} checked=${on} onChange=${setOn}>${t('x.autoRetry')}<//>`
 *        html`${langs.map((l) => html`<${Check} radio inline name="stt-lang" checked=${lang === l} onChange=${() => setLang(l)}>${word(l)}<//>`)}`
 * @version-history
 *   v1.4.0 — 2026-10-02 — `help`: the question mark that explains the choice; additive.
 *   v1.3.0 — 2026-09-27 — `strong`: a choice that decides what a form does, bold words and an 18px box
 *     (the old app catalogue's .mz-check), appcat parity (sections-d); additive, check-line.css
 *     .check--strong.
 *   v1.2.0 — 2026-09-27 — `ruled`: a choice of a list with a rule under it (the old app catalogue's
 *     .protect-row), appcat parity; additive, check-line.css .check--ruled.
 *   v1.1.0 — 2026-09-27 — `pill` (a framed choice among several, on the sun while ticked: the app
 *     catalogue's capability packs, the old .pb-pack-item) and the focus and pointer handlers;
 *     additive, appcat dialogs builder 2. Its rule is in css/components/check-line.css.
 *   v1.0.0 — 2026-09-26 — Initial: the check lines of the Settings pages as one component, with the
 *     layout most of them draw (a row, the box level with the words, .5rem between) (component plan C5).
 */
import { h } from 'preact';
import { HelpLabel } from '/components/HelpTip.js';
import htm from 'htm';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');

export function Check({ checked, onChange, radio, name, value, hint, help, inline, pill, ruled, strong, disabled, title, id, ariaLabel,
  onFocus, onBlur, onMouseEnter, onMouseLeave, children }) {
  // strong (added by appcat sections-d, parity): a choice that decides what a form does, its words
  // bold and its box a step larger, 14px under what is above it (the old catalogue's .mz-check).
  // ruled (added by appcat's dialogs, parity): one choice of a list, a thin rule under it, the words a
  // step smaller in grey with their bold name in ink (the old catalogue's copy protection rows).
  const change = onChange ? (e) => onChange(radio ? true : e.currentTarget.checked, e) : undefined;
  // pill (added by appcat dialogs builder 2): one of several small framed choices side by side, on the
  // sun while ticked (the prompt builder's capability packs). onFocus / onBlur reach the box and
  // onMouseEnter / onMouseLeave the line, so a page can say what the pointed or focused choice is.
  const line = html`
    <label class=${cx('check-line', 'check', inline && 'check--inline', pill && 'check--pill', ruled && 'check--ruled', strong && 'check--strong', hint && 'check--hint', disabled && 'check--off')} title=${title}
      onMouseEnter=${onMouseEnter} onMouseLeave=${onMouseLeave}>
      <input type=${radio ? 'radio' : 'checkbox'} id=${id} name=${name} value=${value} checked=${!!checked}
        disabled=${disabled} aria-label=${ariaLabel} onChange=${change} onFocus=${onFocus} onBlur=${onBlur} />
      ${hint ? html`<span class="check-words">${children}<span class="poster-hint">${hint}</span></span>` : children}
    </label>`;
  // help: the question mark after the line, outside the <label>, so pressing it does not tick the box.
  return help ? html`<${HelpLabel} term=${help} label=${typeof children === 'string' ? children : undefined}>${line}<//>` : line;
}

export default Check;
