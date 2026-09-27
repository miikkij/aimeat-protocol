/**
 * @file compliance-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin Compliance page in the poster face (design canvas "AIMEAT Admin Compliance",
 *   direction A). One read, GET /v1/admin/compliance/report, which the aimeat_compliance_report
 *   tool returns too, and seven sections in the order the tab was built for: what needs a look
 *   (the gaps grouped by kind, each with a door that does something about that kind), the numeral
 *   strip, what this does not cover (in the dashed coral box, before the numbers), what has
 *   happened here (the derived rows with a sentence each), what AI is used for (the register as a
 *   filterable table and one opened entry as a framed sheet), the questions themselves, the reports
 *   kept here and the paste for the operator's own AI. The printout is compliance-tab.print.js:
 *   the screen is the work and the document is the document.
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
 *   print CSS (components/PrintPage.js), so what is exported is what is on screen and there is no
 *   second renderer to drift. CSV is built here from the same objects the tables render.
 * @structure
 *   - limitText(item) · gapsLine(groups, empty) — the sentences
 *   - NeedsALook · Strip · Limits · Happened — sections 01 to 03
 *   - ComplianceTab (default) — the read, the register's unsaved list (held here so section 01's
 *     door and the empty state's slab reach it), save, draft, keep, the CSV
 * @usage Registered in views/admin.js NAV_GROUPS; rendered with the shared admin tab props.
 * @version-history
 *   v3.0.0 — 2026-09-27 — Library components only: the page prints through PrintPage (the body mark,
 *     the screen-only parts, the document), the period chooser is Tabs in the filter tone, the gaps
 *     the Verdict with Readings whose ends are the doors or the fine "clear" mark, the strip the
 *     FigureStrip whose figures are doors, the limits a List of codes in the SettingBox, the derived
 *     rows Readings in Columns. The page writes no class, and its own sheet (admin-compliance.css)
 *     is gone.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v2.1.0 — 2026-09-13 — Compose section headings from the shared poster B1 shape.
 *   v2.0.0 — 2026-09-05 — The poster face: the gaps grouped by kind with a door each, the limits in
 *     the dashed box before the numbers, the register as a table with a who-answered column and a
 *     framed sheet for an opened entry, the three ways to start in the register's empty state
 *     instead of a collapsible above everything, the unsaved list lifted here.
 *   v1.4.0 — 2026-08-23 — The kept reports have a reader, and a button that keeps one now. The
 *     monthly job had been writing them into a store no screen could open.
 *   v1.3.0 — 2026-08-23 — The CSV carries the answers too, from the same formatter the printed
 *     document uses, so the two files never disagree about one answer.
 *   v1.2.0 — 2026-08-23 — The printout carries the register in full. It used to print forty-three
 *     risk classes and none of the answers behind them, because the answers live in an editor that
 *     is closed until you open one entry.
 *   v1.1.0 — 2026-08-23 — A copy-paste for the operator's own AI, above the gap list. The page had
 *     the chat path in its instructions and nowhere to start it from.
 *   v1.0.0 — 2026-08-23 — BR-02, ring 1 (node-wide).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
import { t, tOr } from '/js/i18n.js';
import { downloadBlob, toCsvBlob } from '/js/utils.js';
import { num, Spinner, useToast, Toast } from './shared.js';
import { apiGet, apiPut, apiPost } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { groupGaps, answerStats, classCounts } from './compliance-tab.gaps.js';
import { RegisterSection, QuestionnaireSection, classWord } from './compliance-tab.register.js';
import { CompliancePromptSection } from './compliance-tab.prompt.js';
import PrintableReport, { answerText } from './compliance-tab.print.js';
import SavedReports, { readableId } from './compliance-tab.saved.js';
import { PrintPage, ScreenOnly } from '/components/PrintPage.js';
import { Section } from '/components/Section.js';
import { Verdict, Readings } from '/components/Readings.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Action, Actions } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Mark, Code } from '/components/Mark.js';
import { SettingBox } from '/components/Box.js';
import { Tabs } from '/components/Tabs.js';
import { Row as Line, Columns } from '/components/Layout.js';
import { List, Row, Cell } from '/components/List.js';

const html = htm.bind(h);
const C = (key, params) => t('admin.compliance.' + key, params);

const PERIODS = [
  { key: '30d', days: 30 },
  { key: '90d', days: 90 },
  { key: '365d', days: 365 },
];

/** Scroll a section into view; the strip's figures and the doors use it. */
const go = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
const money = (v) => `$${(Number(v) || 0).toFixed(2)}`;
const code = (s) => html`<${Code}>${s}<//>`;
const codes = (list) => list.map((m, i) => html`${i > 0 ? ' ' : ''}${code(m)}`);

