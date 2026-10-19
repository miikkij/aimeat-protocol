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
 *
 *   THE BANNER DOES NOT HOLD THE PAGE'S FIRST PAINT. Its stylesheet and library load dynamically,
 *   with the stylesheet inactive until loaded. The banner starts only after both assets and the
 *   body are ready. An unavailable banner never grants analytics consent or stops the page.
 * @structure
 *   - consentCategories(config): the categories as clean words, `necessary` first
 *   - buildCookieConsentRunConfig(config, opts): the CookieConsent.run() config as JSON
 *   - cookieConsentSnippet(config, opts): stylesheet, library and start script for one page
 *   - cookieConsentMiddleware(config): adds the snippet to text/html string bodies before </body>
 *   - buildStandaloneSnippetJs(config): self-loading IIFE for GET /v1/portal/cookie-consent.js
 * @version-history
 *   v2.3.0 — 2026-10-19 — Load consent assets without blocking parsing, paint or DOMContentLoaded;
 *     preserve saved consent, catch initialization failures, and let the cookie mark retry a failure.
 *   v2.2.1 — 2026-10-18 — The cookie mark sits after the app-info mark too (--aimeat-mark-info-w).
 *   v2.2.0 — 2026-10-11 — With no policy address set the banner links to the service's own privacy
 *     policy, with the service's address in front on an app's page (`assetBase`).
 *   v2.1.0 — 2026-10-11 — The service's own pages get the banner only when the operator lists a
 *     category a visitor can refuse (with `necessary` alone it asked a question with one answer on
 *     every page); the cookie mark on the row of marks opens the choices again; every non-ASCII
 *     character of the run configuration is an escape, for an app that declares no charset.
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
import { CONSENT_LANGS, consentTexts, consentSettingsLabels, type ConsentServices } from './cookie-consent-texts.js';

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
  /**
   * Add the cookie mark to the page's row of marks: a round button that opens the choices again.
   * For a served app, a portfolio or a company page, which carry that row (utils/app-badge.ts).
   */
  mark?: boolean;
  /**
   * The service's own address, for a page on another origin (an app); empty on its own pages. The
   * banner's files load from it, and the link to the service's own privacy policy starts with it.
   */
  assetBase?: string;
}

/** Every character outside ASCII as a \u escape: a served app often declares no charset. */
const asciiJson = (value: unknown): string => JSON.stringify(value)
  .replace(/</g, '\\u003c')
  .replace(/[\u0080-￿]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);

/**
 * A cookie with a bite out of it and three chips, drawn. Sized in ems like the other marks' icons;
 * an inline SVG and not an emoji, which the interface does not use.
 */
const COOKIE_ICON = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" '
  + 'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
  + '<path d="M12 3a9 9 0 1 0 9 9 3.6 3.6 0 0 1-4.6-4.4A3.6 3.6 0 0 1 12 3z"/>'
  + '<path d="M9 9.6v.01M14.4 14.2v.01M9.8 15.2v.01"/></svg>';

/**
 * The cookie mark's style: a 34px round button on the node's row of marks, after the AI label, the
 * attribution bolt, the "Use with your AI" mark and the app-info mark, by the widths they declare; it declares its own
 * room as --aimeat-mark-cookie-w for the install button after it (public/js/install-chip.js). Drawn
 * like the others (utils/app-ai-use-badge.ts): an opaque surface and every declaration `!important`,
 * so app CSS cannot restyle it. One step under the banner's own layer, so the open dialog covers it.
 */
