/**
 * @file src/services/portfolio/page-write.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Writing one owner's welcome page. Moved out of routes/portfolio.ts unchanged on
 *   2026-11-13, so the MCP tool aimeat_portfolio_publish calls it without importing a route file
 *   (CLAUDE.md, Backend; dependency-cruiser rule mcp-does-not-import-routes). routes/portfolio.ts
 *   re-exports it for its other importers. The page's standalone address is
 *   services/portfolio/standalone-url.ts.
 * @structure writePortfolioHtml
 * @usage await writePortfolioHtml(storage, target, data, { config, principal, pipeline });
 * @version-history
 *   v1.0.0 — 2026-11-13 — Moved out of routes/portfolio.ts unchanged (structure programme unit 2).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, AiProvenanceRecordRow } from '../../storage/interface.js';
import { provenanceForWrite, storeHeldProvenance } from '../ai/provenance.js';
import { PORTFOLIO_HTML_KEY } from '../portfolio-config.js';

/**
 * Store one owner's welcome page, replacing whatever was there.
 *
 * Three copies of this existed — this route, the MCP publish tool, and the welcome-mat accept path —
 * and each wrote the same file under the same key with the same visibility. Which identity the page
 * lands under is already resolved in one place (portfolioWriteGaii above); the WRITE had no reason
 * to be resolved in three, and a fourth surface would have made a fourth.
 *
 * Returns the target identity, because every caller reports it back one way or another.
 *
 * `writer` is who wrote the page, for its AI-provenance record (B10): an agent that writes a page
 * and says nothing about it is stamped model-written (Mint-3), a person writing in person is not.
 * The page is public, so the record resolves for every visitor, and the portfolio origin serves its
 * marks with the page.
 */
export async function writePortfolioHtml(
  storage: Storage,
  target: string,
  data: Buffer,
  writer?: { config: AimeatConfig; principal: string; pipeline: string },
): Promise<string> {
  const held: AiProvenanceRecordRow[] = [];
  const aiProvenanceId = writer ? await provenanceForWrite(storage, {
    principal: writer.principal, content: data, pipeline: writer.pipeline,
    surface: { visibility: 'public', humanAudience: true },
    labelPolicy: writer.config.aiLabelPublic, nodeId: writer.config.nodeId, baseUrl: writer.config.baseUrl,
    enabled: writer.config.aiProvenance, held,
  }) : undefined;
  await storage.deleteStorageFile(target, PORTFOLIO_HTML_KEY);
  // The FILE is the owner's: the portfolio origin serves the page from storage while the switch is
  // on, and a public file stayed readable at /v1/pub after its owner took the page off the web.
  await storage.createStorageFile({
    key: PORTFOLIO_HTML_KEY,
    ownerGaii: target,
    visibility: 'owner',
    mimeType: 'text/html',
    size: data.length,
    data,
    createdAt: new Date().toISOString(),
    ...(aiProvenanceId ? { aiProvenanceId } : {}),
  });
  await storeHeldProvenance(storage, held);
  return target;
}
