/**
 * @file src/services/outbound/outbound-service.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The outbound door's policy chain — the ONE path through which the node
 *   sends a customer-facing message. Order of the gates, each one structural:
 *
 *   1. recipient is a SAVED contact (id, never a free address) — the anti-spam device
 *   2. suppressed address (3 bounces) rejects everything
 *   3. opt-out rejects marketing; transactional/invoice still deliver (a customer
 *      cannot opt out of their own invoice)
 *   4. per-owner rolling 24 h daily limit (config.outboundDailyLimit)
 *   5. channel selection: a recipient with an AIMEAT identity gets the inbox+push
 *      channel FIRST and email only as fallback; marketing email carries the
 *      unsubscribe link (auto-appended, token-based, no auth needed to opt out)
 *   6. every attempt — sent, failed, suppressed, skipped — lands in the append-only
 *      send log (the GDPR-answerable record)
 *
 *   Invoice sends attach the PDF + Finvoice XML and flip the invoice's deliveryStatus.
 *
 * @structure OutboundError · ensureContact · recordBounce/optOut · sendOutbound
 * @usage const result = await sendOutbound(config, storage, ownerGhii, {...});
 * @version-history
 *   v1.3.0 — 2026-08-23 — Every send log says WHICH COMPANY sent it, and the daily cap counts per
 *     company when one is named (TARGET-072). `company_id` reached the SMTP identity and stopped
 *     there, so an owner with two companies had one sending reputation, one allowance and no way
 *     to answer "what did this company send" — while their invoices carried an organism id all
 *     along. The company is resolved before the FIRST gate, so a refused send is recorded with the
 *     company on it too: the rows saying why something did not go out are the ones an owner reads
 *     when a company's sending looks wrong.
 *   v1.2.0 — 2026-08-17 — TARGET-063. ensureContact stamps `emailHash` (so a person who verifies
 *     this address later can be found) and accepts the address-book fields links/relation. The
 *     identity lookup now calls storage.getGHIIByEmailHash directly instead of going through
 *     services/contacts.ts: the address book has to be able to CREATE a contact, and an edge in
 *     both directions between those two modules is an import cycle.
 *   v1.1.0 — 2026-08-07 — A company's own SMTP sender is resolved BEFORE the email-enabled
 *     guard, so a company that brings its own server is not blocked by the node's being off.
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 2.
 */
