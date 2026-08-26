/**
 * @file src/services/connections/send-mail.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Sending a message THROUGH a person's own connected mailbox — the third way a message
 *   leaves this node, beside a company's own SMTP server and the node's shared sender.
 *
 *   WHY IT GOES THROUGH THE PROVIDER'S API AND NOT THROUGH SMTP. Both Gmail and Graph put the
 *   message in the person's own Sent Items, which is the behaviour anyone who has used a CRM
 *   expects and the thing that makes this feel like their own mail rather than a robot's. SMTP with
 *   XOAUTH2 would deliver, and would not reliably do that; Microsoft has also been switching client
 *   SMTP submission off across tenants, so the SMTP road is the one that stops working without
 *   warning.
 *
 *   THE TOKEN NEVER LEAVES THIS MODULE, the same rule the read direction keeps. A caller names a
 *   connection and a message; it never sees a credential.
 *
 *   THIS MODULE DOES NOT DECIDE WHETHER A MESSAGE MAY BE SENT. That is the outbound door's policy
 *   chain — a saved contact, suppression, opt-out, the daily allowance, the unsubscribe link — and
 *   there is exactly one of it. This is a transport, reached only after those gates have answered.
 * @structure
 *   - MailboxSender / resolveMailboxSender  -- which mailbox, and may this caller use it
 *   - sendThroughMailbox                    -- Gmail's raw MIME, or Graph's JSON message
 *   - listSendAsAliases                     -- the verified addresses a Gmail mailbox may send as
 * @usage const sender = await resolveMailboxSender(ctx, principal, connectionId, alias);
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { safeFetch } from '../../utils/url-validator.js';
import { logger } from '../../utils/logger.js';
import { ensureFreshCredential } from './refresh.js';
import { findProvider } from './providers.js';
import { readResource } from './read.js';
import type { ConnectContext } from './oauth.js';
import type { EmailAttachment } from '../email.js';

/** A mailbox this caller may send through, already checked. */
export interface MailboxSender {
  connectionId: string;
  provider: string;
  /** The address the recipient sees. The account's own, or a verified alias of it. */
  fromAddress: string;
  /** The mailbox's own address, before any alias. Kept for the log and for refusals. */
  accountAddress: string;
}

/** Why a mailbox cannot be used, in words the person can act on. */
export interface MailboxRefusal {
  code: string;
  status: number;
  message: string;
}

export interface MailboxSendResult {
  ok: boolean;
  /** A short code for the send log. Absent when it went. */
  error?: string;
}

/** What a caller hands over. Everything about WHO may receive it was settled upstream. */
export interface MailboxMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  fromName?: string;
  attachments?: EmailAttachment[];
}

/**
 * Which mailbox, and may this caller use it.
 *
 * THE CONNECTION MUST BE THE CALLER'S OWN, and that is checked here rather than trusted from the
 * request: a connection id is guessable enough that "the caller said so" is not an answer, and
 * sending in somebody else's name is the exact harm this whole feature could otherwise cause.
 *
 * The capability is checked too, not just the provider id. A connection made for READING has no
 * send scope, and its token would be refused by the provider with a 403 that names nothing — so it
 * is refused here, with the sentence that names the fix.
 */
