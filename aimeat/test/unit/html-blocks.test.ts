/**
 * @file test/unit/html-blocks.test.ts
 * @description Unit tests for src/utils/html-blocks.ts: the style and script reading the
 *   publish-time checks do on every app.
 *
 *   TWO THINGS ARE ASSERTED HERE AND THEY ARE BOTH THE POINT. The bodies have to be the same ones
 *   the regular expression returned, because three publish checks act on them. And the hostile
 *   inputs have to return, because that is what the change was for: `<style[^>]*>([\s\S]*?)</style>`
 *   restarts at every `<style` and scans to the end for a closing tag the page never writes, which
 *   is quadratic on bytes a stranger uploaded (CodeQL js/polynomial-redos, alerts 1641 and 1642).
 * @usage cd aimeat && pnpm test -- html-blocks
 * @version-history
 *   v1.0.0 — 2026-09-20 — Initial, with the helper.
 */
import { describe, it, expect } from 'vitest';
import { elementBodies, withoutBlockComments } from '../../src/utils/html-blocks.js';

describe('elementBodies', () => {
    it('returns each body in document order, attributes and all', () => {
        const html = '<html><style>.a{}</style><p>x</p><style type="text/css">.b{}</style></html>';
        expect(elementBodies(html, 'style')).toEqual(['.a{}', '.b{}']);
    });

    it('matches the tag name and not a longer one', () => {
        // `<styles>` is a different element, and a check that counted its body would report class
        // names this app never defined.
        expect(elementBodies('<styles>.a{}</styles><style>.b{}</style>', 'style')).toEqual(['.b{}']);
    });

    it('is case-insensitive about the tag, as HTML is', () => {
        expect(elementBodies('<STYLE>.a{}</STYLE>', 'style')).toEqual(['.a{}']);
    });

    it('asks the caller about the attributes, so a src script is skipped', () => {
        const html = '<script src="/v1/libs/aimeat-auth.js"></script><script>go()</script>';
        const keep = (attrs: string) => !/\bsrc\s*=/i.test(attrs);
        expect(elementBodies(html, 'script', keep)).toEqual(['go()']);
    });

    it('stops at a block that is never closed, which is where the browser stops too', () => {
        expect(elementBodies('<style>.a{}</style><style>.b{}', 'style')).toEqual(['.a{}']);
    });

    it('returns on a page that is nothing but unclosed openings', () => {
        // The shape that made the regular expression quadratic: 60k restarts, none of which can
        // match. A publish waits on this check.
        const hostile = `<html>${'<style>a'.repeat(60_000)}</html>`;
        const started = Date.now();
        expect(elementBodies(hostile, 'style')).toEqual([]);
        expect(Date.now() - started).toBeLessThan(1000);
    });
});

describe('withoutBlockComments', () => {
    it('replaces each comment with one space and keeps the code around it', () => {
        expect(withoutBlockComments('a/* gone */b')).toBe('a b');
        expect(withoutBlockComments('/*x*/a/*y*/b/*z*/')).toBe(' a b ');
    });

    it('leaves code with no comment in it untouched', () => {
        expect(withoutBlockComments('const a = 1; // not a block')).toBe('const a = 1; // not a block');
    });

    it('takes the rest of the file when a comment is never closed', () => {
        // A JavaScript parser does the same, so code hidden behind an unterminated comment is not
        // code that runs, and a check must not count it as such.
        expect(withoutBlockComments('a/* forever')).toBe('a ');
    });

    it('returns on a file that is nothing but comment openings', () => {
        const hostile = `x${'a/*'.repeat(60_000)}`;
        const started = Date.now();
        expect(withoutBlockComments(hostile).length).toBeLessThan(hostile.length);
        expect(Date.now() - started).toBeLessThan(1000);
    });
});
