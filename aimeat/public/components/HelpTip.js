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
 *   the dialog. The look is css/components/help-tip.css (the button's size, the label row).
 * @structure HelpTip({ term, label })
 * @usage html`<${HelpTip} term="ai.temperature" />`
 *        html`<${TextField} label=${x('param.temperature')} help="ai.temperature" … />`
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial (wish "Ohjenappi ja vihjeteksti asetuksille"): the AI fine-tuning
 *     fields are its first use.
 */
import { h } from 'preact';
import { useState, useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Tooltip } from '/components/Tooltip.js';
import { ExplainDialog, explainOf } from '/components/ExplainDialog.js';

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

export default HelpTip;
