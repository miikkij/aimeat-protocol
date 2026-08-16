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
import { audienceOf, nextStepFor, NEXT_STEP_BY_CODE } from '../../src/middleware/message-audience.js';
import { error } from '../../src/middleware/envelope.js';
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

describe('the family rules, which carry the long tail of 232 one-off codes', () => {
    it('reads a suffix the way it is always meant', () => {
        expect(audienceOf('CAPABILITY_NOT_FOUND')).toBe('machine');
        expect(audienceOf('NAME_MISMATCH')).toBe('machine');
        expect(audienceOf('EXTENSION_TIMEOUT')).toBe('ours');
        expect(audienceOf('STORAGE_STATS_FAILED')).toBe('ours');
    });

    it('lets an EXACT entry beat the pattern — this is the one that would bite', () => {
        // `^INVALID_` means the caller sent something unusable, and for almost every code it does.
        // Not these two: a person typed the wrong six digits, and telling them "the machine will fix
        // it" would be both wrong and useless. The explicit classification has to win.
        expect(audienceOf('INVALID_TOTP')).toBe('person');
        expect(audienceOf('INVALID_CODE')).toBe('person');
        expect(audienceOf('INVALID_REDIRECT_URI')).toBe('machine');
    });

    it('gives the tail somewhere to go, generically and honestly', () => {
        expect(nextStepFor('CONSUL_DISABLED')).toMatch(/not switched on here/i);
        expect(nextStepFor('SESSION_EXPIRED')).toMatch(/start again/i);
        expect(nextStepFor('ALREADY_PROCESSED')).toMatch(/already done/i);
        expect(nextStepFor('CONTENT_TOO_LARGE')).toMatch(/smaller/i);
        expect(nextStepFor('CONSENT_REQUIRED')).toMatch(/first/i);
    });

    it('says nothing rather than guessing when no family fits', () => {
        // Silence falls back to the support hint, which is honest. A made-up instruction would not be.
        expect(nextStepFor('SOMETHING_NOBODY_HAS_SEEN')).toBeUndefined();
    });
});

describe('where somebody goes next when the message does not say', () => {
    it('reaches a person rather than the API documentation', () => {
        // "View API documentation" is not an answer to somebody who has just been told their name is
        // taken. This is the floor under 696 messages whose English was fine and which simply stopped.
        const taken = error('n', 'NAME_TAKEN', 'That name is already in use');
        expect(taken.hints?.next_actions?.[0]?.description).toBe('Choose a different name and try again.');
        expect(taken.hints?.next_actions?.[0]?.description).not.toMatch(/documentation/i);
    });

    it('lets a route that knows better go first', () => {
        // The floor is a floor. A route with a real answer still wins, which is why refusals.ts
        // passes its own and this never overrides it.
        const specific = error('n', 'NAME_TAKEN', 'That name is in use', 409, undefined,
            [{ description: 'Try "starlight-2"', method: 'POST', url: '/v1/things' }]);
        expect(specific.hints?.next_actions?.[0]?.description).toBe('Try "starlight-2"');
    });

    it('never loses the way to reach the people who run this node', () => {
        const e = error('n', 'NAME_TAKEN', 'That name is in use');
        expect(e.hints?.next_actions?.some(a => /message the people who run this node/i.test(a.description))).toBe(true);
    });

    it('says our faults are ours, and that nobody has to report them', () => {
        for (const code of FAULT_CODES) {
            const step = nextStepFor(code);
            expect(step, `${code} needs a sentence a person can hear`).toBeTruthy();
            expect(step, `${code} must not put the blame on the reader`).toMatch(/on us|already reported|has been told/i);
        }
    });

    it('speaks plainly in every one of them — this is the text a person actually reads', () => {
        const SYSTEM_WORDS = /\b(scope|namespace|principal|token|payload|schema|endpoint|gaii|ghii|denied|forbidden|unauthorized|invalid)\b/i;
        for (const [code, step] of Object.entries(NEXT_STEP_BY_CODE)) {
            expect(step, `${code}: "${step}" uses a word only we understand`).not.toMatch(SYSTEM_WORDS);
            expect(step.length, `${code}: "${step}" is too long to be an instruction`).toBeLessThan(120);
        }
    });
});