const COOKIE_MARK_CSS = ':root{--aimeat-mark-cookie-w:42px}'
  + '#aimeat-cookie-mark{display:contents!important}'
  + '#aimeat-cookie-mark button{display:flex!important;position:fixed!important;'
  + 'left:calc(12px + var(--aimeat-mark-ai-w,0px) + var(--aimeat-mark-badge-w,0px) + var(--aimeat-mark-aiuse-w,0px) + var(--aimeat-mark-info-w,0px))!important;'
  + 'right:auto!important;bottom:12px!important;top:auto!important;z-index:2147483646!important;width:34px!important;'
  + 'height:34px!important;box-sizing:border-box!important;margin:0!important;padding:0!important;align-items:center!important;'
  + 'justify-content:center!important;border-radius:50%!important;color:#FFB52E!important;background:#14141c!important;'
  + 'box-shadow:0 4px 16px rgba(0,0,0,.28)!important;border:1px solid rgba(255,255,255,.14)!important;'
  + 'font:600 17px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif!important;cursor:pointer!important}'
  + '#aimeat-cookie-mark svg{width:1em!important;height:1em!important;display:block!important;flex:none!important}'
  + '#aimeat-cookie-mark button:focus-visible{outline:2px solid #FFB52E!important;outline-offset:2px!important}';

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
    translations[lang] = consentTexts(lang, names, { services: opts.services, policyUrl: config.cookieConsentPolicyUrl, base: opts.assetBase });
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
  return asciiJson(runConfig);
}

/**
 * The code that starts the banner: it waits for the body, picks the language and runs. The
 * language is the visitor's: the `lang` parameter, what they chose on this service (`aimeat-lang`),
 * their browser's, and only then the page's own `lang` attribute. That attribute comes last because
 * it does not say what the visitor reads: the service's own page carries a fixed `lang="en"` until
 * its scripts load, and the serve pass writes one on an app whose author gave none.
 */
function startJs(runConfig: string, mark = false, assetBase = ''): string {
  // THE WAY BACK TO THE CHOICES. Taking consent back has to be as easy as giving it, and after a
  // choice the banner is gone. The cookie mark stays on the page's row of marks and opens the
  // choices again (Jouni, 2026-10-11: a cookie beside the AI badge, where a newspaper has its
  // "cookie settings" link at the bottom of the page).
  const markJs = mark
    ? `function mark(failed){try{var d=document;if(d.getElementById('aimeat-cookie-mark'))return;`
      + `var L=${asciiJson(consentSettingsLabels())},E=${asciiJson({ en: 'Cookie settings could not load. Press to reload the page and try again.', fi: 'Evästeasetuksia ei voitu ladata. Paina tästä, niin sivu latautuu uudelleen.', es: 'No se pudo cargar la configuración de cookies. Pulsa para recargar la página e intentarlo de nuevo.' })},`
      + `t=failed?(E[c.language.default]||E.en):(L[c.language.default]||L.en),w=d.createElement('div');w.id='aimeat-cookie-mark';`
      + `w.innerHTML=${asciiJson(`<style>${COOKIE_MARK_CSS}</style><button type="button">${COOKIE_ICON}</button>`)};`
      + `var b=w.querySelector('button');b.setAttribute('aria-label',t);b.title=t;`
      + `b.addEventListener('click',function(){if(failed){location.reload();}else{window.CookieConsent.showPreferences();}});d.body.appendChild(w);}catch(x){}}`
    : '';
  return `(function(){var c=${runConfig};${markJs}`
    + `function pick(){var a=[],d=document;`
    + `try{a.push(new URLSearchParams(location.search).get('lang'));}catch(e){}`
    + `try{a.push(localStorage.getItem('aimeat-lang'));}catch(e){}`
    + `try{var m=d.cookie.match(/(?:^|;\\s*)aimeat-lang=([a-z]{2})/);a.push(m&&m[1]);}catch(e){}`
    + `a.push(navigator.language);a.push(d.documentElement.lang);`
    + `for(var i=0;i<a.length;i++){var x=String(a[i]||'').slice(0,2).toLowerCase();if(c.language.translations[x])return x;}return 'en';}`
    // The library draws each category closed, a title with nothing under it until it is pressed,
    // which reads as an empty list. Each one is opened when the dialog is built, so the visitor
    // sees what a category is for before choosing; the title still folds it.
    + `window.addEventListener('cc:onModalReady',function(e){try{var q=e.detail||{};if(q.modalName!=='preferencesModal'||!q.modal)return;`
    + `var s=q.modal.querySelectorAll('.pm__section--expandable');for(var i=0;i<s.length;i++){s[i].classList.add('is-expanded');`
    + `var b=s[i].querySelector('.pm__section-title');if(b)b.setAttribute('aria-expanded','true');`
    + `var k=s[i].querySelector('.pm__section-desc-wrapper');if(k)k.setAttribute('aria-hidden','false');}}catch(x){}});`
    // Register asset handlers before inserting their elements: a warm cache must not lose readiness.
    // No inline onload attribute: the node's nonce-based CSP does not allow event-handler attributes.
    + `var d=document,n=d.currentScript&&d.currentScript.nonce,dom=d.readyState!=='loading',css=false,`
    + `lib=!!(window.CookieConsent&&typeof window.CookieConsent.run==='function'),begun=false,failed=false,settled=false;`
    + `function failure(reason){if(failed||settled)return;failed=true;clearTimeout(timer);`
    + `console.warn('AIMEAT cookie consent could not start:',reason);run();}`
    + `function run(){if(!dom||!d.body)return;c.language.default=pick();`
    + `if(failed){${mark ? 'mark(true);' : ''}return;}if(begun||!css||!lib)return;begun=true;`
    + `try{Promise.resolve(CookieConsent.run(c)).then(function(result){if(failed)return;`
    + `if(result===false){failure('Consent initialization failed');return;}settled=true;clearTimeout(timer);${mark ? 'mark(false);' : ''}`
    + `},function(error){failure(error);});}catch(error){failure(error);}}`
    + `var timer=setTimeout(function(){failure('Consent assets or initialization timed out');},30000);`
    + `if(!dom)d.addEventListener('DOMContentLoaded',function(){dom=true;run();},{once:true});`
    + `try{var link=d.createElement('link');link.rel='stylesheet';link.media='print';link.href=${asciiJson(assetBase + '/cookieconsent.css')};`
    + `link.onload=function(){if(failed)return;link.media='all';css=true;run();};link.onerror=function(){failure('Consent stylesheet could not load');};`
    + `d.head.appendChild(link);if(!lib){var script=d.createElement('script');script.async=true;script.src=${asciiJson(assetBase + '/cookieconsent.umd.js')};`
    + `if(n)script.nonce=n;script.onload=function(){lib=!!(window.CookieConsent&&typeof window.CookieConsent.run==='function');`
    + `if(!lib){failure('Consent library did not initialize');return;}run();};script.onerror=function(){failure('Consent library could not load');};`
    + `d.head.appendChild(script);}run();}catch(error){failure(error);}})();`;
}

