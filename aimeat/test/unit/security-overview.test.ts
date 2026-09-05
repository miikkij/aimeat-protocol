/**
 * @file test/unit/security-overview.test.ts
 * @description The Security page's numbers have to explain themselves, and the zones behind them
 *   have to come from the instance's own history rather than a constant. These assert the pure half
 *   of services/security-overview.ts: the 24-hour window, the groupings, the readable span and its
 *   mean, and the zone and status rules.
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial.
 */
import { describe, it, expect } from 'vitest';
import {
  summariseRefusals, refusalZone, sourcesZone, counterZone, statusOf, TAIL_LINES,
} from '../../src/services/security-overview.js';
import type { AuthFailureLine } from '../../src/services/auth-audit.js';

const NOW = new Date('2026-09-05T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const line = (over: Partial<AuthFailureLine> = {}): AuthFailureLine => ({
  ts: hoursAgo(1), status: 401, code: 'AUTH_REQUIRED', reason: 'Authentication required',
  method: 'GET', path: '/v1/memory', ip: '203.0.113.1', host: 'h', ua: 'ua', credential: 'none', credential_digest: '',
  ...over,
});

describe('summariseRefusals', () => {
  it('counts the last 24 hours, groups by door, source and credential, and keeps the tail newest first', () => {
    const lines = [
      line({ ts: hoursAgo(2), path: '/v1/admin/dashboard', ip: '203.0.113.9', credential: 'bearer-jwt', credential_digest: 'aaaaaaaaaaaa', status: 403, code: 'ACCESS_DENIED' }),
      line({ ts: hoursAgo(1) }),
      line({ ts: hoursAgo(30), path: '/v1/old' }),          // outside the window, still readable
      line({ ts: hoursAgo(3), method: 'POST', path: '/v1/ghii/login', ip: '203.0.113.9', code: 'CREDENTIAL_REFUSED' }),
      line({ ts: hoursAgo(4) }),                             // the memory door a second time
    ];
    const s = summariseRefusals(lines, NOW);
    expect(s.window_hours).toBe(24);
    expect(s.in_window).toBe(4);
    expect(s.readable_lines).toBe(5);
    expect(s.sources_in_window).toBe(2);
    // The busiest door first; equal counts fall back to the name, so the order is stable.
    expect(s.by_door[0]).toEqual({ key: 'GET /v1/memory', count: 2 });
    expect(s.by_door.map(d => d.key)).toContain('POST /v1/ghii/login');
    expect(s.by_door.map(d => d.key)).not.toContain('GET /v1/old');
    expect(s.by_source).toEqual([{ key: '203.0.113.1', count: 2 }, { key: '203.0.113.9', count: 2 }]);
    expect(s.by_credential.find(c => c.key === 'none')?.count).toBe(3);
    expect(s.by_digest).toEqual([{ key: 'aaaaaaaaaaaa', count: 1, kind: 'bearer-jwt', refused_401: 0, refused_403: 1 }]);
    expect(s.tail.map(l => l.ts)).toEqual([hoursAgo(1), hoursAgo(2), hoursAgo(3), hoursAgo(4), hoursAgo(30)]);
    expect(s.readable_from).toBe(hoursAgo(30));
  });

  it('has no mean while the readable span is under a day, and a mean per day over it', () => {
    const short = summariseRefusals([line({ ts: hoursAgo(5) }), line({ ts: hoursAgo(1) })], NOW);
    expect(short.readable_hours).toBe(4);
    expect(short.mean_per_day).toBeNull();

    const long = summariseRefusals([
      line({ ts: hoursAgo(48) }), line({ ts: hoursAgo(30) }), line({ ts: hoursAgo(12) }), line({ ts: hoursAgo(0) }),
    ], NOW);
    expect(long.readable_hours).toBe(48);
    expect(long.mean_per_day).toBe(2);
  });

  it('counts the lines the tarpit wrote when it walled an address, and which addresses', () => {
    const s = summariseRefusals([
      line({ code: 'ATTEMPTS_REFUSED', ip: '198.51.100.7', method: 'POST', path: '/v1/ghii/login' }),
      line({ code: 'ATTEMPTS_REFUSED', ip: '198.51.100.7', method: 'POST', path: '/v1/ghii/login' }),
      line({ code: 'CREDENTIAL_REFUSED', ip: '198.51.100.7', method: 'POST', path: '/v1/ghii/login' }),
      line({ code: 'ATTEMPTS_REFUSED', ip: '198.51.100.7', ts: hoursAgo(40) }),  // yesterday's campaign does not count
    ], NOW);
    expect(s.walled_in_window).toBe(2);
    expect(s.walled_sources).toEqual(['198.51.100.7']);
  });

  it('keeps at most the newest TAIL_LINES lines and ignores an unparsable timestamp in the window', () => {
    const many = Array.from({ length: TAIL_LINES + 50 }, (_, i) => line({ ts: hoursAgo(i / 100) }));
    many.push(line({ ts: 'not-a-date' }));
    const s = summariseRefusals(many, NOW);
    expect(s.tail.length).toBe(TAIL_LINES);
    expect(s.in_window).toBe(TAIL_LINES + 50);
  });

  it('is empty, not broken, with no lines', () => {
    const s = summariseRefusals([], NOW);
    expect(s.in_window).toBe(0);
    expect(s.mean_per_day).toBeNull();
    expect(s.readable_hours).toBeNull();
    expect(s.by_door).toEqual([]);
    expect(s.tail).toEqual([]);
  });
});

describe('the zones', () => {
  it('flags a window busier than twice its own mean, and never a small one', () => {
    expect(refusalZone(150, 60)).toBe('watch');
    expect(refusalZone(100, 60)).toBe('healthy');
    expect(refusalZone(15, 2)).toBe('healthy');   // under the floor, whatever the mean says
    expect(refusalZone(500, null)).toBe('healthy'); // no history to compare with
  });

  it('flags one address behind more than half of a busy window', () => {
    expect(sourcesZone(40, 0.7)).toBe('watch');
    expect(sourcesZone(40, 0.3)).toBe('healthy');
    expect(sourcesZone(10, 1)).toBe('healthy');
    expect(sourcesZone(40, null)).toBe('healthy');
  });

  it('lets a since-restart counter be ordinary until it is not', () => {
    expect(counterZone(0)).toBe('healthy');
    expect(counterZone(100)).toBe('healthy');
    expect(counterZone(101)).toBe('watch');
  });
});

describe('statusOf', () => {
  it('is open for an open incident or a walled address, watch for a watch zone, quiet otherwise', () => {
    expect(statusOf({ open_incidents: 1, walled: 0, zones: ['healthy'] })).toBe('open');
    expect(statusOf({ open_incidents: 0, walled: 3, zones: ['healthy'] })).toBe('open');
    expect(statusOf({ open_incidents: 0, walled: 0, zones: ['healthy', 'watch'] })).toBe('watch');
    expect(statusOf({ open_incidents: 0, walled: 0, zones: ['healthy', 'healthy'] })).toBe('quiet');
  });
});
