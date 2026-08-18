/**
 * @file subdomain.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Resolves the request's subdomain label into `req.subdomain`.
 *              In production nginx proxies all `<sub>.<apex>` requests to this
 *              backend with an `X-Subdomain: <sub>` header (apex requests carry
 *              no such header). A hostname fallback covers dev setups where the
 *              header is absent but the Host matches `<sub>.<apex-host>`.
 *              The origin-family markers (`X-App-Origin`, `X-Portfolio-Origin`,
 *              `X-Co-Origin`) are honoured only on a Host in that family, so a
 *              client cannot claim one by sending the header.
 * @structure subdomainMiddleware(config) — Express middleware factory.
 *   - hostOf(req) — the addressed host, port stripped, from the raw `Host` header
 *   - inFamily(host, parent) — host is `parent` or one label under it
 *   - marked(req, header, familyHost) — marker set AND allowed on this Host
 *   - labelFromHost(req) — leftmost label under app/portfolio/co/apex host
 * @usage app.use(subdomainMiddleware(config)); // before route mounting
 * @version-history
 *   v1.3.0 — 2026-07-28 — On the header path, a missing `X-Subdomain` falls back to the Host label
 *     instead of reading as "no subdomain". The proxy marks the host family on every location but
 *     names the label on only some: under `/.well-known/*` every app origin was reporting itself as
 *     the bare app host, so each one described the whole family as a single protected resource.
 *   v1.0.0 — 2026-06-12 — Initial: subdomain routing (operator-only management)
 *   v1.1.0 — 2026-06-20 — H-2: two-level app-origin parsing (`<sub>.apps.<apex>` /
 *     `apps.<apex>`) + `req.appOrigin` flag (x-app-origin header / hostname fallback).
 *   v1.2.0 — 2026-07-03 — Portfolio origin: `req.portfolioOrigin` flag +
 *     `<username>.portfolio.<apex>` parsing (x-portfolio-origin header / hostname
 *     fallback), checked before the apex like the app host.
 *   v1.4.0 — 2026-08-07 — Company origin: `req.coOrigin` flag + `{slug}.co.<apex>` parsing
 *     (x-co-origin header / hostname fallback). Same two-level shape as the app host, and
 *     checked in the same pass — the co host is itself an apex subdomain and would otherwise
 *     be misread as the single-label subdomain "co".
 *   v1.5.0 — 2026-08-11 — An origin-family marker is honoured only when the Host belongs to that
 *     family. `X-App-Origin: 1` from any client used to be enough to be treated as an app origin,
 *     which is the whole of the app-origin isolation, and the apex nginx block that was supposed to
 *     blank the three markers had stopped doing so with nothing anywhere reporting it. A dropped
 *     marker is logged and leaves the request looking like one that never carried it.
 */
