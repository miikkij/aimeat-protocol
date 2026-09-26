/**
 * @file scheduler-calendar.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile › Scheduler calendar — day / week / month views of when every
 *   enabled schedule fires, so the owner can see cadence at a glance ("how often does
 *   this run?"). Fire-times come from GET /v1/schedules/occurrences (croner projection
 *   on the server — the same engine that actually runs the jobs), joined client-side to
 *   the schedule records for kind / name / colour. Clicking an event opens that schedule
 *   via the onJumpTo callback. The calendar itself is components/ScheduleCalendar.js; this
 *   file holds the mode, the anchor and the loading, and passes the calendar its data.
 * @structure SchedulerCalendar (default) — mode + anchor state, windowed occurrence
 *   fetch, the join to the schedules, the words, the ScheduleCalendar component.
 * @usage
 *   import SchedulerCalendar from './scheduler-calendar.js';
 *   <${SchedulerCalendar} schedules=${[...managed, ...extensions]} reloadKey=${tick} onJumpTo=${jump} />
 * @version-history
 *   v1.8.0 -- 2026-09-26 -- The calendar is a component that takes data (components/ScheduleCalendar.js: the month, week and day grids, the continuously running strip, the legend, the mode tabs and the moves); this file keeps the loading and the words (page group G5).
 *   v1.7.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.6.0 -- 2026-09-25 -- The calendar's month, week and day and the spend chart's cost, tokens and seconds are the Tab (.poster-tab, the chosen one .is-on); their rows take the tabs' row gap (Jouni's decisions "Tabs and filters" and "Choice", a unification).
 *   v1.5.0 -- 2026-09-25 -- Every small number is the Count (.poster-count waiting or tally), a unification: Jouni's decision Count.
 *   v1.4.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.3.0 -- 2026-09-25 -- Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v1.2.0 -- 2026-09-25 -- A button that is a mark, not a word (a delete or close mark, a menu's
 *     dots, an arrow), is the library's small icon button, .poster-icon.poster-icon--small (Jouni's
 *     decision "Icon button").
 *   v1.1.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
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
import { ScheduleCalendar, calendarWindow, readerToday, shiftAnchor } from '/components/ScheduleCalendar.js';

const html = htm.bind(h);

/** Schedule kind → the calendar's kind (its colour). */
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

export default function SchedulerCalendar({ schedules = [], reloadKey = 0, onJumpTo }) {
  const [mode, setMode] = useState('week');
  const [anchorMs, setAnchorMs] = useState(() => readerToday().getTime());
  const [occ, setOcc] = useState([]);            // [{ scheduleId, at: Date }]
  const [freq, setFreq] = useState([]);          // [{ scheduleId, cron, intervalMinutes, approxPerDay }] — continuous/high-frequency
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);

  const anchor = useMemo(() => new Date(anchorMs), [anchorMs]);
  const now = readerToday();

  const byId = useMemo(() => {
    const m = new Map();
    for (const s of schedules) m.set(s.id, s);
    return m;
  }, [schedules]);

  // The kinds actually present among enabled, cron-bearing schedules (for the legend).
  const kinds = useMemo(() => {
    const seen = [];
    for (const s of schedules) {
      if (s.enabled === false || !s.cron || s.cron === '@activate') continue;
      const k = kindClass(s.type);
      if (!seen.includes(k)) seen.push(k);
    }
    return seen.map((k) => {
      const type = { ai: 'ai', agent: 'agent_task', ext: 'extension', eco: 'eco-capability', core: 'core' }[k];
      const lk = kindLabel(type);
      return { key: k, label: lk ? t(lk) : type };
    });
  }, [schedules]);

  // Fetch projected fire-times for the visible window (refetch on window change + data reload).
  const { start, end } = calendarWindow(mode, anchor);
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
          kind: kindClass(s?.type || 'core'),
          name: (s && (s.displayName || s.name)) || t('profile.scheduler.cal.unknown'),
          past: o.at.getTime() < nowMs,
        };
      })
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occ, byId]);

  // Continuous / high-frequency schedules joined to their meta, busiest first.
  const frequent = useMemo(() => freq
    .map((f) => {
      const s = byId.get(f.scheduleId);
      return {
        scheduleId: f.scheduleId,
        kind: kindClass(s?.type || 'core'),
        name: (s && (s.displayName || s.name)) || t('profile.scheduler.cal.unknown'),
        cadence: cadenceLabel(f.intervalMinutes),
        perDay: t('profile.scheduler.cal.perDay', { n: f.approxPerDay }),
        approxPerDay: f.approxPerDay,
      };
    })
    .sort((a, b) => b.approxPerDay - a.approxPerDay), [freq, byId]);

  // ── navigation ──
  const shift = useCallback((dir) => setAnchorMs((ms) => shiftAnchor(mode, ms, dir)), [mode]);
  const goToday = useCallback(() => setAnchorMs(readerToday().getTime()), []);

  const words = {
    month: t('profile.scheduler.cal.month'), week: t('profile.scheduler.cal.week'), day: t('profile.scheduler.cal.day'),
    prev: t('profile.scheduler.cal.prev'), next: t('profile.scheduler.cal.next'), today: t('profile.scheduler.cal.today'),
    loading: t('profile.scheduler.cal.loading'), truncated: t('profile.scheduler.cal.truncated'),
    noEvents: t('profile.scheduler.cal.noEvents'), empty: t('profile.scheduler.cal.empty'),
    frequentTitle: t('profile.scheduler.cal.frequentTitle'),
    freqHideGrid: t('profile.scheduler.cal.freqHideGrid'), freqShowGrid: t('profile.scheduler.cal.freqShowGrid'),
    showLess: t('profile.scheduler.cal.showLess'), showMore: (n) => t('profile.scheduler.cal.showMore', { n }),
    ran: t('profile.scheduler.cal.ran'), upcoming: t('profile.scheduler.cal.upcoming'),
    earlier: t('profile.scheduler.cal.earlier'), later: t('profile.scheduler.cal.later'),
  };

  return html`<${ScheduleCalendar} mode=${mode} onMode=${(m) => setMode(m)} anchor=${anchor}
    onPrev=${() => shift(-1)} onNext=${() => shift(1)} onToday=${goToday}
    loading=${loading} truncated=${truncated} events=${events} frequent=${frequent} kinds=${kinds}
    hasSchedules=${schedules.some((s) => s.enabled !== false && s.cron && s.cron !== '@activate')}
    onJump=${onJumpTo} words=${words} />`;
}
