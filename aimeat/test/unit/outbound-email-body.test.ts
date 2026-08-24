/**
 * @file test/unit/outbound-email-body.test.ts
 * @description What a caller can and cannot put into a message this node sends in its owner's name.
 *
 *   The interesting half is the refusals. A campaign body is written by an app, and the message it
 *   produces arrives in a stranger's inbox carrying the sender's domain, so a caller that could
 *   smuggle markup through it would be borrowing the sender's reputation to do it. The escaping and
 *   the scheme check are the two things that must not drift, and until this file they were only
 *   reachable through a configured SMTP server, which the test environment does not have — so they
 *   were never measured at all.
 * @usage pnpm test -- outbound-email-body
 * @version-history
 *   v1.0.0 — 2026-08-24 — With the campaign links and the open counter.
 */
import { describe, it, expect } from 'vitest';
import { buildOutboundBody, usableLinks } from '../../src/services/outbound/email-body.js';

const base = { body: 'Hei!', kind: 'marketing' as const, unsubscribeUrl: 'https://node.test/v1/outbound/unsubscribe?token=abc' };

describe('what the caller supplies never becomes markup', () => {
  it('escapes a body that tries to be HTML', () => {
    const { htmlBody } = buildOutboundBody({ ...base, body: '<script>alert(1)</script>' });
    expect(htmlBody).not.toContain('<script>');
    expect(htmlBody).toContain('&lt;script&gt;');
  });

  it('escapes a link LABEL that tries to close the anchor', () => {
    const { htmlBody } = buildOutboundBody({
      ...base,
      links: [{ label: '</a><script>alert(1)</script>', url: 'https://example.test/x' }],
    });
    expect(htmlBody).not.toContain('<script>');
    expect(htmlBody).toContain('href="https://example.test/x"');
  });

  it('escapes a link URL that tries to break out of the attribute', () => {
    const { htmlBody } = buildOutboundBody({
      ...base,
      links: [{ label: 'Click', url: 'https://example.test/"onmouseover="alert(1)' }],
    });
    expect(htmlBody).not.toContain('onmouseover="alert(1)"');
    expect(htmlBody).toContain('&quot;onmouseover=&quot;');
  });

  it('drops a javascript: or data: address instead of escaping it', () => {
    // Escaping is not enough here: an escaped javascript: href still runs in some mail clients.
    const links = usableLinks([
      { label: 'a', url: 'javascript:alert(1)' },
      { label: 'b', url: 'data:text/html,<script>alert(1)</script>' },
      { label: 'c', url: 'HTTPS://example.test/ok' },
    ]);
    expect(links.map((l) => l.label)).toEqual(['c']);
  });

  it('caps the number of buttons', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ label: `l${i}`, url: `https://example.test/${i}` }));
    expect(usableLinks(many)).toHaveLength(10);
  });
});

describe('both halves of the message say the same thing', () => {
  it('spells every address out in the plain-text part', () => {
    const { textBody } = buildOutboundBody({
      ...base, links: [{ label: 'Varaa aika', url: 'https://example.test/book' }],
    });
    expect(textBody).toContain('Varaa aika: https://example.test/book');
  });

  it('carries the unsubscribe line in both halves of a marketing message', () => {
    const { htmlBody, textBody } = buildOutboundBody(base);
    expect(htmlBody).toContain(base.unsubscribeUrl);
    expect(textBody).toContain(base.unsubscribeUrl);
  });

  it('leaves the unsubscribe line off a transactional message', () => {
    // A customer cannot opt out of their own invoice, so offering the link there would be a lie.
    const { htmlBody, textBody } = buildOutboundBody({ ...base, kind: 'invoice' });
    expect(htmlBody).not.toContain('Unsubscribe');
    expect(textBody).not.toContain('Unsubscribe');
  });
});

describe('the open counter', () => {
  it('is absent unless the send asked for one', () => {
    const { htmlBody } = buildOutboundBody(base);
    expect(htmlBody).not.toContain('<img');
  });

  it('is hidden and silent when present', () => {
    const { htmlBody, textBody } = buildOutboundBody({
      ...base, trackingUrl: 'https://node.test/v1/signals/alice/campaign/px.svg?e=open&s=r-1',
    });
    expect(htmlBody).toContain('alt=""');
    expect(htmlBody).toContain('style="display:none"');
    // The text part must not carry it: a plain-text reader would see a bare URL and no explanation.
    expect(textBody).not.toContain('px.svg');
  });
});
