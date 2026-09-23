/**
 * @file public/components/DayGroup.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A record read day by day: DayGroup is one day, its name as a small coral heading
 *   over a 3px rule and its rows (timeline rows) under it; DayList holds the days; DayEmpty is the
 *   one line when nothing has been recorded. Its look is css/components/day-group.css; the
 *   catalogue entry is `day-group`.
 * @structure DayGroup({ title, children }) · DayList({ children }) · DayEmpty({ children })
 * @usage html`<${DayList}><${DayGroup} title=${label}><${TimelineRow} …/><//><//>`
 * @version-history
 *   v1.1.0 — 2026-09-23 — DayEmpty is the quiet sentence (.poster-quiet), Jouni's decision "Empty line".
 *   v1.0.0 — 2026-09-23 — Moved out of views/home/history.js with its markup unchanged (UI
 *     consolidation phase 1, a move).
 */
import { h } from 'preact';
import htm from 'htm';
import { TimelineList } from '/components/Timeline.js';

const html = htm.bind(h);

/** @param {{ title: any, children?: any }} props */
export function DayGroup({ title, children }) {
  return html`
    <div class="poster-day">
      <h3 class="poster-day-title">${title}</h3>
      <${TimelineList}>
        ${children}
      <//>
    </div>`;
}

export function DayList({ children }) {
  return html`<div class="poster-day-list">
            ${children}
          </div>`;
}

export function DayEmpty({ children }) {
  return html`<p class="poster-quiet">
            ${children}
          </p>`;
}

export default DayGroup;
