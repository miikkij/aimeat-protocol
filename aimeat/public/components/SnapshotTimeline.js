/**
 * @file public/components/SnapshotTimeline.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How a thing's shape grew, point by point, with a picture of it as it was at the point
 *   you pick. On top, a diagram of the whole history (the page passes it, a Mermaid timeline). Under
 *   it two columns: the list of points (a date, what changed, the counts at that point), each one a
 *   button with the chosen one marked in coral, and beside it the picture of the chosen point (the
 *   page passes it). The columns stack on a phone. A page passes data; it never writes a class. Its
 *   look is css/components/snapshot-timeline.css (the values of org-timeline.css, the .pj-timeline-*
 *   rules, under the component's own names).
 * @structure SnapshotTimeline({ diagram, points, picture })
 * @usage html`<${SnapshotTimeline} diagram=${html`<${Mermaid} chart=${chart} />`}
 *          points=${rows.map((r) => ({ key: r.at, date: r.at, event: r.event, counts: '3 ws · 12d', on: sel === r.id, onPick: () => pick(r.id) }))}
 *          picture=${html`<${Mermaid} chart=${map} />`} />`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the organism's development timeline of
 *     views/profile/organisms/timeline-panel.js as a component (page group G2a).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/**
 * @param {{ diagram?: any, points: Array<{ key?: any, date: any, event: any, counts?: any, on?: boolean, onPick?: () => void }>, picture?: any }} props
 */
export function SnapshotTimeline({ diagram, points = [], picture }) {
  return html`
    <div class="snapshot-timeline">
      ${diagram ? html`<div class="snapshot-timeline-diagram">${diagram}</div>` : null}
      <div class="snapshot-timeline-grid">
        <ul class="snapshot-timeline-list">
          ${points.map((p, i) => html`
            <li class=${p.on ? 'snapshot-timeline-point is-on' : 'snapshot-timeline-point'} key=${p.key ?? i}>
              <button type="button" class="snapshot-timeline-entry" aria-pressed=${p.on ? 'true' : 'false'} onClick=${p.onPick}>
                <span class="snapshot-timeline-date poster-time">${p.date}</span>
                <span class="snapshot-timeline-event">${p.event}</span>
                ${p.counts ? html`<span class="snapshot-timeline-counts">${p.counts}</span>` : null}
              </button>
            </li>`)}
        </ul>
        <div class="snapshot-timeline-picture">${picture}</div>
      </div>
    </div>`;
}

export default SnapshotTimeline;
