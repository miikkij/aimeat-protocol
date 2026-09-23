/**
 * @file crew-dag.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The task-order picture in the Crew tab: tasks as boxes, `context` edges as arrows,
 *   laid out by depth (a task sits one row below the deepest task it reads). A crew definition's
 *   context may only point at EARLIER tasks, so the layout is a plain pass over the list and the
 *   picture cannot loop. Inline SVG, theme colours from CSS variables, no library: the profile
 *   does not load the app-side dag cortex for a dozen boxes.
 * @structure layoutTasks(tasks) → { nodes, edges, width, height } · TaskDag({ tasks, problemIds })
 * @version-history
 *   2026-09-22 -- The picture carries its colours as SVG attributes reading the theme tokens, with no
 *     class and no wrapper of its own, so the agents-crew sheet can go; square corners, as every part.
 *   v1.0.0 -- 2026-08-28 -- Initial (JSON-agent Crew tab).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

const BOX_W = 150;
const BOX_H = 44;
const GAP_X = 24;
const GAP_Y = 40;
const PAD = 12;

/** Rows by depth, columns by order within a row. Unknown context ids are drawn as dangling edges. */
export function layoutTasks(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const depth = new Map();
  const byId = new Map();
  list.forEach((t, i) => {
    const id = (t && typeof t.id === 'string' && t.id) ? t.id : `#${i + 1}`;
    byId.set(id, i);
    let d = 0;
    for (const ref of (Array.isArray(t?.context) ? t.context : [])) {
      const j = byId.get(ref);
      if (j !== undefined && j < i) d = Math.max(d, (depth.get(j) ?? 0) + 1);
    }
    depth.set(i, d);
  });
  const rows = new Map();
  list.forEach((_, i) => {
    const d = depth.get(i) ?? 0;
    if (!rows.has(d)) rows.set(d, []);
    rows.get(d).push(i);
  });
  const nodes = list.map((t, i) => {
    const d = depth.get(i) ?? 0;
    const row = rows.get(d);
    const col = row.indexOf(i);
    const id = (t && typeof t.id === 'string' && t.id) ? t.id : `#${i + 1}`;
    return {
      index: i, id, agent: (t && typeof t.agent === 'string') ? t.agent : '',
      x: PAD + col * (BOX_W + GAP_X), y: PAD + d * (BOX_H + GAP_Y),
    };
  });
  const edges = [];
  list.forEach((t, i) => {
    for (const ref of (Array.isArray(t?.context) ? t.context : [])) {
      const j = byId.get(ref);
      if (j !== undefined && j < i) edges.push({ from: j, to: i });
    }
  });
  const cols = Math.max(1, ...[...rows.values()].map(r => r.length));
  const width = PAD * 2 + cols * BOX_W + (cols - 1) * GAP_X;
  const height = PAD * 2 + rows.size * BOX_H + Math.max(0, rows.size - 1) * GAP_Y;
  return { nodes, edges, width: Math.max(width, BOX_W + PAD * 2), height: Math.max(height, BOX_H + PAD * 2) };
}

/** The picture. `problemIds` marks tasks the validator anchored an error to. */
export function TaskDag({ tasks, problemIds }) {
  const { nodes, edges, width, height } = layoutTasks(tasks);
  const bad = problemIds || new Set();
  if (nodes.length === 0) return null;
  // Width follows the column and the height stays the drawing's own, so with `meet` the picture
  // shrinks to fit a narrow column and never grows past its natural size on a wide one.
  return html`
      <svg viewBox="0 0 ${width} ${height}" width="100%" height=${height} preserveAspectRatio="xMinYMin meet" role="img">
        <defs>
          <marker id="pf-agd-crew-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" fill="var(--accent)" />
          </marker>
        </defs>
        ${edges.map(e => {
          const a = nodes[e.from]; const b = nodes[e.to];
          const x1 = a.x + BOX_W / 2, y1 = a.y + BOX_H, x2 = b.x + BOX_W / 2, y2 = b.y;
          const my = (y1 + y2) / 2;
          return html`<path key=${`${e.from}-${e.to}`} fill="none" stroke="var(--accent)" stroke-width="1.5"
            d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}" marker-end="url(#pf-agd-crew-arrow)" />`;
        })}
        ${nodes.map(n => html`
          <g key=${n.index} transform="translate(${n.x},${n.y})">
            <rect width=${BOX_W} height=${BOX_H} fill="var(--card-bg-alt)"
              stroke=${bad.has(n.index) ? 'var(--danger)' : 'var(--border)'} stroke-width=${bad.has(n.index) ? 2 : 1} />
            <text x="8" y="18" font-size="12" font-weight="600" fill="var(--text)" font-family="var(--font-mono)">${n.id}</text>
            <text x="8" y="34" font-size="11" fill="var(--text-dim)">${n.agent}</text>
          </g>
        `)}
      </svg>
  `;
}
