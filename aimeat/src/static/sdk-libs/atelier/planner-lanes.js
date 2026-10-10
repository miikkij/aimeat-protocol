/**
 * @file atelier/planner-lanes.js
 * @description Where a booking stands across its day when other bookings share its hours. The
 *   week schedule (planner.js) drew every booking at the full width of the day, so two that
 *   overlapped lay on top of each other and a person saw the last one drawn. This is the
 *   arithmetic that puts them beside each other, kept apart from the drawing so it can be
 *   checked without a page.
 *
 *   Bookings that overlap, directly or through another booking, form one GROUP. Inside a group
 *   each booking takes the first lane that is free at its start, and every booking of the group
 *   is drawn at the same share of the day: one divided by the group's lane count. A booking in
 *   no group keeps lane 0 of 1, which the drawing reads as "leave it exactly as it was".
 *   Two bookings where one ends at the minute the other starts do not overlap.
 * @structure scheduleLanes(events) → [{ lane, lanes }] in the order of `events`
 * @usage
 *   import { scheduleLanes } from './planner-lanes.js';
 *   scheduleLanes([{ fromMin: 1260, toMin: 1410 }, { fromMin: 1260, toMin: 1355 }]);
 *   // → [{ lane: 0, lanes: 2 }, { lane: 1, lanes: 2 }]
 * @version-history
 *   v1.0.0 — 2026-10-10 — Initial (atelier 0.66.1). Found in TV-opas: three programmes planned
 *     for 21:00 on one evening, and the week grid showed one.
 */

/**
 * Lane and lane count for each booking of ONE day.
 * @param {Array<{ fromMin: number, toMin: number }>} events bookings of one day, in any order
 * @returns {Array<{ lane: number, lanes: number }>} one answer per booking, in the order given
 */
export function scheduleLanes(events) {
  const out = events.map(() => ({ lane: 0, lanes: 1 }));
  // Earliest first; of two that start together the longer one first, so it takes the outer lane
  // and the short ones stack beside it.
  const order = events.map((_, i) => i)
    .sort((a, b) => events[a].fromMin - events[b].fromMin || events[b].toMin - events[a].toMin || a - b);

  let group = [];      // indexes of the group being built
  let laneEnds = [];   // the minute each lane of the group becomes free
  let groupEnd = -Infinity;
  const close = () => {
    for (const i of group) out[i].lanes = laneEnds.length;
    group = []; laneEnds = []; groupEnd = -Infinity;
  };

  for (const i of order) {
    const e = events[i];
    if (group.length && e.fromMin >= groupEnd) close();
    let lane = laneEnds.findIndex((end) => end <= e.fromMin);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(e.toMin); } else laneEnds[lane] = e.toMin;
    out[i].lane = lane;
    group.push(i);
    groupEnd = Math.max(groupEnd, e.toMin);
  }
  close();
  return out;
}
