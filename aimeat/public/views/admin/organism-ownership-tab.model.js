/**
 * @file organism-ownership-tab.model.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The arithmetic behind the admin Organism ownership page: which organisms nobody
 *   inside can repair, the figures under the first section, the filters, and who may be offered as
 *   a new owner. No DOM, no i18n, no fetch, so the unit suite can hold every number on the screen.
 *
 *   STUCK IS COMPUTED, NOT STORED. An organism is stuck when NONE of its owners can act: each one is
 *   either deactivated on this node or has no account here at all. Crossing the organism list against
 *   the owner list the dashboard already fetched is the whole of it, and it is the only way an
 *   operator learns an organism needs the repair door without somebody writing in to say so.
 *
 *   AN ORGANISM WITH NO OWNERS AT ALL IS STUCK TOO. The node's own service keeps the list non-empty,
 *   so this should not occur; it is read as stuck rather than as healthy because "nobody holds it" is
 *   the state the repair exists for, and a fold that answered "fine" to an empty list would hide
 *   exactly the case nobody can fix from the inside.
 * @structure OWNER_STATES · decorate · summarise · counts · search · candidates · FILTERS · PAGE
 * @usage imported by organism-ownership-tab.js; tested by test/unit/organism-ownership-model.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial (the Organism ownership page in the poster face).
 */

/** The filter chips, in the order the page draws them. */
export const FILTERS = ['all', 'stuck', 'single', 'archived'];

/** How many rows the list shows before "Show the rest". */
export const PAGE = 20;

/** What an owner name resolves to on this node. Only `ok` can act. */
export const OWNER_STATES = ['ok', 'off', 'gone'];

/**
 * One row per organism, with the state of each owner and whether anybody can still act.
 *
 * @param {Array<object>|undefined} organisms as GET /v1/admin/organisms serves them
 * @param {Array<object>|undefined} owners as GET /v1/admin/owners serves them
 * @returns {Array<object>} rows, the stuck ones first, then newest registration first
 */
export function decorate(organisms, owners) {
  const list = Array.isArray(organisms) ? organisms : [];
  const byName = new Map((Array.isArray(owners) ? owners : []).map(o => [o.name, o]));

  return list
    .map((org) => {
      const names = Array.isArray(org.owners) ? org.owners : [];
      const ownerStates = names.map((name) => {
        const owner = byName.get(name);
        if (!owner) return { name, state: 'gone' };
        return { name, state: owner.disabled_at ? 'off' : 'ok' };
      });
      const reachable = ownerStates.filter(o => o.state === 'ok').length;
      return {
        id: org.id,
        name: org.name,
        type: org.type || '',
        visibility: org.visibility || '',
        ownerStates,
        reachable,
        stuck: reachable === 0,
        members: typeof org.members === 'number' ? org.members : 0,
        createdBy: org.created_by || null,
        createdAt: org.created_at || null,
        archivedAt: org.archived_at || null,
      };
    })
    .sort((a, b) => {
      if (a.stuck !== b.stuck) return a.stuck ? -1 : 1;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
}

/** The four figures under the first section. */
export function summarise(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    total: list.length,
    stuck: list.filter(r => r.stuck).length,
    // Every owner seat on the node, counting a person once per organism they hold.
    seats: list.reduce((n, r) => n + r.ownerStates.length, 0),
    // One owner and that owner can act: the organisms one deactivation away from being stuck. The
    // already-stuck ones are counted by `stuck` and would make this figure disagree with its label.
    single: list.filter(r => r.ownerStates.length === 1 && !r.stuck).length,
    archived: list.filter(r => r.archivedAt).length,
    stuckRows: list.filter(r => r.stuck),
  };
}

/** The number behind each filter chip. */
export function counts(rows) {
  const s = summarise(rows);
  return { all: s.total, stuck: s.stuck, single: s.single, archived: s.archived };
}

/**
 * The rows one filter and one search term leave. The term matches the organism's name, its id, and
 * the name of anybody holding it, because an operator arriving here has one of those three.
 */
export function search(rows, filter, query) {
  const list = Array.isArray(rows) ? rows : [];
  const q = String(query || '').trim().toLowerCase();
  const byFilter = list.filter((r) => {
    if (filter === 'stuck') return r.stuck;
    if (filter === 'single') return r.ownerStates.length === 1 && !r.stuck;
    if (filter === 'archived') return !!r.archivedAt;
    return true;
  });
  if (!q) return byFilter;
  return byFilter.filter(r =>
    r.name.toLowerCase().includes(q)
    || r.id.toLowerCase().includes(q)
    || r.ownerStates.some(o => o.name.toLowerCase().includes(q)));
}

/**
 * Who may be offered as the organism's new owner, and why the others may not.
 *
 * The node refuses three of these after the press (already an owner, blocked in the organism, no
 * account by that name); a fourth is refused by arithmetic rather than by the route: handing a stuck
 * organism to a deactivated account repairs nothing. Each carries its reason so the page can draw it
 * quiet instead of letting somebody press and be told.
 *
 * @param {Array<object>|undefined} owners the node's owners, as the dashboard fetched them
 * @param {object|null} ownership the organism's ownership read: { owners, members }
 * @returns {Array<{name: string, state: 'ok'|'already'|'blocked'|'off', member: boolean}>}
 */
export function candidates(owners, ownership) {
  const list = Array.isArray(owners) ? owners : [];
  const holding = new Set(Array.isArray(ownership?.owners) ? ownership.owners : []);
  const membership = new Map((Array.isArray(ownership?.members) ? ownership.members : [])
    .map(m => [m.ghii, m]));

  return list.map((o) => {
    const m = membership.get(o.name);
    /** @type {'ok'|'already'|'blocked'|'off'} */
    const state = holding.has(o.name) ? 'already'
      : m?.status === 'banned' ? 'blocked'
        : o.disabled_at ? 'off'
          : 'ok';
    return { name: String(o.name), state, member: !!m && m.status === 'active' };
  }).sort((a, b) => {
    // The ones that can take it first. Inside that group, the people already in the organism lead:
    // making an admin an owner is a smaller change than seating a stranger. The refused ones are
    // read for their reason rather than chosen from, so they sort by name and nothing else.
    if ((a.state === 'ok') !== (b.state === 'ok')) return a.state === 'ok' ? -1 : 1;
    if (a.state === 'ok' && a.member !== b.member) return a.member ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
