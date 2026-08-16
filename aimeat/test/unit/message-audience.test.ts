/**
 * @file test/unit/message-audience.test.ts
 * @description Who hears an error decides what language it may be written in, so the classification
 *   itself is worth asserting.
 *
 *   Getting this wrong is expensive in both directions. Classify a person's refusal as `machine` and
 *   it is exempt from the plain-language gate, which is how "Access denied" survived for years.
 *   Classify a machine's own mistake as `person` and somebody spends an afternoon rewriting messages
 *   nobody will ever read, which is how a gate stops being taken seriously.
 * @version-history
 *   v1.0.0 — 2026-08-16 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { audienceOf } from '../../src/middleware/message-audience.js';
import { FAULT_CODES } from '../../src/services/system-fault-report.js';

describe('who hears which error', () => {
    it('sends the caller\'s own mistakes to the machine, where precision beats warmth', () => {
        for (const code of ['NOT_FOUND', 'INVALID_INPUT', 'VALIDATION_ERROR', 'BAD_REQUEST', 'UNKNOWN_PARAMETER']) {
            expect(audienceOf(code), `${code} is the agent's to fix and retry`).toBe('machine');
        }
    });

    it('sends the decisions to the person, because they are the only one who can make them', () => {
        for (const code of ['FORBIDDEN', 'ACCESS_DENIED', 'AUTH_REQUIRED', 'SCOPE_DENIED', 'QUOTA_EXCEEDED', 'NAME_TAKEN']) {
            expect(audienceOf(code), `${code} is a question, not a failure`).toBe('person');
        }
    });

    it('agrees with the fault reporter about what counts as ours', () => {
        // Two lists in two files describing the same thing is how they drift. Asserted rather than
        // merged because they answer different questions — one decides who is told, the other
        // decides what is reported — and a shared constant would blur that.
        for (const code of FAULT_CODES) {
            expect(audienceOf(code), `${code} is reported as our fault, so the person must hear it as ours`).toBe('ours');
        }
    });

    it('treats another system not answering as neither the person\'s doing nor quite ours', () => {
        for (const code of ['FEDERATION_UNREACHABLE', 'PROVIDER_ERROR', 'OPENROUTER_ERROR']) {
            expect(audienceOf(code)).toBe('upstream');
        }
    });

    it('assumes a PERSON is listening when we have not decided', () => {
        // The safe default. Being wrong this way costs a sentence that is kinder than it needed to
        // be; being wrong the other way leaves somebody staring at a word we invented.
        expect(audienceOf('SOME_CODE_NOBODY_CLASSIFIED_YET')).toBe('person');
    });
});
