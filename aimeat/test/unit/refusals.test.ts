/**
 * @file test/unit/refusals.test.ts
 * @description A refusal has to be readable by the person it stops, and it has to leave them
 *   somewhere to go.
 *
 *   The measurement this came from: 490 refusal-shaped messages, 22 of which said what to do next,
 *   and 43 that said exactly "Access denied". These assertions are the rule made checkable — not
 *   that the wording is nice, but that the two things a stopped person needs are present: a sentence
 *   they can understand, and a next step.
 * @version-history
 *   v1.0.0 — 2026-08-16 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { refuseNotYours, refuseNeedsPermission, refuseNotMember, refuseNeedsSignIn } from '../../src/middleware/refusals.js';

const config = { nodeId: 'unit-node' } as never;

/** The vocabulary that means nothing to somebody who does not build this. */
const SYSTEM_WORDS = /\b(scope|namespace|principal|GAII|GHII|GEAI|token|payload|schema|endpoint|forbidden|unauthorized|denied)\b/i;

const all = () => [
    refuseNotYours(config, { thing: 'app', action: 'change', listUrl: '/v1/apps' }),
    refuseNeedsPermission(config, { want: 'save this under your name', scope: 'memory:write-as-owner' }),
    refuseNotMember(config, { space: 'The design room', requestUrl: '/v1/organisms/x/join' }),
    refuseNeedsSignIn(config, { want: 'see your own messages' }),
];

describe('every refusal a person can hear', () => {
    it('says it in words, not in ours', () => {
        for (const r of all()) {
            expect(r.error?.message, `"${r.error?.message}" uses a word only we understand`)
                .not.toMatch(SYSTEM_WORDS);
        }
    });

    it('never just stops — there is always somewhere to go', () => {
        for (const r of all()) {
            const actions = r.hints?.next_actions ?? [];
            // The support rung is appended to every error by envelope.ts. A builder must add at
            // least one rung ABOVE it, or the only thing on offer is "go and ask a human", which is
            // the work this whole path exists to take off the person.
            expect(actions.length, `"${r.error?.message}" offers nothing but support`).toBeGreaterThan(1);
        }
    });

    it('always keeps the way to ask the people who run this', () => {
        for (const r of all()) {
            const actions = r.hints?.next_actions ?? [];
            expect(actions.some(a => /message the people who run this node/i.test(a.description))).toBe(true);
        }
    });

    it('does not blame the person', () => {
        for (const r of all()) {
            expect(r.error?.message, `"${r.error?.message}" reads as an accusation`)
                .not.toMatch(/\byou (cannot|may not|are not allowed|must not)\b|not permitted|violation/i);
        }
    });

    it('puts the identifier where a technical reader looks, not in the sentence', () => {
        const r = refuseNeedsPermission(config, { want: 'save this under your name', scope: 'memory:write-as-owner' });
        expect(r.error?.message).not.toContain('memory:write-as-owner');
        expect(JSON.stringify(r.error?.details)).toContain('memory:write-as-owner');
    });

    it('asks the permission question as a question about the assistant, not a failure of the person', () => {
        const r = refuseNeedsPermission(config, { want: 'send a message for you' });
        expect(r.error?.message).toBe('Your assistant would need your permission to send a message for you.');
    });
});
