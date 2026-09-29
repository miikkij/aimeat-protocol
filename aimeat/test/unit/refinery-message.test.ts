/**
 * @file refinery-message.test.ts
 * @description The refinery's pure half (src/services/refinery/message.ts): a Gmail and an Outlook
 *   message as one record, the redaction of addresses, a learned rule's match, the model's JSON
 *   answer, and the queue a message lands in; and the `refinery` schedule kind's four words.
 * @usage cd aimeat && pnpm vitest run test/unit/refinery-message.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-29 — Initial (wish aimeat-refinery).
 *   v1.0.1 — 2026-09-29 — stripHtml decodes each entity once (CodeQL js/double-escaping, alert 1682).
 */
import { describe, it, expect } from 'vitest';
import {
  parseMessage, listPage, redact, senderDomain, ruleFor, parseJsonAnswer, queueFor, extractionPrompt, stripHtml,
} from '../../src/services/refinery/message.js';
import { classPack } from '../../src/data/refinery-classes.js';
import { checkScheduleGate } from '../../src/services/schedule-gate.js';

const b64url = (s: string) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const GMAIL = {
  id: 'g1', internalDate: String(Date.UTC(2026, 8, 20, 8, 0)),
  payload: {
    mimeType: 'multipart/mixed',
    headers: [{ name: 'Subject', value: 'Lasku 42' }, { name: 'From', value: 'Energia Oy <laskutus@energia.fi>' }],
    parts: [
      { mimeType: 'multipart/alternative', parts: [
        { mimeType: 'text/plain', body: { data: b64url('Eräpäivä 5.10.2026, maksa viitteellä 1234.') } },
        { mimeType: 'text/html', body: { data: b64url('<p>html version</p>') } },
      ] },
      { mimeType: 'image/png', filename: 'logo.png', headers: [{ name: 'Content-ID', value: '<logo>' }], body: { attachmentId: 'a-logo', size: 900 } },
      { mimeType: 'application/pdf', filename: 'lasku.pdf', body: { attachmentId: 'a-pdf', size: 30000 } },
    ],
  },
};

