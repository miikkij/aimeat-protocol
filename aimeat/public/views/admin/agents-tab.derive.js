/**
 * @file public/views/admin/agents-tab.derive.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Agents page reads out of the agent list it already fetches: what made an
 *   agent, whether it is awake or has gone quiet, how to read its trust score, the five counts the
 *   filter chips carry, and who owns what. Pure functions over the rows of GET /v1/admin/agents,
 *   with the clock passed in, so the page needs no second read and these can be tested alone.
 *
 * @structure
 *   - kindOf / isAwake / isSilent / freshness: one agent's shape in time
 *   - trustKind: whether a score is the registration default, a real reading, or a low one
 *   - countAgents / matches / sortAgents / byOwner: what the list section runs on
 *
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial, with the Agents page in the poster face.
 */

import { num as fmtNum } from '/js/format.js';

/** One day in milliseconds. */
export const DAY_MS = 86400000;
/** Seen inside this many days counts as awake. */
export const AWAKE_DAYS = 1;
/** Not seen for this many days counts as gone quiet. */
export const SILENT_DAYS = 30;
/** The trust score every agent is registered with (src/routes/agents/registration.ts). */
export const REGISTERED_TRUST = 50;
/** services/trust.ts caps an agent that has not worked for three separate counterparties here. */
export const COUNTERPARTY_CAP = 40;

/**
 * What made this agent: an app publication, the chat, or a person connecting one.
 *
 * The node creates two kinds by itself — `app#<owner>` the first time an owner publishes an app,
 * `chat#<owner>` the first time one opens the chat — and an operator reading the list should not
 * have to know that to tell them apart from the agents somebody deliberately connected.
 * @param {string} gaii
 * @returns {'app'|'chat'|'connected'}
 */
export function kindOf(gaii) {
  const local = String(gaii || '').split('@')[0];
  const prefix = local.split('#')[0];
  if (prefix === 'app') return 'app';
  if (prefix === 'chat') return 'chat';
  return 'connected';
}

/** Days since an ISO stamp, or null when there is no stamp or it does not parse. */
export function daysSince(iso, now) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return (now - then) / DAY_MS;
}

/** Seen within the last day. */
export function isAwake(agent, now) {
  const d = daysSince(agent?.last_seen, now);
  return d !== null && d < AWAKE_DAYS;
}

/** Not seen for a month, or never seen at all. */
export function isSilent(agent, now) {
  const d = daysSince(agent?.last_seen, now);
  return d === null || d >= SILENT_DAYS;
}

/**
 * How to say when an agent was last seen: minutes and hours while it is fresh, days for the last
 * week, and a date after that. The view turns this into words.
 * @returns {{ kind: 'never'|'minutes'|'hours'|'days'|'date', n: number }}
 */
export function freshness(iso, now) {
  const d = daysSince(iso, now);
  if (d === null) return { kind: 'never', n: 0 };
  if (d < 0) return { kind: 'minutes', n: 1 };
  const minutes = d * 24 * 60;
  if (minutes < 60) return { kind: 'minutes', n: Math.max(1, Math.floor(minutes)) };
  if (d < 1) return { kind: 'hours', n: Math.floor(minutes / 60) };
  if (d < 7) return { kind: 'days', n: Math.floor(d) };
  return { kind: 'date', n: Math.floor(d) };
}

/**
 * How to read a trust score.
 *
 * `registered` is the 50.0 an agent is given at registration; the stored figure only moves when
 * somebody reads that agent's public profile, which recomputes it and writes it back. `low` is
 * under the 40 that services/trust.ts allows an agent with fewer than three counterparties, so it
 * is age and inactivity rather than misconduct. The page dims the first and colours the last.
 * @returns {'unknown'|'registered'|'low'|'plain'}
 */
export function trustKind(score) {
  if (typeof score !== 'number' || Number.isNaN(score)) return 'unknown';
  if (score === REGISTERED_TRUST) return 'registered';
  if (score < COUNTERPARTY_CAP) return 'low';
  return 'plain';
}

/**
 * A trust score written the way THIS READER writes a number: 40.0 or 40,0.
 *
 * `toFixed(1)` is blind to that, and the sentence under the table spells the same number out in
 * words, so the cell said 40.0 while the sentence said 40,0. It took the page's language as its
 * argument, which was the nearest available guess at the time; the reader's own format is a
 * setting of its own now, so the argument is gone and format.js answers.
 * @param {number} score
 */
