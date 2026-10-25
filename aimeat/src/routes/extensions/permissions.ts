/**
 * @file src/routes/extensions/permissions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Extension write/manage permission helpers — role/scope gates and ownership guard.
 *   Extracted from src/routes/extensions.ts to satisfy max-file-lines.
 * @version-history
 *   2026-10-25 — installRoleRefusal: with install role operator an agent of an account that is not
 *     the operator's writes no extension code (install, redeploy, action script); the refusal names
 *     the setting and the operator (Jouni, 2026-10-25, secaudit2026oct22 lead 128).
 *   2026-10-25 — extInstallRole decides only the acts that write code for the account holder in
 *     person: they manage every extension in their own account whatever the setting (secaudit2026oct22).
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
import { isOperatorAccount } from '../../utils/operator-account.js';
import { listOperatorGhiis } from '../../services/operators.js';
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
  /** The act writes the extension's code (an install, a redeploy, an action script). 'install' and
   *  'update-script' count without it; an in-place redeploy under 'update' sets it. */
  writesCode?: boolean;
}

/** Does this act write code, which is what extInstallRole decides for the account holder in person? */
const writesCode = (act: ExtensionAct): boolean => act.writesCode === true || act.action === 'install' || act.action === 'update-script';

/** The caller of an Express request in the ExtensionCaller shape, or null without a session. */
function callerOf(req: Request): ExtensionCaller | null {
  const auth = req.auth;
  if (!auth) return null;
  return { ...auth, owner: auth.owner, roles: auth.roles || [], scopes: (auth as { scopes?: string[] }).scopes || [] };
}

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
 * The install role as a rule on the ACCOUNT. With AIMEAT_EXT_INSTALL_ROLE=operator only the
 * operator's account writes extension code: the operator in person and the operator's agents. An
 * agent of any other account is refused an install, a redeploy and an action script change, as the
 * account holder in person already was (Jouni, 2026-10-25, secaudit2026oct22 lead 128). With the
 * default 'owner' nothing is asked here. Answers the refusal in plain words, naming the setting and
 * the operator, or null when the account may write code.
 */
export async function installRoleRefusal(storage: Storage, config: AimeatConfig, accountName: string): Promise<string | null> {
  if (config.extInstallRole !== 'operator') return null;
  if (isOperatorAccount(await storage.getOwner(accountName))) return null;
  const operators = (await listOperatorGhiis(storage, config)).map(g => localAccountName(g));
  const who = operators.length ? `the operator (${operators.join(', ')})` : 'the operator';
  return 'On this node only the operator\'s account installs or changes add-on code '
    + `(the setting AIMEAT_EXT_INSTALL_ROLE is "operator"). Ask ${who} to install it for you, `
    + 'or to change the setting. You can write to support@operators.';
}

// Does this caller have permission to write extensions?
// The operator (isOperatorCaller: in person, or the operator's agent holding operator:admin) passes.
// Owner role respects the configured extInstallRole gate. Agents pass if they carry the ext:write
// scope (granted by the owner via the profile agent settings) and, under install role operator,
// belong to the operator's account (installRoleRefusal).
export async function hasExtWritePermission(req: Request, config: AimeatConfig, storage: Storage): Promise<boolean> {
  const auth = req.auth;
  if (!auth) return false;
  if (await isOperatorCaller(storage, auth)) return true;
  const allowOwner = config.extInstallRole === 'owner';
  if (allowOwner && isOwnerInPerson(auth)) return true;
  const scopes = (auth as { scopes?: string[] }).scopes || [];
  if (!scopeIsCovered(scopes, 'ext:write')) return false;
  return (await installRoleRefusal(storage, config, auth.owner)) === null;
}

/**
 * Why an install is refused, in plain words: the install role when that is the reason, otherwise the
 * missing permission word. The doors that answered only "would need your permission" told an agent
 * of an ordinary account to ask its owner for a permission the owner could not give.
 */
export async function extWriteRefusalText(req: Request, config: AimeatConfig, storage: Storage): Promise<string> {
  const byRole = req.auth ? await installRoleRefusal(storage, config, req.auth.owner) : null;
  return byRole ?? 'Your assistant would need your permission to install add-ons for you. You can turn this on in Profile → Agents.';
}

/** Why a code write on an installed extension is refused: the install role when the caller's own
 *  account is held back by it, otherwise the plain "Not authorized" the manage doors answer. */
export async function codeWriteRefusalText(req: Request, config: AimeatConfig, storage: Storage, installedBy: string): Promise<string> {
  const byRole = req.auth && req.auth.owner === installedBy ? await installRoleRefusal(storage, config, req.auth.owner) : null;
  return byRole ?? 'Not authorized';
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

// resolveGatedApp moved to services/members-only.ts on 2026-10-01, so the commerce layer and the
// services that charge for a call can ask it; re-exported here for the routes that import it.
export { resolveGatedApp } from '../../services/members-only.js';