/**
 * Everything one page needs for the banner: one marked script that loads the assets without
 * blocking the page. The same marker lets a republished served copy shed this node-owned code.
 * `assetBase` is the service's own address for a page on another origin (an app); empty on its own
 * pages. `nonce` is the page's CSP nonce: the service's own pages allow an inline script only with
 * it, and without it the start script was blocked and the banner never showed there.
 */
export function cookieConsentSnippet(config: BannerConfig, opts: CookieBannerOptions & { nonce?: string } = {}): string {
  const base = (opts.assetBase ?? '').replace(/\/+$/, '');
  const nonce = opts.nonce && /^[A-Za-z0-9+/=_-]{8,200}$/.test(opts.nonce) ? ` nonce="${opts.nonce}"` : '';
  return `<script ${COOKIE_BANNER_MARK}${nonce}>${startJs(buildCookieConsentRunConfig(config, opts), opts.mark === true, base)}</script>`;
}

/**
 * Express middleware that adds the banner to the service's own HTML responses before </body>.
 * The switch and the categories are read on every response, so a change in Config applies at once.
 * A page that already carries the banner (an app or a portfolio with its owner's tags) is left alone.
 *
 * ONLY WHEN THERE IS SOMETHING TO ASK. The service's own pages (home, settings, admin, chat) set
 * the cookies they need to work and nothing else, and those need no consent. With the operator's
 * list at `necessary` alone, which is the default, they get no banner: it asked a question with one
 * possible answer on every page (Jouni, 2026-10-11: "it asked there too, what it should not ask").
 * The banner shows there only when the operator lists a category a visitor can refuse.
 */
export function cookieConsentMiddleware(config: AimeatConfig): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction) => {
    const originalSend = res.send.bind(res);

    res.send = function (body?: unknown): Response {
      if (config.cookieConsentEnabled === true && typeof body === 'string' && consentCategories(config).length > 1) {
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
  return startJs(buildCookieConsentRunConfig(config));
}
