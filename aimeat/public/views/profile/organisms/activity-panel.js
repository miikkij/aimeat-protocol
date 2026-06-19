/**
 * @file activity-panel.js
 * @description Workspace activity panel — a GitHub-style contribution heatmap (every day split 2×2
 *   into documents vs records × draft vs published) plus the recent activity log. Built from the
 *   workspace activity feed (derived from version history). Extracted from organisms-tab.js, no
 *   behaviour change.
 * @structure buildHeatmap, hmCell (internal helpers), ActivityPanel
 * @usage import { ActivityPanel } from '/views/profile/organisms/activity-panel.js';
 * @version-history
 *   v1.0.0 — 2026-06-19 — Extracted from organisms-tab.js during the module split.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { dt } from '/js/format.js';
import * as orgService from '/js/services/organisms.js';

/* Build a GitHub-style contribution calendar from activity events. Each day holds FOUR counters —
 * documents draft/published and records (schema'd) draft/published — so a cell can be drawn as a 2×2
 * quadrant. Returns { cols, monthLabels }: each col is 7 day-slots (Sun→Sat); a future slot is null.
 * Deterministic from the event timestamps. */
function buildHeatmap(byDay, today) {
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const weeks = 53;                                         // always a full year ending today, GitHub-style
  const start = new Date(today);
  start.setDate(start.getDate() - (weeks * 7 - 1));
  start.setDate(start.getDate() - start.getDay());          // align to the start of a week (Sunday)
  const cols = []; const monthLabels = [];
  let cur = new Date(start); let prevMonth = -1;
  while (cur <= today) {
    monthLabels.push(cur.getMonth() !== prevMonth ? cur.toLocaleString(undefined, { month: 'short' }) : '');
    prevMonth = cur.getMonth();
    const col = [];
    for (let dow = 0; dow < 7; dow++) {
      if (cur > today) { col.push(null); }
      else { col.push({ date: iso(cur), b: byDay.get(iso(cur)) || null }); }
      cur = new Date(cur); cur.setDate(cur.getDate() + 1);
    }
    cols.push(col);
  }
  return { cols, monthLabels };
}
const hmLevel = (n) => (n === 0 ? 0 : n <= 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4);
const ZERO_DAY = { dd: 0, dp: 0, rd: 0, rp: 0, total: 0 };

/* One heatmap day = a 2×2 grid: ↖ docs draft, ↗ docs published, ↙ records draft, ↘ records published.
 * Each quadrant's shade is its own count's intensity. */
function hmCell(date, b, key) {
  const c = b || ZERO_DAY;
  const tip = b
    ? `${date} — docs: ${c.dd} draft / ${c.dp} published · records: ${c.rd} draft / ${c.rp} published`
    : `${date} — no activity`;
  return html`<span class="pj-hm-cell" key=${key} title=${tip}>
    <i class="q lvl${hmLevel(c.dd)}"></i><i class="q lvl${hmLevel(c.dp)}"></i>
    <i class="q lvl${hmLevel(c.rd)}"></i><i class="q lvl${hmLevel(c.rp)}"></i>
  </span>`;
}

/* Activity panel — a GitHub-style contribution heatmap of the workspace's history, where every day is
 * split 2×2 into documents vs records × draft vs published (quadrant shade = intensity) — plus the
 * recent activity log (who did what, where, when), which doubles as an audit trail. Built from
 * GET …/workspace/activity (derived from version history). */
