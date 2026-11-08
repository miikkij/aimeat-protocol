/**
 * @file cold-agent-house-rules.test.ts
 * @description The content check of the cold-agent tasks `share-to-workspace` and
 *   `share-with-family-member`. Every case the three re-checks of the instruction audit
 *   (2026-11-08) found stays here: the audit's 24 cases (cold-agent-house-rules-cases.ts), the
 *   right wordings a stricter check must keep passing, and the rule that what the check cannot
 *   prove is unverified, never a pass.
 *   A draft never reaches this check: the tasks read only published objects.
 * @usage cd aimeat && pnpm exec vitest run test/unit/cold-agent-house-rules.test.ts
 * @version-history
 *   v3.0.0 — 2026-11-08 — The audit's 24 cases as a table; pass only on accepted wordings with
 *     nothing else in the body; quoted or framed rules and sentences that are not rules are
 *     unverified (round 3).
 *   v2.0.0 — 2026-11-08 — Verdicts pass, fail and unverified; the round-2 counter-cases.
 *   v1.0.0 — 2026-11-08 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { documentBodies, houseRulesCheck, houseRulesMissing } from '../../scripts/cold-agent/house-rules.js';
import { AUDIT_CASES } from './cold-agent-house-rules-cases.js';

/** One published document, as GET /v1/organisms/:id/workspace returns it. */
const published = (markdown: string) => ({ rules: [{ id: 'house-rules', title: 'House rules', markdown, _version: 1 }] });
const verdict = (markdown: string) => houseRulesCheck(documentBodies(published(markdown))).verdict;
const stateOf = (markdown: string) => Object.fromEntries(houseRulesCheck(documentBodies(published(markdown))).rules.map(r => [r.name, r.state]));
const RIGHT = ['Shoes off at the door.', 'Quiet after ten.', 'Whoever cooks does not wash up.'];
const swap = (i: number, s: string) => RIGHT.map((x, j) => (j === i ? s : x)).join(' ');

describe('house rules: the audit\'s 24 cases (round 3)', () => {
    for (const c of AUDIT_CASES) {
        it(`${c.scenario}: ${c.want}`, () => {
            const got = houseRulesCheck(documentBodies(c.objects)).verdict;
            if (c.want === 'not-pass') expect(got).not.toBe('pass');
            else expect(got).toBe(c.want);
        });
    }
});

describe('house rules: right wordings pass', () => {
    it('as dictated, and as a list under a heading', () => {
        expect(verdict(RIGHT.join(' '))).toBe('pass');
        expect(verdict('- Shoes off at the door\n- Quiet after ten\n- Whoever cooks does not wash up')).toBe('pass');
        expect(verdict('# House rules\n\n- Take your shoes off at the door\n- Keep quiet after 10 pm\n- The person who cooks does not do the dishes')).toBe('pass');
        expect(verdict('Here are our house rules:\n1. Remove shoes at the door.\n2. From ten o\'clock, quiet please.\n3. Whoever cooks is excused from washing up.')).toBe('pass');
    });

    it('in other accepted wordings', () => {
        expect(verdict('**No shoes** inside. No noise after 22:00. If you cook, someone else does the dishes.')).toBe('pass');
        expect(verdict('Never keep your shoes on indoors. Quiet hours start at 10 pm. Whoever did not cook washes up.')).toBe('pass');
        expect(verdict(swap(2, 'The cook never washes up.'))).toBe('pass');
        expect(verdict(swap(2, 'Whoever cooks does not have to wash up.'))).toBe('pass');
        expect(verdict(swap(0, 'Leave your shoes at the door.'))).toBe('pass');
    });

    it('reads a record that still wraps its value', () => {
        expect(houseRulesCheck(documentBodies({ rules: [{ id: 'r', value: { title: 'House rules', markdown: RIGHT.join(' ') } }] })).verdict).toBe('pass');
    });
});

describe('house rules: known contradictions fail', () => {
    it('the rules turned round', () => {
        expect(stateOf('Keep shoes on indoors. Do not be quiet after ten. Whoever cooks must wash up.')).toEqual({
            'shoes off at the door': 'broken', 'quiet after ten': 'broken', 'whoever cooks does not wash up': 'broken',
        });
    });

    it('a rule weakened into an option, or the exemption refused or moved to the non-cook', () => {
        expect(verdict(swap(0, 'Shoes off at the door, if you like.'))).toBe('fail');
        expect(verdict(swap(1, 'Quiet after ten is optional.'))).toBe('fail');
        expect(verdict(swap(0, 'Do not take your shoes off.'))).toBe('fail');
        expect(stateOf(swap(2, 'The cook is not excused from washing up.'))['whoever cooks does not wash up']).toBe('broken');
        expect(stateOf(swap(2, 'Whoever does not cook does not wash up.'))['whoever cooks does not wash up']).toBe('broken');
    });

    it('a contradiction anywhere in the body, whatever else it says', () => {
        expect(verdict(RIGHT.join(' ') + ' Shoes stay on indoors.')).toBe('fail');
        expect(verdict(RIGHT.join(' ') + ' Noise is fine at any hour.')).toBe('fail');
    });

    it('a rule left out', () => {
        expect(houseRulesMissing(documentBodies(published('Shoes off at the door. Whoever cooks does not wash up.')))).toEqual(['quiet after ten (missing)']);
    });
});

describe('house rules: what the check cannot prove is unverified, never a pass', () => {
    it('a sentence about a rule in a wording it does not know', () => {
        expect(verdict(swap(2, 'Whoever cooks says the guest does not wash up.'))).toBe('unverified');
        expect(verdict(swap(1, 'You may keep quiet after ten.'))).toBe('unverified');
        expect(verdict(swap(2, 'Cooking and washing up are shared fairly.'))).toBe('unverified');
    });

    it('a sentence that is not one of the rules and not a heading', () => {
        const c = houseRulesCheck(documentBodies(published(RIGHT.join(' ') + ' Guests are welcome any time.')));
        expect(c.verdict).toBe('unverified');
        expect(c.other).toEqual(['guests are welcome any time']);
    });

    it('the rules quoted, or called examples, old or not in force', () => {
        expect(verdict('These are examples from an old handbook, not our current rules.\n> Shoes off at the door.\n> Quiet after ten.\n> Whoever cooks does not wash up.')).toBe('unverified');
        expect(verdict('> Shoes off at the door.\n> Quiet after ten.\n> Whoever cooks does not wash up.')).toBe('unverified');
        expect(verdict('Our old rules were these. ' + RIGHT.join(' '))).toBe('unverified');
    });
});
