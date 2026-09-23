/**
 * @file scheduler-calendar.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile › Scheduler calendar — day / week / month views of when every
 *   enabled schedule fires, so the owner can see cadence at a glance ("how often does
 *   this run?"). Fire-times come from GET /v1/schedules/occurrences (croner projection
 *   on the server — the same engine that actually runs the jobs), joined client-side to
 *   the schedule records for kind / name / colour. Clicking an event scrolls to and
 *   flashes that schedule's card (or extension row) below via the onJumpTo callback.
 * @structure SchedulerCalendar (default) — mode + anchor state, windowed occurrence
 *   fetch, and the month / week / day renderers (+ small kind legend).
 * @usage
 *   import SchedulerCalendar from './scheduler-calendar.js';
 *   <${SchedulerCalendar} schedules=${[...managed, ...extensions]} reloadKey=${tick} onJumpTo=${jump} />
 * @version-history
 *   2026-09-22 -- Composed from the shared component set: the month and the week are Tables, the
 *     day is a timeline of ListRows, the modes are tabs, the kinds a row of chips; no own CSS. A
 *     kind is named in the legend but no longer coloured on each event (the set has no toned event
 *     mark), a past event reads quieter, and the prev/next arrows are the site's arrow glyphs.
 *   2026-09-13 -- V2w: compose remaining profile section top rules from poster.css.
 *   v1.0.0 -- 2026-07-03 -- Initial day/week/month scheduler calendar (server-projected cron cadence)
 *   v1.1.0 -- 2026-07-17 -- Continuous / high-frequency schedules (server `frequent` summary — per-minute /
 *     hourly crons) no longer flood the grid: they render once in a "Continuously running" strip above the
 *     calendar as cadence pills (every-N-min · ~N/day), clickable to jump to the card. A "show in grid"
 *     toggle folds them back in as aggregated ⟳ ×N/day chips (week/day columns, a ⟳×count badge in month).
 */
import { h } from 'preact';
import htm from 'htm';
import { useState, useMemo, useEffect, useCallback } from 'preact/hooks';
import { t } from '/js/i18n.js';
import { listScheduleOccurrences } from '/js/services/schedules.js';
import { swallowed } from '/js/swallowed.js';
import { time, calendar, dayKey } from '/js/format.js';
import { Stack, Table, ListRow, Surface, Action, Chip, Text } from '/components/poster-parts.js';

const html = htm.bind(h);

// ── date helpers (browser — real Date is fine here) ──
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfWeek(d) { const x = startOfDay(d); const wd = (x.getDay() + 6) % 7; return addDays(x, -wd); } // Monday-first
function startOfMonth(d) { const x = startOfDay(d); x.setDate(1); return x; }
/**
 * A grid cell's own identity: the calendar date it stands for, as `YYYY-MM-DD`.
 *
 * The cells are enumerated with local Date arithmetic, which is fine — they are dates, not moments.
 * What has to agree with them is where an OCCURRENCE lands, and an occurrence is a moment. Both
 * sides are therefore reduced to a day string, the cell from its own components and the moment
 * through the reader's chosen clock. Compared as Date objects instead, a reader on a zone other
 * than their browser's saw an event drawn at 06.30 sitting in the cell for the day before.
 */
function cellDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function sameDay(a, b) { return cellDay(a) === cellDay(b); }

/**
 * TODAY, as the reader's clock has it, expressed as a cell the grid can enumerate from.
 *
 * The grid walks local Dates, which is right — a cell is a date. Where it starts is not a matter of
 * local arithmetic though: a reader keeping a clock seven hours ahead is already on tomorrow, and
 * the grid opened on the browser's yesterday and highlighted the wrong square. The day comes from
 * their zone and is then carried into a local Date so the walk is unchanged.
 */
function readerToday() {
  const key = dayKey(new Date());
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!parts) return startOfDay(new Date());
  return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
}
/** Whether a moment falls on a given cell's date, in the reader's own clock. */
function fallsOn(at, cell) { return dayKey(at) === cellDay(cell); }
function fmtTime(d) { return time(d, { hour: '2-digit', minute: '2-digit' }); }

