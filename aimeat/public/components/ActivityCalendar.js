/**
 * @file public/components/ActivityCalendar.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A year of activity as a calendar, one small square per day and one column per week
 *   (GitHub's contribution calendar), where every day is split into four quarters so it can say
 *   four counts at once (a workspace's documents and records, each as drafts and as published).
 *   Each quarter's shade is its own count's level, 0 to 4. The month names run over the weeks, the
 *   day names down the side, and a key under the calendar says what each quarter is and how the
 *   shades go from less to more. A page passes the weeks as data and the words; it never writes a
 *   class. Its look is css/components/activity-calendar.css.
 *
 *   - weeks: an array of weeks, each an array of seven days (Sunday first). A day is null when it
 *     is still to come, or { title, levels: [a, b, c, d] }: the tooltip, and the level (0-4) of
 *     the upper left, upper right, lower left and lower right quarter.
 *   - months: one label per week (the month's short name where a month starts, else '').
 *   - days: the seven labels down the side ('' where a day has none).
 *   - quarters: the four words of the key, in the same order as the levels.
 *   - less, more: the two ends of the shade key.
 * @structure ActivityCalendar({ weeks, months, days, quarters, less, more })
 * @usage html`<${ActivityCalendar} weeks=${weeks} months=${months} days=${['', 'Mon', '', 'Wed', '', 'Fri', '']}
 *          quarters=${['↖ Docs draft', '↗ Docs published', '↙ Records draft', '↘ Records published']}
 *          less=${'Less'} more=${'More'} />`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the workspace activity heatmap of views/profile/organisms/activity-panel.js
 *     as a component with its own class names (the .pj-hm-* markup, page group G2a).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);
const LEVELS = [0, 1, 2, 3, 4];
const lvl = (n) => (LEVELS.includes(n) ? n : 0);

/** One quarter of a day, or one step of the shade key. */
function Quarter({ level }) {
  return html`<i class=${`activity-calendar-q activity-calendar-q--${lvl(level)}`}></i>`;
}

/** One day: four quarters, or an empty place for a day still to come. */
function Day({ day, big }) {
  if (!day) return html`<span class="activity-calendar-day activity-calendar-day--future"></span>`;
  const [a, b, c, d] = day.levels || [];
  return html`<span class=${`activity-calendar-day${big ? ' activity-calendar-day--key' : ''}`} title=${day.title}>
    <${Quarter} level=${a} /><${Quarter} level=${b} /><${Quarter} level=${c} /><${Quarter} level=${d} />
  </span>`;
}

/** @param {{ weeks: Array<Array<null|{ title?: string, levels: number[] }>>, months?: string[], days?: string[], quarters?: any[], less?: any, more?: any }} props */
export function ActivityCalendar({ weeks = [], months = [], days = [], quarters = [], less, more }) {
  return html`
    <div class="activity-calendar">
      <div class="activity-calendar-scroll">
        <div class="activity-calendar-months">${months.map((m, i) => html`<span key=${i}>${m}</span>`)}</div>
        <div class="activity-calendar-body">
          <div class="activity-calendar-days">${days.map((d, i) => html`<span key=${i}>${d}</span>`)}</div>
          <div class="activity-calendar-weeks">
            ${weeks.map((week, wi) => html`<div class="activity-calendar-week" key=${wi}>
              ${week.map((day, di) => html`<${Day} key=${di} day=${day} />`)}
            </div>`)}
          </div>
        </div>
      </div>
      <div class="activity-calendar-legend">
        <div class="activity-calendar-key">
          <${Day} big day=${{ levels: [1, 3, 2, 4] }} />
          <div class="activity-calendar-key-words">${quarters.map((q, i) => html`<span key=${i}>${q}</span>`)}</div>
        </div>
        <div class="activity-calendar-ramp">
          <span>${less}</span>${LEVELS.map((n) => html`<${Quarter} key=${n} level=${n} />`)}<span>${more}</span>
        </div>
      </div>
    </div>`;
}

export default ActivityCalendar;
