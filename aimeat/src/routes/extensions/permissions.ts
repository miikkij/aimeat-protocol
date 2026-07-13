/**
 * @file src/routes/extensions/permissions.ts
 * @description Extension write/manage permission helpers — role/scope gates and ownership guard.
 *   Extracted from src/routes/extensions.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/extensions.ts (max-file-lines)
 */
import type { Request } from 'express';
import type { AimeatConfig } from '../../config.js';

// Does this caller have permission to write extensions?
// Operator role bypasses everything. Owner role respects the configured
// extInstallRole gate. Agents pass if they carry the ext:write scope
// (granted by the owner via the profile agent settings).
export function hasExtWritePermission(req: Request, config: AimeatConfig): boolean {
  const auth = req.auth;
  if (!auth) return false;
  const roles = auth.roles || [];
  if (roles.includes('operator')) return true;
  const allowOwner = config.extInstallRole === 'owner';
  if (allowOwner && roles.includes('owner') && !roles.includes('agent')) return true;
  const scopes = (auth as { scopes?: string[] }).scopes || [];
  return scopes.includes('*') || scopes.includes('ext:*') || scopes.includes('ext:write');
}

// Can this caller manage an already-installed extension whose installedBy field
// is the given owner name? Operators bypass; otherwise the caller's owner field
// must match installedBy (so they can't touch another owner's extensions) AND
// they must have write permission (owner role or ext:write scope).
export function canManageInstalledExt(req: Request, config: AimeatConfig, installedBy: string): boolean {
  const auth = req.auth;
  if (!auth) return false;
  if ((auth.roles || []).includes('operator')) return true;
  if (auth.owner !== installedBy) return false;
  return hasExtWritePermission(req, config);
}
