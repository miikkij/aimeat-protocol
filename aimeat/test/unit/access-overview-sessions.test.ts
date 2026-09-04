/**
 * @file test/unit/access-overview-sessions.test.ts
 * @description What the Access page says about open sessions: only the ones that still open a
 *   door, the person's own grouped by device, the agents' grouped by agent, and the caller's own
 *   session marked. On aimeat.io on 2026-09-04 the security overview carried 3 290 session rows of
 *   which 2 848 had already expired; the page should have said "374 on four devices, 68 by 64
 *   agents", which is what this proves the summary says.
 * @usage pnpm test -- access-overview-sessions
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { summarizeSessions } from '../../src/services/db/access-tab-db-service.js';
import type { SessionRecord } from '../../src/storage/repositories/session.repository.js';

const NOW = Date.parse('2026-09-05T00:00:00.000Z');
const DAY = 86_400_000;
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

function session(over: Partial<SessionRecord> & { sessionId: string; gaii: string }): SessionRecord {
    return { owner: 'alice', issuedAt: at(-DAY), expiresAt: at(29 * DAY), revoked: false, ...over } as SessionRecord;
}

describe('summarizeSessions', () => {
    it('drops expired rows, counts them, and groups the rest by device and by agent', () => {
        const rows = [
            session({ sessionId: 's-cur', gaii: 'alice', deviceLabel: 'Chrome on Windows', lastUsedAt: at(-1000) }),
            session({ sessionId: 's-2', gaii: 'alice', deviceLabel: 'Chrome on Windows', issuedAt: at(-3 * DAY) }),
            session({ sessionId: 's-3', gaii: 'alice', deviceLabel: null }),
            session({ sessionId: 's-old', gaii: 'alice', deviceLabel: 'Edge on Windows', issuedAt: at(-40 * DAY), expiresAt: at(-10 * DAY) }),
            session({ sessionId: 'a-1', gaii: 'scout#alice@node', lastUsedAt: at(-5000) }),
            session({ sessionId: 'a-2', gaii: 'scout#alice@node' }),
            session({ sessionId: 'a-3', gaii: 'writer#alice@node' }),
            session({ sessionId: 'a-old', gaii: 'writer#alice@node', expiresAt: at(-1) }),
        ];
        const s = summarizeSessions(rows, 'alice', 's-cur', NOW);

        expect(s.expired_kept).toBe(2);
        expect(s.current_id).toBe('s-cur');
        expect(s.mine.total).toBe(3);
        expect(s.mine.current).toEqual({ issued_at: at(-DAY), expires_at: at(29 * DAY), device_label: 'Chrome on Windows' });
        expect(s.mine.by_device.map(d => [d.label, d.count])).toEqual([['Chrome on Windows', 2], [null, 1]]);
        expect(s.mine.by_device[0].newest_issued_at).toBe(at(-DAY));
        expect(s.mine.by_device[0].last_used_at).toBe(at(-1000));
        expect(s.agents.total).toBe(3);
        expect(s.agents.distinct).toBe(2);
        expect(s.agents.by_agent.map(a => [a.name, a.count])).toEqual([['scout', 2], ['writer', 1]]);
        expect(s.agents.by_agent[0].gaii).toBe('scout#alice@node');
    });

    it('marks nothing current when the caller is not one of the sessions, and survives an empty list', () => {
        const s = summarizeSessions([session({ sessionId: 'x', gaii: 'alice' })], 'alice', undefined, NOW);
        expect(s.current_id).toBeNull();
        expect(s.mine.current).toBeNull();
        const empty = summarizeSessions([], 'alice', 'nope', NOW);
        expect(empty.mine.total).toBe(0);
        expect(empty.agents.by_agent).toEqual([]);
        expect(empty.expired_kept).toBe(0);
    });
});
