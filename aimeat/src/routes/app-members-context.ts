/**
 * @file app-members-context.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The request context every member-roster route starts from: the app under
 *   `:owner/:filename`, whether it exists, who the caller is, and what they may do with the roster
 *   (the owner, or a member whose role the carry plan lists in `manageRoles`). Shared by
 *   routes/app-members.ts and routes/app-members-extra.ts, moved out of the first by extraction.
 *
 *   Authorisation is the app's owner, resolved through the identity table rather than compared as a
 *   string, so the owner's own agents administer the roster too. A manager is a PERSON holding a
 *   managing role on the live roster, so their agents manage as they do.
 * @structure membersContext(config, storage) → { context, bucketOf, audit, sendContextError }
 * @usage const { context, audit } = membersContext(config, storage);
 * @version-history
 *   v1.0.0 — 2026-10-01 — Extracted from routes/app-members.ts; adds the plan, the caller's live
 *     member row and `canManage` (IAM round 2, B1), and the audit writer (B2).
 */
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { resolveGhii } from '../utils/ghii-resolver.js';
import { accountOf, getMember, getCarryPlan, type AppCarryPlan, type AppMemberRecord } from '../services/app-members.js';
import { canManageRoster } from '../services/app-member-rules.js';
import { recordAppAudit, type AppAuditAction, type AppAuditEntry } from '../services/app-audit.js';

const FILENAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;
const OWNER_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

/** The app under `:owner/:filename`, the caller, and what the caller may do with its roster. */
export interface MembersCtx {
  appId: string; owner: string; filename: string;
  callerAccount: string; callerGaii: string;
  isOwner: boolean;
  /** The owner, or a live member whose role is in plan.manageRoles. */
  canManage: boolean;
  plan: AppCarryPlan | null;
  /** The caller's live member row, or null. */
  callerMember: AppMemberRecord | null;
}

export type MembersCtxResult = MembersCtx | { bad: string } | { missing: true };

export function membersContext(config: AimeatConfig, storage: Storage) {
  /**
   * The app's bucket key. Resolved where it is needed rather than on every call, because only the
   * existence check, the development-right routes and the audit log touch the app row's owner.
   */
  const bucketOf = (owner: string) => resolveGhii(storage, owner, config);

  async function context(req: Request): Promise<MembersCtxResult> {
    const owner = String(req.params.owner ?? '');
    const filename = String(req.params.filename ?? '');
    if (!FILENAME_RE.test(filename)) return { bad: 'Invalid filename.' };
    if (!OWNER_RE.test(owner)) return { bad: 'Invalid owner.' };
    const appId = `${owner}/${filename}`;
    // The app must exist. Without this anybody could ask for access to a made-up app of any owner,
    // and the owner got a notification with working Approve and Decline buttons for nothing; and
    // every read of /me on a made-up filename wrote a visit record, which grew storage without end.
    if (!(await storage.getApp(await bucketOf(owner), filename))) return { missing: true };
    // The caller's OWNER, so an agent acting for the app's owner administers as the owner does. The
    // full principal is kept beside it: the roster asks WHO the person is, and an audit line asks
    // which of their agents did the thing.
    const callerGaii = resolveIdentity(req.auth!, config.nodeId);
    const callerAccount = accountOf(callerGaii);
    const isOwner = callerAccount === owner.toLowerCase();
    const [plan, callerMember] = await Promise.all([
      getCarryPlan(storage, appId),
      isOwner ? Promise.resolve(null) : getMember(storage, appId, callerAccount),
    ]);
    return {
      appId, owner, filename, callerAccount, callerGaii, isOwner, plan, callerMember,
      canManage: canManageRoster(plan, isOwner, callerMember),
    };
  }

  /** Answer a context that is not an app: 400 for a malformed name, 404 for an app that does not exist. True when answered. */
  function sendContextError(res: Response, c: MembersCtxResult): c is { bad: string } | { missing: true } {
    if ('bad' in c) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', c.bad)); return true; }
    if ('missing' in c) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such app.')); return true; }
    return false;
  }

  /** One roster row in the app's audit log, by the caller. Never throws (recordAppAudit). */
  async function audit(c: MembersCtx, action: AppAuditAction, detail: AppAuditEntry['detail']): Promise<void> {
    await recordAppAudit(storage, { ownerGhii: await bucketOf(c.owner), filename: c.filename, by: c.callerGaii, action, detail });
  }

  return { context, bucketOf, audit, sendContextError };
}
