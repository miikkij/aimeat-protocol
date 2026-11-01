/**
 * @file test/unit/email-text-links.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A plain-text notification body (ctx.email) gets a button for a `[Label](https://…)`
 *   line and a link for a bare https line, and every other shape stays escaped text
 *   (services/email-text-links.ts through textNotificationEmailHtml).
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial.
 */
import { describe, expect, it } from 'vitest';
import { textNotificationEmailHtml } from '../../src/services/email-templates.js';

const SIGN_IN = 'https://store.example.com/v1/auth/magic?token=abc&lang=fi';

describe('textNotificationEmailHtml links', () => {
  it('draws a [Label](https://…) line as a button with the host under it, and the text part as Label: URL', () => {
    const { html, text } = textNotificationEmailHtml('Valmis', `Paikkasi on valmis.\n[Kirjaudu sisään](${SIGN_IN})\nTervetuloa.`, 'fi');
    expect(html).toContain('<a href="https://store.example.com/v1/auth/magic?token=abc&amp;lang=fi" class="btn">Kirjaudu sisään</a>');
    expect(html).toContain('>store.example.com</span>');
    expect(html).toContain('<p>Paikkasi on valmis.</p>');
    expect(text).toContain(`Kirjaudu sisään: ${SIGN_IN}`);
    expect(text).not.toContain('](');
  });

  it('links a bare https address alone on a line', () => {
    const { html } = textNotificationEmailHtml('S', `Open:\n${SIGN_IN}`, 'en');
    expect(html).toContain(`<a href="https://store.example.com/v1/auth/magic?token=abc&amp;lang=fi" style="word-break: break-all;">`);
  });

  it('keeps every other shape as escaped text', () => {
    const cases = [
      '[Go](http://example.com/plain)',            // not https
      '[Go](javascript:alert(1))',                 // not a web address
      '[Go](https://example.com/a"onmouseover=x)', // a quote in the address
      '[Go](https://example.com/a b)',             // a space in the address
      'See [Go](https://example.com/) here',       // not alone on its line
      '<b>[Go](https://example.com/)</b>',         // markup around it
      'http://example.com/bare',                   // bare, not https
    ];
    for (const line of cases) {
      const { html } = textNotificationEmailHtml('S', line, 'en');
      expect(html, line).not.toContain('class="btn"');
      expect(html, line).not.toMatch(/<a href="(?!https:\/\/aimeat)/);
      expect(html, line).not.toContain('<b>');
    }
  });

  it('escapes the label', () => {
    const { html } = textNotificationEmailHtml('S', '[<img src=x onerror=1>](https://example.com/)', 'en');
    expect(html).toContain('&lt;img src=x onerror=1&gt;</a>');
    expect(html).not.toContain('<img');
  });
});
