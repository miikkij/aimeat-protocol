/**
 * @file src/services/mail-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one function every mail the node sends goes through: sendMail(email, intent,
 *   message). The intent says whose mail it is, and the gate applies the check that kind of mail
 *   needs, so a new sender cannot leave it out:
 *
 *   - `owner`: the account's own address. The gate asks owner-mail-address.ts provenOwnerAddress
 *     and sends nothing when the address is not proven (answer `no_address`). Optional `limit`: the
 *     per-sender daily limit (email.reports_per_sender_day), which the owner notices of
 *     notification-create.ts mailOwnerFrom carry.
 *   - `third-party`: an address a principal named. The caller shows the account's turn it took
 *     before writing anything (account-limits.ts takeMailSend or takeInviteEmail), or writes the
 *     sentence that says what bounds this mail instead.
 *   - `sign-in`: the node's own text that proves an address or lets a person in (a code, a link, a
 *     reset, the first credentials), to the address the person gave or the proven recovery address.
 *     The caller names why that address is the right one.
 *   - `operator`: the operator's own act (the admin test and group mail) or a mail to the operator's
 *     own address, or a notice the operator's compliance work sends.
 *
 *   WHY. Before this, 24 files called the mail service's send methods directly, and whether a mail
 *   asked for a proven address or a per-account count was up to each file (codebase analysis
 *   2026-11-03, item B3; security-architecture.md finding 4, duplication-drift.md section 3). Every
 *   send that existed then moved here with the kind it already had: the gate adds no check a caller
 *   did not make before, so every answer stays what it was. scripts/check-single-entry.ts rule
 *   mail-send refuses a new direct call outside this file.
 *
 *   SAME CALL BELOW. Each message form is one method of EmailService, called with the arguments the
 *   caller passed before and nothing more: `opts` reaches the method only when the message carries
 *   it. Errors from the mail service are not caught here; each caller keeps its own handling.
 * @structure MailMessage · MailIntent · MailOutcome · ThirdPartyCount · sendMail · senderLimitReached
 * @usage
 *   const r = await sendMail(email, { kind: 'owner', account: ghiiRecord }, { form: 'html', subject, html, text });
 *   if (r === 'sent') ...
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item B3).
 */
import type { EmailService, EmailAttachment } from './email.js';
import type { GHIIRecord } from '../storage/interface.js';
import type { AccountTurn } from './account-limits.js';
import type { InviteEmailArgs, KeyInviteEmailArgs, KeyCredentialsEmailArgs } from './email-templates.js';
import { provenOwnerAddress } from './owner-mail-address.js';

/** What goes out: one form per EmailService send method, with that method's arguments. */
export type MailMessage =
  | { form: 'notification'; subject: string; body: string; opts?: { replyTo?: string | null } }
  | { form: 'html'; subject: string; html: string; text: string }
  | {
    form: 'attachments'; subject: string; html: string; text: string; attachments: EmailAttachment[];
    opts?: { replyTo?: string; fromName?: string; headers?: Record<string, string> };
  }
  | { form: 'verification-code'; code: string; locale?: string }
  | { form: 'magic-link'; url: string; locale?: string }
  | { form: 'invite'; args: InviteEmailArgs; locale?: string }
  | { form: 'key-invite'; args: KeyInviteEmailArgs; locale?: string }
  | { form: 'key-credentials'; args: KeyCredentialsEmailArgs; locale?: string };

/** A turn the account allowance gave (account-limits.ts), taken before anything was written. */
export type AccountTurnTaken = Extract<AccountTurn, { ok: true }>;

/** How a third-party mail is bounded: the account's turn, or the sentence that says what bounds it. */
export type ThirdPartyCount = { turn: AccountTurnTaken } | { uncounted: string };

/** The per-sender daily limit on an owner mail: `key` is `<ghii> <sender>`, `perDay` 0 is no limit. */
export interface SenderLimit { key: string; perDay: number }

