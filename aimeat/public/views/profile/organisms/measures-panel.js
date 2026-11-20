/**
 * @file public/views/profile/organisms/measures-panel.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The organism's own measures on its home page, for its creators and admins: each measure
 *   the reader keeps (`reports.measure.<organism>.<id>`, services/value/measures.ts) with its number over
 *   the last 30 days and its latest period, or the reason it could not be counted. Measures are made in
 *   chat, so the panel says so first, gives the sentence to say to one's own AI and the question mark
 *   (concept.organismMeasure). Reads GET /v1/organisms/:id/value and reads it again on a live update.
 *   Composed from library components only.
 * @structure MeasuresPanel({ org })
 * @usage html`<${MeasuresPanel} org=${org} />`
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-n-hy-ty-n-kyy-kulu-hy-ty-ja-k-yt-n-rytmi, organism measures).
 */
import { h } from 'preact';
import htm from 'htm';
import { useState, useEffect, useCallback } from 'preact/hooks';
import { t } from '/js/i18n.js';
import { num, date } from '/js/format.js';
import { apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { List, Row, Name, Desc, Cell, Doors } from '/components/List.js';
import { Note } from '/components/Note.js';
import { PromptCard } from '/components/PromptCard.js';
import { HelpTip } from '/components/HelpTip.js';
import { Stack, Row as Line } from '/components/Layout.js';

const html = htm.bind(h);
const x = (k, v) => t('organisms.measures.' + k, v);
const round = (n) => (n === null || n === undefined ? null : Math.round(n * 100) / 100);

/** The window's number with its unit, or the reason there is none. */
function valueWords(m) {
  if (m.problem) return x('problem.' + m.problem);
  if (m.value === null) return x('noNumber');
  return `${num(round(m.value))}${m.unit ? ` ${m.unit}` : ''}`;
}

/** "This week: 4" from the newest period of a measure counted per day, week or month. */
function latestWords(m) {
  const last = (m.series || []).at(-1);
  if (!last) return '';
  return x('latest', { period: last.period.length === 7 ? last.period : date(last.period), n: num(round(last.value) ?? 0) });
}

export function MeasuresPanel({ org }) {
  const [measures, setMeasures] = useState(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await apiGet(`/v1/organisms/${encodeURIComponent(org.id)}/value`);
      setMeasures(r?.data?.measures ?? []);
      setFailed(false);
    } catch (e) { swallowed('measures-panel: load', e); setFailed(true); }
  }, [org.id]);
  useEffect(() => { load(); }, [load]);
  // A new row or a new measure record arrives as a live update; nothing here asks on a timer.
  useEffect(() => onLiveUpdate(['organisms', 'memory'], () => load()), [load]);

  return html`
    <${Stack} gap="section">
      <${Line} align="end">
        <${Note} kind="lead">${x('how')}<//>
        <${HelpTip} term="concept.organismMeasure" label=${x('title')} />
      <//>
      ${failed ? html`<${Note} kind="quiet">${x('failed')}<//>` : html`
        <${List} cols="name-desc-state-doors" loading=${measures === null ? x('loading') : false}
          head=${[x('col.name'), x('col.latest'), x('col.value'), '']}
          empty=${html`<${Note} kind="quiet"><b>${x('emptyLead')}</b> ${x('emptyBody')}<//>`}>
          ${(measures || []).map((m) => html`
            <${Row} key=${m.id} faded=${!!m.problem}>
              <${Name} meta=${m.ws_id ? x('where', { ws: m.ws_name || m.ws_id }) : undefined}>${m.name}<//>
              <${Desc}>${latestWords(m)}<//>
              <${Cell}>${valueWords(m)}<//>
              <${Doors} />
            <//>`)}
        <//>`}
      <${Note}>${x('window')}<//>
      <${PromptCard} label=${x('promptLabel')} prompt=${x('prompt', { name: org.name })} copyLabel=${x('copy')} />
    <//>`;
}
