/**
 * @file realtime-tab-model.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The reading behind the admin Realtime page. Two things are asserted hardest, because
 *   the page that came before got both wrong: the document count is summed from the rooms it lives
 *   in (it used to read a response key nothing has ever sent, so it was zero everywhere), and the
 *   three kinds of empty are told apart (they all drew as the same three zeros).
 * @usage cd aimeat && pnpm exec vitest run test/unit/realtime-tab-model.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial (the Realtime page in the poster face).
 */
import { describe, it, expect } from 'vitest';
import { decorate, summarise, order, split } from '../../public/views/admin/realtime-tab.model.js';

const NOW = Date.parse('2026-09-12T12:00:00.000Z');
const AGO = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const IDLE = 60 * MIN;

const OVERVIEW = {
  enabled: true,
  uptime_seconds: 42_720,
  room_idle_timeout_ms: IDLE,
  ws_url: 'wss://aimeat.io/v1/realtime/ws',
  stats: {
    rooms: 2, peers: 3, messagesIn: 12_480, messagesOut: 31_002,
    messagesRejected: 0, roomsCreated: 4, roomsClosed: 2, peakConcurrentPeers: 5,
  },
  total: 3,
  rooms: [
    {
      id: 'r-brief', name: 'brief-q3-launch', app_type: 'workspace-doc', created_by: 'jouni',
      max_peers: 20, is_public: true, tags: ['q3'], peer_count: 2,
      peers: [
        { peer_id: 'p-9f13', nick: 'jouni', joined_at: AGO(184 * MIN) },
        { peer_id: 'p-2a77', nick: 'kanderss', joined_at: AGO(18 * MIN) },
      ],
      yjs_docs: [{ doc_id: 'doc-brief', snapshot_size: 14_336 }],
      created_at: AGO(184 * MIN), last_activity_at: AGO(4_000),
    },
    {
      id: 'r-standup', name: 'parvi-standup', app_type: 'chat', created_by: 'happydude500001',
      max_peers: 20, is_public: false, tags: [], peer_count: 1,
      peers: [{ peer_id: 'p-71bc', nick: 'zenmaisteri', joined_at: AGO(27 * MIN) }],
      yjs_docs: [],
      created_at: AGO(60 * MIN), last_activity_at: AGO(27 * MIN),
    },
    {
      // Nobody left in it: the reaper's clock is running, and it is the only row with a countdown.
      id: 'r-left', name: 'demo-board', app_type: 'board', created_by: 'jouni',
      max_peers: 20, is_public: true, tags: [], peer_count: 0,
      peers: [],
      yjs_docs: [{ doc_id: 'doc-a', snapshot_size: 1_024 }, { doc_id: 'doc-b', snapshot_size: 2_048 }],
      created_at: AGO(120 * MIN), last_activity_at: AGO(50 * MIN),
    },
  ],
};

describe('the rooms as rows', () => {
  const rows = decorate(OVERVIEW, NOW);
  const row = (id: string) => rows.find(r => r.id === id)!;

  it('reads the documents off the room, which is the only place they have ever been', () => {
    expect(row('r-brief')).toMatchObject({ docs: 1, docBytes: 14_336 });
    expect(row('r-left')).toMatchObject({ docs: 2, docBytes: 3_072 });
    expect(row('r-standup')).toMatchObject({ docs: 0, docBytes: 0 });
  });

  it('carries the peers with what each one called itself and how long it has been there', () => {
    expect(row('r-brief').peers.map(p => p.nick)).toEqual(['jouni', 'kanderss']);
    expect(row('r-brief').peers[1].joinedMs).toBe(18 * MIN);
    expect(row('r-brief').empty).toBe(false);
    expect(row('r-left').empty).toBe(true);
  });

  it('counts down only for a room nobody is left in', () => {
    // Last heard 50 minutes ago against a 60 minute idle timeout: ten minutes left.
    expect(row('r-left').closesInMs).toBe(10 * MIN);
    expect(row('r-brief').closesInMs).toBeNull();
    expect(row('r-standup').closesInMs).toBeNull();
  });

  it('says how long since a room was last heard, and how old it is', () => {
    expect(row('r-standup').heardMs).toBe(27 * MIN);
    expect(row('r-standup').ageMs).toBe(60 * MIN);
  });

  it('survives a room with nothing in it but an id', () => {
    const [bare] = decorate({ rooms: [{ id: 'r-bare' }] }, NOW);
    expect(bare).toMatchObject({
      id: 'r-bare', name: 'r-bare', peerCount: 0, docs: 0, docBytes: 0,
      heardMs: null, ageMs: null, closesInMs: null, tags: [], maxPeers: null,
    });
  });
});

