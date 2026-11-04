/**
 * @file notification-create.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A principal notifying its OWN owner: the one implementation behind
 *   POST /v1/notifications and the aimeat_notify MCP tool. Validates the four fields, names the
 *   sender (an app gets its name in front of the title and its own page as the default link, an
 *   agent its name, an owner session is the owner), and hands the record to notify(), which
 *   applies the owner's settings. Self-targeted only: the recipient is always the owner behind the
 *   caller's session; there is no surface for pushing at arbitrary owners.
 * @structure NotificationCreateError · createPrincipalNotification · MailOwnerOptions · mailOwnerFrom ·
 *   ownerMailLimitReached
 * @usage const r = await createPrincipalNotification(storage, config, req.auth!, body);
 * @version-history
 *   2026-11-04 — The running mail service is read from nodeContext() (services/node-context.ts) in place of
 *     getActiveEmailService (codebase analysis 2026-11-03, item D-i).
 *   v1.5.1 — 2026-11-04 — mailOwnerFrom sends through mail-gate.ts sendMail, which keeps the per-sender
 *     daily count that lived here, unchanged (codebase analysis 2026-11-03, item B3).
 *   v1.5.0 — 2026-11-04 — mailOwnerFrom asks provenOwnerAddress (the flag and the hash) and takes the
 *     mail log's kind and the caller's own mail service, so the workflow-end report goes through it
 *     (codebase analysis 2026-11-03, items A2 and A9).
 *   v1.4.1 — 2026-11-03 — ownerMailLimitReached: whether a sender has used today's mail limit, read
 *     without counting (secaudit2026nov02d round 13b).
 *   v1.4.0 — 2026-11-02 — mailOwnerFrom is the one mail path for a principal's words to its owner: the
 *     node's delivery of a scheduled task's result counts against the same per-sender daily limit, and
 *     the limit is the setting email.reports_per_sender_day (default 10, 0 no limit). The verified
 *     address comes from owner-mail-address.ts (secaudit2026nov02d round 13).
 *   v1.3.1 — 2026-10-31 — The report mail carries Reply-To from email.reply_to when it is set (Jouni, 20.14).
 *   v1.3.0 — 2026-10-31 — `email: true` also mails the notification to the owner's verified address,
 *     at most EMAIL_PER_DAY a sender, never when muted; `emailed` says what became of it. An agent
 *     could reach the owner's bell and devices only, so "send me the summary by email" had no way
 *     to happen (v31 K46).
 *   v1.2.0 — 2026-09-24 — The link is checked by isSameOriginPath, so `/\host`, which a browser reads
 *     as `//host`, is refused like any other address off this node.
 *   v1.1.0 — 2026-09-07 — `created` says whether it was created. It was the literal `true`, and
 *     notify()'s answer was taken apart for `muted` alone, so the one field carrying a storage
 *     failure was dropped here: POST /v1/notifications answered 201 and aimeat_notify answered
 *     `status: notified`, both having stored nothing. notify() swallowing is correct for its four
 *     side-effect callers; it only holds if the answer says what happened.
 *   v1.0.0 — 2026-08-30 — Extracted from routes/notifications.ts so the MCP tool is the same call.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { notify } from './notify.js';
import type { NotifSource } from './notification-settings.js';
import { emitChange } from './event-bus.js';
import { isSameOriginPath } from '../utils/same-origin-path.js';
import type { EmailService } from './email.js';
import { nodeContext } from './node-context.js';
import { appendMailLog, type MailLogKind } from './notification-settings.js';
import { provenOwnerAddress } from './owner-mail-address.js';
import { sendMail, senderLimitReached } from './mail-gate.js';
import { logger } from '../utils/logger.js';

export class NotificationCreateError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); this.name = 'NotificationCreateError'; }
}

/** The slice of req.auth this needs. */
export interface CreatorAuth { owner: string; sub: string; roles: string[]; app_grant?: string | null }

export interface CreateNotificationInput { title?: unknown; body?: unknown; link?: unknown; type?: unknown; actions?: unknown; email?: unknown }

/**
 * What became of `email: true`: sent to the owner's verified address; `not_asked`; the owner has no
 * verified address; this node sends no mail; the sender reached EMAIL_PER_DAY today; the transport
 * refused it; or muted (the owner silenced this sender, so neither the bell nor the mail).
 */
