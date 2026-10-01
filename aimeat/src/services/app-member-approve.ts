/**
 * @file app-member-approve.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Approving a person into an app's roster, or changing the role they hold: the act
 *   behind POST /v1/apps/:owner/:filename/members, and behind an app invitation that becomes a
 *   membership when its address is verified (services/app-member-invites.ts). Moved here from the
 *   route by extraction, so both callers run one implementation of the seat cap, the term, the carry
 *   plan, the grant reconciliation, the notification and the audit row.
 *
 *   The caller has already decided WHO may do this and validated the input (role shape, account,
 *   date); this file does the act and reports a refusal it can only find out here (SEATS_FULL).
 * @structure memberAddress · appDeepLink · appStem · ApproveMemberInput · approveMember
 * @usage const r = await approveMember(storage, config.nodeId, { appId, owner, filename, account, role, approvedBy, by, ownerGhii });
 * @version-history
 *   v1.0.1 — 2026-10-01 — A seat limit of 0 is refused as "the plan allows no seats", not "all 0 seats are taken".
 *   v1.0.0 — 2026-10-01 — Extracted from routes/app-members.ts POST .../members. Adds the role-change
 *     notification (A4), the notices in the member's language (B4) and the audit row (B2).
 */
import type { Storage } from '../storage/interface.js';
import {
  getMember, putMember, removeRequest, forgetVisit, getCarryPlan, seatsTaken, type AppMemberRecord,
} from './app-members.js';
import { syncGrantsForMember } from './grant-sync.js';
import { recordAppAudit } from './app-audit.js';
import { sendMemberNotice } from './app-member-notices.js';

/**
 * The member's identity for a notification or a grant. A member of THIS node is stored by bare
 * account name and gets the node appended; an identity of another node already carries its own,
 * and appending this node's id to it named nobody.
 */
export const memberAddress = (account: string, nodeId: string) => (account.includes('@') ? account : `${account}@${nodeId}`);

/** A deep link back to the app, which is where every roster notification lands. */
export function appDeepLink(appId: string): string {
  const [o, f] = appId.split('/');
  return `/v1/apps/${encodeURIComponent(o ?? '')}/${encodeURIComponent(f ?? '')}?mode=inline`;
}

/** The app's file name without .html, as the notifications name the app. */
export const appStem = (filename: string) => filename.replace(/\.html?$/i, '');

export interface ApproveMemberInput {
  appId: string;
  /** The app owner's account name, as in the route. */
  owner: string;
  filename: string;
  /** The person, lowercased bare account name (or an identity of another node). */
  account: string;
  role: string;
  level?: number;
  note?: string;
  /** The account that approved, kept on the row. */
  approvedBy: string;
  /** The principal that acted, for the audit row (a GHII or an agent's GAII). */
  by: string;
  /** The owner's bucket (resolveGhii), where the app's audit log lives. */
  ownerGhii: string;
  /** Offering ids named by a caller allowed to name them. Undefined applies the carry plan. */
  offerings?: string[];
  /** A term in days from now. */
  days?: number;
  /** Undefined when not given; null for a membership that does not lapse; else an ISO time. */
  expiresAt?: string | null;
  /** Extra detail for the audit row, such as how the membership began. */
  auditDetail?: Record<string, string | number | boolean | null>;
}

export type ApproveMemberResult =
  | {
      ok: true; member: AppMemberRecord; created: boolean;
      access: { granted: unknown[]; revoked: unknown[]; unchanged: unknown[]; failed: unknown[] } | null;
    }
  | { ok: false; status: 409; code: 'SEATS_FULL'; message: string };

/**
 * Approve the person as `role`, or change their role. Idempotent: approving somebody into the role
 * they hold renews the term. Notifies a new member that they were approved and an existing member
 * that their role changed; a renewal says nothing. Writes one audit row.
 */