describe('the figures the page prints', () => {
  const rows = decorate(OVERVIEW, NOW);
  const f = summarise(OVERVIEW, rows);

  it('sums the documents across the rooms rather than reading a key nothing sends', () => {
    expect(f.docs).toBe(3);
    expect(f.docBytes).toBe(17_408);
    // The old page took `yjs_documents` off the response. Nothing sends it, and it must not matter.
    expect(summarise({ ...OVERVIEW, yjs_documents: [{}, {}, {}, {}] }, rows).docs).toBe(3);
  });

  it('carries all eight counters, not the three that were shown', () => {
    expect(f).toMatchObject({
      rooms: 3, peers: 3, opened: 4, closed: 2,
      messagesIn: 12_480, messagesOut: 31_002, refused: 0, peak: 5,
    });
  });

  it('keeps the readings that turn a counter into a fact', () => {
    expect(f.uptimeSeconds).toBe(42_720);
    expect(f.idleMs).toBe(IDLE);
    expect(f.wsUrl).toBe('wss://aimeat.io/v1/realtime/ws');
  });
});

describe('which kind of empty this is', () => {
  const state = (rt: unknown) => summarise(rt as never, decorate(rt as never, NOW)).state;

  it('calls it live when somebody is actually connected', () => {
    expect(state(OVERVIEW)).toBe('live');
  });

  it('separates a quiet minute from a site nothing has ever reached', () => {
    const used = { ...OVERVIEW, rooms: [], stats: { ...OVERVIEW.stats, rooms: 0, peers: 0 } };
    expect(state(used)).toBe('quiet');

    const untouched = {
      enabled: true, uptime_seconds: 42_720, rooms: [],
      stats: { rooms: 0, peers: 0, messagesIn: 0, messagesOut: 0, messagesRejected: 0, roomsCreated: 0, roomsClosed: 0, peakConcurrentPeers: 0 },
    };
    expect(state(untouched)).toBe('never');
  });

  it('calls a room standing empty quiet, not live: nobody is in it', () => {
    const waiting = { ...OVERVIEW, rooms: [OVERVIEW.rooms[2]] };
    expect(state(waiting)).toBe('quiet');
  });

  it('reads the switch before it reads any counter', () => {
    expect(state({ enabled: false, stats: null, rooms: [], total: 0 })).toBe('off');
  });

  it('says the read failed rather than printing zeros it did not measure', () => {
    const f = summarise(null, []);
    expect(f.state).toBe('unreachable');
    expect(f).toMatchObject({ rooms: 0, peers: 0, opened: 0, uptimeSeconds: null, wsUrl: '' });
  });
});

describe('order and durations', () => {
  const rows = decorate(OVERVIEW, NOW);

  it('puts the room heard most recently first', () => {
    expect(order(rows).map(r => r.id)).toEqual(['r-brief', 'r-standup', 'r-left']);
  });

  it('puts the fullest room first when asked, and leaves the original alone', () => {
    expect(order(rows, true).map(r => r.id)).toEqual(['r-brief', 'r-standup', 'r-left']);
    const quiet = order([rows[2], rows[1]], true).map(r => r.id);
    expect(quiet).toEqual(['r-standup', 'r-left']);
    expect(rows.map(r => r.id)).toEqual(['r-brief', 'r-standup', 'r-left']);
  });

  it('picks the coarsest unit that still says something', () => {
    expect(split(4_000)).toEqual({ unit: 'Sec', n: 4 });
    expect(split(27 * MIN)).toEqual({ unit: 'Min', n: 27 });
    expect(split(11.9 * 3600_000)).toEqual({ unit: 'Hour', n: 12 });
    expect(split(3 * 86400_000)).toEqual({ unit: 'Day', n: 3 });
    expect(split(-500)).toEqual({ unit: 'Sec', n: 1 });
  });
});
