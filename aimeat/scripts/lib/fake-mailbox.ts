/**
 * @file scripts/lib/fake-mailbox.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The sandbox's test mailbox: eighteen messages a mail pipeline meets in a real inbox,
 *   each with the class a person would give it, so a run can be checked against known answers.
 *   Receipts, invoices (one as a digital PDF, one as a scanned PDF whose text is pixels only), an
 *   order, a booking, a job alert, system notices, a security notice, newsletters, ads, a support
 *   request and two personal messages. Dates are counted back from the moment the server starts,
 *   so a "since last week" batch always finds them.
 *
 *   The two PDFs in ./fixtures were rendered with Chromium on 2026-09-29 (a text PDF from an HTML
 *   invoice, and the same kind of invoice screenshotted grey and slightly rotated, wrapped as a JPEG
 *   in a one-page PDF), which is what a billing system and a scanner produce.
 * @structure SAMPLE_MESSAGES · buildMailbox(now) → { messages, attachments }
 * @usage import { buildMailbox } from './fake-mailbox.js';
 * @version-history
 *   v1.0.0 — 2026-09-29 — Initial (wish sandboxiin-testipostilaatikko).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

interface SampleAttachment { file: string; name: string; mime: string }
interface SampleMessage {
  id: string;
  from: string;
  subject: string;
  hoursAgo: number;
  body: string;
  /** The class a person would give it: what a run's answers are checked against. */
  expect: string;
  attachments?: SampleAttachment[];
}

export const MAILBOX_ADDRESS = 'mailbox@sandbox.test';

export const SAMPLE_MESSAGES: SampleMessage[] = [
  { id: 'm01', from: 'Wolt <receipts@wolt.com>', subject: 'Your Wolt receipt', hoursAgo: 5, expect: 'receipt',
    body: 'Thanks for your order from Pho Viet.\nOrder total: 23.40 EUR\nPaid with Visa ending 4421 on 28.9.2026.\nOrder number W-88213-44' },
  { id: 'm02', from: 'Esimerkki Energia <laskutus@esimerkki-energia.fi>', subject: 'Lasku EE-2026-0914', hoursAgo: 20, expect: 'invoice',
    body: 'Hei,\n\nliitteenä syyskuun sähkölasku. Eräpäivä 5.10.2026.\n\nYstävällisin terveisin\nEsimerkki Energia',
    attachments: [{ file: 'invoice-digital.pdf', name: 'lasku-EE-2026-0914.pdf', mime: 'application/pdf' }] },
  { id: 'm03', from: 'Kiinteistöhuolto Mäkinen <toimisto@makinen-huolto.fi>', subject: 'Lasku 2026/117 (skannattu)', hoursAgo: 30, expect: 'invoice',
    body: 'Liitteenä skannattu lasku lumitöistä.',
    attachments: [{ file: 'invoice-scanned.pdf', name: 'skannaus_0117.pdf', mime: 'application/pdf' }] },
  { id: 'm04', from: 'Verkkokauppa.com <noreply@verkkokauppa.com>', subject: 'Tilauksesi 88213 on lähetetty', hoursAgo: 34, expect: 'order',
    body: 'Tilauksesi 88213 on matkalla. Toimitus: Posti SmartPOST, arvioitu perillä 30.9.2026. Tuotteet: USB-C-telakka 1 kpl, 89,90 €.' },
  { id: 'm05', from: 'LinkedIn Job Alerts <jobs-noreply@linkedin.com>', subject: 'Senior Solution Architect at Nordic Bank', hoursAgo: 40, expect: 'job',
    body: 'A new job matches your alert: Senior Solution Architect, Nordic Bank, Helsinki (hybrid). Apply by 15.10.2026. https://example.linkedin.com/jobs/4242' },
  { id: 'm06', from: 'GitHub <notifications@github.com>', subject: '[aimeat] Workflow "CI" succeeded on main', hoursAgo: 44, expect: 'system',
    body: 'The workflow CI completed successfully for commit 36ee06b on main in 14m 02s. https://github.com/example/aimeat/actions/runs/1' },
  { id: 'm07', from: 'npm <support@npmjs.com>', subject: 'Successfully published aimeat@3.19.0', hoursAgo: 50, expect: 'system',
    body: 'Hi! A new version of the package aimeat (3.19.0) was published at 2026-09-27T13:36:34Z.' },
  { id: 'm08', from: 'Google <no-reply@accounts.google.com>', subject: 'Security alert: new sign-in on Windows', hoursAgo: 56, expect: 'system',
    body: 'We noticed a new sign-in to your Google Account on a Windows device. If this was you, you do not need to do anything.' },
  { id: 'm09', from: 'The Sequence <thesequence@substack.com>', subject: 'The Sequence Radar #940: Last Week in AI', hoursAgo: 60, expect: 'newsletter',
    body: 'This week: Opus 5.5 gets leaner, Meta goes wearable, Washington talks to Beijing. Read the full issue online.' },
  { id: 'm10', from: 'Kauppalehti <uutiskirje@kauppalehti.fi>', subject: 'Aamun tärkeimmät uutiset', hoursAgo: 70, expect: 'newsletter',
    body: 'Hyvää huomenta! Tänään: korot, pörssi ja viikon tärkeimmät yritysuutiset. Peruuta tilaus tästä.' },
  { id: 'm11', from: 'Stockmann <uutiset@stockmann.com>', subject: 'Syksyn ale alkaa: jopa -50 %', hoursAgo: 80, expect: 'newsletter',
    body: 'Syksyn ale alkaa huomenna. Jopa -50 % valituista tuotteista. Tervetuloa ostoksille!' },
  { id: 'm12', from: 'Matti Virtanen <matti.virtanen@example.com>', subject: 'Lounas perjantaina?', hoursAgo: 90, expect: 'personal',
    body: 'Moi! Ehtisitkö lounaalle perjantaina klo 11.30? Sama paikka kuin viimeksi.\n\n-Matti' },
  { id: 'm13', from: 'Asiakas Oy <tuki@asiakas.fi>', subject: 'En pääse kirjautumaan palveluun', hoursAgo: 100, expect: 'support',
    body: 'Hei, en pääse kirjautumaan tililleni. Salasanan palautus ei lähetä viestiä. Asiakasnumero 55821. Voitteko auttaa?' },
  { id: 'm14', from: 'Hotel Kämp <reservations@hotelkamp.fi>', subject: 'Varausvahvistus 12.–14.10.2026', hoursAgo: 110, expect: 'booking',
    body: 'Varauksenne on vahvistettu. Saapuminen 12.10.2026, lähtö 14.10.2026. Huone: Superior King. Varausnumero HK-77120. Hinta yhteensä 612,00 €.' },
  { id: 'm15', from: 'Apple <no_reply@email.apple.com>', subject: 'Your receipt from Apple', hoursAgo: 120, expect: 'receipt',
    body: 'iCloud+ 200 GB, monthly. Billed 2.99 EUR on 24.9.2026 to Visa 4421. Order ID MT8Q2X9L.' },
  { id: 'm16', from: 'Laskutus Pilvipalvelu <billing@pilvipalvelu.example>', subject: 'Invoice INV-4431 due 15.10.2026', hoursAgo: 130, expect: 'invoice',
    body: 'Invoice INV-4431\nAmount due: 149.00 EUR (VAT 25.5 % included)\nDue date: 15.10.2026\nReference: 4431 0000 2211' },
  { id: 'm17', from: 'Disney+ <disneyplus@mail.disneyplus.com>', subject: 'Receipt for your payment to DisneyPlus', hoursAgo: 150, expect: 'receipt',
    body: 'Thanks for your payment. Disney+ Standard, 9.99 EUR, charged on 22.9.2026. Transaction 51B2-9C.' },
  { id: 'm18', from: 'Liisa Korhonen <liisa@example.com>', subject: 'Kuvat viikonlopulta', hoursAgo: 170, expect: 'personal',
    body: 'Hei! Tässä vielä muutama kuva mökkiviikonlopulta. Kiitos kun tulitte!' },
];

