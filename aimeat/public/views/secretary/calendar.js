/**
 * @file secretary/calendar.js
 * @description Phase 4 (Decision B) — a REAL calendar for the Secretary: month / week / day views of
 *   what it has done and what it will do. Events come from real data, no placeholders:
 *     - PAST  → the Home feed (`secretary.feed`) entries, placed on the day/hour they happened.
 *     - FUTURE→ the daily autonomous tick (the `secretary` schedule's cron hour) projected forward, plus
 *               each recurring Routine's cadence (daily/weekly) projected from its `nextRunAt`.
 *   Pure event-builder (`buildCalendarEvents`) + a small view-state hook (`useCalendar`) + the render
 *   (`calendarCard`). The view (views/secretary.js) passes in feed/schedule/routines it already loads.
 * @structure buildCalendarEvents · useCalendar · calendarCard (+ date helpers)
 * @usage const cal = useCalendar(); calendarCard({ ...cal, feed: auto.feed, schedule: auto.schedule, routines: next.routines })
 * @version-history
 *   v0.1.0 — 2026-06-28 — Decision B: month/week/day calendar of feed (past) + tick & routine cadence (future).
 */
import { h } from 'preact';
import htm from 'htm';
import { useState, useMemo, useCallback } from 'preact/hooks';
import { t } from '/js/i18n.js';
import { Markdown } from '/components/Markdown.js';
const html = htm.bind(h);

