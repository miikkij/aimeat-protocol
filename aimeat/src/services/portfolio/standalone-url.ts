/**
 * @file src/services/portfolio/standalone-url.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The standalone portfolio-origin address of a welcome page (`<username>.portfolio.<apex>`),
 *   or null when the portfolio origin is off or the username is not a usable DNS label.
 * @structure PORTFOLIO_LABEL_RE · portfolioStandaloneUrl(config, username)
 * @usage const url = portfolioStandaloneUrl(config, owner);
 * @version-history
 *   v1.0.0 — 2026-11-13 — Moved unchanged from routes/portfolio.ts, which re-exports it, so the home
 *     state service no longer imports a route file (structure programme 2026-11, unit 4).
 */
import type { AimeatConfig } from '../../config.js';

/** Valid DNS label for a portfolio subdomain (same shape as SUBDOMAIN_RE; kept local
 *  to avoid a portfolio ↔ subdomains import cycle). */
const PORTFOLIO_LABEL_RE = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;

/**
 * Standalone portfolio-origin URL (`<username>.portfolio.<apex>`) for a username,
 * or null when the portfolio origin is disabled or the username is not a usable
 * DNS label (OWNER_RE allows up to 64 chars; DNS labels cap at 63 — such names
 * simply keep the apex URL only).
 */
export function portfolioStandaloneUrl(config: AimeatConfig, username: string): string | null {
  if (!config.portfolioOriginEnabled || !config.portfolioHost) return null;
  const label = username.toLowerCase();
  if (!PORTFOLIO_LABEL_RE.test(label)) return null;
  let scheme = 'https', portSuffix = '';
  try {
    const b = new URL(config.baseUrl);
    scheme = b.protocol.replace(':', '');
    portSuffix = b.port ? `:${b.port}` : '';
  // eslint-disable-next-line aimeat/no-silent-catch -- keep https, no port
  } catch { /* keep https, no port */ }
  return `${scheme}://${label}.${config.portfolioHost}${portSuffix}/`;
}
