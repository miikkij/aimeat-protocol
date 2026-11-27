/**
 * @file notice-missing-vars.test.ts
 * @description A notice template never shows a brace. A notice stored before its template gained a
 *   variable (an operator service's notice from before `{private_read}`, `{help}`, `{off}` and
 *   `{contact}`) is said with the places it does not carry left empty, on the page
 *   (public/js/services/notifications.js bodyOf and titleOf) and in the server's stored copy
 *   (src/services/notifications/recipient-words.ts fillNotifTemplate).
 * @usage pnpm exec vitest run test/unit/notice-missing-vars.test.ts
 * @version-history
 *   2026-11-27 — Initial: an older stored service notice showed its raw placeholders.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const locales: Record<string, Record<string, string>> = {
  en: JSON.parse(readFileSync(new URL('../../locales/en.json', import.meta.url), 'utf8')),
  fi: JSON.parse(readFileSync(new URL('../../locales/fi.json', import.meta.url), 'utf8')),
};
let lang = 'en';
vi.mock('/js/api.js', () => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('/js/i18n.js', () => ({
  t: (key: string, vars?: Record<string, unknown>) => {
    let s = locales[lang][key] ?? locales.en[key] ?? key;
    for (const [k, v] of Object.entries(vars ?? {})) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  },
}));

const KEYS = ['operator_service_on', 'operator_service_on_fenced', 'operator_service_required'];

describe('a notice that lacks every optional variable', () => {
  for (const l of ['en', 'fi']) {
    for (const key of KEYS) {
      it(`${key} in ${l}: the page shows no brace, and names whom to ask`, async () => {
        lang = l;
        const { bodyOf, titleOf } = await import('../../public/js/services/notifications.js');
        // Only what the oldest stored notice carried: the service's name.
        const n = { title: 'x', body: 'x', i18n: { key, vars: { service: 'Desk Helper' } } };
        const body = bodyOf(n);
        const title = titleOf(n);
        expect(body).not.toMatch(/[{}]/);
        expect(title).not.toMatch(/[{}]/);
        expect(body).toContain('Desk Helper');
        expect(body).toContain('support@operators');
      });
    }
  }

  it('the server fills a place it has no value for with nothing', async () => {
    const { fillNotifTemplate } = await import('../../src/services/notifications/recipient-words.js');
    for (const key of KEYS) {
      const tpl = locales.fi[`notiftext.${key}.body`];
      expect(tpl).toMatch(/\{\w+\}/);
      const out = fillNotifTemplate(tpl, { service: 'Desk Helper' });
      expect(out).not.toMatch(/[{}]/);
      expect(out).toContain('Desk Helper');
    }
    expect(fillNotifTemplate('a {x} b {y}', { x: 1 })).toBe('a 1 b ');
    expect(fillNotifTemplate('none', undefined)).toBe('none');
  });
});
