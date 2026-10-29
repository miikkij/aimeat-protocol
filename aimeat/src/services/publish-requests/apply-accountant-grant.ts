/**
 * @file src/services/publish-requests/apply-accountant-grant.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The client allowed an older accountant grant the estimate could not place
 *   (services/finance/accountant-grant-ask.ts filed it): the entry is dated now and recorded as
 *   confirmed, so the account that holds the name keeps reading the books. An entry gone from the list,
 *   or a name that another account holds since the question (registered at another time), ends the
 *   request `outdated` and changes nothing.
 * @structure applyAccountantGrant
 * @usage registered in appliers.ts under the kind 'accountant-grant'
 * @version-history
 *   v1.0.0 -- 2026-10-29 -- Initial (secaudit2026oct26 round 8c, finance/accountant-access:grant-survives-erasure-rebinds-on-name-reuse).
 */
import { localAccountOf } from '../../utils/gaii.js';
import { listAccountants, confirmAccountantEntry } from '../finance/accountant-access.js';
import type { PublishApplyResult, PublishRequest, PublishStoreCtx } from './store.js';

export async function applyAccountantGrant(ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest): Promise<PublishApplyResult> {
  const accountant = String(request.target.accountant ?? '');
  if (!accountant || !(await listAccountants(ctx.storage, ownerGhii)).includes(accountant)) {
    return { ok: false, reason: 'this person is no longer on your list of who may read your books' };
  }
  const name = localAccountOf(accountant);
  const holder = name ? await ctx.storage.getOwner(name) : null;
  if (!holder || holder.createdAt !== String(request.target.registered_at ?? '')) {
    return { ok: false, reason: 'another account holds this name since the question was asked' };
  }
  return (await confirmAccountantEntry(ctx.storage, ownerGhii, accountant))
    ? { ok: true }
    : { ok: false, reason: 'this person is no longer on your list of who may read your books' };
}
