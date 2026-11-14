/**
 * @file public/views/admin/help-tab.report.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Report and Status views of Admin › Ask someone who knows. Report: the stored
 *   reports by period, the one chosen with its figures (no names), the text the operator's AI wrote
 *   (Markdown), its suggestions with "Add to the development queue" and "Reject", and the prompt for
 *   the operator's own AI that writes it (aimeat_help_report_data, then aimeat_help_report_write with a
 *   dry run first), as the compliance page hands over its paste. Status: the month so far. The design
 *   canvas board "Raportti" (2026-11-14) is the model.
 * @structure Figures · TopicRows · Suggestions · HelpReport · HelpStatus
 * @usage html`<${HelpReport} showOk=${showOk} showErr=${showErr} />` · html`<${HelpStatus} />` (views/admin/help-tab.js)
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-pyyd-apua-nodessa-yhteinen-avunpyynt-v-yl-ihmisille-ja-heid-).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { swallowed } from '/js/swallowed.js';
import { dateTime } from '/js/format.js';
import { helpReports, writeHelpReport, helpStatus, reportPrompt } from '/js/services/help.js';
import { Section } from '/components/Section.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { List, Row, Name, Desc, Num, Doors } from '/components/List.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Mark, Code } from '/components/Mark.js';
import { Markdown } from '/components/Markdown.js';
import { Select } from '/components/Select.js';
import { SettingBox } from '/components/Box.js';
import { Stack } from '/components/Layout.js';

const html = htm.bind(h);
const x = (key, vars) => t(`admin.help.${key}`, vars);
const pct = (v) => (v === null || v === undefined ? '–' : `${Math.round(v * 100)} %`);

function Figures({ f }) {
  return html`<${FigureStrip} items=${[
    { n: f.asked, label: x('fig.asked'), sub: '' },
    { n: f.asked ? pct(f.solved / f.asked) : '–', label: x('fig.solved'), sub: x('fig.solvedSub', { n: f.solved }) },
    { n: f.median_first_answer_hours === null ? '–' : `${f.median_first_answer_hours} h`, label: x('fig.firstAnswer'), sub: '' },
    { n: f.kept_total, label: x('fig.kept'), sub: x('fig.keptSub', { n: f.kept_new, stale: f.kept_stale }) },
    { n: f.morsels_to_helpers, label: x('fig.morsels'), sub: '' },
    { n: f.nobody_found, tone: f.nobody_found ? 'coral' : undefined, label: x('fig.nobody'), sub: '' },
    { n: pct(f.top3_share), label: x('fig.top3'), sub: x('fig.top3Sub', { n: f.helpers_active, total: f.helpers_total }) },
  ]} />`;
}

function TopicRows({ report }) {
  return html`
    <${List} cols="name-num-num-num" head=${[x('colTopic'), x('colAsked'), x('colSolved'), x('colExpired')]} empty=${x('topicsEmpty')}
      rows=${report.topics}
      render=${(r) => html`<${Row} key=${r.topic}><${Name}>${r.topic}<//><${Num}>${r.asked}<//><${Num}>${r.solved}<//><${Num}>${r.expired}<//><//>`} />
    ${report.topics_without_helper?.length ? html`
      <${Note} kind="hint">${x('noHelperTopics')}<//>
      <${List} cols="name-num" head=${[x('colTopic'), x('colAsked')]}
        rows=${report.topics_without_helper}
        render=${(r) => html`<${Row} key=${r.topic}><${Name} tag=${x('noHelper')}>${r.topic}<//><${Num}>${r.asked}<//><//>`} />` : null}`;
}

function Suggestions({ report, decide, busy }) {
  if (!report.suggestions?.length) return null;
  return html`
    <${List} cols="name-desc-doors" head=${[x('colSuggestion'), x('colWhy'), '']}
      rows=${report.suggestions}
      render=${(s) => html`
        <${Row} key=${s.n}>
          <${Name} meta=${String(s.n)} tag=${s.status !== 'open' ? x(`sug.${s.status}`) : null}>${s.title}<//>
          <${Desc}>${s.why}<//>
          <${Doors}>
            ${s.status === 'open' ? html`
              <${Loud} small disabled=${busy} onClick=${() => decide(s.n, 'queue')}>${x('queue')}<//>
              <${Action} small soft disabled=${busy} onClick=${() => decide(s.n, 'reject')}>${x('reject')}<//>` : null}
          <//>
        <//>`} />`;
}

/** @param {{ showOk: (m: string) => void, showErr: (m: string) => void }} props */
export function HelpReport({ showOk, showErr }) {
  const [res, setRes] = useState(null);
  const [id, setId] = useState(() => new URLSearchParams(location.search).get('report') || '');
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setRes(await helpReports(id ? { id } : {})); setMissing(false); }
    catch (e) { swallowed('admin help: report', e); setRes(null); setMissing(true); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onLiveUpdate(['help-report'], () => load()), [load]);

  const make = async (kind) => {
    setBusy(true);
    try { const r = await helpReports({ make: kind }); setRes(r); setId(r?.report?.id || ''); setMissing(false); }
    catch (e) { swallowed('admin help: make', e); showErr(e?.message || t('common.error')); }
    finally { setBusy(false); }
  };
  const decide = async (n, decision) => {
    setBusy(true);
    try { await writeHelpReport(res.report.id, { decisions: [{ n, decision }] }); showOk(x(decision === 'queue' ? 'queuedDone' : 'rejectedDone')); await load(); }
    catch (e) { swallowed('admin help: decide', e); showErr(e?.message || t('common.error')); }
    finally { setBusy(false); }
  };

  const report = res?.report;
  const prompt = reportPrompt(report?.id || '');
  return html`
    <${Stack} gap="section">
      <${Section} id="ah-report" num="01" title=${report ? x('reportTitle', { id: report.id }) : x('reportNone')}
        doors=${html`<${Actions}>
          ${res?.reports?.length ? html`<${Select} fit line ariaLabel=${x('earlier')} value=${report?.id || ''} onChange=${setId}
            options=${res.reports.map((r) => [r.id, `${r.id}${r.written ? '' : ` · ${x('notWritten')}`}`])} />` : null}
          <${Action} small soft disabled=${busy} onClick=${() => make('monthly')}>${x('makeMonthly')}<//>
          <${Action} small soft disabled=${busy} onClick=${() => make('weekly')}>${x('makeWeekly')}<//>
        <//>`}>
        ${missing && !report ? html`<${Note} kind="quiet">${x('noReports')}<//>` : null}
        ${report ? html`
          <${Note} kind="report">${x('provenance', { at: dateTime(report.generated_at), reads: x(`reads.${report.reads}`), by: report.written_by ? x('writtenBy') : x('notWrittenYet') })}<//>
          <${Figures} f=${report.figures} />
          ${report.text ? html`<${Markdown} text=${report.text} />` : html`<${Note} kind="aside">${x('waitsForAi')}<//>`}
        ` : null}
      <//>
      ${report ? html`
        <${Section} id="ah-topics" num="02" title=${x('topicsTitle')}>
          <${TopicRows} report=${report} />
        <//>
        ${report.suggestions?.length ? html`
          <${Section} id="ah-suggestions" num="03" title=${x('suggestionsTitle')}>
            <${Suggestions} report=${report} decide=${decide} busy=${busy} />
          <//>` : null}
        ${report.previous?.suggestions?.length ? html`
          <${Section} id="ah-previous" num="04" title=${x('previousTitle', { id: report.previous.id })}>
            <${List} cols="name-state" rows=${report.previous.suggestions}
              render=${(s) => html`<${Row} key=${s.n}><${Name}>${s.title}<//><${Desc}><${Mark} kind="status" tone=${s.status === 'queued' ? 'fine' : 'off'}>${x(`sug.${s.status}`)}<//><//><//>`} />
          <//>` : null}` : null}
      <${Section} id="ah-prompt" num="05" title=${x('promptTitle')}
        doors=${html`<${Action} small soft copy=${prompt} copiedLabel=${x('copied')}>${x('copyPrompt')}<//>`}>
        <${Note} kind="lead">${x('promptLead')}<//>
        <${SettingBox} label=${x('promptLabel')}><${Code} block>${prompt}<//><//>
      <//>
    <//>`;
}

export function HelpStatus() {
  const [res, setRes] = useState(null);
  const load = useCallback(async () => {
    try { setRes(await helpStatus()); } catch (e) { swallowed('admin help: status', e); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onLiveUpdate(['help'], () => load()), [load]);
  if (!res) return html`<${Note} kind="loading" />`;
  return html`
    <${Section} id="ah-status" num="01" title=${x('statusTitle')}>
      <${Note} kind="lead">${x('statusLead')}<//>
      <${Figures} f=${res.report.figures} />
      <${TopicRows} report=${res.report} />
    <//>`;
}
