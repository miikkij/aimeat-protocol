/**
 * @file src/services/publish-requests/apply-lia-approval.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner allowed the approval of a balancing test that one of their agents or apps
 *   asked for (services/compliance/lia-ops.ts filed it, marked `in_person`: only the account holder
 *   signed in themselves allows it). The applier approves exactly the test the request names, as the
 *   owner, recording who asked. A test changed since the question was filed is not approved: the
 *   request binds the digest of its content, and the applier ends such a request with the reason.
 * @structure applyLiaApproval
 * @usage registered in appliers.ts under the kind 'lia-approval'
 * @version-history
 *   v1.0.0 — 2026-11-13 — Initial.
 */
import { localAccountName } from '../../utils/gaii.js';
import { approveLiaAs } from '../compliance/lia-write.js';
import type { PublishApplyResult, PublishDecidedBy, PublishRequest, PublishStoreCtx } from './store.js';

export async function applyLiaApproval(
  ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest, decided?: PublishDecidedBy,
): Promise<PublishApplyResult> {
  const ownerName = localAccountName(ownerGhii);
  const { app_owner: appOwner, app, lia, digest, review_months: months } = request.target;
  // The request is the owner's own: it never names another account's app.
  if (!ownerName || appOwner !== ownerName || typeof app !== 'string' || typeof lia !== 'string' || typeof digest !== 'string') {
    return { ok: false, reason: 'this request does not name a balancing test of this account' };
  }
  // The conclusion is the account holder's own: only they, signed in themselves, approve it.
  if (!decided || decided.kind !== 'human' || decided.by !== ownerGhii) {
    return { ok: false, reason: 'only the account holder, signed in themselves, approves a balancing test' };
  }
  const done = await approveLiaAs(ctx, { kind: 'app', ownerName, app }, lia, {
    approvedBy: ownerGhii, requestedBy: request.requested_by.principal, digest,
    ...(typeof months === 'number' ? { reviewMonths: months } : {}),
  });
  return done.ok ? { ok: true } : { ok: false, reason: done.message };
}
