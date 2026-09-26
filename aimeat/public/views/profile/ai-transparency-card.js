/**
 * @file ai-transparency-card.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What YOU published with a model in it, how much of it carries a label, and what this
 *   node records about a model call (TARGET-058 Phase 8).
 *
 *   WHY THIS IS AN OWNER SURFACE AND NOT ONLY AN OPERATOR ONE. Most publishing on this node is done
 *   by accounts, and under Article 50 the duty follows whoever publishes. An account that cannot see
 *   its own exposure cannot act on it, and the operator report is not theirs to read.
 *
 *   IT LEADS WITH THE NUMBER THAT NEEDS ACTING ON. Public, model-written, nobody recorded reviewing
 *   it, no label computed — that is the Article 50(4) case, and it is the first thing on the card.
 *   Zero is stated as plainly as any other number, because a compliance surface that only speaks up
 *   when something is wrong teaches people it is broken when it is silent.
 *
 *   AND IT SAYS WHAT IT DOES NOT COVER. Content with no provenance record at all does not appear in
 *   these counts. A total that read as "everything you have ever published" would be the one
 *   misleading number on the page.
 * @structure
 *   - AiTransparencyCard — the collapsible card, mounted in the profile AI tab
 * @usage
 *   import { AiTransparencyCard } from './ai-transparency-card.js';
 *   html`<${AiTransparencyCard} />`
 * @version-history
 *   v1.13.0 — 2026-09-26 — A row's line beside its name is the Listing's typewriter line (.listing-meta); a time keeps the Timestamp (a unification: Jouni's decision "Meta line").
 *   v1.12.0 — 2026-09-26 — A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v1.11.0 — 2026-09-26 — A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.10.0 — 2026-09-26 — A sentence that says what the part below is for is the lead (.og-lead): the ecosystem app's value line, the AI transparency's unlabelled line, the compliance card's undocumented note; their own rules go (a unification: the look most tabs use).
 *   v1.9.0 — 2026-09-26 — Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.8.0 — 2026-09-25 — A section that is one row until it is opened is the FoldSection (the folded row with its lead): the AI tab's decide, transparency and compliance cards and the classic AI settings; their own heads, chevrons and body rules go (a unification: the look most tabs use).
 *   v1.7.0 — 2026-09-25 — The older tabs' remaining help lines are the Hint (.poster-hint); their own sizes and greys go, a place keeps its margin (a unification: the look most tabs use).
 *   v1.6.0 — 2026-09-25 — A line that says a load or a save failed is the Form message in its error tone (.form-message--error); the error lines' own rules go (a unification: the look most tabs use).
 *   v1.5.0 — 2026-09-25 — The last quiet ways on with a look of their own are the action link (.poster-action; the danger tone for detach, the small link for a link inside a part, the quiet cut in the account dialogs): pn-detach-btn, pn-setup-link, pf-aitr-row-link, pf-edit-link, pf-pw-eye and the door's underlined words; a place keeps only its layout (Jouni's decision "Action link", a unification).
 *   v1.4.0 — 2026-09-25 — The four figures are the figure strip (og-strip); the unlabelled count keeps its warn colour as the strip's warn tone (a unification: the look most tabs use).
 *   v1.3.0 — 2026-09-25 — A grey help note is the Hint (poster-hint, components/Hint.js), as every other Settings hint (UI consolidation phase 5, a unification).
 *   v1.2.0 — 2026-09-25 — Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   2026-09-13 — V1: compose page and B1 section headings from the shared poster classes.
 *   v1.1.0 — 2026-08-01 — i18n namespace renamed `aiTransparency.*` → `aiTransparencyMine.*`
 *     (TARGET-058 Phase 10b). It sat one character away from `transparency.*`, the PUBLIC page's
 *     namespace, with `title` and `loading` meaning different things in each — a pair an
 *     autocomplete picks wrong and nothing catches, because a missing key renders as itself.
 *     Strings and behaviour unchanged.
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 8.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { Hint } from '/components/Hint.js';
import { FoldSection } from '/components/FoldSection.js';

/** `2026-08-01T18:42:00Z` → `2026-08-01 18:42`, in the reader's locale-neutral short form. */
function shortTime(iso) {
  return String(iso ?? '').slice(0, 16).replace('T', ' ');
}

