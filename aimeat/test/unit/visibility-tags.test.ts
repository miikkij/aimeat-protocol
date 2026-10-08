/**
 * @file test/unit/visibility-tags.test.ts
 * @description The owner's analytics tags on served pages (services/visibility/analytics-tags.ts):
 *   what the snippet loads with the cookie banner off and on, the ids it accepts, where it lands in a
 *   document, and the warning an owner gets without a banner.
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (AI visibility, layer B).
 */
import { describe, it, expect } from 'vitest';
import { ownerTagsSnippet, ownerTagsIntoHtml, visibilitySettingsView, tagsActive } from '../../src/services/visibility/analytics-tags.js';
import type { AimeatConfig } from '../../src/config.js';
import type { VisibilitySettings } from '../../src/models/visibility-schemas.js';

const config = (over: Partial<AimeatConfig> = {}): AimeatConfig => ({
  baseUrl: 'https://place.example', analyticsTagsEnabled: true, aiVisibilityEnabled: true,
  cookieConsentEnabled: false, cookieConsentCategories: ['necessary'], cookieConsentPolicyUrl: null,
  ...over,
} as unknown as AimeatConfig);

const settings = (over: Partial<VisibilitySettings> = {}): VisibilitySettings => ({
  enabled: true, clarityProjectId: null, ga4MeasurementId: null, updatedAt: '', ...over,
});

describe('ownerTagsSnippet', () => {
  it('adds nothing for an owner with no tag, or when the operator switched tags off', () => {
    expect(ownerTagsSnippet(config(), settings())).toBe('');
    expect(ownerTagsSnippet(config({ analyticsTagsEnabled: false }), settings({ clarityProjectId: 'k7x2m9qp1a' }))).toBe('');
  });

  it('without the banner, starts the tags at once; with GPC it loads none', () => {
    const s = ownerTagsSnippet(config(), settings({ clarityProjectId: 'k7x2m9qp1a', ga4MeasurementId: 'G-ABC123XYZ9' }));
    expect(s).toContain('"k7x2m9qp1a"');
    expect(s).toContain('"G-ABC123XYZ9"');
    expect(s).toContain('B=false');
    expect(s).toContain('navigator.globalPrivacyControl===true)return');
    expect(s).toContain("'https://www.clarity.ms/tag/'");
    expect(s).not.toContain('CookieConsent.run');
  });

  it('with the banner, waits for the analytics category and carries the banner with that category', () => {
    const s = ownerTagsSnippet(config({ cookieConsentEnabled: true }), settings({ clarityProjectId: 'k7x2m9qp1a' }));
    expect(s).toContain('B=true');
    expect(s).toContain("acceptedCategory('analytics')");
    expect(s).toContain("clarity('consentv2'");
    expect(s).toContain('https://place.example/cookieconsent.umd.js');
    expect(s).toMatch(/CookieConsent\.run\(.*"analytics"/s);
    // No script element from Clarity in the markup: it is created only after acceptance.
    expect(s).not.toMatch(/<script[^>]+clarity\.ms/);
  });

  it('never writes an id of the wrong shape into a page', () => {
    const s = ownerTagsSnippet(config(), settings({ clarityProjectId: '"></script><script>x' as string, ga4MeasurementId: 'G-ABC123XYZ9' }));
    expect(s).not.toContain('</script><script>x');
    expect(s).toContain('C=""');
  });
});

describe('ownerTagsIntoHtml', () => {
  it('lands before </head>, and keeps one banner when the page already loads it', () => {
    const snippet = ownerTagsSnippet(config({ cookieConsentEnabled: true }), settings({ ga4MeasurementId: 'G-ABC123XYZ9' }));
    const out = ownerTagsIntoHtml('<html><head><title>x</title></head><body></body></html>', snippet);
    expect(out.indexOf('data-aimeat-tags')).toBeLessThan(out.indexOf('</head>'));
    const spa = '<html><head><script src="/cookieconsent.umd.js"></script></head><body></body></html>';
    const twice = ownerTagsIntoHtml(spa, snippet);
    expect(twice.match(/cookieconsent\.umd\.js/g)).toHaveLength(1);
    expect(ownerTagsIntoHtml('<p>no head</p>', snippet).startsWith('<script data-aimeat-tags>')).toBe(true);
    const noHead = ownerTagsIntoHtml('<!DOCTYPE html><html><body><p>x</p></body></html>', snippet);
    expect(noHead.startsWith('<!DOCTYPE html><html><script data-aimeat-tags>')).toBe(true);
    const bare = ownerTagsIntoHtml('<!doctype html><p>x</p>', snippet);
    expect(bare.startsWith('<!doctype html><script data-aimeat-tags>')).toBe(true);
  });
});

describe('visibilitySettingsView', () => {
  it('warns the owner when a tag loads with no banner, and not otherwise', () => {
    const on = settings({ clarityProjectId: 'k7x2m9qp1a' });
    expect(visibilitySettingsView(config(), on).tags_warning).toMatch(/consent/);
    expect(visibilitySettingsView(config({ cookieConsentEnabled: true }), on).tags_warning).toBeNull();
    expect(visibilitySettingsView(config(), settings()).tags_warning).toBeNull();
    expect(tagsActive(config(), on)).toBe(true);
  });
});
