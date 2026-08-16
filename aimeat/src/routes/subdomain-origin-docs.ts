/**
 * @file subdomain-origin-docs.ts
 * @description The per-origin documents an app origin publishes about ITSELF: llms.txt, robots.txt,
 *   sitemap.xml, the MCP server card, the web-app manifest + icon (installable apps), AGENTS.md,
 *   sitemap.md and the root markdown mirror. Pure extraction from subdomains.ts when that file
 *   crossed the line ceiling — the routes, their comments and their behaviour are unchanged.
 *
 *   An app origin is its own site. Left to fall through, these paths answered with the NODE's
 *   documents on the app's host: a sitemap.xml listing apex URLs (which sitemaps.org forbids
 *   outright — a sitemap may only list URLs from the host that serves it), a robots.txt pointing
 *   at the apex sitemap, and an MCP Server Card describing the node with no mention of the app's
 *   own tools. Each of those is a document about somebody else, served under the app's name.
 *
 *   Everything here is derived from the app record and its tool manifest. There is no per-app
 *   configuration and there must never be one: apps get their origin automatically on first open,
 *   so anything requiring a manual step would be absent on every app already published.
 * @structure
 *   - appOriginFor(req, config) — the app's own origin, from the request host
 *   - registerAppOriginDocs(router, config, storage, deps) — mounts every document route; deps
 *     carry resolveApp/isRestricted from subdomains.ts (same pattern as subdomain-webmcp.ts,
 *     which is what keeps the import between the two files one-directional)
 * @usage registerAppOriginDocs(router, config, storage, { resolveApp, isRestricted });
 * @version-history
 *   v1.0.0 — 2026-08-16 — Extracted from subdomains.ts (max-file-lines); the manifest + icon
 *     routes (installable apps) landed in the same change, in subdomains.ts v1.16.0.
 */
import type { Router, Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, AppRecord } from '../storage/interface.js';
import { appToolNames } from '../services/app-tool-names.js';
import { buildAppAgentFace } from '../services/agent-face.js';
import { appLlmsTxt, appAgentsMd, appSitemapMd, appRootMirrorMd } from '../services/app-agent-surfaces.js';
import { sendMarkdown } from '../services/markdown-negotiation.js';

export interface AppOriginDocDeps {
  resolveApp: (target: string) => Promise<AppRecord | null>;
  isRestricted: (app: AppRecord) => boolean;
}

/**
 * The app's own origin, e.g. `https://nuotta.apps.aimeat.io`. Built from the request host so a
 * node on a different domain, or a dev box on http, describes itself correctly. Falls back to the
 * apex when there is no host to read.
 */
export function appOriginFor(req: Request, config: AimeatConfig): string {
  const host = req.get('host');
  if (!host) return config.baseUrl.replace(/\/$/, '');
  const proto = config.baseUrl.startsWith('https') ? 'https' : (req.protocol || 'http');
  return `${proto}://${host}`;
}

