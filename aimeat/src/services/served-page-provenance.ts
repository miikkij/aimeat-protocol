/**
 * @file src/services/served-page-provenance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The provenance records of the pages a node serves to anyone although their stored
 *   file is owner-only: a person's welcome page while it is switched on, and a company front page
 *   while the company's address points at it.
 *
 *   WHY. Since plan doc-mvcn6c7e4e5q V0.3 (2026-10-17) these page files are stored with visibility
 *   'owner', so a page switched off is not readable at /v1/pub. The page is still served on its own
 *   origin while it is on, and the record its label links to must resolve for the same visitors:
 *   the SQL predicate (PUBLICLY_LINKED) asks only the stored visibility and answered 404 for a page
 *   anyone could open (e2e-storage-file-provenance B10). Decided here from the same switches the
 *   origins serve on, so a page switched off takes its record back to 404 with nothing to remember.
 * @structure servedPageProvenanceIds(storage, config, ids)
 * @usage for (const id of await servedPageProvenanceIds(storage, config, rest)) visible.add(id);
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { localAccountOf } from '../utils/gaii.js';
import { PORTFOLIO_HTML_KEY, portfolioReadGaiis, portfolioSwitchState } from './portfolio-config.js';
import { companyPortfolioKey } from './company/company-portfolio.js';

/** Of these record ids, the ones whose content is a page served to anyone now. */
export async function servedPageProvenanceIds(storage: Storage, config: AimeatConfig, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (ids.length === 0) return out;
  const rows = await storage.getAiProvenanceMany(ids);
  for (const row of rows) {
    const owner = localAccountOf(row.ownerGhii);
    if (!owner) continue;
    // The welcome page: served while its switch is on, from the first identity that holds a page.
    if ((await portfolioSwitchState(storage, owner, config.nodeId)).enabled === true) {
      for (const gaii of await portfolioReadGaiis(storage, owner, config.nodeId)) {
        const meta = await storage.getStorageFileMeta(gaii, PORTFOLIO_HTML_KEY);
        if (!meta) continue;
        if (meta.aiProvenanceId === row.id) out.add(row.id);
        break;
      }
    }
    if (out.has(row.id)) continue;
    // A company front page: served while the company's address points at its page.
    for (const company of await storage.listCompanies({ ownerGhii: row.ownerGhii, limit: 200 })) {
      if (company.frontPage.kind !== 'portfolio') continue;
      const meta = await storage.getStorageFileMeta(row.ownerGhii, companyPortfolioKey(company.id));
      if (meta?.aiProvenanceId === row.id) { out.add(row.id); break; }
    }
  }
  return out;
}
