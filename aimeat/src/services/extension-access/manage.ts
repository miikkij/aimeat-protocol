/**
 * @file src/services/extension-access/manage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may manage an installed extension, and who may see an instance of one: the rule
 *   without an Express request, which the routes (routes/extensions/permissions.ts) and the MCP
 *   tools (mcp/extensions.ts) both ask.
 * @structure ExtensionCaller · ExtensionAct · canManageExtensionAs(storage, config, caller, installedBy, act) ·
 *   canSeeExtensionInstanceAs(caller, createdBy, isOperator)
 * @usage if (!await canManageExtensionAs(storage, config, caller, ext.installedBy, { action: 'delete', subject: name })) refuse();
 * @version-history
 *   v1.0.0 — 2026-11-04 — Moved unchanged from routes/extensions/permissions.ts (ExtensionCaller,
 *     ExtensionAct, writesCode, installerMayManage, canManageExtensionAs, canSeeExtensionInstanceAs),
 *     so the MCP tools take the rule from a service; the Express forms stay in permissions.ts
 *     (codebase analysis 2026-11-03, item D-f). The rule's history is in that file's header.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { localAccountName, isOwnerInPerson } from '../../utils/gaii.js';
import { scopeIsCovered } from '../../utils/scope-coverage.js';
import { installRoleRefusal } from '../extension-install-role.js';
import { isOperatorCaller, operatorOverride, type OperatorAuth } from '../operator-override.js';

/** The caller as both surfaces describe it: the session fields the operator check reads, plus the
 *  account name the installer is compared with. */
export interface ExtensionCaller extends OperatorAuth {
  owner: string;
  roles: string[];
  scopes: string[];
}

/** What the operator trail names when the operator manages another person's extension. */
export interface ExtensionAct {
  /** 'update', 'delete', 'activate', 'deactivate', 'read-source', ... */
  action: string;
  /** The extension's name. */
  subject: string;
  /** The act writes the extension's code (an install, a redeploy, an action script). 'install' and
   *  'update-script' count without it; an in-place redeploy under 'update' sets it. */
  writesCode?: boolean;
}

/** Does this act write code, which is what extInstallRole decides for the account holder in person? */
const writesCode = (act: ExtensionAct): boolean => act.writesCode === true || act.action === 'install' || act.action === 'update-script';

/** The installer half of the rule: the caller's account installed it and the caller holds the
 *  write permission (owner role where extInstallRole allows it, or the ext:write scope).
 *
 *  extInstallRole decides who writes code. It does not stop the account holder in person from
 *  removing, switching off, configuring or narrowing an extension in their own account: with
 *  'operator' an agent of theirs holding ext:write could install one, and the person was then the
 *  one principal of the account refused to manage it (secaudit2026oct22). */
function installerMayManage(caller: ExtensionCaller, config: AimeatConfig, installedBy: string, act: ExtensionAct): boolean {
  if (caller.owner !== installedBy) return false;
  if (isOwnerInPerson(caller) && (config.extInstallRole === 'owner' || !writesCode(act))) return true;
  return scopeIsCovered(caller.scopes, 'ext:write');
}

/**
 * The same rule, without an Express request.
 *
 * The MCP tools activate, deactivate and delete extensions too, and they had NO ownership check at
 * all: any agent holding `ext:write` could take another owner's extension offline or uninstall it
 * outright. The HTTP route has refused that since it was written, through the function above — but
 * the function needed a `req`, so the surface without one simply did not call it. That is the whole
 * shape of the drift: a guard shaped like one route does not reach the other.
 *
 * The installer's own principal passes when it holds the write permission (owner role, or the
 * ext:write scope for an agent). The operator passes on any extension (isOperatorCaller, the same
 * answer on both surfaces), and a pass on another person's extension writes the operator trail.
 */
export async function canManageExtensionAs(
  storage: Storage,
  config: AimeatConfig,
  caller: ExtensionCaller,
  installedBy: string,
  act: ExtensionAct,
): Promise<boolean> {
  if (writesCode(act) && caller.owner === installedBy && (await installRoleRefusal(storage, config, caller.owner)) !== null) return false;
  if (installerMayManage(caller, config, installedBy, act)) return true;
  if (caller.owner === installedBy) return isOperatorCaller(storage, caller);
  return operatorOverride(storage, config, caller,
    { ownerOf: installedBy, area: 'extension', action: act.action, subject: act.subject });
}

/**
 * May this caller SEE an extension instance somebody created?
 *
 * The read counterpart of mayManageInstalledExt, and it exists because the three write doors on
 * /v1/extensions/:name/instances were fenced and the two read doors were not. `requireAuth()` was
 * the whole gate on GET, so any authenticated principal on the node could list every owner's
 * instances of any installed extension and open one by id: the instance ids, `createdBy` (another
 * owner's NAME), status, timestamps, and every config value the manifest had not marked secret —
 * endpoints, tenant ids, account identifiers. Secret-marked fields were masked, so credentials did
 * not leak; the shape around them did. Found 2026-09-04 by giving e2e-extension-secrets a second
 * principal, which it had never had.
 *
 * DELIBERATELY NOT mayManageInstalledExt. That one also demands the WRITE permission (owner role or
 * the ext:write scope), which is the right bar for delete and the wrong one for read: an agent
 * scoped to read its owner's own configuration should not need write to do it. The operator passes,
 * as everywhere in this file; otherwise the caller's owner must be the one who created the row.
 *
 * `isOperator` is the caller's isOperatorCaller() answer, asked ONCE by the route before it filters
 * a list, so a list of N instances costs one operator lookup and not N.
 */
export function canSeeExtensionInstanceAs(
  caller: { owner: string },
  createdBy: string,
  isOperator: boolean,
): boolean {
  if (isOperator) return true;
  // createdBy is a bare owner name; accept a GHII/GAII form defensively, as resolveGatedApp does.
  const creator = localAccountName(createdBy.toLowerCase());
  return caller.owner.toLowerCase() === creator;
}
