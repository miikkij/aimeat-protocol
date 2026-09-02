/**
 * @file test/unit/workspace-doc-markdown.test.ts
 * @description The string surgery behind in-place document edits, asserted the way the promise is
 *   worded: everything outside the edit is BYTE-IDENTICAL.
 *
 *   Every assertion here is about a failure that would be silent in production. A section boundary
 *   read one line short drops a paragraph; a heading found inside a code fence cuts a spec in half
 *   at a shell transcript; a "helpful" reformat on the way through makes the next reader's diff
 *   useless. None of those throw, and none of them are visible in the tool's answer, so they have to
 *   be caught here.
 * @usage pnpm test -- workspace-doc-markdown
 * @version-history
 *   v1.0.0 — 2026-09-02 — Initial (wish-workspace-append-ja-osiomuokkaus).
 */
import { describe, it, expect } from 'vitest';
import {
    findSections, locateSection, insertAt, replaceRange, isHeadingLine,
} from '../../src/services/workspace-doc-markdown.js';

const DOC = [
    '# Agent v2',
    '',
    'Intro paragraph.',
    '',
    '## Concurrency',
    '',
    'Two writers, one document.',
    '',
    '### Retry',
    '',
    'Six attempts.',
    '',
    '## Tests',
    '',
    '- one',
    '- two',
    '',
].join('\n');

describe('findSections', () => {
    it('finds every heading with its level and line', () => {
        const s = findSections(DOC);
        expect(s.map(x => `${x.level}:${x.heading}:${x.line}`))
            .toEqual(['1:Agent v2:1', '2:Concurrency:5', '3:Retry:9', '2:Tests:13']);
    });

    it('closes a section at the next heading of the same level or higher, subsections included', () => {
        const s = findSections(DOC);
        const concurrency = s.find(x => x.heading === 'Concurrency')!;
        const body = DOC.slice(concurrency.start, concurrency.end);
        expect(body).toContain('### Retry');           // the subsection travels with its parent
        expect(body).not.toContain('## Tests');
    });

    it('does not see a heading inside a fenced code block', () => {
        const doc = [
            '## Shell',
            '',
            '```bash',
            '# not a heading',
            '## also not a heading',
            '```',
            '',
            '## Real',
            '',
            'x',
        ].join('\n');
        expect(findSections(doc).map(s => s.heading)).toEqual(['Shell', 'Real']);
    });

    it('closes a fence only on its own marker, so a tilde block inside backticks is text', () => {
        const doc = ['## A', '', '````', '~~~', '## hidden', '~~~', '````', '', '## B'].join('\n');
        expect(findSections(doc).map(s => s.heading)).toEqual(['A', 'B']);
    });

    it('reads a closing sequence of hashes as decoration, not as part of the heading', () => {
        expect(findSections('## Tests ##\n\nx').map(s => s.heading)).toEqual(['Tests']);
    });
});

describe('locateSection', () => {
    it('matches on heading text, with or without the leading hashes', () => {
        expect('section' in locateSection(DOC, 'Concurrency')).toBe(true);
        expect('section' in locateSection(DOC, '## Concurrency')).toBe(true);
    });

    it('refuses a heading that matches nothing, and lists the ones that exist', () => {
        const out = locateSection(DOC, 'Rollout');
        expect('error' in out && out.error).toBe('NO_SUCH_SECTION');
        expect('error' in out && out.message).toContain('## Concurrency');
    });

    it('refuses an ambiguous heading and names both, with their line numbers', () => {
        const doc = ['## Notes', '', 'a', '', '## Other', '', 'b', '', '## Notes', '', 'c'].join('\n');
        const out = locateSection(doc, 'Notes');
        expect('error' in out && out.error).toBe('AMBIGUOUS_SECTION');
        expect('error' in out && out.message).toContain('line 1');
        expect('error' in out && out.message).toContain('line 9');
    });

    it('treats the same text at two levels as two matches, because a reader cannot tell them apart', () => {
        const doc = ['## Notes', '', 'a', '', '### Notes', '', 'b'].join('\n');
        const out = locateSection(doc, 'Notes');
        expect('error' in out && out.error).toBe('AMBIGUOUS_SECTION');
    });
});

