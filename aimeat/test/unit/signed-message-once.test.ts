/**
 * @file test/unit/signed-message-once.test.ts
 * @description signedMessageRefusal (services/signed-node-request.ts): an older-format federation
 *   message passes inside the five-minute window of its signed time and only once, keyed on its
 *   signature and its source node (secaudit 2026-10 follow-up, A7).
 * @usage pnpm test -- signed-message-once
 * @version-history
 *   v1.1.0 — 2026-10-06 — Another base64 spelling of the same signature, and a message signed ahead
 *     of the clock, are REPLAYED (secaudit 2026-10 follow-up audit, finding 3).
 *   v1.0.0 — 2026-10-06 — Initial (secaudit 2026-10 follow-up, A7).
 */
import { describe, it, expect } from 'vitest';
import { signedMessageRefusal } from '../../src/services/signed-node-request.js';

describe('an older-format signed federation message passes inside its window, once', () => {
    const now = Date.parse('2026-10-06T12:00:00.000Z');

    it('a fresh message passes, and the same signature again is REPLAYED', () => {
        const at = new Date(now - 1000).toISOString();
        expect(signedMessageRefusal('node-a', at, 'sig-one', now)).toBeNull();
        expect(signedMessageRefusal('node-a', at, 'sig-one', now + 2000)?.code).toBe('REPLAYED');
    });

    it('a new signature from the same node passes, and the same signature from another node is its own', () => {
        const at = new Date(now).toISOString();
        expect(signedMessageRefusal('node-a', at, 'sig-two', now)).toBeNull();
        expect(signedMessageRefusal('node-b', at, 'sig-two', now)).toBeNull();
    });

    // The same 64 signature bytes have more than one base64 spelling, and verify() decodes them all
    // to the same bytes, so a key on the text let one message through once per spelling.
    it('the same signature bytes in another base64 spelling are REPLAYED', () => {
        const bytes = Buffer.alloc(64, 7);
        const padded = bytes.toString('base64');
        const at = new Date(now).toISOString();
        expect(signedMessageRefusal('node-c', at, padded, now)).toBeNull();
        expect(signedMessageRefusal('node-c', at, padded.replace(/=+$/, ''), now)?.code).toBe('REPLAYED');
        expect(signedMessageRefusal('node-c', at, bytes.toString('base64url'), now)?.code).toBe('REPLAYED');
        expect(signedMessageRefusal('node-c', at, `${padded} `, now)?.code).toBe('REPLAYED');
    });

    // A message signed ahead of this node's clock stays valid until its own time plus five minutes, so
    // it has to be remembered that long, not five minutes from when it arrived.
    it('a message signed ahead of the clock is remembered until its own window closes', () => {
        const at = new Date(now + 4 * 60_000).toISOString();
        expect(signedMessageRefusal('node-d', at, 'sig-ahead', now)).toBeNull();
        expect(signedMessageRefusal('node-d', at, 'sig-ahead', now + 6 * 60_000)?.code).toBe('REPLAYED');
    });

    it('a time outside five minutes, either way, or none at all is STALE_TIMESTAMP', () => {
        expect(signedMessageRefusal('node-a', new Date(now - 6 * 60_000).toISOString(), 'sig-old', now)?.code).toBe('STALE_TIMESTAMP');
        expect(signedMessageRefusal('node-a', new Date(now + 6 * 60_000).toISOString(), 'sig-future', now)?.code).toBe('STALE_TIMESTAMP');
        expect(signedMessageRefusal('node-a', undefined, 'sig-none', now)?.code).toBe('STALE_TIMESTAMP');
    });
});