/**
 * One limit in the reader's language, falling back to the node's English.
 *
 * tOr() rather than t(): a node running a newer build can serve a code this surface has no string
 * for, and the English sentence is a better answer than the raw key. A limit that renders as
 * `admin.compliance.limit.something` is a limit nobody reads, on the one list that must be read.
 */
export function limitText(item) {
  if (typeof item === 'string') return item;      // a node on the previous shape
  return tOr(`admin.compliance.limit.${item.code}`, item.text, { days: item.days });
}

/** The sentence beside the word: one clause per kind of gap, in the order the rows have. */
export function gapsLine(g, registerEmpty) {
  const parts = [];
  if (g.models.length > 0) {
    parts.push(registerEmpty ? C('line.modelsEmpty', { n: num(g.models.length) })
      : g.models.length === 1 ? C('line.modelsOne') : C('line.models', { n: num(g.models.length) }));
  }
  if (g.apps.length > 0) parts.push(g.apps.length === 1 ? C('line.appsOne') : C('line.apps', { n: num(g.apps.length) }));
  if (g.usecases.length > 0) parts.push(g.usecases.length === 1 ? C('line.unansweredOne') : C('line.unanswered', { n: num(g.usecases.length) }));
  if (g.unlabelled > 0) parts.push(g.unlabelled === 1 ? C('line.unlabelledOne') : C('line.unlabelled', { n: num(g.unlabelled) }));
  if (parts.length === 0) return C('gapsNone');
  const joined = parts.length === 1 ? parts[0]
    : parts.slice(0, -1).join(C('line.sep')) + C('line.last') + parts[parts.length - 1];
  return joined.charAt(0).toUpperCase() + joined.slice(1) + '.';
}

/** Section 01: the word, its sentence, the line under it, and one row per kind of gap. */
function NeedsALook({ report, g, stats, questions, drafting, onDraft, onAnswer, switchPage }) {
  const empty = report.register.usecases.length === 0;
  const tr = report.derived?.ai_transparency || {};
  const clear = html`<${Mark} kind="status" tone="fine">${C('clear')}<//>`;
  const door = (label, onClick, disabled) => html`<${Action} small soft disabled=${disabled} onClick=${onClick}>${label}<//>`;
  const n = g.models.length;
  const undocWhy = n === 0 ? C('gap.undocumentedClear')
    : empty ? C('gap.undocumentedEmpty', { n: num(n) })
    : html`${C('gap.undocumentedWhy', { n: num(n) })} ${codes(g.models)}. ${C('gap.undocumentedDraft')}`;
  const appsWhy = g.apps.length === 0 ? C('gap.appsClear')
    : html`${g.apps.map((a, i) => html`${i > 0 ? ', ' : ''}${code(a.app)} (${a.inRegister ? C('gap.appIn') : C('gap.appOut')})`)} ${g.apps.length === 1 ? C('gap.appsWhyOne') : C('gap.appsWhy')}`;
  const ucWhy = g.usecases.length === 0 ? C('gap.unansweredClear')
    : g.usecases.map((u, i) => html`${i > 0 ? ' ' : ''}${code(u.id)} ${C('gap.unansweredWhy', { n: num(u.unanswered.length), total: num(questions.length) })}`);
  const unlWhy = g.unlabelled === 0
    ? C('gap.unlabelledClear', { labelled: num(tr.labelled ?? 0), unlabelled: num(tr.unlabelled ?? 0) })
    : C('gap.unlabelledWhy', { n: num(g.unlabelled) });
  const word = g.total === 0 ? C('word.clear') : g.total === 1 ? C('word.one') : C('word.many', { n: num(g.total) });
  const under = empty ? C('under.empty', { questions: num(questions.length) })
    : C('under.filled', { entries: num(stats.entries), questions: num(questions.length), ai: num(stats.ai), human: num(stats.human), evidence: num(stats.evidence) });
  const toApps = () => switchPage('apps');
  return html`
    <${Section} first id="adm-cmp-01" num="01" title=${C('gapsTitle')} doors=${door(C('toApps'), toApps)}>
      <${Verdict} word=${word} tone=${g.total > 0 ? 'danger' : undefined} line=${gapsLine(g, empty)} stamp=${under}>
        <${Readings} rows=${[
          { key: 'undocumented', name: C('gapUndocumented'), why: undocWhy,
            end: n === 0 ? clear : door(drafting ? C('drafting') : C('draftAction'), onDraft, drafting) },
          { key: 'apps', name: C('gapAppGap'), why: appsWhy, end: g.apps.length === 0 ? clear : door(C('toApps'), toApps) },
          { key: 'unclassified', name: C('gapUnclassified'), why: ucWhy,
            end: g.usecases.length === 0 ? clear : door(C('answer'), () => onAnswer(g.usecases[0].id)) },
          { key: 'unlabelled', name: C('gapUnlabelled'), why: unlWhy, end: g.unlabelled === 0 ? clear : door(C('toApps'), toApps), last: true },
        ]} />
      <//>
    <//>`;
}