/** Mount every per-origin document route on the subdomain router. */
export function registerAppOriginDocs(
  router: Router, config: AimeatConfig, storage: Storage, deps: AppOriginDocDeps,
): void {
  /**
   * The app behind the current app-origin request, or null when this is not an app origin, the
   * subdomain is unmapped, or the app is restricted. Every per-origin discovery document goes
   * through this so they cannot disagree about which app they are describing.
   */
  async function appForOrigin(req: Request): Promise<AppRecord | null> {
    const sub = req.subdomain;
    if (!req.appOrigin || !sub || !config.appOriginEnabled) return null;
    const site = await storage.getSubdomainSite(sub);
    if (!site || !site.enabled || site.kind !== 'app') return null;
    const app = await deps.resolveApp(site.target);
    if (!app || deps.isRestricted(app)) return null;
    return app;
  }

  // `llms.txt` on an APP origin is the app's own agent-facing document, not the node's.
  // The node-wide guide is 139 kB of app-BUILDING instructions in which the app's own name
  // appears zero times, and it was being served here: an agent that habitually tries
  // /llms.txt read the wrong manual and stopped looking. Serving the same markdown the
  // Agent Face serves keeps one source and answers the habit.
  router.get(['/llms.txt', '/llms-full.txt'], async (req: Request, res: Response, next) => {
    const app = await appForOrigin(req);
    if (!app) return next();
    const face = await buildAppAgentFace(config, storage, app);
    const tools = await appToolNames(storage, app.ownerGaii, app.filename);
    // text/plain, not text/markdown: llmstxt.org names that content type, and this path was
    // answering markdown — a conformance failure on a document whose whole job is conformance.
    res.type('text/plain; charset=utf-8')
      .send(appLlmsTxt(config, app, appOriginFor(req, config), tools, face?.markdown));
  });

  router.get('/robots.txt', async (req: Request, res: Response, next) => {
    const app = await appForOrigin(req);
    if (!app) return next();
    const origin = appOriginFor(req, config);
    res.type('text/plain; charset=utf-8').send(
      `# ${app.ownerName}/${app.filename} — an application published on AIMEAT
` +
      `User-agent: *
Allow: /

Sitemap: ${origin}/sitemap.xml
`);
  });

  router.get('/sitemap.xml', async (req: Request, res: Response, next) => {
    const app = await appForOrigin(req);
    if (!app) return next();
    const origin = appOriginFor(req, config);
    const now = new Date().toISOString().split('T')[0];
    const urls = [`${origin}/`, `${origin}/llms.txt`, `${origin}/AGENTS.md`, `${origin}/sitemap.md`];
    res.type('application/xml').send([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls.map((u) => `  <url><loc>${u}</loc><lastmod>${now}</lastmod></url>`),
      '</urlset>',
    ].join('\n'));
  });

  router.get(['/.well-known/mcp.json', '/.well-known/mcp/server-card.json'],
    async (req: Request, res: Response, next) => {
    const app = await appForOrigin(req);
    if (!app) return next();
    const origin = appOriginFor(req, config);
    const tools = await appToolNames(storage, app.ownerGaii, app.filename);
    const name = app.manifest?.name ?? app.filename.replace(/\.[^.]+$/, '');
    res.set('Access-Control-Allow-Origin', '*');
    res.json({
      $schema: 'https://static.modelcontextprotocol.io/schemas/2025-10-17/server.schema.json',
      // BOTH shapes. server.json (SEP-2127) wants name/description/version at the root; other
      // readers look for serverInfo.name and report the card as having no name without it. The
      // first version of this card carried only the root fields and cost the app origin six points
      // on a scanner that had been passing it — a card is read by whoever reads it, not by the
      // spec. Node card (wellknown.ts) carries both for the same reason.
      protocolVersion: '2025-06-18',
      serverInfo: {
        name: `${app.ownerName}/${app.filename}`,
        title: app.manifest?.name ?? app.filename.replace(/\.[^.]+$/, ''),
        version: String(app.versionNumber ?? 1),
      },
      name: `io.aimeat.app/${app.ownerName}/${app.filename}`,
      description: app.manifest?.description
        ?? `${name} — an application published on AIMEAT by ${app.ownerName}.`,
      version: String(app.versionNumber ?? 1),
      // The node's MCP server is where these tools are called; the card names the app so a client
      // that landed on the app's host learns the two identifiers it needs — owner, and an app id
      // WITH its extension. Reading the id off the subdomain drops the extension and every lookup
      // for it misses.
      transport: { type: 'streamable-http', endpoint: `${config.baseUrl}/v1/mcp` },
      authentication: { required: true },
      app: { owner: app.ownerName, app_id: app.filename, origin, tools },
      webmcp: {
        library: `${config.baseUrl}/v1/libs/aimeat-webmcp.js`,
        listing: `${config.baseUrl}/v1/apps/${app.ownerName}/${app.filename}/webmcp`,
        pages: [`${origin}/`],
      },
    });
  });

  // Installable app: the per-app web-app manifest. This is what turns "open the app in a tab"
  // into "put the app behind its own button": a browser that reads it offers to install the app
  // under its OWN name and icon, scoped to its own origin, with no author work — the manifest
  // link is injected at serve time (app-head-meta.ts) the same way every other missing head tag
  // is. Restricted apps fall through appForOrigin and keep the uniform 404.
  router.get('/manifest.webmanifest', async (req: Request, res: Response, next) => {
    const app = await appForOrigin(req);
    if (!app) return next();
    const apex = config.baseUrl.replace(/\/$/, '');
    const name = app.manifest?.name?.trim() || app.filename.replace(/\.[^.]+$/, '');
    res.setHeader('Cache-Control', 'no-cache');
    res.type('application/manifest+json').send(JSON.stringify({
      id: '/',
      name,
      short_name: name.length <= 12 ? name : name.slice(0, 12).trim(),
      description: app.manifest?.description
        ?? `${name} — an application published on AIMEAT by ${app.ownerName}.`,
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#FAFAF8',
      theme_color: '#FAFAF8',
      // The emoji icon first (it is the app's own face); the apex heart PNGs behind it for
      // surfaces that refuse SVG (Android's WebAPK minting is the known one).
      icons: [
        { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        { src: `${apex}/icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
        { src: `${apex}/icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
      ],
    }));
  });

  // The app's icon as an SVG: its manifest emoji on the house light ground. The emoji is OWNER
  // INPUT landing in an XML document, so it is truncated by CODE POINT (a string slice can cut a
  // surrogate pair in half, which is invalid XML) and entity-escaped; with text/svg served under
  // a no-script CSP, the worst a hostile value can be is a strange-looking icon.
  router.get('/icon.svg', async (req: Request, res: Response, next) => {
    const app = await appForOrigin(req);
    if (!app) return next();
    const raw = Array.from((app.manifest?.icon ?? '').trim()).slice(0, 8).join('') || '♥';
    const safe = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    res.type('image/svg+xml').send(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">`
      + `<rect width="512" height="512" fill="#FAFAF8"/>`
      + `<text x="256" y="256" text-anchor="middle" dominant-baseline="central" font-size="300" fill="#E8564A">${safe}</text>`
      + `</svg>`);
  });

  // One SOURCE, three shapes. Pointing all of these at the Agent Face was one document too few:
  // llms.txt is asked for a blockquote summary and link lists, sitemap.md for links, AGENTS.md for
  // installation/configuration/usage sections, and the face is prose with none of those shapes.
  // The face is still the substance inside each — src/services/app-agent-surfaces.ts wraps it.
  router.get(['/AGENTS.md', '/agents.md'], async (req: Request, res: Response, next) => {
    const app = await appForOrigin(req);
    if (!app) return next();
    const face = await buildAppAgentFace(config, storage, app);
    const tools = await appToolNames(storage, app.ownerGaii, app.filename);
    sendMarkdown(res, appAgentsMd(config, app, appOriginFor(req, config), tools, face?.markdown));
  });

  router.get('/sitemap.md', async (req: Request, res: Response, next) => {
    const app = await appForOrigin(req);
    if (!app) return next();
    sendMarkdown(res, appSitemapMd(config, app, appOriginFor(req, config)));
  });

  // The app root's markdown mirror, on both paths a reader might form: `/.md` (page URL + `.md`,
  // which is what a scanner constructs) and `/index.md`. Same document the root serves under
  // `?format=md`, so there is one surface and two ways in.
  router.get(['/.md', '/index.md'], async (req: Request, res: Response, next) => {
    const app = await appForOrigin(req);
    if (!app) return next();
    const face = await buildAppAgentFace(config, storage, app);
    res.set('Link', `<${appOriginFor(req, config)}/>; rel="canonical"`);
    sendMarkdown(res, appRootMirrorMd(config, app, appOriginFor(req, config), face?.markdown));
  });
}
