/**
 * @file compliance-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard tab for the node-wide compliance report: the trail the node kept, the
 *   register the operator wrote, and what is in one and not the other.
 *
 *   THE GAPS COME FIRST, ABOVE THE TOTALS. A page that opens with big green numbers is read as a
 *   pass, and this page is not a scoreboard — it exists so somebody finds the thing nobody wrote
 *   down. What needs action goes at the top; the counts are evidence underneath it.
 *
 *   THE LIMITS ARE A SECTION, NOT A FOOTNOTE. `not_covered` is part of the measurement (see
 *   services/compliance-report.ts), so it is set in ordinary body text where a person reads it,
 *   never in small print under the fold. A report that reads as covering everything is itself the
 *   compliance risk this feature was built to remove.
 *
 *   EXPORT IS PRINT AND CSV, NOT A GENERATOR. PDF is the browser's own print-to-PDF against scoped
 *   print CSS, so what is exported is what is on screen and there is no second renderer to drift.
 *   CSV is built here from the same objects the tables render.
 * @structure
 *   - getWindow(period) — preset key → since_days
 *   - GapList / NotCovered / DerivedStats — the read-only halves
 *   - ComplianceTab (default) — the tab
 * @usage Registered in views/admin.js NAV_GROUPS; rendered with the shared admin tab props.
 * @version-history
 *   v1.0.0 — 2026-08-23 — BR-02, ring 1 (node-wide).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t, tOr } from '/js/i18n.js';
import { downloadBlob, toCsvBlob } from '/js/utils.js';
import { num, StatsGrid, DataTable, Empty, Spinner, ErrorBox, useToast, Toast, ExpandableHelp } from './shared.js';
import { apiGet, apiPut } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { RegisterSection, QuestionnaireSection } from './compliance-tab.register.js';

const PERIODS = [
  { key: '30d', days: 30 },
  { key: '90d', days: 90 },
  { key: '365d', days: 365 },
];

/** Gap kind → the sentence that says what to do about it. */
const GAP_LABEL = {
  'undocumented-ai-activity': 'admin.compliance.gapUndocumented',
  'unclassified-usecase': 'admin.compliance.gapUnclassified',
  'unlabelled-public-content': 'admin.compliance.gapUnlabelled',
  'app-declares-generation-with-gap': 'admin.compliance.gapAppGap',
};

/**
 * How to start, for the operator opening this for the first time.
 *
 * An empty register with a green "nothing needs a decision" reads as a finished page, and it is the
 * opposite: until somebody writes down what AI is used for here, the comparison has nothing on one
 * side and every model the node used counts as undocumented. The steps say that in order, and they
 * are collapsed after the first read rather than removed, because the fourth line — that an agent
 * can keep the register current — is the one nobody discovers on their own.
 */
function HowToStart({ empty }) {
  return html`
    <${ExpandableHelp} title=${t('admin.compliance.howTitle')} open=${empty}>
      <p class="adm-cmp-note">${t('admin.compliance.howIntro')}</p>
      <ol class="adm-cmp-steps">
        <li>${t('admin.compliance.howStep1')}</li>
        <li>${t('admin.compliance.howStep2')}</li>
        <li>${t('admin.compliance.howStep3')}</li>
      </ol>
      <p class="adm-cmp-note">${t('admin.compliance.howMonthly')}</p>
      <p class="adm-cmp-note">${t('admin.compliance.howAgent')}</p>
    <//>
  `;
}

function GapList({ gaps }) {
  if (!gaps?.length) {
    return html`
      <section class="adm-cmp-section">
        <h3>${t('admin.compliance.gapsTitle')}</h3>
        <${Empty} text=${t('admin.compliance.gapsNone')} />
      </section>
    `;
  }
  return html`
    <section class="adm-cmp-section adm-cmp-section--attention">
      <h3>${t('admin.compliance.gapsTitle')} <span class="adm-cmp-count">${num(gaps.length)}</span></h3>
      <ul class="adm-cmp-gaps">
        ${gaps.map((g, i) => html`
          <li key=${`${g.kind}-${i}`}>
            <span class="adm-cmp-gap-kind">${t(GAP_LABEL[g.kind]) || g.kind}</span>
            <span class="adm-cmp-gap-detail">${g.detail}</span>
          </li>
        `)}
      </ul>
    </section>
  `;
}

