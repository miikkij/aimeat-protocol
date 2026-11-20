/**
 * @file public/views/admin/value-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin Value and rhythm page: what the node is used for and when, what happened to what
 *   AI made here, and what data passed through, without the data. Three node-wide reports from GET
 *   /v1/admin/usage/summary (report rhythm, value and data; services/value/), counts only: a feature or a
 *   data group with fewer than five owners behind it is left out by the server and the page says how
 *   many were. The person's own numbers are theirs and are not shown here.
 *
 *   The page draws library components only and writes no class (admin page group G3).
 * @structure Period · WhatIsUsed (01) · Rhythm (02) · AiResults (03) · DataPassed (04) · AskAi (05) ·
 *   ValueTab (default)
 * @usage Mounted by the admin dashboard tab router (views/admin.js), id `value`.
 * @version-history
 *   v1.0.1 — 2026-11-20 — Browser check: the rhythm rows keep a short value (the wait goes in the
 *     explanation), section 04 says why it is empty and shows the direction, the paste follows the
 *     period, one dashed box on the page, counts without a plural noun.
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-n-hy-ty-n-kyy-kulu-hy-ty-ja-k-yt-n-rytmi, phase 3).
 */
import { h, Fragment } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { num, Badge, Spinner, ErrorBox } from './shared.js';
import { Section } from '/components/Section.js';
import { Readings } from '/components/Readings.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Tabs } from '/components/Tabs.js';
import { Action } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { SettingBox } from '/components/Box.js';
import { Row, Beside } from '/components/Layout.js';
import * as api from '/js/services/admin.js';
import { swallowed } from '/js/swallowed.js';

const S = (key, params) => t('admin.value.' + key, params);

const PRESETS = ['7d', '30d', '90d', '365d'];
const DAYS = { '7d': 6, '30d': 29, '90d': 89, '365d': 364 };
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function rangeFor(period) {
  const today = new Date();
  const iso = (d) => d.toISOString().split('T')[0];
  const from = new Date(today);
  from.setDate(from.getDate() - (DAYS[period] ?? 29));
  return { from: iso(from), to: iso(today) };
}

/** A change as a signed percentage, or the word for a feature that had no calls before. */
function changeLabel(change) {
  if (change === null || change === undefined) return S('used.new');
  const pct = Math.round(change * 100);
  return `${pct > 0 ? '+' : ''}${pct} %`;
}

/** Bytes in the unit a person reads. */
function bytesLabel(b) {
  if (!b) return '0 B';
  if (b < 1024) return `${num(b)} B`;
  if (b < 1024 * 1024) return `${num(Math.round(b / 1024))} kB`;
  if (b < 1024 * 1024 * 1024) return `${num(Math.round(b / 1024 / 1024))} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function Period({ period, onPick }) {
  return html`
    <${Row} wrap>
      <${Note} kind="meta" inline>${S('period.label')}<//>
      <${Tabs} tone="filter" label=${S('period.label')} value=${period} onSelect=${onPick}
        items=${PRESETS.map(p => ({ value: p, label: S('period.' + p) }))} />
    <//>`;
}

/** Section 01: calls per feature in the period, against the period of the same length before it. */
function WhatIsUsed({ rhythm, control }) {
  const features = rhythm?.features ?? [];
  return html`
    <${Section} first id="adm-val-01" num="01" title=${S('used.title')} doors=${control}>
      <${Note} kind="lead">${S('used.lead')}<//>
      ${features.length === 0
        ? html`<${Note} kind="meta">${S('used.none')}<//>`
        : html`<${Readings} rows=${features.map((f, i) => ({
          key: f.feature,
          name: S('feature.' + f.feature),
          why: S('used.before', { n: num(f.previous) }),
          mark: html`<${Badge} type=${f.change === null ? 'info' : f.change >= 0 ? 'success' : 'muted'} label=${changeLabel(f.change)} />`,
          value: S('used.calls', { n: num(f.calls) }),
          last: i === features.length - 1,
        }))} />`}
    <//>`;
}

