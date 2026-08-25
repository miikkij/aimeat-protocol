/**
 * @file src/config-site-presence.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How the node presents itself to the public web: the robots.txt content signals,
 *   the AI-training crawler decision, outbound Web Bot Auth signing, and which front page the
 *   root serves. Kept together because they answer one question — what does a stranger (human
 *   or crawler) meet at the door.
 *
 *   Its own file rather than more lines in config-types.ts, which crossed the 800-line ceiling
 *   the moment the front-page switch was added. Pure extraction, same pattern and reason as
 *   config-security.ts: the diff stays the thing being added instead of reflowing a file two
 *   sessions are working in.
 * @structure SitePresenceConfig · SeoConfig · seoDefaults() · parseVerificationExtra()
 * @usage interface AimeatConfig extends SitePresenceConfig { … }
 *   return { ...seoDefaults(), … };
 * @version-history
 *   v1.1.0 — 2026-08-25 — The `seo*` block: who this node says it is, and whether it says it at
 *     all. Every one of these values was a hardcoded string in public/spa.html naming aimeat.io
 *     and its operator, so a second node running this software introduced itself to Google and to
 *     every unfurler as a company it has nothing to do with. `seoIndexing` is the master switch a
 *     development or personal node needed and never had.
 *   v1.0.0 — 2026-08-19 — Extracted contentSignal, aiTraining and webBotAuthSign verbatim from
 *     config-types.ts; frontPage (AIMEAT_FRONT_PAGE) added as the new member.
 */
import { logger } from './utils/logger.js';

export interface SitePresenceConfig extends SeoConfig {
  /**
   * robots.txt Content Signals Policy directive ("search=yes, ai-input=yes, ai-train=no"); 'off'
   * removes it. Empty means "pair it to `aiTraining`", which is the default.
   */
  contentSignal: string;
  /**
   * Whether the AI training crawlers are allowed in robots.txt. Search and retrieval bots are
   * always allowed and are not covered by this; see `public/robots.node.txt`.
   */
  aiTraining: 'allow' | 'deny';
  /** Web Bot Auth: sign outbound safeFetch requests (RFC 9421, node Ed25519 key). OFF by default. */
  webBotAuthSign: boolean;
  /**
   * Which front page the root serves to a browser: 'classic' is the SPA landing, 'demo' is the
   * static showroom page (public/front-demo.html) and 'os' is the static OS page
   * (public/front-os.html), each with a .fi sibling by language. One switch, so a new front can
   * be staged, flipped on, and flipped back without touching anything else. The static pages
   * stay directly reachable at their own paths either way.
   */
  frontPage: 'classic' | 'demo' | 'os';
}

/** Who this node says it is to a search engine or an unfurler, and whether it says it at all. */
export interface SeoConfig {
  /**
   * Master switch for search-engine discoverability. 'off' serves a `Disallow: /` robots.txt with
   * no Sitemap lines and stamps `X-Robots-Tag: noindex, nofollow` on every response.
   *
   * Both halves are needed and neither is enough alone: robots.txt stops the crawl, and the header
   * stops the listing. A URL somebody else links to gets indexed from the link text alone when
   * only robots.txt refuses, because a crawler that is not allowed to fetch the page is also not
   * allowed to read the noindex inside it.
   */
  seoIndexing: 'on' | 'off';
  /** Site name: the WebSite JSON-LD, `og:site_name`, and the `isPartOf` on every page. */
  seoSiteName: string;
  /** Fallback meta description for any page the public-page registry does not cover. */
  seoSiteDescription: string;
  /** Absolute or root-relative image for `og:image` and `twitter:image`. */
  seoOgImage: string;
  /** Organization JSON-LD: who stands behind this node, as opposed to what the software is. */
  seoOrganizationName: string;
  /** Organization `url`. Empty falls back to the node's own base URL. */
  seoOrganizationUrl: string;
  /** Organization `logo`. Absolute or root-relative. */
  seoOrganizationLogo: string;
  /**
   * Organization `sameAs`: the other places this operator is the same entity. The project repo is
   * the only default, because it is the one link true of every node running this software; an
   * operator's own company or social profiles are per-operator and belong in their own config.
   */
  seoSameAs: string[];
  /** `twitter:site` handle, with or without the leading @. Empty omits the tag. */
  seoTwitterSite: string;
  /** Google Search Console `google-site-verification` token. Empty omits the tag. */
  seoVerificationGoogle: string;
  /** Bing Webmaster Tools `msvalidate.01` token. Empty omits the tag. */
  seoVerificationBing: string;
  /**
   * Any other verification meta tag, as `{name: content}` — Yandex, Pinterest, Facebook and
   * whatever the next one is called. Open-ended because the list changes faster than this file.
   */
  seoVerificationExtra: Record<string, string>;
  /** Notify IndexNow when indexable content changes. No-op without an IndexNow key. */
  seoIndexnowAuto: boolean;
  /**
   * Who decides whether a published app is search-visible. 'owner' means the app owner's own
   * switch is the whole decision; 'review' means the owner requests it and the operator approves.
   * The operator's per-app block works in both modes.
   */
  appsSeoMode: 'owner' | 'review';
}

