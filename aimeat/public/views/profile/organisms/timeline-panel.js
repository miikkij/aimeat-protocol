/**
 * @file timeline-panel.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Organism STRUCTURE TIMELINE ("Kehitys") — how the organism's shape grew over time.
 *   Reads GET /v1/organisms/:id/structure/history (the trackable structure fingerprint's current
 *   value + archived prior versions) and lists each change chronologically with its diff summary and
 *   date. Selecting a snapshot draws the structural mindmap AS IT WAS at that point, reusing the
 *   deterministic mindmap builder on the stored fingerprint. Collapsible; loads on first expand.
 * @structure TimelinePanel({ orgId })
 * @usage import { TimelinePanel } from '/views/profile/organisms/timeline-panel.js';
 * @version-history
 *   v1.7.0 — 2026-09-26 — Every part is a kit component (page group G2a): the latest rows are the Folds and FoldRow, the panel's body the Box, the timeline with its snapshot map the SnapshotTimeline (components/SnapshotTimeline.js, its own sheet), the loading line the Note, the empty and "pick a point" lines the section description (HeadDesc). The page writes no class.
 *   v1.6.0 — 2026-09-26 — A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.5.0 — 2026-09-26 — Not opened by its parent, the timeline opens under the FoldSection (components/FoldSection.js), a unification: the look most tabs use.
 *   v1.4.0 — 2026-09-26 — Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.3.0 — 2026-09-25 — Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v1.0.0 — 2026-06-22 — Initial: structure timeline view over trackable-memory history (Osa D3).
 *   v1.1.0 — 2026-06-22 — Add a Mermaid `timeline` diagram of the changes; the selected-snapshot map
 *     honours the chart type the user picked for this organism's mindmap (localStorage).
 *   v1.2.0 — 2026-08-29 — loadTimelineRows() and TimelineRecent (the latest few changes as plain rows) for
 *     the organism home's "what has happened" section; the panel takes `defaultOpen` so the home's
 *     "full timeline" door opens it already loaded and without its own toggle. The toggle lost its emoji.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Mermaid } from '/components/Mermaid.js';
import { FoldSection } from '/components/FoldSection.js';
import { Folds, FoldRow } from '/components/Folds.js';
import { Box } from '/components/Box.js';
import { Note } from '/components/Note.js';
import { HeadDesc } from '/components/SubHeading.js';
import { SnapshotTimeline } from '/components/SnapshotTimeline.js';
import { getStructureHistory } from '/js/services/organisms.js';
import { buildOrganismMindmap } from '/views/profile/organisms/mindmap.js';

/** A fingerprint value looks like { fingerprint, _event, _diff, _recordedAt }. Pull a display row. */
function row(entry) {
  const v = entry?.value || {};
  return {
    version: entry.version,
    event: v._event || v._diff || t('timeline.changed') || 'structure changed',
    at: v._recordedAt || entry.recordedAt || '',
    actor: entry.actor || v._actor || '',
    fingerprint: v.fingerprint || null,
  };
}

/** Total counts from a fingerprint, for a compact summary line. */
function totals(fp) {
  if (!fp) return null;
  const ws = (fp.workspaces || []);
  const docs = ws.reduce((n, w) => n + (w.totalDocuments || 0), 0);
  const recs = ws.reduce((n, w) => n + (w.totalRecords || 0), 0);
  return { workspaces: ws.length, documents: docs, records: recs, members: fp.memberCount || 0 };
}

/** The chart type the user picked for THIS organism's mindmap (shared with the snapshot map below). */
function readChartType(orgId) {
  try {
    const raw = localStorage.getItem(`aimeat.mm.org.${orgId}`);
    return (raw && JSON.parse(raw).chartType) || 'mindmap';
  } catch { return 'mindmap'; }
}

/** A Mermaid `timeline` diagram of the structural changes (chronological). `:` is the timeline
 *  separator, so it is stripped from event text; multiple events on one day share a row. */