/** Section 02: the bursts, the week and the season of the node's calls. */
function Rhythm({ rhythm }) {
  const r = rhythm?.rhythm ?? { bursts: [], week: { days: 0, shares: null }, season: { months: 0, byMonth: null } };
  const bursts = (r.bursts ?? []).slice(0, 6);
  // The value column stays short; why a figure is not shown yet is said in the row's explanation.
  const weekReady = !!r.week?.shares;
  const week = weekReady
    ? WEEKDAYS.map((d, i) => `${S('weekday.' + d)} ${Math.round(r.week.shares[i] * 100)} %`).join(' · ')
    : S('rhythm.weekSoFar', { n: num(r.week?.days ?? 0) });
  const seasonReady = !!r.season?.byMonth;
  const season = seasonReady
    ? r.season.byMonth.map(m => `${m.month} ${m.vsMean > 0 ? '+' : ''}${Math.round(m.vsMean * 100)} %`).join(' · ')
    : S('rhythm.seasonSoFar', { n: num(r.season?.months ?? 0) });
  return html`
    <${Section} id="adm-val-02" num="02" title=${S('rhythm.title')}>
      <${Note} kind="lead">${S('rhythm.lead')}<//>
      <${Readings} rows=${[
    ...(bursts.length === 0
      ? [{ key: 'none', name: S('rhythm.bursts'), why: S('rhythm.burstsWhy'), mark: null, value: S('rhythm.noBursts') }]
      : bursts.map((b, i) => ({
        key: 'b' + b.day, name: i === 0 ? S('rhythm.bursts') : '', why: i === 0 ? S('rhythm.burstsWhy') : '',
        mark: html`<${Badge} type="warning" label=${S('rhythm.times', { n: b.times })} />`,
        value: S('rhythm.burstValue', { day: b.day, n: num(b.count), usual: num(b.usual) }),
      }))),
    { key: 'week', name: S('rhythm.week'), why: weekReady ? S('rhythm.weekWhy') : S('rhythm.weekWait'), mark: null, value: week },
    { key: 'season', name: S('rhythm.season'), why: seasonReady ? S('rhythm.seasonWhy') : S('rhythm.seasonWait'), mark: null, value: season, last: true },
  ]} />
    <//>`;
}

/** Section 03: what happened to what AI made on the node, per feature. */
function AiResults({ value }) {
  const s = value?.signals ?? {};
  const families = (value?.by_family ?? []).slice(0, 10);
  const made = (s.produced ?? 0) + (s.refined ?? 0);
  return html`
    <${Section} id="adm-val-03" num="03" title=${S('ai.title')}>
      <${Note} kind="lead">${S('ai.lead')}<//>
      <${FigureStrip} wrap items=${[
    { key: 'made', n: num(made), label: S('ai.made'), sub: S('ai.madeSub') },
    { key: 'corrected', n: num(s.corrected ?? 0), label: S('ai.corrected'), sub: S('ai.correctedSub') },
    { key: 'rejected', n: num(s.rejected ?? 0), label: S('ai.rejected'), sub: S('ai.rejectedSub') },
    { key: 'used', n: num(s.used ?? 0), label: S('ai.used'), sub: S('ai.usedSub') },
  ]} />
      ${families.length
        ? html`<${Readings} rows=${families.map((f, i) => ({
          key: f.family, name: f.family, why: S('ai.owners', { n: num(f.owners ?? 0) }), mark: null,
          value: S('ai.familyValue', { made: num((f.produced ?? 0) + (f.refined ?? 0)), corrected: num(f.corrected ?? 0), used: num(f.used ?? 0) }),
          last: i === families.length - 1,
        }))} />`
        : html`<${Note} kind="meta">${S('ai.none')}<//>`}
      ${value?.hidden_groups ? html`<${Note} kind="meta">${S('ai.hidden', { n: num(value.hidden_groups) })}<//>` : null}
    <//>`;
}

/**
 * Rows of one data grouping. A kind, a source and a size class have words in the locale (`prefix`); a
 * label and a content class are the node's own ids and are shown as they are.
 */
function dataRows(list, prefix, empty) {
  return (list ?? []).map((g, i, all) => ({
    key: (prefix || empty) + g.key,
    name: prefix ? S(prefix + (g.key || 'unknown')) : (g.key || S(empty)),
    why: g.owners !== undefined ? S('ai.owners', { n: num(g.owners) }) : '',
    mark: null,
    value: S('data.rowValue', { n: num(g.count), size: bytesLabel(g.bytes) }),
    last: i === all.length - 1,
  }));
}

