/**
 * @file test/unit/app-language-default.test.ts
 * @description A NEW app in one language is named at publish, because two languages is the default
 *   on this node and one is the owner's decision. An update of an app that already exists says
 *   nothing, and neither does an app that declares no languages at all: the artifact lint already
 *   owns that case (app-meta-declarations), and two hints about one line teach people to skip both.
 * @usage cd aimeat && pnpm vitest run test/unit/app-language-default.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { oneLanguageFindings } from '../../src/services/app-language-default.js';

const head = (locales: string | null) => `<html><head>${locales === null ? '' : `<meta name="aimeat-locales" content="${locales}" />`}</head><body></body></html>`;

describe('a new app in one language', () => {
  it('is named, with the default and whose decision it is', () => {
    const f = oneLanguageFindings({ isUpdate: false, html: head('fi') });
    expect(f.map(x => x.pitfall)).toEqual(['one-language']);
    expect(f[0].severity).toBe('warn');
    expect(f[0].message).toMatch(/en fi/);
    expect(f[0].message).toMatch(/owner/i);
  });
  it('whichever the one language is', () => {
    expect(oneLanguageFindings({ isUpdate: false, html: head('en') })).toHaveLength(1);
  });
});

describe('what stays quiet', () => {
  it('two languages, in either order and with extra spaces', () => {
    expect(oneLanguageFindings({ isUpdate: false, html: head('en fi') })).toEqual([]);
    expect(oneLanguageFindings({ isUpdate: false, html: head(' fi   en ') })).toEqual([]);
  });
  it('no declaration at all: app-meta-declarations owns that', () => {
    expect(oneLanguageFindings({ isUpdate: false, html: head(null) })).toEqual([]);
  });
  it('an update of an existing app', () => {
    expect(oneLanguageFindings({ isUpdate: true, html: head('fi') })).toEqual([]);
  });
});
