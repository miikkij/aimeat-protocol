/**
 * @file src/services/config-schema-seo.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The search-engine presence settings on the admin Config tab. A pure move out of
 *   config-schema.ts (max-file-lines): CONFIG_FIELDS spreads these rows where they stood, so the
 *   Config tab lists them in the same order.
 * @structure SEO_CONFIG_FIELDS
 * @version-history
 *   v1.0.0 — 2026-09-28 — Moved from config-schema.ts, unchanged.
 */
// The site presence part of the config type, not AimeatConfig, as config-schema-ai.ts does.
import type { SitePresenceConfig } from '../config-site-presence.js';
import type { ConfigFieldShape } from './config-field-def.js';

export const SEO_CONFIG_FIELDS: ConfigFieldShape<keyof SitePresenceConfig>[] = [
  // ── Search-engine presence (mutable) ──
  // All of these were literals in public/spa.html naming aimeat.io and its operator, host-rewritten
  // on serve but never name-rewritten, so a second node introduced itself in its own structured
  // data as a company it has nothing to do with. Mutable rather than immutable because the one
  // thing an operator has to do FIRST — paste a Search Console verification token and see whether
  // it is being served — is worthless if it needs a restart and a shell to try.
  { key: 'seoIndexing', dotPath: 'seo.indexing', envVar: 'AIMEAT_SEO_INDEXING', type: 'string', validate: v => v === 'on' || v === 'off', immutable: false, description: 'Search-engine discoverability master switch. "off" serves a Disallow-all robots.txt and stamps X-Robots-Tag: noindex on every response', range: 'on|off' },
  { key: 'seoSiteName', dotPath: 'seo.site_name', envVar: 'AIMEAT_SEO_SITE_NAME', type: 'string', validate: v => typeof v === 'string' && (v as string).length <= 120, immutable: false, description: 'Site name in the WebSite structured data, og:site_name, and every page\'s isPartOf' },
  { key: 'seoSiteDescription', dotPath: 'seo.site_description', envVar: 'AIMEAT_SEO_SITE_DESCRIPTION', type: 'string', validate: v => typeof v === 'string' && (v as string).length <= 400, immutable: false, description: 'Fallback meta description for pages the public-page registry does not cover' },
  { key: 'seoOgImage', dotPath: 'seo.og_image', envVar: 'AIMEAT_SEO_OG_IMAGE', type: 'string', validate: v => typeof v === 'string' && (v as string).length <= 500, immutable: false, description: 'Image for og:image and twitter:image, absolute or root-relative' },
  { key: 'seoOrganizationName', dotPath: 'seo.organization_name', envVar: 'AIMEAT_SEO_ORGANIZATION_NAME', type: 'string', validate: v => typeof v === 'string' && (v as string).length <= 120, immutable: false, description: 'Organization structured data: who stands behind this node, as opposed to what the software is' },
  { key: 'seoOrganizationUrl', dotPath: 'seo.organization_url', envVar: 'AIMEAT_SEO_ORGANIZATION_URL', type: 'string', validate: v => typeof v === 'string' && ((v as string).trim() === '' || /^https?:\/\//i.test(v as string)), immutable: false, description: 'Organization url (empty falls back to this node\'s base URL)' },
  { key: 'seoOrganizationLogo', dotPath: 'seo.organization_logo', envVar: 'AIMEAT_SEO_ORGANIZATION_LOGO', type: 'string', validate: v => typeof v === 'string' && (v as string).length <= 500, immutable: false, description: 'Organization logo, absolute or root-relative' },
  { key: 'seoSameAs', dotPath: 'seo.same_as', envVar: 'AIMEAT_SEO_SAME_AS', type: 'object', validate: v => Array.isArray(v) && v.every(u => typeof u === 'string' && /^https?:\/\//i.test(u)), immutable: false, description: 'Organization sameAs: the other places this operator is the same entity, one absolute URL per line' },
  { key: 'seoTwitterSite', dotPath: 'seo.twitter_site', envVar: 'AIMEAT_SEO_TWITTER_SITE', type: 'string', validate: v => typeof v === 'string' && (v as string).length <= 40, immutable: false, description: 'twitter:site handle, with or without the leading @ (empty omits the tag)' },
  { key: 'seoVerificationGoogle', dotPath: 'seo.verification_google', envVar: 'AIMEAT_SEO_VERIFICATION_GOOGLE', type: 'string', validate: v => typeof v === 'string' && (v as string).length <= 200, immutable: false, description: 'Google Search Console google-site-verification token (empty omits the tag)' },
  { key: 'seoVerificationBing', dotPath: 'seo.verification_bing', envVar: 'AIMEAT_SEO_VERIFICATION_BING', type: 'string', validate: v => typeof v === 'string' && (v as string).length <= 200, immutable: false, description: 'Bing Webmaster Tools msvalidate.01 token (empty omits the tag)' },
  { key: 'seoVerificationExtra', dotPath: 'seo.verification_extra', envVar: 'AIMEAT_SEO_VERIFICATION_EXTRA', type: 'object', validate: v => !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v as Record<string, unknown>).every(c => typeof c === 'string'), immutable: false, description: 'Any other verification meta tag as {name: content} — Yandex, Pinterest, Facebook' },
  { key: 'seoIndexnowAuto', dotPath: 'seo.indexnow_auto', envVar: 'AIMEAT_SEO_INDEXNOW_AUTO', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Notify IndexNow when indexable content changes (no-op without an IndexNow key)' },
  { key: 'appsSeoMode', dotPath: 'apps.seo_mode', envVar: 'AIMEAT_APPS_SEO_MODE', type: 'string', validate: v => v === 'owner' || v === 'review', immutable: false, description: 'Who decides an app is search-visible: "owner" (their own switch is the decision) or "review" (they request, the operator approves). The operator\'s per-app block works in both', range: 'owner|review' },
];
