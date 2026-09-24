/**
 * @file test/unit/message-send-limit.test.ts
 * @description The account's message limit (services/message-send-limit.ts): 30 sends a minute per
 *   ACCOUNT, the owner and every agent and app acting for them together, and a send that carries a
 *   turn or is marked 'exempt' is not counted a second time.
 *
 *   Security audit A5-3. The limit sat on two REST routes and was keyed by the principal, so the
 *   tools sent without one and each of an owner's agents had an allowance of its own.
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (security audit A5-3).
 */
import { describe, it, expect } from 'vitest';
import { MESSAGE_SEND_LIMIT, takeSendTurn, checkSendLimit } from '../../src/services/message-send-limit.js';

const NODE = 'aimeat-local-001-dev';
let n = 0;
/** A fresh account for each case: the buckets live as long as the module does. */
const account = (): string => `limit${Date.now().toString(36)}${n++}`;

describe('one allowance per account', () => {
    it('the owner, an agent and an app of one account share it, and the send past it is refused', () => {
        const owner = account();
        const doors = [`${owner}@${NODE}`, `claude#${owner}@${NODE}`, `eco:drum#${owner}@${NODE}`];
        for (let i = 0; i < MESSAGE_SEND_LIMIT.max; i++) {
            const turn = takeSendTurn(doors[i % doors.length]);
            expect(turn).toEqual({ ok: true, account: `${owner}@${NODE}` });
        }
        for (const sender of doors) {
            const refused = takeSendTurn(sender);
            expect(refused.ok).toBe(false);
            if (refused.ok) return;
            expect(refused.code).toBe('RATE_LIMITED');
            expect(refused.retryAfterSec).toBeGreaterThan(0);
            expect(refused.retryAfterSec).toBeLessThanOrEqual(MESSAGE_SEND_LIMIT.windowMs / 1000);
            expect(refused.message).toContain(String(MESSAGE_SEND_LIMIT.max));
        }
    });

    it('another account is not held back by it', () => {
        const busy = account();
        for (let i = 0; i <= MESSAGE_SEND_LIMIT.max; i++) takeSendTurn(`claude#${busy}@${NODE}`);
        expect(takeSendTurn(`claude#${busy}@${NODE}`).ok).toBe(false);
        expect(takeSendTurn(`${account()}@${NODE}`).ok).toBe(true);
    });
});

describe('what the send services count', () => {
    it('a send with no mark is counted, one with a turn or marked exempt is not counted again', () => {
        const owner = account();
        const sender = `${owner}@${NODE}`;
        const turn = takeSendTurn(sender);
        expect(turn.ok).toBe(true);
        if (!turn.ok) return;
        // A turn and 'exempt' pass without drawing on the allowance, however often.
        for (let i = 0; i < MESSAGE_SEND_LIMIT.max * 2; i++) {
            expect(checkSendLimit(sender, turn)).toBeNull();
            expect(checkSendLimit(sender, 'exempt')).toBeNull();
        }
        // Unmarked sends are counted: one turn is already taken, so max - 1 more fit.
        for (let i = 1; i < MESSAGE_SEND_LIMIT.max; i++) expect(checkSendLimit(sender, undefined)).toBeNull();
        expect(checkSendLimit(sender, undefined)?.code).toBe('RATE_LIMITED');
    });
});