describe('parseMessage', () => {
  it('reads a Gmail message: the plain text, the headers, and the PDF but not the inline logo', () => {
    const m = parseMessage('google-mail', GMAIL);
    expect(m.subject).toBe('Lasku 42');
    expect(m.from).toBe('Energia Oy <laskutus@energia.fi>');
    expect(m.date).toBe('2026-09-20T08:00:00.000Z');
    expect(m.text).toContain('Eräpäivä 5.10.2026');
    expect(m.attachments.map((a) => a.filename)).toEqual(['lasku.pdf']);
  });

  it('falls back to the HTML as text when there is no plain part', () => {
    const only = { id: 'g2', payload: { mimeType: 'text/html', headers: [], body: { data: b64url('<style>x{}</style><p>Total&nbsp;12 &amp; VAT</p>') } } };
    expect(parseMessage('fake-mail', only).text).toBe('Total 12 & VAT');
  });

  it('reads an Outlook message, leaving out an inline attachment', () => {
    const m = parseMessage('microsoft-mail', {
      id: 'o1', receivedDateTime: '2026-09-21T10:00:00Z', subject: 'Receipt',
      from: { emailAddress: { name: 'Shop', address: 'noreply@shop.example' } },
      body: { contentType: 'html', content: '<div>Paid 9.99 EUR</div>' },
      attachments: [
        { id: 'x1', name: 'receipt.pdf', contentType: 'application/pdf', size: 100, isInline: false, '@odata.type': '#microsoft.graph.fileAttachment' },
        { id: 'x2', name: 'sig.png', contentType: 'image/png', size: 10, isInline: true },
      ],
    });
    expect(m.from).toBe('Shop <noreply@shop.example>');
    expect(m.text).toBe('Paid 9.99 EUR');
    expect(m.attachments.map((a) => a.id)).toEqual(['x1']);
  });

  it('pages: Gmail by nextPageToken, Outlook by the skiptoken in nextLink', () => {
    expect(listPage('fake-mail', { messages: [{ id: 'a' }, { id: 'b' }], nextPageToken: '6' })).toEqual({ ids: ['a', 'b'], next: '6' });
    expect(listPage('microsoft-mail', { value: [{ id: 'c' }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/messages?$skiptoken=XYZ' }))
      .toEqual({ ids: ['c'], next: 'XYZ' });
  });
});

describe('redact and senders', () => {
  it('keeps the domain of every address and drops the person', () => {
    const r = redact('Write to anna.virtanen@esimerkki.fi or billing@shop.example.');
    expect(r.text).toBe('Write to [email]@esimerkki.fi or [email]@shop.example.');
    expect(r.n).toBe(2);
    expect(senderDomain('Wolt <Receipts@Wolt.com>')).toBe('wolt.com');
  });

  it('a learned rule matches by address, domain or message id', () => {
    const msg = parseMessage('google-mail', GMAIL);
    expect(ruleFor([{ match: 'domain', value: 'energia.fi', klass: 'invoice' }], msg)?.klass).toBe('invoice');
    expect(ruleFor([{ match: 'from', value: 'laskutus@energia.fi', klass: 'receipt' }], msg)?.klass).toBe('receipt');
    expect(ruleFor([{ match: 'message', value: 'other', klass: 'x' }], msg)).toBeNull();
  });

  it('the extraction prompt carries no address and asks for JSON only', () => {
    const p = extractionPrompt(classPack('invoice')!, parseMessage('google-mail', GMAIL), 'PDF TEXT', 0);
    expect(p).not.toContain('laskutus@energia.fi');
    expect(p).toContain('ONLY a JSON object');
    expect(p).toContain('due_date');
    expect(p).toContain('ATTACHMENT TEXT:\nPDF TEXT');
  });
});

describe('parseJsonAnswer', () => {
  it('takes the object out of a fenced or chatty answer, and nothing else', () => {
    expect(parseJsonAnswer('```json\n{"amount": 12}\n```')).toEqual({ amount: 12 });
    expect(parseJsonAnswer('Here you go: {"a":1} hope it helps')).toEqual({ a: 1 });
    expect(parseJsonAnswer('[1,2]')).toBeNull();
    expect(parseJsonAnswer('no json')).toBeNull();
    expect(parseJsonAnswer('{broken')).toBeNull();
  });
});

describe('queueFor', () => {
  const th = { clear: 0.8, unclear: 0.5 };
  const invoice = classPack('invoice')!;
  const full = { vendor: 'V', amount: 1, currency: 'EUR', due_date: '2026-10-01', _confidence: 0.9 };

  it('clear only when every required field is there and both steps were sure', () => {
    expect(queueFor(invoice, 0.93, full, th)).toBe('selkea');
    expect(queueFor(invoice, 0.93, { ...full, due_date: '' }, th)).toBe('epaselva');
    expect(queueFor(invoice, 0.64, full, th)).toBe('epaselva');
    expect(queueFor(invoice, 0.93, { ...full, _confidence: 0.3 }, th)).toBe('kelvoton');
  });

  it('a class that is not processed is skipped; no class is unusable; no fields is unclear or unusable by certainty', () => {
    expect(queueFor(classPack('newsletter')!, 0.99, null, th)).toBe('ohitettu');
    expect(queueFor(null, 0.99, null, th)).toBe('kelvoton');
    expect(queueFor(invoice, 0.7, null, th)).toBe('epaselva');
    expect(queueFor(invoice, 0.2, null, th)).toBe('kelvoton');
  });

  it('stripHtml keeps line breaks where blocks end', () => {
    expect(stripHtml('<p>a</p><p>b</p>')).toBe('a\n b');
  });

  it('stripHtml decodes each entity once: &amp;lt; is the text &lt;, not <', () => {
    expect(stripHtml('<p>a &amp;lt;b&amp;gt; &amp;amp; c&nbsp;&quot;d&quot; &#39;e&#39; &lt;f&gt;</p>')).toBe('a &lt;b&gt; &amp; c "d" \'e\' <f>');
  });
});

describe('the refinery schedule kind', () => {
  const cron = '0 6 * * *';
  it('needs all four words, and names the ones missing', () => {
    const r = checkScheduleGate({ kind: 'refinery', cron }, { isOwnerSession: false, scopes: ['connections:read-through', 'memory:write'] });
    expect(r?.code).toBe('SCOPE_DENIED');
    expect(r?.message).toContain('"ai:use", "organism:rows"');
    expect(checkScheduleGate({ kind: 'refinery', cron }, { isOwnerSession: false, scopes: ['connections:read-through', 'ai:use', 'organism:rows', 'memory:write'] })).toBeNull();
    expect(checkScheduleGate({ kind: 'refinery', cron }, { isOwnerSession: true, scopes: [] })).toBeNull();
  });

  it('a kind with one word still says it the way it always did', () => {
    const r = checkScheduleGate({ kind: 'ai', cron }, { isOwnerSession: false, scopes: [] });
    expect(r?.message).toBe('Creating a "ai" schedule requires the "ai:use" scope.');
  });
});
