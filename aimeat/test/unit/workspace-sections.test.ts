/**
 * @file workspace-sections.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The section index of a document space as plain data (services/workspace-sections.ts):
 *   what the doors accept, the steps between two indexes, and applying those steps to an index that
 *   moved on in between, which is what an approved suggestion does days after it was made.
 * @usage cd aimeat && pnpm exec vitest run test/unit/workspace-sections.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial (workspace actions for plain members).
 */
import { describe, it, expect } from 'vitest';
import {
    validateSections, diffSections, applySectionOps, normalizeSectionTree, readStoredSections,
    validateSectionOps, summarizeSectionOps, type Section,
} from '../../src/services/workspace-sections.js';

const sec = (id: string, name: string, parentId: string | null = null, documents: string[] = [], color?: string): Section =>
    ({ id, name, parentId, documents, ...(color ? { color } : {}) });

describe('what a section index is', () => {
    it('accepts what the workspace page sends, and drops what it does not know', () => {
        const v = validateSections([{ id: 'sec-a', name: 'Drafts', parentId: null, documents: ['d1', 'd1'], color: 'blue', extra: 1 }]);
        expect('sections' in v && v.sections).toEqual([{ id: 'sec-a', name: 'Drafts', parentId: null, documents: ['d1'], color: 'blue' }]);
    });

    it('refuses a section that is its own parent, and a longer cycle', () => {
        expect(validateSections([{ id: 'a', name: 'A', parentId: 'a', documents: [] }])).toHaveProperty('error');
        expect(validateSections([
            { id: 'a', name: 'A', parentId: 'b', documents: [] },
            { id: 'b', name: 'B', parentId: 'a', documents: [] },
        ])).toHaveProperty('error');
    });

    it('refuses a parent that is not in the list, a duplicate id, a colour the page does not offer and a non-list', () => {
        expect(validateSections([{ id: 'a', name: 'A', parentId: 'gone', documents: [] }])).toHaveProperty('error');
        expect(validateSections([{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }])).toHaveProperty('error');
        expect(validateSections([{ id: 'a', name: 'A', color: 'url(x)' }])).toHaveProperty('error');
        expect(validateSections({ sections: [] })).toHaveProperty('error');
        expect(validateSections([{ id: 'has space', name: 'A' }])).toHaveProperty('error');
    });

    it('reads a stored record leniently, breaking what it cannot render', () => {
        const got = readStoredSections({ sections: [
            { id: 'a', name: 'A', parentId: 'a', documents: ['d1'] },
            { id: 'b', parentId: 'nowhere' },
            'junk',
        ] });
        expect(got).toEqual([sec('a', 'A', null, ['d1']), sec('b', '', null, [])]);
        expect(readStoredSections(null)).toEqual([]);
    });
});

describe('the steps between two indexes', () => {
    it('turns the one into the other when nothing moved in between', () => {
        const from = [sec('a', 'Drafts', null, ['d1', 'd2']), sec('b', 'Old', null, ['d3'])];
        const to = [sec('a', 'Drafts v2', null, ['d1']), sec('c', 'Final', 'a', ['d2'], 'green')];
        const ops = diffSections(from, to);
        expect(applySectionOps(from, ops)).toEqual([sec('a', 'Drafts v2', null, ['d1']), sec('c', 'Final', 'a', ['d2'], 'green')]);
        expect(summarizeSectionOps(ops)).toContain('1 section added');
    });

    it('applied later, keeps what somebody else changed in the meantime', () => {
        // The member saw [Drafts] and added "Final". Before the approval, the creator renamed Drafts
        // and filed d9 there. Approving the member's steps must not undo either.
        const seen = [sec('a', 'Drafts', null, [])];
        const sent = [sec('a', 'Drafts', null, []), sec('b', 'Final', null, ['d1'])];
        const ops = diffSections(seen, sent);
        const meanwhile = [sec('a', 'Working drafts', null, ['d9'])];
        expect(applySectionOps(meanwhile, ops)).toEqual([sec('a', 'Working drafts', null, ['d9']), sec('b', 'Final', null, ['d1'])]);
    });

    it('filing a document moves it out of the section that held it', () => {
        const now = [sec('a', 'A', null, ['d1']), sec('b', 'B', null, [])];
        expect(applySectionOps(now, [{ op: 'file', id: 'b', doc: 'd1' }])).toEqual([sec('a', 'A', null, []), sec('b', 'B', null, ['d1'])]);
    });

    it('a step on a section that is gone does nothing, and a removed parent frees its child', () => {
        const now = [sec('a', 'A'), sec('b', 'B', 'a')];
        expect(applySectionOps(now, [{ op: 'rename', id: 'x', name: 'X' }, { op: 'remove', id: 'a' }])).toEqual([sec('b', 'B', null)]);
    });

    it('breaks a cycle a merge produced instead of rendering it', () => {
        const t = normalizeSectionTree([sec('a', 'A', 'b'), sec('b', 'B', 'a')]);
        expect(t.filter(s => s.parentId === null).length).toBeGreaterThan(0);
    });

    it('checks stored steps again, and refuses the whole list for one bad step', () => {
        expect(validateSectionOps([{ op: 'file', id: 'a', doc: 'd1' }, { op: 'rename', id: 'a', name: 'X' }])).toHaveLength(2);
        expect(validateSectionOps([{ op: 'file', id: 'a', doc: 'd1' }, { op: 'drop-table', id: 'a' }])).toBeNull();
        expect(validateSectionOps([{ op: 'color', id: 'a', color: 'url(x)' }])).toBeNull();
        expect(validateSectionOps('nope')).toBeNull();
    });
});
