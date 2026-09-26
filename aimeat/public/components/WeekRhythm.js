/**
 * @file public/components/WeekRhythm.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The week's rhythm: one row per repeating thing (its time in typewriter, its name as the
 *   way into it with a typewriter note, a mark on each day it fires, the last time it ran), the days as
 *   columns under their heads, today's column on a pale sun and its head on the sun; a mark is coral
 *   when an agent does the job and faint on a day it does not fire. On a narrow screen the last run and
 *   the note go and the day columns narrow. A special view of the Scheduler page, drawn from data; the
 *   page passes the days, the rows and the column words and never a class.
 *   Its look is css/components/week-rhythm.css (its own class names, .week-rhythm and .week-rhythm-*).
 * @structure WeekRhythm({ heads, days, rows })
 * @usage html`<${WeekRhythm} heads=${{ time: c('colTime'), name: c('colSchedule'), last: c('colLast') }}
 *          days=${m.days.map((d, i) => ({ key: i, label: calendar(d, { weekday: 'short' }), sub: d.getDate(), today: i === 0 }))}
 *          rows=${rows.map((r) => ({ key: r.s.id, time, name, note, onOpen, days: r.days, agent, last }))} />`
 * @version-history
 *   v1.1.0 — 2026-09-27 — Its own class names (.sc-rhythm → .week-rhythm, .sc-hd → .week-rhythm-head,
 *     .sc-hd--day → .week-rhythm-head--day, .sc-today → .week-rhythm-today, .sc-t → .week-rhythm-time,
 *     .sc-nm → .week-rhythm-name, .sc-d → .week-rhythm-day (--no, --agent), .sc-last →
 *     .week-rhythm-last); the name's way in is .week-rhythm-open with .og-tbl-name's values instead
 *     of the space table's class (Jouni: components draw only their own class names, a move).
 *   v1.0.0 — 2026-09-26 — Initial: the Scheduler's week rhythm (.sc-rhythm, written as markup in
 *     views/profile/scheduler/cover.js) as a component that takes data (page group G5).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');

/**
 * @param {{ heads: { time: any, name: any, last: any },
 *   days: Array<{ key?: any, label: any, sub?: any, today?: boolean }>,
 *   rows: Array<{ key: any, time: any, name: any, note?: any, onOpen?: () => void, openLabel?: string,
 *     days: boolean[], agent?: boolean, last?: any }> }} props
 */
export function WeekRhythm({ heads, days = [], rows = [] }) {
  return html`
    <div class="week-rhythm">
      <div class="week-rhythm-head poster-label">${heads.time}</div><div class="week-rhythm-head poster-label">${heads.name}</div>
      ${days.map((d, i) => html`<div class=${cx('week-rhythm-head week-rhythm-head--day poster-label', d.today && 'week-rhythm-today')} key=${'h' + (d.key ?? i)}>${d.label}<small>${d.sub}</small></div>`)}
      <div class="week-rhythm-head poster-label">${heads.last}</div>
      ${rows.map((r) => html`
        <div class="week-rhythm-time" key=${'t' + r.key}>${r.time}</div>
        <div class="week-rhythm-name" key=${'n' + r.key}>${r.onOpen
          ? html`<button type="button" class="week-rhythm-open" aria-label=${r.openLabel} onClick=${r.onOpen}>${r.name}</button>`
          : r.name}<i>${r.note}</i></div>
        ${(r.days || []).map((on, i) => html`<div class=${cx('week-rhythm-day', !on && 'week-rhythm-day--no', days[i]?.today && 'week-rhythm-today', r.agent && 'week-rhythm-day--agent')} key=${'d' + r.key + i}>${on ? '●' : '·'}</div>`)}
        <div class="week-rhythm-last poster-time" key=${'l' + r.key}>${r.last}</div>`)}
    </div>`;
}

export default WeekRhythm;
