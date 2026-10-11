/**
 * @file src/middleware/cookie-consent.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The cookie banner (vanilla-cookieconsent): the categories a page asks about, the
 *   run configuration in English, Finnish and Spanish, the snippet that starts it, and the
 *   middleware that adds the snippet to the service's own HTML pages.
 *
 *   THE SWITCH IS READ ON EVERY REQUEST. `cookies.consent_enabled` is a setting the operator changes
 *   on a running node. The middleware used to read it once at start, so the banner switched on in
 *   Config reached the apps (whose snippet is built per request) and not the service's own pages
 *   until a restart.
 *
 *   THE CATEGORY LIST IS READ THROUGH ONE FUNCTION. The environment gives it as an array and the
 *   Config page stored it as the text the operator typed; iterating that text gave one category per
 *   letter ("N", "E", "C" …). consentCategories() takes either and answers clean words.
 *
 *   THE START SCRIPT CARRIES THE PAGE'S CSP NONCE. The service's own pages allow an inline script
 *   only with the response's nonce (server-bootstrap/static-files.ts). The banner's start script had
 *   none, so the browser blocked it and the banner never showed on those pages: the library loaded
 *   and nothing ran it (found 2026-10-11 in a browser; no test had opened the page).
 *
 *   THE BANNER STARTS WHEN THE PAGE HAS A BODY, in the visitor's language. The library appends
 *   itself to `document.body`; started from the head it failed with "Cannot read properties of null
 *   (reading 'appendChild')". The start script waits for the body, then picks the language: the
 *   `lang` parameter, the language the person chose on this service (`aimeat-lang`), the browser's,
 *   then the page's own `lang`.
 * @structure
 *   - consentCategories(config): the categories as clean words, `necessary` first
 *   - buildCookieConsentRunConfig(config, opts): the CookieConsent.run() config as JSON
 *   - cookieConsentSnippet(config, opts): stylesheet, library and start script for one page
 *   - cookieConsentMiddleware(config): adds the snippet to text/html string bodies before </body>
 *   - buildStandaloneSnippetJs(config): self-loading IIFE for GET /v1/portal/cookie-consent.js
 * @version-history
 *   v2.0.0 — 2026-10-11 — The switch and the categories are read per request; the category list is
 *     read through consentCategories() (a list typed in Config became one category per letter); the
 *     texts are in en, fi and es and name the page owner's analytics (cookie-consent-texts.ts); the
 *     start script carries the page's CSP nonce (without it the banner never ran on the service's
 *     own pages), waits for the body and picks the language; analytics cookies are removed when a
 *     visitor takes consent back; the middleware leaves a page that already carries the banner alone.
 *   v1.1.0 — 2026-10-08 — buildCookieConsentRunConfig is exported: an app served as bytes gets the
 *     banner from the analytics tag snippet (services/visibility/analytics-tags.ts), same run config.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { RequestHandler, Request, Response, NextFunction } from 'express';
import type { AimeatConfig } from '../config.js';
import { CONSENT_LANGS, consentTexts, type ConsentServices } from './cookie-consent-texts.js';

type BannerConfig = Pick<AimeatConfig, 'cookieConsentCategories' | 'cookieConsentPolicyUrl'>;

/** The attribute on the start script; services/app-serve-marks-strip.ts takes it out of a served copy. */
export const COOKIE_BANNER_MARK = 'data-aimeat-cookie-banner';

const CATEGORY_RE = /^[a-z][a-z0-9_-]{0,30}$/;

/**
 * The categories the banner offers, as clean lower-case words with `necessary` first. Takes the
 * array the environment gives and the comma-separated text an operator typed in Config.
 */
export function consentCategories(config: { cookieConsentCategories?: unknown }): string[] {
  const raw = config.cookieConsentCategories;
  const parts = Array.isArray(raw) ? raw.flatMap((v) => String(v).split(',')) : typeof raw === 'string' ? raw.split(',') : [];
  const out = ['necessary'];
  for (const part of parts) {
    const word = part.trim().toLowerCase();
    if (CATEGORY_RE.test(word) && !out.includes(word)) out.push(word);
  }
  return out;
}

export interface CookieBannerOptions {
  /** Categories this page needs beyond the operator's list (an app with its owner's analytics: `analytics`). */
  ensure?: readonly string[];
  /** The page owner's analytics, named in the banner. */
  services?: ConsentServices;
  /** Cookies to remove, and the page to reload, when the visitor takes analytics consent back. */
  clearOnRevoke?: readonly string[];
}

/**
 * The CookieConsent.run() configuration as JSON, with the texts of every language. `<` is written
 * as an escape, so the JSON can sit inside a script element whatever a text holds.
 */