export function AiTransparencyCard() {
  const [collapsed, setCollapsed] = useState(true);
  const [report, setReport] = useState(null);
  const [policy, setPolicy] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (opts = {}) => {
    if (!opts.quiet) setLoading(true);
    setError(null);
    try {
      const [mine, pol] = await Promise.all([
        apiGet('/v1/ai-transparency/mine'),
        apiGet('/v1/ai-transparency/logging-policy'),
      ]);
      // SET ONLY WHEN SOMETHING ACTUALLY CHANGED. This card re-reads on every live-update event,
      // as every profile tab showing server data must — but a live event on the account usually has
      // nothing to do with provenance, and re-setting an identical object repaints a panel somebody
      // is reading. Measured before this guard: 4 unrelated writes produced 6 repaints of the same
      // numbers. Comparing the payload makes a repaint mean "a number moved".
      setReport(prev => (JSON.stringify(prev) === JSON.stringify(mine?.data ?? null) ? prev : (mine?.data ?? null)));
      setPolicy(prev => (JSON.stringify(prev) === JSON.stringify(pol?.data ?? null) ? prev : (pol?.data ?? null)));
    } catch (err) {
      setError(err?.message || t('aiTransparencyMine.loadFailed'));
    } finally {
      if (!opts.quiet) setLoading(false);
    }
  }, []);

  // Only fetch once the card is actually opened. This panel sits inside the AI settings tab, and
  // two requests on every visit to that tab would be work nobody asked for.
  useEffect(() => { if (!collapsed && !report) load().catch(err => swallowed('ai-transparency-card: initial load', err)); }, [collapsed, report, load]);

  // Re-read on a live update, like every other profile tab showing server data — a record minted
  // while this card is open would otherwise sit here saying the old number.
  useEffect(() => {
    // `quiet`: no loading flicker on a background refresh. The panel either shows the same numbers
    // (and does not repaint at all) or shows new ones.
    const handler = () => { if (!collapsed) load({ quiet: true }).catch(err => swallowed('ai-transparency-card: live reload', err)); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [collapsed, load]);

  const unlabelled = report?.unlabelled ?? 0;

  return html`
    <div class="pf-card pf-aitr">
      <${FoldSection} num="" title=${t('aiTransparencyMine.title')} lead=${t('aiTransparencyMine.desc')} open=${!collapsed} onToggle=${() => setCollapsed(c => !c)}>
        <div class="pf-aitr-body">
          ${loading && html`<p class="poster-quiet loading-mark">${t('aiTransparencyMine.loading')}</p>`}
          ${error && html`<p class="form-message form-message--error">${error}</p>`}

          ${report && html`
            <div class="og-strip">
              <div><b class=${unlabelled > 0 ? 'og-strip-warn' : ''}>${unlabelled}</b><span>${t('aiTransparencyMine.unlabelled')}</span></div>
              <div><b>${report.labelled ?? 0}</b><span>${t('aiTransparencyMine.labelled')}</span></div>
              <div><b>${report.public_total ?? 0}</b><span>${t('aiTransparencyMine.publicTotal')}</span></div>
              <div><b>${report.total ?? 0}</b><span>${t('aiTransparencyMine.total')}</span></div>
            </div>

            <${Hint}>${t('aiTransparencyMine.scopeNote')}<//>

            ${unlabelled > 0 && html`
              <p class="og-lead">${t('aiTransparencyMine.unlabelledHelp')}</p>
              <ul class="pf-aitr-list">
                ${(report.unlabelled_detail?.items ?? []).map(item => html`
                  <li key=${item.id} class="pf-aitr-row poster-box">
                    <span class="pf-aitr-row-main">${item.pipeline || t('aiTransparencyMine.unknownSource')}</span>
                    <span class="pf-aitr-row-meta poster-time">${shortTime(item.generated_at)}</span>
                    ${item.record_url && html`
                      <a class="poster-action poster-action--more" href=${item.record_url} target="_blank" rel="noopener noreferrer">
                        ${t('aiTransparencyMine.openRecord')}
                      </a>`}
                  </li>`)}
              </ul>
              ${report.unlabelled_detail
                && report.unlabelled_detail.shown < report.unlabelled_detail.total
                && html`<p class="poster-hint">
                  ${t('aiTransparencyMine.showingOf', {
                    shown: String(report.unlabelled_detail.shown),
                    total: String(report.unlabelled_detail.total),
                  })}
                </p>`}
            `}

            ${(report.apps_declaring_generation_with_gap ?? []).length > 0 && html`
              <h4 class="pf-aitr-sub sub-heading">${t('aiTransparencyMine.appsWithGap')}</h4>
              <ul class="pf-aitr-list">
                ${report.apps_declaring_generation_with_gap.map(a => html`
                  <li key=${a.owner + '/' + a.filename} class="pf-aitr-row poster-box">
                    <span class="pf-aitr-row-main">${a.filename}</span>
                    <span class="pf-aitr-row-meta listing-meta">${a.gap}</span>
                  </li>`)}
              </ul>`}
          `}

          ${policy && html`
            <h4 class="pf-aitr-sub sub-heading">${t('aiTransparencyMine.policyTitle')}</h4>
            <${Hint}>${policy.why}<//>
            <ul class="pf-aitr-list">
              ${(policy.records ?? []).map(r => html`
                <li key=${r.what} class="pf-aitr-policy poster-box">
                  <span class="pf-aitr-row-main">${r.what}</span>
                  <span class="pf-aitr-row-meta listing-meta">${t('aiTransparencyMine.retention')}: ${r.retention}</span>
                  <span class="pf-aitr-row-meta listing-meta">${t('aiTransparencyMine.neverContains')}: ${r.never_contains}</span>
                </li>`)}
            </ul>
            <${Hint}>${policy.note}<//>`}
        </div><//>
    </div>`;
}

export default AiTransparencyCard;
