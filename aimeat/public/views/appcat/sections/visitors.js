/**
 * @file public/views/appcat/sections/visitors.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The detail section "Visitors" (features F333–F337, F164–F165, F174, routes F224–F226):
 *   who opened this app, when, and from where, read from GET /v1/apps/visitors, the same answer the
 *   owner's AI gets from aimeat_app_visitors, so the screen and the chat never disagree.
 *
 *   TWO HALVES, AND THE SECOND IS OFF UNTIL ASKED FOR. Opens are always counted: how many in the
 *   window, by signed-in people and by nobody signed in, as five numbers and a chart. What KIND of
 *   visitor came (a person, a named AI, another bot) and where people came from is counted only once
 *   the owner switches measurement on, here; until then the section says so and shows no zeros that
 *   would read as "no AI ever came". The first switch-on starts at country precision when the node can
 *   place visitors at all. The places are drawn by components/WorldMap.js, the charts by
 *   components/SlotBars.js.
 *
 *   THE WINDOW IS THE READER'S, 0 TO 360 DAYS, 30 to start with, as on the node. It is kept for the
 *   page and not per app (a module variable, never the browser's storage): someone comparing their
 *   apps over the last quarter should not set 90 days again on each one. The shell draws the chapter
 *   line and the headline from `meta`; this is the body.
 * @structure meta · VisitorsSection({ d }) · windowWords · Opens · Measurement · Who · Where · clampWindow
 * @usage const mod = await import('./sections/visitors.js'); html`<${mod.default} d=${d} />`
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity pass (sections-b): the window is components/DayWindow.js; the intro
 *     and the notes in the old grey and size (Note hint 'intro', 'note'); the measurement rows as the
 *     old .mk-row (List tone "switches", the precision as the old underlined choice, Select line); the
 *     parts 30px apart under their rule headings (SubHeading rule="readout", Layout 'part'); the AI
 *     table as the old .vis-table (List tone "counts"); a read after a switch keeps the window's doors.
 *   v1.0.0 — 2026-09-27 — Initial: the old catalogue's js/visitors.js, visitors-map.js and
 *     visitors-model.js on components (appcat detail builder B).
 */
import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { SlotBars, slotsFromSeries } from '/components/SlotBars.js';
import { WorldMap } from '/components/WorldMap.js';
import { DayWindow } from '/components/DayWindow.js';
import { Select } from '/components/Select.js';
import { SubHeading } from '/components/SubHeading.js';
import { Space } from '/components/Layout.js';
import { List, Row, Name, Desc, Doors, Num } from '/components/List.js';
import { apiGet, apiPut } from '/js/api.js';
import { getSession } from '/js/services/auth.js';
import { calendar } from '/js/format.js';
import { x, lang } from '/views/appcat/i18n.js';
import { errorText, noticeKind } from '/views/appcat/sections/app-write.js';

const html = htm.bind(h);
const GEO_LEVELS = ['off', 'country', 'region', 'city'];
const PRESETS = [0, 7, 30, 90, 360];
const WINDOW_MAX = 360;
const WINDOW_DEFAULT = 30;

/** The window, kept for the page across apps (F164). */
let windowDays = WINDOW_DEFAULT;

export const meta = { id: 'visitors', title: 'visitors.title', show: (d) => !!(d && d.isOwnPublished) };

/** A day window the node will accept. Anything unreadable is the default, as on the node. */
export function clampWindow(raw) {
  const n = Number(raw);
  if (raw === '' || raw === null || raw === undefined || !Number.isFinite(n) || n < 0 || Math.floor(n) !== n) return WINDOW_DEFAULT;
  return Math.min(n, WINDOW_MAX);
}

/** A calendar day of the report ('YYYY-MM-DD') in the reader's own format; no zone can slide it. */
const day = (iso) => (iso ? calendar(iso) : '');

/** A stacked chart of one series over the report's window. */
function Chart({ report, series, title, parts }) {
  const s = slotsFromSeries(series, report.from, report.to, parts.map((p) => p.key));
  if (!s.max) return null;
  const tip = (bar) => day(bar.from) + (bar.to !== bar.from ? ' – ' + day(bar.to) : '') + ' · '
    + parts.map((p) => `${p.label} ${bar[p.key]}`).join(' · ');
  return html`<${SlotBars} title=${title} bars=${s.bars} parts=${parts} tip=${tip} keyed
    peak=${x(s.grain === 'week' ? 'visitors.maxPerWeek' : 'visitors.maxPerDay', { n: s.max })}
    from=${day(report.from)} to=${day(report.to)} />`;
}