/** The numeral strip: five figures, each a door to the section that explains it. */
function Strip({ report, g, classes }) {
  const d = report.derived || {};
  const tr = d.ai_transparency || {};
  const usage = d.ai_usage || {};
  const consent = d.consent || {};
  const entries = report.register.usecases.length;
  const cell = (key, onClick, value, label, sub, hot) => ({ key, onClick, n: value, label, sub: sub || undefined, tone: hot ? 'notice' : undefined });
  const entriesSub = entries === 0 ? C('strip.entriesEmpty') : classes.map(c => `${classWord(c.cls)} ${num(c.n)}`).join(' · ');
  const publicSub = (tr.unlabelled ?? 0) === 0 && (tr.public_total ?? 0) > 0
    ? C('strip.publicSubAll')
    : C('strip.publicSub', { labelled: num(tr.labelled ?? 0), unlabelled: num(tr.unlabelled ?? 0) });
  return html`<${FigureStrip} wrap items=${[
    cell('gaps', () => go('adm-cmp-01'), num(g.total), C('strip.gaps'),
      C('strip.gapsSub', { models: num(g.models.length), apps: num(g.apps.length), unanswered: num(g.usecases.length) }), g.total > 0),
    cell('calls', () => go('adm-cmp-03'), num(usage.calls ?? 0), C('strip.calls'),
      C('strip.callsSub', { cost: money(usage.cost_usd), unpriced: num(usage.unpriced_calls ?? 0), models: num((usage.models || []).length) })),
    cell('public', () => go('adm-cmp-03'), num(tr.public_total ?? 0), C('strip.public'), publicSub),
    cell('entries', () => go('adm-cmp-04'), num(entries), C('strip.entries'), entriesSub),
    cell('consent', () => go('adm-cmp-03'), num(consent.active ?? 0), C('strip.consent'),
      C('strip.consentSub', { revoked: num(consent.revoked ?? 0), days: num(consent.audit_retention_days ?? 0) })),
  ]} />`;
}

/**
 * Section 02: what the report does not cover, in the dashed coral box, before the numbers.
 *
 * The list is served by the node, never composed here — the sentences are derived from config and
 * from the roll-up's own scope note, so a page that wrote its own would drift away from what the
 * node actually does.
 */
function Limits({ items }) {
  const list = items || [];
  return html`
    <${Section} id="adm-cmp-02" num="02" title=${C('limitsTitle')}>
      <${SettingBox} label=${C('limitsLabel')}>
        <${Note} kind="hint">${C('limitsNote')}<//>
        <${List} cols="tag-name" rows=${list} render=${(s, i) => html`
          <${Row} key=${s.code || i}>
            <${Cell} sign>${s.code || ''}<//>
            <${Cell}>${limitText(s)}<//>
          <//>`} />
      <//>
    <//>`;
}

/** Section 03: what the node derived by itself, one row per number with the sentence behind it. */
function Happened({ derived, switchPage }) {
  const tr = derived?.ai_transparency || {};
  const usage = derived?.ai_usage || {};
  const consent = derived?.consent || {};
  const breakdown = (obj, prefix) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${tOr(`admin.compliance.${prefix}.${k}`, k)} ${num(v)}`).join(' · ') || C('none');
  const scopes = Object.entries(consent.by_scope || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${num(v)} ${k}`).join(', ') || C('none');
  const models = usage.models || [];
  const appsGap = tr.apps_declaring_generation_with_gap;
  const appsGapCount = Array.isArray(appsGap) ? appsGap.length : Number(appsGap) || 0;
  const row = (key, title, why, value, last) => ({ key, name: title, why, value, last });
  return html`
    <${Section} id="adm-cmp-03" num="03" title=${C('derivedTitle')}
      doors=${html`<${Action} small soft onClick=${() => switchPage('usage')}>${C('toUsage')}<//>`}>
      <${Note} kind="lead">${C('derivedNote')}<//>
      <${Columns}>
        <div>
          <${Readings} rows=${[
            row('public', C('row.public'), C('row.publicWhy', { labelled: num(tr.labelled ?? 0), unlabelled: num(tr.unlabelled ?? 0) }), num(tr.public_total ?? 0)),
            row('level', C('row.level'), C('row.levelWhy'), breakdown(tr.public_by_level, 'level')),
            row('involvement', C('row.involvement'), C('row.involvementWhy'), breakdown(tr.public_by_human_involvement, 'involvement')),
            row('appsGap', C('row.appsGap'), C('row.appsGapWhy'), num(appsGapCount), true),
          ]} />
        </div>
        <div>
          <${Readings} rows=${[
            row('calls', C('row.calls'), C('row.callsWhy', {
              prompt: num(usage.prompt_tokens ?? 0), completion: num(usage.completion_tokens ?? 0),
              cost: money(usage.cost_usd), unpriced: num(usage.unpriced_calls ?? 0),
            }), num(usage.calls ?? 0)),
            row('models', C('row.models'), models.length > 0 ? codes(models) : C('row.modelsNone'), num(models.length)),
            row('consent', C('row.consent'), C('row.consentWhy', {
              scopes, revoked: num(consent.revoked ?? 0), expired: num(consent.expired ?? 0), days: num(consent.audit_retention_days ?? 0),
            }), num(consent.active ?? 0), true),
          ]} />
        </div>
      <//>
    <//>`;
}

