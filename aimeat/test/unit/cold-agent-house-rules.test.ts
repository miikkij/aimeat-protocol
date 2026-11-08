/**
 * @file cold-agent-house-rules.test.ts
 * @description The content check of the cold-agent task `share-to-workspace`. The cases are the
 *   instruction audit re-check of 2026-11-08: the right rules pass, and the rules turned round, a
 *   title holding the words over a body holding none, a missing rule and an empty workspace fail.
 *   A draft never reaches this check: the task reads only published objects.
 * @usage cd aimeat && pnpm exec vitest run test/unit/cold-agent-house-rules.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { documentBodies, houseRulesMissing } from '../../scripts/cold-agent/house-rules.js';

const published = (title: string, markdown: string) => ({ rules: [{ id: 'house-rules', value: { title, markdown } }] });
const missing = (objects: unknown) => houseRulesMissing(documentBodies(objects));

describe('share-to-workspace content check', () => {
    it('passes the three rules as dictated', () => {
        expect(missing(published('House rules', 'Shoes off at the door. Quiet after ten. Whoever cooks does not wash up.'))).toEqual([]);
    });

    it('passes the rules in other words and as a list', () => {
        expect(missing(published('House rules', '# House rules\n\n- Take your shoes off at the door\n- Keep quiet after 10 pm\n- The person who cooks does not do the dishes'))).toEqual([]);
        expect(missing(published('Kotisäännöt', '1. Remove shoes at the door.\n2. From ten o\'clock, quiet please: quiet from 22.\n3. Whoever cooks is excused from washing up.'))).toEqual([]);
    });

    it('fails the rules turned round', () => {
        expect(missing(published('House rules', 'Keep shoes on indoors. Do not be quiet after ten. Whoever cooks must wash up.'))).toEqual([
            'shoes off at the door', 'quiet after ten', 'whoever cooks does not wash up',
        ]);
    });

    it('fails a title that holds the words over a body that holds none', () => {
        expect(missing(published('shoe quiet wash', 'No rules supplied.'))).toHaveLength(3);
    });

    it('fails a document with one rule left out', () => {
        expect(missing(published('House rules', 'Shoes off at the door. Whoever cooks does not wash up.'))).toEqual(['quiet after ten']);
    });

    it('fails an empty workspace', () => {
        expect(missing({})).toHaveLength(3);
        expect(missing(undefined)).toHaveLength(3);
    });

    it('reads only the body fields, at any depth', () => {
        expect(documentBodies({ a: { title: 'Shoes off', markdown: 'one' }, b: [{ value: { text: 'two' } }] })).toBe('one\n\ntwo');
    });
});
