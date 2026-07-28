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
  /**
   * The page's own markdown body, served at `<path>.md` and to `Accept: text/markdown`.
   * `{{BASE_URL}}` is substituted at serve time — the same token llms-template.txt uses, so a
   * node that is not aimeat.io renders its own links.
   *
   * Authored, not converted. Every one of these pages is a Preact view whose HTML is an empty
   * shell until scripts run, so there is no readable markup to convert — the same reason the root
   * and portal markdown renderings have always been written by hand. Keep it to what the page IS
   * and where it leads: a tight summary drifts slowly, a paragraph-by-paragraph mirror drifts the
   * moment anyone edits the view.
   *
   * Omitted for pages whose HTML is real content already (the static info pages convert cleanly).
   */
  markdown?: string;
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
    markdown: `Open protocol infrastructure for AI agents and the people who own them: persistent memory,
identities you grant and revoke, shared workspaces, skills, tasks and a usage meter, over REST
and MCP.

## For people

Register in the [portal]({{BASE_URL}}/v1/portal), then connect an assistant from
[Connect]({{BASE_URL}}/v1/connect). [How it works]({{BASE_URL}}/v1/how-it-works) explains the model without protocol
jargon; [For your business]({{BASE_URL}}/v1/business) covers the organisational case.

## For agents

- Machine-readable bootstrap: \`GET {{BASE_URL}}/?format=json\`
- Full manual: [llms.txt]({{BASE_URL}}/llms.txt) · Orientation: [AGENTS.md]({{BASE_URL}}/AGENTS.md)
- Get an identity: [auth.md]({{BASE_URL}}/auth.md) (RFC 8628 device flow, the owner approves)
- Contract: [OpenAPI]({{BASE_URL}}/v1/spec) · MCP server: \`POST {{BASE_URL}}/v1/mcp\`
- Vocabulary: [glossary]({{BASE_URL}}/v1/glossary)
`,
  },
  {
    path: '/v1/portal',
    title: 'Portal — register, sign in, manage your agents and data',
    description: 'The AIMEAT portal: create an account, connect and approve AI agents, and manage the memory, files and workspaces they can reach.',
    changefreq: 'weekly',
    priority: '0.9',
    markdown: `The portal is where a person holds an AIMEAT account: register or sign in, connect AI agents and
approve exactly what each may reach, and manage the memory, files, workspaces and organisms behind
them.

An agent never enrols itself. It asks for a device code, and the person approves it here and picks
its scopes — see [Connect]({{BASE_URL}}/v1/connect) for the walkthrough, or [auth.md]({{BASE_URL}}/auth.md) for the
protocol-level flow.
`,
  },
  {
    path: '/v1/business',
    title: 'AIMEAT for your business',
    description: 'What AIMEAT does for an organisation: consent-governed shared memory, auditable agent access, and coordination across teams and their AI agents.',
    changefreq: 'monthly',
    priority: '0.8',
    markdown: `What AIMEAT gives an organisation: shared memory its people and their AI agents work from,
access that is granted and revoked per person and per agent, and a record of who reached what.

The point is not that agents can store things. It is that an organisation can let them, and still
answer the questions an auditor asks: whose data, on whose authority, for what purpose, and how do
we stop it. Consent is recorded, scoped and revocable, and the enforcement is at the access check
rather than in policy.

See also [How it works]({{BASE_URL}}/v1/how-it-works) and the [glossary]({{BASE_URL}}/v1/glossary).
`,
  },
  {
    path: '/v1/how-it-works',
    title: 'How AIMEAT works',
    description: 'The protocol in plain terms: identities for humans and their agents, memory with visibility rules, consent, and how nodes federate.',
    changefreq: 'monthly',
    priority: '0.8',
    markdown: `AIMEAT in plain terms.

A person has an identity on a node. Their AI agents get identities of their own underneath it, each
approved by the person and limited to named permissions. Anything an agent stores belongs to the
person, not to the agent and not to the model vendor, and survives the session that created it.

Work happens in organisms: shared spaces holding workspaces, records and documents, with membership
and access per space. Agents and people work on the same material.

What agents produce can carry a price, which is where a capability stops being a demo and becomes
something somebody buys.

The vocabulary is in the [glossary]({{BASE_URL}}/v1/glossary); the full technical account is
[llms.txt]({{BASE_URL}}/llms.txt).
`,
  },
  {
    path: '/v1/docs',
    title: 'API documentation',
    description: 'Browsable reference for every AIMEAT endpoint, generated from the OpenAPI contract that governs this node.',
    changefreq: 'weekly',
    priority: '0.8',
    markdown: `Browsable reference for every endpoint on this node, rendered from the OpenAPI contract that
governs it.

- The contract itself: [{{BASE_URL}}/v1/spec]({{BASE_URL}}/v1/spec)
- Prefer prose: [llms.txt]({{BASE_URL}}/llms.txt) has the same surface with worked examples
- Getting an identity first: [auth.md]({{BASE_URL}}/auth.md)
`,
  },
  {
    path: '/v1/help',
    title: 'Help',
    description: 'Getting started with AIMEAT, common questions, and a ready-made prompt you can paste into any AI chat to be walked through the node.',
    changefreq: 'monthly',
    priority: '0.7',
    markdown: `Getting started with AIMEAT, the questions that come up first, and a prompt you can paste into any
AI chat to be walked through this node.

If you are an agent rather than a person, [AGENTS.md]({{BASE_URL}}/AGENTS.md) is the shorter road, and
[llms.txt]({{BASE_URL}}/llms.txt) is the full manual.
`,
  },
  {
    path: '/v1/connect',
    title: 'Connect an AI assistant to this node',
    description: 'Connect Claude, ChatGPT or any MCP-capable assistant to your AIMEAT account, and approve exactly which scopes it may use.',
    changefreq: 'monthly',
    priority: '0.7',
    markdown: `How to connect an AI assistant to your AIMEAT account.

Any MCP-capable client — Claude Desktop, claude.ai, Cursor and others — attaches to the node's MCP
server at \`{{BASE_URL}}/v1/mcp\` with OAuth 2.1. The server card is at
[/.well-known/mcp.json]({{BASE_URL}}/.well-known/mcp.json).

An agent that is not on an MCP platform uses the device flow instead: it asks for a code, you
approve it in your portal and choose its scopes, and it claims a token. Protocol detail:
[auth.md]({{BASE_URL}}/auth.md).
`,
  },
  {
    path: '/v1/glossary',
    title: 'Glossary',
    description: 'The AIMEAT vocabulary: GHII, GAII and GEAI identities, morsels, organisms, workspaces, skills, capabilities and the rest, defined precisely.',
    changefreq: 'monthly',
    priority: '0.6',
    markdown: `The AIMEAT vocabulary, defined precisely. Several of the terms are near-neighbours of each other,
and guessing wrong is quiet rather than loud.

The full set with forms, examples and cross-references is at
[{{BASE_URL}}/v1/glossary.md]({{BASE_URL}}/v1/glossary.md), and as JSON at
[{{BASE_URL}}/v1/glossary.json]({{BASE_URL}}/v1/glossary.json).
`,
  },
  {
    path: '/v1/privacy',
    title: 'Privacy',
    description: 'How this AIMEAT node handles personal data: what is stored, who can reach it, how consent is recorded, and how to have it removed.',
    changefreq: 'yearly',
    priority: '0.3',
    markdown: `How this node handles personal data: what is stored, who can reach it, how consent is recorded and
revoked, and how to have data removed.

The full text is on the page itself, which also answers \`Accept: text/markdown\` with a conversion of
the real content rather than this summary.
`,
  },
  {
    path: '/v1/terms',
    title: 'Terms of use',
    description: 'The terms under which this AIMEAT node is offered, for the humans who hold accounts and the agents acting on their behalf.',
    changefreq: 'yearly',
    priority: '0.3',
    markdown: `The terms under which this node is offered, for the people who hold accounts and the agents acting
on their behalf.

The full text is on the page itself, which also answers \`Accept: text/markdown\` with a conversion of
the real content rather than this summary.
`,
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

/** The live pages that carry an authored markdown body, i.e. the ones with a `<path>.md` mirror. */
export function mirroredPages(): PublicPage[] {
  return PUBLIC_PAGES.filter((p) => !p.planned && p.markdown);
}
