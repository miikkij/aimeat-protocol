/**
 * @file public-pages.ts
 * @description The node's public, human-facing HTML pages as ONE registry. Every surface that has
 *   to enumerate those pages reads this list instead of keeping its own copy: sitemap.xml, the
 *   markdown site map, the per-page markdown mirrors, and the per-route <head> metadata (canonical,
 *   title, description, og:*). Four consumers, one place to add a page.
 *
 *   Before this registry, sitemap.xml carried a hand-written list that had drifted into advertising
 *   API endpoints — `/v1/spec` (YAML), `/v1/health` and `/v1/catalogue` (JSON) — as if they were
 *   indexable pages. A crawler or agent-readability scanner reads sitemap.xml, applies HTML page
 *   checks to every URL in it, and marks three quarters of them failed: a JSON endpoint has no
 *   canonical link, no og:title and no headings, and should never have claimed to. Those endpoints
 *   stay discoverable where they belong — the RFC 9727 API catalog, the Link headers on every GET,
 *   llms.txt and the bootstrap response.
 *
 * @structure
 *   - PublicPage            — one page: path, title, description, sitemap hints
 *   - PUBLIC_PAGES          — the registry, in the order the sitemap should list them
 *   - sitemapPages()        — the subset that is live and belongs in sitemap.xml
 *   - findPublicPage(path)  — exact-path lookup for the per-route <head>/mirror consumers
 * @usage
 *   import { sitemapPages } from '../data/public-pages.js';
 *   for (const page of sitemapPages()) { ... }
 * @version-history
 *   v1.0.0 — 2026-07-28 — Initial: one registry behind sitemap.xml; API endpoints dropped from the
 *     sitemap (docs/internal/agentscanner/02-vaihe-sitemap-xml.md)
 */

/** How often a crawler should expect the page to change (sitemaps.org changefreq). */
export type ChangeFreq = 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';

/** One public HTML page on this node. */
export interface PublicPage {
  /** Absolute path on the node, no origin and no trailing slash (the root is `/`). */
  path: string;
  /** Page title. Also the `<title>` and `og:title` once the head consumer lands (phase 08). */
  title: string;
  /**
   * One-sentence summary of what the page is. Kept at 50+ characters because that is the length a
   * meta description needs before it summarises anything, and this same string becomes the page's
   * `meta description`, `og:description` and markdown frontmatter `description`.
   */
  description: string;
  changefreq: ChangeFreq;
  /** sitemaps.org priority, relative within this node. */
  priority: string;
  /**
   * The page is designed but not yet served. Kept in the registry so the plan is visible in one
   * place, excluded from sitemap.xml so the sitemap never points at a 404.
   */
  planned?: boolean;
}

/**
 * The public pages, in sitemap order. Every entry is served as `text/html` — that is the entry
 * criterion. An endpoint that answers JSON or YAML does not belong here no matter how public it is.
 */
export const PUBLIC_PAGES: PublicPage[] = [
  {
    path: '/',
    title: 'AIMEAT — AI Memory Exchange and Action Transfer',
    description: 'Open protocol infrastructure for AI agents: persistent memory, identity, consent, shared workspaces and a usage meter, over REST and MCP.',
    changefreq: 'weekly',
    priority: '1.0',
  },
  {
    path: '/v1/portal',
    title: 'Portal — register, sign in, manage your agents and data',
    description: 'The AIMEAT portal: create an account, connect and approve AI agents, and manage the memory, files and workspaces they can reach.',
    changefreq: 'weekly',
    priority: '0.9',
  },
  {
    path: '/v1/business',
    title: 'AIMEAT for your business',
    description: 'What AIMEAT does for an organisation: consent-governed shared memory, auditable agent access, and coordination across teams and their AI agents.',
    changefreq: 'monthly',
    priority: '0.8',
  },
  {
    path: '/v1/how-it-works',
    title: 'How AIMEAT works',
    description: 'The protocol in plain terms: identities for humans and their agents, memory with visibility rules, consent, and how nodes federate.',
    changefreq: 'monthly',
    priority: '0.8',
  },
  {
    path: '/v1/docs',
    title: 'API documentation',
    description: 'Browsable reference for every AIMEAT endpoint, generated from the OpenAPI contract that governs this node.',
    changefreq: 'weekly',
    priority: '0.8',
  },
  {
    path: '/v1/help',
    title: 'Help',
    description: 'Getting started with AIMEAT, common questions, and a ready-made prompt you can paste into any AI chat to be walked through the node.',
    changefreq: 'monthly',
    priority: '0.7',
  },
  {
    path: '/v1/connect',
    title: 'Connect an AI assistant to this node',
    description: 'Connect Claude, ChatGPT or any MCP-capable assistant to your AIMEAT account, and approve exactly which scopes it may use.',
    changefreq: 'monthly',
    priority: '0.7',
  },
  {
    // Phase 06 (docs/internal/agentscanner/06-vaihe-sanasto.md). Listed here so the registry shows
    // the full plan; `planned` keeps it out of sitemap.xml until the route exists.
    path: '/v1/glossary',
    title: 'Glossary',
    description: 'The AIMEAT vocabulary: GHII, GAII and GEAI identities, morsels, organisms, workspaces, skills, capabilities and the rest, defined precisely.',
    changefreq: 'monthly',
    priority: '0.6',
    planned: true,
  },
  {
    path: '/v1/privacy',
    title: 'Privacy',
    description: 'How this AIMEAT node handles personal data: what is stored, who can reach it, how consent is recorded, and how to have it removed.',
    changefreq: 'yearly',
    priority: '0.3',
  },
  {
    path: '/v1/terms',
    title: 'Terms of use',
    description: 'The terms under which this AIMEAT node is offered, for the humans who hold accounts and the agents acting on their behalf.',
    changefreq: 'yearly',
    priority: '0.3',
  },
];

/** The pages that are live, and therefore belong in sitemap.xml. */
export function sitemapPages(): PublicPage[] {
  return PUBLIC_PAGES.filter((p) => !p.planned);
}

/** Exact-path lookup — `undefined` for a path that is not a registered public page. */
export function findPublicPage(path: string): PublicPage | undefined {
  return PUBLIC_PAGES.find((p) => p.path === path);
}
