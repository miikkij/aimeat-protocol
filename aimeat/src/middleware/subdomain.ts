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
 */
import type { Request, Response, NextFunction } from 'express';
import type { AimeatConfig } from '../config.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      subdomain?: string | null;
    }
  }
}

/**
 * Sets `req.subdomain` to the lowercase leftmost label of the requested
 * subdomain, or null for apex requests. Header wins; hostname is a fallback
 * matched against the apex host derived from config.baseUrl.
 */
export function subdomainMiddleware(config: AimeatConfig) {
  // "https://aimeat.io" → "aimeat.io" (empty for unparseable baseUrls)
  let apexHost = '';
  try {
    apexHost = new URL(config.baseUrl).hostname.toLowerCase();
  } catch { /* no hostname fallback without a valid baseUrl */ }

  return (req: Request, _res: Response, next: NextFunction) => {
    const fromHeader = req.get('x-subdomain');
    if (fromHeader) {
      req.subdomain = fromHeader.trim().toLowerCase();
      return next();
    }
    req.subdomain = null;
    if (apexHost) {
      const host = (req.hostname || '').toLowerCase();
      if (host !== apexHost && host.endsWith('.' + apexHost)) {
        const label = host.slice(0, -(apexHost.length + 1));
        // Single-level subdomains only — nginx's server_name regex matches one label
        if (label && !label.includes('.')) req.subdomain = label;
      }
    }
    next();
  };
}
