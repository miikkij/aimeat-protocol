/**
 * @file src/services/publish-requests/apply-account-setting.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner allowed one of their agents or apps to loosen an account setting it may not
 *   loosen alone. One setting is asked this way: "Ask me before my secret is sent to a new address for
 *   the first time" switched off (services/secret-host-ask-setting.ts filed it). The applier writes
 *   exactly that, recording who asked; anything else ends the request `outdated`.
 * @structure applyAccountSetting
 * @usage registered in appliers.ts under the kind 'account-setting'
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, leads 68 and 386 reworked; the approval standard).
 */
import { SECRET_HOST_ASK_FIELD, writeSecretHostAsk } from '../secret-host-ask-setting.js';
import type { PublishApplyResult, PublishRequest, PublishStoreCtx } from './store.js';

export async function applyAccountSetting(ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest): Promise<PublishApplyResult> {
  if (request.target.setting !== SECRET_HOST_ASK_FIELD || request.target.on !== 'false') {
    return { ok: false, reason: 'this setting cannot be changed through a request' };
  }
  await writeSecretHostAsk(ctx, ownerGhii, false, request.requested_by.principal);
  return { ok: true };
}
