/**
 * @file public/components/ScheduleCalendar.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The schedule calendar: a month, a week or a day of the runs that will happen, each run a
 *   chip striped in its kind's colour (the legend names the kinds), today framed in coral, and the jobs
 *   that run too often for the grid in a "continuously running" strip above it, which can fold them
 *   into the grid as one ⟳ chip a day. The mode tabs, the ‹ today › moves, the strip's show-more and
 *   its fold into the grid are the component's own; a press on a run or a job calls `onJump`. A special
 *   view of the Scheduler page, drawn from data: the page loads the runs for the window the component
 *   names (calendarWindow) and passes them in; it never writes a class.
 *   Its look is css/components/schedule-calendar.css (its own class names, .schedule-calendar and
 *   .schedule-calendar-*), with the Tab and the icon and action shapes of poster.css.
 * @structure calendarWindow(mode, anchor) · readerToday() · startOfDay(d) · ScheduleCalendar(props)
 * @usage const { start, end } = calendarWindow(mode, anchor);
 *        html`<${ScheduleCalendar} mode=${mode} onMode=${setMode} anchor=${anchor} start=${start}
 *          onPrev=${() => shift(-1)} onNext=${() => shift(1)} onToday=${goToday} loading=${loading}
 *          truncated=${truncated} events=${events} frequent=${frequent} kinds=${kinds}
 *          hasSchedules=${any} onJump=${jump} words=${words} />`
 * @version-history
 *   v1.1.0 — 2026-09-27 — Its own class names (.sch-cal → .schedule-calendar, every .sch-cal-* →
 *     .schedule-calendar-*, .sch-muted → .schedule-calendar-muted); every rule keeps its value
 *     (Jouni: components draw only their own class names, a move).
 *   v1.0.0 — 2026-09-26 — Initial: the Scheduler's calendar (views/profile/scheduler-calendar.js drew
 *     it as markup) as a component that takes data; the page keeps the loading (page group G5).
 */
import { h } from 'preact';
import htm from 'htm';
import { useState, useMemo } from 'preact/hooks';
import { time, calendar, dayKey } from '/js/format.js';
import { Tabs } from '/components/Tabs.js';
import { Action, Icon } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');
const KINDS = new Set(['ai', 'agent', 'ext', 'eco', 'core']);
const kindOf = (k) => (KINDS.has(k) ? k : 'core');

// ── date helpers (browser — real Date is fine here) ──
export function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
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
/** Whether a moment falls on a given cell's date, in the reader's own clock. */
function fallsOn(at, cell) { return dayKey(at) === cellDay(cell); }
function fmtTime(d) { return time(d, { hour: '2-digit', minute: '2-digit' }); }

/**
 * TODAY, as the reader's clock has it, expressed as a cell the grid can enumerate from.
 *
 * The grid walks local Dates, which is right — a cell is a date. Where it starts is not a matter of
 * local arithmetic though: a reader keeping a clock seven hours ahead is already on tomorrow, and
 * the grid opened on the browser's yesterday and highlighted the wrong square. The day comes from
 * their zone and is then carried into a local Date so the walk is unchanged.
 */
export function readerToday() {
  const key = dayKey(new Date());
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!parts) return startOfDay(new Date());
  return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
}

/** The window a mode shows around its anchor: [start, end) and the words that name it. */
export function calendarWindow(mode, anchor) {
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
}

/** Where to move the anchor by one step of the mode. */
export function shiftAnchor(mode, ms, dir) {
  const d = new Date(ms);
  if (mode === 'month') { d.setMonth(d.getMonth() + dir); return startOfDay(d).getTime(); }
  return addDays(d, dir * (mode === 'week' ? 7 : 1)).getTime();
}

const HOUR_START = 6;
const HOUR_END = 22;
const FREQ_PREVIEW = 6;

/**
 * @param {{ mode: 'month'|'week'|'day', onMode: (m: string) => void, onPrev: () => void, onNext: () => void,
 *   onToday: () => void, anchor: Date, loading?: boolean, truncated?: boolean,
 *   events: Array<{ at: Date, scheduleId: string, kind: string, name: string, past?: boolean }>,
 *   frequent: Array<{ scheduleId: string, kind: string, name: string, cadence: string, perDay: string, approxPerDay: number }>,
 *   kinds: Array<{ key: string, label: string }>, hasSchedules?: boolean, onJump?: (id: string) => void,
 *   words: Record<string, any> }} props
 */
