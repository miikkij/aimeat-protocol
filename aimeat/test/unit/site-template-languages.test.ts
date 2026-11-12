/**
 * @file test/unit/site-template-languages.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The decisions of a front page template stored as one page per language
 *   (src/services/site/template-languages.ts): which language a value and a document name, which
 *   stored page a reader gets, and the address and hreflang set of each page.
 * @usage cd aimeat && pnpm exec vitest run test/unit/site-template-languages.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-12 — Initial.
 */
import { describe, it, expect } from 'vitest';
import {
    documentLanguage, pickTemplateVersion, templateAddress, templateAlternates, templateLanguage,
} from '../../src/services/site/template-languages.js';

const CHOSEN = (lang: string): string => `theme=dark; aimeat-lang=${lang}; aimeat-lang-chosen=1`;

describe('templateLanguage', () => {
    it('reads a two-letter code from a tag in any case, with or without a region', () => {
        expect(templateLanguage('fi')).toBe('fi');
        expect(templateLanguage('FI')).toBe('fi');
        expect(templateLanguage('en-US')).toBe('en');
    });
    it('answers undefined for anything that is not a language tag', () => {
        for (const value of ['', 'f', 'fin', 'fi_FI', '../x', 12, null, undefined, ['fi']]) {
            expect(templateLanguage(value)).toBeUndefined();
        }
    });
});

describe('documentLanguage', () => {
    it('reads <html lang> however it is quoted', () => {
        expect(documentLanguage('<!doctype html><html lang="fi"><head>')).toBe('fi');
        expect(documentLanguage("<!DOCTYPE html>\n<HTML class='x' LANG='en-GB'>")).toBe('en');
        expect(documentLanguage('<html lang=es>')).toBe('es');
    });
    it('answers undefined when the document states none, and does not read data-lang or a body tag', () => {
        expect(documentLanguage('<!doctype html><html><head>')).toBeUndefined();
        expect(documentLanguage('<html data-lang="fi">')).toBeUndefined();
        expect(documentLanguage('<html><body><p lang="fi">')).toBeUndefined();
    });
});

describe('pickTemplateVersion', () => {
    const versions = { defaultLang: 'fi', languages: ['en', 'es'] };

    it('?lang names the version, and a language with no version gets the default page', () => {
        expect(pickTemplateVersion(versions, { lang: 'en', acceptLanguage: 'fi' })).toBe('en');
        expect(pickTemplateVersion(versions, { lang: 'ES', cookie: CHOSEN('en') })).toBe('es');
        expect(pickTemplateVersion(versions, { lang: 'fi', acceptLanguage: 'en' })).toBeUndefined();
        expect(pickTemplateVersion(versions, { lang: 'de', acceptLanguage: 'en' })).toBeUndefined();
    });

    it('a language picked on this device beats the browser, and an unmarked cookie does not count', () => {
        expect(pickTemplateVersion(versions, { cookie: CHOSEN('es'), acceptLanguage: 'fi' })).toBe('es');
        expect(pickTemplateVersion(versions, { cookie: CHOSEN('fi'), acceptLanguage: 'en' })).toBeUndefined();
        expect(pickTemplateVersion(versions, { cookie: 'aimeat-lang=es', acceptLanguage: 'fi' })).toBeUndefined();
    });

    it('the default page wins when its language is anywhere in the browser list', () => {
        expect(pickTemplateVersion(versions, { acceptLanguage: 'en-US,en;q=0.9,fi;q=0.8' })).toBeUndefined();
        expect(pickTemplateVersion(versions, { acceptLanguage: 'en-US,en;q=0.9,fi;q=0' })).toBe('en');
    });

    it('otherwise the first listed language with a version, then English, then the default page', () => {
        expect(pickTemplateVersion(versions, { acceptLanguage: 'de,es;q=0.8,en;q=0.5' })).toBe('es');
        expect(pickTemplateVersion(versions, { acceptLanguage: 'de-DE,de;q=0.9' })).toBe('en');
        expect(pickTemplateVersion({ defaultLang: 'fi', languages: ['es'] }, { acceptLanguage: 'de' })).toBeUndefined();
    });

    it('a request that names no language gets the default page', () => {
        expect(pickTemplateVersion(versions, {})).toBeUndefined();
        expect(pickTemplateVersion(versions, { acceptLanguage: '' })).toBeUndefined();
        expect(pickTemplateVersion(versions, { lang: ['en'] })).toBeUndefined();
    });

    it('a version in the default page\'s own language is the page for that language', () => {
        const both = { defaultLang: 'fi', languages: ['en', 'fi'] };
        expect(pickTemplateVersion(both, { acceptLanguage: 'en,fi;q=0.5' })).toBe('fi');
        expect(pickTemplateVersion(both, { lang: 'fi' })).toBe('fi');
    });
});

describe('templateAddress and templateAlternates', () => {
    it('the default page is at the root and a version at ?lang', () => {
        expect(templateAddress('https://node.test/', undefined)).toBe('https://node.test/');
        expect(templateAddress('https://node.test', 'en')).toBe('https://node.test/?lang=en');
    });

    it('lists every language once, the default page under its own language, and x-default last', () => {
        expect(templateAlternates('https://node.test', { defaultLang: 'fi', languages: ['en', 'es'] })).toEqual([
            { hreflang: 'en', href: 'https://node.test/?lang=en' },
            { hreflang: 'es', href: 'https://node.test/?lang=es' },
            { hreflang: 'fi', href: 'https://node.test/' },
            { hreflang: 'x-default', href: 'https://node.test/' },
        ]);
    });

    it('a default page that states no language is x-default only, and one language has no alternates', () => {
        expect(templateAlternates('https://node.test', { languages: ['en'] })).toEqual([
            { hreflang: 'en', href: 'https://node.test/?lang=en' },
            { hreflang: 'x-default', href: 'https://node.test/' },
        ]);
        expect(templateAlternates('https://node.test', { defaultLang: 'fi', languages: [] })).toEqual([]);
    });
});
