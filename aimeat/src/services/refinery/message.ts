/**
 * @file src/services/refinery/message.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The pure half of the refinery: a mailbox's message (Gmail or Outlook shape) as one
 *   plain record, the redaction that keeps addresses off the wire, a learned rule's match, the
 *   extraction prompt, and the queue a message lands in. No I/O here, so every rule is a unit test.
 *
 *   These are Postinjalostamo's browser functions moved to the node, unchanged in what they decide,
 *   so the app's rows read the same whichever side wrote them.
 * @structure MailMessage · parseMessage · listPage · redact · senderAddress · senderDomain ·
 *   ruleFor · extractionPrompt · queueFor · QUEUES
 * @usage import { parseMessage, queueFor } from './message.js';
 * @version-history
 *   v1.0.0 — 2026-09-29 — Initial (wish aimeat-refinery).
 */
import type { RefineryClass } from '../../data/refinery-classes.js';

/** The queues a message can be in, in the order a person works through them. */
export const QUEUES = ['selkea', 'epaselva', 'kelvoton', 'ohitettu', 'hyvaksytty', 'lahetetty', 'hylatty'] as const;
export type Queue = typeof QUEUES[number];

export interface MailAttachment { id: string; filename: string; mime: string; size: number }
export interface MailMessage {
  id: string;
  date: string;
  subject: string;
  from: string;
  text: string;
  attachments: MailAttachment[];
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? v as Json : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

export function isGraph(provider: string): boolean { return /microsoft/.test(provider); }

function b64urlText(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

/** HTML to readable text, without a DOM: scripts and styles out, tags out, entities that matter in. */
export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>|<\/h\d>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function header(part: Json, name: string): string {
  const headers = Array.isArray(part.headers) ? part.headers as Json[] : [];
  const h = headers.find((x) => str(x.name).toLowerCase() === name);
  return h ? str(h.value) : '';
}

function gmailParts(part: Json, out: { plain: string; html: string; attachments: MailAttachment[] }): void {
  const body = obj(part.body);
  const mime = str(part.mimeType);
  if (str(part.filename) && str(body.attachmentId)) {
    // A logo or a signature picture is an inline image with a Content-ID; a document is not.
    const inline = /^inline/i.test(header(part, 'content-disposition')) || !!header(part, 'content-id');
    if (!(inline && /^image\//i.test(mime))) {
      out.attachments.push({ id: str(body.attachmentId), filename: str(part.filename), mime, size: Number(body.size) || 0 });
    }
  } else if (mime === 'text/plain' && str(body.data)) {
    out.plain += b64urlText(str(body.data)) + '\n';
  } else if (mime === 'text/html' && str(body.data)) {
    out.html += b64urlText(str(body.data)) + '\n';
  }
  for (const p of Array.isArray(part.parts) ? part.parts as Json[] : []) gmailParts(obj(p), out);
}

/** One message resource, whichever mailbox it came from, as the record the pipeline reads. */
export function parseMessage(provider: string, raw: unknown): MailMessage {
  const m = obj(raw);
  if (isGraph(provider)) {
    const body = obj(m.body);
    const from = obj(obj(m.from).emailAddress);
    const atts = Array.isArray(m.attachments) ? m.attachments as Json[] : [];
    return {
      id: str(m.id), date: str(m.receivedDateTime), subject: str(m.subject),
      from: from.address ? `${str(from.name)} <${str(from.address)}>` : '',
      text: (str(body.contentType) === 'html' ? stripHtml(str(body.content)) : str(body.content)).slice(0, 20000),
      attachments: atts.filter((x) => !x.isInline && /fileAttachment/.test(str(x['@odata.type']) || 'fileAttachment'))
        .map((x) => ({ id: str(x.id), filename: str(x.name), mime: str(x.contentType), size: Number(x.size) || 0 })),
    };
  }
  const payload = obj(m.payload);
  const out = { plain: '', html: '', attachments: [] as MailAttachment[] };
  gmailParts(payload, out);
  const internal = Number(m.internalDate);
  return {
    id: str(m.id),
    date: internal ? new Date(internal).toISOString() : header(payload, 'date'),
    subject: header(payload, 'subject'),
    from: header(payload, 'from'),
    text: (out.plain.trim() || stripHtml(out.html) || str(m.snippet)).slice(0, 20000),
    attachments: out.attachments,
  };
}

/** The message ids of one list page and the token for the next, for either mailbox. */
export function listPage(provider: string, raw: unknown): { ids: string[]; next: string } {
  const d = obj(raw);
  if (isGraph(provider)) {
    const link = str(d['@odata.nextLink']);
    // A nextLink that is not an address ends the paging: no further page is the only safe reading.
    const next = link && URL.canParse(link) ? new URL(link).searchParams.get('$skiptoken') ?? '' : '';
    return { ids: (Array.isArray(d.value) ? d.value as Json[] : []).map((x) => str(x.id)), next };
  }
  return { ids: (Array.isArray(d.messages) ? d.messages as Json[] : []).map((x) => str(x.id)), next: str(d.nextPageToken) };
}

// Email addresses leave the node only as their domain: the classifier needs to know the mail came
// from a bank, not whose inbox it was. (The decision scrubber missed free-text addresses, 2026-09-28.)
const EMAIL = /[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi;

export function redact(s: string): { text: string; n: number } {
  let n = 0;
  const text = String(s || '').replace(EMAIL, (_m, dom: string) => { n++; return `[email]@${dom}`; });
  return { text, n };
}

export function senderAddress(from: string): string {
  const m = /<([^>]+)>/.exec(from || '');
  return (m ? m[1] : String(from || '')).trim().toLowerCase();
}

export function senderDomain(from: string): string {
  const a = senderAddress(from);
  return a.includes('@') ? a.split('@')[1] : '';
}

export interface RefineryRule { match: 'from' | 'domain' | 'message'; value: string; klass: string; at?: string }

/** The first learned rule that names this message, its sender or its sender's domain. */
export function ruleFor(rules: RefineryRule[], msg: MailMessage): RefineryRule | null {
  const addr = senderAddress(msg.from);
  const dom = senderDomain(msg.from);
  return rules.find((r) => (r.match === 'from' && r.value === addr) || (r.match === 'domain' && r.value === dom)
    || (r.match === 'message' && r.value === msg.id)) ?? null;
}

/** The instruction every model gets for one class, built from the class, so no model is told differently. */
export function extractionPrompt(cls: RefineryClass, msg: MailMessage, attachmentText: string, pictures: number): string {
  const lines = cls.fields.map((f) => `- ${f.name} (${f.type}${f.required ? ', required' : ', optional'}): ${f.describe}`);
  const shape: Record<string, unknown> = {};
  for (const f of cls.fields) shape[f.name] = f.type === 'number' ? 0 : f.type === 'boolean' ? false : '';
  shape._confidence = 0;
  shape._note = '';
  return 'Extract these fields from the email message below and from its attachments.\n'
    + `Document type: ${cls.type} (${cls.describe})\n${lines.join('\n')}\n`
    + 'Use null for a field the message does not state. Never guess a value.\n'
    + 'Also answer "_confidence": a number from 0 to 1 for how sure you are of the whole record, and "_note": one short sentence on anything unclear.\n'
    + `Answer with ONLY a JSON object of this shape: ${JSON.stringify(shape)}\n\n`
    + `From: ${redact(msg.from).text}\nSubject: ${msg.subject}\nDate: ${msg.date}\n\n${redact(msg.text).text.slice(0, 12000)}`
    + (attachmentText ? `\n\nATTACHMENT TEXT:\n${attachmentText.slice(0, 20000)}` : '')
    + (pictures ? '\n\nThe attached files are documents whose text is only in the picture; read them.' : '');
}

/** The JSON object in a model's answer, fenced or not; null when there is none. */
export function parseJsonAnswer(text: string): Record<string, unknown> | null {
  const s = String(text || '').replace(/```(?:json)?/gi, '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    const v = JSON.parse(s.slice(a, b + 1)) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
  // eslint-disable-next-line aimeat/no-silent-catch -- an answer that is not JSON is this function's null by contract; the caller asks the model again and then fails the message with NO_JSON
  } catch { return null; }
}

export interface Thresholds { clear: number; unclear: number }

/**
 * Where the message goes. A class that is not processed is filed as skipped; a processed one is
 * clear only when every required field is there and both the classifier and the extractor were
 * sure enough, unclear when either was only somewhat sure, and unusable below that.
 */
export function queueFor(
  cls: RefineryClass | null, confidence: number, fields: Record<string, unknown> | null, th: Thresholds,
): Queue {
  if (!cls) return 'kelvoton';
  if (!cls.process) return 'ohitettu';
  if (!fields) return confidence >= th.unclear ? 'epaselva' : 'kelvoton';
  const missing = cls.fields.filter((f) => f.required && (fields[f.name] == null || fields[f.name] === ''));
  const sure = Math.min(confidence, Number(fields._confidence) || 0);
  if (!missing.length && sure >= th.clear) return 'selkea';
  if (sure >= th.unclear) return 'epaselva';
  return 'kelvoton';
}