describe('insertAt', () => {
    it('appends at the end and leaves the original as a byte-identical prefix', () => {
        const next = insertAt(DOC, DOC.length, '## Open questions\n\nOne.');
        expect(next.startsWith(DOC)).toBe(true);
        expect(next.endsWith('## Open questions\n\nOne.\n')).toBe(true);
    });

    it('separates with exactly one blank line, whatever the document ended with', () => {
        expect(insertAt('a', 1, 'b')).toBe('a\n\nb\n');
        expect(insertAt('a\n', 2, 'b')).toBe('a\n\nb\n');
        expect(insertAt('a\n\n', 3, 'b')).toBe('a\n\nb\n');
        expect(insertAt('', 0, 'b')).toBe('b\n');
    });

    it('inserts inside the document without removing a character from either half', () => {
        const at = DOC.indexOf('## Tests');
        const next = insertAt(DOC, at, 'Added under Concurrency.');
        expect(next.startsWith(DOC.slice(0, at))).toBe(true);
        expect(next.endsWith(DOC.slice(at))).toBe(true);
        expect(next).toContain('Added under Concurrency.');
    });

    it('is a no-op for blank text rather than a stray blank line', () => {
        expect(insertAt(DOC, DOC.length, '   \n\n')).toBe(DOC);
    });
});

describe('replaceRange', () => {
    it('changes one section and nothing else, byte for byte', () => {
        const s = findSections(DOC).find(x => x.heading === 'Concurrency')!;
        const next = replaceRange(DOC, s.start, s.end, '## Concurrency\n\nRewritten.');
        expect(next.slice(0, s.start)).toBe(DOC.slice(0, s.start));
        expect(next.endsWith(DOC.slice(s.end))).toBe(true);
        expect(next).toContain('## Concurrency\n\nRewritten.');
        expect(next).not.toContain('Two writers');
        expect(next).not.toContain('### Retry');       // the subsection was part of the section
    });

    it('keeps the section\'s own trailing whitespace, so the seam to the next heading is unchanged', () => {
        const s = findSections(DOC).find(x => x.heading === 'Concurrency')!;
        const next = replaceRange(DOC, s.start, s.end, '## Concurrency\n\nRewritten.\n\n\n');
        expect(next).toContain('Rewritten.\n\n## Tests');
    });

    it('renames a section when the replacement carries a different heading', () => {
        const s = findSections(DOC).find(x => x.heading === 'Tests')!;
        const next = replaceRange(DOC, s.start, s.end, '## Verification\n\n- one');
        expect(next).toContain('## Verification');
        expect(next).not.toContain('## Tests');
        expect(next.slice(0, s.start)).toBe(DOC.slice(0, s.start));
    });
});

describe('isHeadingLine', () => {
    it('accepts a block whose first non-blank line is a heading', () => {
        expect(isHeadingLine('## Concurrency\n\nx')).toBe(true);
        expect(isHeadingLine('\n\n### Retry\n')).toBe(true);
    });
    it('rejects a body with no heading, which is the refusal that stops a section losing its title', () => {
        expect(isHeadingLine('Just a paragraph.')).toBe(false);
        expect(isHeadingLine('```\n## in a fence\n```')).toBe(false);
    });
});

describe('a document at the size that used to be unmanageable', () => {
    // 57,723 characters is the real Agent v2 design spec, the document two sessions refused to
    // rewrite by hand. The point is not that a long string works; it is that the edit is local, so
    // the untouched parts come back identical however long they are.
    const big = (() => {
        const parts = ['# Big spec', ''];
        for (let i = 0; i < 200; i++) {
            parts.push(`## Part ${i}`, '', 'x'.repeat(280), '');
        }
        return parts.join('\n');
    })();

    it('appends without disturbing the 57k characters in front of it', () => {
        expect(big.length).toBeGreaterThan(57_723);
        const next = insertAt(big, big.length, '## Found\n\nOne more thing.');
        expect(next.startsWith(big)).toBe(true);
    });

    it('replaces one section in the middle and leaves both sides identical', () => {
        const s = findSections(big).find(x => x.heading === 'Part 100')!;
        const next = replaceRange(big, s.start, s.end, '## Part 100\n\nrewritten');
        expect(next.slice(0, s.start)).toBe(big.slice(0, s.start));
        expect(next.endsWith(big.slice(s.end))).toBe(true);
        expect(next).toContain('## Part 99');
        expect(next).toContain('## Part 101');
    });
});
