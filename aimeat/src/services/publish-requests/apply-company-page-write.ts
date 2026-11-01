/**
 * @file src/services/publish-requests/apply-company-page-write.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner allowed a writer without company:write to change the page their company shows
 *   at its address through the file routes (services/company/company-page-key.ts filed it). That writer
 *   may write and remove `company/<id>/index.html` from now on, as it could before the rule. A company
 *   gone or moved to another account since, or a writer no longer waiting on this request, ends the
 *   request `outdated`.
 * @structure applyCompanyPageWrite
 * @usage registered in appliers.ts under the kind 'company-page-write'
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (secaudit2026oct31w2 round 11).
 */
import { allowCompanyPageWriter } from '../company/company-page-key.js';
import type { PublishApplyResult, PublishRequest, PublishStoreCtx } from './store.js';

export async function applyCompanyPageWrite(ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest): Promise<PublishApplyResult> {
  const companyId = String(request.target.company ?? '');
  const writer = String(request.target.writer ?? '');
  if (!companyId || !writer) return { ok: false, reason: 'the request names no company page' };
  const changed = await allowCompanyPageWriter(ctx, ownerGhii, companyId, writer, request.id);
  return changed ? { ok: true } : { ok: false, reason: 'the company is gone, or the writer no longer waits for this answer' };
}
