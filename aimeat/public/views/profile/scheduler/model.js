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

import { date as fmtDate, dayKey, minutesOfDay } from '/js/format.js';

const DAY = 864e5;
export const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
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

  // The seven day columns of the rhythm table, starting today. Their identity is the calendar day
  // IN THE READER'S ZONE, because that is the day the times drawn beside them belong to.
  const days = Array.from({ length: 7 }, (_, i) => new Date(startMs + i * DAY));
  const columnKey = days.map(d => dayKey(d));

  // The rhythm: one row per schedule with a fire in the window.
  //
  // Every bucket here is the READER'S, not the browser's. It used to be `getHours()` and a local
  // midnight, which put a Tokyo reader's Tuesday-05:00 run in Monday's column at 23:00 — on the
  // same screen as a next-run card that said Tuesday 05:00, because that card had been fixed and
  // this had not. Minutes are kept as a NUMBER: a 12-hour label does not sort, and "11:00 PM"
  // would land before "5:00 AM".
  const rows = new Map();
  for (const o of occ) {
    let r = rows.get(o.s.id);
    if (!r) { r = { s: o.s, times: new Set(), days: [0, 0, 0, 0, 0, 0, 0], firstMin: 1e9, at: o.at }; rows.set(o.s.id, r); }
    const mins = minutesOfDay(o.at);
    if (mins >= 0) { r.times.add(mins); r.firstMin = Math.min(r.firstMin, mins); }
    const di = columnKey.indexOf(dayKey(o.at));
    if (di >= 0) r.days[di] = 1;
  }
  const rhythm = [...rows.values()]
    .map(r => ({ ...r, times: [...r.times].sort((x, y) => x - y) }))
    .sort((a, b) => a.firstMin - b.firstMin || byName(a.s, b.s));

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

  return { all, byId, agenda, rhythm, continuous, rare, paused, failed, agentMade, next, todayLeft, latest, days, occ };
}

/** "ma 31.8." in the reader's own format, on the reader's own clock. */
export function dayLabel(d) {
  return fmtDate(d, { weekday: 'short', day: 'numeric', month: 'numeric' });
}
