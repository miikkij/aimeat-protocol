/**
 * @file test/unit/visibility-privacy-notice.test.ts
 * @description The privacy policy's paragraph about account holders' own analytics
 *   (services/visibility/privacy-notice.ts) is written only while one of them uses a service, names
 *   only the services in use, and the node learns which are in use from the settings records
 *   (services/visibility/visibility-settings.ts tagsInUseOnNode).
 * @usage pnpm test -- visibility-privacy-notice
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { ownerAnalyticsNotice } from '../../src/services/visibility/privacy-notice.js';
import {
  setVisibilitySettings, refreshTagsInUse, tagsInUseOnNode, resetVisibilitySettingsCache,
} from '../../src/services/visibility/visibility-settings.js';

describe('ownerAnalyticsNotice', () => {
  it('writes nothing while no account holder uses an analytics service', () => {
    expect(ownerAnalyticsNotice('en', 'aimeat.io', { clarity: false, ga4: false })).toBe('');
    expect(ownerAnalyticsNotice('fi', 'aimeat.io', { clarity: false, ga4: false })).toBe('');
  });

  it('names Clarity, says it records the visit and that the data goes to Microsoft', () => {
    const p = ownerAnalyticsNotice('en', 'aimeat.io', { clarity: true, ga4: false });
    expect(p.startsWith('<p><strong>Apps and pages that account holders publish.</strong>')).toBe(true);
    expect(p).toContain('At least one account holder uses Microsoft Clarity now.');
    expect(p).toContain('records how you use the page');
    expect(p).toContain('own account at Microsoft, and that account holder is responsible for it');
    expect(p).toContain('only after you accept analytics on that page');
    expect(p).not.toContain('Google');
  });

  it('with Google Analytics alone says nothing about a recording', () => {
    const p = ownerAnalyticsNotice('en', 'aimeat.io', { clarity: false, ga4: true });
    expect(p).toContain('uses Google Analytics now');
    expect(p).not.toMatch(/Clarity|records how/);
  });

  it('is in Finnish on the Finnish page, and escapes the node name', () => {
    const p = ownerAnalyticsNotice('fi', 'a<b>.io', { clarity: true, ga4: true });
    expect(p).toContain('Microsoft Clarity ja Google Analytics');
    expect(p).toContain('Tiedot menevät Microsoftille ja Googlelle');
    expect(p).toContain('a&lt;b&gt;.io');
  });
});

describe('tagsInUseOnNode', () => {
  let storage: SqliteStorage;
  beforeEach(async () => {
    resetVisibilitySettingsCache();
    storage = new SqliteStorage(':memory:');
    await storage.init?.();
  });

  it('is false on a node where nobody set a tag, true once one owner does, false again when it is removed', async () => {
    expect(await refreshTagsInUse(storage)).toEqual({ clarity: false, ga4: false });
    await setVisibilitySettings(storage, 'alice@node-1', { enabled: true });
    expect(await refreshTagsInUse(storage)).toEqual({ clarity: false, ga4: false });
    await setVisibilitySettings(storage, 'bob@node-1', { clarityProjectId: 'k7x2m9qp1a' });
    expect(await refreshTagsInUse(storage)).toEqual({ clarity: true, ga4: false });
    expect(tagsInUseOnNode()).toEqual({ clarity: true, ga4: false });
    await setVisibilitySettings(storage, 'alice@node-1', { ga4MeasurementId: 'G-ABC123XYZ9' });
    expect(await refreshTagsInUse(storage)).toEqual({ clarity: true, ga4: true });
    await setVisibilitySettings(storage, 'bob@node-1', { clarityProjectId: null });
    await setVisibilitySettings(storage, 'alice@node-1', { ga4MeasurementId: null });
    expect(await refreshTagsInUse(storage)).toEqual({ clarity: false, ga4: false });
  });
});
