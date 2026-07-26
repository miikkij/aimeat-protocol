/**
 * @file mindmap.js
 * @description Interactive, DETERMINISTIC structure map for an organism or a single workspace, with
 *   selectable chart types — **mindmap** (radial, the default; most compact / best at-a-glance),
 *   **flowchart LR** and **flowchart TD** (familiar tree views). Reuses the offers "Kartta" pattern:
 *   strict-security Mermaid (no Mermaid click handlers); flowchart nodes carry ids we generate
 *   (`ws{i}`, `ws{i}_sp{j}`, `mem{i}`, `ag{i}`, `sp{j}`) and a click resolves them by id, while mindmap
 *   nodes resolve by their label text (mindmap can't carry arbitrary ids). Options (chart type, detail
 *   level, show users, show activity, heatmap) regenerate the source and are PERSISTED per user per
 *   organism/workspace in localStorage. Generated from the /graph data — separate from the README and
 *   the OKF outline, and never persisted server-side. Heatmap colours come from theme CSS variables.
 * @structure StructureMindmap({ scope, graph, onNavigate, label, storageKey });
 *   buildOrganismMindmap / buildWorkspaceMindmap (chart-type aware, used here + by the timeline)
 * @usage import { StructureMindmap } from '/views/profile/organisms/mindmap.js';
 * @version-history
 *   v1.0.0 — 2026-06-22 — Initial: clickable organism/workspace mindmap with level/users/activity/heatmap.
 *   v1.1.0 — 2026-06-22 — Chart types (mindmap default + flowchart LR/TD), per-org/ws localStorage
 *     persistence, label-text click resolution for mindmap mode.
 *   v1.1.1 — 2026-06-23 — Fix: strip trailing heat marker from mindmap click labels so space nodes
 *     (no " · " separator at the "+ Spaces" level) resolve and navigate, not just workspace nodes.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Mermaid } from '/components/Mermaid.js';

/** Sanitize a label for a Mermaid quoted flowchart string. */
function mmdLabel(s) {
  return String(s ?? '').replace(/["\n\r]/g, ' ').replace(/[<>|{}[\]]/g, '').trim().slice(0, 48) || '—';
}
/** Stricter sanitize for MINDMAP labels — also strips parentheses (mindmap treats `(...)` as a node
 *  shape, so a label like "Ledger (410)" would mis-parse). Counts are shown with " · N" instead. */
function mmLabel(s) {
  return String(s ?? '').replace(/["\n\r]/g, ' ').replace(/[<>|{}[\]()]/g, '').trim().slice(0, 48) || '—';
}

function heatBucket(n) {
  if (!n) return 0;
  if (n <= 3) return 1;
  if (n <= 10) return 2;
  return 3;
}

/** Heat colours from theme CSS variables (source of truth = theme.css). */
function heatColors() {
  const cs = typeof window !== 'undefined' ? getComputedStyle(document.documentElement) : null;
  const v = (n, fb) => ((cs && cs.getPropertyValue(n).trim()) || fb);
  return {
    1: { fill: v('--success-bg', '#D1FAE5'), stroke: v('--success-fg', '#047857') },
    2: { fill: v('--warn-bg', '#FEF3C7'), stroke: v('--warn-fg', '#B45309') },
    3: { fill: v('--danger-bg', '#FEE2E2'), stroke: v('--danger-fg', '#DC2626') },
  };
}

/** classDef + class lines for the flowchart heatmap (mindmap uses :::class + CSS instead). */
function flowchartHeatLines(assignments) {
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

function activitySuffix(opts, { records, documents, lastActivity }) {
  if (!opts.showActivity) return '';
  const bits = [];
  if (documents) bits.push(`${documents}d`);
  if (records) bits.push(`${records}r`);
  let s = bits.length ? ` · ${bits.join('+')}` : '';
  if (lastActivity) s += ` · ${String(lastActivity).slice(0, 10)}`;
  return s;
}

/* ── Flowchart builders (LR / TD) — node ids encode the target for click resolution ── */

function buildOrgFlowchart(graph, opts) {
  const dir = opts.chartType === 'flowchart-td' ? 'TD' : 'LR';
  const lines = [`flowchart ${dir}`, `  org["${mmdLabel(graph.name)}"]`];
  const heat = [];
  (graph.workspaces || []).forEach((w, i) => {
    const wsTotal = (w.totalRecords || 0) + (w.totalDocuments || 0);
    const wsLabel = mmdLabel(w.name) + activitySuffix(opts, { records: w.totalRecords, documents: w.totalDocuments, lastActivity: w.lastActivity });
    lines.push(`  org --> ws${i}["${wsLabel}"]`);
    if (opts.heatmap) { const b = heatBucket(wsTotal); if (b) heat.push({ id: `ws${i}`, bucket: b }); }
    if (opts.level === 'spaces' || opts.level === 'counts') {
      (w.spaces || []).forEach((sp, j) => {
        const c = opts.level === 'counts' ? ` (${sp.count || 0})` : '';
        lines.push(`  ws${i} --> ws${i}_sp${j}["${mmdLabel(sp.name)}${c}"]`);
        if (opts.heatmap) { const b = heatBucket(sp.count || 0); if (b) heat.push({ id: `ws${i}_sp${j}`, bucket: b }); }
      });
    }
  });
  if (opts.showUsers) {
    (graph.members || []).forEach((m, i) => lines.push(`  org --> mem${i}["👤 ${mmdLabel(m.name)}"]`));
    (graph.agents || []).forEach((a, i) => lines.push(`  org --> ag${i}["🤖 ${mmdLabel(a.name || a.gaii)}"]`));
  }
  return lines.concat(flowchartHeatLines(heat)).join('\n');
}

function buildWsFlowchart(node, opts) {
  const dir = opts.chartType === 'flowchart-td' ? 'TD' : 'LR';
  const wsLabel = mmdLabel(node.name) + activitySuffix(opts, { records: node.totalRecords, documents: node.totalDocuments, lastActivity: node.lastActivity });
  const lines = [`flowchart ${dir}`, `  wsroot["${wsLabel}"]`];
  const heat = [];
  if (opts.level !== 'ws') {
    (node.spaces || []).forEach((sp, j) => {
      const c = opts.level === 'counts' ? ` (${sp.count || 0})` : '';
      lines.push(`  wsroot --> sp${j}["${mmdLabel(sp.name)}${c}"]`);
      if (opts.heatmap) { const b = heatBucket(sp.count || 0); if (b) heat.push({ id: `sp${j}`, bucket: b }); }
    });
  }
  return lines.concat(flowchartHeatLines(heat)).join('\n');
}

/* ── Mindmap builders (radial) — labels resolve clicks by text. Mermaid's mindmap does NOT support
 *    the `:::class` node-class syntax (it renders it as literal text), so the heatmap is shown with a
 *    trailing marker emoji instead of a coloured shape. ── */

const HEAT_MARK = { 1: '🟢', 2: '🔶', 3: '🔥' };
function heatMark(opts, n) { if (!opts.heatmap) return ''; const b = heatBucket(n); return b ? ` ${HEAT_MARK[b]}` : ''; }

function buildOrgMindmap(graph, opts) {
  const lines = ['mindmap', `  root((${mmLabel(graph.name)}))`];
  (graph.workspaces || []).forEach((w) => {
    const wsTotal = (w.totalRecords || 0) + (w.totalDocuments || 0);
    const wsLabel = mmLabel(w.name) + activitySuffix(opts, { records: w.totalRecords, documents: w.totalDocuments, lastActivity: w.lastActivity });
    lines.push(`    ${wsLabel}${heatMark(opts, wsTotal)}`);
    if (opts.level === 'spaces' || opts.level === 'counts') {
      (w.spaces || []).forEach((sp) => {
        const c = opts.level === 'counts' ? ` · ${sp.count || 0}` : '';
        lines.push(`      ${mmLabel(sp.name)}${c}${heatMark(opts, sp.count || 0)}`);
      });
    }
  });
  if (opts.showUsers) {
    (graph.members || []).forEach((m) => lines.push(`    👤 ${mmLabel(m.name)}`));
    (graph.agents || []).forEach((a) => lines.push(`    🤖 ${mmLabel(a.name || a.gaii)}`));
  }
  return lines.join('\n');
}

function buildWsMindmap(node, opts) {
  const wsLabel = mmLabel(node.name) + activitySuffix(opts, { records: node.totalRecords, documents: node.totalDocuments, lastActivity: node.lastActivity });
  const lines = ['mindmap', `  root((${wsLabel}))`];
  if (opts.level !== 'ws') {
    (node.spaces || []).forEach((sp) => {
      const c = opts.level === 'counts' ? ` · ${sp.count || 0}` : '';
      lines.push(`    ${mmLabel(sp.name)}${c}${heatMark(opts, sp.count || 0)}`);
    });
  }
  return lines.join('\n');
}

/** Build deterministic Mermaid source for an ORGANISM graph honouring opts.chartType. */
export function buildOrganismMindmap(graph, opts) {
  return opts.chartType === 'mindmap' ? buildOrgMindmap(graph, opts) : buildOrgFlowchart(graph, opts);
}
/** Build deterministic Mermaid source for a single WORKSPACE graph node honouring opts.chartType. */
export function buildWorkspaceMindmap(node, opts) {
  return opts.chartType === 'mindmap' ? buildWsMindmap(node, opts) : buildWsFlowchart(node, opts);
}

/* ── Click resolution ── */

/** Flowchart: parse the clicked node's DOM id (it embeds the generated id). */
function resolveFlowchartClick(scope, graph, domId) {
  if (scope === 'organism') {
    let m = /ws(\d+)_sp(\d+)/.exec(domId);
    if (m) { const w = graph.workspaces?.[+m[1]]; const sp = w?.spaces?.[+m[2]]; return (w && sp) ? { type: 'space', wsId: w.id, space: sp.name } : null; }
    m = /ws(\d+)(?![_\d])/.exec(domId);
    if (m) { const w = graph.workspaces?.[+m[1]]; return w ? { type: 'workspace', wsId: w.id } : null; }
    if (/mem\d+/.test(domId) || /ag\d+/.test(domId)) return { type: 'members' };
    return null;
  }
  const m = /sp(\d+)/.exec(domId);
  if (m) { const sp = graph.spaces?.[+m[1]]; return sp ? { type: 'space', space: sp.name } : null; }
  return null;
}

/** Mindmap: resolve by the clicked node's label text (mindmap nodes have no stable id). Strips the
 *  activity/count suffix and the user emoji, then matches the core name to a workspace / space /
 *  member. Workspace + member matches are exact; a space name is matched to the first workspace that
 *  has it (mindmap can't disambiguate a repeated space name across workspaces — opens that workspace
 *  on the matched space tab). */
function resolveMindmapClick(scope, graph, text) {
  // Strip the activity suffix (everything after the first " · "), a leading user/agent emoji, and a
  // trailing heat marker. The heat mark is appended with just a leading space (no " · "), so at the
  // "+ Spaces" level — where space nodes carry no count separator — it would otherwise stay glued to
  // the name and break the exact match below.
  const core = String(text || '').trim()
    .split(' · ')[0]
    .replace(/^👤\s*|^🤖\s*/, '')
    .replace(/\s*[🟢🔶🔥]\s*$/u, '')
    .trim();
  if (!core) return null;
  if (scope === 'organism') {
    for (const w of (graph.workspaces || [])) if (w.name === core) return { type: 'workspace', wsId: w.id };
    for (const w of (graph.workspaces || [])) for (const sp of (w.spaces || [])) if (sp.name === core) return { type: 'space', wsId: w.id, space: sp.name };
    if ((graph.members || []).some(m => m.name === core) || (graph.agents || []).some(a => (a.name || a.gaii) === core)) return { type: 'members' };
    return null;
  }
  for (const sp of (graph.spaces || [])) if (sp.name === core) return { type: 'space', space: sp.name };
  return null;
}

const CHART_TYPES = [
  { key: 'mindmap', label: 'mindmap.chartMindmap', fallback: 'Mindmap' },
  { key: 'flowchart-lr', label: 'mindmap.chartLr', fallback: 'Flowchart →' },
  { key: 'flowchart-td', label: 'mindmap.chartTd', fallback: 'Flowchart ↓' },
];
const LEVELS = [
  { key: 'ws', label: 'mindmap.levelWs', fallback: 'Workspaces' },
  { key: 'spaces', label: 'mindmap.levelSpaces', fallback: '+ Spaces' },
  { key: 'counts', label: 'mindmap.levelCounts', fallback: '+ Counts' },
];

const DEFAULTS = { chartType: 'mindmap', level: 'spaces', showUsers: false, showActivity: true, heatmap: true };

/** Load persisted options for this org/ws (per-user via localStorage), merged over defaults. */
function loadOpts(storageKey) {
  if (!storageKey) return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(`aimeat.mm.${storageKey}`);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch { return { ...DEFAULTS }; }
}
function saveOpts(storageKey, opts) {
  if (!storageKey) return;
  try { localStorage.setItem(`aimeat.mm.${storageKey}`, JSON.stringify(opts)); } catch { /* quota/private mode — non-fatal */ }   // eslint-disable-line aimeat/no-silent-catch -- quota/private mode — non-fatal
}

/**
 * StructureMindmap — collapsible interactive map. Default collapsed so the Mermaid bundle only loads
 * when asked for. scope 'organism' (root → workspaces → spaces + members/agents) or 'workspace'.
 * onNavigate(target): { type:'workspace', wsId } | { type:'space', wsId?, space } | { type:'members' }.
 * @param {{ scope:'organism'|'workspace', graph:object, onNavigate:(t:object)=>void, label?:string, storageKey?:string }} props
 */
export function StructureMindmap({ scope, graph, onNavigate, label, storageKey }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState(() => loadOpts(storageKey));

  if (!graph) return null;
  const set = (patch) => setOpts(prev => { const next = { ...prev, ...patch }; saveOpts(storageKey, next); return next; });

  const src = open
    ? (scope === 'organism' ? buildOrganismMindmap(graph, opts) : buildWorkspaceMindmap(graph, opts))
    : '';

  const onMapClick = (e) => {
    if (opts.chartType === 'mindmap') {
      const g = e.target?.closest?.('.mindmap-node, [class*="mindmap"], g');
      const target = resolveMindmapClick(scope, graph, (g?.textContent) || e.target?.textContent || '');
      if (target) onNavigate?.(target);
    } else {
      const node = e.target?.closest?.('.node');
      if (!node) return;
      const target = resolveFlowchartClick(scope, graph, node.id || '');
      if (target) onNavigate?.(target);
    }
  };

  const lbl = label || (scope === 'organism' ? (t('mindmap.titleOrg') || 'Organism map') : (t('mindmap.titleWs') || 'Workspace map'));

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
              <span>${t('mindmap.chart') || 'Chart'}</span>
              <select class="input-field input-sm" value=${opts.chartType} onChange=${e => set({ chartType: e.target.value })}>
                ${CHART_TYPES.map(c => html`<option value=${c.key}>${t(c.label) || c.fallback}</option>`)}
              </select>
            </label>
            <label class="pj-mm-opt">
              <span>${t('mindmap.level') || 'Level'}</span>
              <select class="input-field input-sm" value=${opts.level} onChange=${e => set({ level: e.target.value })}>
                ${LEVELS.map(l => html`<option value=${l.key}>${t(l.label) || l.fallback}</option>`)}
              </select>
            </label>
            ${scope === 'organism' ? html`
              <label class="pj-mm-check"><input type="checkbox" checked=${opts.showUsers} onChange=${e => set({ showUsers: e.target.checked })} /> ${t('mindmap.showUsers') || 'Users'}</label>
            ` : null}
            <label class="pj-mm-check"><input type="checkbox" checked=${opts.showActivity} onChange=${e => set({ showActivity: e.target.checked })} /> ${t('mindmap.showActivity') || 'Activity'}</label>
            <label class="pj-mm-check"><input type="checkbox" checked=${opts.heatmap} onChange=${e => set({ heatmap: e.target.checked })} /> ${t('mindmap.heatmap') || 'Heatmap'}</label>
          </div>
          <div class="pj-mindmap-canvas of-mapwrap--clickable" onClick=${onMapClick}>
            <${Mermaid} chart=${src} />
          </div>
          <div class="pj-mindmap-hint section-desc">${t('mindmap.clickHint') || 'Click a node to open it.'}</div>
        </div>` : null}
    </div>`;
}
