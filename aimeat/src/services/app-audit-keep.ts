/**
 * @file src/services/app-audit-keep.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Keeping an app's audit log, as operations: archive the entries before a date, read
 *   how much of each app's log the owner keeps, and set that limit. Each one holds the owner test and
 *   the refusals its REST route held (POST /v1/apps/:owner/:filename/audit/archive and GET|PUT
 *   /v1/audit/apps/settings in routes/apps/legal.ts), and answers an AppOpOutcome. The routes and
 *   the aimeat_app_manage MCP tool (audit_archive, audit_keep) both call these.
 *
 *   A limit deletes audit entries, so only the account holder in person, or an agent holding
 *   account:security, sets a number (isOwnerPrincipal); an app or an assistant may keep everything.
 *   Archiving deletes nothing, so an agent in the owner's name may.
 * @structure archiveAuditFor · readAuditKeep · setAuditKeep
 * @usage const out = await setAuditKeep(storage, config, caller, req.body?.keep);
 * @version-history
 *   v1.0.0 — 2026-10-05 — Moved out of the handlers of routes/apps/legal.ts by extraction;
 *     aimeat_app_manage calls the service in place of the route over loopback HTTP (secaudit 2026-10, M6).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { localAccountName } from '../utils/gaii.js';
import { isSameAccount } from '../utils/same-account.js';
import { isOwnerPrincipal } from '../auth/account-security.js';
import { resolveAppTarget } from './app-dev-grant.js';
import { archiveAppAuditBefore, setOwnerAuditKeep } from './app-audit.js';
import { listArchives, effectiveKeep, KEEP_MAX } from './app-audit-archive.js';
import { done, refuse, type AppOpCaller, type AppOpOutcome } from './app-op-outcome.js';

/** The caller's own account and its bucket: the same resolution as routes/apps.ts canonicalOwner. */
async function ownAccount(storage: Storage, config: AimeatConfig, caller: AppOpCaller): Promise<{ owner: string; ownerGhii: string }> {
  const owner = localAccountName(caller.owner);
  const t = await resolveAppTarget(storage, config, { callerOwner: owner, act: 'draft' });
  return t.ok ? { owner: t.ownerName, ownerGhii: t.ownerGhii } : { owner, ownerGhii: `${owner}@${config.nodeId}` };
}

/**
 * POST .../audit/archive: the owner's "archive entries before a date". They move into the archive
 * for their year and stay readable with ?archive=<year>. To anybody but the owner the app may as
 * well not exist, so every other caller is answered 404, an operator included.
 */
export async function archiveAuditFor(
  storage: Storage, config: AimeatConfig, caller: AppOpCaller & { anonymous?: boolean },
  ref: { owner: string; filename: string }, before: unknown,
): Promise<AppOpOutcome> {
  let app = await storage.getAppByOwnerName(ref.owner, ref.filename);
  const bare = localAccountName(ref.owner);
  if (!app && bare !== ref.owner) app = await storage.getAppByOwnerName(bare, ref.filename);
  // An anonymous identity is nobody's owner (optionalAuth hands one out on an anonymous node).
  const isOwner = !!app && caller.anonymous !== true && isSameAccount((await ownAccount(storage, config, caller)).owner, app.ownerName);
  if (!app || !isOwner) return refuse(404, 'NOT_FOUND', `App "${ref.filename}" not found in your uploads`);
  if (typeof before !== 'string' || !Number.isFinite(Date.parse(before))) {
    return refuse(400, 'INVALID_INPUT', 'before must be a date, e.g. "2026-01-01" or an ISO time.');
  }
  const moved = await archiveAppAuditBefore(storage, app.ownerGaii, app.filename, new Date(before).toISOString());
  return done({ moved, before: new Date(before).toISOString(), archives: await listArchives(storage, app.ownerGaii, app.filename) });
}

/** GET /v1/audit/apps/settings: how much of each app's log the owner keeps. */
export async function readAuditKeep(storage: Storage, config: AimeatConfig, caller: AppOpCaller): Promise<AppOpOutcome> {
  const { ownerGhii } = await ownAccount(storage, config, caller);
  return done({ ...(await effectiveKeep(storage, ownerGhii)), nodeDefault: config.appAuditKeepDefault });
}

/**
 * PUT /v1/audit/apps/settings: `keep` 0 or "all" keeps everything; a number keeps that many newest
 * entries per app and deletes the rest at once; null returns to the node default. Deleting audit
 * entries is the person's own act (the `audit.` prefix exists so the log of their changes is not
 * theirs to rewrite), so it is refused before anything is written for anybody else.
 */
export async function setAuditKeep(storage: Storage, config: AimeatConfig, caller: AppOpCaller, raw: unknown): Promise<AppOpOutcome> {
  const { ownerGhii } = await ownAccount(storage, config, caller);
  const keep = raw === null ? null : raw === 'all' ? 0 : raw;
  if (keep !== null && (typeof keep !== 'number' || !Number.isInteger(keep) || keep < 0 || keep > KEEP_MAX)) {
    return refuse(400, 'INVALID_INPUT', `keep must be "all", 0 (all), a whole number up to ${KEEP_MAX}, or null for the node default.`);
  }
  const deletes = keep === null ? config.appAuditKeepDefault > 0 : keep > 0;
  if (deletes && !isOwnerPrincipal(caller)) {
    return refuse(403, 'OWNER_ONLY',
      'A limit deletes audit entries, so only the account holder, signed in, can set one. An app or an assistant may keep everything (keep: "all").');
  }
  return done({ ...(await setOwnerAuditKeep(storage, ownerGhii, keep)), nodeDefault: config.appAuditKeepDefault });
}