export function buildCookieConsentRunConfig(config: BannerConfig, opts: CookieBannerOptions = {}): string {
  const names = consentCategories(config);
  for (const extra of opts.ensure ?? []) if (CATEGORY_RE.test(extra) && !names.includes(extra)) names.push(extra);

  const categories: Record<string, Record<string, unknown>> = {};
  for (const cat of names) categories[cat] = cat === 'necessary' ? { enabled: true, readOnly: true } : {};
  if (opts.clearOnRevoke?.length && categories.analytics) {
    categories.analytics.autoClear = { cookies: opts.clearOnRevoke.map((name) => ({ name })), reloadPage: true };
  }

  const translations: Record<string, unknown> = {};
  for (const lang of CONSENT_LANGS) {
    translations[lang] = consentTexts(lang, names, { services: opts.services, policyUrl: config.cookieConsentPolicyUrl });
  }

  const runConfig = {
    categories,
    guiOptions: {
      consentModal: { layout: 'box', position: 'bottom right' },
      preferencesModal: { layout: 'box' },
    },
    // The start script sets `default` to the visitor's language before the banner runs.
    language: { default: 'en', translations },
  };
  return JSON.stringify(runConfig).replace(/</g, '\\u003c');
}

/**
 * The code that starts the banner: it waits for the body, picks the language and runs. The
 * language is the visitor's: the `lang` parameter, what they chose on this service (`aimeat-lang`),
 * their browser's, and only then the page's own `lang` attribute. That attribute comes last because
 * it does not say what the visitor reads: the service's own page carries a fixed `lang="en"` until
 * its scripts load, and the serve pass writes one on an app whose author gave none.
 */
function startJs(runConfig: string): string {
  return `(function(){var c=${runConfig};`
    + `function pick(){var a=[],d=document;`
    + `try{a.push(new URLSearchParams(location.search).get('lang'));}catch(e){}`
    + `try{a.push(localStorage.getItem('aimeat-lang'));}catch(e){}`
    + `try{var m=d.cookie.match(/(?:^|;\\s*)aimeat-lang=([a-z]{2})/);a.push(m&&m[1]);}catch(e){}`
    + `a.push(navigator.language);a.push(d.documentElement.lang);`
    + `for(var i=0;i<a.length;i++){var x=String(a[i]||'').slice(0,2).toLowerCase();if(c.language.translations[x])return x;}return 'en';}`
    + `function run(){if(!document.body){setTimeout(run,30);return;}if(!window.CookieConsent)return;c.language.default=pick();CookieConsent.run(c);}`
    + `if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',run);}else{run();}})();`;
}

/**
 * Everything one page needs for the banner: the stylesheet, the library and the start script.
 * `assetBase` is the service's own address for a page on another origin (an app); empty on its own
 * pages. `nonce` is the page's CSP nonce: the service's own pages allow an inline script only with
 * it, and without it the start script was blocked and the banner never showed there.
 */
export function cookieConsentSnippet(config: BannerConfig, opts: CookieBannerOptions & { assetBase?: string; nonce?: string } = {}): string {
  const base = (opts.assetBase ?? '').replace(/\/+$/, '');
  const nonce = opts.nonce && /^[A-Za-z0-9+/=_-]{8,200}$/.test(opts.nonce) ? ` nonce="${opts.nonce}"` : '';
  return `<link rel="stylesheet" href="${base}/cookieconsent.css">`
    + `<script src="${base}/cookieconsent.umd.js"${nonce}></script>`
    + `<script ${COOKIE_BANNER_MARK}${nonce}>${startJs(buildCookieConsentRunConfig(config, opts))}</script>`;
}

/**
 * Express middleware that adds the banner to the service's own HTML responses before </body>.
 * The switch and the categories are read on every response, so a change in Config applies at once.
 * A page that already carries the banner (an app or a portfolio with its owner's tags) is left alone.
 */
export function cookieConsentMiddleware(config: AimeatConfig): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction) => {
    const originalSend = res.send.bind(res);

    res.send = function (body?: unknown): Response {
      if (config.cookieConsentEnabled === true && typeof body === 'string') {
        const contentType = res.getHeader('Content-Type');
        const ctString = typeof contentType === 'string' ? contentType : '';
        if (ctString.includes('text/html') && !body.includes('cookieconsent.umd.js')) {
          const closingBodyIndex = body.lastIndexOf('</body>');
          if (closingBodyIndex !== -1) {
            // The page's CSP allows an inline script only with this response's nonce (static-files.ts).
            const nonce = typeof res.locals?.cspNonce === 'string' ? res.locals.cspNonce : undefined;
            body = body.slice(0, closingBodyIndex) + cookieConsentSnippet(config, { nonce }) + body.slice(closingBodyIndex);
          }
        }
      }
      return originalSend(body);
    };

    next();
  };
}

/**
 * Returns a self-executing JS function (IIFE) that dynamically injects
 * the CSS link, loads the UMD script, and initializes CookieConsent.
 *
 * This is for manual integration via the portal endpoint
 * GET /v1/portal/cookie-consent.js
 */
export function buildStandaloneSnippetJs(config: AimeatConfig): string {
  const runConfig = buildCookieConsentRunConfig(config);

  return `(function(){` +
    `var link=document.createElement('link');` +
    `link.rel='stylesheet';` +
    `link.href='/cookieconsent.css';` +
    `document.head.appendChild(link);` +
    `var script=document.createElement('script');` +
    `script.src='/cookieconsent.umd.js';` +
    `script.onload=function(){${startJs(runConfig)}};` +
    `document.head.appendChild(script);` +
    `})();`;
}
