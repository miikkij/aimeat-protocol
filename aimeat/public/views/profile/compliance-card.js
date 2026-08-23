/**
 * @file compliance-card.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Your own slice of the compliance picture: what you did with AI here, and which of the
 *   operator's use-case entries name your account.
 *
 *   IT SITS BESIDE THE AI TRANSPARENCY CARD BECAUSE IT ANSWERS THE NEXT QUESTION. That card says
 *   what you published and how much of it carried a label. This one says what the whole of your AI
 *   activity looks like, and — the part nobody else can tell you — whether the person running this
 *   installation has written any of it down.
 *
 *   THE ENTRIES ARE READ-ONLY HERE, AND THAT IS THE HONEST SHAPE. The register belongs to whoever
 *   runs the installation. Giving an account an edit box on somebody else's document would promise
 *   a change it cannot make; what it gets instead is the truth that its activity is or is not
 *   accounted for, which is what it needs in order to go and ask.
 *
 *   ITS LIMITS ARE NOT THE OPERATOR'S. The node serves a different not_covered list for this ring
 *   (services/compliance-report.ts), because three of the operator's sentences would be false said
 *   to an account. This card renders whatever it is given rather than composing its own.
 * @structure
 *   - ComplianceCard — the collapsible card, mounted in the profile AI tab
 * @usage
 *   import { ComplianceCard } from './compliance-card.js';
 *   html`<${ComplianceCard} />`
 * @version-history
 *   v1.0.0 — 2026-08-23 — BR-02, the per-owner slice.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, tOr } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

/** One limit in the reader's language, falling back to the sentence the node sent. */
function limitText(item) {
  if (typeof item === 'string') return item;
  return tOr(`admin.compliance.limit.${item.code}`, item.text, { days: item.days });
}

export function ComplianceCard() {
  const [collapsed, setCollapsed] = useState(true);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (opts = {}) => {
    if (!opts.quiet) setLoading(true);
    setError(null);
    try {
      const r = await apiGet('/v1/compliance/report/mine');
      // Compare before setting, for the reason the sibling card documents: this re-reads on every
      // live event, and most of them have nothing to do with compliance. Re-setting an identical
      // object repaints a panel somebody is reading.
      setReport(prev => (JSON.stringify(prev) === JSON.stringify(r?.data ?? null) ? prev : (r?.data ?? null)));
    } catch (err) {
      setError(err?.message || t('complianceMine.loadFailed'));
    } finally {
      if (!opts.quiet) setLoading(false);
    }
  }, []);

  // Fetch only once opened: this sits inside the AI settings tab, and a request on every visit to
  // that tab would be work nobody asked for.
  useEffect(() => {
    if (!collapsed && !report) load().catch(err => swallowed('compliance-card: initial load', err));
  }, [collapsed, report, load]);

  useEffect(() => {
    const handler = () => { if (!collapsed) load({ quiet: true }).catch(err => swallowed('compliance-card: live reload', err)); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [collapsed, load]);

  const usage = report?.derived?.ai_usage ?? {};
  const entries = report?.register?.usecases ?? [];
  const models = usage.models ?? [];
  // The one sentence this card exists to be able to say. Their activity, measured against the
  // operator's document: is any of it written down, and how much is not.
  const documented = models.filter(m => entries.some(e => (e.models ?? []).includes(m)));
  const undocumented = models.filter(m => !documented.includes(m));

  return html`
    <div class="pf-card pf-cmp">
      <button type="button" class="pf-cmp-head" onClick=${() => setCollapsed(c => !c)}
              aria-expanded=${!collapsed}>
        <span class="section-title">${t('complianceMine.title')}</span>
        <span class="pf-cmp-chevron">${collapsed ? '+' : '−'}</span>
      </button>
      <p class="section-desc">${t('complianceMine.desc')}</p>

      ${!collapsed && html`
        <div class="pf-cmp-body">
          ${loading && html`<p class="pf-cmp-muted">${t('complianceMine.loading')}</p>`}
          ${error && html`<p class="pf-cmp-error">${error}</p>`}

          ${report && html`
            <div class="pf-cmp-stats">
              <div class="pf-cmp-stat">
                <span class="pf-cmp-num">${usage.calls ?? 0}</span>
                <span class="pf-cmp-lbl">${t('complianceMine.calls')}</span>
              </div>
              <div class="pf-cmp-stat">
                <span class="pf-cmp-num">${models.length}</span>
                <span class="pf-cmp-lbl">${t('complianceMine.models')}</span>
              </div>
              <div class=${'pf-cmp-stat' + (undocumented.length > 0 ? ' pf-cmp-stat-warn' : '')}>
                <span class="pf-cmp-num">${undocumented.length}</span>
                <span class="pf-cmp-lbl">${t('complianceMine.undocumented')}</span>
              </div>
              <div class="pf-cmp-stat">
                <span class="pf-cmp-num">${entries.length}</span>
                <span class="pf-cmp-lbl">${t('complianceMine.entries')}</span>
              </div>
            </div>

            ${undocumented.length > 0 && html`
              <p class="pf-cmp-note pf-cmp-note-warn">${t('complianceMine.undocumentedNote')}</p>
              <ul class="pf-cmp-models">
                ${undocumented.map(m => html`<li key=${m}><span class="mono">${m}</span></li>`)}
              </ul>
            `}

            ${entries.length > 0 && html`
              <h4 class="pf-cmp-sub">${t('complianceMine.entriesTitle')}</h4>
              <p class="pf-cmp-note">${t('complianceMine.entriesNote')}</p>
              <ul class="pf-cmp-entries">
                ${entries.map(e => html`
                  <li key=${e.id}>
                    <span class="pf-cmp-entry-title">${e.title || e.id}</span>
                    <span class="pf-cmp-entry-risk">${e.risk?.label || e.risk?.class || '—'}</span>
                  </li>
                `)}
              </ul>
            `}

            ${entries.length === 0 && html`<p class="pf-cmp-note">${t('complianceMine.entriesEmpty')}</p>`}

            <h4 class="pf-cmp-sub">${t('complianceMine.limitsTitle')}</h4>
            <ul class="pf-cmp-limits">
              ${(report.not_covered ?? []).map((l, i) => html`<li key=${l.code || i}>${limitText(l)}</li>`)}
            </ul>
          `}
        </div>
      `}
    </div>
  `;
}
