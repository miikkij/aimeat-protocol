/**
 * @file public/components/HelpTip.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The question mark beside a setting a person cannot be expected to know (temperature,
 *   top P): the small icon button of poster.css that shows a Tooltip (components/Tooltip.js) while
 *   the pointer or the focus is on it, and opens an ExplainDialog (components/ExplainDialog.js) when
 *   pressed. Both read the locale's `explain.<term>.*`, so a page passes only the term. Field
 *   (components/Field.js) draws a HelpTip after its row label when given `help`, so the controls of
 *   the field family take `help="ai.temperature"` and nothing else. On a touch screen a tap opens
 *   the dialog. HelpLabel puts the same help on a label's own words instead (HelpWord). The look
 *   is css/components/help-tip.css (the button's size, the label row, the word).
 * @structure HelpTip({ term, label }) · HelpLabel({ term, label, children })
 * @usage html`<${HelpTip} term="ai.temperature" />`
 *        html`<${TextField} label=${x('param.temperature')} help="ai.temperature" … />`
 *        Facts row: { k: html`<${HelpLabel} term="ai.fallback" label=${x('rt.fallback')}>${x('rt.fallback')}<//>`, v }
 * @version-history
 *   v2.0.0 — 2026-10-31 — HelpLabel's words open the help themselves (HelpWord): a dotted line, the
 *     help cursor, the short help after the pointer rests 0.6 s (a setting turns that off), the
 *     explanation on a click or a tap; the question mark is drawn only for the keyboard (wish
 *     wish-ohje-sanan-p-ll-kysymysmerkkikursori-viiveell-tooltip-ja-kli).
 *   v1.1.0 — 2026-10-02 — HelpLabel: a label with its question mark, for the places that are not a
 *     field (a Facts row's name, a Check, a SettingLine, a heading).
 *   v1.0.0 — 2026-10-02 — Initial (wish "Ohjenappi ja vihjeteksti asetuksille"): the AI fine-tuning
 *     fields are its first use.
 */
import { h } from 'preact';
import { useState, useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Tooltip } from '/components/Tooltip.js';
import { ExplainDialog, explainOf } from '/components/ExplainDialog.js';
import { helpHoverOn } from '/js/help-hover.js';

const html = htm.bind(h);

/**
 * @param {{ term: string, label?: string }} props `term` names the explanation (`explain.<term>.*`);
 *   `label` is the setting's name on the page, used when the locale gives no title.
 */
export function HelpTip({ term, label }) {
  const [open, setOpen] = useState(false);
  // The dialog hands the focus back to the button as it closes; that focus is not a request for the
  // tooltip, so the tooltip stays quiet for a moment after the dialog.
  const [settling, setSettling] = useState(false);
  const settle = useRef(0);
  const title = explainOf(term, 'title') || label || term;
  const close = () => {
    setOpen(false);
    setSettling(true);
    clearTimeout(settle.current);
    settle.current = setTimeout(() => setSettling(false), 300);
  };
  return html`
    <span class="help-tip">
      <${Tooltip} title=${title} text=${explainOf(term, 'short')} more=${t('explain.more')} quiet=${open || settling}>
        <button type="button" class="poster-icon poster-icon--small help-tip-button"
          aria-label=${t('explain.open', { term: title })} onClick=${() => setOpen(true)}>?</button>
      <//>
      <${ExplainDialog} term=${term} label=${label} open=${open} onClose=${close} />
    </span>`;
}

/** How long the pointer rests on a word before its help opens: longer than a button's 150 ms, so a
 *  pointer that only passes over the text opens nothing. */
const WORD_MS = 600;

/**
 * A word that carries its own explanation (Jouni, 2026-10-31): a dotted line under it and the help
 * cursor over it; the pointer resting on it opens the short help after WORD_MS, unless the person
 * turned that off in the home settings (js/help-hover.js); a click or a tap opens the explanation.
 * The word itself is not a control, because a field's word is its <label> and a control inside a
 * label is a second control the label names; the keyboard reaches the explanation through a
 * question mark that is drawn only while it has the focus. A click on a field's word opens the
 * explanation instead of moving the focus into the field.
 */
function HelpWord({ term, label, children }) {
  const [open, setOpen] = useState(false);
  const [settling, setSettling] = useState(false);
  const settle = useRef(0);
  const title = explainOf(term, 'title') || label || term;
  const close = () => {
    setOpen(false);
    setSettling(true);
    clearTimeout(settle.current);
    settle.current = setTimeout(() => setSettling(false), 300);
  };
  const openFromWord = (e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); };
  return html`
    <span class="field-label-row help-word-row">
      <${Tooltip} title=${title} text=${explainOf(term, 'short')} more=${t('explain.moreWord')}
        quiet=${open || settling} delay=${WORD_MS} gate=${helpHoverOn}>
        <span class="help-word">
          <span class="help-word-text" onClick=${openFromWord}>${children}</span>
          <button type="button" class="poster-icon poster-icon--small help-tip-button help-word-key"
            aria-label=${t('explain.open', { term: title })} onClick=${() => setOpen(true)}>?</button>
        </span>
      <//>
      <span class="help-word-dialog"><${ExplainDialog} term=${term} label=${label} open=${open} onClose=${close} /></span>
    </span>`;
}

/**
 * A label that explains itself: the row Field, SettingLine and a Facts row's name draw one. Since
 * 2026-10-31 the label's own words open the help (HelpWord); before, a question mark stood after
 * it. A Check keeps the question mark (HelpTip), because pressing its words ticks the box. Without a
 * term it gives the label back alone.
 * @param {{ term?: string, label?: string, children: any }} props `children` the label as drawn;
 *   `label` its words, the dialog's title when the locale gives none.
 */
export function HelpLabel({ term, label, children }) {
  if (!term) return children;
  return html`<${HelpWord} term=${term} label=${label}>${children}<//>`;
}

export default HelpTip;
