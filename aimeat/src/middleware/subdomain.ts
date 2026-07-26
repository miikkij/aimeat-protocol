/**
 * @file subdomain.ts
 * @description Resolves the request's subdomain label into `req.subdomain`.
 *              In production nginx proxies all `<sub>.<apex>` requests to this
 *              backend with an `X-Subdomain: <sub>` header (apex requests carry
 *              no such header). A hostname fallback covers dev setups where the
 *              header is absent but the Host matches `<sub>.<apex-host>`.
 * @structure subdomainMiddleware(config) — Express middleware factory.
 * @usage app.use(subdomainMiddleware(config)); // before route mounting
 * @version-history
 *   v1.0.0 — 2026-06-12 — Initial: subdomain routing (operator-only management)
 *   v1.1.0 — 2026-06-20 — H-2: two-level app-origin parsing (`<sub>.apps.<apex>` /
 *     `apps.<apex>`) + `req.appOrigin` flag (x-app-origin header / hostname fallback).
 *   v1.2.0 — 2026-07-03 — Portfolio origin: `req.portfolioOrigin` flag +
 *     `<username>.portfolio.<apex>` parsing (x-portfolio-origin header / hostname
 *     fallback), checked before the apex like the app host.
 */
import type { Request, Response, NextFunction } from 'express';
import type { AimeatConfig } from '../config.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      subdomain?: string | null;
      /**
       * True when the request arrived on the dedicated app origin
       * (`apps.<apex>` or `<sub>.apps.<apex>`) — the isolated, session-less host
       * where user apps run (H-2). Apex requests have this falsy.
       */
      appOrigin?: boolean;
      /**
       * True when the request arrived on the dedicated portfolio origin
       * (`portfolio.<apex>` or `<username>.portfolio.<apex>`) — the isolated,
       * session-less host where published portfolios are served standalone.
       */
      portfolioOrigin?: boolean;
    }
  }
}

/**
 * Sets `req.subdomain` (leftmost label, or null) and `req.appOrigin` (true on the
 * app host family). Header wins (`x-subdomain` + `x-app-origin`, set by nginx);
 * hostname is a fallback for dev, matched against the apex/app hosts from config.
 *
 * The app host (`config.appHost`, e.g. `apps.aimeat.io`) is itself a subdomain of
 * the apex, so it is checked FIRST — otherwise `apps.aimeat.io` would be misread as
 * the single-label subdomain "apps" under the apex.
 */
export function subdomainMiddleware(config: AimeatConfig) {
  // "https://aimeat.io" → "aimeat.io" (empty for unparseable baseUrls)
  let apexHost = '';
  try {
    apexHost = new URL(config.baseUrl).hostname.toLowerCase();
  // eslint-disable-next-line aimeat/no-silent-catch -- no hostname fallback without a valid baseUrl
  } catch { /* no hostname fallback without a valid baseUrl */ }
  const appHost = (config.appHost || '').toLowerCase();
  const portfolioHost = (config.portfolioHost || '').toLowerCase();

  return (req: Request, _res: Response, next: NextFunction) => {
    req.subdomain = null;
    req.appOrigin = false;
    req.portfolioOrigin = false;

    // Header path (production behind nginx). x-app-origin marks the app host
    // family, x-portfolio-origin the portfolio host family.
    const fromHeader = req.get('x-subdomain');
    const appHeader = req.get('x-app-origin');
    const portfolioHeader = req.get('x-portfolio-origin');
    if (appHeader || portfolioHeader || fromHeader) {
      if (appHeader && appHeader.trim() !== '' && appHeader.trim() !== '0') req.appOrigin = true;
      if (portfolioHeader && portfolioHeader.trim() !== '' && portfolioHeader.trim() !== '0') req.portfolioOrigin = true;
      if (fromHeader) req.subdomain = fromHeader.trim().toLowerCase();
      return next();
    }

    // Hostname fallback (dev / no proxy). App + portfolio hosts checked before
    // apex — they are themselves apex subdomains and would otherwise be misread
    // as the single-label subdomains "apps" / "portfolio".
    const host = (req.hostname || '').toLowerCase();
    if (appHost) {
      if (host === appHost) {
        req.appOrigin = true; // bare apps.<apex> — path-form app serving
        return next();
      }
      if (host.endsWith('.' + appHost)) {
        req.appOrigin = true;
        const label = host.slice(0, -(appHost.length + 1));
        if (label && !label.includes('.')) req.subdomain = label; // <sub>.apps.<apex>
        return next();
      }
    }
    if (portfolioHost) {
      if (host === portfolioHost) {
        req.portfolioOrigin = true; // bare portfolio.<apex> — redirects to the apex showcase
        return next();
      }
      if (host.endsWith('.' + portfolioHost)) {
        req.portfolioOrigin = true;
        const label = host.slice(0, -(portfolioHost.length + 1));
        if (label && !label.includes('.')) req.subdomain = label; // <username>.portfolio.<apex>
        return next();
      }
    }
    if (apexHost && host !== apexHost && host.endsWith('.' + apexHost)) {
      const label = host.slice(0, -(apexHost.length + 1));
      // Single-level subdomains only — nginx's server_name regex matches one label
      if (label && !label.includes('.')) req.subdomain = label;
    }
    next();
  };
}
