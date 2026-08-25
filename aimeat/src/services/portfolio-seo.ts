/**
 * @file portfolio-seo.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether one person's published portfolio may be found in a search engine, and what
 *   its page says about them when it is.
 *
 *   The same shape as services/app-seo.ts and for the same reason: several surfaces ask the
 *   question — the portfolio sitemap, the X-Robots-Tag on both serve paths, and the per-person head
 *   metadata — and a rule written out three times drifts.
 *
 *   TWO SWITCHES, NOT ONE, and the split is deliberate. `enabled` decides whether the portfolio
 *   exists publicly at all and appears on this node's own member showcase; `seoIndex` decides
 *   whether a search engine may list it. Collapsing them would mean a person who wants a page to
 *   hand people has no way to keep their name out of Google, which for a page carrying somebody's
 *   name and work is the choice that matters most.
 *
 *   OFF until asked, like an app. A page with a person's name on it is not something to opt them
 *   into by default.
 *
 * @structure
 *   - portfolioSeoIndexable(config, aimeatConfig) — the single decision
 *   - portfolioPage(username, config, baseUrl)    — the PublicPage the head injection needs
 * @usage
 *   if (!portfolioSeoIndexable(resolved.portfolioConfig, config)) res.setHeader('X-Robots-Tag', …);
 * @version-history
 *   v1.0.0 — 2026-08-25 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { PublicPage } from '../data/public-pages.js';

/** The portfolio's own config record (`portfolio.config`), as far as this decision needs it. */
export interface PortfolioSeoConfig {
  enabled?: unknown;
  seoIndex?: unknown;
  title?: unknown;
  tagline?: unknown;
  description?: unknown;
  displayName?: unknown;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** May a search engine list this person's portfolio. */
export function portfolioSeoIndexable(
  portfolioConfig: PortfolioSeoConfig | null | undefined,
  config: AimeatConfig,
): boolean {
  // The node-wide switch overrules everything: an operator who turned discovery off did not mean
  // "except for the people".
  if (config.seoIndexing === 'off') return false;
  if (!portfolioConfig) return false;
  // Not published at all is not a search question.
  if (!portfolioConfig.enabled) return false;
  return portfolioConfig.seoIndex === true;
}

/**
 * The page metadata for one person's portfolio, in the shape injectPageHead already takes.
 *
 * Built rather than looked up: `/v1/portfolio/:username` is one route serving as many pages as
 * there are people, so the public-page registry cannot hold it. Before this the route was served
 * through `serveSpa` with no routePath at all, which meant no title, no description and no
 * canonical — a page about a named person that described itself to a search engine as the node's
 * generic front door.
 */
export function portfolioPage(
  username: string,
  portfolioConfig: PortfolioSeoConfig | null | undefined,
  config: AimeatConfig,
): PublicPage {
  const name = str(portfolioConfig?.displayName) || username;
  const title = str(portfolioConfig?.title) || name;
  // The person's own words where they wrote any. The fallback names them and says what the page
  // is, which is more than the generic node description said and is true of every portfolio.
  const description = str(portfolioConfig?.description)
    || str(portfolioConfig?.tagline)
    || `${name} on ${config.seoSiteName}: what they work on, what they have built, and how to reach them.`;
  return {
    path: `/v1/portfolio/${encodeURIComponent(username)}`,
    title,
    description,
    changefreq: 'weekly',
    priority: '0.6',
  };
}
