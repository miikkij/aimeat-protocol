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
 *   v1.11.0 — 2026-09-26 — Every part is a kit component (FigureStrip flush with the warn tone above zero, BoxList and BoxLine for the use-case entries, SubHeading, Code, Note, Layout): the card writes no class. A model name in the undocumented list is inline code (main's .mono) (page group G8).
 *   v1.10.0 — 2026-09-26 — A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v1.9.0 — 2026-09-26 — A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.8.0 — 2026-09-26 — A list of things to do or of steps is the numbered list (components/NumberedIndex.js: IndexList with IndexItem, or IndexStep for a step that opens nothing): the overview's next steps with the line under each name and the first on the sun, the Wallet key steps, a calibration run's proposals, the MCP and Agents connect steps, the basic agents, a server's setup steps (the number said once), the ecosystem steps out of their grey box, the decision rules' order and the notes of your own AI use; a place keeps only its margin (a unification: Jouni's decision "Numbered list").
 *   v1.7.0 — 2026-09-26 — A sentence that says what the part below is for is the lead (.og-lead): the ecosystem app's value line, the AI transparency's unlabelled line, the compliance card's undocumented note; their own rules go (a unification: the look most tabs use).
 *   v1.6.0 — 2026-09-26 — Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.5.0 — 2026-09-25 — A section that is one row until it is opened is the FoldSection (the folded row with its lead): the AI tab's decide, transparency and compliance cards and the classic AI settings; their own heads, chevrons and body rules go (a unification: the look most tabs use).
 *   v1.4.0 — 2026-09-25 — The last lines that say nothing is there are the quiet sentence (.poster-quiet); the ecosystem's empty frame goes, its second line is the Hint (Jouni's decision "Empty line", a unification).
 *   v1.3.0 — 2026-09-25 — A line that says a load or a save failed is the Form message in its error tone (.form-message--error); the error lines' own rules go (a unification: the look most tabs use).
 *   v1.2.0 — 2026-09-25 — The four figures are the figure strip (og-strip); the undocumented count keeps its warn colour as the strip's warn tone (a unification: the look most tabs use).
 *   v1.1.0 — 2026-09-25 — A grey help note is the Hint (poster-hint, components/Hint.js), as every other Settings hint (UI consolidation phase 5, a unification).
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
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
import { Hint } from '/components/Hint.js';
import { FoldSection } from '/components/FoldSection.js';
import { IndexList, IndexStep } from '/components/NumberedIndex.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { BoxList, BoxLine } from '/components/Box.js';
import { SubHeading } from '/components/SubHeading.js';
import { Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Space } from '/components/Layout.js';

/** One limit in the reader's language, falling back to the sentence the node sent. */
function limitText(item) {
  if (typeof item === 'string') return item;
  return tOr(`admin.compliance.limit.${item.code}`, item.text, { days: item.days });
}

/** A small heading inside the card, with main's space above it. */
const sub = (words) => html`<${Space} above="large"><${SubHeading} level=${4}>${words}<//><//>`;

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
    <${FoldSection} num="" title=${t('complianceMine.title')} lead=${t('complianceMine.desc')} open=${!collapsed} onToggle=${() => setCollapsed(c => !c)}>
      ${loading && html`<${Note} kind="loading">${t('complianceMine.loading')}<//>`}
      ${error && html`<${Note} kind="message" error>${error}<//>`}

      ${report && html`
        <${FigureStrip} flush items=${[
          { key: 'calls', n: usage.calls ?? 0, label: t('complianceMine.calls') },
          { key: 'models', n: models.length, label: t('complianceMine.models') },
          // Only a count above zero warns: a surface that is always red teaches people to stop looking.
          { key: 'undocumented', n: undocumented.length, tone: undocumented.length > 0 ? 'warn' : undefined, label: t('complianceMine.undocumented') },
          { key: 'entries', n: entries.length, label: t('complianceMine.entries') },
        ]} />

        ${undocumented.length > 0 && html`
          <${Note} kind="lead">${t('complianceMine.undocumentedNote')}<//>
          <${IndexList} steps>
            ${undocumented.map(m => html`<${IndexStep} key=${m}><${Code}>${m}<//><//>`)}
          <//>
        `}

        ${entries.length > 0 && html`
          ${sub(t('complianceMine.entriesTitle'))}
          <${Hint}>${t('complianceMine.entriesNote')}<//>
          <${BoxList} apart>
            ${entries.map(e => html`<${BoxLine} key=${e.id} name=${e.title || e.id} end=${e.risk?.label || e.risk?.class || '—'} />`)}
          <//>
        `}

        ${entries.length === 0 && html`<${Note} kind="quiet">${t('complianceMine.entriesEmpty')}<//>`}

        ${sub(t('complianceMine.limitsTitle'))}
        <${IndexList} steps>
          ${(report.not_covered ?? []).map((l, i) => html`<${IndexStep} key=${l.code || i}>${limitText(l)}<//>`)}
        <//>
      `}
    <//>
  `;
}