export function trustText(score) {
  return fmtNum(Number(Number(score).toFixed(1)));
}

/**
 * The numbers section 01 prints and the chips filter by, in one pass over the list.
 *
 * `oldestSilent` and `lowest` are what turn a count into something an operator can act on: how far
 * back the quiet ones go, and how low the low ones are.
 */
export function countAgents(agents, now) {
  const list = Array.isArray(agents) ? agents : [];
  let awake = 0, silent = 0, nodeMade = 0, low = 0, app = 0, chat = 0;
  let lowest = null, oldestSilent = null;
  for (const a of list) {
    if (isAwake(a, now)) awake++;
    if (isSilent(a, now)) {
      silent++;
      const seen = a.last_seen ? new Date(a.last_seen).getTime() : NaN;
      if (!Number.isNaN(seen) && (oldestSilent === null || seen < oldestSilent)) oldestSilent = seen;
    }
    const kind = kindOf(a.gaii);
    if (kind === 'app') { app++; nodeMade++; }
    if (kind === 'chat') { chat++; nodeMade++; }
    if (trustKind(a.trust_score) === 'low') {
      low++;
      if (lowest === null || a.trust_score < lowest) lowest = a.trust_score;
    }
  }
  return {
    total: list.length, awake, silent, nodeMade, low, app, chat, lowest,
    oldestSilent: oldestSilent === null ? null : new Date(oldestSilent).toISOString(),
  };
}

/** Whether one agent belongs in a filter. */
export function inFilter(agent, filter, now) {
  if (filter === 'awake') return isAwake(agent, now);
  if (filter === 'silent') return isSilent(agent, now);
  if (filter === 'node') return kindOf(agent.gaii) !== 'connected';
  if (filter === 'low') return trustKind(agent.trust_score) === 'low';
  return true;
}

/** Whether one agent matches what was typed: its name, its address or its owner. */
export function matches(agent, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return [agent.display_name, agent.gaii, agent.owner]
    .some(v => String(v || '').toLowerCase().includes(q));
}

/**
 * Newest first, except among the silent, where the question is which has been left longest.
 * An agent with no stamp at all sorts to the end of either order.
 */
export function sortAgents(agents, oldestFirst) {
  const stamp = a => {
    const t = a?.last_seen ? new Date(a.last_seen).getTime() : NaN;
    return Number.isNaN(t) ? null : t;
  };
  return [...agents].sort((a, b) => {
    const ta = stamp(a), tb = stamp(b);
    if (ta === null && tb === null) return 0;
    if (ta === null) return 1;
    if (tb === null) return -1;
    return oldestFirst ? ta - tb : tb - ta;
  });
}

/**
 * The owners, biggest fleet first, with the tail folded into one row.
 *
 * One person holding half the node is the fact this section exists to show, and a list of thirty
 * five owners with one agent each says it worse than a row that counts them.
 * @param {number} keep how many owners get a row of their own
 */
export function byOwner(agents, now, keep = 6) {
  const list = Array.isArray(agents) ? agents : [];
  const map = new Map();
  for (const a of list) {
    const owner = a.owner || '';
    const row = map.get(owner) || { owner, count: 0, awake: 0 };
    row.count++;
    if (isAwake(a, now)) row.awake++;
    map.set(owner, row);
  }
  const rows = [...map.values()].sort((a, b) => b.count - a.count || a.owner.localeCompare(b.owner));
  const top = rows.slice(0, keep);
  const rest = rows.slice(keep);
  const biggest = rows[0]?.count || 0;
  return {
    owners: rows.length,
    top: top.map(r => ({ ...r, share: biggest ? Math.round((r.count / biggest) * 100) : 0 })),
    rest: rest.length
      ? {
        owners: rest.length,
        count: rest.reduce((n, r) => n + r.count, 0),
        awake: rest.reduce((n, r) => n + r.awake, 0),
        most: rest[0].count,
        share: biggest ? Math.round((rest.reduce((n, r) => n + r.count, 0) / biggest) * 100) : 0,
      }
      : null,
    biggest: rows[0] || null,
  };
}