export function ScheduleCalendar({ mode, onMode, onPrev, onNext, onToday, anchor, loading, truncated, events = [], frequent = [],
  kinds = [], hasSchedules, onJump, words: w }) {
  const [foldFreq, setFoldFreq] = useState(false); // also render continuous schedules inside the grid (aggregated)
  const [freqExpanded, setFreqExpanded] = useState(false); // strip: show all vs. a preview
  const { start, title } = calendarWindow(mode, anchor);
  // The square to mark as today is the READER'S today, not the browser's.
  const now = readerToday();
  const eventsOn = (day) => events.filter((e) => fallsOn(e.at, day));

  const weekdays = useMemo(() => {
    const mon = startOfWeek(new Date(2024, 0, 1));
    return Array.from({ length: 7 }, (_, i) => calendar(addDays(mon, i), { weekday: 'short' }));
  }, []);

  const onEv = (e) => (ev) => { ev.stopPropagation(); onJump?.(e.scheduleId); };
  const evClass = (e) => `schedule-calendar-ev schedule-calendar-ev--${kindOf(e.kind)}${e.past ? ' schedule-calendar-ev--past' : ''}`;
  const evTitle = (e) => `${fmtTime(e.at)} · ${e.name} — ${e.past ? w.ran : w.upcoming}`;
  const chip = (e, i) => html`<button type="button" class=${evClass(e) + ' schedule-calendar-ev--click'} key=${i} title=${evTitle(e)} onClick=${onEv(e)}>
      <span class="schedule-calendar-evtime poster-time">${fmtTime(e.at)}</span> ${e.name}</button>`;

  const legend = kinds.length ? html`<div class="schedule-calendar-legend">
    ${kinds.map((k) => html`<span class="schedule-calendar-legend-item" key=${k.key}><span class=${`schedule-calendar-swatch schedule-calendar-ev--${kindOf(k.key)}`}></span>${k.label}</span>`)}
  </div>` : null;

  const head = html`
    <div class="schedule-calendar-head">
      <div class="schedule-calendar-nav">
        <div class="schedule-calendar-modes">
          <${Tabs} value=${mode} onSelect=${onMode} items=${[{ value: 'month', label: w.month }, { value: 'week', label: w.week }, { value: 'day', label: w.day }]} />
        </div>
        <div class="schedule-calendar-move">
          <${Icon} small label=${w.prev} onClick=${onPrev}>‹<//>
          <${Action} small onClick=${onToday}>${w.today}<//>
          <${Icon} small label=${w.next} onClick=${onNext}>›<//>
        </div>
        ${legend}
      </div>
      <div class="schedule-calendar-range">${title}${loading ? html` <span class="schedule-calendar-muted">· ${w.loading}</span>` : null}</div>
      ${truncated ? html`<div class="schedule-calendar-trunc">${w.truncated}</div>` : null}
    </div>`;

  const emptyLine = (text) => html`<div class="schedule-calendar-empty"><${Note} kind="quiet">${text}<//></div>`;
  const emptyHint = (!loading && events.length === 0 && frequent.length === 0)
    ? emptyLine(hasSchedules ? w.noEvents : w.empty) : null;

  // ── "Continuously running" strip: high-frequency crons summarized (not one-chip-per-fire) ──
  const frequentStrip = frequent.length ? html`<div class="schedule-calendar-freq poster-row--thing">
    <div class="schedule-calendar-freq-head">
      <span class="schedule-calendar-freq-title">${w.frequentTitle} <${Mark} kind="count" tone="tally">${frequent.length}<//></span>
      <${Action} small onClick=${() => setFoldFreq((v) => !v)}>${foldFreq ? w.freqHideGrid : w.freqShowGrid}<//>
    </div>
    <div class="schedule-calendar-freq-pills">
      ${(freqExpanded ? frequent : frequent.slice(0, FREQ_PREVIEW)).map((f) => html`<button type="button"
        class=${`schedule-calendar-freqpill schedule-calendar-ev--${kindOf(f.kind)}`} key=${f.scheduleId}
        title=${`${f.name} · ${f.cadence}`} onClick=${() => onJump?.(f.scheduleId)}>
        <span class="schedule-calendar-freqdot"></span>
        <span class="schedule-calendar-freqname">${f.name}</span>
        <span class="schedule-calendar-freqcad">${f.cadence} · ${f.perDay}</span>
      </button>`)}
      ${frequent.length > FREQ_PREVIEW ? html`<button type="button" class="schedule-calendar-freqmore" onClick=${() => setFreqExpanded((v) => !v)}>
        ${freqExpanded ? w.showLess : w.showMore(frequent.length - FREQ_PREVIEW)}
      </button>` : null}
    </div>
  </div>` : null;

  // Aggregated per-day chip for a continuous schedule (used when folded into the grid).
  const freqChip = (f, key) => html`<button type="button"
    class=${`schedule-calendar-ev schedule-calendar-ev--${kindOf(f.kind)} schedule-calendar-ev--click schedule-calendar-freqchip`} key=${key}
    title=${`${f.name} · ${f.cadence}`} onClick=${() => onJump?.(f.scheduleId)}>
    <span class="schedule-calendar-freqmark">⟳</span> ${f.name} <span class="schedule-calendar-evtime">×${f.approxPerDay}</span></button>`;
  const gridFreq = foldFreq ? frequent : [];

  // ── month ──
  if (mode === 'month') {
    const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
    return html`<section class="schedule-calendar">
      ${head}
      ${frequentStrip}
      <div class="schedule-calendar-weekrow">${weekdays.map((d, i) => html`<div class="schedule-calendar-wd" key=${i}>${d}</div>`)}</div>
      <div class="schedule-calendar-month">
        ${cells.map((day, i) => {
          const evs = eventsOn(day);
          const inMonth = day.getMonth() === anchor.getMonth();
          return html`<div class=${cx('schedule-calendar-cell', !inMonth && 'schedule-calendar-cell--dim', sameDay(day, now) && 'schedule-calendar-cell--today')} key=${i}>
            <span class="schedule-calendar-daynum">${day.getDate()}</span>
            <span class="schedule-calendar-cell-evs">
              ${foldFreq && inMonth && gridFreq.length ? html`<span class="schedule-calendar-ev schedule-calendar-ev--core schedule-calendar-ev--dot schedule-calendar-freqcount" title=${w.frequentTitle}><span class="schedule-calendar-freqmark">⟳</span> ×${gridFreq.length}</span>` : null}
              ${evs.slice(0, 3).map((e, j) => html`<button type="button" class=${evClass(e) + ' schedule-calendar-ev--click schedule-calendar-ev--dot'} key=${j} title=${evTitle(e)} onClick=${onEv(e)}>${e.name}</button>`)}
              ${evs.length > 3 ? html`<span class="schedule-calendar-more">+${evs.length - 3}</span>` : null}
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
    return html`<section class="schedule-calendar">
      ${head}
      ${frequentStrip}
      <div class="schedule-calendar-week">
        ${days.map((day, i) => {
          const evs = eventsOn(day);
          return html`<div class=${cx('schedule-calendar-weekcol', sameDay(day, now) && 'schedule-calendar-weekcol--today')} key=${i}>
            <div class="schedule-calendar-weekcol-head">
              <span class="schedule-calendar-wd">${calendar(day, { weekday: 'short' })}</span>
              <span class="schedule-calendar-daynum">${day.getDate()}</span>
            </div>
            <div class="schedule-calendar-weekcol-evs">
              ${gridFreq.map((f, j) => freqChip(f, 'gf' + j))}
              ${evs.length === 0 && gridFreq.length === 0 ? html`<span class="schedule-calendar-dotempty">·</span>` : evs.map(chip)}
            </div>
          </div>`;
        })}
      </div>
      ${emptyHint}
    </section>`;
  }

  // ── day — hourly rail HOUR_START..HOUR_END + earlier/later buckets ──
  const dayEvents = eventsOn(start);
  const earlier = dayEvents.filter((e) => e.at.getHours() < HOUR_START);
  const later = dayEvents.filter((e) => e.at.getHours() > HOUR_END);
  const hours = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
  const bucket = (label, list) => html`<div class="schedule-calendar-bucket">
      <span class="schedule-calendar-hour">${label}</span>
      <div class="schedule-calendar-hour-evs">${list.map(chip)}</div>
    </div>`;
  return html`<section class="schedule-calendar">
    ${head}
    ${frequentStrip}
    ${dayEvents.length === 0 && frequent.length === 0 && !loading ? emptyLine(w.noEvents) : null}
    ${foldFreq && gridFreq.length ? html`<div class="schedule-calendar-bucket">
      <span class="schedule-calendar-hour"><span class="schedule-calendar-freqmark">⟳</span></span>
      <div class="schedule-calendar-hour-evs">${gridFreq.map((f, j) => freqChip(f, 'gf' + j))}</div>
    </div>` : null}
    ${earlier.length ? bucket(w.earlier, earlier) : null}
    <div class="schedule-calendar-day">
      ${hours.map((hr) => {
        const evs = dayEvents.filter((e) => e.at.getHours() === hr);
        return html`<div class="schedule-calendar-hourrow" key=${hr}>
          <span class="schedule-calendar-hour">${String(hr).padStart(2, '0')}:00</span>
          <div class="schedule-calendar-hour-evs">${evs.map(chip)}</div>
        </div>`;
      })}
    </div>
    ${later.length ? bucket(w.later, later) : null}
  </section>`;
}

export default ScheduleCalendar;
