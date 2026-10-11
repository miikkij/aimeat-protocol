/**
 * @file src/services/visibility/analytics-tags.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The analytics tags an owner already uses, added by the place to its pages and apps
 *   (AI visibility, layer B): Microsoft Clarity and Google Analytics 4, each from the id the owner
 *   set (visibility-settings.ts). The owner's own accounts receive the data; the node sends nothing
 *   to either service itself.
 *
 *   CONSENT DECIDES WHEN A TAG LOADS. With the node's cookie banner on, the snippet adds no script
 *   from Clarity or Google until the visitor accepts the `analytics` category, and then passes the
 *   choice on: Clarity's consent API (`consentv2`) and GA4's consent mode (`consent default` /
 *   `consent update`). Advertising storage is always denied: the owner asked for analytics. With the
 *   banner off the tags load at once, and the report tells the owner plainly that EU visitors need
 *   consent first (visibility-report.ts `tags.warning`).
 *
 *   A BROWSER THAT SENDS GLOBAL PRIVACY CONTROL gets no tag at all: sharing its visit with a third
 *   party is exactly what the signal says no to.
 *
 *   The banner itself is the node's (middleware/cookie-consent.ts). An app is served as bytes, which
 *   the banner middleware does not touch, so a page with tags and the banner on gets the banner here,
 *   with the `analytics` category added when the operator's list lacks it: a tag that waits for a
 *   category nobody can accept would never load.
 * @structure visibilitySettingsView · nodeAllowsTags · tagsActive · ownerTagsSnippet · withOwnerTags · ownerTagsFor
 * @usage buf = withOwnerTags(buf, ownerTagsSnippet(config, settings));
 * @version-history
 *   v1.2.0 — 2026-10-11 — The banner a page with tags gets names the services (Clarity, Google
 *     Analytics) in the visitor's language and removes their cookies when consent is taken back
 *     (middleware/cookie-consent.ts cookieConsentSnippet); Google's cookie stays on the page's own host.
 *   v1.1.0 — 2026-10-08 — ownerTagsFor takes the app's filename and adds the behaviour script (layer D).
 *   v1.0.0 — 2026-10-08 — Initial (layer B).
 */
import type { AimeatConfig } from '../../config.js';
import type { VisibilitySettings } from '../../models/visibility-schemas.js';
import { cookieConsentSnippet } from '../../middleware/cookie-consent.js';
import { CLARITY_ID_RE, GA4_ID_RE, cachedVisibilitySettings } from './visibility-settings.js';
import type { Storage } from '../../storage/interface.js';
import { ownerGhiiOf } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { behaviourOnFor } from './behaviour-settings.js';
import { behaviourSnippet } from './behaviour-script.js';

/**
 * The owner's settings as REST and MCP answer them, with what the node decides beside them: whether
 * the operator allows counting and tags, whether the cookie banner is on, and the warning an owner
 * with a tag and no banner must read.
 */
export function visibilitySettingsView(config: AimeatConfig, s: VisibilitySettings): Record<string, unknown> {
  const banner = config.cookieConsentEnabled === true;
  const hasTag = !!(s.clarityProjectId || s.ga4MeasurementId);
  return {
    enabled: s.enabled,
    node_enabled: config.aiVisibilityEnabled !== false,
    clarity_project_id: s.clarityProjectId,
    ga4_measurement_id: s.ga4MeasurementId,
    tags_node_enabled: nodeAllowsTags(config),
    tags_active: tagsActive(config, s),
    consent_banner: banner,
    tags_warning: hasTag && !banner
      ? 'This place shows no cookie banner, so the tags load for every visitor at once. Clarity and Google Analytics set cookies, which in the EU and the UK need the visitor\'s consent first. Ask the operator to turn on the cookie banner, or remove the tags for EU visitors.'
      : null,
    updated_at: s.updatedAt || null,
  };
}

/** Whether the operator left this layer on for the node. On unless set to false. */
export const nodeAllowsTags = (config: AimeatConfig): boolean => config.analyticsTagsEnabled !== false;

/** Whether this owner's pages carry a tag now. */
export function tagsActive(config: AimeatConfig, settings: VisibilitySettings): boolean {
  return nodeAllowsTags(config) && !!(settings.clarityProjectId || settings.ga4MeasurementId);
}

/**
 * The snippet for one owner's pages, or '' when there is nothing to add. The ids are checked against
 * their shape again here, because they are written into a script: only letters, digits and a dash
 * can reach the page.
 */
