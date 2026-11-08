/**
 * @file cold-agent-house-rules.test.ts
 * @description The content check of the cold-agent tasks `share-to-workspace` and
 *   `share-with-family-member`. Every counter-case the two re-checks of the instruction audit
 *   (2026-11-08) found stays here: the rules turned round, a title holding the words over a body
 *   holding none, a rule weakened into an option, the cook excused in other words, a contradiction
 *   added after the right rules, and a body hidden in metadata or an HTML comment.
 *   A draft never reaches this check: the tasks read only published objects.
 * @usage cd aimeat && pnpm exec vitest run test/unit/cold-agent-house-rules.test.ts
 * @version-history
 *   v2.0.0 — 2026-11-08 — Verdicts pass, fail and unverified; the round-2 counter-cases; records in
 *     the shape the workspace read returns (the value spread onto the entry).
 *   v1.0.0 — 2026-11-08 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { documentBodies, houseRulesCheck, houseRulesMissing } from '../../scripts/cold-agent/house-rules.js';

/** One published document, as GET /v1/organisms/:id/workspace returns it. */
const published = (title: string, markdown: string) => ({ rules: [{ id: 'house-rules', title, markdown, _version: 1 }] });
const verdict = (markdown: string) => houseRulesCheck(documentBodies(published('House rules', markdown))).verdict;
const stateOf = (markdown: string) => Object.fromEntries(houseRulesCheck(documentBodies(published('House rules', markdown))).rules.map(r => [r.name, r.state]));
const RIGHT = ['Shoes off at the door.', 'Quiet after ten.', 'Whoever cooks does not wash up.'];
const swap = (i: number, s: string) => RIGHT.map((x, j) => (j === i ? s : x)).join(' ');

describe('house rules: the right rules pass', () => {
    it('as dictated', () => {
        expect(verdict(RIGHT.join(' '))).toBe('pass');
    });

    it('in other words and as a list', () => {
        expect(verdict('# House rules\n\n- Take your shoes off at the door\n- Keep quiet after 10 pm\n- The person who cooks does not do the dishes')).toBe('pass');
        expect(verdict('1. Remove shoes at the door.\n2. From ten o\'clock, quiet please: quiet from 22.\n3. Whoever cooks is excused from washing up.')).toBe('pass');
        expect(verdict('**No shoes** inside. No noise after 22:00. If you cook, someone else does the dishes.')).toBe('pass');
        expect(verdict('Never keep your shoes on indoors. Quiet hours start at 10 pm. Whoever did not cook washes up.')).toBe('pass');
    });

    it('with the cook excused in other words (round 2: failed when the pattern wanted "cook" twice)', () => {
        expect(verdict(swap(2, 'The cook is excused from washing up.'))).toBe('pass');
        expect(verdict(swap(2, 'The cook never washes up.'))).toBe('pass');
        expect(verdict(swap(2, 'Whoever cooks does not have to wash up.'))).toBe('pass');
    });

    it('reads the record when it still wraps its value', () => {
        expect(houseRulesCheck(documentBodies({ rules: [{ id: 'r', value: { title: 'House rules', markdown: RIGHT.join(' ') } }] })).verdict).toBe('pass');
    });
});

describe('house rules: a wrong document fails', () => {
    it('the rules turned round (round 1)', () => {
        expect(stateOf('Keep shoes on indoors. Do not be quiet after ten. Whoever cooks must wash up.')).toEqual({
            'shoes off at the door': 'broken', 'quiet after ten': 'broken', 'whoever cooks does not wash up': 'broken',
        });
    });

    it('a rule weakened into an option (round 2: these passed)', () => {
        expect(stateOf(swap(0, 'Shoes off at the door is not required.'))['shoes off at the door']).toBe('broken');
        expect(stateOf(swap(1, 'Being quiet after ten is not required.'))['quiet after ten']).toBe('broken');
        expect(verdict(swap(0, 'Shoes off at the door, if you like.'))).toBe('fail');
        expect(verdict(swap(1, 'Quiet after ten is optional.'))).toBe('fail');
        expect(verdict(swap(0, 'Do not take your shoes off.'))).toBe('fail');
    });

    it('a contradiction added after the right rules (round 2: this passed)', () => {
        expect(stateOf(RIGHT.join(' ') + ' The cook is responsible for washing up.')['whoever cooks does not wash up']).toBe('broken');
        expect(verdict(RIGHT.join(' ') + ' Shoes stay on indoors.')).toBe('fail');
        expect(verdict(RIGHT.join(' ') + ' Noise is fine at any hour.')).toBe('fail');
    });

    it('a title that holds the words over a body that holds none (round 1)', () => {
        expect(houseRulesMissing(documentBodies(published('shoe quiet wash', 'No rules supplied.')))).toHaveLength(3);
    });

    it('one rule left out', () => {
        expect(houseRulesMissing(documentBodies(published('House rules', 'Shoes off at the door. Whoever cooks does not wash up.')))).toEqual(['quiet after ten (missing)']);
    });

    it('an empty workspace', () => {
        expect(houseRulesCheck(documentBodies({})).verdict).toBe('fail');
        expect(houseRulesCheck(documentBodies(undefined)).verdict).toBe('fail');
    });
});

describe('house rules: only the document body is read (round 2: these were read)', () => {
    it('not a nested metadata body', () => {
        const objects = { rules: [{ id: 'r', title: 't', markdown: 'No rules.', metadata: { body: RIGHT.join(' ') } }] };
        expect(documentBodies(objects)).toBe('No rules.');
        expect(houseRulesCheck(documentBodies(objects)).verdict).toBe('fail');
    });

    it('not an HTML comment', () => {
        const objects = published('t', `No rules.<!-- ${RIGHT.join(' ')} -->`);
        expect(houseRulesCheck(documentBodies(objects)).verdict).toBe('fail');
    });

    it('the first body field of each record, never a title', () => {
        expect(documentBodies({ a: [{ title: 'Shoes off', markdown: 'one' }], b: [{ text: 'two' }] })).toBe('one\n\ntwo');
    });
});

describe('house rules: what the check cannot decide is unverified, not a pass', () => {
    it('a sentence about a rule that neither says nor turns it round', () => {
        expect(verdict(swap(0, 'Shoes are a topic we discuss at the door.'))).toBe('unverified');
        expect(verdict(swap(2, 'Cooking and washing up are shared fairly.'))).toBe('unverified');
    });
});