/**
 * `{"name":"content"}` from the environment, or an empty map. A mistyped verification tag is a
 * cosmetic problem and must not stop the node from booting, so bad JSON is dropped rather than
 * thrown. Non-string values are dropped for the same reason: they would end up stringified into
 * a meta tag as "[object Object]".
 *
 * Dropped LOUDLY, though. A verification tag that silently does not appear is exactly the failure
 * an operator spends an afternoon on, refreshing Search Console and wondering why it will not
 * verify, so the reason goes to the log at the moment the value is read.
 */
export function parseVerificationExtra(raw: string | undefined): Record<string, string> {
  if (!raw?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.warn(
      'AIMEAT_SEO_VERIFICATION_EXTRA is not valid JSON; no extra verification tags will be served',
      { err: (err as Error).message },
    );
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    logger.warn('AIMEAT_SEO_VERIFICATION_EXTRA must be a JSON object of {name: content}; ignoring it');
    return {};
  }
  const out: Record<string, string> = {};
  for (const [name, content] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof content === 'string' && name.trim()) out[name.trim()] = content;
    else logger.warn('Verification tag dropped: its value is not a string', { name });
  }
  return out;
}

/**
 * The SEO block's defaults, spread into the config object literal by `loadConfig()`.
 *
 * Its own function for the same reason `securityDoorDefaults()` is: config.ts sits close to the
 * 800-line ceiling, and a block of fields belongs next to the interface documenting it rather
 * than in the middle of a 700-line object literal.
 *
 * Every default here is a fact about the SOFTWARE, not about one deployment. Anything describing a
 * particular operator — their company, their social profiles, their Search Console token — starts
 * empty and is theirs to fill in. That distinction is the whole point of the block: these values
 * were literals in public/spa.html naming aimeat.io and its operator, so a second node running
 * this software claimed in its own structured data to be a company it has nothing to do with.
 */
export function seoDefaults(): SeoConfig {
  return {
    // 'on' rather than 'off' by default: switching a node to noindex is a decision its operator
    // can see and reverse, whereas defaulting to noindex would silently drop every node already
    // running from search the moment it upgraded.
    seoIndexing: process.env.AIMEAT_SEO_INDEXING?.trim().toLowerCase() === 'off' ? 'off' : 'on',
    seoSiteName: (process.env.AIMEAT_SEO_SITE_NAME ?? 'AIMEAT').trim(),
    seoSiteDescription: (process.env.AIMEAT_SEO_SITE_DESCRIPTION
      ?? 'Open protocol infrastructure for AI agents: persistent memory, identity, consent, shared workspaces and a usage meter, over REST and MCP.').trim(),
    seoOgImage: (process.env.AIMEAT_SEO_OG_IMAGE ?? '/og-image.png').trim(),
    seoOrganizationName: (process.env.AIMEAT_SEO_ORGANIZATION_NAME ?? 'AIMEAT').trim(),
    // Empty resolves to the node's own base URL where it is rendered. It cannot default to
    // baseUrl here because baseUrl is assembled by the caller, after this spread.
    seoOrganizationUrl: (process.env.AIMEAT_SEO_ORGANIZATION_URL ?? '').trim(),
    seoOrganizationLogo: (process.env.AIMEAT_SEO_ORGANIZATION_LOGO ?? '/favicon.svg').trim(),
    // The project repository is the only link true of every node running this software. The
    // operator's own company used to be hardcoded beside it and is now theirs to set.
    seoSameAs: (process.env.AIMEAT_SEO_SAME_AS ?? 'https://github.com/miikkij/aimeat-protocol')
      .split(',').map(s => s.trim()).filter(Boolean),
    seoTwitterSite: (process.env.AIMEAT_SEO_TWITTER_SITE ?? '').trim(),
    seoVerificationGoogle: (process.env.AIMEAT_SEO_VERIFICATION_GOOGLE ?? '').trim(),
    seoVerificationBing: (process.env.AIMEAT_SEO_VERIFICATION_BING ?? '').trim(),
    seoVerificationExtra: parseVerificationExtra(process.env.AIMEAT_SEO_VERIFICATION_EXTRA),
    seoIndexnowAuto: process.env.AIMEAT_SEO_INDEXNOW_AUTO !== 'false',
    appsSeoMode: process.env.AIMEAT_APPS_SEO_MODE?.trim().toLowerCase() === 'review' ? 'review' : 'owner',
  };
}
