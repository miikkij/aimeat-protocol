/**
 * @file src/services/app-origin-target.ts
 * @description Origin → grant target: which published thing is running at `<sub>.apps.<apex>` or
 *   `<username>.portfolio.<apex>`, and who owns it.
 *
 *   This is the binding that ties a token to exactly ONE app origin, and it is the reason apps
 *   cannot impersonate each other. It lived inline in the silent SSO bridge until a second caller
 *   needed it (the contact picker, TARGET-063). Two callers deriving the same binding separately is
 *   how one of them ends up with a slightly different idea of which app is asking — so it is one
 *   function, and both doors ask it rather than reading a hostname themselves.
 *
 *   The single-label rule is load-bearing in both families: `a.b.apps.example` must NOT resolve, or
 *   a nested subdomain could stand in for the app one level up.
 * @structure PORTFOLIO_TARGET_PREFIX · isPortfolioTarget · resolveAppOriginTarget
 * @usage const resolved = await resolveAppOriginTarget(config, storage, req.query.origin);
 * @version-history
 *   v1.0.0 — 2026-08-17 — Extracted verbatim from routes/app-grants.ts (behaviour unchanged) so the
 *     contact picker binds to an app the same way the silent bridge does.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { resolvePublishedPortfolio } from '../routes/portfolio.js';

/**
 * A grant target for a portfolio origin reads `portfolio:<username>`. An app target reads
 * `owner/filename` and an owner name carries no colon, so the prefix tells the two families apart
 * with no ambiguity. It is minted in exactly one place — resolveAppOriginTarget, below.
 */
export const PORTFOLIO_TARGET_PREFIX = 'portfolio:';

export function isPortfolioTarget(target: string): boolean {
  return target.startsWith(PORTFOLIO_TARGET_PREFIX);
}

export type AppOriginTarget =
  | { ok: true; family: 'app' | 'portfolio'; target: string; name: string; owner: string }
  | { ok: false; error: 'app_origin_disabled' | 'bad_origin' | 'unknown_app' };

/**
 * Resolve a caller-supplied origin to the app (or portfolio) it serves.
 *
 * The origin is a value the CALLER writes, so nothing here trusts it beyond matching it against
 * what this node actually publishes: an app origin resolves only through the subdomain_sites
 * binding, and a portfolio origin only through a published portfolio. Anything else is refused by
 * name rather than defaulted to something.
 */
export async function resolveAppOriginTarget(
  config: AimeatConfig, storage: Storage, origin: string,
): Promise<AppOriginTarget> {
  const appHost = (config.appHost || '').toLowerCase();
  const portfolioHost = (config.portfolioOriginEnabled ? (config.portfolioHost || '') : '').toLowerCase();
  if (!appHost && !portfolioHost) return { ok: false, error: 'app_origin_disabled' };

  let host: string;
  try { host = new URL(String(origin ?? '')).hostname.toLowerCase(); } catch { return { ok: false, error: 'bad_origin' }; }

  if (appHost && host !== appHost && host.endsWith('.' + appHost)) {
    const sub = host.slice(0, -(appHost.length + 1));
    if (!sub || sub.includes('.')) return { ok: false, error: 'bad_origin' }; // single-label per-app subdomain only

    // Subdomain → the app it serves. This binding is what ties a token to one app's origin.
    const site = await storage.getSubdomainSite(sub);
    if (!site || !site.enabled || site.kind !== 'app') return { ok: false, error: 'unknown_app' };
    const slash = site.target.indexOf('/');
    if (slash <= 0) return { ok: false, error: 'unknown_app' };
    return {
      ok: true, family: 'app',
      target: site.target,
      name: site.target.slice(slash + 1),
      owner: site.target.slice(0, slash),
    };
  }

  if (portfolioHost && host !== portfolioHost && host.endsWith('.' + portfolioHost)) {
    const sub = host.slice(0, -(portfolioHost.length + 1));
    if (!sub || sub.includes('.')) return { ok: false, error: 'bad_origin' };
    const resolved = await resolvePublishedPortfolio(storage, sub);
    if (!resolved.ok || !resolved.html) return { ok: false, error: 'unknown_app' };
    return {
      ok: true, family: 'portfolio',
      target: `${PORTFOLIO_TARGET_PREFIX}${sub}`,
      name: `${sub}'s portfolio`,
      owner: sub,
    };
  }

  return { ok: false, error: 'bad_origin' };
}
