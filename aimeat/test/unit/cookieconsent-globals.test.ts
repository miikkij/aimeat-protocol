/**
 * @file test/unit/cookieconsent-globals.test.ts
 * @description The served cookie banner library must not overwrite a page's own globals. The
 *   upstream UMD build declares `var e,t` at the top level; loaded as a classic script into an app,
 *   it replaced the app's translation helper `var t` with its own factory, and every later `t('key')`
 *   threw "Cannot create property 'acceptCategory' on string 'key'" (kehitysputki, 2026-10-20).
 *   The file runs here the way a browser runs a classic script: top-level `var` lands on the global.
 * @version-history
 *   v1.0.0 - 2026-10-20 - The library keeps an app's `t` and `e` and still sets CookieConsent.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

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

  it('adds no global but CookieConsent to a page that had none', () => {
    const page = createContext({});
    const before = new Set(runInContext('Object.getOwnPropertyNames(globalThis)', page) as string[]);
    runInContext(readFileSync(LIB, 'utf8'), page, { filename: 'cookieconsent.umd.js' });
    const added = (runInContext('Object.getOwnPropertyNames(globalThis)', page) as string[]).filter((name) => !before.has(name));
    expect(added).toEqual(['CookieConsent']);
  });
});