export async function approveMember(storage: Storage, nodeId: string, input: ApproveMemberInput): Promise<ApproveMemberResult> {
  const { appId, owner, account, role } = input;
  const before = await getMember(storage, appId, account);
  const plan = await getCarryPlan(storage, appId);

  // A seat count is a product decision with teeth. Refusing past the last seat, and saying how
  // many are taken, is the difference between a limit and a number in a settings screen.
  // Somebody already holding the role is not taking a new seat: this must not block a renewal.
  const cap = plan?.seats?.[role];
  if (typeof cap === 'number' && (!before || before.role !== role)) {
    const taken = await seatsTaken(storage, appId, role);
    if (taken >= cap) {
      return {
        ok: false, status: 409, code: 'SEATS_FULL',
        message: cap === 0
          ? `The plan allows no "${role}" seats. Raise the seat count, or approve them into a different role.`
          : `All ${cap} "${role}" seats are taken (${taken} in use). Remove somebody, raise the seat count, `
            + 'or approve them into a different role.',
      };
    }
  }

  // How long the term runs. An explicit date wins; otherwise the role's declared length applies,
  // counted from NOW, so re-approving somebody is a renewal rather than an extension of a date
  // that may already be in the past.
  const term = plan?.terms?.[role];
  let expiresAt: string | null | undefined;
  if (input.expiresAt !== undefined) {
    expiresAt = input.expiresAt;
  } else if (typeof input.days === 'number' && input.days > 0) {
    expiresAt = new Date(Date.now() + Math.floor(input.days) * 86400_000).toISOString();
  } else if (term?.days) {
    expiresAt = new Date(Date.now() + term.days * 86400_000).toISOString();
  } else if (!before) {
    expiresAt = null;
  }
  // What this role is carried on. An explicit list wins, because a caller who names one means it;
  // otherwise the app's declared plan applies. Without the plan an approval from the panel set a
  // role and carried nothing, so the member was billed at list price on every call while the panel
  // showed them approved.
  const carried = input.offerings ?? (plan?.roles[role] ?? (before ? undefined : []));
  const rec = await putMember(storage, {
    appId, account, role,
    level: input.level,
    note: input.note,
    approvedBy: input.approvedBy,
    offerings: carried,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(term?.renewal ? { renewal: term.renewal } : {}),
  });
  await removeRequest(storage, appId, account);
  // They are decided now, so they leave the guest list rather than appearing in two places.
  await forgetVisit(storage, appId, account);

  // The role decides WHAT they may reach; the grant is what lets them reach it without being
  // billed. Reconcile whenever there is a plan to reconcile AGAINST: an explicit list, a declared
  // plan, or an existing member whose set may now be wrong for their new role.
  const sync = (input.offerings || plan || before)
    ? await syncGrantsForMember(storage, {
        providerOwner: owner.toLowerCase(), providerGhii: `${owner}@${nodeId}`,
        consumer: memberAddress(account, nodeId), appId, role,
        offeringIds: rec.offerings, note: rec.note,
      })
    : null;

  // A new member (or a row that only carried a development right) is told they were approved; an
  // existing member is told their role changed; a renewal of the same role says nothing.
  const joined = !before || !before.role;
  const changed = !joined && before!.role !== role;
  const vars = { app: appStem(input.filename), by: input.approvedBy, role, from: before?.role ?? '' };
  if (joined) await sendMemberNotice(storage, memberAddress(account, nodeId), 'approved', vars, { link: appDeepLink(appId) });
  else if (changed) await sendMemberNotice(storage, memberAddress(account, nodeId), 'role_changed', vars, { link: appDeepLink(appId) });

  await recordAppAudit(storage, {
    ownerGhii: input.ownerGhii, filename: input.filename, by: input.by,
    action: changed ? 'member.role_changed' : 'member.approved',
    detail: { account, from: before?.role || null, to: role, ...(input.auditDetail ?? {}) },
  });

  return {
    ok: true, member: rec, created: !before,
    // Never a bare ok: an approval that carried less than it promised must say so here, because
    // the member finds out as a 402 on their first call otherwise.
    access: sync ? { granted: sync.granted, revoked: sync.revoked, unchanged: sync.unchanged, failed: sync.failed } : null,
  };
}
