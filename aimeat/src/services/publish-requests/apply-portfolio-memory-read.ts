/**
 * @file src/services/publish-requests/apply-portfolio-memory-read.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner allowed their welcome page to read their memory when they open it
 *   (services/portfolio-read-hold.ts filed it). The page the request names, by the digest of its bytes,
 *   is recorded as allowed. A page replaced since ends the request `outdated`: the owner allowed the
 *   page they were asked about, not the one written after it.
 * @structure applyPortfolioMemoryRead
 * @usage registered in appliers.ts under the kind 'portfolio-memory-read'
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (audit H-9, f-2026aug-h-9).
 */
import { localAccountName } from '../../utils/gaii.js';
import { allowPortfolioRead } from '../portfolio-read-hold.js';
import type { PublishApplyResult, PublishRequest, PublishStoreCtx } from './store.js';

export async function applyPortfolioMemoryRead(ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest): Promise<PublishApplyResult> {
  const ownerName = localAccountName(ownerGhii);
  if (String(request.target.owner ?? '') !== ownerName) return { ok: false, reason: 'the page is not on this account' };
  const allowed = await allowPortfolioRead(ctx, ownerName, String(request.target.digest ?? ''));
  return allowed ? { ok: true } : { ok: false, reason: 'the page was replaced after the request was made' };
}
