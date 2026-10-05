/**
 * @file src/mcp/app-manage-members.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The aimeat_app_manage actions over an app's roster, its carry plan, its audit log
 *   keeping, its development rights and its design spec, on the node's own MCP server. Each action
 *   calls the service its REST route calls (services/app-roster-ops.ts, app-roster-write.ts,
 *   app-audit-keep.ts, app-dev-grant-ops.ts, app-design-spec-ops.ts) with the session as the caller,
 *   and answers the same JSON the route answers under `data`, or the route's refusal as
 *   `CODE: message`.
 *
 *   The tool's fields are snake_case and the services read the routes' camelCase body
 *   (expires_at -> expiresAt, roster_visibility -> rosterVisibility, manage_roles -> manageRoles,
 *   dev_level -> level), as tool-dispatch/app-manage-call.ts sends them for the connector and the CLI.
 *   The owner defaults to the caller's own account, as there.
 * @structure appManageMemberAction(storage, config, caller, action, args) → ToolAnswer | null
 * @usage const out = await appManageMemberAction(storage, config, caller, action, args); if (out) return out;
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial: aimeat_app_manage calls the service in place of the route over
 *     loopback HTTP (secaudit 2026-10, M6).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { AppOpCaller } from '../services/app-op-outcome.js';
import {
  listRoster, rosterMe, readCarryPlan, dismissGuest, sweepRoster, requestMembership, declineRequest,
  rosterAuditTrail, cancelInvite,
} from '../services/app-roster-ops.js';
import { setCarryPlan, setMember, removeRosterMember } from '../services/app-roster-write.js';
import { listAppBuilders, setAppBuilder, removeAppBuilder } from '../services/app-dev-grant-ops.js';
import { readDesignSpecFor, writeDesignSpecFor, clearDesignSpecFor } from '../services/app-design-spec-ops.js';
import { archiveAuditFor, readAuditKeep, setAuditKeep } from '../services/app-audit-keep.js';
import { opAnswer, type ToolAnswer } from './app-manage-answers.js';

type Args = Record<string, unknown>;

/** The named fields that are present. Absent means "leave it alone". */
function pick(args: Args, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) if (args[f] !== undefined && args[f] !== null) out[f] = args[f];
  return out;
}

const present = (v: unknown): boolean => v !== undefined && v !== null;

/**
 * Run one roster, plan, audit-keeping, development-right or design-spec action; null when `action`
 * is none of them. The action's permission word was checked before this (requiredScopeForAction).
 */
export async function appManageMemberAction(
  storage: Storage, config: AimeatConfig, caller: AppOpCaller, action: string, args: Args,
): Promise<ToolAnswer | null> {
  const filename = String(args.filename ?? '');
  const ref = { owner: typeof args.owner === 'string' && args.owner ? args.owner : caller.owner, filename };
  // The tool has no owner field for these: the caller's own app.
  const ownRef = { owner: caller.owner, filename };
  const account = String(args.account ?? '');

  switch (action) {
    case 'members':
      return opAnswer(await listRoster(storage, config, caller, ref, pick(args, ['q', 'limit', 'offset'])));
    case 'member_set': {
      const body = pick(args, ['account', 'email', 'locale', 'role', 'level', 'note', 'offerings', 'days']);
      if (present(args.expires_at)) body.expiresAt = args.expires_at === '' ? null : args.expires_at;
      return opAnswer(await setMember(storage, config, caller, ref, body));
    }
    case 'member_remove':
      return opAnswer(await removeRosterMember(storage, config, caller, ref, account));
    case 'member_decline':
      return opAnswer(await declineRequest(storage, config, caller, ref, account));
    case 'member_dismiss':
      return opAnswer(await dismissGuest(storage, config, caller, ref, account));
    case 'member_plan_get':
      return opAnswer(await readCarryPlan(storage, config, caller, ref));
    case 'member_plan_set': {
      const body = pick(args, ['roles', 'seats', 'terms', 'access']);
      if (present(args.roster_visibility)) body.rosterVisibility = args.roster_visibility;
      if (present(args.manage_roles)) body.manageRoles = args.manage_roles;
      return opAnswer(await setCarryPlan(storage, config, caller, ref, body));
    }
    case 'member_sweep':
      return opAnswer(await sweepRoster(storage, config, caller, ref));
    case 'member_me':
      return opAnswer(await rosterMe(storage, config, caller, ref));
    case 'member_request':
      return opAnswer(await requestMembership(storage, config, caller, ref, args.note));
    case 'member_audit':
      return opAnswer(await rosterAuditTrail(storage, config, caller, ref, { limit: args.limit, before: args.before }));
    case 'member_invite_cancel':
      return opAnswer(await cancelInvite(storage, config, caller, ref, String(args.invite_id ?? '')));
    case 'audit_archive':
      return opAnswer(await archiveAuditFor(storage, config, caller, ownRef, args.before));
    case 'audit_keep': {
      if (args.keep === undefined || args.keep === null || args.keep === '') return opAnswer(await readAuditKeep(storage, config, caller));
      const raw = String(args.keep).trim().toLowerCase();
      // "all" and "default" are words; anything else is read as the number it spells, and the
      // service refuses what is not a whole number.
      const keep = raw === 'all' ? 'all' : raw === 'default' ? null : Number(raw);
      return opAnswer(await setAuditKeep(storage, config, caller, keep));
    }
    case 'builders':
      return opAnswer(await listAppBuilders(storage, config, caller, ownRef));
    case 'builder_set':
      return opAnswer(await setAppBuilder(storage, config, caller, ownRef, account, { level: args.dev_level, ...pick(args, ['note']) }));
    case 'builder_remove':
      return opAnswer(await removeAppBuilder(storage, config, caller, ownRef, account));
    case 'spec':
      return opAnswer(await readDesignSpecFor(storage, config, caller, ref));
    case 'spec_set':
      return opAnswer(await writeDesignSpecFor(storage, config, caller, ref, pick(args, ['markdown', 'expected_revision'])));
    case 'spec_clear':
      return opAnswer(await clearDesignSpecFor(storage, config, caller, ref));
    default:
      return null;
  }
}
