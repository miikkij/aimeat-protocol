/**
 * @file test/unit/served-page-locale.test.ts
 * @description The language of the marks the node draws into a served app (the AI label first):
 *   ?lang, the visitor's cookie, the node's own language (site.default_locale), then the browser's.
 *   The order the served libraries read, so the server's label and the page's pill speak one
 *   language. Before, the browser's Accept-Language alone decided, and on a Finnish place an English
 *   browser read "AI-generated" beside a Finnish pill (crew36 check, 2026-10-31). The source was broken.
 * @usage pnpm exec vitest run test/unit/served-page-locale.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (v31, the language finding of the crew36 check).
 */
import { describe, expect, it } from 'vitest';
import { servedPageLocale } from '../../src/i18n.js';

const req = (o: { lang?: string; cookie?: string; accept?: string } = {}) => ({
    query: o.lang ? { lang: o.lang } : {},
    headers: { cookie: o.cookie, 'accept-language': o.accept },
});

describe('servedPageLocale', () => {
    it('takes the node\'s own language before the browser\'s', () => {
        expect(servedPageLocale(req({ accept: 'en-US,en;q=0.9' }), 'fi')).toBe('fi');
        expect(servedPageLocale(req({ accept: 'en-US' }), 'es')).toBe('es');
    });
    it('takes the visitor\'s cookie before the node\'s language, and ?lang before both', () => {
        expect(servedPageLocale(req({ cookie: 'x=1; aimeat-lang=en', accept: 'fi' }), 'fi')).toBe('en');
        expect(servedPageLocale(req({ lang: 'es', cookie: 'aimeat-lang=en' }), 'fi')).toBe('es');
    });
    it('goes to the browser when the node names no language, or one it does not carry', () => {
        expect(servedPageLocale(req({ accept: 'fi-FI' }), '')).toBe('fi');
        expect(servedPageLocale(req({ accept: 'fi-FI' }), undefined)).toBe('fi');
        expect(servedPageLocale(req({ accept: 'fi-FI' }), 'de')).toBe('fi');
    });
    it('ignores a ?lang it does not carry', () => {
        expect(servedPageLocale(req({ lang: 'de', accept: 'en' }), 'fi')).toBe('fi');
    });
});