export default function ComplianceTab(props) {
  const { switchPage } = props;
  const [period, setPeriod] = useState('30d');
  const [report, setReport] = useState(null);
  const [questionnaire, setQuestionnaire] = useState(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [keeping, setKeeping] = useState(false);
  const [kept, setKept] = useState(0);
  const [draft, setDraft] = useState(null);       // the register as edited, null while untouched
  const [openId, setOpenId] = useState(null);
  const [toastMsg, showError, showSuccess, clearToast] = useToast();
  const days = PERIODS.find(p => p.key === period)?.days ?? 30;

  const load = useCallback(async (d) => {
    try {
      const [rep, qs] = await Promise.all([
        apiGet(`/v1/admin/compliance/report?since_days=${d}`),
        apiGet('/v1/admin/compliance/questionnaire'),
      ]);
      if (rep?.data) setReport(rep.data);
      if (qs?.data) setQuestionnaire(qs.data.questionnaire);
      setFailed(false);
    } catch (e) {
      setFailed(true);
      swallowed('compliance-tab: load', e);
    }
  }, []);

  useEffect(() => { load(days); }, [days, load]);
  useEffect(() => onLiveUpdate(['compliance'], () => load(days)), [days, load]);

  const saveRegister = async (list) => {
    setSaving(true);
    try {
      // Strip the computed verdict before writing: `risk` is derived on read, and storing it would
      // create a second copy that goes stale the moment the question set changes.
      const clean = list.map(({ risk: _risk, ...rest }) => rest);
      await apiPut('/v1/admin/compliance/usecases', { usecases: clean });
      showSuccess(C('saved'));
      setDraft(null);
      await load(days);
    } catch (e) {
      showError(e?.message || C('saveFailed'));
      swallowed('compliance-tab: save', e);
    }
    setSaving(false);
  };

  /**
   * Ask the node for its own draft and merge it into the unsaved list.
   *
   * Merged, not replaced: an operator who has already written entries keeps them, and the draft
   * adds what is missing, matched by id, which the draft derives from the agent or app name.
   * Nothing is stored by this: the list stays unsaved until Save, which is the approval step.
   */
  const loadDraft = async () => {
    setDrafting(true);
    try {
      const r = await apiGet(`/v1/admin/compliance/draft?since_days=${days}`);
      const d = r?.data;
      if (!d?.usecases) { showError(C('draftFailed')); return; }
      setDraft((prev) => {
        const base = prev ?? report.register.usecases;
        const have = new Set(base.map(u => u.id));
        return [...base, ...d.usecases.filter(u => !have.has(u.id))];
      });
      setOpenId(null);
      showSuccess(C('draftLoaded', { entries: num(d.counts?.entries ?? d.usecases.length), answered: num(d.counts?.answeredFromEvidence ?? 0) }));
      go('adm-cmp-04');
    } catch (e) {
      showError(e?.message || C('draftFailed'));
      swallowed('compliance-tab: draft', e);
    } finally {
      setDrafting(false);
    }
  };

  const answerEntry = (id) => {
    setOpenId(id);
    setTimeout(() => go('adm-cmp-sheet'), 80);
  };

  const keepNow = async () => {
    setKeeping(true);
    try {
      const r = await apiPost('/v1/admin/compliance/snapshot', { since_days: days });
      showSuccess(C('savedDone', { id: readableId(r?.data?.id || '') }));
      setKept(k => k + 1);
    } catch (e) {
      showError(e?.message || C('savedFailed'));
      swallowed('compliance-tab: keep', e);
    }
    setKeeping(false);
  };

  const exportCsv = () => {
    if (!report) return;
    const headers = ['row', 'id_or_kind', 'title_or_detail', 'risk', 'models', 'apps', 'purpose', 'answer', 'answered_by'];
    const pad = (r) => [...r, ...Array(headers.length - r.length).fill('')];
    const rows = [];
    const questions = questionnaire?.questions || [];
    for (const u of report.register.usecases) {
      rows.push(pad(['usecase', u.id, u.title || '', u.risk?.label || '', (u.models || []).join(' '), (u.apps || []).join(' '), u.purpose || '']));
      // One row per question, under its entry. Without these the file carries a verdict per entry
      // and nothing anyone could check it against, which is the same overstatement the printed
      // document was fixed for. `answered_by` sits beside the answer because that is the column an
      // auditor reads next.
      for (const q of questions) {
        rows.push(pad(['answer', u.id, q.text, '', '', '', '',
          answerText(q, u.answers?.[q.id]) || '', u.answerSources?.[q.id] || '']));
      }
    }
    for (const g of report.gaps) rows.push(pad(['gap', g.kind, g.detail]));
    // The limits ride along in the same file. A CSV of findings with the scope left behind in the
    // browser is the export that overstates coverage, which is the one thing this must not produce.
    for (const s of report.not_covered) rows.push(pad(['not_covered', s.code || '', limitText(s)]));
    const stamp = (report.scope?.generated_at || '').slice(0, 10);
    downloadBlob(toCsvBlob(headers, rows), `compliance-${report.scope?.node_id || 'node'}-${stamp}.csv`);
  };

  const toast = toastMsg && html`<${Toast} type=${toastMsg.type} text=${toastMsg.text} onDismiss=${clearToast} />`;

  if (!report) {
    return html`
      ${toast}
      ${failed ? html`<${Note} kind="quiet">${C('loadFailed')}<//>` : html`<${Spinner} text=${C('loading')} />`}`;
  }

  const scope = report.scope || {};
  const period0 = scope.period || {};
  const questions = questionnaire?.questions || [];
  const usecases = report.register.usecases;
  const g = groupGaps(report.gaps);
  const stats = answerStats(usecases, questions);
  const classes = classCounts(usecases);

  // The print sheet is scoped to the body's mark, which PrintPage sets while this page is open,
  // because every view's CSS is preloaded globally and an unscoped @media print block would follow
  // the reader onto every other page.
  return html`
    <${PrintPage}>
      <${ScreenOnly}>
        ${toast}
        <${Note} kind="lead">${C('intro')}<//>
        <${Line} wrap justify="between" gap="large" below="small">
          <${Line} wrap gap="medium">
            <${Tabs} tone="filter" value=${period} onSelect=${setPeriod}
              items=${PERIODS.map(p => ({ value: p.key, label: C('period' + p.key) }))} />
            <${Note} kind="meta" inline mono>${C('scope', {
              id: scope.node_id || '', from: (period0.from || '').slice(0, 10), to: (period0.to || '').slice(0, 10), v: questionnaire?.version || '',
            })}<//>
          <//>
          <${Actions}>
            <${Action} small soft onClick=${() => window.print()}>${C('print')}<//>
            <${Action} small soft onClick=${exportCsv}>${C('csv')}<//>
            <${Action} small soft disabled=${keeping} onClick=${keepNow}>${keeping ? C('savedSaving') : C('savedNow')}<//>
          <//>
        <//>
        <${NeedsALook} report=${report} g=${g} stats=${stats} questions=${questions}
          drafting=${drafting} onDraft=${loadDraft} onAnswer=${answerEntry} switchPage=${switchPage} />
        <${Strip} report=${report} g=${g} classes=${classes} />
        <${Limits} items=${report.not_covered} />
        <${Happened} derived=${report.derived} switchPage=${switchPage} />
        <${RegisterSection} usecases=${usecases} questions=${questions}
          draft=${draft} setDraft=${setDraft} openId=${openId} setOpenId=${setOpenId}
          saving=${saving} drafting=${drafting} onSave=${saveRegister} onDraft=${loadDraft} />
        <${QuestionnaireSection} questionnaire=${questionnaire} />
        <${Columns}>
          <${SavedReports} refresh=${kept} keeping=${keeping} onKeep=${keepNow} onError=${showError} />
          <${CompliancePromptSection} nodeId=${scope.node_id} days=${days} />
        <//>
      <//>
      <${PrintableReport} report=${report} questionnaire=${questionnaire} />
    <//>
  `;
}
