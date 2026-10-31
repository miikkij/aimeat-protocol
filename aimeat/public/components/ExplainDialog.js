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
 *     value" do not fit, as for a choice of levels or the two answers to a question),
 *   - `tipLabel` (optional: the heading of `tip` when "when to change it" does not fit, as for a notice).
 *   It is the site's Modal with the library's parts inside (Note lead, Facts, the row label, the
 *   dashed aside); its own sheet, css/components/explain-dialog.css, only spaces the examples and
 *   the aside.
 *   - `terms` (optional): glossary terms, comma-separated ("Agent,Scope"). The dialog lists each with
 *     its plain sentence in the reader's language, read from GET /v1/glossary.json.
 *   Every dialog ends with "Ask your AI more": a prompt the person copies into their own AI, carrying
 *   this explanation and the glossary's definitions of the named terms (js/ask-ai-prompt.js), so the
 *   AI answers from AIMEAT's own words. `mine` (optional) is the person's own figures for the topic,
 *   shown in the dialog and put into the prompt.
 * @structure ExplainDialog({ term, label, open, onClose, mine }) · explainOf(term, part)
 * @usage html`<${ExplainDialog} term="ai.temperature" open=${open} onClose=${() => setOpen(false)} />`
 * @version-history
 *   v1.2.0 — 2026-10-31 — `terms` lists glossary entries, `mine` the person's own figures, and every
 *     dialog ends with "Ask your AI more" (Jouni, 2026-10-31; wish-kokonaiskuva-koneet-agentit-sovellukset-tieto-ja-tarjoukset-).
 *   v1.1.0 — 2026-10-27 — `tipLabel`, so a notice, a Security page incident and a waiting request can
 *     explain themselves with the same dialog (Jouni, 2026-10-27: "kysymysmerkki + help dialogi").
 *   v1.0.0 — 2026-10-02 — Initial, extracted from HelpTip so a link or a menu can open the same
 *     explanation (wish "Ohjenappi ja vihjeteksti asetuksille").
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t, getLocale } from '/js/i18n.js';
import { Modal } from '/components/Modal.js';
import { Facts } from '/components/Facts.js';
import { Note } from '/components/Note.js';
import { PromptCard } from '/components/PromptCard.js';
import { buildAskPrompt } from '/js/ask-ai-prompt.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);

/** The glossary, read once per language for every dialog on the page (GET /v1/glossary.json). */
const glossaryByLang = new Map();
function loadGlossary(lang) {
  if (!glossaryByLang.has(lang)) {
    glossaryByLang.set(lang, fetch(`/v1/glossary.json?lang=${encodeURIComponent(lang)}`)
      .then((r) => r.json())
      .then((body) => body?.data?.terms ?? [])
      .catch((err) => { swallowed('explain-dialog: glossary', err); glossaryByLang.delete(lang); return []; }));
  }
  return glossaryByLang.get(lang);
}

/** The glossary entries a term's explanation names in `explain.<term>.terms` (comma-separated). */
function useTerms(names, open) {
  const [terms, setTerms] = useState([]);
  const lang = getLocale();
  const wantedKey = names.map((n) => n.toLowerCase()).join(',');
  useEffect(() => {
    if (!open || !wantedKey) return undefined;
    let live = true;
    loadGlossary(lang).then((all) => {
      if (!live) return;
      setTerms(wantedKey.split(',').map((w) => all.find((g) => g.term.toLowerCase() === w)).filter(Boolean));
    });
    return () => { live = false; };
  }, [open, lang, wantedKey]);
  return terms;
}

/** One part of a term's explanation, or '' when the locale has none. */
export function explainOf(term, part) {
  const key = `explain.${term}.${part}`;
  const v = t(key);
  return v && v !== key ? v : '';
}

/**
 * @param {{ term: string, label?: string, mine?: string, open: boolean, onClose: () => void }} props `term` names the
 *   explanation; `label` is the setting's name on the page, the title when the locale gives none.
 */
export function ExplainDialog({ term, label, open, onClose, mine }) {
  const part = (p) => explainOf(term, p);
  const names = part('terms').split(',').map((s) => s.trim()).filter(Boolean);
  const terms = useTerms(names, open);
  if (!open) return null;
  const title = part('title') || label || term;
  const rows = [
    part('range') ? { k: t('explain.range'), v: part('range') } : null,
    part('low') ? { k: part('lowLabel') || t('explain.low'), v: part('low') } : null,
    part('high') ? { k: part('highLabel') || t('explain.high'), v: part('high') } : null,
  ].filter(Boolean);
  const examples = [1, 2, 3, 4, 5, 6].map((n) => part('ex' + n)).filter(Boolean);
  // The glossary's plain sentence in the reader's language; a term without one shows its English
  // definition, which is what the glossary page shows for a builder-only term.
  const termRows = terms.map((g) => ({ k: g.term, v: g.plain || g.definition }));
  const prompt = buildAskPrompt({
    subject: title,
    explanation: [part('what'), ...rows.map((r) => `${r.k}: ${r.v}`), ...examples, part('tip')],
    terms: terms.map((g) => ({ term: g.term, definition: g.definition })),
    mine, locale: getLocale(), base: location.origin,
  });
  return html`
    <${Modal} open=${open} onClose=${onClose} title=${title} size="md" guard=${false}
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
          <span class="poster-label poster-label--block">${part('tipLabel') || t('explain.when')}</span>
          ${part('tip')}
        </aside>` : null}
      ${termRows.length ? html`
        <div class="explain-terms">
          <span class="poster-label">${t('explain.terms')}</span>
          <${Facts} rows=${termRows} />
        </div>` : null}
      ${mine ? html`<p class="explain-mine">${mine}</p>` : null}
      <aside class="poster-aside poster-aside--small explain-ask">
        <span class="poster-label poster-label--block">${t('explain.ask')}</span>
        <p class="explain-ask-why">${t('explain.askWhy')}</p>
        <${PromptCard} label=${t('explain.askLabel')} prompt=${prompt} copyLabel=${t('explain.askCopy')} showPrompt=${false} />
      </aside>
      <a class="poster-action explain-glossary" href="/v1/glossary">${t('explain.glossary')}</a>
    <//>`;
}

export default ExplainDialog;
