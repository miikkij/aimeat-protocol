/**
 * @file public/components/ColorPicker.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The colour a person gives a thing (a workspace section, a document, a record): a small
 *   dot that opens a row of swatches, seven theme colours and "no colour". A page passes the colour
 *   and what happens when one is picked; it never writes a class. The colours are theme tokens, so a
 *   colour always matches the light or dark theme and never a free hex. The look is
 *   css/components/colour-tag.css. `colourClass(c)` is the class that sets a thing's colour for a
 *   part that draws the colour's rail itself (the document tree).
 *   It owns its behaviour: the dot opens and closes the swatches, a pick closes them, the pointer
 *   leaving them closes them, and Escape closes them; a press never reaches the row around it.
 * @structure COLOURS · colourClass(c) · ColorPicker({ value, onPick, title, noneLabel })
 * @usage html`<${ColorPicker} value=${colour} onPick=${(c) => setColour(id, c)} title=${t('organisms.color')} />`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: views/profile/organisms/workspace/color-picker.js as a component with
 *     its own class names (.colour-tag*, no page prefix); the dot gains an aria label and says whether
 *     its swatches are open, and Escape closes them (page migration G2b).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');

/** The colours a person can give a thing, in the order the swatches show them. */
export const COLOURS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];

/** The class that sets a thing's colour token (--colour-tag), or '' for none. */
export const colourClass = (c) => (COLOURS.includes(c) ? `colour-tag--${c}` : '');

/**
 * @param {{ value?: string|null, onPick: (c: string|null) => void, title?: string, noneLabel?: string }} props
 */
export function ColorPicker({ value, onPick, title, noneLabel }) {
  const [open, setOpen] = useState(false);
  const name = title || t('organisms.color') || 'Color';
  const stop = (e) => { e.stopPropagation(); e.preventDefault(); };
  const pick = (c) => (e) => { stop(e); onPick(c); setOpen(false); };
  const set = COLOURS.includes(value);
  return html`
    <span class="colour-tag" onKeyDown=${(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); } }}>
      <button type="button" class=${cx('colour-tag-dot', set ? `colour-tag-dot--set ${colourClass(value)}` : 'colour-tag-dot--empty')}
        title=${name} aria-label=${name} aria-expanded=${open ? 'true' : 'false'}
        onClick=${(e) => { stop(e); setOpen((o) => !o); }}></button>
      ${open ? html`
        <span class="colour-tag-pop" onMouseLeave=${() => setOpen(false)}>
          <button type="button" class="colour-tag-swatch colour-tag-swatch--none" title=${noneLabel || t('organisms.noColor') || 'No color'}
            aria-label=${noneLabel || t('organisms.noColor') || 'No color'} onClick=${pick(null)}>∅</button>
          ${COLOURS.map((c) => html`<button type="button" key=${c} class=${`colour-tag-swatch ${colourClass(c)}`}
            aria-label=${c} aria-pressed=${value === c ? 'true' : 'false'} onClick=${pick(c)}></button>`)}
        </span>` : null}
    </span>`;
}

export default ColorPicker;
