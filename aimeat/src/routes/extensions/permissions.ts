/**
 * @file src/routes/extensions/permissions.ts
 * @description Extension write/manage permission helpers — role/scope gates and ownership guard.
 *   Extracted from src/routes/extensions.ts to satisfy max-file-lines.
 * @version-history
 *   v1.1.0 — 2026-08-10 — resolveGatedApp(): the runtime half of the config.app owner check, for
 *     records written before the install gate existed. A mismatch reads as no gating.
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

/**
 * Which app does this extension gate, if any — and only when the extension's installer owns it.
 *
 * An extension declares the app whose membership it enforces with `config: { app: owner/file.html }`,
 * and the node then reads that app's roster on the extension's behalf: `caller.member` and
 * `isAppOwner` on the invoke path, and the carry plan on the paywall path. The value comes from the
 * installer's manifest, and nothing compared its owner half against `installedBy` — so an extension
 * could name somebody else's app and be told, per call, what role the caller holds on a roster that
 * is deliberately private, and be carried under that app owner's plan.
 *
 * The install route refuses a mismatch outright (routes/extensions/manifest.ts). This is the runtime
 * half, for records written before that gate existed: a mismatched value is read as no gating rather
 * than as gating somebody else's app. All 8 extensions declaring `app` on aimeat.io name their own
 * installer's app, so nothing in production changes behaviour.
 */
export function resolveGatedApp(ext: { config?: Record<string, unknown>; installedBy: string }): string | null {
  const declared = typeof ext.config?.app === 'string' ? ext.config.app : null;
  if (!declared) return null;
  const appOwner = (declared.split('/')[0] ?? '').toLowerCase();
  // installedBy is a bare owner name, but accept a GHII/GAII form defensively.
  const installer = ext.installedBy.toLowerCase().split('@')[0].split('#').pop() ?? '';
  return appOwner === installer ? declared : null;
}
