/**
 * @file mindmap.js
 * @description Interactive, DETERMINISTIC structure mindmap for an organism or a single workspace.
 *   Reuses the offers "Kartta" pattern: a strict-security Mermaid diagram (no Mermaid click handlers)
 *   whose node ids we generate ourselves (`ws{i}`, `ws{i}_sp{j}`, `mem{i}`, `ag{i}`, `sp{j}`) and then
 *   resolve from a click on the rendered SVG → onNavigate(target). Options (depth level, show users,
 *   show activity counts, heatmap) regenerate the source, so the map re-renders live. This is SEPARATE
 *   from the README and the OKF overview: it is generated from the /graph data, not authored, and not
 *   part of OKF. Heatmap colours are read from theme CSS variables (no hardcoded colours).
 * @structure StructureMindmap({ scope, graph, onNavigate, label }); buildOrganismMindmap; buildWorkspaceMindmap
 * @usage import { StructureMindmap } from '/views/profile/organisms/mindmap.js';
 * @version-history
 *   v1.0.0 — 2026-06-22 — Initial: clickable organism/workspace mindmap with level/users/activity/heatmap.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Mermaid } from '/components/Mermaid.js';

/** Sanitize a label for a Mermaid quoted string (strip quotes/newlines/structural chars, clip). */
function mmdLabel(s) {
  return String(s ?? '').replace(/["\n\r]/g, ' ').replace(/[<>|{}[\]]/g, '').trim().slice(0, 48) || '—';
}

/** Bucket an item count into a heat class index (0 = none → no class). */
function heatBucket(n) {
  if (!n) return 0;
  if (n <= 3) return 1;
  if (n <= 10) return 2;
  return 3;
}

/** Read heat colours from theme CSS variables (source of truth stays in theme.css). */
function heatColors() {
  const cs = typeof window !== 'undefined' ? getComputedStyle(document.documentElement) : null;
  const v = (n, fb) => ((cs && cs.getPropertyValue(n).trim()) || fb);
  return {
    1: { fill: v('--success-bg', '#D1FAE5'), stroke: v('--success-fg', '#047857') },
    2: { fill: v('--warn-bg', '#FEF3C7'), stroke: v('--warn-fg', '#B45309') },
    3: { fill: v('--danger-bg', '#FEE2E2'), stroke: v('--danger-fg', '#DC2626') },
  };
}

/** Build the classDef + class lines for the heatmap (only for nodes with content). */
function heatLines(assignments) {
  if (!assignments.length) return [];
  const c = heatColors();
  const lines = [
    `classDef heat1 fill:${c[1].fill},stroke:${c[1].stroke},color:${c[1].stroke};`,
    `classDef heat2 fill:${c[2].fill},stroke:${c[2].stroke},color:${c[2].stroke};`,
    `classDef heat3 fill:${c[3].fill},stroke:${c[3].stroke},color:${c[3].stroke};`,
  ];
  for (const a of assignments) lines.push(`class ${a.id} heat${a.bucket};`);
  return lines;
}

/** Short activity label suffix for a node (counts + last update), when showActivity is on. */
function activitySuffix(opts, { records, documents, lastActivity }) {
  if (!opts.showActivity) return '';
  const bits = [];
  if (documents != null && documents) bits.push(`${documents}d`);
  if (records != null && records) bits.push(`${records}r`);
  let s = bits.length ? ` · ${bits.join('+')}` : '';
  if (lastActivity) s += ` · ${String(lastActivity).slice(0, 10)}`;
  return s;
}

/** Build deterministic Mermaid source for an ORGANISM graph + render options. */
export function buildOrganismMindmap(graph, opts) {
  const lines = ['flowchart LR', `  org["${mmdLabel(graph.name)}"]`];
  const heat = [];
  (graph.workspaces || []).forEach((w, i) => {
    const wsTotal = (w.totalRecords || 0) + (w.totalDocuments || 0);
    const wsLabel = mmdLabel(w.name) + activitySuffix(opts, { records: w.totalRecords, documents: w.totalDocuments, lastActivity: w.lastActivity });
    lines.push(`  org --> ws${i}["${wsLabel}"]`);
    if (opts.heatmap) { const b = heatBucket(wsTotal); if (b) heat.push({ id: `ws${i}`, bucket: b }); }
    if (opts.level === 'spaces' || opts.level === 'counts') {
      (w.spaces || []).forEach((sp, j) => {
        const countSuffix = opts.level === 'counts' ? ` (${sp.count || 0})` : '';
        lines.push(`  ws${i} --> ws${i}_sp${j}["${mmdLabel(sp.name)}${countSuffix}"]`);
        if (opts.heatmap) { const b = heatBucket(sp.count || 0); if (b) heat.push({ id: `ws${i}_sp${j}`, bucket: b }); }
      });
    }
  });
  if (opts.showUsers) {
    (graph.members || []).forEach((m, i) => lines.push(`  org --> mem${i}["👤 ${mmdLabel(m.name)}"]`));
    (graph.agents || []).forEach((a, i) => lines.push(`  org --> ag${i}["🤖 ${mmdLabel(a.name || a.gaii)}"]`));
  }
  return lines.concat(heatLines(heat)).join('\n');
}

/** Build deterministic Mermaid source for a single WORKSPACE graph node + render options. */
export function buildWorkspaceMindmap(node, opts) {
  const wsLabel = mmdLabel(node.name) + activitySuffix(opts, { records: node.totalRecords, documents: node.totalDocuments, lastActivity: node.lastActivity });
  const lines = ['flowchart LR', `  wsroot["${wsLabel}"]`];
  const heat = [];
  if (opts.level !== 'ws') {
    (node.spaces || []).forEach((sp, j) => {
      const countSuffix = opts.level === 'counts' ? ` (${sp.count || 0})` : '';
      lines.push(`  wsroot --> sp${j}["${mmdLabel(sp.name)}${countSuffix}"]`);
      if (opts.heatmap) { const b = heatBucket(sp.count || 0); if (b) heat.push({ id: `sp${j}`, bucket: b }); }
    });
  }
  return lines.concat(heatLines(heat)).join('\n');
}

/** Resolve a click on a rendered Mermaid node to a navigation target, by parsing the node's DOM id
 *  (which embeds the id we generated). Returns null for the root / unknown nodes. */
function resolveClick(scope, graph, domId) {
  if (scope === 'organism') {
    let m = /ws(\d+)_sp(\d+)/.exec(domId);
    if (m) {
      const w = graph.workspaces?.[+m[1]]; const sp = w?.spaces?.[+m[2]];
      if (w && sp) return { type: 'space', wsId: w.id, space: sp.name };
      return null;
    }
    m = /ws(\d+)(?![_\d])/.exec(domId);
    if (m) { const w = graph.workspaces?.[+m[1]]; return w ? { type: 'workspace', wsId: w.id } : null; }
    if (/mem\d+/.test(domId) || /ag\d+/.test(domId)) return { type: 'members' };
    return null;
  }
  // workspace scope
  const m = /sp(\d+)/.exec(domId);
  if (m) { const sp = graph.spaces?.[+m[1]]; return sp ? { type: 'space', space: sp.name } : null; }
  return null;
}

const LEVELS = [
  { key: 'ws', label: 'mindmap.levelWs', fallback: 'Workspaces' },
  { key: 'spaces', label: 'mindmap.levelSpaces', fallback: '+ Spaces' },
  { key: 'counts', label: 'mindmap.levelCounts', fallback: '+ Counts' },
];

/**
 * StructureMindmap — collapsible interactive map. Default collapsed so the 3MB Mermaid bundle only
 * loads when asked for. scope 'organism' (root = organism, with workspaces → spaces + members/agents)
 * or 'workspace' (root = the workspace, with its spaces). onNavigate(target) receives:
 *   { type:'workspace', wsId } | { type:'space', wsId?, space } | { type:'members' }
 * @param {{ scope: 'organism'|'workspace', graph: object, onNavigate: (t:object)=>void, label?: string }} props
 */
export function StructureMindmap({ scope, graph, onNavigate, label }) {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState(scope === 'workspace' ? 'spaces' : 'spaces');
  const [showUsers, setShowUsers] = useState(false);
  const [showActivity, setShowActivity] = useState(true);
  const [heatmap, setHeatmap] = useState(true);

  if (!graph) return null;
  const opts = { level, showUsers, showActivity, heatmap };
  const src = open
    ? (scope === 'organism' ? buildOrganismMindmap(graph, opts) : buildWorkspaceMindmap(graph, opts))
    : '';

  const onMapClick = (e) => {
    const node = e.target?.closest?.('.node');
    if (!node) return;
    const target = resolveClick(scope, graph, node.id || '');
    if (target) onNavigate?.(target);
  };

  const lbl = label || (scope === 'organism'
    ? (t('mindmap.titleOrg') || 'Organism map')
    : (t('mindmap.titleWs') || 'Workspace map'));

  return html`
    <div class="pj-mindmap">
      <button class="pj-struct-toggle" aria-expanded=${open} onClick=${() => setOpen(o => !o)}>
        <span class="pj-struct-caret">${open ? '▾' : '▸'}</span>
        <span>${'🗺️ '}${lbl}</span>
      </button>
      ${open ? html`
        <div class="pj-mindmap-body card-detail">
          <div class="pj-mindmap-opts">
            <label class="pj-mm-opt">
              <span>${t('mindmap.level') || 'Level'}</span>
              <select class="input-field input-sm" value=${level} onChange=${e => setLevel(e.target.value)}>
                ${LEVELS.map(l => html`<option value=${l.key}>${t(l.label) || l.fallback}</option>`)}
              </select>
            </label>
            ${scope === 'organism' ? html`
              <label class="pj-mm-check"><input type="checkbox" checked=${showUsers} onChange=${e => setShowUsers(e.target.checked)} /> ${t('mindmap.showUsers') || 'Users'}</label>
            ` : null}
            <label class="pj-mm-check"><input type="checkbox" checked=${showActivity} onChange=${e => setShowActivity(e.target.checked)} /> ${t('mindmap.showActivity') || 'Activity'}</label>
            <label class="pj-mm-check"><input type="checkbox" checked=${heatmap} onChange=${e => setHeatmap(e.target.checked)} /> ${t('mindmap.heatmap') || 'Heatmap'}</label>
          </div>
          <div class="pj-mindmap-canvas of-mapwrap--clickable" onClick=${onMapClick}>
            <${Mermaid} chart=${src} />
          </div>
          <div class="pj-mindmap-hint section-desc">${t('mindmap.clickHint') || 'Click a node to open it.'}</div>
        </div>` : null}
    </div>`;
}