/** The window's words, in appcat's table. */
const windowWords = () => ({ today: x('visitors.today'), days: (n) => x('visitors.days', { n }), label: x('visitors.daysLabel'), show: x('visitors.show') });

function Opens({ report }) {
  const o = report.opens;
  return html`
    <${FigureStrip} free items=${[
      { key: 'total', n: o.total, label: x(report.days === 0 ? 'visitors.opensToday' : 'visitors.opensInPeriod') },
      { key: 'in', n: o.signed_in, label: x('visitors.signedIn') },
      { key: 'anon', n: o.anonymous, label: x('visitors.anonymous') },
      { key: 'people', n: o.signed_in_people, label: x('visitors.signedInPeople') },
      { key: 'life', n: o.lifetime, label: x('visitors.lifetime') },
    ]} />
    ${o.total
      ? html`<${Chart} report=${report} series=${o.series} title=${x('visitors.opensChart')} parts=${[
        { key: 'signed_in', label: x('visitors.signedIn'), tone: 'ink' },
        { key: 'anonymous', label: x('visitors.anonymous'), tone: 'dim' },
      ]} />`
      : html`<${Note} kind="hint" size="note">${x('visitors.noOpens')}<//>`}
    <${Note} kind="hint" size="note">${x('visitors.opensNote')}<//>`;
}

function Measurement({ report, busy, onToggle, onGeo }) {
  const m = report.measurement;
  const meaning = m.on ? 'visitors.measureOn' : (report.visitors ? 'visitors.measurePaused' : 'visitors.measureOff');
  return html`<${Space} above="part"><${List} tone="switches">
    <${Row}>
      <${Name}>${x('visitors.measure')}<//>
      <${Desc}>${x(meaning)}<//>
      <${Doors}>${m.on
        ? html`<${Action} small disabled=${busy} onClick=${onToggle}>${x('visitors.turnOff')}<//>`
        : html`<${Loud} control disabled=${busy} onClick=${onToggle}>${x('visitors.turnOn')}<//>`}<//>
    <//>
    ${m.on || report.visitors ? html`<${Row}>
      <${Name}><label for="appcat-vis-geo">${x('visitors.geoLabel')}</label><//>
      <${Desc}>${x(m.geo_available ? 'visitors.geoMeaning.' + m.geo : 'visitors.geoUnavailable')}<//>
      <${Doors}><${Select} id="appcat-vis-geo" line fit value=${m.geo} disabled=${busy || !m.geo_available}
        onChange=${onGeo} options=${GEO_LEVELS.map((g) => [g, x('visitors.geo.' + g)])} /><//>
    <//>` : null}
  <//><//>`;
}