/**
 * What the report does not cover.
 *
 * Rendered as prose in the same size as everything else, and placed where a reader arrives at it
 * rather than at the very bottom. The list is served by the node, never composed here — the
 * sentences are derived from config and from the roll-up's own scope note, so a page that wrote its
 * own would drift away from what the node actually does.
 */
function NotCovered({ items }) {
  return html`
    <section class="adm-cmp-section">
      <h3>${t('admin.compliance.limitsTitle')}</h3>
      <p class="adm-cmp-note">${t('admin.compliance.limitsNote')}</p>
      <ul class="adm-cmp-limits">
        ${(items || []).map((s, i) => html`<li key=${s.code || i}>${limitText(s)}</li>`)}
      </ul>
    </section>
  `;
}

/**
 * One limit in the reader's language, falling back to the node's English.
 *
 * tOr() rather than t(): a node running a newer build can serve a code this surface has no string
 * for, and the English sentence is a better answer than the raw key. A limit that renders as
 * `admin.compliance.limit.something` is a limit nobody reads, on the one list that must be read.
 */
function limitText(item) {
  if (typeof item === 'string') return item;      // a node on the previous shape
  return tOr(`admin.compliance.limit.${item.code}`, item.text, { days: item.days });
}

function DerivedStats({ derived }) {
  const tr = derived?.ai_transparency ?? {};
  const usage = derived?.ai_usage ?? {};
  const consent = derived?.consent ?? {};
  return html`
    <${StatsGrid} items=${[
      { label: t('admin.compliance.statUnlabelled'), value: num(tr.unlabelled ?? 0), tone: (tr.unlabelled ?? 0) > 0 ? 'danger' : 'ok' },
      { label: t('admin.compliance.statLabelled'), value: num(tr.labelled ?? 0) },
      { label: t('admin.compliance.statPublic'), value: num(tr.public_total ?? 0) },
      { label: t('admin.compliance.statCalls'), value: num(usage.calls ?? 0) },
      { label: t('admin.compliance.statModels'), value: num((usage.models ?? []).length) },
      { label: t('admin.compliance.statConsent'), value: num(consent.active ?? 0) },
    ]} />
  `;
}