import { randomUUID, randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { OutboundContactRecord, OutboundContactLink, OutboundKind, OutboundMessageRecord, OutboundStatus, OutboundChannel } from '../../models/outbound-schemas.js';
import { getActiveEmailService, type EmailAttachment } from '../email.js';
import { inviteEmailHash } from '../invitations.js';
import { sendDirectMessage } from '../message-send.js';
import { emitChange } from '../../services/event-bus.js';
import { renderInvoicePdf } from '../finance/invoice-pdf.js';
import { buildFinvoiceXml } from '../finance/finvoice.js';
import { requireOwnInvoice } from '../finance/invoice-service.js';
import { resolveCompanySender, sendAsCompany } from '../company/company-smtp.js';
import { buildOutboundProviders } from '../connections/providers.js';
import { requireEncryptionKey } from '../connections/credential.js';
import type { ConnectContext } from '../connections/oauth.js';
import {
  resolveMailboxSender, sendThroughMailbox, type MailboxSender,
} from '../connections/send-mail.js';
import { resolveSendingCompany } from './company-sender-access.js';
import { isValidEmail } from '../../utils/email-validator.js';
import { getStream } from '../signals/signal-service.js';
import { renderCampaignEmail } from './campaign-email.js';
import { resolveTheme, isThemeId, themeKey } from './email-theme.js';
import { disclosureHeaders, type AiDisclosure } from './ai-disclosure.js';

export class OutboundError extends Error {
  constructor(public readonly code: string, public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'OutboundError';
  }
}

const SUPPRESS_AFTER_BOUNCES = 3;

export interface ContactInput {
  name: string;
  email: string;
  tags?: string[];
  notes?: string | null;
  /** Address-book only: where else this person is. Ignored by every send path. */
  links?: OutboundContactLink[];
  /** Address-book only: the owner's own word for the relationship. */
  relation?: string | null;
}

/** A contact is a card, not a document. An unbounded field on a row a granted app can write is a
 *  storage hole, so the caps live here rather than in whichever caller happened to think of them. */
const MAX_LINKS = 12;
const MAX_LINK_LABEL = 60;
const MAX_LINK_URL = 500;
const MAX_RELATION = 40;

/** Keep only links that are actually addressable, and cap what a caller can store. */
function normalizeLinks(raw: OutboundContactLink[] | undefined): OutboundContactLink[] {
  if (!Array.isArray(raw)) return [];
  const out: OutboundContactLink[] = [];
  for (const l of raw) {
    if (!l || typeof l.url !== 'string') continue;
    const url = l.url.trim();
    // http(s) only. A contact link is rendered as an anchor on every surface that shows the
    // address book, so javascript: and data: would be an XSS vector on all of them at once.
    if (!/^https?:\/\//i.test(url)) continue;
    out.push({
      label: (typeof l.label === 'string' && l.label.trim() ? l.label.trim() : url).slice(0, MAX_LINK_LABEL),
      url: url.slice(0, MAX_LINK_URL),
    });
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

/** Trim the owner's own word for a relationship, or drop it. */
function normalizeRelation(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  return String(raw).trim().slice(0, MAX_RELATION) || null;
}

/** Creates or returns the owner's contact for an email (one entry per owner per address). */
export async function ensureContact(storage: Storage, ownerGhii: string, input: ContactInput): Promise<OutboundContactRecord> {
  const email = (input.email || '').trim().toLowerCase();
  if (!isValidEmail(email)) throw new OutboundError('INVALID_EMAIL', 400, 'A valid email is required');
  if (!input.name || typeof input.name !== 'string' || input.name.trim().length < 1) {
    throw new OutboundError('INVALID_CONTACT', 400, 'name is required');
  }
  const existing = await storage.findOutboundContactByEmail(ownerGhii, email);
  if (existing) return existing;

  // Does this address belong to a registered AIMEAT identity here? Same privacy-preserving hash
  // the invite flow and /v1/contacts/resolve use, and it is STORED on the row so the reverse
  // question ("has anyone just proven this address") can be asked later without the address
  // itself sitting anywhere that could be scanned.
  const emailHash = inviteEmailHash(email);
  const identity = await storage.getGHIIByEmailHash(emailHash);
  // Only a PROVEN address resolves. An account that merely claimed one must not start receiving
  // another person's mail in its AIMEAT inbox.
  const ghii = identity?.emailVerifiedAt ? identity.ghii : null;

  const now = new Date().toISOString();
  const record: OutboundContactRecord = {
    id: randomUUID(), ownerGhii,
    name: input.name.trim().slice(0, 140), email, emailHash,
    ghii, tags: (input.tags ?? []).slice(0, 20),
    links: normalizeLinks(input.links),
    relation: normalizeRelation(input.relation),
    optedOut: false, optOutAt: null,
    optOutToken: randomBytes(24).toString('base64url'),
    bounceCount: 0, suppressedAt: null,
    notes: input.notes ?? null,
    createdAt: now, updatedAt: now,
  };
  await storage.createOutboundContact(record);
  return record;
}

/**
 * Update the address-book half of a contact: what the OWNER knows about this person.
 *
 * The send half (opt-out, bounce count, suppression) is deliberately unreachable from here. That
 * state belongs to the recipient, not to the owner's note about them, and a card edit that could
 * clear an opt-out would turn "fix a typo in a name" into a way to resume mailing someone who
 * asked you to stop.
 */
export async function updateContactCard(
  storage: Storage, contact: OutboundContactRecord,
  patch: { name?: string; notes?: string | null; tags?: string[]; links?: OutboundContactLink[]; relation?: string | null },
): Promise<OutboundContactRecord> {
  const updated: OutboundContactRecord = {
    ...contact,
    name: patch.name && patch.name.trim() ? patch.name.trim().slice(0, 140) : contact.name,
    notes: patch.notes === undefined ? contact.notes : (patch.notes ?? null),
    tags: patch.tags === undefined ? contact.tags : patch.tags.slice(0, 20),
    links: patch.links === undefined ? contact.links : normalizeLinks(patch.links),
    relation: patch.relation === undefined ? contact.relation : normalizeRelation(patch.relation),
    updatedAt: new Date().toISOString(),
  };
  await storage.updateOutboundContact(updated);
  return updated;
}

/** Owner asserts ownership; absent and not-yours answer identically (404). */
export async function requireOwnContact(storage: Storage, ownerGhii: string, id: string): Promise<OutboundContactRecord> {
  const contact = await storage.getOutboundContact(id);
  if (!contact || contact.ownerGhii !== ownerGhii) throw new OutboundError('NOT_FOUND', 404, 'Contact not found');
  return contact;
}

/** Records a bounce; the third one suppresses the address until the owner clears it. */
export async function recordBounce(storage: Storage, contact: OutboundContactRecord): Promise<OutboundContactRecord> {
  const bounceCount = contact.bounceCount + 1;
  const updated: OutboundContactRecord = {
    ...contact, bounceCount,
    suppressedAt: bounceCount >= SUPPRESS_AFTER_BOUNCES ? new Date().toISOString() : contact.suppressedAt,
    updatedAt: new Date().toISOString(),
  };
  await storage.updateOutboundContact(updated);
  return updated;
}

/** Public token-based opt-out (the unsubscribe link) or owner-side toggle. */
export async function setOptOut(storage: Storage, contact: OutboundContactRecord, optedOut: boolean): Promise<OutboundContactRecord> {
  const updated: OutboundContactRecord = {
    ...contact, optedOut,
    optOutAt: optedOut ? new Date().toISOString() : null,
    updatedAt: new Date().toISOString(),
  };
  await storage.updateOutboundContact(updated);
  return updated;
}

/**
 * The tracking image URL for one send, or null.
 *
 * Two refusals rather than one, and both matter: the sender must NAME a stream (nobody is measured
 * by default) and must OWN it (a stream id is a public string, so trusting the request would let
 * one account write counts into another's campaign report from a message that account never sent).
 */
async function openPixelUrl(
  config: AimeatConfig, storage: Storage, ownerGhii: string, input: SendInput,
): Promise<string | null> {
  if (!input.signalStreamId || !input.signalSubject) return null;
  const stream = await getStream(storage, ownerGhii, input.signalStreamId);
  if (!stream || !stream.enabled) return null;
  const owner = ownerGhii.split('@')[0];
  return `${config.baseUrl}/v1/signals/${encodeURIComponent(owner)}/${encodeURIComponent(stream.streamId)}/px.svg`
    + `?e=open&c=email&s=${encodeURIComponent(input.signalSubject.slice(0, 64))}`;
}

export interface SendInput {
  contactId: string;
  kind: OutboundKind;
  subject?: string;
  /** Message body (plain text; rendered into the standard email layout). */
  body?: string;
  /** Owner memory record id under `outbound.template.` holding { subject, body }. */
  templateId?: string;
  /** {{var}} substitutions applied to the template subject/body. */
  variables?: Record<string, string>;
  /** Attach this invoice (PDF + Finvoice XML) and mark its delivery state. */
  invoiceId?: string;
  /**
   * What the message LOOKS like: a built-in id (clean, space, warm, paper) or one of the owner's
   * own, stored under the memory key `outbound.theme.{id}`. The owner's is preferred where both
   * exist, so a business can name its house style whatever it likes.
   *
   * An id that matches nothing is the default rather than an error. Decoration does not refuse a
   * send — see services/outbound/email-theme.ts.
   */
  theme?: string;
  /** Reply-To for the email channel (the business's own address). */
  replyTo?: string;
  /** Display name on the email From header (envelope address stays the node's). */
  fromName?: string;
  /**
   * Send AS this registered company: when the company has its own SMTP identity the mail
   * leaves through ITS server, from ITS domain. Without one, the node's shared sender is
   * used — a fallback, not a failure.
   */
  companyId?: string;
  /**
   * Send THROUGH this connected mailbox: the message leaves the caller's own Gmail or Outlook, from
   * their own address, and lands in their own Sent Items.
   *
   * IT MUST BE THE CALLER'S OWN CONNECTION, checked against the connection store rather than taken
   * from the request. Sending in somebody else's name is the exact harm this could otherwise cause,
   * and a connection id is guessable enough that "the caller said so" is not an answer.
   *
   * It wins over a company's SMTP and over the node's shared sender. That order is the point: a
   * message a person sends is theirs, and it should look like it in the recipient's inbox and in
   * their own Sent folder.
   */
  connectionId?: string;
  /**
   * Send as this verified alias of that mailbox rather than as its own address.
   *
   * Checked against what the provider says the mailbox may send as, never taken on trust. An
   * unverified From header is a From header the caller chose, and the whole point of sending
   * through somebody's own mailbox is that the address really is theirs.
   */
  fromAlias?: string;
  /**
   * Optionally say, in a header, that a machine wrote this.
   *
   * OPTIONAL BECAUSE NOTHING HERE OBLIGES IT. Article 50(4) covers text published to inform the
   * PUBLIC on matters of PUBLIC INTEREST, and exempts even that when a person has reviewed it and
   * holds editorial responsibility — which is what pressing send is. A sentence added to
   * somebody's sales mail that the law does not ask for is a product decision nobody made.
   *
   * A HEADER BECAUSE THE AUDIENCE IS MACHINES. Nobody reading their inbox follows a link to a
   * hash; the value of the mark is that a filter, an archive or the recipient's own tooling can
   * see it. It goes on ALL THREE send paths, because a disclosure that appeared only when
   * somebody happened to use their own mailbox would make the ones without it look human.
   *
   * A caller that declares it CANNOT then suppress it: there is no parameter for that.
   */
  aiDisclosure?: AiDisclosure;
  /**
   * Buttons the message carries, as DATA rather than as markup.
   *
   * The body is escaped on its way into the layout, deliberately, so a caller cannot put an anchor
   * or an image into a message this node sends in its owner's name. That is the right default and
   * it also made a link impossible, which is what a campaign is mostly made of. So the caller names
   * the label and the address and the SERVER builds the anchor. Only http(s) survives: a
   * `javascript:` or `data:` address in a mail somebody's customer opens is not a link.
   */
  links?: Array<{ label: string; url: string }>;
  /**
   * Count opens of this message into this signal stream, against this opaque recipient token.
   *
   * The stream must already exist and belong to the sender. The token is the SENDER's own: this
   * node stores it and never learns the person behind it, which is what keeps "who opened it"
   * answerable by the sender and by nobody else.
   */
  signalStreamId?: string;
  signalSubject?: string;
}

export interface SendResult {
  log: OutboundMessageRecord;
  channel: OutboundChannel;
  status: OutboundStatus;
}

function substitute(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (m, key: string) => variables[key] ?? m);
}

async function loadTemplate(storage: Storage, ownerGhii: string, templateId: string): Promise<{ subject: string; body: string }> {
  const rec = await storage.getMemory(ownerGhii, `outbound.template.${templateId}`);
  const value = rec?.value as { subject?: unknown; body?: unknown } | undefined;
  if (!value || typeof value.subject !== 'string' || typeof value.body !== 'string') {
    throw new OutboundError('TEMPLATE_NOT_FOUND', 404, `Template "${templateId}" not found (memory key outbound.template.${templateId} with { subject, body })`);
  }
  return { subject: value.subject, body: value.body };
}

/**
 * The owner's OWN theme under this id, or nothing.
 *
 * Looked up BEFORE the built-ins, so a business can call its house style 'clean' and get its own.
 * Unlike loadTemplate this never throws: a template that is missing means the message has no text
 * and there is nothing to send, while a theme that is missing means the message has the default
 * look. One is an empty envelope; the other is a different shade of grey.
 */
async function loadOwnTheme(storage: Storage, ownerGhii: string, id: string | undefined): Promise<unknown> {
  if (!isThemeId(id)) return undefined;
  const rec = await storage.getMemory(ownerGhii, themeKey(id));
  return rec?.value ?? undefined;
}

/** The send. Every outcome is logged; only policy violations throw. */
/**
 * The caller's own mailbox, if they named one, with the context the transport needs.
 *
 * A refusal from here is THROWN rather than logged and swallowed: naming a mailbox you may not use,
 * or one that was connected for reading only, is a mistake in the request, and the caller needs the
 * sentence that names the fix before anything is written.
 */
async function resolveMailbox(
  config: AimeatConfig, storage: Storage, callerGhii: string, connectionId: string, alias?: string,
): Promise<{ sender: MailboxSender; ctx: ConnectContext }> {
  const key = requireEncryptionKey(config);
  if (!key) {
    throw new OutboundError('NO_ENCRYPTION_KEY', 503,
      'This node is not set up to keep secrets safely yet, so it cannot open a connected mailbox. Whoever runs it can switch that on.');
  }
  const ctx: ConnectContext = { config, storage, providers: buildOutboundProviders(config), key };
  const sender = await resolveMailboxSender(ctx, callerGhii, connectionId, alias);
  if ('code' in sender) throw new OutboundError(sender.code, sender.status, sender.message);
  return { sender, ctx };
}

export async function sendOutbound(config: AimeatConfig, storage: Storage, ownerGhii: string, input: SendInput): Promise<SendResult> {
  // WHICH COMPANY IS SPEAKING, resolved before anything else, because it decides WHOSE BOOK this
  // send belongs to and every gate below reads that book.
  //
  // `company_id` reached the sender identity and stopped there, so a refused send — a suppression,
  // an opt-out, a full allowance — was recorded with no company on it at all. The rows that say
  // why something did NOT go out are the ones an owner reads when a company's sending looks wrong.
  //
  // An unauthorised company is refused HERE rather than silently ignored. It used to contribute no
  // scope and fall through to the shared sender, which meant a caller could believe they had sent
  // as a company they may not speak for. Naming something you are not allowed to name is an error.
  const sender = input.companyId
    ? await resolveSendingCompany(storage, ownerGhii, input.companyId)
    : null;
  if (input.companyId && !sender) {
    throw new OutboundError('NOT_FOUND', 404, 'Company not found');
  }
  const organismId = sender ? sender.company.organismId : null;

  // WHICH MAILBOX IS SPEAKING, resolved here for the same reason the company is: before the first
  // gate, so a refused send is logged with the sender it would have used, and so a caller naming a
  // mailbox they may not use is told immediately rather than after the message was almost sent.
  //
  // `ownerGhii` is the CALLER — the identity that pressed send — which is what a connection belongs
  // to. It is deliberately not `bookOwner`: the book may be the company's, but the mailbox is the
  // person's, and those are the two halves this feature exists to keep apart.
  const mailbox = input.connectionId
    ? await resolveMailbox(config, storage, ownerGhii, input.connectionId, input.fromAlias)
    : null;

  // THE BOOK. Recipients, opt-outs, suppression, the daily allowance and the log all belong to the
  // company once one is named, not to whoever pressed send. Without this a person who unsubscribed
  // from one member's campaign is mailed by the next member, who has no way of knowing — a promise
  // broken by two people who each believed they were keeping it.
  const bookOwner = sender ? sender.bookOwner : ownerGhii;

  const contact = await requireOwnContact(storage, bookOwner, input.contactId);

  // Gate 2: suppression beats everything.
  if (contact.suppressedAt) {
    const log = await writeLog(storage, bookOwner, contact.id, 'email', input.kind, input.subject ?? '(suppressed)', input.templateId ?? null, 'suppressed', `Address suppressed after ${contact.bounceCount} bounces`, input.invoiceId ?? null, organismId, ownerGhii);
    throw Object.assign(new OutboundError('SUPPRESSED', 422, 'Recipient address is suppressed (bounces); clear it on the contact first'), { log });
  }

  // Gate 3: opt-out blocks marketing only.
  if (contact.optedOut && input.kind === 'marketing') {
    const log = await writeLog(storage, bookOwner, contact.id, 'email', input.kind, input.subject ?? '(opted out)', input.templateId ?? null, 'skipped', 'Recipient has opted out of marketing', input.invoiceId ?? null, organismId, ownerGhii);
    throw Object.assign(new OutboundError('OPTED_OUT', 422, 'Recipient has opted out of marketing messages'), { log });
  }

  // Gate 4: rolling 24 h daily limit, PER COMPANY when the send names one.
  //
  // One allowance shared by two companies means one busy company silences the other, and the
  // person who is silenced has no way to see why: the number they are counted against is somebody
  // else's sending. A send that names no company keeps counting against the owner-wide total,
  // which is what every account had before and still has.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const sentToday = await storage.countOutboundMessagesSince(bookOwner, since, organismId ?? undefined);
  if (sentToday >= config.outboundDailyLimit) {
    throw new OutboundError('DAILY_LIMIT', 429, `Outbound daily limit reached (${config.outboundDailyLimit}/24h)`);
  }

  // Compose.
  let subject: string;
  let body: string;
  if (input.templateId) {
    const tpl = await loadTemplate(storage, bookOwner, input.templateId);
    const vars = input.variables ?? {};
    subject = substitute(tpl.subject, vars);
    body = substitute(tpl.body, vars);
  } else {
    subject = input.subject ?? '';
    body = input.body ?? '';
  }

  // Invoice attachment path.
  const attachments: EmailAttachment[] = [];
  let invoiceId: string | null = null;
  if (input.invoiceId) {
    // The CALLER's invoice, deliberately, not the company's book. An invoice is finance, which has
    // its own cross-owner rule (finance.accountants); letting a sending permission reach somebody
    // else's invoices would be a second, quieter door into the books.
    const invoice = await requireOwnInvoice(storage, ownerGhii, input.invoiceId).catch(() => {
      throw new OutboundError('NOT_FOUND', 404, 'Invoice not found');
    });
    if (!invoice.invoiceNumber) throw new OutboundError('NOT_SENT', 409, 'Send the invoice first (draft → sent), then deliver it');
    invoiceId = invoice.id;
    const pdf = await renderInvoicePdf(invoice);
    attachments.push({ filename: `lasku-${invoice.invoiceNumber}.pdf`, content: pdf, contentType: 'application/pdf' });
    attachments.push({ filename: `finvoice-${invoice.invoiceNumber}.xml`, content: Buffer.from(buildFinvoiceXml(invoice), 'utf-8'), contentType: 'application/xml' });
    if (!subject) subject = `${invoice.type === 'credit_note' ? 'Hyvityslasku' : 'Lasku'} ${invoice.invoiceNumber} — ${invoice.seller.name}`;
    if (!body) {
      body = `Hei ${contact.name},\n\nliitteenä ${invoice.type === 'credit_note' ? 'hyvityslasku' : 'lasku'} ${invoice.invoiceNumber} (${(invoice.totalGrossMinor / 100).toFixed(2).replace('.', ',')} €).\nEräpäivä ${invoice.dueDate}, viitenumero ${invoice.referenceNumber}.\n\nYstävällisin terveisin,\n${invoice.seller.name}`;
    }
  }

  if (!subject.trim() || !body.trim()) {
    throw new OutboundError('INVALID_MESSAGE', 400, 'subject and body are required (directly, via template_id, or implied by invoice_id)');
  }

  // Gate 5: channel selection — AIMEAT inbox first when the recipient has an identity here.
  let channel: OutboundChannel;
  let status: OutboundStatus;
  let error: string | null = null;

  if (contact.ghii) {
    channel = 'inbox';
    const noteLine = attachments.length > 0
      ? `\n\n(${attachments.map((a) => a.filename).join(', ')} — lataa liitteet lähettäjän palvelusta)`
      : '';
    const result = await sendDirectMessage({ config, storage, peers: new Map() }, {
      // The AIMEAT inbox channel carries the CALLER, never the company's owner. This message is
      // genuinely from the person who sent it, and stamping somebody else's identity on it would
      // be impersonation inside the recipient's own inbox.
      senderGhii: ownerGhii,
      recipientGhii: contact.ghii,
      body: `**${subject}**\n\n${body}${noteLine}`,
      subject,
      skipContactGate: false,   // first contact lands in requests — the recipient still decides
    });
    status = result.ok ? 'sent' : 'failed';
    if (!result.ok) error = result.code;
  } else {
    channel = 'email';
    const emailSvc = getActiveEmailService();
    // A company with its own SMTP does not need the node's shared transport configured:
    // "the node cannot send" and "this company cannot send" are different facts.
    const companySender = sender
      ? await resolveCompanySender(config, storage, sender.company)
      : null;
    // A caller's own mailbox needs neither the node's transport nor a company server: "the node
    // cannot send", "this company cannot send" and "this person cannot send" are three facts, and
    // conflating them refuses a send that would have worked.
    if (!mailbox && !companySender && !emailSvc?.enabled) {
      status = 'failed';
      error = 'EMAIL_DISABLED';
    } else {
      const unsubscribeUrl = `${config.baseUrl}/v1/outbound/unsubscribe?token=${contact.optOutToken}`;
      // The two halves are built by services/outbound/email-body.ts, which is pure and therefore
      // testable: the escaping and the scheme check are the parts that must not drift, and they
      // get their own unit test rather than being reachable only through a configured SMTP server.
      // The counter belongs to whoever set it up, which is the caller: they created the stream
      // under their own identity and their campaign report reads it back. Sharing the book does
      // not mean sharing the measurement.
      const trackingUrl = await openPixelUrl(config, storage, ownerGhii, input);
      // A theme the caller NAMED is looked up under their own memory before the built-ins, so an
      // owner can call their house style 'clean' if they want to. An id that matches nothing is the
      // default rather than a refusal — see email-theme.ts on why decoration never fails a send.
      const theme = resolveTheme(input.theme, await loadOwnTheme(storage, ownerGhii, input.theme));
      const { html, text } = renderCampaignEmail({
        subject, body, kind: input.kind, unsubscribeUrl, theme,
        ...(input.links ? { links: input.links } : {}),
        ...(input.fromName ? { brand: input.fromName } : {}),
        ...(trackingUrl ? { trackingUrl } : {}),
      });
      // One place, three paths. Empty when nothing was declared, and then nothing is added.
      const extraHeaders = disclosureHeaders(input.aiDisclosure, config);
      // THE ORDER IS THE FEATURE. The caller's own mailbox first, then the company's server, then
      // the node's shared sender. A message a person sends is theirs, and it should look like it in
      // the recipient's inbox and in their own Sent folder; a company's server is the next best
      // thing; the node's shared address is the fallback, not the destination.
      if (mailbox) {
        const res = await sendThroughMailbox(
          mailbox.ctx, mailbox.sender,
          {
            to: contact.email, subject, html, text,
            ...(input.replyTo ? { replyTo: input.replyTo } : {}),
            ...(input.fromName ? { fromName: input.fromName } : {}),
            ...(attachments.length ? { attachments } : {}),
            ...(Object.keys(extraHeaders).length ? { headers: extraHeaders } : {}),
          },
        );
        status = res.ok ? 'sent' : 'failed';
        if (!res.ok) error = res.error ?? 'MAILBOX_SEND_FAILED';
      } else if (companySender) {
        const res = await sendAsCompany(companySender, contact.email, subject, html, text, attachments, extraHeaders);
        status = res.ok ? 'sent' : 'failed';
        if (!res.ok) error = res.error;
      } else if (emailSvc?.enabled) {
        const ok = await emailSvc.sendWithAttachments(contact.email, subject, html, text, attachments, {
          replyTo: input.replyTo, fromName: input.fromName,
          ...(Object.keys(extraHeaders).length ? { headers: extraHeaders } : {}),
        });
        status = ok ? 'sent' : 'failed';
        if (!ok) error = 'SMTP_SEND_FAILED';
      } else {
        status = 'failed';
        error = 'EMAIL_DISABLED';
      }
    }
  }

  // Invoice delivery state follows the actual outcome.
  if (invoiceId && status === 'sent') {
    await storage.setInvoiceStatus(invoiceId, (await storage.getInvoice(invoiceId))!.status, { deliveryStatus: 'delivered' });
  }

  // THE BOOK, NOT THE CALLER — and this line said `ownerGhii` until 2026-08-26, which meant a
  // SUCCESSFUL send by a colleague of the company's owner was filed under the colleague while every
  // refusal, the daily-allowance count and the log read were filed under the company. The per-company
  // allowance therefore counted a book that only ever received refusals and never bound at all, and
  // "what has this company sent" answered with the owner's own sends and nobody else's. WHO pressed
  // send is `sentBy`, which is what that value was actually being used for.
  const log = await writeLog(storage, bookOwner, contact.id, channel, input.kind, subject, input.templateId ?? null, status, error, invoiceId, organismId, ownerGhii);
  emitChange('outbound', bookOwner);
  // The caller's own surfaces are watching too when the book is somebody else's, and an event that
  // reached only the book would leave the person who pressed send looking at a stale screen.
  if (bookOwner !== ownerGhii) emitChange('outbound', ownerGhii);
  return { log, channel, status };
}

/**
 * One row in the append-only send log.
 *
 * `ownerGhii` here is the BOOK — the company's owner once a company is named — and `sentBy` is the
 * PERSON. Both are required, and `sentBy` deliberately has no default: it was added on 2026-08-26
 * and a defaulted parameter is how one of five call sites keeps writing null forever.
 */
async function writeLog(
  storage: Storage, ownerGhii: string, contactId: string, channel: OutboundChannel,
  kind: OutboundKind, subject: string, templateId: string | null,
  status: OutboundStatus, error: string | null, invoiceId: string | null,
  organismId: string | null, sentBy: string | null,
): Promise<OutboundMessageRecord> {
  const log: OutboundMessageRecord = {
    id: randomUUID(), ownerGhii, organismId, sentBy, contactId, channel, kind,
    subject: subject.slice(0, 300), templateId, status, error, invoiceId,
    createdAt: new Date().toISOString(),
  };
  await storage.createOutboundMessage(log);
  return log;
}
