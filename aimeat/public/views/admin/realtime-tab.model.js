/**
 * @file realtime-tab.model.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Realtime page's reading of what the overview route sends: the rooms as rows an
 *   operator can act on, and the one word that says which kind of empty this is.
 *
 *   THREE ZEROS WERE FIVE DIFFERENT ANSWERS. The page printed rooms, peers and a document count and
 *   nothing else, so a site with realtime switched off, a site nothing had ever connected to, and a
 *   site that is simply quiet this minute all drew identically. state() separates them, because the
 *   three call for three different reactions and only one of them is a fault.
 *
 *   THE DOCUMENT COUNT READ A KEY THAT HAS NEVER EXISTED. It took `yjs_documents` off the response;
 *   documents are per room, in `rooms[].yjs_docs`, so the figure was zero on every site in every
 *   state. It is summed from the rooms here.
 *
 * @structure
 *   - decorate(rt, now): the rooms as rows (peers, documents, how long since it was last heard,
 *     how long an empty one has before the reaper closes it)
 *   - summarise(rt, rows): the state word and every figure the page prints
 *   - split(ms): a duration as the coarsest unit that still says something
 *   - order(rows, busiestFirst): most recently heard first, or most people first
 * @usage imported by realtime-tab.js and realtime-tab.detail.js
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial (the Realtime page in the poster face).
 */

/**
 * How many people are in a room, preferring the count the route sends over the length of the list.
 * They agree today; a route that ever trims the peer list would make the count the true one.
 */
function heads(r) {
  return typeof r.peer_count === 'number' ? r.peer_count : (r.peers || []).length;
}

/** Milliseconds since an ISO stamp, or null when there is no usable stamp. */
function since(iso, now) {
  const at = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(at) ? now - at : null;
}

/**
 * The rooms as rows. Everything a row shows is already in the response: nothing here fetches.
 * @param {object|null} rt the data of GET /v1/admin/realtime
 * @param {number} now
 */
export function decorate(rt, now = Date.now()) {
  const idleMs = typeof rt?.room_idle_timeout_ms === 'number' ? rt.room_idle_timeout_ms : null;
  return (rt?.rooms || []).map(r => {
    const docs = (r.yjs_docs || []).map(d => ({ id: d.doc_id || '', bytes: d.snapshot_size || 0 }));
    const peers = (r.peers || []).map(p => ({
      peerId: p.peer_id || '',
      nick: p.nick || '',
      joinedMs: since(p.joined_at, now),
    }));
    const heardAt = r.last_activity_at ? Date.parse(r.last_activity_at) : NaN;
    const count = heads(r);
    return {
      id: r.id || '',
      name: r.name || r.id || '',
      appType: r.app_type || '',
      createdBy: r.created_by || '',
      isPublic: !!r.is_public,
      tags: r.tags || [],
      maxPeers: typeof r.max_peers === 'number' ? r.max_peers : null,
      peers,
      peerCount: count,
      empty: count === 0,
      docs: docs.length,
      docBytes: docs.reduce((n, d) => n + d.bytes, 0),
      docList: docs,
      heardMs: since(r.last_activity_at, now),
      ageMs: since(r.created_at, now),
      createdAt: r.created_at || null,
      // A room nobody is left in is on the reaper's clock. Only then is there anything to count
      // down: a room with people in it is not going anywhere.
      closesInMs: count === 0 && idleMs && Number.isFinite(heardAt)
        ? Math.max(0, heardAt + idleMs - now)
        : null,
    };
  });
}

/**
 * The state word and the figures. `rt` is null when the read itself failed, which is a fifth thing
 * and not one of the three empties: the page says so rather than printing zeros it did not measure.
 */
export function summarise(rt, rows = []) {
  const blank = {
    rooms: 0, peers: 0, docs: 0, docBytes: 0,
    opened: 0, closed: 0, messagesIn: 0, messagesOut: 0, refused: 0, peak: 0,
    uptimeSeconds: null, idleMs: null, wsUrl: '',
  };
  if (!rt) return { state: 'unreachable', ...blank };

  const s = rt.stats || {};
  const n = (v) => (typeof v === 'number' ? v : 0);
  const figures = {
    rooms: rows.length,
    peers: rows.reduce((a, r) => a + r.peerCount, 0),
    docs: rows.reduce((a, r) => a + r.docs, 0),
    docBytes: rows.reduce((a, r) => a + r.docBytes, 0),
    opened: n(s.roomsCreated),
    closed: n(s.roomsClosed),
    messagesIn: n(s.messagesIn),
    messagesOut: n(s.messagesOut),
    refused: n(s.messagesRejected),
    peak: n(s.peakConcurrentPeers),
    uptimeSeconds: typeof rt.uptime_seconds === 'number' ? rt.uptime_seconds : null,
    idleMs: typeof rt.room_idle_timeout_ms === 'number' ? rt.room_idle_timeout_ms : null,
    wsUrl: rt.ws_url || '',
  };

  // Switched off is a setting and comes first: with the feature off there is nothing to measure.
  // "Never" is the whole uptime being empty, which is the state aimeat.io is in most days and the
  // one an operator wants to be able to check. Anything else with nobody connected is ordinary.
  const state = rt.enabled === false ? 'off'
    : figures.peers > 0 ? 'live'
      : (figures.opened === 0 && figures.messagesIn === 0 && figures.rooms === 0) ? 'never'
        : 'quiet';

  return { state, ...figures };
}

/**
 * A duration as the coarsest unit that still says something: 4 s, 35 min, 20 h, 2 d.
 *
 * It returns the unit rather than a sentence because the sentence is a locale key ("4 s sitten" is
 * not how Finnish says it), and because a pure function is the half worth testing.
 * @returns {{ unit: 'Sec'|'Min'|'Hour'|'Day', n: number }}
 */
export function split(ms) {
  const sec = Math.max(0, Math.round(Math.abs(ms) / 1000));
  if (sec >= 86400) return { unit: 'Day', n: Math.round(sec / 86400) };
  if (sec >= 3600) return { unit: 'Hour', n: Math.round(sec / 3600) };
  if (sec >= 60) return { unit: 'Min', n: Math.round(sec / 60) };
  return { unit: 'Sec', n: sec };
}

/**
 * Row order. Newest news first by default — the room that spoke most recently is the one an
 * operator is usually looking for; busiest first answers the other question.
 */
export function order(rows, busiestFirst = false) {
  const list = [...rows];
  if (busiestFirst) {
    return list.sort((a, b) => b.peerCount - a.peerCount || (a.heardMs ?? Infinity) - (b.heardMs ?? Infinity));
  }
  return list.sort((a, b) => (a.heardMs ?? Infinity) - (b.heardMs ?? Infinity));
}