export default function ComplianceTab() {
  const [period, setPeriod] = useState('30d');
  const [report, setReport] = useState(null);
  const [questionnaire, setQuestionnaire] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [toastMsg, showError, showSuccess, clearToast] = useToast();

  const load = useCallback(async (p, { showSpinner = true } = {}) => {
    if (showSpinner) setLoading(true);
    try {
      const days = PERIODS.find(x => x.key === p)?.days ?? 30;
      const [rep, qs] = await Promise.all([
        apiGet(`/v1/admin/compliance/report?since_days=${days}`),
        apiGet('/v1/admin/compliance/questionnaire'),
      ]);
      if (rep?.data) setReport(rep.data);
      if (qs?.data) setQuestionnaire(qs.data.questionnaire);
      setError(null);
    } catch (e) {
      // Said plainly, because the operator reading this is the person who can fix it.
      setError(e?.message || t('admin.compliance.loadFailed'));
      swallowed('compliance-tab: load', e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(period); }, [period, load]);
  useEffect(() => onLiveUpdate(['compliance'], () => load(period, { showSpinner: false })), [period, load]);

  // The print stylesheet is scoped to this class, because every view's CSS is preloaded globally and
  // an unscoped @media print block would follow the reader onto every other page.
  useEffect(() => {
    document.body.classList.add('adm-compliance-active');
    return () => document.body.classList.remove('adm-compliance-active');
  }, []);

  const saveRegister = async (usecases) => {
    setSaving(true);
    try {
      // Strip the computed verdict before writing: `risk` is derived on read, and storing it would
      // create a second copy that goes stale the moment the question set changes.
      const clean = usecases.map(({ risk: _risk, ...rest }) => rest);
      await apiPut('/v1/admin/compliance/usecases', { usecases: clean });
      showSuccess(t('admin.compliance.saved'));
      await load(period, { showSpinner: false });
    } catch (e) {
      showError(e?.message || t('admin.compliance.saveFailed'));
      swallowed('compliance-tab: save', e);
    }
    setSaving(false);
  };

  /**
   * Ask the node for its own draft. Returns the entries, or null when it could not be read.
   *
   * Nothing is stored by this: the editor holds the draft unsaved so the operator reviews it and
   * presses Save, which is the approval step. The count in the toast is what the node worked out
   * without asking anybody, and it is the number worth seeing.
   */
  const loadDraft = async () => {
    setDrafting(true);
    try {
      const days = PERIODS.find(x => x.key === period)?.days ?? 30;
      const r = await apiGet(`/v1/admin/compliance/draft?since_days=${days}`);
      const d = r?.data;
      if (!d?.usecases) { showError(t('admin.compliance.draftFailed')); return null; }
      showSuccess(t('admin.compliance.draftLoaded')
        .replace('{entries}', d.counts.entries)
        .replace('{answered}', d.counts.answeredFromEvidence));
      return d.usecases;
    } catch (e) {
      showError(e?.message || t('admin.compliance.draftFailed'));
      swallowed('compliance-tab: draft', e);
      return null;
    } finally {
      setDrafting(false);
    }
  };

  const exportCsv = () => {
    if (!report) return;
    const rows = [];
    for (const u of report.register.usecases) {
      rows.push(['usecase', u.id, u.title || '', u.risk?.label || '', (u.models || []).join(' '), (u.apps || []).join(' '), u.purpose || '']);
    }
    for (const g of report.gaps) rows.push(['gap', g.kind, g.detail, '', '', '', '']);
    // The limits ride along in the same file. A CSV of findings with the scope left behind in the
    // browser is the export that overstates coverage, which is the one thing this must not produce.
    for (const s of report.not_covered) rows.push(['not_covered', s.code || '', limitText(s), '', '', '', '']);
    const headers = ['row', 'id_or_kind', 'title_or_detail', 'risk', 'models', 'apps', 'purpose'];
    const stamp = (report.scope?.generated_at || '').slice(0, 10);
    downloadBlob(toCsvBlob(headers, rows), `compliance-${report.scope?.node_id || 'node'}-${stamp}.csv`);
  };

  if (loading && !report) return html`<${Spinner} text=${t('admin.compliance.loading')} />`;
  if (error && !report) return html`<${ErrorBox} message=${error} />`;
  if (!report) return html`<${Empty} text=${t('admin.compliance.loadFailed')} />`;

  const period0 = report.scope?.period ?? {};

  return html`
    <div class="adm-cmp adm-cmp-print-area">
      ${toastMsg && html`<${Toast} type=${toastMsg.type} text=${toastMsg.text} onDismiss=${clearToast} />`}

      <div class="adm-time-range adm-cmp-no-print">
        <span class="adm-time-range-label">${t('dashboard.periodLabel')}:</span>
        ${PERIODS.map(p => html`
          <button key=${p.key} class="adm-time-btn ${period === p.key ? 'active' : ''}" onClick=${() => setPeriod(p.key)}>
            ${t(`admin.compliance.period${p.key}`)}
          </button>
        `)}
        <span class="adm-time-custom">
          <button type="button" class="btn-outline" onClick=${() => window.print()}>${t('admin.compliance.print')}</button>
          <button type="button" class="btn-outline" onClick=${exportCsv}>${t('admin.compliance.csv')}</button>
        </span>
      </div>

      <p class="adm-cmp-scope">
        ${t('admin.compliance.scopeLine')
          .replace('{id}', report.scope?.node_id || '')
          .replace('{from}', (period0.from || '').slice(0, 10))
          .replace('{to}', (period0.to || '').slice(0, 10))}
      </p>

      <${HowToStart} empty=${report.register.usecases.length === 0} />

      <${GapList} gaps=${report.gaps} />
      <${NotCovered} items=${report.not_covered} />

      <section class="adm-cmp-section">
        <h3>${t('admin.compliance.derivedTitle')}</h3>
        <p class="adm-cmp-note">${t('admin.compliance.derivedNote')}</p>
        <${DerivedStats} derived=${report.derived} />
        ${(report.derived?.ai_usage?.models || []).length > 0 && html`
          <${DataTable}
            headers=${[t('admin.compliance.modelsSeen')]}
            rows=${report.derived.ai_usage.models.map(m => [html`<span class="mono adm-cmp-small">${m}</span>`])}
          />
        `}
      </section>

      <${RegisterSection}
        usecases=${report.register.usecases}
        questionnaire=${questionnaire}
        saving=${saving}
        drafting=${drafting}
        onSave=${saveRegister}
        onDraft=${loadDraft}
      />

      <${QuestionnaireSection} questionnaire=${questionnaire} />
    </div>
  `;
}
