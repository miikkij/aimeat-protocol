/**
 * @file public/components/ExplainDialog.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The dialog that explains one setting in full: what it does, its range and default,
 *   what a lower and a higher value give, examples, and when to change it. The words are locale data
 *   under `explain.<term>.*`, so a page passes only the term and never writes an explanation:
 *   - `title` (the dialog's title; the page's label when absent), `short` (one or two sentences: the
 *     tooltip of components/HelpTip.js),
 *   - `what`, `range`, `low`, `high`, `ex1` … `ex6`, `tip`, each drawn only when the key exists,
 *   - `lowLabel`, `highLabel` (optional: the names of the two rows when "lower value" and "higher
 *     value" do not fit, as for a choice of levels).
 *   It is the site's Modal with the library's parts inside (Note lead, Facts, the row label, the
 *   dashed aside); its own sheet, css/components/explain-dialog.css, only spaces the examples and
 *   the aside.
 * @structure ExplainDialog({ term, label, open, onClose }) · explainOf(term, part)
 * @usage html`<${ExplainDialog} term="ai.temperature" open=${open} onClose=${() => setOpen(false)} />`
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial, extracted from HelpTip so a link or a menu can open the same
 *     explanation (wish "Ohjenappi ja vihjeteksti asetuksille").
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Modal } from '/components/Modal.js';
import { Facts } from '/components/Facts.js';
import { Note } from '/components/Note.js';

const html = htm.bind(h);

/** One part of a term's explanation, or '' when the locale has none. */
export function explainOf(term, part) {
  const key = `explain.${term}.${part}`;
  const v = t(key);
  return v && v !== key ? v : '';
}

/**
 * @param {{ term: string, label?: string, open: boolean, onClose: () => void }} props `term` names the
 *   explanation; `label` is the setting's name on the page, the title when the locale gives none.
 */
export function ExplainDialog({ term, label, open, onClose }) {
  if (!open) return null;
  const part = (p) => explainOf(term, p);
  const rows = [
    part('range') ? { k: t('explain.range'), v: part('range') } : null,
    part('low') ? { k: part('lowLabel') || t('explain.low'), v: part('low') } : null,
    part('high') ? { k: part('highLabel') || t('explain.high'), v: part('high') } : null,
  ].filter(Boolean);
  const examples = [1, 2, 3, 4, 5, 6].map((n) => part('ex' + n)).filter(Boolean);
  return html`
    <${Modal} open=${open} onClose=${onClose} title=${part('title') || label || term} size="md" guard=${false}
      footer=${html`<button type="button" class="poster-action" onClick=${onClose}>${t('common.close')}</button>`}>
      ${part('what') ? html`<${Note} kind="lead">${part('what')}<//>` : null}
      ${rows.length ? html`<${Facts} rows=${rows} />` : null}
      ${examples.length ? html`
        <div class="explain-examples">
          <span class="poster-label">${t('explain.examples')}</span>
          <ul>${examples.map((e) => html`<li key=${e}>${e}</li>`)}</ul>
        </div>` : null}
      ${part('tip') ? html`
        <aside class="poster-aside poster-aside--small explain-when">
          <span class="poster-label poster-label--block">${t('explain.when')}</span>
          ${part('tip')}
        </aside>` : null}
    <//>`;
}

export default ExplainDialog;
