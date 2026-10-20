/**
 * @file test/unit/cookieconsent-globals.test.ts
 * @description The served cookie banner library must not overwrite a page's own globals. The
 *   upstream UMD build declares `var e,t` at the top level; loaded as a classic script into an app,
 *   it replaced the app's translation helper `var t` with its own factory, and every later `t('key')`
 *   threw "Cannot create property 'acceptCategory' on string 'key'" (kehitysputki, 2026-10-20).
 *   The file runs here the way a browser runs a classic script: top-level `var` lands on the global.
 * @version-history
 *   v1.1.0 - 2026-10-20 - The file's hash is tied to the revision in its address (one-day cache).
 *   v1.0.0 - 2026-10-20 - The library keeps an app's `t` and `e` and still sets CookieConsent.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { COOKIE_LIB_REV, cookieConsentSnippet } from '../../src/middleware/cookie-consent.js';

const LIB = fileURLToPath(new URL('../../src/static/cookieconsent.umd.js', import.meta.url));

describe('served cookieconsent.umd.js', () => {
  it('leaves the page globals `t` and `e` alone and still exposes window.CookieConsent', () => {
    const page = createContext({});
    // The app's own top-level script, which ran before the banner's async script.
    runInContext("var t = function (key) { return 'text:' + key; }; var e = 'app-e';", page);
    runInContext(readFileSync(LIB, 'utf8'), page, { filename: 'cookieconsent.umd.js' });

    expect(runInContext("t('pStart')", page)).toBe('text:pStart');
    expect(runInContext('e', page)).toBe('app-e');
    expect(runInContext("typeof CookieConsent.run + typeof CookieConsent.showPreferences + typeof CookieConsent.acceptCategory", page))
      .toBe('functionfunctionfunction');
  });

  it('is loaded from an address that changes when the file changes', () => {
    // The file is cached for a day. A browser holding the broken copy got the fix only through a new
    // address. Changed the file? Raise COOKIE_LIB_REV in src/middleware/cookie-consent.ts and record
    // the new hash here under it.
    const REV_HASH: Record<string, string> = {
      '3.1.0-a1': '0ca15b6e7e73efad9f92de58fc5a4c1c604c9549a2423d215451fc7d4e3fdee6',
    };
    const hash = createHash('sha256').update(readFileSync(LIB, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
    expect(REV_HASH[COOKIE_LIB_REV]).toBe(hash);
    const snippet = cookieConsentSnippet({ cookieConsentCategories: ['analytics'], cookieConsentPolicyUrl: null } as never, { assetBase: 'https://node.example' });
    expect(snippet).toContain(`https://node.example/cookieconsent.umd.js?v=${COOKIE_LIB_REV}`);
  });

  it('adds no global but CookieConsent to a page that had none', () => {
    const page = createContext({});
    const before = new Set(runInContext('Object.getOwnPropertyNames(globalThis)', page) as string[]);
    runInContext(readFileSync(LIB, 'utf8'), page, { filename: 'cookieconsent.umd.js' });
    const added = (runInContext('Object.getOwnPropertyNames(globalThis)', page) as string[]).filter((name) => !before.has(name));
    expect(added).toEqual(['CookieConsent']);
  });
});
