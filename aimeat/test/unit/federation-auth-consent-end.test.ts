/**
 * @file test/unit/federation-auth-consent-end.test.ts
 * @description authConsentEnded (src/routes/federation-auth.ts): only an end time that parses and has
 *   passed ends an auth consent. No end time, or one that does not parse, keeps it, as before the
 *   end-time check (2026-10-20). Covers the Postgres side too, whose TIMESTAMP column cannot hold an
 *   unparseable value for the E2E test to write.
 * @version-history
 *   v1.0.0 — 2026-10-21 — Initial (capability-loss review of secaudit 2026-10 v43).
 */
import { describe, it, expect } from 'vitest';
import { authConsentEnded } from '../../src/routes/federation-auth.js';

const now = new Date('2026-10-21T10:00:00.000Z');

describe('authConsentEnded', () => {
    it('an end time in the past ends the consent (the v43 fix)', () => {
        expect(authConsentEnded('2026-10-21T09:59:59.999Z', now)).toBe(true);
        expect(authConsentEnded('2026-10-21T10:00:00.000Z', now)).toBe(true);
        expect(authConsentEnded(new Date('2026-01-01T00:00:00Z'), now)).toBe(true);
    });
    it('an end time in the future, none at all, or one that does not parse keeps it', () => {
        expect(authConsentEnded('2026-10-21T10:00:00.001Z', now)).toBe(false);
        expect(authConsentEnded(null, now)).toBe(false);
        expect(authConsentEnded(undefined, now)).toBe(false);
        expect(authConsentEnded('', now)).toBe(false);
        expect(authConsentEnded('not-a-date', now)).toBe(false);
    });
});
