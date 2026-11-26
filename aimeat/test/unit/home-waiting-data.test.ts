/**
 * @file test/unit/home-waiting-data.test.ts
 * @description public/views/home/waiting-data.js: which Settings & Controls page each kind of
 *   waiting thing is counted on (the count on a side menu row), and the cache key and address the
 *   home band, the top bar and the side menu share so a page asks the node once.
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { waitingByTab, waitingKey, waitingPath, WAITING_MAX } from '../../public/views/home/waiting-data.js';

describe('waitingByTab', () => {
    it('counts each kind on the page where the person acts on it', () => {
        expect(waitingByTab({ by_kind: { agent_sign_in: 2, invitation: 1, publish_request: 3, workflow_input: 4 } }))
            .toEqual({ agents: 2, organisms: 1, notifications: 3, workflows: 4 });
    });

    it('adds the kinds one page holds: invitations and team records, proposals and sign-ins', () => {
        expect(waitingByTab({ by_kind: { invitation: 1, team: 2 } })).toEqual({ organisms: 3 });
        expect(waitingByTab({ by_kind: { agent_proposal: 1, agent_sign_in: 2 } })).toEqual({ agents: 3 });
    });

    it('leaves out the kinds that are acted on elsewhere: a message in Messages, an open item on the overview', () => {
        expect(waitingByTab({ by_kind: { reply: 1, help_question: 1, unread: 5, open_item: 3 } })).toEqual({});
    });

    it('gives no row a count of zero, and takes an answer with no counts', () => {
        expect(waitingByTab({ by_kind: { agent_sign_in: 0, invitation: 0 } })).toEqual({});
        expect(waitingByTab(null)).toEqual({});
        expect(waitingByTab({})).toEqual({});
    });

    it('ignores a count that is not a number', () => {
        expect(waitingByTab({ by_kind: { invitation: '2' as unknown as number } })).toEqual({});
    });
});

describe('the shared read', () => {
    it('uses one key and one address at the default row count, so three readers make one request', () => {
        expect(waitingKey()).toBe(waitingKey(WAITING_MAX));
        expect(waitingPath()).toBe(`/v1/home/waiting?limit=${WAITING_MAX}`);
    });

    it('keeps another row count apart', () => {
        expect(waitingKey(5)).not.toBe(waitingKey());
        expect(waitingPath(5)).toBe('/v1/home/waiting?limit=5');
    });
});
