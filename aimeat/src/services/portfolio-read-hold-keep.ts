/**
 * @file src/services/portfolio-read-hold-keep.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The once-per-node boot step that records every welcome page that exists at the update
 *   as allowed to read its owner's memory, so that afterwards a page with no record is known to be one
 *   written since (secaudit2026oct31w2 round 11, portfolio-read-hold:absent-record-adopted-at-first-read).
 *
 *   WHY. services/portfolio-read-hold.ts decided "a page from before this check" by the absence of its
 *   record at the first read. Absence cannot tell an old page from one an agent or app without
 *   memory:read stored later through a route that noted no writer, so such a page was adopted too and
 *   then read the owner's memory through the owner's visit.
 *
 *   POSITIVE EVIDENCE ONLY (.claude/rules/backend.md). The step records a page only when the page is
 *   served now, was stored before the rule took effect on this node (once-only-step.ts keptBefore), and
 *   has no record yet; a page with a record keeps it as it is. Nothing is removed or narrowed: every
 *   page it records reads exactly as it did. Its finished record (PORTFOLIO_PAGES_MARKED_KEY) is what
 *   portfolioReadHold reads before it treats a missing record as a page that waits; until then the
 *   missing record is adopted as before. A step that throws leaves no finished record and runs again at
 *   the next start.
 * @structure markExistingPortfolioPagesOnce(storage, config)
 * @usage await markExistingPortfolioPagesOnce(storage, config);   // server-bootstrap/once-only-keep-steps.ts
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (secaudit2026oct31w2 round 11).
 */
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { claimOnceOnlyStep, keptBefore } from './once-only-step.js';
import { PORTFOLIO_PAGES_MARKED_KEY, adoptPageAtUpdate } from './portfolio-read-hold.js';

/** Record every existing welcome page with no record as allowed, once per node. */
export async function markExistingPortfolioPagesOnce(
  storage: Storage, config: AimeatConfig,
): Promise<{ ran: boolean; owners: string[] }> {
  const claim = await claimOnceOnlyStep(storage, `system@${config.nodeId}`, PORTFOLIO_PAGES_MARKED_KEY);
  if (!claim) return { ran: false, owners: [] };
  try {
    const at = new Date().toISOString();
    // Only a page stored before the rule first took effect here, also on a later start after a failed one.
    const cutoff = keptBefore(claim);
    const owners: string[] = [];
    for (const owner of await storage.listOwners()) {
      if (await adoptPageAtUpdate({ storage, config }, owner.name, cutoff)) owners.push(owner.name);
    }
    await claim.finish({ at, owners: owners.length });
    if (owners.length) logger.info(`Welcome pages: ${owners.length} that existed at the update keep reading their owner's memory`, { owners });
    return { ran: true, owners };
  } catch (err) {
    await claim.release();
    throw err;
  }
}