function Who({ report }) {
  const v = report.visitors;
  if (!v) return null;
  return html`
    <${SubHeading} rule="readout">${x('visitors.whoTitle')}<//>
    ${!v.total ? html`<${Note} kind="hint" size="note">${x('visitors.noneYet')}<//>` : html`
      <${FigureStrip} free items=${[
        { key: 'h', n: v.humans, label: x('visitors.humans') },
        { key: 'a', n: v.ai, label: x('visitors.ai') },
        { key: 'b', n: v.bots, label: x('visitors.bots') },
      ]} />
      <${Chart} report=${report} series=${v.series} title=${x('visitors.whoChart')} parts=${[
        { key: 'humans', label: x('visitors.humans'), tone: 'ink' },
        { key: 'ai', label: x('visitors.ai'), tone: 'coral' },
        { key: 'bots', label: x('visitors.bots'), tone: 'dim' },
      ]} />
      ${(v.ai_agents || []).length ? html`
        <${List} tone="counts" head=${[x('visitors.colAi'), { label: x('visitors.colAsked'), num: true }, { label: x('visitors.colCrawled'), num: true }]}>
          ${v.ai_agents.map((a) => html`<${Row} key=${a.name}><${Name}>${a.name}<//><${Num}>${a.asked}<//><${Num}>${a.crawled}<//><//>`)}
        <//>
        <${Note} kind="hint" size="note">${x('visitors.aiNote')}<//>` : html`<${Note} kind="hint" size="note">${x('visitors.noAi')}<//>`}`}`;
}

function Where({ report, words }) {
  const v = report.visitors;
  const m = report.measurement;
  if (!v) return null;
  // Places collected earlier stay readable after the precision goes back to off.
  if (m.geo === 'off' && !(v.countries || []).length) return null;
  return html`
    <${SubHeading} rule="readout">${x('visitors.whereTitle')}<//>
    <${WorldMap} key=${report.app} lang=${lang()} unknownCode=${v.unknown_country} words=${words}
      countries=${(v.countries || []).map((c) => ({ code: c.country, count: c.people }))}
      places=${(v.places || []).map((p) => ({ ...p, count: p.people }))} />
    <${Note} kind="hint" size="note">${x('visitors.whereNote')}<//>
    ${v.places_truncated ? html`<${Note} kind="hint" size="note">${x('visitors.placesTruncated')}<//>` : null}
    ${m.geo_attribution ? html`<${Note} kind="hint" size="note">${m.geo_attribution}<//>` : null}`;
}

/** The map's words, in appcat's table. */
function mapWords() {
  return {
    map: x('visitors.mapLabel'), loading: x('visitors.mapLoading'), failed: x('visitors.mapFailed'), empty: x('visitors.mapEmpty'),
    zoomIn: x('visitors.zoomIn'), zoomOut: x('visitors.zoomOut'), zoomInTitle: x('visitors.zoomInTitle'), zoomOutTitle: x('visitors.zoomOutTitle'),
    whole: x('visitors.zoomReset'), few: x('visitors.legendFew'), many: x('visitors.legendMany'),
    country: x('visitors.colCountry'), count: x('visitors.colPeople'), notDrawn: x('visitors.notDrawn'),
    unknownPlace: x('visitors.unknownPlace'), noPlaces: x('visitors.noPlaces'), counted: (n) => x('visitors.people', { n }),
  };
}

export default function VisitorsSection({ d }) {
  const appId = d.owner + '/' + d.filename;
  const [days, setDays] = useState(windowDays);
  const [state, setState] = useState('loading');   // 'loading' | 'ready' | 'error' | 'login'
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => { setReport(null); setBusy(false); }, [appId]);
  // A new app or a new window says it is loading (the window's doors wait); a read again after a
  // switch was changed does not, as on the old page (its load() after a PUT kept the doors).
  const shown = useRef('');
  useEffect(() => {
    if (!getSession()?.jwt) { setState('login'); setReport(null); return undefined; }
    let live = true;
    const asked = appId + '|' + days;
    if (shown.current !== asked) { shown.current = asked; setState('loading'); }
    apiGet('/v1/apps/visitors?app_id=' + encodeURIComponent(appId) + '&days=' + days)
      .then((res) => {
        if (!live) return;
        if (!res || !res.data) throw new Error('bad response');
        setReport(res.data); setState('ready');
      })
      // eslint-disable-next-line aimeat/no-silent-catch -- the 'error' state is said in words ("could not be loaded")
      .catch(() => { if (live) { setReport(null); setState('error'); } });
    return () => { live = false; };
  }, [appId, days, round]);

  const pickDays = (n) => { windowDays = clampWindow(n); setDays(windowDays); };
  const put = async (body, doneKey) => {
    if (busy || !report) return;
    setBusy(true);
    try {
      await apiPut('/v1/apps/visitors/measurement', { app_id: appId, ...body });
      // The kind the old page read from the words ("Saved." a success, "…is on." a plain notice).
      const done = x(doneKey);
      d.notice(done, noticeKind(done));
      setRound((n) => n + 1);
    } catch (err) {
      const why = errorText(err, x('visitors.saveFailed'));
      d.notice(why, noticeKind(why));
    }
    setBusy(false);
  };
  const toggle = () => {
    const m = report.measurement;
    if (m.on) { put({ on: false }, 'visitors.turnedOff'); return; }
    // A first switch-on starts at country precision when the node can place visitors: the map is what
    // the owner came for, and a country names nobody.
    const body = { on: true };
    if (m.geo === 'off' && !report.visitors && m.geo_available) body.geo = 'country';
    put(body, 'visitors.turnedOn');
  };
  const setGeo = (level) => { if (GEO_LEVELS.includes(level)) put({ on: report.measurement.on, geo: level }, 'visitors.geoSaved'); };

  const intro = html`<${Note} kind="hint" size="intro">${x('visitors.intro')}<//>`;
  if (state === 'login') return html`${intro}<${Note} kind="hint" size="note">${x('visitors.needLogin')}<//>`;
  if (state === 'error') return html`${intro}<${Note} kind="hint" size="note">${x('visitors.loadFailed')}<//>`;
  const win = html`<${DayWindow} days=${days} presets=${PRESETS} max=${WINDOW_MAX} busy=${state === 'loading'} id="appcat-vis-days"
    words=${windowWords()} onDays=${pickDays} />`;
  if (!report) return html`${intro}${win}<${Note} kind="hint" size="note">${x('visitors.loading')}<//>`;
  return html`${intro}${win}
    <${Opens} report=${report} />
    <${Measurement} report=${report} busy=${busy} onToggle=${toggle} onGeo=${setGeo} />
    <${Who} report=${report} />
    <${Where} report=${report} words=${mapWords()} />`;
}