export async function resolveMailboxSender(
  ctx: ConnectContext,
  principal: string,
  connectionId: string,
  alias?: string,
): Promise<MailboxSender | MailboxRefusal> {
  const conn = await ctx.storage.getConnection(connectionId);
  if (!conn || conn.principal !== principal) {
    // The same answer for "no such connection" and "not yours": telling one owner that another
    // owner's connection exists is a disclosure, and neither answer helps them.
    return { code: 'NO_SUCH_MAILBOX', status: 404, message: 'No connected mailbox with that id.' };
  }
  const provider = findProvider(ctx.providers, conn.provider);
  if (!provider) {
    return { code: 'PROVIDER_GONE', status: 409, message: 'That provider is no longer available on this node.' };
  }
  if (!provider.capabilities.includes('send-mail')) {
    return {
      code: 'MAILBOX_CANNOT_SEND', status: 400,
      message: `This connection was made to READ ${provider.label}, not to send from it. Connect the sending permission as well, and pick that connection instead.`,
    };
  }
  if (conn.status !== 'active') {
    return {
      code: 'MAILBOX_NEEDS_REAUTH', status: 409,
      message: `This mailbox needs reconnecting before it can send${conn.lastError ? `: ${conn.lastError}` : '.'}`,
    };
  }

  const accountAddress = conn.accountLabel || '';
  if (!alias || alias === accountAddress) {
    return { connectionId: conn.id, provider: provider.id, fromAddress: accountAddress, accountAddress };
  }

  // AN ALIAS IS CHECKED AGAINST THE PROVIDER, NEVER TAKEN ON TRUST. A From header this node did not
  // verify is a From header a caller chose, and the whole point of sending through somebody's own
  // mailbox is that the address really is theirs.
  const verified = await listSendAsAliases(ctx, principal, conn.id);
  if ('code' in verified) {
    return {
      code: 'ALIAS_UNVERIFIABLE', status: 409,
      message: `This node could not check which addresses that mailbox may send as: ${verified.message}`,
    };
  }
  if (!verified.addresses.includes(alias)) {
    return {
      code: 'ALIAS_NOT_VERIFIED', status: 400,
      message: verified.addresses.length
        ? `That mailbox has not verified "${alias}". It may send as: ${verified.addresses.join(', ')}. Add and confirm the alias at the provider first; a new one can take a day to appear.`
        : `That mailbox has no verified alias, so it can only send as ${accountAddress}.`,
    };
  }
  return { connectionId: conn.id, provider: provider.id, fromAddress: alias, accountAddress };
}

/**
 * The addresses a Gmail mailbox may send as.
 *
 * Reached through the READ connection's `sendAs` resource, which needs no scope beyond the
 * `gmail.readonly` that connection already has — so the alias list costs a person nothing extra.
 * Microsoft has no equivalent that a delegated Graph scope can read: sending as another address
 * there is an Exchange permission an administrator grants, so this returns nothing for it rather
 * than pretending.
 */
export async function listSendAsAliases(
  ctx: ConnectContext, principal: string, connectionId: string,
): Promise<{ addresses: string[]; primary: string | null } | MailboxRefusal> {
  const conn = await ctx.storage.getConnection(connectionId);
  if (!conn || conn.principal !== principal) {
    return { code: 'NO_SUCH_MAILBOX', status: 404, message: 'No connected mailbox with that id.' };
  }
  // The alias list lives on the READ side. A caller holding only a send connection has a sibling
  // read connection or it has no aliases to offer, and either way this is where to look.
  const readConn = conn.provider === 'google-mail'
    ? conn
    : (await ctx.storage.listConnections({ principal, provider: 'google-mail', status: 'active' }))
      // Matched by the ACCOUNT, not just by the provider: a person may hold two Gmail mailboxes,
      // and offering one mailbox's aliases as the other's would put a From address on a message
      // that the sending account has never verified.
      .find(c => c.accountLabel === conn.accountLabel);
  if (!readConn) {
    return {
      code: 'NO_ALIAS_SOURCE', status: 409,
      message: 'The alias list is read from the mailbox, and this account has no reading connection. Connect "read my mail" for the same mailbox and the aliases appear.',
    };
  }

  const res = await readResource(ctx, readConn.id, 'sendAs', {});
  if (!res.ok) return { code: 'ALIAS_READ_FAILED', status: res.status ?? 502, message: res.message };

  const body = res.data as { sendAs?: Array<Record<string, unknown>> } | null;
  const rows = Array.isArray(body?.sendAs) ? body.sendAs : [];
  const addresses: string[] = [];
  let primary: string | null = null;
  for (const row of rows) {
    const address = typeof row.sendAsEmail === 'string' ? row.sendAsEmail : '';
    if (!address) continue;
    // An UNVERIFIED alias is one Google will refuse at send time. Listing it would offer somebody a
    // From address that fails later for a reason the message does not carry.
    const state = typeof row.verificationStatus === 'string' ? row.verificationStatus : '';
    if (state && state !== 'accepted') continue;
    addresses.push(address);
    if (row.isPrimary === true) primary = address;
  }
  return { addresses, primary };
}

