/**
 * @file test/unit/internet-opening-door-days.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An agent's opening that waits for the owner (services/internet-opening/opening-door.ts)
 *   checks `days` with the rule the opening itself applies (opening-service.ts checkDays) before the
 *   owner is asked, and the request carries the checked number (secaudit 2026-10-31 inv-23).
 *
 *   The publish gate is stubbed to "ask the owner", and fileAsk records what would be filed:
 *   - refused: days that is no whole number, below 1 or over the node's longest opening files nothing;
 *   - kept: a whole number within the limit is filed as that number, and no days files no days (the
 *     owner's approval then opens for the node's longest, as before).
 * @usage cd aimeat && pnpm exec vitest run test/unit/internet-opening-door-days.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-31 -- Initial (secaudit 2026-10-31 inv-23).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const filed: Array<{ target: Record<string, unknown> }> = [];

vi.mock('../../src/services/publish-requests/ask.js', () => ({
    publishAskOf: () => ({ kind: 'ask', requester: { principal: 'bot#alice@node-a', kind: 'agent', sub: 'bot#alice@node-a' } }),
    fileAsk: vi.fn(async (_ctx: unknown, _owner: unknown, _req: unknown, draft: { target: Record<string, unknown> }) => {
        filed.push(draft);
        return { ok: true, request: { id: 'req-1', ...draft }, alreadyWaiting: false };
    }),
    publishRequestedBody: (_ctx: unknown, f: { request: { id: string } }) => ({ request_id: f.request.id }),
}));

const { openingDoor } = await import('../../src/services/internet-opening/opening-door.js');

const ctx = {
    storage: { getApp: async () => ({ filename: 'page.html', mimeType: 'text/html', versionNumber: 3, access: 'anyone' }) },
    config: { nodeId: 'node-a', baseUrl: 'http://localhost', contentAccess: 'signed-in', appInternetOpening: 'operator', appInternetOpeningMaxDays: 90 },
} as never;
const agent = { visitor: false, inPerson: false, principal: 'bot#alice@node-a', owner: 'alice', operator: async () => false } as never;
const open = (days: unknown) => openingDoor(ctx, agent, { filename: 'page.html', reason: 'For the event guests', days });

beforeEach(() => { filed.length = 0; });

describe('an agent\'s internet opening that asks the owner checks days first', () => {
    for (const bad of ['abc', 0, -3, 2.5, 91, 1000]) {
        it(`days ${JSON.stringify(bad)} is refused 400 and nothing is filed for the owner`, async () => {
            const r = await open(bad);
            expect(r.ok).toBe(false);
            expect(r.ok ? 0 : r.status).toBe(400);
            expect(r.ok ? '' : r.message).toMatch(/whole number from 1 to 90/);
            expect(filed).toHaveLength(0);
        });
    }

    it('usage: days within the limit is filed as that number', async () => {
        const r = await open('30');
        expect(r.ok).toBe(true);
        expect(filed).toHaveLength(1);
        expect(filed[0]!.target.days).toBe(30);
    });

    it('usage: no days files no days, as before', async () => {
        const r = await open(undefined);
        expect(r.ok).toBe(true);
        expect(filed).toHaveLength(1);
        expect('days' in filed[0]!.target).toBe(false);
    });
});
