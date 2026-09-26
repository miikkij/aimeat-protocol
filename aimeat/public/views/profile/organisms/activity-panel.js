/**
 * @file activity-panel.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Workspace activity panel — a GitHub-style contribution heatmap (every day split 2×2
 *   into documents vs records × draft vs published) plus the recent activity log. Built from the
 *   workspace activity feed (derived from version history). Extracted from organisms-tab.js, no
 *   behaviour change.
 * @structure buildHeatmap, hmCell (internal helpers), ActivityPanel
 * @usage import { ActivityPanel } from '/views/profile/organisms/activity-panel.js';
 * @version-history
 *   v1.7.0 — 2026-09-26 — Every part is a kit component (page group G2a): the panel is the Box with its name, the count and the Hide/Show action in its head; the heatmap is the ActivityCalendar (components/ActivityCalendar.js, its own sheet), fed each day's tooltip and four levels as data; the agent beside a line is the Mark. The page writes no class.
 *   v1.6.0 — 2026-09-26 — The recent activity log is the home's Timeline (components/Timeline.js): the time, a dot (made for a publish, the system's grey for an edit), one line with who, the agent's Tag, what they did and to what; the square dots and the small row go (a unification: Jouni's decision "Activity log").
 *   v1.5.0 — 2026-09-26 — A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.4.0 — 2026-09-26 — A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.3.0 — 2026-09-25 — The agent beside an activity line is the Tag (.poster-chip), a unification: Jouni's decision "Tag".
 *   v1.2.0 — 2026-09-25 — Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v1.1.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.0.0 — 2026-06-19 — Extracted from organisms-tab.js during the module split.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { dt } from '/js/format.js';
import * as orgService from '/js/services/organisms.js';
import { swallowed } from '/js/swallowed.js';
import { calendar } from '/js/format.js';
import { TimelineList, TimelineRow } from '/components/Timeline.js';
import { ActivityCalendar } from '/components/ActivityCalendar.js';
import { Box } from '/components/Box.js';
import { Action } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';

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
    monthLabels.push(cur.getMonth() !== prevMonth ? calendar(cur, { month: 'short' }) : '');
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
 * Each quadrant's shade is its own count's intensity. Returns the day as the calendar's data. */
function hmCell(date, b) {
  const c = b || ZERO_DAY;
  const tip = b
    ? `${date} — docs: ${c.dd} draft / ${c.dp} published · records: ${c.rd} draft / ${c.rp} published`
    : `${date} — no activity`;
  return { title: tip, levels: [hmLevel(c.dd), hmLevel(c.dp), hmLevel(c.rd), hmLevel(c.rp)] };
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
    const fetchIt = () => orgService.getWorkspaceActivity(orgId, wsId).then(d => { if (!cancelled) setData(d); }).catch(err => { swallowed('activity-panel: fetchIt', err); });
    fetchIt();
    const off = onLiveUpdate(['organisms'], fetchIt);
    return () => { cancelled = true; off(); };
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
    <${Box} name=${html`${'📊 '}${t('organisms.activity') || 'Activity'}`}
      marks=${html`<${Note} kind="meta" inline>${data.total} ${t('organisms.events') || 'events'}<//>`}
      end=${html`<${Action} small onClick=${() => setShow(s => !s)}>${show ? (t('organisms.hide') || 'Hide') : (t('organisms.show') || 'Show')}<//>`}>
      ${show ? html`
        <${ActivityCalendar}
          weeks=${cols.map((col) => col.map((cell) => (cell === null ? null : hmCell(cell.date, cell.b))))}
          months=${monthLabels}
          days=${['', t('organisms.mon') || 'Mon', '', t('organisms.wed') || 'Wed', '', t('organisms.fri') || 'Fri', '']}
          quarters=${[
            `${'↖ '}${t('organisms.docsDraft') || 'Docs draft'}`, `${'↗ '}${t('organisms.docsPublished') || 'Docs published'}`,
            `${'↙ '}${t('organisms.recordsDraft') || 'Records draft'}`, `${'↘ '}${t('organisms.recordsPublished') || 'Records published'}`,
          ]}
          less=${t('organisms.less') || 'Less'} more=${t('organisms.more') || 'More'} />
        <${TimelineList}>
          ${events.slice(0, 20).map((e, i) => html`<${TimelineRow} key=${i} category=${e.action === 'publish' ? 'made' : 'system'} when=${dt(e.at)}
            text=${html`${(e.actor)}${e.agent ? html` <${Mark} title=${t('organisms.viaAgent') || 'via this agent'}>${'🤖 '}${(e.agent)}<//>` : null} ${e.action === 'publish' ? (t('organisms.publishedVerb') || 'published') : (t('organisms.editedVerb') || 'edited')} ${(e.mode === 'document' ? '📄' : '🗂')} ${(e.type)}${' / '}${(e.instance)}`} />`)}
        <//>` : null}
    <//>`;
}