/** RFC 4648 base64url, which is what Gmail puts in every `data` field. */
function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface MailboxMessage { id: string; internalDate: number; json: Record<string, unknown> }

/** The mailbox as the server answers it: Gmail message resources, newest first, and the attachment bytes by id. */
export function buildMailbox(now: number): { messages: MailboxMessage[]; attachments: Map<string, Buffer> } {
  const attachments = new Map<string, Buffer>();
  const messages = SAMPLE_MESSAGES.map((m) => {
    const internalDate = now - m.hoursAgo * 3600_000;
    const date = new Date(internalDate).toUTCString();
    const text = Buffer.from(m.body, 'utf8');
    const parts: Record<string, unknown>[] = [{ partId: '0', mimeType: 'text/plain', filename: '', body: { size: text.length, data: b64url(text) } }];
    (m.attachments || []).forEach((a, i) => {
      const bytes = readFileSync(join(FIXTURES, a.file));
      const attachmentId = `att-${m.id}-${i}`;
      attachments.set(attachmentId, bytes);
      parts.push({ partId: String(i + 1), mimeType: a.mime, filename: a.name, body: { attachmentId, size: bytes.length } });
    });
    return {
      id: m.id,
      internalDate,
      json: {
        id: m.id, threadId: m.id, labelIds: ['INBOX'], snippet: m.body.slice(0, 120), internalDate: String(internalDate),
        sizeEstimate: text.length,
        payload: {
          mimeType: parts.length > 1 ? 'multipart/mixed' : 'text/plain',
          headers: [
            { name: 'From', value: m.from }, { name: 'To', value: MAILBOX_ADDRESS },
            { name: 'Subject', value: m.subject }, { name: 'Date', value: date },
          ],
          body: { size: 0 },
          parts,
        },
      },
    };
  }).sort((a, b) => b.internalDate - a.internalDate);
  return { messages, attachments };
}
