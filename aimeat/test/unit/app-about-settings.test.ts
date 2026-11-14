/**
 * @file test/unit/app-about-settings.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's text about the app as a setting (TARGET-093): `about` and `about_lang` on
 *   PATCH /v1/apps/:filename and aimeat_app_manage settings, validated by one function, and the words
 *   the SEO status counts for an app page.
 * @version-history
 *   v1.0.0 — 2026-11-06 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { parseOwnerSettingsInput, appSettingsState, SETTINGS_PRESENTATION_FIELDS, APP_ABOUT_MAX_CHARS } from '../../src/services/app/settings.js';
import { appOwnWords } from '../../src/services/app/seo.js';
import type { AppRecord, AppSummaryRecord } from '../../src/storage/interface.js';

const parse = (body: Record<string, unknown>) => parseOwnerSettingsInput(body);

describe('parseOwnerSettingsInput: about and about_lang', () => {
  it('are presentation fields, so a presentation rung may write them', () => {
    expect(SETTINGS_PRESENTATION_FIELDS).toContain('about');
    expect(SETTINGS_PRESENTATION_FIELDS).toContain('about_lang');
  });

  it('takes a markdown text and its language', () => {
    const out = parse({ about: '  Line one.\r\n\r\nLine two.  ', about_lang: 'fi' });
    expect(out).toEqual({ settings: { meta: {}, about: { text: 'Line one.\n\nLine two.', lang: 'fi' } } });
  });

  it('reads an empty text as removing it', () => {
    expect(parse({ about: '   ' })).toEqual({ settings: { meta: {}, about: { text: null } } });
  });

  it('refuses a text that is not a string, too long a text and a malformed language', () => {
    expect(parse({ about: 42 })).toMatchObject({ refusal: { code: 'INVALID_INPUT' } });
    expect(parse({ about: 'x'.repeat(APP_ABOUT_MAX_CHARS + 1), about_lang: 'en' })).toMatchObject({ refusal: { code: 'INVALID_INPUT' } });
    expect(parse({ about: 'Text.', about_lang: 'fi" onload="x' })).toMatchObject({ refusal: { code: 'INVALID_INPUT' } });
    expect(parse({ about: 'Text.', about_lang: '' })).toMatchObject({ refusal: { code: 'INVALID_INPUT' } });
  });
});

describe('appSettingsState and appOwnWords', () => {
  const app = (manifest: Record<string, unknown>) =>
    ({ filename: 'a.html', manifest: { name: 'Lift Calc', description: 'Works out a lift.', ...manifest } }) as unknown as AppRecord;

  it('the settings answer carries the text and its language, or null for both', () => {
    expect(appSettingsState(app({ about: { text: 'T', lang: 'en' } }), 'a.html')).toMatchObject({ about: 'T', about_lang: 'en' });
    expect(appSettingsState(app({}), 'a.html')).toMatchObject({ about: null, about_lang: null });
  });

  it('counts the name, the description and the text about the app, not the markdown punctuation', () => {
    // "Lift Calc" and "Works out a lift."
    expect(appOwnWords(app({}) as AppSummaryRecord)).toBe(6);
    // "Use", "one", "two", "three": the link's address is not shown on the page.
    expect(appOwnWords(app({ about: { text: '## Use\n\n- **one** two\n- [three](https://x.example/)', lang: 'en' } }) as AppSummaryRecord))
      .toBe(6 + 4);
  });
});