export type MailIntent =
  | { kind: 'owner'; account: Partial<Pick<GHIIRecord, 'notificationEmail' | 'emailVerifiedAt' | 'emailHash'>> | null | undefined; limit?: SenderLimit }
  | { kind: 'third-party'; to: string; count: ThirdPartyCount }
  | { kind: 'sign-in'; to: string; why: string }
  | { kind: 'operator'; to: string; why: string };

/**
 * What became of the mail: sent; the transport answered false; the node sends no mail; the owner's
 * address is not proven; the sender used today's limit.
 */
export type MailOutcome = 'sent' | 'failed' | 'mail_off' | 'no_address' | 'limit';

/**
 * Owner mails one sender caused in the last 24 hours, by `<ghii> <sender>`. Held in this process: a
 * restart starts the count again, which costs at most one more day's worth (notification-create.ts
 * EMAIL_PER_DAY says the default).
 */
const sentBySender = new Map<string, number[]>();
const DAY_MS = 86_400_000;

function underSenderLimit(limit: SenderLimit, now: number): boolean {
  if (limit.perDay <= 0) return true;
  const recent = (sentBySender.get(limit.key) ?? []).filter(at => now - at < DAY_MS);
  sentBySender.set(limit.key, recent);
  return recent.length < limit.perDay;
}

/** Whether the sender under `limit` has used today's mails, read without counting. */
export function senderLimitReached(limit: SenderLimit): boolean {
  if (limit.perDay <= 0) return false;
  const recent = (sentBySender.get(limit.key) ?? []).filter(at => Date.now() - at < DAY_MS);
  return recent.length >= limit.perDay;
}

/** The address the intent allows, or null when an owner's address is not proven. */
function addressOf(intent: MailIntent): string | null {
  if (intent.kind === 'owner') return provenOwnerAddress(intent.account);
  if (intent.kind === 'third-party' && 'turn' in intent.count && intent.count.turn.ok !== true) {
    throw new Error('mail-gate: a third-party mail names a turn the account allowance did not give');
  }
  return intent.to;
}

/** The one EmailService call for `message`, with the caller's arguments as they were. */
function deliver(email: EmailService, to: string, m: MailMessage): Promise<boolean> {
  switch (m.form) {
    case 'notification':
      return 'opts' in m ? email.sendNotification(to, m.subject, m.body, m.opts) : email.sendNotification(to, m.subject, m.body);
    case 'html':
      return email.sendRaw(to, m.subject, m.html, m.text);
    case 'attachments':
      return 'opts' in m
        ? email.sendWithAttachments(to, m.subject, m.html, m.text, m.attachments, m.opts)
        : email.sendWithAttachments(to, m.subject, m.html, m.text, m.attachments);
    case 'verification-code':
      return email.sendVerificationCode(to, m.code, m.locale);
    case 'magic-link':
      return email.sendMagicLink(to, m.url, m.locale);
    case 'invite':
      return email.sendInvite(to, m.args, m.locale);
    case 'key-invite':
      return email.sendKeyInvite(to, m.args, m.locale);
    case 'key-credentials':
      return email.sendKeyCredentials(to, m.args, m.locale);
  }
}

/**
 * Send `message` as `intent` allows. The checks run in this order: the mail service is on, the
 * address is allowed, the sender is under its daily limit; then one send, and a sent owner mail
 * under a limit is counted.
 */
export async function sendMail(email: EmailService | null | undefined, intent: MailIntent, message: MailMessage): Promise<MailOutcome> {
  if (!email?.enabled) return 'mail_off';
  const to = addressOf(intent);
  if (!to) return 'no_address';
  const limit = intent.kind === 'owner' ? intent.limit : undefined;
  const now = Date.now();
  if (limit && !underSenderLimit(limit, now)) return 'limit';
  const ok = await deliver(email, to, message);
  if (!ok) return 'failed';
  // Counted only while a limit is in force (underSenderLimit made the entry).
  if (limit) sentBySender.get(limit.key)?.push(now);
  return 'sent';
}