export function ownerTagsSnippet(config: AimeatConfig, settings: VisibilitySettings): string {
  if (!tagsActive(config, settings)) return '';
  const clarity = settings.clarityProjectId && CLARITY_ID_RE.test(settings.clarityProjectId) ? settings.clarityProjectId : '';
  const ga4 = settings.ga4MeasurementId && GA4_ID_RE.test(settings.ga4MeasurementId) ? settings.ga4MeasurementId : '';
  if (!clarity && !ga4) return '';
  const banner = config.cookieConsentEnabled === true;

  const script = `<script data-aimeat-tags>(function(){`
    + `var C=${JSON.stringify(clarity)},G=${JSON.stringify(ga4)},B=${banner ? 'true' : 'false'};`
    + `if(navigator.globalPrivacyControl===true)return;`
    + `var w=window,d=document,started=false;`
    + `w.dataLayer=w.dataLayer||[];if(!w.gtag){w.gtag=function(){w.dataLayer.push(arguments);};}`
    + `function v(g){return g?'granted':'denied';}`
    + `function pass(g){`
    + `if(G){w.gtag('consent','update',{analytics_storage:v(g),ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});}`
    + `if(C&&w.clarity){w.clarity('consentv2',{ad_Storage:'denied',analytics_Storage:v(g)});}}`
    + `function start(){if(started)return;started=true;`
    + `if(G){w.gtag('consent','default',{analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});`
    + `var s=d.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(G);d.head.appendChild(s);`
    // cookie_domain 'none' keeps Google's cookie on this page's own host. Its default is the widest
    // domain it can write, which for an app is the address every other owner's app shares.
    + `w.gtag('js',new Date());w.gtag('config',G,{cookie_domain:'none'});}`
    + `if(C){w.clarity=w.clarity||function(){(w.clarity.q=w.clarity.q||[]).push(arguments);};`
    + `var t=d.createElement('script');t.async=true;t.src='https://www.clarity.ms/tag/'+encodeURIComponent(C);d.head.appendChild(t);`
    + `w.clarity('consentv2',{ad_Storage:'denied',analytics_Storage:'granted'});}}`
    + `if(!B){start();return;}`
    + `function check(){var cc=w.CookieConsent;var ok=!!(cc&&cc.acceptedCategory&&cc.acceptedCategory('analytics'));`
    + `if(ok){start();pass(true);}else if(started){pass(false);}}`
    + `w.addEventListener('cc:onConsent',check);w.addEventListener('cc:onChange',check);`
    + `if(d.readyState==='loading'){d.addEventListener('DOMContentLoaded',check);}else{check();}`
    + `})();</script>`;

  if (!banner) return script;
  // The banner asks about `analytics` whatever the operator's list says (a tag that waits for a
  // category nobody can accept would never load), names the services this owner uses, and removes
  // their cookies on this host when the visitor takes the consent back. Its assets come from the
  // service's own address: an app origin does not serve them.
  return script + cookieConsentSnippet(config, {
    ensure: ['analytics'],
    services: { clarity: !!clarity, ga4: !!ga4 },
    clearOnRevoke: [
      ...(clarity ? ['_clck', '_clsk'] : []),
      ...(ga4 ? ['_ga', `_ga_${ga4.slice(2)}`, '_gid'] : []),
    ],
    assetBase: config.baseUrl,
  });
}

/**
 * The snippet for the owner of a page, for the serve paths. Never throws: a page is served without
 * tags rather than not served. With `app` (an app's filename) it also carries the on-page behaviour
 * script (layer D), first, so a page that already loads the cookie banner keeps it when the
 * banner part is cut (ownerTagsIntoHtml).
 */
export async function ownerTagsFor(storage: Storage, config: AimeatConfig, ownerGaii: string, app?: string): Promise<string> {
  const ownerGhii = ownerGhiiOf(ownerGaii);
  let behaviour = '';
  if (app) {
    try {
      if (await behaviourOnFor(storage, config, ownerGhii, app)) behaviour = behaviourSnippet(config.baseUrl, ownerGhii, app);
    } catch (e) {
      logger.warn('visibility: the behaviour switch could not be read', { error: String(e) });
    }
  }
  if (!nodeAllowsTags(config)) return behaviour;
  try {
    return behaviour + ownerTagsSnippet(config, await cachedVisibilitySettings(storage, ownerGhii));
  } catch (e) {
    logger.warn('visibility: the owner\'s analytics tags could not be read', { error: String(e) });
    return behaviour;
  }
}

/**
 * Add the snippet to a served document: before `</head>`, else before `<body>`, else after the
 * doctype. A
 * document that already carries the banner (the SPA, where the middleware added it) is left with
 * one banner: the snippet's banner part is skipped when the body already loads it.
 */
export function ownerTagsIntoHtml(html: string, snippet: string): string {
  if (!snippet) return html;
  const piece = html.includes('cookieconsent.umd.js') ? snippet.replace(/<link rel="stylesheet" href="[^"]*cookieconsent\.css">.*$/s, '') : snippet;
  // Before </head>; in a document with no head, before <body>; else after the doctype and <html>.
  // Never in front of the doctype: a script before it puts the page in quirks mode.
  const head = html.search(/<\/head\s*>/i);
  if (head >= 0) return html.slice(0, head) + piece + html.slice(head);
  const body = html.search(/<body[\s>]/i);
  if (body >= 0) return html.slice(0, body) + piece + html.slice(body);
  const lead = /^(\s*<!doctype[^>]*>)?(\s*<html[^>]*>)?/i.exec(html)?.[0] ?? '';
  return html.slice(0, lead.length) + piece + html.slice(lead.length);
}

/** The same for a document served as bytes (an app). */
export function withOwnerTags(body: Buffer, snippet: string): Buffer {
  return snippet ? Buffer.from(ownerTagsIntoHtml(body.toString('utf8'), snippet), 'utf8') : body;
}