export type NotificationEmailOutcome = 'sent' | 'not_asked' | 'no_address' | 'mail_off' | 'limit' | 'failed' | 'muted';

/**
 * Mails to the owner one sender may cause in 24 hours, unless the operator set
 * email.reports_per_sender_day (0: no limit). Held in this process: a restart starts the count
 * again, which costs at most one more day's worth; the owner's mute stops a sender for good.
 */
export const EMAIL_PER_DAY = 10;

/**
 * The daily limit `sender` (`kind:id`) has already reached for mail to `ghii`, or 0 while it may still
 * mail. Reads the count without taking from it, so a caller can tell the owner in the bell entry why
 * the mail did not come (task-result-delivery.ts). The count is kept by mail-gate.ts.
 */
export function ownerMailLimitReached(config: AimeatConfig, ghii: string, sender: string): number {
  const limit = emailPerDay(config);
  if (limit <= 0) return 0;
  return senderLimitReached({ key: `${ghii} ${sender}`, perDay: limit }) ? limit : 0;
}

/** The per-sender daily mail limit in force: the setting, else EMAIL_PER_DAY. */
function emailPerDay(config: AimeatConfig): number {
  const v = config.emailReportsPerSenderDay;
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : EMAIL_PER_DAY;
}

export async function createPrincipalNotification(
  storage: Storage, config: AimeatConfig, auth: CreatorAuth, input: CreateNotificationInput,
): Promise<{ created: boolean; link: string | null; muted: boolean; emailed: NotificationEmailOutcome }> {
  const { title, body, link, type } = input;
  if (input.email !== undefined && typeof input.email !== 'boolean') {
    throw new NotificationCreateError(400, 'VALIDATION_ERROR', 'email is true or false');
  }
  if (typeof title !== 'string' || !title.trim() || title.length > 200) {
    throw new NotificationCreateError(400, 'VALIDATION_ERROR', 'title is required (string, max 200 chars)');
  }
  if (body !== undefined && (typeof body !== 'string' || body.length > 10_000)) {
    throw new NotificationCreateError(400, 'VALIDATION_ERROR', 'body must be a string (max 10000 chars)');
  }
  // A path of this node only, as isSameOriginPath reads one: not '//host', not '/\host', not a URL.
  // A notification never deep-links off the node.
  if (link !== undefined && (!isSameOriginPath(link) || link.length > 500)) {
    throw new NotificationCreateError(400, 'VALIDATION_ERROR', 'link must be a same-node path starting with "/"');
  }
  if (type !== undefined && (typeof type !== 'string' || !/^[a-z0-9_:.-]{1,64}$/i.test(type))) {
    throw new NotificationCreateError(400, 'VALIDATION_ERROR', 'type must match [a-z0-9_:.-]{1,64}');
  }
  // SECURITY: inline reply/api actions execute with the RECIPIENT's authority when clicked, so they
  // may only originate from trusted server-side emit code, never a principal posting here.
  if (input.actions !== undefined) {
    throw new NotificationCreateError(400, 'VALIDATION_ERROR', 'actions are set by the node, not by the notification creator; use link for navigation');
  }

  let finalTitle = title.trim();
  let finalLink = link as string | undefined;
  let finalType = type as string | undefined;
  let source: NotifSource;
  if (auth.roles.includes('app')) {
    const grant = auth.app_grant ? await storage.getAppGrant(auth.app_grant) : null;
    if (!finalLink && grant?.app) {
      const [appOwner, filename] = grant.app.split('/');
      finalLink = `/v1/apps/${encodeURIComponent(appOwner)}/${encodeURIComponent(filename)}?mode=inline`;
    }
    const appName = grant?.appName || 'App';
    finalTitle = `${appName}: ${finalTitle}`;
    finalType = finalType ?? 'app';
    source = { kind: 'app', name: appName, id: grant?.app || undefined };
  } else if (auth.roles.includes('agent') && !auth.roles.includes('owner')) {
    const agentName = auth.sub.includes('#') ? auth.sub.split('#')[0] : auth.sub;
    finalTitle = `${agentName}: ${finalTitle}`;
    finalLink = finalLink ?? '/v1/profile?tab=agents';
    finalType = finalType ?? 'agent';
    source = { kind: 'agent', name: agentName, id: auth.sub };
  } else {
    finalType = finalType ?? 'custom';
    source = { kind: 'owner', name: auth.owner };
  }

  const ghii = `${auth.owner}@${config.nodeId}`;
  const result = await notify(storage, ghii, { type: finalType, title: finalTitle, body: body as string | undefined, link: finalLink, source });
  // `created` SAYS WHETHER IT WAS CREATED. It was the literal `true`, and `notify()`'s answer was
  // taken apart for `muted` alone, so the one field that could have carried the failure was dropped
  // here and every caller above was told the notification had landed. `notify()` is best-effort BY
  // DESIGN -- it swallows a storage failure so the action that TRIGGERED a notification still
  // succeeds, which is right for the four call sites where notifying is a side effect -- and that
  // design only holds if the answer says what happened. Measured 2026-09-07 against a storage that
  // refuses every write: `aimeat_notify` was the one tool of 318 on the node's MCP surface that
  // reached broken storage and answered without an error.
  //
  // A MUTED notification keeps `created: false` with `muted: true`, and that is not a failure: the
  // owner said "nothing from this one", the node honoured it, and the two fields together say so.
  emitChange('notifications', ghii);
  const emailed = input.email !== true ? 'not_asked'
    : result.muted ? 'muted'
    : await mailOwner(storage, config, ghii, `${source.kind}:${source.id ?? source.name}`, finalTitle, body as string | undefined, finalLink);
  return { created: result.stored, link: finalLink ?? null, muted: result.muted, emailed };
}