// ── date helpers (browser — real Date is fine) ──
const DAY_MS = 86400000;
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfWeek(d) { const x = startOfDay(d); const wd = (x.getDay() + 6) % 7; return addDays(x, -wd); } // Monday
function startOfMonth(d) { const x = startOfDay(d); x.setDate(1); return x; }
function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function fmtTime(d) { return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

/** The hour-of-day a `m h * * *` cron fires (daily ticks); null if not a simple daily cron. */
export function cronHour(cron) {
  const m = String(cron || '').trim().match(/^\d+\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  return m ? Math.min(23, parseInt(m[1], 10)) : null;
}

/**
 * Build dated calendar events within [start, end). Past = feed entries; future (≥ now) = the daily tick
 * (projected at the schedule's cron hour) + each recurring routine's cadence projected from nextRunAt.
 * Pure given `now`. Each event: { at: Date, type: 'done'|'scheduled', kind, text }.
 */
export function buildCalendarEvents({ feed, schedule, routines, triggers, start, end, now }) {
  const events = [];
  for (const it of (feed || [])) {
    if (!it || !it.ts) continue;
    const d = new Date(it.ts);
    if (d >= start && d < end) events.push({ at: d, type: 'done', kind: it.kind || 'act', text: it.text || '', ref: { srcType: 'feed', item: it } });
  }
  if (schedule && schedule.enabled !== false) {
    const hour = cronHour(schedule.cron);
    if (hour !== null) {
      let d = startOfDay(now > start ? now : start); d.setHours(hour, 0, 0, 0);
      if (d < now) d = addDays(d, 1);
      for (let i = 0; i < 370 && d < end; i++, d = addDays(d, 1)) {
        events.push({ at: new Date(d), type: 'scheduled', kind: 'tick', text: t('secretary.cal.tickEvent'), ref: { srcType: 'tick' } });
      }
    }
  }
  for (const r of (routines || [])) {
    if (!r || !r.cadence || !r.nextRunAt) continue;
    const step = r.cadence === 'weekly' ? 7 : 1;
    let d = new Date(r.nextRunAt);
    for (let i = 0; i < 370 && d < end; i++, d = addDays(d, step)) {
      if (d >= start && d >= now) events.push({ at: new Date(d), type: 'scheduled', kind: 'routine', text: r.title || t('secretary.cal.routineRun'), ref: { srcType: 'routine', id: r.id, routine: r } });
    }
  }
  for (const tr of (triggers || [])) {
    if (!tr || tr.status !== 'armed' || !tr.nextFireAt) continue;
    if (tr.kind === 'time') {
      const d = new Date(tr.nextFireAt);
      if (d >= start && d < end) events.push({ at: d, type: 'scheduled', kind: 'trigger', text: tr.label || t('secretary.cal.triggerEvent'), ref: { srcType: 'trigger', id: tr.id, trigger: tr } });
    } else if (tr.kind === 'recurring') {
      const stepMs = tr.cadence === 'monthly' ? 30 * DAY_MS : tr.cadence === 'weekly' ? 7 * DAY_MS : DAY_MS;
      let d = new Date(tr.nextFireAt);
      for (let i = 0; i < 370 && d < end; i++, d = new Date(d.getTime() + stepMs)) {
        if (d >= start) events.push({ at: new Date(d), type: 'scheduled', kind: 'trigger', text: tr.label || t('secretary.cal.triggerEvent'), ref: { srcType: 'trigger', id: tr.id, trigger: tr } });
      }
    }
  }
  return events.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Calendar view-state: mode (month/week/day) + an anchor date, with prev/next/today navigation. */
export function useCalendar() {
  const [mode, setMode] = useState('week');
  const [anchorMs, setAnchorMs] = useState(() => startOfDay(new Date()).getTime());
  const stepN = mode === 'month' ? 0 : (mode === 'week' ? 7 : 1);
  const shift = useCallback((dir) => {
    setAnchorMs((ms) => {
      const d = new Date(ms);
      if (mode === 'month') { d.setMonth(d.getMonth() + dir); return startOfDay(d).getTime(); }
      return addDays(d, dir * stepN).getTime();
    });
  }, [mode, stepN]);
  const goToday = useCallback(() => setAnchorMs(startOfDay(new Date()).getTime()), []);
  const goDay = useCallback((d) => { setAnchorMs(startOfDay(d).getTime()); setMode('day'); }, []);
  return { mode, setMode, anchor: new Date(anchorMs), prev: () => shift(-1), next: () => shift(1), today: goToday, goDay };
}

const HOUR_START = 6;
const HOUR_END = 22;

/** The month/week/day calendar card. */
export function calendarCard(p) {
  const now = new Date();
  const { mode, anchor } = p;
  const weekdays = useMemo(() => {
    const mon = startOfWeek(new Date(2024, 0, 1)); // a Monday
    return Array.from({ length: 7 }, (_, i) => addDays(mon, i).toLocaleDateString([], { weekday: 'short' }));
  }, []);

  // Visible range per mode.
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

  const events = useMemo(
    () => buildCalendarEvents({ feed: p.feed, schedule: p.schedule, routines: p.routines, triggers: p.triggers, start, end, now }),
    [p.feed, p.schedule, p.routines, p.triggers, start, end],
  );
  const eventsOn = useCallback((day) => events.filter((e) => sameDay(e.at, day)), [events]);

  const head = html`
    <div class="sec-card-head">
      <h2 class="sec-h2">${t('secretary.cal.title')}</h2>
      <div class="sec-cal-nav">
        <div class="sec-cal-modes">
          ${['month', 'week', 'day'].map((m) => html`
            <button class="btn-sm ${mode === m ? 'btn-primary' : 'btn-ghost'}" key=${m} onClick=${() => p.setMode(m)}>${t('secretary.cal.' + m)}</button>`)}
        </div>
        <div class="sec-cal-move">
          <button class="btn-ghost btn-sm" onClick=${p.prev} title=${t('secretary.cal.prev')}>‹</button>
          <button class="btn-ghost btn-sm" onClick=${p.today}>${t('secretary.cal.today')}</button>
          <button class="btn-ghost btn-sm" onClick=${p.next} title=${t('secretary.cal.next')}>›</button>
        </div>
      </div>
      <div class="sec-cal-range">${title}</div>
    </div>`;

  const onEv = (e) => (ev) => { ev.stopPropagation(); if (p.onEventClick) p.onEventClick(e); };
  const dot = (e, i) => html`<span class="sec-cal-ev sec-cal-ev--${e.type} sec-cal-ev--${e.kind}" key=${i} title=${`${fmtTime(e.at)} · ${e.text}`} onClick=${onEv(e)}>${e.text}</span>`;

  if (mode === 'month') {
    const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
    return html`
      <section class="sec-card sec-cal">
        ${head}
        <div class="sec-cal-weekrow">${weekdays.map((w, i) => html`<div class="sec-cal-wd" key=${i}>${w}</div>`)}</div>
        <div class="sec-cal-month">
          ${cells.map((day, i) => {
            const evs = eventsOn(day);
            const inMonth = day.getMonth() === anchor.getMonth();
            return html`
              <button class="sec-cal-cell ${inMonth ? '' : 'sec-cal-cell--dim'} ${sameDay(day, now) ? 'sec-cal-cell--today' : ''}" key=${i} onClick=${() => p.goDay(day)}>
                <span class="sec-cal-daynum">${day.getDate()}</span>
                <span class="sec-cal-cell-evs">${evs.slice(0, 3).map(dot)}${evs.length > 3 ? html`<span class="sec-cal-more">+${evs.length - 3}</span>` : null}</span>
              </button>`;
          })}
        </div>
      </section>`;
  }

  if (mode === 'week') {
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    return html`
      <section class="sec-card sec-cal">
        ${head}
        <div class="sec-cal-week">
          ${days.map((day, i) => {
            const evs = eventsOn(day);
            return html`
              <div class="sec-cal-weekcol ${sameDay(day, now) ? 'sec-cal-weekcol--today' : ''}" key=${i}>
                <button class="sec-cal-weekcol-head" onClick=${() => p.goDay(day)}>
                  <span class="sec-cal-wd">${day.toLocaleDateString([], { weekday: 'short' })}</span>
                  <span class="sec-cal-daynum">${day.getDate()}</span>
                </button>
                <div class="sec-cal-weekcol-evs">
                  ${evs.length === 0 ? html`<span class="sec-hint sec-cal-empty">·</span>`
                    : evs.map((e, j) => html`<div class="sec-cal-ev sec-cal-ev--${e.type} sec-cal-ev--${e.kind} sec-cal-ev--click" key=${j} onClick=${onEv(e)} title=${e.text}><span class="sec-cal-evtime">${fmtTime(e.at)}</span> ${e.text}</div>`)}
                </div>
              </div>`;
          })}
        </div>
      </section>`;
  }

  // day view — hourly rail HOUR_START..HOUR_END, with "earlier"/"later" buckets for out-of-range events.
  const day = start;
  const dayEvents = eventsOn(day);
  const earlier = dayEvents.filter((e) => e.at.getHours() < HOUR_START);
  const later = dayEvents.filter((e) => e.at.getHours() > HOUR_END);
  const hours = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
  return html`
    <section class="sec-card sec-cal">
      ${head}
      ${dayEvents.length === 0 ? html`<div class="sec-hint sec-cal-empty">${t('secretary.cal.noEvents')}</div>` : null}
      ${earlier.length ? html`<div class="sec-cal-bucket"><span class="sec-cal-hour">${t('secretary.cal.earlier')}</span><div class="sec-cal-hour-evs">${earlier.map((e, j) => html`<div class="sec-cal-ev sec-cal-ev--${e.type} sec-cal-ev--${e.kind} sec-cal-ev--click" key=${j} onClick=${onEv(e)}><span class="sec-cal-evtime">${fmtTime(e.at)}</span> ${e.text}</div>`)}</div></div>` : null}
      <div class="sec-cal-day">
        ${hours.map((hr) => {
          const evs = dayEvents.filter((e) => e.at.getHours() === hr);
          return html`
            <div class="sec-cal-hourrow" key=${hr}>
              <span class="sec-cal-hour">${String(hr).padStart(2, '0')}:00</span>
              <div class="sec-cal-hour-evs">${evs.map((e, j) => html`<div class="sec-cal-ev sec-cal-ev--${e.type} sec-cal-ev--${e.kind} sec-cal-ev--click" key=${j} onClick=${onEv(e)}><span class="sec-cal-evtime">${fmtTime(e.at)}</span> ${e.text}</div>`)}</div>
            </div>`;
        })}
      </div>
      ${later.length ? html`<div class="sec-cal-bucket"><span class="sec-cal-hour">${t('secretary.cal.later')}</span><div class="sec-cal-hour-evs">${later.map((e, j) => html`<div class="sec-cal-ev sec-cal-ev--${e.type} sec-cal-ev--${e.kind} sec-cal-ev--click" key=${j} onClick=${onEv(e)}><span class="sec-cal-evtime">${fmtTime(e.at)}</span> ${e.text}</div>`)}</div></div>` : null}
    </section>`;
}

/**
 * Type-specific editor for a clicked calendar entry — edit it IN PLACE (no navigation). The entries are
 * heterogeneous (trigger = memory record · routine = secretary.config sub-object · tick = a schedule ·
 * feed = an item in secretary.feed), so this dispatches by ref.srcType and drives the SAME domain hooks
 * the dedicated cards use, so a change persists to the right backing store and shows everywhere.
 * p = { event, onClose, triggers:{update,togglePause,remove}, routines:{setCadence,setStatus}, tick:{toggle,run} }
 */
export function CalendarEventDialog(p) {
  const ev = p.event;
  const ref = (ev && ev.ref) || {};
  const tr = ref.trigger || {};
  const ro = ref.routine || {};
  const [label, setLabel] = useState(tr.label || '');
  const [cadence, setCadence] = useState(tr.cadence || ro.cadence || 'weekly');
  const [busy, setBusy] = useState(false);
  if (!ev) return null;
  const run = async (fn) => { setBusy(true); try { await fn(); } finally { setBusy(false); p.onClose(); } };

  let title = ev.text || t('secretary.cal.title');
  let body = null;
  if (ref.srcType === 'trigger') {
    title = t('secretary.cal.dlg.trigger');
    body = html`
      <label class="sec-hint">${t('secretary.trig.labelPlaceholder')}</label>
      <input class="sec-input" value=${label} onInput=${(e) => setLabel(e.target.value)} />
      ${tr.kind === 'recurring' ? html`
        <label class="sec-hint">${t('secretary.cal.dlg.cadence')}</label>
        <select class="sec-input" value=${cadence} onChange=${(e) => setCadence(e.target.value)}>
          ${['daily', 'weekly', 'monthly'].map((c) => html`<option value=${c} selected=${cadence === c}>${t('secretary.trig.cad.' + c)}</option>`)}
        </select>` : html`<div class="sec-hint">${new Date(tr.nextFireAt || ev.at).toLocaleString()}</div>`}
      <div class="sec-next-action-btns">
        <button class="btn-primary btn-sm" disabled=${busy} onClick=${() => run(() => p.triggers.update(ref.id, { label: label.trim() || tr.label, cadence }))}>${t('secretary.cal.dlg.save')}</button>
        <button class="btn-outline btn-sm" disabled=${busy} onClick=${() => run(() => p.triggers.togglePause(tr))}>${tr.status === 'paused' ? t('secretary.trig.resume') : t('secretary.trig.pause')}</button>
        <button class="btn-ghost btn-sm sec-next-discard" disabled=${busy} onClick=${() => run(() => p.triggers.remove(tr))}>${t('secretary.cal.dlg.delete')}</button>
      </div>`;
  } else if (ref.srcType === 'routine') {
    title = ro.title || t('secretary.cal.routineRun');
    body = html`
      <label class="sec-hint">${t('secretary.cal.dlg.cadence')}</label>
      <select class="sec-input" value=${ro.cadence || 'none'} onChange=${(e) => run(() => p.routines.setCadence(ro, e.target.value))}>
        ${['none', 'daily', 'weekly'].map((c) => html`<option value=${c} selected=${(ro.cadence || 'none') === c}>${t('secretary.trig.cad.' + c) || c}</option>`)}
      </select>
      <div class="sec-next-action-btns">
        <button class="btn-outline btn-sm" disabled=${busy} onClick=${() => run(() => p.routines.setStatus(ro, ro.status === 'paused' ? 'active' : 'paused'))}>${ro.status === 'paused' ? t('secretary.trig.resume') : t('secretary.trig.pause')}</button>
      </div>`;
  } else if (ref.srcType === 'tick') {
    title = t('secretary.cal.tickEvent');
    body = html`
      <p class="sec-hint">${t('secretary.cal.dlg.tickDesc')}</p>
      <div class="sec-next-action-btns">
        <button class="btn-primary btn-sm" disabled=${busy} onClick=${() => run(() => p.tick.run())}>${t('secretary.auto.runNow')}</button>
        <button class="btn-outline btn-sm" disabled=${busy} onClick=${() => run(() => p.tick.toggle())}>${t('secretary.auto.pause')}</button>
      </div>`;
  } else {
    // feed entry — historical; show the full content read-only.
    title = t('secretary.cal.dlg.activity');
    const item = ref.item || {};
    body = html`
      <div class="sec-hint">${new Date(ev.at).toLocaleString()}</div>
      <div class="sec-stand-body"><${Markdown} text=${ev.text || ''} /></div>
      ${item.href ? html`<a href=${item.href} target="_blank" rel="noopener">${t('secretary.next.openResult')} ↗</a>` : null}`;
  }

  return html`
    <div class="sec-modal-backdrop" onClick=${p.onClose}>
      <div class="sec-modal" onClick=${(e) => e.stopPropagation()}>
        <div class="sec-card-head"><h2 class="sec-h2">${title}</h2><button class="btn-ghost btn-sm" onClick=${p.onClose}>✕</button></div>
        ${body}
      </div>
    </div>`;
}