function buildTimelineDiagram(rows) {
  const chron = rows.slice().reverse();   // rows are newest-first → oldest-first for the time axis
  const byDate = new Map();
  for (const r of chron) {
    const d = String(r.at).slice(0, 10) || '—';
    const ev = String(r.event || '').replace(/[:\n\r]/g, ' ').replace(/[<>|{}]/g, '').trim().slice(0, 60) || 'muutos';
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(ev);
  }
  const lines = ['timeline'];
  for (const [d, evs] of byDate) lines.push(`  ${d} : ${evs.join(' : ')}`);
  return lines.join('\n');
}

/** The history as rows, newest first, the current shape marked. Shared by the panel and the
 *  organism home's "what has happened" list, so both read one fetch's worth of truth. */
export async function loadTimelineRows(orgId) {
  const { current, history } = await getStructureHistory(orgId);
  const all = [];
  if (current) all.push({ ...row({ version: current.version, value: current.value, recordedAt: current.recordedAt }), isCurrent: true });
  for (const e of (history || [])) all.push(row(e));
  return all;
}

/** The latest few changes as plain rows: date, what changed, the shape's counts. */
export function TimelineRecent({ rows, limit = 5 }) {
  const list = (rows || []).slice(0, limit);
  if (!list.length) return html`<${Note}>${t('timeline.empty') || 'No structural history yet.'}<//>`;
  return html`
    <${Folds}>
      ${list.map(r => {
        const tt = totals(r.fingerprint);
        return html`<${FoldRow} key=${r.fingerprint + r.at} kind="row"
          num=${r.isCurrent ? (t('timeline.now') || 'now') : String(r.at).slice(0, 10)}
          name=${r.event}
          right=${tt ? `${tt.workspaces} ws · ${tt.documents}d · ${tt.records}r · ${tt.members}` : null} />`;
      })}
    <//>`;
}

export function TimelinePanel({ orgId, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);   // a fingerprint to draw

  const load = async () => {
    setBusy(true);
    try {
      const all = await loadTimelineRows(orgId);
      setRows(all);
      setSelected(all[0]?.fingerprint || null);
      setLoaded(true);
    } finally { setBusy(false); }
  };
  // Opened by its parent (the home's "full timeline" door), the panel loads at once.
  useEffect(() => { if (defaultOpen && !loaded && !busy) load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !loaded && !busy) await load();
  };

  const body = html`
        <${Box}>
          ${busy ? html`<${Note} kind="loading">${t('organisms.loading') || 'Loading...'}<//>`
            : (!rows.length
              ? html`<${HeadDesc}>${t('timeline.empty') || 'No structural history yet.'}<//>`
              : html`<${SnapshotTimeline}
                  diagram=${html`<${Mermaid} chart=${buildTimelineDiagram(rows)} />`}
                  points=${rows.map((r, i) => {
                    const tt = totals(r.fingerprint);
                    return {
                      key: String(r.at) + ':' + i,
                      date: `${String(r.at).slice(0, 10) || '—'}${r.isCurrent ? ` · ${t('timeline.now') || 'now'}` : ''}`,
                      event: r.event,
                      counts: tt ? `${tt.workspaces} ws · ${tt.documents}d · ${tt.records}r · ${tt.members}👤` : null,
                      on: selected === r.fingerprint,
                      onPick: () => setSelected(r.fingerprint),
                    };
                  })}
                  picture=${selected
                    ? html`<${Mermaid} chart=${buildOrganismMindmap({ name: t('timeline.snapshot') || 'Snapshot', workspaces: selected.workspaces || [], members: [], agents: [] }, { chartType: readChartType(orgId), level: 'counts', showUsers: false, showActivity: true, heatmap: true })} />`
                    : html`<${HeadDesc}>${t('timeline.pick') || 'Pick a point to see the structure then.'}<//>`} />`)}
        <//>`;

  // Opened by its parent, the panel is the body alone; otherwise it is a section that opens.
  return defaultOpen
    ? (open ? body : null)
    : html`<${FoldSection} num="" title=${t('timeline.title') || 'Development timeline'} open=${open} onToggle=${toggle}>${body}<//>`;
}