/**
 * The same notification by email to the owner, at the address they verified (GHIIRecord
 * notificationEmail, as the digest uses). Self-targeted like the rest: the address is the owner's
 * own and never an input. Written for an agent's report the owner asked to get by mail, such as a
 * morning news summary (v31 K46): before this an agent could reach the owner's bell and devices only.
 */
async function mailOwner(
  storage: Storage, config: AimeatConfig, ghii: string, sender: string,
  title: string, body: string | undefined, link: string | undefined,
): Promise<NotificationEmailOutcome> {
  const url = link ? `${config.baseUrl.replace(/\/+$/, '')}${link}` : '';
  const text = [body?.trim(), url].filter(Boolean).join('\n\n');
  return mailOwnerFrom(storage, config, ghii, sender, title, text || title);
}

/** What a caller of mailOwnerFrom may set besides the mail. */
export interface MailOwnerOptions {
  /** The kind the Email page's mail log names the mail by; `notification` when absent. */
  logKind?: MailLogKind;
  /** The mail service to send with, when the caller holds its own (the workflow engine); null is none. */
  email?: EmailService | null;
}

/**
 * Mail `text` under `subject` to the owner's proven address on behalf of `sender` (`kind:id`, the
 * key the bell's sender settings use), within that sender's daily limit. The one path for a mail a
 * principal's words reach the owner by: the agent's own notice above, the node's delivery of a
 * scheduled task's result (task-result-delivery.ts) and a workflow's end report
 * (workflow/engine-steps.ts, sender `workflow:<id>`), so all count against the same limit. The caller
 * has already honoured the owner's mute (notify() answered `muted`).
 */
export async function mailOwnerFrom(
  storage: Storage, config: AimeatConfig, ghii: string, sender: string, subject: string, text: string,
  opts: MailOwnerOptions = {},
): Promise<NotificationEmailOutcome> {
  const email = 'email' in opts ? opts.email : nodeContext().email;
  if (!email?.enabled) return 'mail_off';
  const account = await storage.getGHII(ghii);
  if (!provenOwnerAddress(account)) return 'no_address';
  try {
    // The proven address, the sender's daily limit and its count are the gate's (mail-gate.ts). A
    // reply goes where somebody reads it (email.reply_to), not to the node's no-reply sender.
    const outcome = await sendMail(email, { kind: 'owner', account, limit: { key: `${ghii} ${sender}`, perDay: emailPerDay(config) } },
      { form: 'notification', subject, body: text, opts: { replyTo: config.smtpReplyTo } });
    if (outcome !== 'sent') return outcome;
    await appendMailLog(storage, ghii, { kind: opts.logKind ?? 'notification', subject });
    return 'sent';
  } catch (err) {
    logger.warn('notification email: not sent', { ghii, error: String(err) });
    return 'failed';
  }
}
