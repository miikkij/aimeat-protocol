/**
 * @file extension-script-refusal.test.ts
 * @description A refusal an extension's script names keeps its code and a 4xx status; a platform
 *   code stays reserved, and anything else is still EXTENSION_ERROR (instruction audit 2026-11-08:
 *   Lifecycle Central's CLAIM_CONFLICT came back as EXTENSION_ERROR 500).
 * @usage cd aimeat && pnpm exec vitest run test/unit/extension-script-refusal.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { scriptRefusal } from '../../src/services/extension-access/script-refusal.js';

describe('scriptRefusal', () => {
    it('keeps a named refusal and maps its status from the code', () => {
        expect(scriptRefusal('CLAIM_CONFLICT: This claim collides with 1 live claim(s)')).toEqual({ code: 'CLAIM_CONFLICT', status: 409 });
        expect(scriptRefusal('WISH_NOT_FOUND: no wish by that id')).toEqual({ code: 'WISH_NOT_FOUND', status: 404 });
        expect(scriptRefusal('CLAIM_FORBIDDEN: not your session')).toEqual({ code: 'CLAIM_FORBIDDEN', status: 403 });
        expect(scriptRefusal('INVALID_INPUT: area is required')).toEqual({ code: 'INVALID_INPUT', status: 400 });
        expect(scriptRefusal('VISITOR_READ_ONLY: a visitor cannot write')).toEqual({ code: 'VISITOR_READ_ONLY', status: 403 });
    });

    it('keeps the 500 for a code that is not the caller\'s doing, and only names it', () => {
        expect(scriptRefusal('SOURCE_UNAVAILABLE: the upstream register did not answer')).toEqual({ code: 'SOURCE_UNAVAILABLE', status: 500 });
        expect(scriptRefusal('FETCH_TIMEOUT: no answer in 10 s')).toEqual({ code: 'FETCH_TIMEOUT', status: 500 });
    });

    it('never lets a script speak with a platform code', () => {
        for (const code of ['AUTH_REQUIRED', 'SCOPE_DENIED', 'TOKEN_INVALID', 'PAYMENT_REQUIRED', 'RATE_LIMITED', 'EXTENSION_ERROR', 'INTERNAL_ERROR', 'CONSENT_REQUIRED']) {
            expect(scriptRefusal(`${code}: anything`), code).toBeNull();
        }
    });

    it('leaves an ordinary error to EXTENSION_ERROR', () => {
        expect(scriptRefusal('TypeError: x is not a function')).toBeNull();
        expect(scriptRefusal('Something broke')).toBeNull();
        expect(scriptRefusal('ERROR: one word')).toBeNull();
        expect(scriptRefusal(`${'A_'.repeat(30)}B: too long`)).toBeNull();
    });
});
