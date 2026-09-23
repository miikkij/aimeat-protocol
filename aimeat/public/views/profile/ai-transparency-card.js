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
 *   2026-09-22 -- Composed from the shared set: the AI page's opening section, the four counts as a
 *     numeral band, every list a shared row; it no longer uses the card rules in profile.css.
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
import { NumeralBand, ListRow, Text, Action } from '/components/poster-parts.js';
import { CardSection, StatusLine } from './ai/frame.js';

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
    <${CardSection} id="ai-transparency" title=${t('aiTransparencyMine.title')} description=${t('aiTransparencyMine.desc')}
      open=${!collapsed} onToggle=${() => setCollapsed(c => !c)}>
      ${loading && html`<${Text} tone="muted">${t('aiTransparencyMine.loading')}<//>`}
      ${error && html`<${StatusLine} error=${true}>${error}<//>`}

      ${report && html`
        <${NumeralBand} tone="plain" size="small" items=${[
          { id: 'unlabelled', label: t('aiTransparencyMine.unlabelled'), value: unlabelled, tone: unlabelled > 0 ? 'coral' : undefined },
          { id: 'labelled', label: t('aiTransparencyMine.labelled'), value: report.labelled ?? 0 },
          { id: 'public', label: t('aiTransparencyMine.publicTotal'), value: report.public_total ?? 0 },
          { id: 'total', label: t('aiTransparencyMine.total'), value: report.total ?? 0 },
        ]} />

        <${Text} tone="muted">${t('aiTransparencyMine.scopeNote')}<//>

        ${unlabelled > 0 && html`
          <${Text} tone="coral">${t('aiTransparencyMine.unlabelledHelp')}<//>
          <div>
            ${(report.unlabelled_detail?.items ?? []).map(item => html`
              <${ListRow} key=${item.id} density="compact" name=${item.pipeline || t('aiTransparencyMine.unknownSource')}
                detail=${shortTime(item.generated_at)}
                actions=${item.record_url && html`<${Action} href=${item.record_url} target="_blank">${t('aiTransparencyMine.openRecord')}<//>`} />`)}
          </div>
          ${report.unlabelled_detail
            && report.unlabelled_detail.shown < report.unlabelled_detail.total
            && html`<${Text} kind="caption" tone="muted">
              ${t('aiTransparencyMine.showingOf', {
                shown: String(report.unlabelled_detail.shown),
                total: String(report.unlabelled_detail.total),
              })}
            <//>`}
        `}

        ${(report.apps_declaring_generation_with_gap ?? []).length > 0 && html`
          <${Text} kind="heading" size="small">${t('aiTransparencyMine.appsWithGap')}<//>
          <div>
            ${report.apps_declaring_generation_with_gap.map(a => html`
              <${ListRow} key=${a.owner + '/' + a.filename} density="compact" name=${a.filename} detailKind="text" detail=${a.gap} />`)}
          </div>`}
      `}

      ${policy && html`
        <${Text} kind="heading" size="small">${t('aiTransparencyMine.policyTitle')}<//>
        <${Text} tone="muted">${policy.why}<//>
        <div>
          ${(policy.records ?? []).map(r => html`
            <${ListRow} key=${r.what} density="compact" name=${r.what} detailKind="text"
              detail=${`${t('aiTransparencyMine.retention')}: ${r.retention}`}>
              <${Text} kind="caption" tone="muted">${t('aiTransparencyMine.neverContains')}: ${r.never_contains}<//>
            <//>`)}
        </div>
        <${Text} tone="muted">${policy.note}<//>`}
    <//>`;
}

export default AiTransparencyCard;
