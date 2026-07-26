/**
 * @file scheduler-calendar.js
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

const html = htm.bind(h);

// ── date helpers (browser — real Date is fine here) ──
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfWeek(d) { const x = startOfDay(d); const wd = (x.getDay() + 6) % 7; return addDays(x, -wd); } // Monday-first
function startOfMonth(d) { const x = startOfDay(d); x.setDate(1); return x; }
function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function fmtTime(d) { return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

/** Schedule kind → the CSS/colour suffix used by .sch-cal-ev--* and .sch-badge--*. */
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
  const [anchorMs, setAnchorMs] = useState(() => startOfDay(new Date()).getTime());
  const [occ, setOcc] = useState([]);            // [{ scheduleId, at: Date }]
  const [freq, setFreq] = useState([]);          // [{ scheduleId, cron, intervalMinutes, approxPerDay }] — continuous/high-frequency
  const [foldFreq, setFoldFreq] = useState(false); // also render continuous schedules inside the grid (aggregated)
  const [freqExpanded, setFreqExpanded] = useState(false); // strip: show all vs. a preview
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);

  const anchor = useMemo(() => new Date(anchorMs), [anchorMs]);
  const now = new Date();

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
      return { start: gridStart, end: addDays(gridStart, 42), title: anchor.toLocaleDateString([], { month: 'long', year: 'numeric' }) };
    }
    if (mode === 'week') {
      const s = startOfWeek(anchor);
      return { start: s, end: addDays(s, 7), title: `${s.toLocaleDateString([], { day: 'numeric', month: 'short' })} – ${addDays(s, 6).toLocaleDateString([], { day: 'numeric', month: 'short' })}` };
    }
    const s = startOfDay(anchor);
    return { start: s, end: addDays(s, 1), title: s.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }) };
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

  const eventsOn = useCallback((day) => events.filter((e) => sameDay(e.at, day)), [events]);

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
  const goToday = useCallback(() => setAnchorMs(startOfDay(new Date()).getTime()), []);

  const onEv = (e) => (ev) => { ev.stopPropagation(); onJumpTo?.(e.scheduleId); };
  const evClass = (e) => `sch-cal-ev sch-cal-ev--${kindClass(e.type)}${e.past ? ' sch-cal-ev--past' : ''}`;
  const evTitle = (e) => `${fmtTime(e.at)} · ${e.name} — ${t(e.past ? 'profile.scheduler.cal.ran' : 'profile.scheduler.cal.upcoming')}`;
  const chip = (e, i) => html`<button type="button" class=${evClass(e) + ' sch-cal-ev--click'} key=${i} title=${evTitle(e)} onClick=${onEv(e)}>
      <span class="sch-cal-evtime">${fmtTime(e.at)}</span> ${e.name}</button>`;

  const weekdays = useMemo(() => {
    const mon = startOfWeek(new Date(2024, 0, 1));
    return Array.from({ length: 7 }, (_, i) => addDays(mon, i).toLocaleDateString([], { weekday: 'short' }));
  }, []);

  const legend = kindsPresent.length ? html`<div class="sch-cal-legend">
    ${kindsPresent.map((k) => {
      const type = { ai: 'ai', agent: 'agent_task', ext: 'extension', eco: 'eco-capability', core: 'core' }[k];
      const lk = kindLabel(type);
      return html`<span class="sch-cal-legend-item" key=${k}><span class="sch-cal-swatch sch-cal-ev--${k}"></span>${lk ? t(lk) : type}</span>`;
    })}
  </div>` : null;

  const head = html`
    <div class="sch-cal-head">
      <div class="sch-cal-nav">
        <div class="sch-cal-modes">
          ${['month', 'week', 'day'].map((m) => html`<button key=${m} type="button"
            class="${mode === m ? 'btn-primary' : 'btn-ghost'} btn-sm" onClick=${() => setMode(m)}>${t('profile.scheduler.cal.' + m)}</button>`)}
        </div>
        <div class="sch-cal-move">
          <button class="btn-ghost btn-sm" type="button" onClick=${() => shift(-1)} title=${t('profile.scheduler.cal.prev')}>‹</button>
          <button class="btn-ghost btn-sm" type="button" onClick=${goToday}>${t('profile.scheduler.cal.today')}</button>
          <button class="btn-ghost btn-sm" type="button" onClick=${() => shift(1)} title=${t('profile.scheduler.cal.next')}>›</button>
        </div>
        ${legend}
      </div>
      <div class="sch-cal-range">${title}${loading ? html` <span class="sch-muted">· ${t('profile.scheduler.cal.loading')}</span>` : null}</div>
      ${truncated ? html`<div class="sch-cal-trunc">${t('profile.scheduler.cal.truncated')}</div>` : null}
    </div>`;

  const emptyHint = (!loading && events.length === 0 && frequentList.length === 0)
    ? html`<div class="sch-cal-empty">${schedules.some((s) => s.enabled !== false && s.cron && s.cron !== '@activate')
        ? t('profile.scheduler.cal.noEvents') : t('profile.scheduler.cal.empty')}</div>`
    : null;

  // ── "Continuously running" strip: high-frequency crons summarized (not one-chip-per-fire) ──
  const FREQ_PREVIEW = 6;
  const frequentStrip = frequentList.length ? html`<div class="sch-cal-freq">
    <div class="sch-cal-freq-head">
      <span class="sch-cal-freq-title">${t('profile.scheduler.cal.frequentTitle')} <span class="sch-cal-freq-count">${frequentList.length}</span></span>
      <button type="button" class="btn-ghost btn-sm" onClick=${() => setFoldFreq((v) => !v)}>
        ${foldFreq ? t('profile.scheduler.cal.freqHideGrid') : t('profile.scheduler.cal.freqShowGrid')}
      </button>
    </div>
    <div class="sch-cal-freq-pills">
      ${(freqExpanded ? frequentList : frequentList.slice(0, FREQ_PREVIEW)).map((f) => html`<button type="button"
        class="sch-cal-freqpill sch-cal-ev--${kindClass(f.type)}" key=${f.scheduleId}
        title=${`${f.name} · ${cadenceLabel(f.intervalMinutes)}`} onClick=${() => onJumpTo?.(f.scheduleId)}>
        <span class="sch-cal-freqdot"></span>
        <span class="sch-cal-freqname">${f.name}</span>
        <span class="sch-cal-freqcad">${cadenceLabel(f.intervalMinutes)} · ${t('profile.scheduler.cal.perDay', { n: f.approxPerDay })}</span>
      </button>`)}
      ${frequentList.length > FREQ_PREVIEW ? html`<button type="button" class="sch-cal-freqmore" onClick=${() => setFreqExpanded((v) => !v)}>
        ${freqExpanded ? t('profile.scheduler.cal.showLess') : t('profile.scheduler.cal.showMore', { n: frequentList.length - FREQ_PREVIEW })}
      </button>` : null}
    </div>
  </div>` : null;

  // Aggregated per-day chip for a continuous schedule (used when folded into the grid).
  const freqChip = (f, key) => html`<button type="button"
    class="${'sch-cal-ev sch-cal-ev--' + kindClass(f.type) + ' sch-cal-ev--click sch-cal-freqchip'}" key=${key}
    title=${`${f.name} · ${cadenceLabel(f.intervalMinutes)}`} onClick=${() => onJumpTo?.(f.scheduleId)}>
    <span class="sch-cal-freqmark">⟳</span> ${f.name} <span class="sch-cal-evtime">×${f.approxPerDay}</span></button>`;
  const gridFreq = foldFreq ? frequentList : [];

  // ── month ──
  if (mode === 'month') {
    const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
    return html`<section class="sch-cal">
      ${head}
      ${frequentStrip}
      <div class="sch-cal-weekrow">${weekdays.map((w, i) => html`<div class="sch-cal-wd" key=${i}>${w}</div>`)}</div>
      <div class="sch-cal-month">
        ${cells.map((day, i) => {
          const evs = eventsOn(day);
          const inMonth = day.getMonth() === anchor.getMonth();
          return html`<div class="sch-cal-cell ${inMonth ? '' : 'sch-cal-cell--dim'} ${sameDay(day, now) ? 'sch-cal-cell--today' : ''}" key=${i}>
            <span class="sch-cal-daynum">${day.getDate()}</span>
            <span class="sch-cal-cell-evs">
              ${foldFreq && inMonth && gridFreq.length ? html`<span class="sch-cal-ev sch-cal-ev--core sch-cal-ev--dot sch-cal-freqcount" title=${t('profile.scheduler.cal.frequentTitle')}><span class="sch-cal-freqmark">⟳</span> ×${gridFreq.length}</span>` : null}
              ${evs.slice(0, 3).map((e, j) => html`<button type="button" class=${evClass(e) + ' sch-cal-ev--click sch-cal-ev--dot'} key=${j} title=${evTitle(e)} onClick=${onEv(e)}>${e.name}</button>`)}
              ${evs.length > 3 ? html`<span class="sch-cal-more">+${evs.length - 3}</span>` : null}
            </span>
          </div>`;
        })}
      </div>
      ${emptyHint}
    </section>`;
  }

  // ── week ──
  if (mode === 'week') {
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    return html`<section class="sch-cal">
      ${head}
      ${frequentStrip}
      <div class="sch-cal-week">
        ${days.map((day, i) => {
          const evs = eventsOn(day);
          return html`<div class="sch-cal-weekcol ${sameDay(day, now) ? 'sch-cal-weekcol--today' : ''}" key=${i}>
            <div class="sch-cal-weekcol-head">
              <span class="sch-cal-wd">${day.toLocaleDateString([], { weekday: 'short' })}</span>
              <span class="sch-cal-daynum">${day.getDate()}</span>
            </div>
            <div class="sch-cal-weekcol-evs">
              ${gridFreq.map((f, j) => freqChip(f, 'gf' + j))}
              ${evs.length === 0 && gridFreq.length === 0 ? html`<span class="sch-cal-dotempty">·</span>` : evs.map(chip)}
            </div>
          </div>`;
        })}
      </div>
      ${emptyHint}
    </section>`;
  }

  // ── day — hourly rail HOUR_START..HOUR_END + earlier/later buckets ──
  const day = start;
  const dayEvents = eventsOn(day);
  const earlier = dayEvents.filter((e) => e.at.getHours() < HOUR_START);
  const later = dayEvents.filter((e) => e.at.getHours() > HOUR_END);
  const hours = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
  const bucket = (labelKey, list) => html`<div class="sch-cal-bucket">
      <span class="sch-cal-hour">${t(labelKey)}</span>
      <div class="sch-cal-hour-evs">${list.map(chip)}</div>
    </div>`;
  return html`<section class="sch-cal">
    ${head}
    ${frequentStrip}
    ${dayEvents.length === 0 && frequentList.length === 0 && !loading ? html`<div class="sch-cal-empty">${t('profile.scheduler.cal.noEvents')}</div>` : null}
    ${foldFreq && gridFreq.length ? html`<div class="sch-cal-bucket">
      <span class="sch-cal-hour"><span class="sch-cal-freqmark">⟳</span></span>
      <div class="sch-cal-hour-evs">${gridFreq.map((f, j) => freqChip(f, 'gf' + j))}</div>
    </div>` : null}
    ${earlier.length ? bucket('profile.scheduler.cal.earlier', earlier) : null}
    <div class="sch-cal-day">
      ${hours.map((hr) => {
        const evs = dayEvents.filter((e) => e.at.getHours() === hr);
        return html`<div class="sch-cal-hourrow" key=${hr}>
          <span class="sch-cal-hour">${String(hr).padStart(2, '0')}:00</span>
          <div class="sch-cal-hour-evs">${evs.map(chip)}</div>
        </div>`;
      })}
    </div>
    ${later.length ? bucket('profile.scheduler.cal.later', later) : null}
  </section>`;
}