/** Section 04: what data passed through, without the data. */
function DataPassed({ data }) {
  const d = data ?? {};
  const left = [...dataRows(d.by_kind, 'kind.'), ...dataRows(d.by_source, 'source.'), ...dataRows(d.by_direction, 'direction.'), ...dataRows(d.by_size, 'size.')];
  const right = [...dataRows(d.by_level, '', 'data.noLabel'), ...dataRows(d.by_class, '', 'data.noClass')];
  return html`
    <${Section} id="adm-val-04" num="04" title=${S('data.title')}>
      <${Note} kind="lead">${S('data.lead')}<//>
      <${FigureStrip} wrap items=${[
    { key: 'count', n: num(d.total?.count ?? 0), label: S('data.writes'), sub: bytesLabel(d.total?.bytes ?? 0) },
    { key: 'high', n: num(d.high_labels?.count ?? 0), label: S('data.high'), sub: S('data.highSub') },
    { key: 'hidden', n: num(d.hidden_groups ?? 0), tone: 'dim', label: S('data.hidden'), sub: S('data.hiddenSub') },
  ]} />
      ${left.length || right.length
        ? html`<${Beside} wide side=${html`<${Readings} rows=${right} />`}><${Readings} rows=${left} /><//>`
        : html`<${Note} kind="meta">${S('data.none')}<//>`}
      <${Note} kind="meta">${S('data.never')}<//>
    <//>`;
}

/** Section 05: the same numbers through the operator's own AI, over the period the page shows. */
function AskAi({ period }) {
  const paste = S('ask.prompt', { period: S('period.' + period) });
  return html`
    <${Section} id="adm-val-05" num="05" title=${S('ask.title')}
      doors=${html`<${Action} small soft copy=${paste}>${S('ask.copy')}<//>`}>
      <${Beside} wide side=${html`<${SettingBox} label=${S('ask.label')} pre>${paste}<//>`}>
        <${Note} kind="lead">${S('ask.lead')}<//>
        <${Readings} rows=${[
    { key: 'rhythm', name: S('ask.rhythm'), why: S('ask.rhythmWhy'), mark: null, value: 'aimeat_admin_usage · rhythm' },
    { key: 'value', name: S('ask.value'), why: S('ask.valueWhy'), mark: null, value: 'aimeat_admin_usage · value' },
    { key: 'data', name: S('ask.data'), why: S('ask.dataWhy'), mark: null, value: 'aimeat_admin_usage · data', last: true },
  ]} />
      <//>
    <//>`;
}

export default function ValueTab() {
  const [period, setPeriod] = useState('30d');
  const [state, setState] = useState(null);
  const [failed, setFailed] = useState(null);

  const load = useCallback(async (p) => {
    const range = rangeFor(p);
    const quiet = (err) => { swallowed('value-tab: load', err); return null; };
    const [rhythm, value, data] = await Promise.all([
      api.getUsageSummary('rhythm', range.from, range.to).catch(quiet),
      api.getUsageSummary('value', range.from, range.to).catch(quiet),
      api.getUsageSummary('data', range.from, range.to).catch(quiet),
    ]);
    if (!rhythm?.data && !value?.data && !data?.data) { setFailed(rhythm?.error?.message || S('failed')); return; }
    setFailed(null);
    setState({ rhythm: rhythm?.data ?? null, value: value?.data ?? null, data: data?.data ?? null });
  }, []);

  useEffect(() => { load(period); }, [period, load]);
  // What is used and what AI made follow every write on the node, so this page follows every live update.
  useEffect(() => onLiveUpdate(null, () => load(period)), [period, load]);

  if (!state) return failed ? html`<${ErrorBox} message=${failed} />` : html`<${Spinner} text=${S('loading')} />`;
  const control = html`<${Period} period=${period} onPick=${setPeriod} />`;
  return html`<${Fragment}>
    <${WhatIsUsed} rhythm=${state.rhythm} control=${control} />
    <${Rhythm} rhythm=${state.rhythm} />
    <${AiResults} value=${state.value} />
    <${DataPassed} data=${state.data} />
    <${AskAi} period=${period} />
  <//>`;
}
