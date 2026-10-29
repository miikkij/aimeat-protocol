/**
 * @file src/services/publish-requests/apply-extension-code.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An operator allowed the extension code a package brought into an account that may not
 *   install extension code (services/extension-code-hold.ts filed the question). The hold is taken off
 *   and the extension is switched on the way the activate door switches it on: its schedules, its
 *   capability rows and its `@activate` jobs. Only what the operator was asked about is switched on:
 *   the same extension, installed by the same account, still waiting on this request, at the same
 *   version and with the same action scripts. Anything else ends the request `outdated`.
 * @structure applyExtensionCode
 * @usage registered in appliers.ts under the kind 'extension-code'
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (secaudit2026oct26 round 8c, extensions-08).
 */
import { localAccountName } from '../../utils/gaii.js';
import { actionCodeDigest } from '../extension-email-policy-ask.js';
import { heldCodeRequest, withoutCodeHold } from '../extension-code-hold.js';
import { activateExtension } from '../extension-lifecycle.js';
import { getActiveScheduler } from '../scheduler.js';
import type { PublishApplyResult, PublishRequest, PublishStoreCtx } from './store.js';

export async function applyExtensionCode(ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest): Promise<PublishApplyResult> {
  const name = String(request.target.extension ?? '');
  const ext = name ? await ctx.storage.getExtension(name) : null;
  if (!ext) return { ok: false, reason: 'the extension was removed' };
  if (ext.installedBy !== String(request.target.installer ?? '') || ext.installedBy !== localAccountName(ownerGhii)) {
    return { ok: false, reason: 'the extension now belongs to another account' };
  }
  if (heldCodeRequest(ext.config) !== request.id) return { ok: false, reason: 'the extension no longer waits for this answer' };
  if (ext.version !== String(request.target.version ?? '') || actionCodeDigest(ext.actions) !== String(request.target.digest ?? '')) {
    return { ok: false, reason: "the extension's code changed after the request was made" };
  }
  const config = withoutCodeHold(ext.config ?? {});
  const cleared = await ctx.storage.updateExtension(name, { config });
  if (!cleared) return { ok: false, reason: 'the change could not be saved' };
  // The schedules belong to the one who installed it, as the package install registers them.
  await activateExtension({ storage: ctx.storage, config: ctx.config, scheduler: getActiveScheduler() }, { ...ext, config }, request.requested_by.principal);
  return { ok: true };
}
