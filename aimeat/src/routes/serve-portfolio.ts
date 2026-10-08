/**
 * @file src/routes/serve-portfolio.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Writes a standalone portfolio document (a person's portfolio, or a company's own
 *   page) on its isolated origin, with the auth bridge and the optional badge. Moved unchanged out of
 *   routes/subdomains.ts when that file reached the line ceiling; the caller now passes the badge
 *   decision, because services/app-marks.ts imported from here closes an import cycle.
 * @structure injectHeadSnippet · servePortfolio
 * @usage servePortfolio(res, html, portfolioConfig.showBadge !== false && servedBadgeOn(config), csp);
 * @version-history
 *   v1.1.0 — 2026-10-08 — A page that names an AI-provenance record is served with its marks: the HTML
 *     marks and the visible label in the same pass as the badge, AI-Disclosure and Link on the response
 *     (portfolioMarks).
 *   v1.0.0 — 2026-10-08 — Extracted from routes/subdomains.ts (max-file-lines), no behaviour change;
 *     the badge decision moved to the caller.
 */
import type { Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { applyServeMarks } from '../services/app-serve-marks.js';
import { loadServedProvenance, setProvenanceHeaders, type ServedProvenance } from '../services/ai-provenance-marks.js';
import { detectLocale, type Locale } from '../i18n.js';

/** A page's AI-provenance record as served, and what the visible label needs to render. */
export interface PortfolioMarks { provenance: ServedProvenance; config: AimeatConfig; locale: Locale }

/**
 * The marks for a page that names a record, or undefined (no record, or provenance off). The page is
 * public, so the visitor gets the record as AIMEAT_AI_PROVENANCE_DETAIL allows a public surface.
 */
export async function portfolioMarks(
  storage: Storage, config: AimeatConfig, aiProvenanceId: string | undefined, acceptLanguage: string | undefined,
): Promise<PortfolioMarks | undefined> {
  const provenance = await loadServedProvenance(storage, config, aiProvenanceId);
  return provenance ? { provenance, config, locale: detectLocale(acceptLanguage) } : undefined;
}

/** Insert an HTML snippet into a document head (fallbacks: after <body>, else prepend). */
function injectHeadSnippet(html: string, snippet: string): string {
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, snippet + '</head>');
  if (/<body[^>]*>/i.test(html)) return html.replace(/<body[^>]*>/i, (m) => m + snippet);
  return snippet + html;
}

/**
 * Write a standalone portfolio document on the portfolio origin. Injects the
 * standalone bridge (aimeat-auth SDK + portfolio-standalone.js + a memory:read
 * scopes meta) so the SAME portfolio HTML that runs inside the apex viewer's
 * iframe gets working auth/members bridging here too. `badge` is the caller's answer for the
 * optional aimeat badge (the per-portfolio `showBadge` flag, default ON, and the node's switch);
 * asked by the caller because services/app-marks.ts would close an import cycle from here.
 */
export function servePortfolio(res: Response, html: string, badge: boolean, csp: string, marks?: PortfolioMarks): void {
  const bridge =
    '<meta name="aimeat-scopes" content="memory:read">'
    + '<script src="/v1/libs/aimeat-auth.js"></script>'
    + '<script src="/v1/libs/portfolio-standalone.js"></script>';
  let buf: Buffer = Buffer.from(injectHeadSnippet(html, bridge), 'utf-8');
  // The page's AI-provenance marks ride the same one pass as the badge: the HTML marks and the
  // visible label in the served copy, the headers on the response. The stored page is unchanged.
  if (badge || marks) {
    buf = applyServeMarks(buf, {
      badge,
      ...(marks ? { provenance: marks.provenance, visibleLabel: { config: marks.config, locale: marks.locale } } : {}),
    });
  }
  if (marks) setProvenanceHeaders(res, marks.provenance);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Length', buf.length.toString());
  res.send(buf);
}
