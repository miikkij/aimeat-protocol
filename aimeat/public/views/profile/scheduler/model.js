/**
 * @file public/views/profile/scheduler/model.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the scheduler cover shows, derived once from the schedule records and the
 *   server's projected fire-times for the next seven days: what fires next (the agenda), the week's
 *   rhythm (one row per schedule, a mark on each day it fires), the continuous jobs the server
 *   summarised instead of enumerating, the rarer schedules that have no fire in the window, and the
 *   paused and failed ones. Pure functions over plain data; nothing here touches the network.
 * @structure buildModel · dayLabel · kindOf
 * @usage import { buildModel } from './model.js';
 * @version-history
 *   v1.0.0 — 2026-08-30 — Initial, for the scheduler in the poster face.
 */

const DAY = 864e5;
export const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const two = (n) => String(n).padStart(2, '0');
const hhmm = (d) => `${two(d.getHours())}:${two(d.getMinutes())}`;
export const nameOf = (s) => (s && (s.displayName || s.name)) || '';
export const byName = (a, b) => nameOf(a).localeCompare(nameOf(b));

/** The rows' kind, for the colour of a mark and the words in the "who runs it" column. */
export function kindOf(s) {
  return ({ ai: 'ai', agent_task: 'agent', extension: 'ext', 'eco-capability': 'eco', workflow: 'workflow', 'connections-publish': 'publish', secretary: 'secretary' })[s?.type] || 'core';
}

/**
 * @param {object} p
 * @param {object[]} p.managed   the owner's managed schedules
 * @param {object[]} p.extensions  extension cron jobs the owner installed but does not manage here
 * @param {{scheduleId:string, at:string}[]} p.occurrences  projected fire-times in [start, start+7d)
 * @param {{scheduleId:string, intervalMinutes:number, approxPerDay:number}[]} p.frequent
 * @param {Date} p.start  the window start (today at midnight)
 * @param {Date} p.now
 */
export function buildModel({ managed = [], extensions = [], occurrences = [], frequent = [], start, now }) {
  const all = [...managed.map(s => ({ ...s, readOnly: false })), ...extensions.map(s => ({ ...s, readOnly: true }))];
  const byId = new Map(all.map(s => [s.id, s]));
  const frequentIds = new Set(frequent.map(f => f.scheduleId));
  const nowMs = now.getTime();
  const startMs = start.getTime();

  const occ = occurrences
    .map(o => ({ s: byId.get(o.scheduleId), at: new Date(o.at) }))
    .filter(o => o.s && !frequentIds.has(o.s.id))
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  // The agenda: what fires next, in order.
  const agenda = occ.filter(o => o.at.getTime() >= nowMs);

  // The rhythm: one row per schedule with a fire in the window.
  const rows = new Map();
  for (const o of occ) {
    let r = rows.get(o.s.id);
    if (!r) { r = { s: o.s, times: new Set(), days: [0, 0, 0, 0, 0, 0, 0], firstMin: 1e9 }; rows.set(o.s.id, r); }
    r.times.add(hhmm(o.at));
    const di = Math.floor((startOfDay(o.at).getTime() - startMs) / DAY);
    if (di >= 0 && di < 7) r.days[di] = 1;
    r.firstMin = Math.min(r.firstMin, o.at.getHours() * 60 + o.at.getMinutes());
  }
  const rhythm = [...rows.values()].map(r => ({ ...r, times: [...r.times].sort() })).sort((a, b) => a.firstMin - b.firstMin || byName(a.s, b.s));

  const continuous = frequent
    .map(f => ({ ...f, s: byId.get(f.scheduleId) }))
    .filter(f => f.s)
    .sort((a, b) => b.approxPerDay - a.approxPerDay);

  // Rarer than weekly: enabled, on a real cron, no fire in the window, not continuous.
  const rare = all
    .filter(s => s.enabled !== false && s.cron && s.cron !== '@activate' && !rows.has(s.id) && !frequentIds.has(s.id) && s.nextRunAt)
    .sort((a, b) => new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime());

  const paused = all.filter(s => s.enabled === false).sort(byName);
  const failed = all.filter(s => s.lastRunResult === 'error').sort(byName);
  const agentMade = all.filter(s => s.createdByAgent).length;

  // The strip: the next fire, what is still to come today, the latest run, the failed count.
  const next = agenda[0] ? { s: agenda[0].s, at: agenda[0].at } : (rare[0] ? { s: rare[0], at: new Date(rare[0].nextRunAt) } : null);
  const todayEnd = startMs + DAY;
  const todayLeft = agenda.filter(o => o.at.getTime() < todayEnd).length;
  const latest = all.filter(s => s.lastRunAt).sort((a, b) => new Date(b.lastRunAt).getTime() - new Date(a.lastRunAt).getTime())[0] || null;

  // The seven day columns of the rhythm table, starting today.
  const days = Array.from({ length: 7 }, (_, i) => new Date(startMs + i * DAY));

  return { all, byId, agenda, rhythm, continuous, rare, paused, failed, agentMade, next, todayLeft, latest, days, occ };
}

/** "ma 31.8." in the reader's language. */
export function dayLabel(d, locale) {
  return d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'numeric' });
}
