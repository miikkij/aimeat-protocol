/**
 * @file outbound-email-theme.test.ts
 * @description Themed campaign email: what a theme may contain, and what the renderer guarantees.
 *
 *   THE PROPERTY THIS FILE EXISTS FOR: a theme is data an OWNER writes, and it lands inside a
 *   `style="..."` attribute in a message that goes to somebody else's inbox. That makes every token
 *   an injection surface. The rule is refuse-and-fall-back, never escape-and-hope, and never fail
 *   the send: a bad shade of grey must not stop a customer hearing from a business.
 *
 *   The renderer's three client-driven rules are pinned here too, because each one was learned from
 *   an email client rather than chosen, and each one is invisible until somebody opens the message
 *   in Outlook and finds a blue underlined link where a button should be.
 * @usage cd aimeat && pnpm exec vitest run test/unit/outbound-email-theme.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-27 — Initial.
 */

import { describe, it, expect } from 'vitest';
import {
  BUILT_IN_THEMES, BUILT_IN_THEME_IDS, DEFAULT_THEME_ID, FONT_NAMES,
  isColor, isThemeId, resolveTheme, validateTheme, fontStack,
} from '../../src/services/outbound/email-theme.js';
import { renderCampaignEmail } from '../../src/services/outbound/campaign-email.js';

const base = { subject: 'Otsikko', body: 'Eka.\n\nToka.', unsubscribeUrl: 'https://n/u/T', theme: BUILT_IN_THEMES.clean! };

describe('a theme is data, and only data gets in', () => {
  it('accepts three- and six-digit hex and nothing else', () => {
    expect(isColor('#fff')).toBe(true);
    expect(isColor('#1a2b3c')).toBe(true);
    for (const bad of ['red', 'rgb(1,2,3)', 'var(--x)', '#12345', '#gggggg', '', null, 7]) {
      expect(isColor(bad)).toBe(false);
    }
  });

  it('refuses a colour that carries a second declaration, and says which field', () => {
    // The whole reason the check is a pattern rather than an escape: this string is harmless as
    // text and is behaviour inside style="".
    const { tokens, problems } = validateTheme({ accent: '#fff;background:url(javascript:alert(1))' });
    expect(tokens.accent).toBe(BUILT_IN_THEMES.clean!.accent);
    expect(problems).toEqual([{ field: 'accent', why: 'not a hex colour like #1a2b3c' }]);
  });

  it('refuses a font outside the four and a radius outside the range', () => {
    const { tokens, problems } = validateTheme({ font: 'Comic Sans', radius: 900 });
    expect(tokens.font).toBe(BUILT_IN_THEMES.clean!.font);
    expect(tokens.radius).toBe(BUILT_IN_THEMES.clean!.radius);
    expect(problems.map(p => p.field).sort()).toEqual(['font', 'radius']);
  });

  it('keeps the good fields of a theme that has one bad one', () => {
    const { tokens, problems } = validateTheme({ card: '#101010', accent: 'nope' });
    expect(tokens.card).toBe('#101010');
    expect(problems).toHaveLength(1);
  });

  it('reports nothing for every built-in', () => {
    for (const id of BUILT_IN_THEME_IDS) {
      expect(validateTheme(BUILT_IN_THEMES[id]).problems).toEqual([]);
    }
  });

  it('never emits a font stack the caller chose', () => {
    for (const name of FONT_NAMES) expect(fontStack(name)).not.toContain('Comic');
    // An unknown name cannot reach here through validateTheme, and if it ever did it resolves.
    expect(fontStack('nope' as never)).toBe(fontStack('system'));
  });

  it('accepts a theme id that is safe in a memory key, and refuses one that is not', () => {
    expect(isThemeId('house-style-2')).toBe(true);
    for (const bad of ['../escape', 'Upper', 'has space', '', 'x'.repeat(41)]) {
      expect(isThemeId(bad)).toBe(false);
    }
  });
});

describe('resolving never fails a send', () => {
  it('falls back to the default for an id nobody has', () => {
    expect(resolveTheme('no-such-theme')).toEqual(BUILT_IN_THEMES[DEFAULT_THEME_ID]);
    expect(resolveTheme(undefined)).toEqual(BUILT_IN_THEMES[DEFAULT_THEME_ID]);
  });

  it("prefers the owner's own over a built-in of the same name", () => {
    const mine = resolveTheme('clean', { card: '#000000' });
    expect(mine.card).toBe('#000000');
  });

  it('is the unchanged look when nothing was asked for', () => {
    // Nobody who never wanted a theme should find one in their customer's inbox.
    expect(DEFAULT_THEME_ID).toBe('clean');
    expect(resolveTheme(undefined).card).toBe('#ffffff');
  });
});

describe('what the renderer guarantees, because email clients do not', () => {
  it("puts the button's colour on the CELL, not only on the anchor", () => {
    // A styled <a> degrades to a blue underlined link in exactly the client that matters most.
    const { html } = renderCampaignEmail({
      ...base, kind: 'marketing', links: [{ label: 'Avaa', url: 'https://example.com' }],
    });
    expect(html).toContain(`bgcolor="${BUILT_IN_THEMES.clean!.accent}"`);
  });

  it('puts a solid colour under every gradient', () => {
    // Outlook ignores background-image. Without the flat colour it paints white behind light text.
    const { html } = renderCampaignEmail({ ...base, kind: 'marketing', theme: BUILT_IN_THEMES.space! });
    const page = BUILT_IN_THEMES.space!.page;
    expect(html).toContain(`bgcolor="${page}"`);
    expect(html).toContain(`background-color:${page}`);
    expect(html.indexOf(`background-color:${page}`)).toBeLessThan(html.indexOf('background-image:linear-gradient'));
  });

  it('escapes what the person wrote', () => {
    const { html } = renderCampaignEmail({ ...base, kind: 'marketing', body: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('drops a link whose scheme is not http(s) rather than escaping it', () => {
    const { html } = renderCampaignEmail({
      ...base, kind: 'marketing',
      links: [{ label: 'x', url: 'javascript:alert(1)' }, { label: 'ok', url: 'https://example.com' }],
    });
    expect(html).not.toContain('javascript:');
    expect(html).toContain('https://example.com');
  });

  it('carries the unsubscribe on marketing and not on transactional', () => {
    expect(renderCampaignEmail({ ...base, kind: 'marketing' }).html).toContain(base.unsubscribeUrl);
    expect(renderCampaignEmail({ ...base, kind: 'transactional' }).html).not.toContain(base.unsubscribeUrl);
  });

  it('says nothing about this node in a message somebody sends to their own customer', () => {
    const { html } = renderCampaignEmail({ ...base, kind: 'marketing', brand: 'Overscale Solutions' });
    expect(html).not.toMatch(/protokollan|Protocol|profiilissasi/i);
    expect(html).toContain('Overscale Solutions');
  });

  it('gives the plain-text twin the links and the unsubscribe', () => {
    const { text } = renderCampaignEmail({
      ...base, kind: 'marketing', links: [{ label: 'Avaa', url: 'https://example.com' }],
    });
    expect(text).toContain('Avaa: https://example.com');
    expect(text).toContain(base.unsubscribeUrl);
    expect(text).not.toContain('<');
  });

  it('hides the tracking pixel and adds none when there is nothing to count', () => {
    const withPixel = renderCampaignEmail({ ...base, kind: 'marketing', trackingUrl: 'https://n/p.gif' });
    expect(withPixel.html).toContain('width="1" height="1"');
    expect(renderCampaignEmail({ ...base, kind: 'marketing' }).html).not.toContain('width="1" height="1"');
  });
});
