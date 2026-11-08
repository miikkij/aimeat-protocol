/**
 * @file extension-script-refusal.test.ts
 * @description A refusal an extension's script names gives its code as a reason and a 4xx status
 *   where the reason says the request was the problem; anything else is still EXTENSION_ERROR
 *   (instruction audit 2026-11-08: Lifecycle Central's CLAIM_CONFLICT came back as EXTENSION_ERROR
 *   500). The response code is never the script's: the re-check of the same day found 863 of the
 *   node's 948 codes passing the first version's reserved-prefix list.
 * @usage cd aimeat && pnpm exec vitest run test/unit/extension-script-refusal.test.ts
 * @version-history
 *   v2.0.0 — 2026-11-08 — The script's code is a reason; the reserved-prefix test is replaced by one
 *     that a node code a script names stays a reason.
 *   v1.0.0 — 2026-11-08 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { scriptRefusal, EXTENSION_REFUSED } from '../../src/services/extension-access/script-refusal.js';

describe('scriptRefusal', () => {
    it('reads a named refusal as a reason and maps its status from it', () => {
        expect(scriptRefusal('CLAIM_CONFLICT: This claim collides with 1 live claim(s)')).toEqual({ reason: 'CLAIM_CONFLICT', status: 409 });
        expect(scriptRefusal('WISH_NOT_FOUND: no wish by that id')).toEqual({ reason: 'WISH_NOT_FOUND', status: 404 });
        expect(scriptRefusal('CLAIM_FORBIDDEN: not your session')).toEqual({ reason: 'CLAIM_FORBIDDEN', status: 403 });
        expect(scriptRefusal('INVALID_INPUT: area is required')).toEqual({ reason: 'INVALID_INPUT', status: 400 });
        expect(scriptRefusal('VISITOR_READ_ONLY: a visitor cannot write')).toEqual({ reason: 'VISITOR_READ_ONLY', status: 403 });
    });

    it('keeps the 500 for a reason that is not the caller\'s doing, and only names it', () => {
        expect(scriptRefusal('SOURCE_UNAVAILABLE: the upstream register did not answer')).toEqual({ reason: 'SOURCE_UNAVAILABLE', status: 500 });
        expect(scriptRefusal('FETCH_TIMEOUT: no answer in 10 s')).toEqual({ reason: 'FETCH_TIMEOUT', status: 500 });
    });

    it('gives a script no way to choose the response code: a node code it names is only a reason', () => {
        // The caller's code is EXTENSION_REFUSED whatever the script wrote; these come back as reasons.
        for (const code of ['NOT_FOUND', 'CAPABILITY_NOT_FOUND', 'AUTH_REQUIRED', 'PAYMENT_REQUIRED', 'EXTENSION_ERROR']) {
            const r = scriptRefusal(`${code}: anything`);
            expect(r?.reason, code).toBe(code);
            expect(r).not.toHaveProperty('code');
        }
        expect(EXTENSION_REFUSED).toBe('EXTENSION_REFUSED');
    });

    it('leaves an ordinary error to EXTENSION_ERROR', () => {
        expect(scriptRefusal('TypeError: x is not a function')).toBeNull();
        expect(scriptRefusal('Something broke')).toBeNull();
        expect(scriptRefusal('ERROR: one word')).toBeNull();
        expect(scriptRefusal(`${'A_'.repeat(30)}B: too long`)).toBeNull();
    });
});
