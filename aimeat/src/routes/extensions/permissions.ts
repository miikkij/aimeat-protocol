/**
 * @file src/routes/extensions/permissions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Extension write/manage permission helpers — role/scope gates and ownership guard.
 *   Extracted from src/routes/extensions.ts to satisfy max-file-lines.
 * @version-history
 *   2026-11-04 — ExtensionCaller, ExtensionAct, canManageExtensionAs and canSeeExtensionInstanceAs,
 *     the rule without an Express request, moved unchanged to services/extension-access/manage.ts,
 *     which the MCP tools import; the Express forms here ask it (codebase analysis 2026-11-03, D-f).
 *   2026-10-29 — installRoleRefusal moved unchanged to services/extension-install-role.ts and re-exported
 *     here, so the package component registrar asks the same rule (secaudit2026oct26 round 8c).
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
import { isOwnerInPerson } from '../../utils/gaii.js';
import { scopeIsCovered } from '../../utils/scope-coverage.js';
import { installRoleRefusal } from '../../services/extension/install-role.js';
import { isOperatorCaller } from '../../services/operator-override.js';
import { canManageExtensionAs, type ExtensionCaller, type ExtensionAct } from '../../services/extension-access/manage.js';

/** The caller of an Express request in the ExtensionCaller shape, or null without a session. */
function callerOf(req: Request): ExtensionCaller | null {
  const auth = req.auth;
  if (!auth) return null;
  return { ...auth, owner: auth.owner, roles: auth.roles || [], scopes: (auth as { scopes?: string[] }).scopes || [] };
}

/** The install role as a rule on the account (services/extension/install-role.ts), re-exported for the doors. */
export { installRoleRefusal };

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

// resolveGatedApp moved to services/members-only.ts on 2026-10-01, so the commerce layer and the
// services that charge for a call can ask it; re-exported here for the routes that import it.
export { resolveGatedApp } from '../../services/members-only.js';
