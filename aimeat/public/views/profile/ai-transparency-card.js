/**
 * @file ai-transparency-card.js
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
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 8.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

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
      setError(err?.message || t('aiTransparency.loadFailed'));
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
      <button type="button" class="pf-aitr-head" onClick=${() => setCollapsed(c => !c)}
              aria-expanded=${!collapsed}>
        <span class="section-title">${t('aiTransparency.title')}</span>
        <span class="pf-aitr-chevron">${collapsed ? '+' : '−'}</span>
      </button>
      <p class="section-desc">${t('aiTransparency.desc')}</p>

      ${!collapsed && html`
        <div class="pf-aitr-body">
          ${loading && html`<p class="pf-aitr-muted">${t('aiTransparency.loading')}</p>`}
          ${error && html`<p class="pf-aitr-error">${error}</p>`}

          ${report && html`
            <div class="pf-aitr-stats">
              <div class=${'pf-aitr-stat' + (unlabelled > 0 ? ' pf-aitr-stat-warn' : '')}>
                <span class="pf-aitr-num">${unlabelled}</span>
                <span class="pf-aitr-lbl">${t('aiTransparency.unlabelled')}</span>
              </div>
              <div class="pf-aitr-stat">
                <span class="pf-aitr-num">${report.labelled ?? 0}</span>
                <span class="pf-aitr-lbl">${t('aiTransparency.labelled')}</span>
              </div>
              <div class="pf-aitr-stat">
                <span class="pf-aitr-num">${report.public_total ?? 0}</span>
                <span class="pf-aitr-lbl">${t('aiTransparency.publicTotal')}</span>
              </div>
              <div class="pf-aitr-stat">
                <span class="pf-aitr-num">${report.total ?? 0}</span>
                <span class="pf-aitr-lbl">${t('aiTransparency.total')}</span>
              </div>
            </div>

            <p class="pf-aitr-note">${t('aiTransparency.scopeNote')}</p>

            ${unlabelled > 0 && html`
              <p class="pf-aitr-warn-line">${t('aiTransparency.unlabelledHelp')}</p>
              <ul class="pf-aitr-list">
                ${(report.unlabelled_detail?.items ?? []).map(item => html`
                  <li key=${item.id} class="pf-aitr-row">
                    <span class="pf-aitr-row-main">${item.pipeline || t('aiTransparency.unknownSource')}</span>
                    <span class="pf-aitr-row-meta">${shortTime(item.generated_at)}</span>
                    ${item.record_url && html`
                      <a class="pf-aitr-row-link" href=${item.record_url} target="_blank" rel="noopener noreferrer">
                        ${t('aiTransparency.openRecord')}
                      </a>`}
                  </li>`)}
              </ul>
              ${report.unlabelled_detail
                && report.unlabelled_detail.shown < report.unlabelled_detail.total
                && html`<p class="pf-aitr-muted">
                  ${t('aiTransparency.showingOf', {
                    shown: String(report.unlabelled_detail.shown),
                    total: String(report.unlabelled_detail.total),
                  })}
                </p>`}
            `}

            ${(report.apps_declaring_generation_with_gap ?? []).length > 0 && html`
              <h4 class="pf-aitr-sub">${t('aiTransparency.appsWithGap')}</h4>
              <ul class="pf-aitr-list">
                ${report.apps_declaring_generation_with_gap.map(a => html`
                  <li key=${a.owner + '/' + a.filename} class="pf-aitr-row">
                    <span class="pf-aitr-row-main">${a.filename}</span>
                    <span class="pf-aitr-row-meta">${a.gap}</span>
                  </li>`)}
              </ul>`}
          `}

          ${policy && html`
            <h4 class="pf-aitr-sub">${t('aiTransparency.policyTitle')}</h4>
            <p class="pf-aitr-note">${policy.why}</p>
            <ul class="pf-aitr-list">
              ${(policy.records ?? []).map(r => html`
                <li key=${r.what} class="pf-aitr-policy">
                  <span class="pf-aitr-row-main">${r.what}</span>
                  <span class="pf-aitr-row-meta">${t('aiTransparency.retention')}: ${r.retention}</span>
                  <span class="pf-aitr-row-meta">${t('aiTransparency.neverContains')}: ${r.never_contains}</span>
                </li>`)}
            </ul>
            <p class="pf-aitr-note">${policy.note}</p>`}
        </div>`}
    </div>`;
}

export default AiTransparencyCard;
