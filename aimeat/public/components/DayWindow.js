/**
 * @file public/components/DayWindow.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The window of days a count is read over: the ready windows as words ("Today", "7 days",
 *   "30 days"…), the chosen one loud, and a typed number of days with its label and "Show". One line
 *   that wraps. A page passes the days, the words and what happens on a pick; it never writes a class.
 *   The look is css/components/day-window.css (the old app catalogue's visitor window, .vis-window:
 *   its doors at the detail's .78rem, the loud one 18px in from its ends, the coral capital label and
 *   the underlined number field, 92px wide).
 *
 *   DayWindow({ days, presets, max, busy, id, words, onDays })
 *   - days: the window shown now; presets: the ready windows (0 is "today"); max: the largest number
 *     the field takes (its max attribute).
 *   - busy: the doors wait (a count is being read).
 *   - id: the number field's id (its label points at it).
 *   - words: { today, days(n), label, show }.
 *   - onDays(n): a ready window was pressed (n is a number) or a typed one was asked for with Enter or
 *     "Show" (n is what was typed, as typed: the page decides what it accepts).
 * @structure DayWindow(props)
 * @usage html`<${DayWindow} days=${days} presets=${[0, 7, 30, 90, 360]} max=${360} busy=${loading}
 *          id="vis-days" words=${{ today: x('today'), days: (n) => x('days', { n }), label: x('daysLabel'),
 *          show: x('show') }} onDays=${pick} />`
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial: the old app catalogue's visitor window (js/visitors.js windowHtml,
 *     app-catalog-visitors.css .vis-window) as a component (appcat parity, sections-b).
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { Action, Loud } from '/components/Action.js';

const html = htm.bind(h);

/**
 * @param {{ days: number, presets?: number[], max?: number, busy?: boolean, id?: string,
 *   words: { today: any, days: (n: number) => any, label: any, show: any }, onDays: (n: any) => void }} props
 */
export function DayWindow({ days, presets = [0, 7, 30, 90, 360], max, busy, id, words, onDays }) {
  const [typed, setTyped] = useState(String(days));
  useEffect(() => { setTyped(String(days)); }, [days]);
  const say = (n) => (n === 0 ? words.today : words.days(n));
  // A typed window is asked for, and the field shows the window in force again (the page's answer
  // follows through `days`): a number the page refused does not stay in the field.
  const ask = (raw) => { onDays(raw); setTyped(String(days)); };
  return html`<div class="day-window">
    ${presets.map((n) => (n === days
      ? html`<${Loud} key=${n} control disabled=${busy} onClick=${() => onDays(n)}>${say(n)}<//>`
      : html`<${Action} key=${n} small disabled=${busy} onClick=${() => onDays(n)}>${say(n)}<//>`))}
    <label class="day-window-label" for=${id}>${words.label}</label>
    <input id=${id} class="day-window-days" type="number" inputmode="numeric" min="0" max=${max} step="1" value=${typed}
      onInput=${(e) => setTyped(e.currentTarget.value)}
      onKeyDown=${(e) => { if (e.key === 'Enter') ask(e.currentTarget.value); }} />
    <${Action} small disabled=${busy} onClick=${() => ask(typed)}>${words.show}<//>
  </div>`;
}

export default DayWindow;
