/**
 * @file test/unit/email-operator-footer.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's own mail foot (operator.email_footer, 2026-10-27): when set, every mail
 *   the node sends ends with it instead of "Sent by AIMEAT Protocol" and the profile note, in the HTML
 *   (escaped) and in the text part; unset, nothing changes. A shop's buyer has no AIMEAT profile.
 * @usage pnpm exec vitest run test/unit/email-operator-footer.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  setNodeEmailFooter, textNotificationEmailHtml, verificationEmailHtml, magicLinkEmailHtml,
} from '../../src/services/email-templates.js';

afterEach(() => setNodeEmailFooter(() => ''));

describe('the operator\'s own mail foot', () => {
  it('unset: the default foot and the profile note, as before', () => {
    const { html, text } = textNotificationEmailHtml('Hello', 'Body', 'en');
    expect(html).toContain('Sent by AIMEAT Protocol');
    expect(html).toContain('Manage your notification settings');
    expect(text).toContain('-- Sent by AIMEAT Protocol');
  });

  it('set: its own line in the HTML and the text, and no profile note', () => {
    setNodeEmailFooter(() => 'AIMEAT · aimeat.io');
    for (const { html, text } of [textNotificationEmailHtml('Hei', 'Teksti', 'fi'), verificationEmailHtml('123456', 'fi'),
      magicLinkEmailHtml('https://x.example/l', 'fi')]) {
      expect(html).toContain('AIMEAT · aimeat.io');
      expect(html).not.toContain('AIMEAT-protokollan');
      expect(html).not.toContain('AIMEAT-profiilissasi');
      expect(text).toContain('-- AIMEAT · aimeat.io');
    }
  });

  it('is escaped in the HTML and kept to one line', () => {
    setNodeEmailFooter(() => 'Kauppa & Co <b>\nrivi');
    const { html, text } = textNotificationEmailHtml('Hei', 'Teksti', 'fi');
    expect(html).toContain('Kauppa &amp; Co &lt;b&gt;');
    expect(html).not.toContain('<b>');
    expect(text).toContain('-- Kauppa & Co <b> rivi');
  });

  it('a template with its own foot keeps it', async () => {
    setNodeEmailFooter(() => 'AIMEAT · aimeat.io');
    const { outboundEmailHtml } = await import('../../src/services/email-templates.js');
    const { html } = outboundEmailHtml('Otsikko', '<p>x</p>', 'x', 'fi');
    expect(html).not.toContain('AIMEAT · aimeat.io');
  });
});
