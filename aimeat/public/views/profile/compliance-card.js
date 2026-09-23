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
 *   2026-09-22 -- Composed from the shared set: the AI page's opening section, the four counts as a
 *     numeral band, the entries as key-value rows; it no longer uses the card rules in profile.css.
 *   2026-09-13 — V1: compose page and B1 section headings from the shared poster classes.
 *   v1.0.0 — 2026-08-23 — BR-02, the per-owner slice.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, tOr } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { NumeralBand, Stack, KeyValue, Chip, Text } from '/components/poster-parts.js';
import { CardSection, StatusLine } from './ai/frame.js';

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
    <${CardSection} id="compliance-mine" title=${t('complianceMine.title')} description=${t('complianceMine.desc')}
      open=${!collapsed} onToggle=${() => setCollapsed(c => !c)}>
      ${loading && html`<${Text} tone="muted">${t('complianceMine.loading')}<//>`}
      ${error && html`<${StatusLine} error=${true}>${error}<//>`}

      ${report && html`
        <${NumeralBand} tone="plain" size="small" items=${[
          { id: 'calls', label: t('complianceMine.calls'), value: usage.calls ?? 0 },
          { id: 'models', label: t('complianceMine.models'), value: models.length },
          { id: 'undocumented', label: t('complianceMine.undocumented'), value: undocumented.length, tone: undocumented.length > 0 ? 'coral' : undefined },
          { id: 'entries', label: t('complianceMine.entries'), value: entries.length },
        ]} />

        ${undocumented.length > 0 && html`
          <${Text} tone="coral">${t('complianceMine.undocumentedNote')}<//>
          <${Stack} direction="wrap" density="compact">${undocumented.map(m => html`<${Chip} key=${m}>${m}<//>`)}<//>
        `}

        ${entries.length > 0 && html`
          <${Text} kind="heading" size="small">${t('complianceMine.entriesTitle')}<//>
          <${Text} tone="muted">${t('complianceMine.entriesNote')}<//>
          <div>
            ${entries.map(e => html`<${KeyValue} key=${e.id} label=${e.title || e.id} value=${e.risk?.label || e.risk?.class || '—'} />`)}
          </div>
        `}

        ${entries.length === 0 && html`<${Text} tone="muted">${t('complianceMine.entriesEmpty')}<//>`}

        <${Text} kind="heading" size="small">${t('complianceMine.limitsTitle')}<//>
        <${Stack} density="compact">${(report.not_covered ?? []).map((l, i) => html`<${Text} key=${l.code || i}>${limitText(l)}<//>`)}<//>
      `}
    <//>
  `;
}
