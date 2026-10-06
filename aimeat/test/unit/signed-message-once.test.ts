/**
 * @file test/unit/signed-message-once.test.ts
 * @description signedMessageRefusal (services/signed-node-request.ts): an older-format federation
 *   message passes inside the five-minute window of its signed time and only once, keyed on its
 *   signature and its source node (secaudit 2026-10 follow-up, A7).
 * @usage pnpm test -- signed-message-once
 * @version-history
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

    it('a time outside five minutes, either way, or none at all is STALE_TIMESTAMP', () => {
        expect(signedMessageRefusal('node-a', new Date(now - 6 * 60_000).toISOString(), 'sig-old', now)?.code).toBe('STALE_TIMESTAMP');
        expect(signedMessageRefusal('node-a', new Date(now + 6 * 60_000).toISOString(), 'sig-future', now)?.code).toBe('STALE_TIMESTAMP');
        expect(signedMessageRefusal('node-a', undefined, 'sig-none', now)?.code).toBe('STALE_TIMESTAMP');
    });
});
