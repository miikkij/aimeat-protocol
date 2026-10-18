/**
 * @file test/unit/exposure-classification.test.ts
 * @description lowerTo (services/exposure/exposure-classification.ts): the widest level each exposed
 *   kind's own setting can take within a classification's audience cap, which the What others can see
 *   page sends to the route that changes the item (plan doc-mvdipuyqraas, L4.1). Each answer is a
 *   level the kind can store, and never wider than the cap.
 * @version-history v1.0.0 -- 2026-10-18 -- Initial (plan doc-mvdipuyqraas, L4.1).
 */
import { describe, expect, it } from 'vitest';
import { lowerTo } from '../../src/services/exposure/exposure-classification.js';
import { capAllows, type AudienceLevel } from '../../src/services/classification/audience-levels.js';
import { KINDS } from '../../src/services/exposure/exposure-types.js';

const PERSONAL = 'alice@node';
const ORG = 'organism:org-1';
const CAPS: AudienceLevel[] = ['private', 'organism', 'signed-in', 'link'];

describe('lowerTo: within the cap, as each kind stores a level', () => {
    it('never answers a level wider than the cap, for any kind', () => {
        for (const kind of KINDS) {
            for (const cap of CAPS) {
                for (const scope of [PERSONAL, ORG]) {
                    const to = lowerTo(kind, 'x', cap, scope);
                    if (to) expect(capAllows(cap, to.level), `${kind} ${cap} ${scope} → ${to.level}`).toBe(true);
                }
            }
        }
    });

    it('a record: signed-in for link (a record has no link level), its organism inside one, private outside', () => {
        expect(lowerTo('memory', 'k', 'link', PERSONAL)).toEqual({ level: 'signed-in' });
        expect(lowerTo('memory', 'k', 'organism', ORG)).toEqual({ level: 'organism', organism_id: 'org-1' });
        expect(lowerTo('memory', 'k', 'organism', PERSONAL)).toEqual({ level: 'private' });
    });

    it('a board is made private; an app needs its own page below signed-in', () => {
        expect(lowerTo('board', 'b', 'signed-in', PERSONAL)).toEqual({ level: 'private' });
        expect(lowerTo('app', 'a.html', 'link', PERSONAL)).toEqual({ level: 'link' });
        expect(lowerTo('app', 'a.html', 'organism', PERSONAL)).toBeUndefined();
    });

    it('a workspace share goes to accounts, the organism, or off; an organism\'s member list to signed-in', () => {
        expect(lowerTo('workspace_share', 'o/w/p/d', 'link', ORG)).toEqual({ level: 'signed-in' });
        expect(lowerTo('workspace_share', 'o/w/p/d', 'organism', ORG)).toEqual({ level: 'organism', organism_id: 'org-1' });
        expect(lowerTo('organism', 'org-1#members', 'signed-in', ORG)).toEqual({ level: 'signed-in' });
        expect(lowerTo('organism', 'org-1', 'signed-in', ORG)).toEqual({ level: 'private' });
    });

    it('a kind with no classification address is lowered on its own page', () => {
        expect(lowerTo('portfolio', 'alice', 'private', PERSONAL)).toBeUndefined();
        expect(lowerTo('datapackage', 'p', 'private', PERSONAL)).toBeUndefined();
    });
});
