/**
 * @file src/services/app-origin-target.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Origin → grant target: which published thing is running at `<sub>.apps.<apex>`,
 *   `<username>.portfolio.<apex>` or `<slug>.co.<apex>`, and who owns it.
 *
 *   This is the binding that ties a token to exactly ONE app origin, and it is the reason apps
 *   cannot impersonate each other. It lived inline in the silent SSO bridge until a second caller
 *   needed it (the contact picker, TARGET-063). Two callers deriving the same binding separately is
 *   how one of them ends up with a slightly different idea of which app is asking — so it is one
 *   function, and both doors ask it rather than reading a hostname themselves.
 *
 *   The single-label rule is load-bearing in both families: `a.b.apps.example` must NOT resolve, or
 *   a nested subdomain could stand in for the app one level up.
 * @structure PORTFOLIO_TARGET_PREFIX · isPortfolioTarget · resolveAppOriginTarget ·
 *   resolveFrameAppTarget
 * @usage const resolved = await resolveAppOriginTarget(config, storage, req.query.origin);
 * @version-history
 *   v1.2.0 — 2026-09-25 — resolveFrameAppTarget: the app the isolated frame's page asks for, by its
 *     `owner/filename`, on a node several people share with no app origin (audit A7-1). There an app
 *     has no address of its own to be bound by, and the page asking is the node's own.
 *   v1.1.0 — 2026-08-23 — The company origin resolves. `deriveCoHost` makes `co.<apex>` a SIBLING of
 *     `apps.<apex>` rather than a child, so `host.endsWith('.' + appHost)` never matched it: an app
 *     served as a company's front page was anonymous and had no way to sign anyone in. It resolves
 *     through the company registry the serving path uses, with that path's own refusals, and only a
 *     front page of kind 'app' is a principal — a redirect, a company document or an unclaimed
 *     address is not something a token can be bound to.
 *   v1.0.0 — 2026-08-17 — Extracted verbatim from routes/app-grants.ts (behaviour unchanged) so the
 *     contact picker binds to an app the same way the silent bridge does.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { resolvePublishedPortfolio } from '../routes/portfolio.js';
import { RESERVED_SUBDOMAINS, SUBDOMAIN_RE } from '../routes/subdomains.js';
import { appIsolationMode } from './app-isolation.js';

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
  | { ok: false; error: 'app_origin_disabled' | 'bad_origin' | 'unknown_app' | 'frame_off' };

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
  const coHost = (config.coOriginEnabled ? (config.coHost || '') : '').toLowerCase();
  if (!appHost && !portfolioHost && !coHost) return { ok: false, error: 'app_origin_disabled' };

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

  // The company origin. The label is a company SLUG resolved from the company registry, not from
  // the subdomain_sites table the apps family uses, so a company and an app may carry the same word
  // and mean different things. Every refusal here matches the serving path in routes/subdomains.ts:
  // an inactive company, a reserved or malformed label, and a front page that is not an app all
  // answer the same way, so this door is no better an enumeration oracle than that one.
  if (coHost && host !== coHost && host.endsWith('.' + coHost)) {
    const slug = host.slice(0, -(coHost.length + 1));
    if (!slug || slug.includes('.')) return { ok: false, error: 'bad_origin' };
    if (RESERVED_SUBDOMAINS.has(slug) || !SUBDOMAIN_RE.test(slug)) return { ok: false, error: 'unknown_app' };

    const company = await storage.getCompanyBySlug(slug);
    if (!company || company.status !== 'active') return { ok: false, error: 'unknown_app' };

    // Only an app front page is a principal a token can be bound to. A redirect sends the visitor
    // elsewhere, a company document is static HTML with no session, and 'none' means the address is
    // reserved and nothing is published there — none of the three is something to sign in to.
    const target = company.frontPage.kind === 'app' ? (company.frontPage.target || '') : '';
    const slash = target.indexOf('/');
    if (slash <= 0) return { ok: false, error: 'unknown_app' };

    // The target is the app's own `owner/filename`, the same string the apps origin resolves to, so
    // one app carries one grant however the visitor reached it.
    return {
      ok: true, family: 'app',
      target,
      name: target.slice(slash + 1),
      owner: target.slice(0, slash),
    };
  }

  return { ok: false, error: 'bad_origin' };
}

/**
 * Resolve the app the isolated frame's page asks for, `owner/filename`, to its grant target.
 *
 * Only on a node that runs apps in the isolated frame (services/app-isolation.ts). There an app has
 * no address of its own for a token to be bound by: it runs at the node's own address, in a frame
 * whose origin is opaque, and the page holding the frame asks for it by name. That page is the node's
 * own (routes/app-grants.ts lets only a same-origin caller in), and it names the app whose address it
 * was served at. Everywhere else a grant is bound by the app's address and this answers 'frame_off'.
 *
 * The target is the same `owner/filename` the app origin resolves to, so one app carries one grant
 * however it is reached, and a node that gains an app origin later keeps the grants it made.
 * An app its operator hid resolves to nothing, as its address answers nothing.
 */
export async function resolveFrameAppTarget(
  config: AimeatConfig, storage: Storage, app: string,
): Promise<AppOriginTarget> {
  if ((await appIsolationMode(config, storage)) !== 'isolated-frame') return { ok: false, error: 'frame_off' };
  const slash = app.indexOf('/');
  if (slash <= 0 || slash === app.length - 1 || app.indexOf('/', slash + 1) >= 0) return { ok: false, error: 'unknown_app' };
  const record = await storage.getAppByOwnerName(app.slice(0, slash), app.slice(slash + 1));
  if (!record || record.operatorHidden) return { ok: false, error: 'unknown_app' };
  return {
    ok: true, family: 'app',
    target: `${record.ownerName}/${record.filename}`,
    name: record.filename,
    owner: record.ownerName,
  };
}
