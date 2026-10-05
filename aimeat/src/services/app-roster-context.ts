/**
 * @file src/services/app-roster-context.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The context every member-roster and per-app development-right operation starts
 *   from: the app under `owner/filename`, whether it exists, who the caller is, and what they may do
 *   with the roster (the owner, or a member whose role the carry plan lists in `manageRoles`). The
 *   REST routes (routes/app-members.ts, routes/app-members-extra.ts) and the aimeat_app_manage MCP
 *   tool reach it through the services in app-roster-ops.ts, app-roster-write.ts and
 *   app-dev-grant-ops.ts.
 *
 *   Authorisation is the app's owner, resolved through the identity table rather than compared as a
 *   string, so the owner's own agents administer the roster too. A manager is a PERSON holding a
 *   managing role on the live roster, so their agents manage as they do.
 *
 *   The caller is data ({ sub, owner, roles, scopes, app }), never an Express request: the route
 *   passes its verified token, the MCP tool the session's agent identity.
 * @structure RosterCaller · MembersCtx · rosterContext · rosterBucketOf · rosterAudit
 * @usage const c = await rosterContext(storage, config, caller, owner, filename); if (!c.ok) return c;
 * @version-history
 *   v1.1.0 — 2026-10-05 — Moved from routes/app-members-context.ts to a service that takes the caller
 *     as data; a malformed name or a missing app is an AppOpRefusal with the route's status and code.
 *     aimeat_app_manage calls the service in place of the route over loopback HTTP (secaudit 2026-10, M6).
 *   v1.0.0 — 2026-10-01 — Extracted from routes/app-members.ts; adds the plan, the caller's live
 *     member row and `canManage` (IAM round 2, B1), and the audit writer (B2).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { resolveIdentity } from '../utils/gaii.js';
import { resolveGhii } from '../utils/ghii-resolver.js';
import { accountOf, getMember, getCarryPlan, type AppCarryPlan, type AppMemberRecord } from './app-members.js';
import { canManageRoster } from './app-member-rules.js';
import { recordAppAudit, type AppAuditAction, type AppAuditEntry } from './app-audit.js';
import { refuse, type AppOpRefusal, type AppOpCaller } from './app-op-outcome.js';

const FILENAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;
const OWNER_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

/** Who is calling, as data: a route's verified token, or the MCP session's agent. */
export type RosterCaller = AppOpCaller;

/** The app under `owner/filename`, the caller, and what the caller may do with its roster. */
export interface MembersCtx {
  ok: true;
  appId: string; owner: string; filename: string;
  callerAccount: string; callerGaii: string;
  isOwner: boolean;
  /** The owner, or a live member whose role is in plan.manageRoles. */
  canManage: boolean;
  plan: AppCarryPlan | null;
  /** The caller's live member row, or null. */
  callerMember: AppMemberRecord | null;
}

/**
 * The app's bucket key. Resolved where it is needed rather than on every call, because only the
 * existence check, the development-right operations and the audit log touch the app row's owner.
 */
export const rosterBucketOf = (storage: Storage, config: AimeatConfig, owner: string): Promise<string> =>
  resolveGhii(storage, owner, config);

/** The context, or the refusal: 400 INVALID_INPUT for a malformed name, 404 NOT_FOUND for an app that does not exist. */
export async function rosterContext(
  storage: Storage, config: AimeatConfig, caller: RosterCaller, owner: string, filename: string,
): Promise<MembersCtx | AppOpRefusal> {
  if (!FILENAME_RE.test(filename)) return refuse(400, 'INVALID_INPUT', 'Invalid filename.');
  if (!OWNER_RE.test(owner)) return refuse(400, 'INVALID_INPUT', 'Invalid owner.');
  const appId = `${owner}/${filename}`;
  // The app must exist. Without this anybody could ask for access to a made-up app of any owner,
  // and the owner got a notification with working Approve and Decline buttons for nothing; and
  // every read of /me on a made-up filename wrote a visit record, which grew storage without end.
  if (!(await storage.getApp(await rosterBucketOf(storage, config, owner), filename))) return refuse(404, 'NOT_FOUND', 'No such app.');
  // The caller's OWNER, so an agent acting for the app's owner administers as the owner does. The
  // full principal is kept beside it: the roster asks WHO the person is, and an audit line asks
  // which of their agents did the thing.
  const callerGaii = resolveIdentity(caller, config.nodeId);
  const callerAccount = accountOf(callerGaii);
  const isOwner = callerAccount === owner.toLowerCase();
  const [plan, callerMember] = await Promise.all([
    getCarryPlan(storage, appId),
    isOwner ? Promise.resolve(null) : getMember(storage, appId, callerAccount),
  ]);
  return {
    ok: true, appId, owner, filename, callerAccount, callerGaii, isOwner, plan, callerMember,
    canManage: canManageRoster(plan, isOwner, callerMember),
  };
}

/** One roster row in the app's audit log, by the caller. Never throws (recordAppAudit). */
export async function rosterAudit(
  storage: Storage, config: AimeatConfig, c: MembersCtx, action: AppAuditAction, detail: AppAuditEntry['detail'],
): Promise<void> {
  await recordAppAudit(storage, { ownerGhii: await rosterBucketOf(storage, config, c.owner), filename: c.filename, by: c.callerGaii, action, detail });
}
