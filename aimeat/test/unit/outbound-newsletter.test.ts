/**
 * @file test/unit/outbound-newsletter.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A campaign email that can carry a newsletter: the closed body vocabulary (two heading
 *   levels, bullets, bold, https links, a rule), the lead image, the sender footer read from the
 *   owner's `outbound.sender` record, the List-Unsubscribe headers, and the MCP tool path that puts
 *   them on the wire.
 *
 *   THE PROPERTY THAT MATTERS MOST: the body is still text the caller wrote, landing in somebody
 *   else's inbox in the owner's name. Every block the vocabulary adds is built by the server from
 *   escaped text; a tag, an event handler, a `javascript:` or `data:` address and a plain http link
 *   all come out as inert text.
 * @usage cd aimeat && pnpm exec vitest run test/unit/outbound-newsletter.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { renderCampaignEmail, listUnsubscribeHeaders } from '../../src/services/outbound/campaign-email.js';
import { parseCampaignBody, safeHttpsUrl } from '../../src/services/outbound/campaign-markup.js';
import { validateSender, senderKey } from '../../src/services/outbound/sender-identity.js';
import { BUILT_IN_THEMES } from '../../src/services/outbound/email-theme.js';
import { graphMessageHeaders } from '../../src/services/connections/send-mail.js';
import { registerConnectionTools } from '../../src/mcp/connections.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { setActiveEmailService, type EmailService } from '../../src/services/email.js';
import { ensureContact } from '../../src/services/outbound/outbound-service.js';

const theme = BUILT_IN_THEMES.clean!;
const UNSUB = 'https://node.test/v1/outbound/unsubscribe?token=T0KEN';
const base = { subject: 'Uutiskirje', unsubscribeUrl: UNSUB, theme, kind: 'marketing' as const };

const NEWSLETTER = [
  '## Mitä uutta',
  'Tämä on **tärkeä** kappale, jossa on [linkki](https://aimeat.io/uutiset?a=1&b=2).',
  '',
  '- ensimmäinen',
  '- toinen [lue](https://aimeat.io/x)',
  '',
  '---',
  '',
  '### Lopuksi',
  'Rivi yksi',
  'rivi kaksi',
].join('\n');

describe('the body vocabulary', () => {
  it('reads headings, a list, a rule and paragraphs as blocks', () => {
    expect(parseCampaignBody(NEWSLETTER).map(b => b.kind)).toEqual(['h2', 'p', 'ul', 'hr', 'h3', 'p']);
  });

  it('renders each block as its own inline-styled element', () => {
    const { html } = renderCampaignEmail({ ...base, body: NEWSLETTER });
    expect(html).toMatch(/<h2 style="[^"]+">Mitä uutta<\/h2>/);
    expect(html).toMatch(/<h3 style="[^"]+">Lopuksi<\/h3>/);
    expect(html).toMatch(/<strong style="[^"]+">tärkeä<\/strong>/);
    expect(html).toContain('href="https://aimeat.io/uutiset?a=1&amp;b=2"');
    expect(html).toMatch(/<a href="https:\/\/aimeat\.io\/x" style="[^"]+">lue<\/a>/);
    expect((html.match(/<li /g) ?? []).length).toBe(2);
    expect(html).toContain('Rivi yksi<br>rivi kaksi');
    expect(html).not.toContain('## ');
    expect(html).not.toContain('**');
  });

  it('keeps a body without markup exactly as paragraphs', () => {
    const { html } = renderCampaignEmail({ ...base, body: 'Eka.\n\nToka\nrivi.' });
    expect((html.match(/<p style=/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('>Eka.</p>');
    expect(html).toContain('>Toka<br>rivi.</p>');
    expect(html).not.toContain('<h2');
    expect(html).not.toContain('<ul');
  });

  it('gives the plain-text part the same structure, readably', () => {
    const { text } = renderCampaignEmail({ ...base, body: NEWSLETTER });
    expect(text).toContain('Mitä uutta\n==========');
    expect(text).toContain('Lopuksi\n-------');
    expect(text).toContain('*tärkeä*');
    expect(text).toContain('linkki (https://aimeat.io/uutiset?a=1&b=2)');
    expect(text).toContain('• ensimmäinen');
    expect(text).toContain('• toinen lue (https://aimeat.io/x)');
    expect(text).toContain('Rivi yksi\nrivi kaksi');
    expect(text).not.toContain('## ');
  });

  it('accepts only an https address with no credentials in it', () => {
    expect(safeHttpsUrl('https://aimeat.io/a?b=1')).toBe('https://aimeat.io/a?b=1');
    for (const bad of ['http://aimeat.io/', 'javascript:alert(1)', 'data:text/html,x', 'https://user:pw@aimeat.io/', '//aimeat.io', '', 7, null]) {
      expect(safeHttpsUrl(bad)).toBeNull();
    }
  });
});

describe('nothing a caller writes becomes markup', () => {
  const attacks: Array<[string, string]> = [
    ['a script tag', '<script>alert(1)</script>'],
    ['an image with onerror', '<img src=x onerror=alert(1)>'],
    ['a javascript: link', '[klikkaa](javascript:alert(1))'],
    ['a data: link', '[klikkaa](data:text/html;base64,PHNjcmlwdD4=)'],
    ['a plain http link', '[http](http://plain.example/)'],
    ['a quote that tries to leave the href', '[q](https://evil.example/"onmouseover="x)'],
    ['a tag inside a heading', '## <b onclick=x>otsikko</b>'],
    ['a tag inside bold inside a bullet', '- **<svg onload=alert(1)>**'],
  ];
  for (const [name, body] of attacks) {
    it(`renders ${name} as inert text`, () => {
      const { html } = renderCampaignEmail({ ...base, body });
      expect(html).not.toMatch(/<script|<img src=x|<svg|<b onclick/i);
      expect(html).not.toMatch(/href="(javascript|data|http):/i);
      // An event handler only acts as an attribute of a real tag; as escaped text it is inert.
      expect(html).not.toMatch(/<[a-z][^>]*\son(error|load|click|mouseover)=/i);
    });
  }

  it('shows the escaped text rather than dropping it', () => {
    const { html } = renderCampaignEmail({ ...base, body: '<img src=x onerror=alert(1)>' });
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('the lead image', () => {
  it('fills the card width and carries its alt text', () => {
    const { html } = renderCampaignEmail({ ...base, body: 'Teksti.', image: { url: 'https://cdn.example/kansi.png', alt: 'Kansikuva "syksy"' } });
    expect(html).toMatch(/<img src="https:\/\/cdn\.example\/kansi\.png" alt="Kansikuva &quot;syksy&quot;" width="578"[^>]*width:100%/);
  });

  it('is left out when its address is not https or it has no alt text', () => {
    for (const image of [{ url: 'data:image/png;base64,AAAA', alt: 'x' }, { url: 'http://cdn.example/a.png', alt: 'x' }, { url: 'https://cdn.example/a.png', alt: '  ' }]) {
      const { html } = renderCampaignEmail({ ...base, body: 'Teksti.', image });
      expect(html).not.toContain('a.png');
      expect(html).not.toContain('data:image');
    }
  });
});

const SENDER_RECORD = {
  legal_name: 'Miikki Oy',
  business_id: '1234567-8',
  address: 'Katu 1, 00100 Helsinki',
  privacy_url: 'https://aimeat.io/tietosuoja',
  reason: { fi: 'Saat tämän, koska tilasit uutiskirjeen.', en: 'You get this because you subscribed.' },
};

describe('the sender footer', () => {
  const sender = validateSender(SENDER_RECORD).sender!;

  it('is under the card on a marketing message, in Finnish by default', () => {
    const { html, text } = renderCampaignEmail({ ...base, body: 'Hei.', sender });
    // Under the card: after the message text and after the card's closing cell.
    const footerAt = html.indexOf('Miikki Oy');
    expect(footerAt).toBeGreaterThan(html.indexOf('>Hei.</p>'));
    expect(html.indexOf('<!-- card end -->')).toBeGreaterThan(0);
    expect(footerAt).toBeGreaterThan(html.indexOf('<!-- card end -->'));
    expect(html).toContain('Y-tunnus 1234567-8');
    expect(html).toContain('Katu 1, 00100 Helsinki');
    expect(html).toContain('Saat tämän, koska tilasit uutiskirjeen.');
    expect(html).toMatch(/<a href="https:\/\/aimeat\.io\/tietosuoja" style="[^"]+">Tietosuojaseloste<\/a>/);
    expect(html).toMatch(/<a href="https:\/\/node\.test\/v1\/outbound\/unsubscribe\?token=T0KEN" style="[^"]+">Peru tilaus<\/a>/);
    // One unsubscribe link, in the footer, not a second one inside the card.
    expect(html.split(UNSUB).length - 1).toBe(1);
    expect(text).toContain('Saat tämän, koska tilasit uutiskirjeen.');
    expect(text).toContain(`Peru tilaus: ${UNSUB}`);
    expect(text).toContain('Tietosuojaseloste: https://aimeat.io/tietosuoja');
    expect(text).toContain('Miikki Oy, Y-tunnus 1234567-8');
  });

  it('speaks English and Spanish when the send asks, falling back to the English reason', () => {
    const en = renderCampaignEmail({ ...base, body: 'Hi.', sender, locale: 'en' }).html;
    expect(en).toContain('Business ID 1234567-8');
    expect(en).toContain('>Privacy notice</a>');
    expect(en).toContain('>Unsubscribe</a>');
    expect(en).toContain('You get this because you subscribed.');
    const es = renderCampaignEmail({ ...base, body: 'Hola.', sender, locale: 'es' }).html;
    expect(es).toContain('Identificación fiscal 1234567-8');
    expect(es).toContain('>Aviso de privacidad</a>');
    expect(es).toContain('>Darse de baja</a>');
    expect(es).toContain('You get this because you subscribed.');
  });

  it('escapes every field the owner wrote', () => {
    const evil = validateSender({ ...SENDER_RECORD, legal_name: '<b>X</b> Oy', address: '"><script>x</script>' }).sender!;
    const { html } = renderCampaignEmail({ ...base, body: 'Hei.', sender: evil });
    expect(html).toContain('&lt;b&gt;X&lt;/b&gt; Oy');
    expect(html).not.toContain('<script>x');
  });

  it('is absent without a record, and the message is what it was before', () => {
    const { html, text } = renderCampaignEmail({ ...base, body: 'Hei.' });
    expect(html).not.toContain('Y-tunnus');
    expect(html).toContain('Et halua näitä viestejä?');
    expect(html).toContain(UNSUB);
    expect(text).toContain(`--\nPeru tilaus: ${UNSUB}`);
  });

  it('stays off a transactional message unless the record asks for it, and then without reason or unsubscribe', () => {
    const off = renderCampaignEmail({ ...base, kind: 'transactional', body: 'Kuitti.', sender }).html;
    expect(off).not.toContain('Miikki Oy');
    const withIt = validateSender({ ...SENDER_RECORD, transactional: true }).sender!;
    const on = renderCampaignEmail({ ...base, kind: 'transactional', body: 'Kuitti.', sender: withIt });
    expect(on.html).toContain('Miikki Oy');
    expect(on.html).toContain('>Tietosuojaseloste</a>');
    expect(on.html).not.toContain('Saat tämän');
    expect(on.html).not.toContain(UNSUB);
    expect(on.text).toContain('Miikki Oy');
    expect(on.text).not.toContain(UNSUB);
  });
});

describe('the outbound.sender record', () => {
  it('lives at outbound.sender, or outbound.sender.<company id> for a company', () => {
    expect(senderKey()).toBe('outbound.sender');
    expect(senderKey('c-123')).toBe('outbound.sender.c-123');
  });

  it('needs a legal name, and says so', () => {
    const { sender, problems } = validateSender({ business_id: '1' });
    expect(sender).toBeNull();
    expect(problems.map(p => p.field)).toContain('legal_name');
  });

  it('drops a privacy address that is not https, and reports it', () => {
    const { sender, problems } = validateSender({ ...SENDER_RECORD, privacy_url: 'javascript:alert(1)' });
    expect(sender!.privacyUrl).toBeUndefined();
    expect(problems.map(p => p.field)).toEqual(['privacy_url']);
  });

  it('caps lengths and turns control characters into spaces', () => {
    const { sender, problems } = validateSender({ legal_name: `A\u0000B\nC${'x'.repeat(300)}` });
    expect(sender!.legalName.startsWith('A B C')).toBe(true);
    expect(sender!.legalName.length).toBe(140);
    expect(problems.map(p => p.field)).toEqual(['legal_name']);
  });

  it("takes a company's own identity where the record leaves it out", () => {
    const { sender } = validateSender({ privacy_url: 'https://yhtio.example/tietosuoja' }, {
      legalName: 'Yhtiö Oy', businessId: '7654321-0', address: 'Tie 2, 33100 Tampere',
    });
    expect(sender).toMatchObject({ legalName: 'Yhtiö Oy', businessId: '7654321-0', address: 'Tie 2, 33100 Tampere', privacyUrl: 'https://yhtio.example/tietosuoja' });
  });
});

describe('List-Unsubscribe headers', () => {
  it('name the https address and the one-click post (RFC 2369, RFC 8058)', () => {
    expect(listUnsubscribeHeaders(UNSUB)).toEqual({
      'List-Unsubscribe': `<${UNSUB}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });

  it('are left off a Microsoft Graph send, which accepts only x- headers', () => {
    const out = graphMessageHeaders({ ...listUnsubscribeHeaders(UNSUB), 'X-AI-Disclosure': 'ai-generated' });
    expect(out).toEqual([{ name: 'X-AI-Disclosure', value: 'ai-generated' }]);
  });
});

describe('aimeat_mail_send puts the newsletter on the wire', () => {
  type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
  const OWNER = 'alice@test-node';
  const PRINCIPAL = 'claude#alice@test-node';
  let storage: Storage;
  let send: Handler;
  let contactId: string;
  let sent: Array<{ html: string; text: string; headers: Record<string, string> }>;

  beforeEach(async () => {
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    const handlers = new Map<string, Handler>();
    const mcp = { tool: (name: string, ...rest: unknown[]) => { handlers.set(name, rest[rest.length - 1] as Handler); } } as unknown as McpServer;
    const config = { nodeId: 'test-node', baseUrl: 'https://node.test', outboundDailyLimit: 50, connectionsEnabled: true } as unknown as AimeatConfig;
    registerConnectionTools(mcp, storage, config, () => PRINCIPAL, ['outbound:send', 'connections:use']);
    send = handlers.get('aimeat_mail_send')!;
    contactId = (await ensureContact(storage, OWNER, { name: 'Tilaaja', email: 'tilaaja@example.com' })).id;
    sent = [];
    setActiveEmailService({
      enabled: true,
      sendWithAttachments: async (_to: string, _s: string, html: string, text: string, _a: unknown, opts?: { headers?: Record<string, string> }) => {
        sent.push({ html, text, headers: opts?.headers ?? {} });
        return true;
      },
    } as unknown as EmailService);
  });

  const writeSender = async (value: unknown): Promise<void> => {
    const now = new Date().toISOString();
    await storage.setMemory({ key: 'outbound.sender', ownerGaii: OWNER, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now } as never);
  };

  it('a marketing send carries both List-Unsubscribe headers, the footer, the image and the language', async () => {
    await writeSender(SENDER_RECORD);
    const out = await send({
      contact_id: contactId, subject: 'Uutiskirje', body: NEWSLETTER, kind: 'marketing', locale: 'en',
      image_url: 'https://cdn.example/kansi.png', image_alt: 'Cover',
    });
    expect(out.isError ?? false, out.content[0].text).toBe(false);
    expect(sent).toHaveLength(1);
    const [mail] = sent;
    expect(mail.headers['List-Unsubscribe']).toMatch(/^<https:\/\/node\.test\/v1\/outbound\/unsubscribe\?token=[\w-]+>$/);
    expect(mail.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(mail.html).toContain('Business ID 1234567-8');
    expect(mail.html).toContain('<h2 ');
    expect(mail.html).toContain('alt="Cover"');
    expect(mail.text).toContain('Privacy notice: https://aimeat.io/tietosuoja');
  });

  it('a transactional send carries no List-Unsubscribe header and no footer by default', async () => {
    await writeSender(SENDER_RECORD);
    await send({ contact_id: contactId, subject: 'Kuitti', body: 'Kiitos.' });
    expect(sent[0].headers['List-Unsubscribe']).toBeUndefined();
    expect(sent[0].html).not.toContain('Miikki Oy');
  });

  it('an image without alt text is refused before anything is sent', async () => {
    const out = await send({ contact_id: contactId, subject: 'S', body: 'B', kind: 'marketing', image_url: 'https://cdn.example/a.png' });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('INVALID_IMAGE');
    expect(sent).toHaveLength(0);
  });
});
