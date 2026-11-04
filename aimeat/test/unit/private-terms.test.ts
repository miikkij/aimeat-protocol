/**
 * @file test/unit/private-terms.test.ts
 * @description The matching that keeps an organisation node's names out of this public repository
 *   (scripts/lib/private-terms.mjs, applied by the commit-msg and pre-push hooks).
 *
 *   The names in these tests are invented. The point of the module is that real ones never appear
 *   in this repository, so a test of it cannot quote one.
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { addedLines, compileTerms, deriveTerms, findHits, parseTerms } from '../../scripts/lib/private-terms.mjs';

const hitsIn = (terms: string[], ...texts: string[]) =>
    findHits(texts.map(text => ({ where: 'f', text })), compileTerms(terms)).map(h => h.term);

describe('private terms', () => {
    it('a term matches as a whole word, in any case, and not inside a longer word', () => {
        expect(hitsIn(['Harjula'], 'owner: harjula', 'HARJULA wrote it')).toEqual(['Harjula', 'Harjula']);
        expect(hitsIn(['suunta'], 'yksisuuntainen katu', 'suuntainen')).toEqual([]);
    });

    it('a term ending in * matches an inflected word that begins with it', () => {
        expect(hitsIn(['Vesilin*'], 'Vesilinnan sovellus', 'Vesilinna')).toEqual(['Vesilin*', 'Vesilin*']);
        expect(hitsIn(['Vesilin*'], 'avesilinna')).toEqual([]);
    });

    it('a name with a hyphen or a dot matches as written', () => {
        expect(hitsIn(['north.example.io', 'mira-harjula'], 'seen on north.example.io', 'owner mira-harjula@node')).toHaveLength(2);
    });

    it('the list file skips comments, blank lines and repeats', () => {
        expect(parseTerms('# list\n\nHarjula\nharjula\n  Vesilin* \n')).toEqual(['Harjula', 'Vesilin*']);
    });

    it('a commit adds its message and its added lines, never its removed ones', () => {
        const out = '\u0000commit 0123456789abcdef\nfix: the gate\n- a bullet that names Harjula\n\ndiff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-// seen on Harjula\n+// seen on an organisation node\n';
        const lines = addedLines(out);
        expect(lines.map(l => l.text)).toContain('- a bullet that names Harjula');
        expect(lines.map(l => l.text)).not.toContain('// seen on Harjula');
        expect(findHits(lines, compileTerms(['Harjula'])).map(h => h.where)).toEqual(['0123456789ab message']);
    });

    it('a node\'s lists give full names, their parts, account names, app names and file names', () => {
        const terms = deriveTerms({
            host: 'north.example.io', nodeId: 'north-fi-001-genesis',
            people: [{ name: 'Mira Harjula', id: 'mira-harjula@north-fi-001-genesis' }, { name: 'Al Bo', id: 'albo@x' }],
            apps: [{ name: 'Crewboard', filename: 'crew-board.html' }],
            organisms: ['North Sales'],
        });
        expect(terms).toEqual(expect.arrayContaining(['north.example.io', 'north-fi-001-genesis', 'Mira Harjula', 'Mira', 'Harjula', 'mira-harjula', 'albo', 'Crewboard', 'crew-board', 'North Sales']));
        expect(terms).not.toContain('Al');
    });
});