export function ActivityPanel({ orgId, wsId }) {
  const [data, setData] = useState(null);
  const [show, setShow] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const fetchIt = () => orgService.getWorkspaceActivity(orgId, wsId).then(d => { if (!cancelled) setData(d); }).catch(() => {});
    fetchIt();
    window.addEventListener('aimeat-live-update', fetchIt);
    return () => { cancelled = true; window.removeEventListener('aimeat-live-update', fetchIt); };
  }, [orgId, wsId]);
  if (!data || !(data.events || []).length) return null;
  const events = data.events;
  const byDay = new Map();
  for (const e of events) {
    const day = (e.at || '').slice(0, 10); if (!day) continue;
    const b = byDay.get(day) || { dd: 0, dp: 0, rd: 0, rp: 0, total: 0 };
    const doc = e.mode === 'document';
    if (e.action === 'draft') { if (doc) b.dd++; else b.rd++; } else if (doc) b.dp++; else b.rp++;
    b.total++; byDay.set(day, b);
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const { cols, monthLabels } = buildHeatmap(byDay, today);

  return html`
    <div class="pj-chart">
      <div class="pj-chart-head">
        <span class="pj-chart-title">${'📊 '}${t('organisms.activity') || 'Activity'}<span class="pj-act-count">${data.total} ${t('organisms.events') || 'events'}</span></span>
        <button class="btn-ghost btn-sm" onClick=${() => setShow(s => !s)}>${show ? (t('organisms.hide') || 'Hide') : (t('organisms.show') || 'Show')}</button>
      </div>
      ${show ? html`
        <div class="pj-act">
          <div class="pj-hm">
            <div class="pj-hm-monthrow">${monthLabels.map((m, i) => html`<span class="pj-hm-month" key=${i}>${m}</span>`)}</div>
            <div class="pj-hm-body">
              <div class="pj-hm-daycol"><span></span><span>${t('organisms.mon') || 'Mon'}</span><span></span><span>${t('organisms.wed') || 'Wed'}</span><span></span><span>${t('organisms.fri') || 'Fri'}</span><span></span></div>
              <div class="pj-hm-cols">
                ${cols.map((col, ci) => html`<div class="pj-hm-col" key=${ci}>
                  ${col.map((cell, ri) => cell === null
                    ? html`<span class="pj-hm-cell future" key=${ri}></span>`
                    : hmCell(cell.date, cell.b, ri))}
                </div>`)}
              </div>
            </div>
          </div>
          <div class="pj-hm-legend">
            <div class="pj-hm-quadkey">
              <span class="pj-hm-cell"><i class="q lvl1"></i><i class="q lvl3"></i><i class="q lvl2"></i><i class="q lvl4"></i></span>
              <div class="pj-hm-quadlabels">
                <span>${'↖ '}${t('organisms.docsDraft') || 'Docs draft'}</span><span>${'↗ '}${t('organisms.docsPublished') || 'Docs published'}</span>
                <span>${'↙ '}${t('organisms.recordsDraft') || 'Records draft'}</span><span>${'↘ '}${t('organisms.recordsPublished') || 'Records published'}</span>
              </div>
            </div>
            <div class="pj-hm-intensity">
              <span>${t('organisms.less') || 'Less'}</span>
              <i class="q lvl0"></i><i class="q lvl1"></i><i class="q lvl2"></i><i class="q lvl3"></i><i class="q lvl4"></i>
              <span>${t('organisms.more') || 'More'}</span>
            </div>
          </div>
          <div class="pj-act-list">
            ${events.slice(0, 20).map((e, i) => html`<div class="pj-act-item" key=${i}>
              <span class="pj-act-dot ${e.action}"></span>
              <span class="pj-act-time">${dt(e.at)}</span>
              <span class="pj-act-who">${(e.actor)}</span>
              ${e.agent ? html`<span class="pj-act-agent" title=${t('organisms.viaAgent') || 'via this agent'}>${'🤖 '}${(e.agent)}</span>` : null}
              <span class="pj-act-act">${e.action === 'publish' ? (t('organisms.publishedVerb') || 'published') : (t('organisms.editedVerb') || 'edited')}</span>
              <span class="pj-act-what">${(e.mode === 'document' ? '📄' : '🗂')} ${(e.type)}${' / '}${(e.instance)}</span>
            </div>`)}
          </div>
        </div>` : null}
    </div>`;
}
