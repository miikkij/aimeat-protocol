/**
 * @file test/unit/app-format-md-meta.test.ts
 * @description parseFormatMdMeta() finds an app's `aimeat-format-md` declaration the way a browser
 *   reads the head: a declaration inside a comment is not one, and neither is one after a comment that
 *   never closes. The last case is CodeQL alert 1696: the regex strip `/<!--[\s\S]*?-->/g` matched no
 *   unclosed comment, so it read the meta that a browser hides behind one.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-format-md-meta.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-03 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { parseFormatMdMeta } from '../../src/services/app-format-md.js';

const META = '<meta name="aimeat-format-md" content="/v1/ext/my-ext/render">';

describe('parseFormatMdMeta', () => {
    it('reads a declaration in the head, in both forms', () => {
        expect(parseFormatMdMeta(`<head>${META}</head>`)).toEqual({ extension: 'my-ext', action: 'render' });
        expect(parseFormatMdMeta('<meta name="aimeat-format-md" content="ext:my-ext:render">')).toEqual({ extension: 'my-ext', action: 'render' });
    });

    it('answers null without a declaration, and an error for one that names no action', () => {
        expect(parseFormatMdMeta('<head><title>x</title></head>')).toBeNull();
        expect(parseFormatMdMeta('<meta name="aimeat-format-md" content="/somewhere">')).toHaveProperty('error');
    });

    it('skips a declaration inside a comment and reads the one after it', () => {
        expect(parseFormatMdMeta(`<!-- ${META.replace('my-ext', 'old-ext')} -->${META}`)).toEqual({ extension: 'my-ext', action: 'render' });
        expect(parseFormatMdMeta(`<!-- only mentioned: ${META} -->`)).toBeNull();
    });

    it('reads nothing after a comment that never closes, as a browser does', () => {
        expect(parseFormatMdMeta(`<!-- unclosed ${META}`)).toBeNull();
        expect(parseFormatMdMeta(`${META.replace('render', 'first')}<!-- unclosed ${META}`)).toEqual({ extension: 'my-ext', action: 'first' });
    });

    it('a removed comment does not join the text around it into a new one', () => {
        // A browser reads `<!<!-- x --` as one malformed comment that ends at the first `>`, and then
        // sees the meta. Taking out `<!-- x -->` without a gap would turn `<!` and `--` into `<!--`.
        expect(parseFormatMdMeta(`<!<!-- x -->-- ${META}`)).toEqual({ extension: 'my-ext', action: 'render' });
    });
});
