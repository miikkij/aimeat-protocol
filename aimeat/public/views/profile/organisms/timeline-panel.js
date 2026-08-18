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
 *   v1.0.0 — 2026-06-22 — Initial: structure timeline view over trackable-memory history (Osa D3).
 *   v1.1.0 — 2026-06-22 — Add a Mermaid `timeline` diagram of the changes; the selected-snapshot map
 *     honours the chart type the user picked for this organism's mindmap (localStorage).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Spinner } from '/views/profile/shared.js';
import { Mermaid } from '/components/Mermaid.js';
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

export function TimelinePanel({ orgId }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);   // a fingerprint to draw

  const load = async () => {
    setBusy(true);
    try {
      const { current, history } = await getStructureHistory(orgId);
      const all = [];
      if (current) all.push({ ...row({ version: current.version, value: current.value, recordedAt: current.recordedAt }), isCurrent: true });
      for (const e of (history || [])) all.push(row(e));
      setRows(all);
      setSelected(all[0]?.fingerprint || null);
      setLoaded(true);
    } finally { setBusy(false); }
  };

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !loaded && !busy) await load();
  };

  return html`
    <div class="pj-timeline">
      <button class="pj-struct-toggle" aria-expanded=${open} onClick=${toggle}>
        <span class="pj-struct-caret">${open ? '▾' : '▸'}</span>
        <span>${'📈 '}${t('timeline.title') || 'Development timeline'}</span>
      </button>
      ${open ? html`
        <div class="pj-timeline-body card-detail">
          ${busy ? html`<${Spinner} text=${t('organisms.loading') || 'Loading...'} />`
            : (!rows.length
              ? html`<div class="section-desc">${t('timeline.empty') || 'No structural history yet.'}</div>`
              : html`
                <div class="pj-timeline-diagram">
                  <${Mermaid} chart=${buildTimelineDiagram(rows)} />
                </div>
                <div class="pj-timeline-grid">
                  <ul class="pj-timeline-list">
                    ${rows.map(r => {
                      const tt = totals(r.fingerprint);
                      return html`
                        <li class=${'pj-timeline-item' + (selected === r.fingerprint ? ' is-active' : '')}>
                          <button class="pj-timeline-entry" onClick=${() => setSelected(r.fingerprint)}>
                            <span class="pj-timeline-date">${String(r.at).slice(0, 10) || '—'}${r.isCurrent ? ` · ${t('timeline.now') || 'now'}` : ''}</span>
                            <span class="pj-timeline-event">${r.event}</span>
                            ${tt ? html`<span class="pj-timeline-counts section-desc">${tt.workspaces} ws · ${tt.documents}d · ${tt.records}r · ${tt.members}👤</span>` : null}
                          </button>
                        </li>`;
                    })}
                  </ul>
                  <div class="pj-timeline-map">
                    ${selected
                      ? html`<${Mermaid} chart=${buildOrganismMindmap({ name: t('timeline.snapshot') || 'Snapshot', workspaces: selected.workspaces || [], members: [], agents: [] }, { chartType: readChartType(orgId), level: 'counts', showUsers: false, showActivity: true, heatmap: true })} />`
                      : html`<div class="section-desc">${t('timeline.pick') || 'Pick a point to see the structure then.'}</div>`}
                  </div>
                </div>`)}
        </div>` : null}
    </div>`;
}
