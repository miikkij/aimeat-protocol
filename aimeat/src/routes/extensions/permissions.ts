/**
 * @file src/routes/extensions/permissions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Extension write/manage permission helpers — role/scope gates and ownership guard.
 *   Extracted from src/routes/extensions.ts to satisfy max-file-lines.
 * @version-history
 *   v1.3.2 — 2026-10-05 — The account holder in person is asked with isOwnerInPerson (utils/gaii.ts; secaudit 2026-10, C4).
 *   v1.3.1 — 2026-10-05 — ext:write is asked with scopeIsCovered (secaudit 2026-10, C3).
 *   v1.3.0 — 2026-10-05 — The sync canManageInstalledExt and canSeeExtensionInstance are gone: routes/extensions/instances.ts asks mayManageInstalledExt, and canSeeExtensionInstanceAs takes the caller's isOperatorCaller() answer instead of reading the operator role off the session (secaudit 2026-10, C2).
 *   v1.2.0 — 2026-10-05 — Operator checks ask isOperatorCaller/operatorOverride: the operator's agent holding operator:admin passes as on MCP, and a pass in another person's account writes the operator trail (secaudit 2026-10, C2). hasExtWritePermission and canManageExtensionAs are async and take storage; mayManageInstalledExt is the async request form. canManageInstalledExt and canSeeExtensionInstance(As) keep the sync role check for routes/extensions/instances.ts, which is outside this change.
 *   v1.1.1 — 2026-09-26 — The creator and installer names come from localAccountName (utils/gaii.ts),
 *     which keeps an identity of another node whole, so it never names the local namesake
 *     (secaudit 2026-09, F-1).
 *   v1.1.0 — 2026-08-10 — resolveGatedApp(): the runtime half of the config.app owner check, for
 *     records written before the install gate existed. A mismatch reads as no gating.
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/extensions.ts (max-file-lines)
 */
import type { Request } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { localAccountName, isOwnerInPerson } from '../../utils/gaii.js';
import { scopeIsCovered } from '../../utils/scope-coverage.js';
import { isOperatorCaller, operatorOverride, type OperatorAuth } from '../../services/operator-override.js';

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
}

/** The caller of an Express request in the ExtensionCaller shape, or null without a session. */
function callerOf(req: Request): ExtensionCaller | null {
  const auth = req.auth;
  if (!auth) return null;
  return { ...auth, owner: auth.owner, roles: auth.roles || [], scopes: (auth as { scopes?: string[] }).scopes || [] };
}

/** The installer half of the rule: the caller's account installed it and the caller holds the
 *  write permission (owner role where extInstallRole allows it, or the ext:write scope). */
function installerMayManage(caller: ExtensionCaller, config: AimeatConfig, installedBy: string): boolean {
  if (caller.owner !== installedBy) return false;
  if (config.extInstallRole === 'owner' && isOwnerInPerson(caller)) return true;
  return scopeIsCovered(caller.scopes, 'ext:write');
}

// Does this caller have permission to write extensions?
// The operator (isOperatorCaller: in person, or the operator's agent holding operator:admin) passes.
// Owner role respects the configured extInstallRole gate. Agents pass if they carry the ext:write
// scope (granted by the owner via the profile agent settings).
export async function hasExtWritePermission(req: Request, config: AimeatConfig, storage: Storage): Promise<boolean> {
  const auth = req.auth;
  if (!auth) return false;
  if (await isOperatorCaller(storage, auth)) return true;
  const allowOwner = config.extInstallRole === 'owner';
  if (allowOwner && isOwnerInPerson(auth)) return true;
  const scopes = (auth as { scopes?: string[] }).scopes || [];
  return scopeIsCovered(scopes, 'ext:write');
}

/**
 * Can this caller manage an already-installed extension whose installedBy field is the given owner
 * name? The installer's own principal holding the write permission passes; otherwise only the
 * operator, and then the operator trail is written (operatorOverride).
 */
export async function mayManageInstalledExt(
  req: Request, config: AimeatConfig, storage: Storage, installedBy: string, act: ExtensionAct,
): Promise<boolean> {
  const caller = callerOf(req);
  if (!caller) return false;
  return canManageExtensionAs(storage, config, caller, installedBy, act);
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
  if (installerMayManage(caller, config, installedBy)) return true;
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

// resolveGatedApp moved to services/members-only.ts on 2026-10-01, so the commerce layer and the
// services that charge for a call can ask it; re-exported here for the routes that import it.
export { resolveGatedApp } from '../../services/members-only.js';