/** Send it. The gates ran upstream; this is the transport and nothing else. */
export async function sendThroughMailbox(
  ctx: ConnectContext, sender: MailboxSender, message: MailboxMessage,
): Promise<MailboxSendResult> {
  const fresh = await ensureFreshCredential(ctx, sender.connectionId);
  if (!fresh.ok) {
    return { ok: false, error: fresh.code === 'NEEDS_REAUTH' ? 'MAILBOX_NEEDS_REAUTH' : 'MAILBOX_UNAVAILABLE' };
  }
  const auth = { Authorization: `Bearer ${fresh.credential.accessToken}` };

  try {
    if (sender.provider === 'google-mail-send') {
      const raw = await buildMime(sender, message);
      const r = await safeFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: raw.toString('base64url') }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) return { ok: false, error: await providerError('Google', r) };
      return { ok: true };
    }

    if (sender.provider === 'microsoft-mail-send') {
      // Graph takes a JSON message, so no MIME is assembled here at all. The `from` is deliberately
      // NOT set: Mail.Send sends as the signed-in mailbox, and sending as another address is an
      // Exchange SendAs permission an administrator grants, not a scope this can request. Setting it
      // would be a request Graph refuses, or worse, one it honours in one tenant and not the next.
      const r = await safeFetch('https://graph.microsoft.com/v1.0/me/sendMail', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            subject: message.subject,
            body: { contentType: 'HTML', content: message.html },
            toRecipients: [{ emailAddress: { address: message.to } }],
            ...(message.replyTo ? { replyTo: [{ emailAddress: { address: message.replyTo } }] } : {}),
            ...(message.attachments?.length ? {
              attachments: message.attachments.map(a => ({
                '@odata.type': '#microsoft.graph.fileAttachment',
                name: a.filename,
                contentType: a.contentType ?? 'application/octet-stream',
                contentBytes: Buffer.isBuffer(a.content) ? a.content.toString('base64') : Buffer.from(String(a.content)).toString('base64'),
              })),
            } : {}),
          },
          // It belongs in their Sent Items. That is the whole reason this path exists rather than a
          // relay: the person can see what went out in the place they already look.
          saveToSentItems: true,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      // Graph answers 202 Accepted: the request is taken, delivery is Exchange's business after
      // that. A 200-family status is as much as this can honestly claim, and the send log says
      // "sent" meaning "handed over", exactly as it does for SMTP.
      if (!r.ok) return { ok: false, error: await providerError('Microsoft', r) };
      return { ok: true };
    }

    return { ok: false, error: 'MAILBOX_UNSUPPORTED' };
  } catch (err) {
    logger.warn('send-mail: the provider could not be reached', {
      provider: sender.provider, error: String(err),
    });
    return { ok: false, error: 'MAILBOX_UNREACHABLE' };
  }
}

/** RFC 5322 bytes for Gmail, which takes the whole message rather than its parts. */
async function buildMime(sender: MailboxSender, message: MailboxMessage): Promise<Buffer> {
  const composer = new MailComposer({
    from: message.fromName ? { name: message.fromName, address: sender.fromAddress } : sender.fromAddress,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    ...(message.attachments?.length ? {
      attachments: message.attachments.map(a => ({
        filename: a.filename,
        content: a.content,
        ...(a.contentType ? { contentType: a.contentType } : {}),
      })),
    } : {}),
  });
  return await composer.compile().build();
}

/**
 * A short code for the send log, and the provider's own words in the server log.
 *
 * The code is what an owner sees beside a failed row, so it stays a code. The body is where the
 * actual reason lives — an invalid recipient, a quota, a revoked grant — and throwing it away is
 * how a support question becomes unanswerable.
 */
async function providerError(who: string, res: Response): Promise<string> {
  let detail: string;
  try {
    detail = (await res.text()).slice(0, 500);
  } catch (err) {
    // The refusal itself is the finding; an unreadable body only makes it harder to explain, so it
    // is recorded rather than swallowed.
    detail = `(the body could not be read: ${String(err)})`;
  }
  logger.warn('send-mail: the provider refused the message', { who, status: res.status, detail });
  if (res.status === 401 || res.status === 403) return 'MAILBOX_NOT_PERMITTED';
  if (res.status === 429) return 'MAILBOX_RATE_LIMITED';
  return `MAILBOX_HTTP_${res.status}`;
}
