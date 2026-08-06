/**
 * @file src/services/outbound/outbound-service.ts
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
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 2.
 */
import { randomUUID, randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { OutboundContactRecord, OutboundKind, OutboundMessageRecord, OutboundStatus, OutboundChannel } from '../../models/outbound-schemas.js';
import { getActiveEmailService, type EmailAttachment } from '../email.js';
import { resolveContactEmail } from '../contacts.js';
import { sendDirectMessage } from '../message-send.js';
import { outboundEmailHtml } from '../email-templates.js';
import { emitChange } from '../../services/event-bus.js';
import { renderInvoicePdf } from '../finance/invoice-pdf.js';
import { buildFinvoiceXml } from '../finance/finvoice.js';
import { requireOwnInvoice } from '../finance/invoice-service.js';

export class OutboundError extends Error {
  constructor(public readonly code: string, public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'OutboundError';
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUPPRESS_AFTER_BOUNCES = 3;

export interface ContactInput {
  name: string;
  email: string;
  tags?: string[];
  notes?: string | null;
}

/** Creates or returns the owner's contact for an email (one entry per owner per address). */
export async function ensureContact(storage: Storage, ownerGhii: string, input: ContactInput): Promise<OutboundContactRecord> {
  const email = (input.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new OutboundError('INVALID_EMAIL', 400, 'A valid email is required');
  if (!input.name || typeof input.name !== 'string' || input.name.trim().length < 1) {
    throw new OutboundError('INVALID_CONTACT', 400, 'name is required');
  }
  const existing = await storage.findOutboundContactByEmail(ownerGhii, email);
  if (existing) return existing;

  // Does this address belong to a registered AIMEAT identity here? (privacy-preserving hash)
  let ghii: string | null = null;
  try {
    const resolved = await resolveContactEmail(storage, email);
    if (resolved.found) ghii = resolved.ghii;
    // eslint-disable-next-line aimeat/no-silent-catch -- resolveContactEmail throws on its stricter email regex; unresolvable just means "no AIMEAT identity" (a normal outcome: plain email contact)
  } catch { /* no AIMEAT identity for this address */ }

  const now = new Date().toISOString();
  const record: OutboundContactRecord = {
    id: randomUUID(), ownerGhii,
    name: input.name.trim().slice(0, 140), email,
    ghii, tags: (input.tags ?? []).slice(0, 20),
    optedOut: false, optOutAt: null,
    optOutToken: randomBytes(24).toString('base64url'),
    bounceCount: 0, suppressedAt: null,
    notes: input.notes ?? null,
    createdAt: now, updatedAt: now,
  };
  await storage.createOutboundContact(record);
  return record;
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
  /** Reply-To for the email channel (the business's own address). */
  replyTo?: string;
  /** Display name on the email From header (envelope address stays the node's). */
  fromName?: string;
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

/** The send. Every outcome is logged; only policy violations throw. */
export async function sendOutbound(config: AimeatConfig, storage: Storage, ownerGhii: string, input: SendInput): Promise<SendResult> {
  const contact = await requireOwnContact(storage, ownerGhii, input.contactId);

  // Gate 2: suppression beats everything.
  if (contact.suppressedAt) {
    const log = await writeLog(storage, ownerGhii, contact.id, 'email', input.kind, input.subject ?? '(suppressed)', input.templateId ?? null, 'suppressed', `Address suppressed after ${contact.bounceCount} bounces`, input.invoiceId ?? null);
    throw Object.assign(new OutboundError('SUPPRESSED', 422, 'Recipient address is suppressed (bounces); clear it on the contact first'), { log });
  }

  // Gate 3: opt-out blocks marketing only.
  if (contact.optedOut && input.kind === 'marketing') {
    const log = await writeLog(storage, ownerGhii, contact.id, 'email', input.kind, input.subject ?? '(opted out)', input.templateId ?? null, 'skipped', 'Recipient has opted out of marketing', input.invoiceId ?? null);
    throw Object.assign(new OutboundError('OPTED_OUT', 422, 'Recipient has opted out of marketing messages'), { log });
  }

  // Gate 4: rolling 24 h daily limit.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const sentToday = await storage.countOutboundMessagesSince(ownerGhii, since);
  if (sentToday >= config.outboundDailyLimit) {
    throw new OutboundError('DAILY_LIMIT', 429, `Outbound daily limit reached (${config.outboundDailyLimit}/24h)`);
  }

  // Compose.
  let subject: string;
  let body: string;
  if (input.templateId) {
    const tpl = await loadTemplate(storage, ownerGhii, input.templateId);
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
    if (!emailSvc?.enabled) {
      status = 'failed';
      error = 'EMAIL_DISABLED';
    } else {
      const unsubscribeUrl = `${config.baseUrl}/v1/outbound/unsubscribe?token=${contact.optOutToken}`;
      const optOutFooter = input.kind === 'marketing'
        ? `<p style="font-size:12px;color:#888">Et halua näitä viestejä? <a href="${unsubscribeUrl}">Peru tilaus</a> / Unsubscribe</p>`
        : '';
      const htmlBody = body.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replaceAll('\n', '<br>')}</p>`).join('') + optOutFooter;
      const textBody = input.kind === 'marketing'
        ? `${body}\n\n--\nPeru tilaus / Unsubscribe: ${unsubscribeUrl}`
        : body;
      const { html, text } = outboundEmailHtml(subject, htmlBody, textBody, 'fi', input.fromName ? { brand: input.fromName } : undefined);
      const ok = await emailSvc.sendWithAttachments(contact.email, subject, html, text, attachments, {
        replyTo: input.replyTo, fromName: input.fromName,
      });
      status = ok ? 'sent' : 'failed';
      if (!ok) error = 'SMTP_SEND_FAILED';
    }
  }

  // Invoice delivery state follows the actual outcome.
  if (invoiceId && status === 'sent') {
    await storage.setInvoiceStatus(invoiceId, (await storage.getInvoice(invoiceId))!.status, { deliveryStatus: 'delivered' });
  }

  const log = await writeLog(storage, ownerGhii, contact.id, channel, input.kind, subject, input.templateId ?? null, status, error, invoiceId);
  emitChange('outbound', ownerGhii);
  return { log, channel, status };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function writeLog(
  storage: Storage, ownerGhii: string, contactId: string, channel: OutboundChannel,
  kind: OutboundKind, subject: string, templateId: string | null,
  status: OutboundStatus, error: string | null, invoiceId: string | null,
): Promise<OutboundMessageRecord> {
  const log: OutboundMessageRecord = {
    id: randomUUID(), ownerGhii, contactId, channel, kind,
    subject: subject.slice(0, 300), templateId, status, error, invoiceId,
    createdAt: new Date().toISOString(),
  };
  await storage.createOutboundMessage(log);
  return log;
}
