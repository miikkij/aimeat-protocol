/**
 * @file src/data/refinery-classes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description THE CLASS PACKS: the kinds of message a refinery sorts mail into, each with the
 *   fields it extracts, ready to take (wish luokkapaketit, 2026-09-29). A refinery definition names
 *   packs by id (`classes: ['receipt', 'invoice', …]`) or carries classes of its own in the same
 *   shape, and the two mix. Served at GET /v1/refinery/classes, so an app, an agent and a person's
 *   own AI all pick from one list instead of writing a receipt's fields again for every app.
 *
 *   A class is written for a MODEL to read: `describe` is one English sentence the classifier
 *   weighs, and each field's `describe` says what to put there. `process: false` files the message
 *   under its class without extracting anything (a newsletter, a personal letter). `type` is the
 *   schema.org type a record of this class is, so a record sent onward says what it is.
 * @structure RefineryField · RefineryClass · CLASS_PACKS · classPack(id)
 * @usage import { CLASS_PACKS, classPack } from '../data/refinery-classes.js';
 * @version-history
 *   v1.0.0 — 2026-09-29 — Initial: receipt, invoice, order, booking, job, system, support,
 *     newsletter, personal (Postinjalostamo's five, generalised, and four more its inbox showed).
 */

export interface RefineryField {
  name: string;
  type: 'string' | 'number' | 'date' | 'boolean';
  required: boolean;
  describe: string;
}

export interface RefineryClass {
  id: string;
  label: { fi: string; en: string; es?: string };
  process: boolean;
  type: string;
  describe: string;
  fields: RefineryField[];
}

const f = (name: string, type: RefineryField['type'], required: boolean, describe: string): RefineryField => ({ name, type, required, describe });

export const CLASS_PACKS: readonly RefineryClass[] = [
  { id: 'receipt', label: { fi: 'Kuitti', en: 'Receipt', es: 'Recibo' }, process: true, type: 'schema:Invoice',
    describe: 'A receipt or payment confirmation: money was already paid for something.',
    fields: [
      f('vendor', 'string', true, 'The company or person that was paid.'),
      f('amount', 'number', true, 'The total paid, as a number without a currency symbol.'),
      f('currency', 'string', true, 'ISO 4217 currency code, e.g. EUR.'),
      f('date', 'date', true, 'The payment date, YYYY-MM-DD.'),
      f('reference', 'string', false, 'Order number, transaction id or receipt number.'),
      f('vat', 'number', false, 'The VAT amount, when stated.'),
    ] },
  { id: 'invoice', label: { fi: 'Lasku', en: 'Invoice', es: 'Factura' }, process: true, type: 'schema:Invoice',
    describe: 'An invoice or bill that asks for a payment still to be made, often with a due date and a reference.',
    fields: [
      f('vendor', 'string', true, 'The company or person that sends the bill.'),
      f('amount', 'number', true, 'The total due, as a number without a currency symbol.'),
      f('currency', 'string', true, 'ISO 4217 currency code, e.g. EUR.'),
      f('invoice_number', 'string', false, 'The invoice number.'),
      f('date', 'date', false, 'The invoice date, YYYY-MM-DD.'),
      f('due_date', 'date', true, 'The due date, YYYY-MM-DD.'),
      f('reference', 'string', false, 'The payment reference (viitenumero, RF reference).'),
      f('iban', 'string', false, 'The account to pay to, when stated.'),
      f('vat', 'number', false, 'The VAT amount, when stated.'),
    ] },
  { id: 'order', label: { fi: 'Tilaus tai toimitus', en: 'Order or delivery', es: 'Pedido o envío' }, process: true, type: 'schema:Order',
    describe: 'An order confirmation or a shipping notice: something was ordered or is on its way.',
    fields: [
      f('merchant', 'string', true, 'The shop.'),
      f('order_number', 'string', true, 'The order number.'),
      f('items', 'string', false, 'What was ordered, in a few words.'),
      f('total', 'number', false, 'The order total, as a number.'),
      f('carrier', 'string', false, 'Who delivers it.'),
      f('expected', 'date', false, 'The expected delivery date, YYYY-MM-DD.'),
    ] },
  { id: 'booking', label: { fi: 'Varaus', en: 'Booking', es: 'Reserva' }, process: true, type: 'schema:Reservation',
    describe: 'A booking or reservation confirmation: a hotel, a trip, a table, a ticket, an appointment.',
    fields: [
      f('provider', 'string', true, 'Who the booking is with.'),
      f('booking_number', 'string', false, 'The booking or confirmation number.'),
      f('start', 'date', true, 'The first day or the date of the event, YYYY-MM-DD.'),
      f('end', 'date', false, 'The last day, YYYY-MM-DD.'),
      f('total', 'number', false, 'The price, as a number.'),
    ] },
  { id: 'job', label: { fi: 'Työpaikka', en: 'Job posting', es: 'Oferta de empleo' }, process: true, type: 'schema:JobPosting',
    describe: 'A job posting, a job alert or a recruitment message offering work.',
    fields: [
      f('employer', 'string', true, 'The hiring organisation.'),
      f('title', 'string', true, 'The job title. When several jobs are listed, the first one.'),
      f('location', 'string', false, 'Where the work is, or remote.'),
      f('deadline', 'date', false, 'The application deadline, YYYY-MM-DD.'),
      f('link', 'string', false, 'The address of the posting.'),
    ] },
  { id: 'system', label: { fi: 'Järjestelmäilmoitus', en: 'System notice', es: 'Aviso del sistema' }, process: true, type: 'schema:Message',
    describe: 'An automated notice from a software system or service: a workflow run, a build, a deploy, a package release, an account or security notice.',
    fields: [
      f('system', 'string', true, 'The system or service that sent it.'),
      f('event', 'string', true, 'What happened, in a few words.'),
      f('status', 'string', true, 'One of: succeeded, failed, warning, info.'),
      f('action_required', 'boolean', true, 'True when the recipient must do something.'),
      f('link', 'string', false, 'The address to read more, when given.'),
    ] },
  { id: 'support', label: { fi: 'Tukipyyntö', en: 'Support request', es: 'Solicitud de soporte' }, process: true, type: 'schema:Question',
    describe: 'A customer or user asking for help with a problem, an account or a product.',
    fields: [
      f('customer', 'string', true, 'Who asks, a name or an organisation.'),
      f('topic', 'string', true, 'What the problem is about, in a few words.'),
      f('customer_number', 'string', false, 'A customer or account number, when given.'),
      f('urgency', 'string', false, 'One of: low, normal, high, as the message reads.'),
    ] },
  { id: 'newsletter', label: { fi: 'Uutiskirje tai mainos', en: 'Newsletter or ad', es: 'Boletín o anuncio' }, process: false, type: 'schema:Message',
    describe: 'A newsletter, marketing or promotional message.', fields: [] },
  { id: 'personal', label: { fi: 'Henkilökohtainen', en: 'Personal', es: 'Personal' }, process: false, type: 'schema:Message',
    describe: 'A personal message written by a person to the recipient.', fields: [] },
];

/** One pack by id, or undefined. */
export function classPack(id: string): RefineryClass | undefined {
  return CLASS_PACKS.find((c) => c.id === id);
}