import type { Request, Response, NextFunction } from 'express';
import type { AimeatConfig } from '../config.js';
import { logger } from '../utils/logger.js';

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
      /**
       * True when the request arrived on the dedicated company origin
       * (`co.<apex>` or `{slug}.co.<apex>`) — a registered company's front page,
       * served on the same isolated, session-less host model as an app.
       */
      coOrigin?: boolean;
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
 *
 * DEPLOYMENT REQUIREMENT: the reverse proxy must forward the client's Host verbatim
 * (`proxy_set_header Host $host`, which is what production does). Everything below reads the
 * family from that Host, so a proxy that rewrites it to an internal name would demote every
 * app, portfolio and company origin to the apex.
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
  const coHost = (config.coHost || '').toLowerCase();

  /**
   * The host the client addressed, port stripped, read from the raw `Host` header.
   *
   * Deliberately NOT `req.hostname`: that prefers `X-Forwarded-Host` whenever `trust proxy`
   * matches the peer, and in production it matches — nginx sits on loopback and the default
   * profile trusts loopback. `X-Forwarded-Host` is a header any client can send, so reading it
   * here would hand the family check back to the caller it exists to check. `Host` is what nginx
   * forwards verbatim, so it names the host nginx routed on.
   */
  const hostOf = (req: Request): string => {
    const raw = (req.headers.host ?? '').trim().toLowerCase();
    // An IPv6 literal is bracketed (`[::1]:40050`) and never belongs to a named family.
    if (raw.startsWith('[')) return raw.slice(0, raw.indexOf(']') + 1);
    const colon = raw.indexOf(':');
    return colon === -1 ? raw : raw.slice(0, colon);
  };

  /**
   * True when `host` is `parent` itself or exactly one label under it. A parent that is not
   * configured owns nothing, so an unprovisioned family can never be claimed.
   */
  const inFamily = (host: string, parent: string): boolean => {
    if (!parent || !host) return false;
    if (host === parent) return true;
    if (!host.endsWith('.' + parent)) return false;
    const label = host.slice(0, -(parent.length + 1));
    // Single-level only, matching labelFromHost and nginx's one-label server_name regex.
    return label !== '' && !label.includes('.');
  };

  /**
   * Whether an origin-family marker is set AND belongs on this request's Host.
   *
   * The marker is a claim the caller makes; the Host is what nginx routed on. Until now the claim
   * was taken on its own, so `X-App-Origin: 1` on any request was enough to be served as an app
   * origin — session-less host, own CSP, own protected-resource identity — from the apex. The
   * proxy was supposed to blank the three markers on the apex server block and had stopped doing
   * so, which is the kind of drift that reports itself nowhere. The Host was already trusted for
   * exactly this question: since v1.3.0 the subdomain label comes from it.
   *
   * A dropped marker is logged (a misconfigured proxy and an attack both deserve a line) and the
   * request continues as if it had never carried one, so the hostname fallback below still gets to
   * read the family off the Host.
   */
  const marked = (req: Request, header: string, familyHost: string): boolean => {
    const raw = req.get(header);
    if (!raw) return false;
    const value = raw.trim();
    if (value === '' || value === '0') return false;
    const host = hostOf(req);
    if (inFamily(host, familyHost)) return true;
    logger.warn('subdomain: origin marker dropped, its Host is outside that family', {
      header, host: host || '(none)', family: familyHost || '(not configured)', path: req.path,
    });
    return false;
  };

  /**
   * The leftmost label of the request's Host under the app, portfolio or apex host — or null when
   * the Host is one of those hosts bare, or something else entirely. Used both by the hostname
   * fallback (dev, no proxy) and to fill the label in on proxied requests whose location block
   * marks the host family without naming the subdomain.
   */
  const labelFromHost = (req: Request): string | null => {
    const host = (req.hostname || '').toLowerCase();
    for (const parent of [appHost, portfolioHost, coHost, apexHost]) {
      if (!parent) continue;
      // The BARE family host names no subdomain. Without this the loop fell through to the apex,
      // where `apps.aimeat.io` reads as the single label "apps" and the path-form app origin starts
      // describing itself as a subdomain site that does not exist. It stayed hidden while the unit
      // test passed a Host no family matched; a Host the way nginx actually sends one exposes it.
      if (host === parent) return null;
      if (!host.endsWith('.' + parent)) continue;
      const label = host.slice(0, -(parent.length + 1));
      // Single-level subdomains only — nginx's server_name regex matches one label.
      return label && !label.includes('.') ? label : null;
    }
    return null;
  };

  return (req: Request, _res: Response, next: NextFunction) => {
    req.subdomain = null;
    req.appOrigin = false;
    req.portfolioOrigin = false;
    req.coOrigin = false;

    // Header path (production behind nginx). x-app-origin marks the app host
    // family, x-portfolio-origin the portfolio host family. Each marker only counts on a Host in
    // its own family; one Host belongs to at most one family, so at most one of these is true, and
    // a request left with none of them drops to the hostname fallback below rather than being
    // pinned to the apex by the header it was not allowed to use.
    const fromHeader = req.get('x-subdomain');
    const isApp = marked(req, 'x-app-origin', appHost);
    const isPortfolio = marked(req, 'x-portfolio-origin', portfolioHost);
    const isCo = marked(req, 'x-co-origin', coHost);
    if (isApp || isPortfolio || isCo || fromHeader) {
      req.appOrigin = isApp;
      req.portfolioOrigin = isPortfolio;
      req.coOrigin = isCo;
      // The proxy marks the HOST FAMILY on every location, but only some of them add the label.
      // `/.well-known/*` is one that does not, and reading the label as absent there made an app
      // origin describe itself as the bare app host — the whole family answering as one resource.
      // The Host header carries what nginx already routed on, so it answers the same question.
      req.subdomain = (fromHeader ? fromHeader.trim().toLowerCase() : null) ?? labelFromHost(req);
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
    if (coHost) {
      if (host === coHost) {
        req.coOrigin = true; // bare co.<apex> — no company named, redirects to the apex
        return next();
      }
      if (host.endsWith('.' + coHost)) {
        req.coOrigin = true;
        const label = host.slice(0, -(coHost.length + 1));
        if (label && !label.includes('.')) req.subdomain = label; // {slug}.co.<apex>
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
