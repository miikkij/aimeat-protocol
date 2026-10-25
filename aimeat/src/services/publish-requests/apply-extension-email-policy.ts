/**
 * @file src/services/publish-requests/apply-extension-email-policy.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An operator allowed an extension to email any address (services/extension-email-
 *   policy-ask.ts filed the question). The grant is written only for what the operator was asked
 *   about: the same extension, installed by the same account, at the same version and with the same
 *   action scripts. Anything else ends the request `outdated`, and the one who asked hears why.
 * @structure applyExtensionEmailPolicy
 * @usage registered in appliers.ts under the kind 'extension-email-policy'
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, leads 294 and 354 reworked; the approval standard).
 */
import { localAccountName } from '../../utils/gaii.js';
import { emitChange } from '../event-bus.js';
import { actionCodeDigest, EMAIL_POLICY_KEY, UNRESTRICTED_EMAIL } from '../extension-email-policy-ask.js';
import type { PublishApplyResult, PublishRequest, PublishStoreCtx } from './store.js';

export async function applyExtensionEmailPolicy(ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest): Promise<PublishApplyResult> {
  const name = String(request.target.extension ?? '');
  const ext = name ? await ctx.storage.getExtension(name) : null;
  if (!ext) return { ok: false, reason: 'the extension was removed' };
  if (ext.installedBy !== String(request.target.installer ?? '') || ext.installedBy !== localAccountName(ownerGhii)) {
    return { ok: false, reason: 'the extension now belongs to another account' };
  }
  if (ext.version !== String(request.target.version ?? '') || actionCodeDigest(ext.actions) !== String(request.target.digest ?? '')) {
    return { ok: false, reason: "the extension's code changed after the request was made" };
  }
  const updated = await ctx.storage.updateExtension(name, { config: { ...(ext.config ?? {}), [EMAIL_POLICY_KEY]: UNRESTRICTED_EMAIL } });
  if (!updated) return { ok: false, reason: 'the change could not be saved' };
  emitChange('extensions');
  return { ok: true };
}
