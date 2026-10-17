/**
 * @file src/services/publish-requests/apply-app.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The approved publish request for an app: the one change it names (list it, open it to
 *   anyone, or remove its access code) is made as the owner, through services/app-settings.ts
 *   applyOwnerSettingsUpdate, the function PATCH /v1/apps/:filename and aimeat_app_manage call
 *   (plan doc-mvcn6c7e4e5q, V4).
 *
 *   THE OWNER APPROVED WHAT THEY SAW. The request carries the app's live version number. A deleted
 *   app, a new version published since, or a field that no longer holds the value the request was
 *   made from makes the approval outdated instead of exposing something nobody looked at.
 * @structure applyAppPublish(ctx, ownerGhii, request)
 * @usage PUBLISH_APPLIERS.app (appliers.ts)
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4: apps).
 */
import type { AppRecord } from '../../storage/interface.js';
import { appListingOf } from '../../storage/interface.js';
import { localAccountName } from '../../utils/gaii.js';
import { appAccessOf } from '../app-access.js';
import { applyOwnerSettingsUpdate, type AppSettingsInput } from '../app-settings.js';
import { resolveAppUrls } from '../app-urls.js';
import type { PublishApplyResult, PublishRequest, PublishStoreCtx } from './store.js';

/** The field's value now, in the words the request was made in. */
function fieldNow(app: AppRecord, field: string): unknown {
  if (field === 'listing') return appListingOf(app);
  if (field === 'open_to') return appAccessOf(app);
  if (field === 'access_code') return app.accessCode ? 'set' : null;
  return undefined;
}

/** The settings body that makes the change, as the owner would send it. */
const CHANGE_BODY: Record<string, AppSettingsInput> = {
  listing: { listing: 'listed' },
  open_to: { open_to: 'anyone' },
  access_code: { access_code: null },
};

export async function applyAppPublish(ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest): Promise<PublishApplyResult> {
  const ownerName = localAccountName(ownerGhii);
  const filename = String(request.target.filename ?? '');
  const field = request.change.field;
  const body = CHANGE_BODY[field];
  if (!filename || String(request.target.owner ?? '') !== ownerName || !body) return { ok: false, reason: 'the app is not on this account' };
  // The canonical bucket first, then the owner name across buckets, as PATCH /v1/apps/:filename looks.
  let app = await ctx.storage.getApp(ownerGhii, filename);
  if (!app) {
    const found = await ctx.storage.getAppByOwnerName(ownerName, filename);
    if (found && found.ownerName === ownerName) app = found;
  }
  if (!app) return { ok: false, reason: 'the app was deleted' };
  if (app.versionNumber !== Number(request.target.version)) return { ok: false, reason: 'a new version of the app was published after the request was made' };
  const now = fieldNow(app, field);
  if (now === request.change.to) return { ok: true };
  if (now !== request.change.from) return { ok: false, reason: 'the app\'s settings changed after the request was made' };
  const out = await applyOwnerSettingsUpdate(ctx.storage, ctx.config,
    // The owner in person: they approved it.
    { ownerGaii: app.ownerGaii, ownerName, filename, callerGaii: ownerGhii }, body);
  if ('refusal' in out) return { ok: false, reason: out.refusal.message };
  const url = (await resolveAppUrls(ctx.config, ctx.storage, [{ owner: ownerName, filename }]))[`${ownerName}/${filename}`];
  return url ? { ok: true, url } : { ok: true };
}