/** Schedule kind → the short kind id the legend groups by. */
function kindClass(type) {
  return ({ ai: 'ai', agent_task: 'agent', extension: 'ext', 'eco-capability': 'eco' })[type] || 'core';
}
/** i18n label key for a schedule kind (falls back to the raw type). */
function kindLabel(type) {
  const known = { ai: 'ai', agent_task: 'agent_task', extension: 'extension', 'eco-capability': 'eco-capability', core: 'core' };
  return known[type] ? 'profile.scheduler.kind.' + known[type] : null;
}
/** Human cadence for a continuous schedule from its median interval (minutes). */
function cadenceLabel(min) {
  if (!min || !isFinite(min)) return '';
  if (min < 60) return t('profile.scheduler.cal.everyMin', { n: min });
  if (min % 60 === 0) return t('profile.scheduler.cal.everyHour', { n: min / 60 });
  return t('profile.scheduler.cal.everyMin', { n: min });
}

const HOUR_START = 6;
const HOUR_END = 22;

export default function SchedulerCalendar({ schedules = [], reloadKey = 0, onJumpTo }) {
  const [mode, setMode] = useState('week');
  const [anchorMs, setAnchorMs] = useState(() => readerToday().getTime());
  const [occ, setOcc] = useState([]);            // [{ scheduleId, at: Date }]
  const [freq, setFreq] = useState([]);          // [{ scheduleId, cron, intervalMinutes, approxPerDay }] — continuous/high-frequency
  const [foldFreq, setFoldFreq] = useState(false); // also render continuous schedules inside the grid (aggregated)
  const [freqExpanded, setFreqExpanded] = useState(false); // strip: show all vs. a preview
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);

  const anchor = useMemo(() => new Date(anchorMs), [anchorMs]);
  // The square to mark as today is the READER'S today, not the browser's: seven hours ahead they
  // are already on tomorrow, and the highlight sat on the wrong cell.
  const now = readerToday();

  const byId = useMemo(() => {
    const m = new Map();
    for (const s of schedules) m.set(s.id, s);
    return m;
  }, [schedules]);

  // The kinds actually present among enabled, cron-bearing schedules (for the legend).
  const kindsPresent = useMemo(() => {
    const seen = [];
    for (const s of schedules) {
      if (s.enabled === false || !s.cron || s.cron === '@activate') continue;
      const k = kindClass(s.type);
      if (!seen.includes(k)) seen.push(k);
    }
    return seen;
  }, [schedules]);

  // Visible [start, end) window + heading title per mode.
  const { start, end, title } = useMemo(() => {
    if (mode === 'month') {
      const first = startOfMonth(anchor);
      const gridStart = startOfWeek(first);
      return { start: gridStart, end: addDays(gridStart, 42), title: calendar(anchor, { month: 'long', year: 'numeric' }) };
    }
    if (mode === 'week') {
      const s = startOfWeek(anchor);
      return { start: s, end: addDays(s, 7), title: `${calendar(s, { day: 'numeric', month: 'short' })} – ${calendar(addDays(s, 6), { day: 'numeric', month: 'short' })}` };
    }
    const s = startOfDay(anchor);
    return { start: s, end: addDays(s, 1), title: calendar(s, { weekday: 'long', day: 'numeric', month: 'long' }) };
  }, [mode, anchor]);

  // Fetch projected fire-times for the visible window (refetch on window change + data reload).
  const startMs = start.getTime();
  const endMs = end.getTime();
  useEffect(() => {
    let alive = true;
    setLoading(true);
    listScheduleOccurrences(new Date(startMs), new Date(endMs))
      .then((res) => {
        if (!alive) return;
        setOcc((res?.data?.occurrences || []).map((o) => ({ scheduleId: o.scheduleId, at: new Date(o.at) })));
        setFreq(res?.data?.frequent || []);
        setTruncated(!!res?.data?.truncated);
      })
      .catch((err) => { swallowed('scheduler-calendar', err); if (alive) { setOcc([]); setFreq([]); setTruncated(false); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [startMs, endMs, reloadKey]);

  // Join occurrences to their schedule meta.
  const events = useMemo(() => {
    const nowMs = now.getTime();
    return occ
      .map((o) => {
        const s = byId.get(o.scheduleId);
        return {
          at: o.at,
          scheduleId: o.scheduleId,
          type: s?.type || 'core',
          name: (s && (s.displayName || s.name)) || t('profile.scheduler.cal.unknown'),
          past: o.at.getTime() < nowMs,
        };
      })
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occ, byId]);

  const eventsOn = useCallback((day) => events.filter((e) => fallsOn(e.at, day)), [events]);

  // Continuous / high-frequency schedules joined to their meta, busiest first.
  const frequentList = useMemo(() => freq
    .map((f) => {
      const s = byId.get(f.scheduleId);
      return {
        scheduleId: f.scheduleId,
        type: s?.type || 'core',
        name: (s && (s.displayName || s.name)) || t('profile.scheduler.cal.unknown'),
        intervalMinutes: f.intervalMinutes,
        approxPerDay: f.approxPerDay,
      };
    })
    .sort((a, b) => b.approxPerDay - a.approxPerDay), [freq, byId]);

  // ── navigation ──
  const shift = useCallback((dir) => setAnchorMs((ms) => {
    const d = new Date(ms);
    if (mode === 'month') { d.setMonth(d.getMonth() + dir); return startOfDay(d).getTime(); }
    return addDays(d, dir * (mode === 'week' ? 7 : 1)).getTime();
  }), [mode]);
  const goToday = useCallback(() => setAnchorMs(readerToday().getTime()), []);

  const onEv = (e) => (ev) => { ev.stopPropagation(); onJumpTo?.(e.scheduleId); };
  const evTitle = (e) => `${fmtTime(e.at)} · ${e.name} — ${t(e.past ? 'profile.scheduler.cal.ran' : 'profile.scheduler.cal.upcoming')}`;
  // A fire that already happened reads quieter than one still to come.
  const chip = (e, i) => html`<${Text} key=${i} kind="caption" tone=${e.past ? 'muted' : 'plain'}>
    <${Action} kind="text" title=${evTitle(e)} onClick=${onEv(e)}>${fmtTime(e.at)} ${e.name}<//><//>`;
  const dot = (e, j) => html`<${Text} key=${j} kind="caption" tone=${e.past ? 'muted' : 'plain'}>
    <${Action} kind="text" title=${evTitle(e)} onClick=${onEv(e)}>${e.name}<//><//>`;

  const weekdays = useMemo(() => {
    const mon = startOfWeek(new Date(2024, 0, 1));
    return Array.from({ length: 7 }, (_, i) => calendar(addDays(mon, i), { weekday: 'short' }));
  }, []);

  const legend = kindsPresent.length ? html`<${Stack} direction="wrap" density="compact">
    ${kindsPresent.map((k) => {
      const type = { ai: 'ai', agent: 'agent_task', ext: 'extension', eco: 'eco-capability', core: 'core' }[k];
      const lk = kindLabel(type);
      return html`<${Chip} key=${k} tone="muted">${lk ? t(lk) : type}<//>`;
    })}
  <//>` : null;

  const head = html`<${Stack} density="compact">
    <${Stack} direction="wrap" align="center">
      ${['month', 'week', 'day'].map((m) => html`<${Action} key=${m} kind="tab" selected=${mode === m} onClick=${() => setMode(m)}>${t('profile.scheduler.cal.' + m)}<//>`)}
      <${Action} onClick=${() => shift(-1)} title=${t('profile.scheduler.cal.prev')} label=${t('profile.scheduler.cal.prev')}>←<//>
      <${Action} onClick=${goToday}>${t('profile.scheduler.cal.today')}<//>
      <${Action} onClick=${() => shift(1)} title=${t('profile.scheduler.cal.next')} label=${t('profile.scheduler.cal.next')}>→<//>
    <//>
    ${legend}
    <${Text} kind="lead">${title}${loading ? html` <${Text} kind="caption" tone="muted">· ${t('profile.scheduler.cal.loading')}<//>` : null}<//>
    ${truncated ? html`<${Text} kind="caption" tone="danger">${t('profile.scheduler.cal.truncated')}<//>` : null}
  <//>`;

  const emptyHint = (!loading && events.length === 0 && frequentList.length === 0)
    ? html`<${Text} tone="muted">${schedules.some((s) => s.enabled !== false && s.cron && s.cron !== '@activate')
        ? t('profile.scheduler.cal.noEvents') : t('profile.scheduler.cal.empty')}<//>`
    : null;

  // ── "Continuously running" strip: high-frequency crons summarized (not one-chip-per-fire) ──
  const FREQ_PREVIEW = 6;
  const frequentStrip = frequentList.length ? html`<${Surface} kind="box" density="compact"><${Stack} density="compact">
    <${Stack} direction="horizontal" align="between">
      <${Text} kind="label">${t('profile.scheduler.cal.frequentTitle')} ${frequentList.length}<//>
      <${Action} onClick=${() => setFoldFreq((v) => !v)}>${foldFreq ? t('profile.scheduler.cal.freqHideGrid') : t('profile.scheduler.cal.freqShowGrid')}<//>
    <//>
    <${Stack} direction="wrap">
      ${(freqExpanded ? frequentList : frequentList.slice(0, FREQ_PREVIEW)).map((f) => html`<${Stack} key=${f.scheduleId} density="compact">
        <${Action} kind="text" title=${`${f.name} · ${cadenceLabel(f.intervalMinutes)}`} onClick=${() => onJumpTo?.(f.scheduleId)}>${f.name}<//>
        <${Text} kind="caption" tone="muted">${cadenceLabel(f.intervalMinutes)} · ${t('profile.scheduler.cal.perDay', { n: f.approxPerDay })}<//>
      <//>`)}
      ${frequentList.length > FREQ_PREVIEW ? html`<${Action} onClick=${() => setFreqExpanded((v) => !v)}>
        ${freqExpanded ? t('profile.scheduler.cal.showLess') : t('profile.scheduler.cal.showMore', { n: frequentList.length - FREQ_PREVIEW })}<//>` : null}
    <//>
  <//><//>` : null;

  // Aggregated per-day entry for a continuous schedule (used when folded into the grid).
  const freqChip = (f, key) => html`<${Text} key=${key} kind="caption">
    <${Action} kind="text" title=${`${f.name} · ${cadenceLabel(f.intervalMinutes)}`} onClick=${() => onJumpTo?.(f.scheduleId)}>${f.name} ×${f.approxPerDay}<//><//>`;
  const gridFreq = foldFreq ? frequentList : [];

  // ── month ──
  if (mode === 'month') {
    const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
    const weeks = Array.from({ length: 6 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
    return html`<${Stack}>
      ${head}
      ${frequentStrip}
      <${Table} density="compact" label=${title} headers=${weekdays} rows=${weeks.map(week => week.map((day) => {
        const evs = eventsOn(day);
        const inMonth = day.getMonth() === anchor.getMonth();
        return html`<${Stack} density="compact">
          ${sameDay(day, now) ? html`<${Chip} tone="sun">${day.getDate()}<//>` : html`<${Text} kind="mono" tone=${inMonth ? 'plain' : 'muted'}>${day.getDate()}<//>`}
          ${foldFreq && inMonth && gridFreq.length ? html`<${Text} kind="caption" tone="muted" title=${t('profile.scheduler.cal.frequentTitle')}>×${gridFreq.length}<//>` : null}
          ${evs.slice(0, 3).map(dot)}
          ${evs.length > 3 ? html`<${Text} kind="caption" tone="muted">+${evs.length - 3}<//>` : null}
        <//>`;
      }))} />
      ${emptyHint}
    <//>`;
  }

  // ── week ──
  if (mode === 'week') {
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    return html`<${Stack}>
      ${head}
      ${frequentStrip}
      <${Table} density="compact" label=${title}
        headers=${days.map((day) => (sameDay(day, now) ? html`<${Chip} tone="sun">${calendar(day, { weekday: 'short' })} ${day.getDate()}<//>` : `${calendar(day, { weekday: 'short' })} ${day.getDate()}`))}
        rows=${[days.map((day) => {
          const evs = eventsOn(day);
          return html`<${Stack} density="compact">
            ${gridFreq.map((f, j) => freqChip(f, 'gf' + j))}
            ${evs.length === 0 && gridFreq.length === 0 ? html`<${Text} kind="mono" tone="muted">·<//>` : evs.map(chip)}
          <//>`;
        })]} />
      ${emptyHint}
    <//>`;
  }

  // ── day — hourly rail HOUR_START..HOUR_END + earlier/later buckets ──
  const day = start;
  const dayEvents = eventsOn(day);
  const earlier = dayEvents.filter((e) => e.at.getHours() < HOUR_START);
  const later = dayEvents.filter((e) => e.at.getHours() > HOUR_END);
  const hours = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
  const hourRow = (key, label, list) => html`<${ListRow} key=${key} density="compact" time=${label} name=${html`<${Stack} direction="wrap" density="compact">${list}<//>`} />`;
  return html`<${Stack}>
    ${head}
    ${frequentStrip}
    ${dayEvents.length === 0 && frequentList.length === 0 && !loading ? html`<${Text} tone="muted">${t('profile.scheduler.cal.noEvents')}<//>` : null}
    <${Stack} density="compact">
      ${foldFreq && gridFreq.length ? hourRow('freq', '×', gridFreq.map((f, j) => freqChip(f, 'gf' + j))) : null}
      ${earlier.length ? hourRow('early', t('profile.scheduler.cal.earlier'), earlier.map(chip)) : null}
      ${hours.map((hr) => hourRow(hr, `${String(hr).padStart(2, '0')}:00`, dayEvents.filter((e) => e.at.getHours() === hr).map(chip)))}
      ${later.length ? hourRow('late', t('profile.scheduler.cal.later'), later.map(chip)) : null}
    <//>
  <//>`;
}
