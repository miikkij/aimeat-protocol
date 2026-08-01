/**
 * @file subdomains.ts
 * @description Subdomain routing: serves operator-mapped subdomains
 *              (`<sub>.<apex>` → published app HTML or 301 redirect) and the
 *              operator-only management CRUD under /v1/admin/subdomains.
 *              A mapping's target is always an existing published app
 *              ("owner/filename.html") or an absolute redirect URL — never raw
 *              HTML, so content stays in one place (app versions).
 * @structure subdomainServeRouter — root catch (GET /) for subdomain requests;
 *            subdomainAdminRouter — operator CRUD (list/create/update/delete);
 *            RESERVED_SUBDOMAINS, SUBDOMAIN_RE — validation primitives.
 * @usage app.use(subdomainServeRouter(config, storage)); // BEFORE bootstrapRouter
 *        app.use(subdomainAdminRouter(config, storage));
 * @version-history
 *   v1.10.0 — 2026-07-30 — appCsp moved to utils/app-csp.ts (one policy, shared with the /v1/apps
 *     inline + draft routes) and its script-src gains 'wasm-unsafe-eval', so an app can compile
 *     WebAssembly. Wasm compilation only — no 'unsafe-eval', and COOP/COEP stay off.
 *   v1.9.0 — 2026-07-28 — Every app served on an app origin also loads the WebMCP bridge
 *     (`?expose=app`), so its tools are CALLABLE by a browser-resident agent and not merely listed
 *     in a document. Apps that carry their own bridge call, or set
 *     `<meta name="aimeat-webmcp" content="off">`, are left alone.
 *   v1.6.0 — 2026-07-27 — Agent discovery on the app origin: every inline-served app carries a
 *     script-free <noscript> block naming its owner, its app id WITH the extension, its sellable
 *     tools and where the schemas live, plus <link rel="mcp-server">; and `/llms.txt` on an app
 *     origin serves THAT app's agent face instead of the node's 139 kB app-building guide, in which
 *     the app's own name appears zero times.
 *   v1.0.0 — 2026-06-12 — Initial: subdomain routing (operator-only management)
 *   v1.1.0 — 2026-06-20 — H-2: serve apps on the app origin — `<sub>.apps.<apex>` (existing
 *     GET / path) + path form `apps.<apex>/<owner>/<file>` (req.appOrigin-guarded); shared
 *     serveApp() helper.
 *   v1.2.0 — 2026-06-20 — H-2: app CSP `frame-ancestors` now allows the apex origin so the
 *     in-SPA sandboxed viewer can frame the app cross-origin (appCsp(apexOrigin)).
 *   v1.3.0 — 2026-06-20 — H-2 seamless SSO: inject the app-login.js shim into per-app-subdomain
 *     app HTML so the owner's own app authenticates via the apex silent bridge (no separate login).
 *   v1.4.0 — 2026-06-20 — Auto-assign a per-app subdomain on first open (ensureAppSubdomain); the
 *     bare-host path form now 302-redirects to it, so seamless SSO works with NO manual subdomain step.
 *   v1.5.0 — 2026-06-24 — serveApp now appends the permanent "aimeat.io · publish your own app"
 *     attribution badge to HTML apps (injectAimeatBadge) so visitors landing on a shared app origin
 *     reach the project + see a publish CTA; Content-Length already reflects the transformed body.
 *   v1.6.0 — 2026-07-03 — Portfolio origin: serve published portfolios standalone at
 *     `<username>.portfolio.<apex>` (label = username, no mapping table; uniform 404).
 *     Injects the standalone bridge (aimeat-auth + portfolio-standalone.js + memory:read
 *     scopes meta); aimeat badge per-portfolio optional (showBadge, default on);
 *     'portfolio' added to RESERVED_SUBDOMAINS.
 *   v1.6.1 — 2026-07-06 — appCsp font-src gains 'self' (fonts from the app origin's own
 *     /v1/pub public storage on the http dev origin) — completes the same addition made to
 *     the /v1/apps inline route in apps.ts v1.14.0; https: already covered prod.
 *   v1.7.0 — 2026-07-14 — Agent Face: the subdomain app root negotiates text/markdown (Accept
 *     or ?format=md) — serves the public apps.{filename}.agentface record (else converted app
 *     HTML) with the agent-affordances footer; browsers keep the exact HTML behavior.
 *   v1.8.0 — 2026-07-25 — Frame grants: ?frame=<token> adds the ONE origin the grant names to
 *     frame-ancestors for that response (and drops the legacy X-Frame-Options, which would veto
 *     it). Fails closed on a bad grant. Constant header size — the earlier attempt listed the
 *     owner's app origins and 502'd production at 76 apps.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import { applyAppProtection, hasAnyProtection } from '../utils/app-protect.js';
import type { Storage, AppRecord, SubdomainSiteRecord } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { injectAimeatBadge } from '../utils/app-badge.js';
import {
  loadServedProvenance, setProvenanceHeaders, injectAiDisclosure, type ServedProvenance,
} from '../services/ai-provenance-marks.js';
import { injectAgentDiscovery } from '../utils/app-agent-discovery.js';
import { appCsp } from '../utils/app-csp.js';
import { injectAppHeadMeta } from '../utils/app-head-meta.js';
import { appToolNames } from '../services/app-tool-names.js';
import { verifyDraftToken, verifyFrameToken, DraftTokenError } from '../services/draft-token.js';
import { prefersMarkdown, sendMarkdown } from '../services/markdown-negotiation.js';
import { serveAppAgentFace, buildAppAgentFace } from '../services/agent-face.js';
import { appLlmsTxt, appAgentsMd, appSitemapMd, appRootMirrorMd } from '../services/app-agent-surfaces.js';
import { resolvePublishedPortfolio } from './portfolio.js';
import { logger } from '../utils/logger.js';
import { registerAppOriginWebmcp } from './subdomain-webmcp.js';
import { detectLocale, type Locale } from '../i18n.js';

/** Subdomains that can never be mapped (infrastructure / future use). */
export const RESERVED_SUBDOMAINS = new Set([
  'www', 'mail', 'api', 'admin', 'static', 'cdn',
  'portal', 'app', 'apps', 'docs', 'status', 'mcp',
  'portfolio',
]);

/** Valid subdomain label: lowercase alphanumeric + hyphens, 2–63 chars, no edge hyphens. */
export const SUBDOMAIN_RE = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;

/**
 * Ensure an app has a per-app subdomain (creating one if needed) and return its label. This makes
 * the per-app origin — and therefore seamless SSO — work WITHOUT the operator assigning subdomains
 * by hand: the first time an app is opened it auto-gets a `<sub>.apps.<domain>` from its filename
 * (collision-handled), so existing apps migrate transparently. Returns null when the app origin is
 * not configured or no valid name is free. Idempotent + race-safe.
 */
export async function ensureAppSubdomain(storage: Storage, config: AimeatConfig, ownerBare: string, filename: string): Promise<string | null> {
  if (!config.appHost) return null;
  const target = `${ownerBare}/${filename}`;
  const sites = await storage.listSubdomainSites();
  const existing = sites.find(s => s.enabled && s.kind === 'app' && s.target === target);
  if (existing) return existing.subdomain;

  const taken = new Set(sites.map(s => s.subdomain));
  const free = (n: string) => SUBDOMAIN_RE.test(n) && !RESERVED_SUBDOMAINS.has(n) && !taken.has(n);
  let base = filename.replace(/\.html?$/i, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  if (base.length < 2) base = `app-${base}`.replace(/-+$/g, '').slice(0, 50);
  const candidates = [base, `${ownerBare}-${base}`.replace(/^-+|-+$/g, '').slice(0, 63), ...Array.from({ length: 50 }, (_, i) => `${base}-${i + 2}`)];
  const name = candidates.find(free);
  if (!name) return null;

  const now = new Date().toISOString();
  try {
    await storage.createSubdomainSite({ subdomain: name, kind: 'app', target, enabled: true, createdBy: `${ownerBare}@${config.nodeId}`, createdAt: now, updatedAt: now });
    return name;
  } catch {
    // Race: a concurrent request created the mapping — re-resolve.
    const after = (await storage.listSubdomainSites()).find(s => s.enabled && s.kind === 'app' && s.target === target);
    return after?.subdomain ?? null;
  }
}

/** Resolve an "owner/filename" app target to its latest published record. */
async function resolveAppTarget(storage: Storage, target: string): Promise<AppRecord | null> {
  const slash = target.indexOf('/');
  if (slash <= 0 || slash === target.length - 1) return null;
  const owner = target.slice(0, slash);
  const filename = target.slice(slash + 1);
  let app = await storage.getAppByOwnerName(owner, filename);
  // Backward-compat: target may carry the full GHII as the owner segment
  if (!app && owner.includes('@')) {
    app = await storage.getAppByOwnerName(owner.split('@')[0], filename);
  }
  return app;
}

/** True when the app must not be served openly at a subdomain root. */
function appIsRestricted(config: AimeatConfig, app: AppRecord): boolean {
  if (app.accessCode) return true;
  if (config.marketplaceEnabled && app.manifest.priceMorsels && app.manifest.priceMorsels > 0) return true;
  return false;
}

/**
 * Inject a `<script src>` (the seamless-SSO shim) into HTML body bytes, returning a Buffer. Handles
 * a Node Buffer (SQLite), a Uint8Array (MongoDB/Prisma `Bytes`), or a string — decoding bytes as
 * UTF-8 first. (Using `String()` on a Uint8Array would stringify it to "60,33,..." byte values — the
 * bug this guards against.)
 */
export function injectAppScript(data: Buffer | Uint8Array | string, src: string): Buffer {
  const raw = typeof data === 'string' ? data : Buffer.from(data).toString('utf-8');
  const tag = `<script src="${src}"></script>`;
  let html: string;
  if (/<\/head>/i.test(raw)) html = raw.replace(/<\/head>/i, tag + '</head>');
  else if (/<body[^>]*>/i.test(raw)) html = raw.replace(/<body[^>]*>/i, (m) => m + tag);
  else html = tag + raw;
  return Buffer.from(html, 'utf-8');
}

/** Add `value` to a CSP directive's source list (deriving from default-src when the directive is
 *  absent), without duplicating it. Returns the new source-list array. */
function cspEnsure(dirs: Map<string, string[]>, dir: string, value: string): void {
  const base = dirs.get(dir) ?? dirs.get('default-src') ?? ["'self'"];
  const vals = [...base];
  if (!vals.includes(value)) vals.push(value);
  dirs.set(dir, vals);
}

/**
 * If a published app's HTML carries its OWN `<meta http-equiv="Content-Security-Policy">`, ensure its
 * `frame-src` AND `connect-src` allow the apex origin. Otherwise a strict app-author CSP (e.g.
 * `default-src 'self'`) blocks the H-2 silent-SSO bridge (a hidden iframe → apex) and the apex grant
 * token exchange, so seamless sign-in silently fails. Only those two directives gain the apex; every
 * other protection the author set is preserved. Apps with no CSP meta are returned unchanged (the
 * response-header CSP governs them).
 */
export function relaxAppCspMeta(data: Buffer | Uint8Array | string, apexOrigin: string): Buffer {
  const raw = typeof data === 'string' ? data : Buffer.from(data).toString('utf-8');
  if (!apexOrigin) return Buffer.from(raw, 'utf-8');
  const out = raw.replace(/<meta\b[^>]*>/gi, (tag) => {
    if (!/http-equiv\s*=\s*["']content-security-policy["']/i.test(tag)) return tag;
    const cm = /content\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag);
    if (!cm) return tag;
    const dirs = new Map<string, string[]>();
    for (const part of cm[2].split(';').map((s) => s.trim()).filter(Boolean)) {
      const [name, ...vals] = part.split(/\s+/);
      dirs.set(name.toLowerCase(), vals);
    }
    cspEnsure(dirs, 'frame-src', apexOrigin);
    cspEnsure(dirs, 'connect-src', apexOrigin);
    const rebuilt = [...dirs.entries()].map(([n, v]) => (v.length ? `${n} ${v.join(' ')}` : n)).join('; ');
    return tag.replace(cm[0], cm[0].replace(cm[2], rebuilt));
  });
  return Buffer.from(out, 'utf-8');
}

/**
 * Should the node load the WebMCP bridge into this app? Yes by default — an app origin is where a
 * browser-resident agent meets the app, and every app already has a listing to expose. No when the
 * app carries its own `aimeat-webmcp.js` (its call wins; two registrations of the same names would
 * just replace each other) or opts out with `<meta name="aimeat-webmcp" content="off">`.
 */
function wantsWebmcpBridge(data: Buffer | Uint8Array | string): boolean {
  const raw = typeof data === 'string' ? data : Buffer.from(data).toString('utf-8');
  const head = raw.slice(0, 64 * 1024);
  if (/aimeat-webmcp\.js/i.test(raw)) return false;
  return !/<meta\b[^>]*name\s*=\s*["']aimeat-webmcp["'][^>]*content\s*=\s*["']off["']/i.test(head);
}

/**
 * Write a published app's HTML body with the app CSP + cache/security headers. For HTML apps the
 * author's own CSP meta is relaxed (frame-src/connect-src → allow the apex) so the H-2 silent-SSO
 * bridge + token exchange work even when the app sets `default-src 'self'`.
 */
/**
 * The app's own origin, e.g. `https://nuotta.apps.aimeat.io`. Built from the request host so a
 * node on a different domain, or a dev box on http, describes itself correctly. Falls back to the
 * apex when there is no host to read.
 */
function appOriginFor(req: Request, config: AimeatConfig): string {
  const host = req.get('host');
  if (!host) return config.baseUrl.replace(/\/$/, '');
  const proto = config.baseUrl.startsWith('https') ? 'https' : (req.protocol || 'http');
  return `${proto}://${host}`;
}

/**
 * The app behind the current app-origin request, or null when this is not an app origin, the
 * subdomain is unmapped, or the app is restricted. Every per-origin discovery document goes
 * through this so they cannot disagree about which app they are describing.
 */
async function appForOrigin(req: Request, config: AimeatConfig, storage: Storage): Promise<AppRecord | null> {
  const sub = req.subdomain;
  if (!req.appOrigin || !sub || !config.appOriginEnabled) return null;
  const site = await storage.getSubdomainSite(sub);
  if (!site || !site.enabled || site.kind !== 'app') return null;
  const app = await resolveAppTarget(storage, site.target);
  if (!app || appIsRestricted(config, app)) return null;
  return app;
}

function serveApp(res: Response, storage: Storage, app: AppRecord, csp: string, apexOrigin?: string,
                  protect?: { config: AimeatConfig; viewer: string },
                  discover?: { baseUrl: string; toolNames: string[]; origin?: string },
                  prov?: ServedProvenance,
                  // TARGET-058: what the VISIBLE label needs. Separate from `protect` because this
                  // one is a compliance mark rather than an owner-chosen protection, and it must not
                  // become conditional on a protection flag by accident.
                  visible?: { config: AimeatConfig; locale: Locale }): void {
  res.setHeader('Content-Type', app.mimeType);
  // TARGET-058: the AI-Disclosure + Link headers travel with the document on the app origin too.
  setProvenanceHeaders(res, prov);
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  storage.incrementAppDownloads(app.ownerGaii, app.filename).catch(err => { logger.warn('serveApp: continuing after a suppressed failure', { error: String(err) }); });

  if (/text\/html/i.test(app.mimeType)) {
    // Relax the author's CSP meta so the H-2 SSO bridge works (only when apex framing is on),
    // then append the permanent aimeat.io "publish your own app" attribution badge so an
    // external visitor who opens a shared app reaches the project + sees the publish hint.
    const relaxed = apexOrigin
      ? relaxAppCspMeta(app.data as Buffer | Uint8Array | string, apexOrigin)
      : (app.data as Buffer | Uint8Array | string);
    // SERVE TIME ONLY. The disclosure marks are added to the bytes on their way out; `app.data`
    // stays the author's upload, so the hash in the provenance record keeps meaning what it says.
    let buf = injectAiDisclosure(injectAimeatBadge(relaxed), prov, visible);
    // The body of a single-file app is empty until its JavaScript runs, so a fetching agent sees
    // the meta tags and nothing else. This adds a static block naming the app id, the tools and
    // where the schemas live — the facts an agent otherwise has to guess from the subdomain.
    if (discover) {
      buf = injectAgentDiscovery(buf, {
        owner: app.ownerName, filename: app.filename,
        appName: app.manifest?.name ?? null, description: app.manifest?.description ?? null,
        baseUrl: discover.baseUrl, toolNames: discover.toolNames,
        webmcp: wantsWebmcpBridge(relaxed),
      });
      // ...and the head metadata the app almost certainly has none of. Measured on a live app
      // origin: lang, canonical, description, og:*, JSON-LD and h1 all absent. Authors write apps,
      // not meta tags, and every published app gets an origin automatically — so this is derived
      // here for all of them rather than asked for one at a time. Author-declared tags win.
      if (discover.origin) {
        buf = injectAppHeadMeta(buf, {
          owner: app.ownerName, filename: app.filename,
          appName: app.manifest?.name ?? null, description: app.manifest?.description ?? null,
          origin: discover.origin, baseUrl: discover.baseUrl,
          updatedAt: app.createdAt ?? null,
        });
      }
    }
    // Opt-in copy-protection (obfuscate / domainLock / watermark) on the runnable body.
    if (protect && hasAnyProtection(app.manifest.protection)) {
      buf = applyAppProtection(buf, {
        protection: app.manifest.protection!,
        config: protect.config,
        viewer: protect.viewer,
        appOwner: app.ownerName,
        appFilename: app.filename,
        version: app.versionNumber,
        servedAt: new Date().toISOString(),
      });
    }
    res.setHeader('Content-Length', buf.length.toString());
    res.send(buf);
    return;
  }
  res.setHeader('Content-Length', app.size.toString());
  res.send(app.data);
}

/**
 * Serve an app's UNPUBLISHED draft on the app origin, gated by a draft-preview token.
 * `siteTarget` is the subdomain mapping's "owner/filename" — the token must match that
 * filename AND owner, binding the preview to exactly this subdomain's app. The draft
 * bytes are served with the same CSP + badge + author-CSP relaxation a live app gets,
 * so the draft behaves identically to what it will once published — but nothing is
 * cached (no-store) and no download is counted.
 */
async function serveDraftPreview(
  res: Response, storage: Storage, config: AimeatConfig,
  siteTarget: string, token: string, csp: string, apexOrigin: string,
): Promise<void> {
  const slash = siteTarget.indexOf('/');
  const owner = slash > 0 ? siteTarget.slice(0, slash) : '';
  const filename = slash > 0 ? siteTarget.slice(slash + 1) : '';
  const bareOwner = owner.includes('@') ? owner.split('@')[0] : owner;

  let claim;
  try {
    claim = await verifyDraftToken(token);
  } catch (err) {
    const code = err instanceof DraftTokenError ? err.code : 'TOKEN_INVALID';
    res.status(403).json(error(config.nodeId, code, err instanceof Error ? err.message : 'Invalid draft preview token'));
    return;
  }
  // Bind the token to THIS subdomain's app: same filename, same owner.
  const claimBareOwner = claim.sub.includes('@') ? claim.sub.split('@')[0] : claim.sub;
  if (claim.filename !== filename || claimBareOwner !== bareOwner) {
    res.status(403).json(error(config.nodeId, 'TOKEN_INVALID', 'Draft preview token does not match this app'));
    return;
  }
  const draft = await storage.getAppDraft(claim.sub, filename);
  if (!draft) {
    res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No draft to preview'));
    return;
  }
  res.setHeader('Content-Type', draft.mimeType);
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('Cache-Control', 'no-store');       // a draft is never cached
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (/text\/html/i.test(draft.mimeType)) {
    const relaxed = apexOrigin
      ? relaxAppCspMeta(draft.data as Buffer | Uint8Array | string, apexOrigin)
      : (draft.data as Buffer | Uint8Array | string);
    const buf = injectAimeatBadge(relaxed);
    res.setHeader('Content-Length', buf.length.toString());
    res.send(buf);
    return;
  }
  res.setHeader('Content-Length', draft.size.toString());
  res.send(draft.data);
}

/** Insert an HTML snippet into a document head (fallbacks: after <body>, else prepend). */
function injectHeadSnippet(html: string, snippet: string): string {
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, snippet + '</head>');
  if (/<body[^>]*>/i.test(html)) return html.replace(/<body[^>]*>/i, (m) => m + snippet);
  return snippet + html;
}

/**
 * Write a standalone portfolio document on the portfolio origin. Injects the
 * standalone bridge (aimeat-auth SDK + portfolio-standalone.js + a memory:read
 * scopes meta) so the SAME portfolio HTML that runs inside the apex viewer's
 * iframe gets working auth/members bridging here too. The optional aimeat badge
 * follows the per-portfolio `showBadge` flag (default ON).
 */
function servePortfolio(res: Response, html: string, portfolioConfig: Record<string, unknown>, csp: string): void {
  const bridge =
    '<meta name="aimeat-scopes" content="memory:read">'
    + '<script src="/v1/libs/aimeat-auth.js"></script>'
    + '<script src="/v1/libs/portfolio-standalone.js"></script>';
  let buf: Buffer = Buffer.from(injectHeadSnippet(html, bridge), 'utf-8');
  if (portfolioConfig.showBadge !== false) buf = injectAimeatBadge(buf);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Length', buf.length.toString());
  res.send(buf);
}

/**
 * Serves mapped subdomains at their root. Mounted BEFORE bootstrapRouter so a
 * subdomain request never reaches the apex GET / handler; requests without a
 * subdomain (or for any other path) fall through untouched, so the apex and
 * all /v1 routes behave exactly as before.
 */
export function subdomainServeRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  // Apex origin allowed to frame app-origin apps (the in-SPA sandboxed viewer).
  let apexOrigin = '';
  // eslint-disable-next-line aimeat/no-silent-catch -- no apex frame-ancestor
  try { apexOrigin = new URL(config.baseUrl).origin; } catch { /* no apex frame-ancestor */ }
  const csp = appCsp(apexOrigin);

  router.get('/', async (req: Request, res: Response, next) => {
    const sub = req.subdomain;

    // Portfolio origin: <username>.portfolio.<apex> — the label IS the username,
    // no mapping table. Same CSP/trust level as the app origin (user HTML on an
    // isolated, session-less host). Uniform 404 for every failure mode so the
    // origin is not a username-enumeration oracle.
    if (req.portfolioOrigin) {
      if (!config.portfolioOriginEnabled) return next();
      if (!sub) {
        res.redirect(301, config.baseUrl + '/v1/members'); // bare portfolio.<apex> → member showcase
        return;
      }
      const portfolioNotFound = () =>
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Unknown portfolio'));
      if (RESERVED_SUBDOMAINS.has(sub) || !SUBDOMAIN_RE.test(sub)) return portfolioNotFound();
      const resolved = await resolvePublishedPortfolio(storage, sub);
      if (!resolved.ok || !resolved.html) return portfolioNotFound();
      servePortfolio(res, resolved.html, resolved.portfolioConfig, csp);
      return;
    }

    if (!sub) return next();

    if (sub === 'www') {
      res.redirect(301, config.baseUrl + req.originalUrl);
      return;
    }
    // Reserved (non-www) and unknown/disabled subdomains all return the same
    // 404 — no disclosure of which subdomains exist or are reserved.
    const notFound = () =>
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Unknown subdomain'));

    if (RESERVED_SUBDOMAINS.has(sub) || !SUBDOMAIN_RE.test(sub)) return notFound();

    const site = await storage.getSubdomainSite(sub);
    if (!site || !site.enabled) return notFound();

    if (site.kind === 'redirect') {
      res.redirect(301, site.target);
      return;
    }

    // Draft preview (staging): a valid, short-lived draft-preview token serves this
    // app's UNPUBLISHED draft instead of the live version — the owner tests the next
    // version on this real, isolated, session-less origin (mic/camera work) while the
    // live app stays untouched. The token is the authorization (this origin has no
    // session); it is scoped to exactly this app (owner + filename).
    // A frame grant (?frame=<token>) widens frame-ancestors by exactly the one origin it names,
    // and only for this response. An absent, malformed, expired or mismatched grant simply
    // leaves the strict CSP in place — framing fails closed, it never errors the page.
    let grantedOrigin: string | undefined;
    const frameToken = req.query.frame as string | undefined;
    if (frameToken) {
      const slash = site.target.indexOf('/');
      const tOwner = slash > 0 ? site.target.slice(0, slash) : '';
      const tFile = slash > 0 ? site.target.slice(slash + 1) : '';
      try {
        const grant = await verifyFrameToken(frameToken);
        const grantOwner = grant.sub.includes('@') ? grant.sub.split('@')[0] : grant.sub;
        if (grantOwner === tOwner && grant.filename === tFile) grantedOrigin = grant.origin;
      } catch (err) { logger.warn('notFound: not a usable grant → strict CSP', { error: String(err) }); }
    }
    const appCspForRequest = appCsp(apexOrigin, grantedOrigin);
    // X-Frame-Options is SAMEORIGIN node-wide; where a grant is the policy the legacy header
    // would veto it in browsers that honour it, so it goes — but only when a grant applies.
    if (grantedOrigin) res.removeHeader('X-Frame-Options');

    const previewToken = req.query.preview as string | undefined;
    if (previewToken) {
      await serveDraftPreview(res, storage, config, site.target, previewToken, appCspForRequest, apexOrigin);
      return;
    }

    const app = await resolveAppTarget(storage, site.target);
    if (!app || appIsRestricted(config, app)) return notFound();

    // Agent Face: an agent preferring text/markdown (Accept negotiation, or ?format=md) gets the
    // app's markdown read-surface (public agentface record, else converted HTML) instead of the
    // runnable page. Browsers (Accept: text/html) keep the exact HTML behavior below.
    if (req.query.format === 'md' || (req.query.format === undefined && prefersMarkdown(req))) {
      if (await serveAppAgentFace(res, config, storage, app)) return;
    }

    const discover = {
      baseUrl: config.baseUrl,
      toolNames: await appToolNames(storage, app.ownerGaii, app.filename),
      origin: appOriginFor(req, config),
    };
    serveApp(res, storage, app, appCspForRequest, apexOrigin, { config, viewer: req.auth?.sub ?? 'anon' }, discover,
      await loadServedProvenance(storage, config, app.aiProvenanceId),  // the SDK (aimeat-auth.js) does the silent SSO itself
      { config, locale: detectLocale(req.headers['accept-language']) });
  });

  registerAppOriginWebmcp(router, storage, { resolveApp: t => resolveAppTarget(storage, t), isRestricted: a => appIsRestricted(config, a as AppRecord) });

  // `llms.txt` on an APP origin is the app's own agent-facing document, not the node's.
  // The node-wide guide is 139 kB of app-BUILDING instructions in which the app's own name
  // appears zero times, and it was being served here: an agent that habitually tries
  // /llms.txt read the wrong manual and stopped looking. Serving the same markdown the
  // Agent Face serves keeps one source and answers the habit.
  router.get(['/llms.txt', '/llms-full.txt'], async (req: Request, res: Response, next) => {
    const app = await appForOrigin(req, config, storage);
    if (!app) return next();
    const face = await buildAppAgentFace(config, storage, app);
    const tools = await appToolNames(storage, app.ownerGaii, app.filename);
    // text/plain, not text/markdown: llmstxt.org names that content type, and this path was
    // answering markdown — a conformance failure on a document whose whole job is conformance.
    res.type('text/plain; charset=utf-8')
      .send(appLlmsTxt(config, app, appOriginFor(req, config), tools, face?.markdown));
  });

  // ── Per-origin discovery documents ──────────────────────────────────────────────────────────
  //
  // An app origin is its own site. Left to fall through, these paths answered with the NODE's
  // documents on the app's host: a sitemap.xml listing apex URLs (which sitemaps.org forbids
  // outright — a sitemap may only list URLs from the host that serves it), a robots.txt pointing
  // at the apex sitemap, and an MCP Server Card describing the node with no mention of the app's
  // own tools. Each of those is a document about somebody else, served under the app's name.
  //
  // Everything below is derived from the app record and its tool manifest. There is no per-app
  // configuration and there must never be one: apps get their origin automatically on first open,
  // so anything requiring a manual step would be absent on every app already published.

  router.get('/robots.txt', async (req: Request, res: Response, next) => {
    const app = await appForOrigin(req, config, storage);
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
    const app = await appForOrigin(req, config, storage);
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
    const app = await appForOrigin(req, config, storage);
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

  // One SOURCE, three shapes. Pointing all of these at the Agent Face was one document too few:
  // llms.txt is asked for a blockquote summary and link lists, sitemap.md for links, AGENTS.md for
  // installation/configuration/usage sections, and the face is prose with none of those shapes.
  // The face is still the substance inside each — src/services/app-agent-surfaces.ts wraps it.
  router.get(['/AGENTS.md', '/agents.md'], async (req: Request, res: Response, next) => {
    const app = await appForOrigin(req, config, storage);
    if (!app) return next();
    const face = await buildAppAgentFace(config, storage, app);
    const tools = await appToolNames(storage, app.ownerGaii, app.filename);
    sendMarkdown(res, appAgentsMd(config, app, appOriginFor(req, config), tools, face?.markdown));
  });

  router.get('/sitemap.md', async (req: Request, res: Response, next) => {
    const app = await appForOrigin(req, config, storage);
    if (!app) return next();
    sendMarkdown(res, appSitemapMd(config, app, appOriginFor(req, config)));
  });

  // The app root's markdown mirror, on both paths a reader might form: `/.md` (page URL + `.md`,
  // which is what a scanner constructs) and `/index.md`. Same document the root serves under
  // `?format=md`, so there is one surface and two ways in.
  router.get(['/.md', '/index.md'], async (req: Request, res: Response, next) => {
    const app = await appForOrigin(req, config, storage);
    if (!app) return next();
    const face = await buildAppAgentFace(config, storage, app);
    res.set('Link', `<${appOriginFor(req, config)}/>; rel="canonical"`);
    sendMarkdown(res, appRootMirrorMd(config, app, appOriginFor(req, config), face?.markdown));
  });

  // App-origin path form: `apps.<apex>/<owner>/<filename>` on the bare app host. Apps need their
  // OWN per-app origin for seamless SSO (the silent bridge binds a token to one subdomain), so this
  // REDIRECTS to the app's auto-assigned `<sub>.apps.<apex>` rather than serving on the shared host.
  // Only active on the app origin (req.appOrigin); falls through elsewhere so /v1 API still works.
  router.get('/:owner/:filename', async (req: Request, res: Response, next) => {
    if (!req.appOrigin) return next();
    const owner = req.params.owner as string;
    const filename = req.params.filename as string;
    // Only treat genuine app HTML filenames as app requests; anything else (API
    // segments like /v1/..., assets) falls through to normal routing.
    if (!/\.html?$/i.test(filename) || filename.includes('..')) return next();
    const bareOwner = owner.includes('@') ? owner.split('@')[0] : owner;
    const app = await resolveAppTarget(storage, `${bareOwner}/${filename}`);
    if (!app) return next();
    if (appIsRestricted(config, app)) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Unknown app'));
      return;
    }
    const sub = await ensureAppSubdomain(storage, config, bareOwner, filename);
    if (sub) {
      let scheme = 'https', portSuffix = '';
      // eslint-disable-next-line aimeat/no-silent-catch -- keep https
      try { const b = new URL(config.baseUrl); scheme = b.protocol.replace(':', ''); portSuffix = b.port ? `:${b.port}` : ''; } catch { /* keep https */ }
      res.setHeader('Cache-Control', 'no-store');
      res.redirect(302, `${scheme}://${sub}.${config.appHost}${portSuffix}/`);
      return;
    }
    const discoverShared = { baseUrl: config.baseUrl, toolNames: await appToolNames(storage, app.ownerGaii, app.filename) };
    serveApp(res, storage, app, csp, apexOrigin, { config, viewer: req.auth?.sub ?? 'anon' }, discoverShared,
      await loadServedProvenance(storage, config, app.aiProvenanceId), // no subdomain available → serve on the shared host (no SSO)
      { config, locale: detectLocale(req.headers['accept-language']) });
  });

  return router;
}

/** Operator-only management CRUD for subdomain mappings. */
export function subdomainAdminRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const operatorOnly = [requireAuth(), requireRole('operator')] as const;

  // Validates kind+target; sends the error response and returns false on failure.
  async function validateTarget(res: Response, kind: string, target: string): Promise<boolean> {
    if (kind === 'redirect') {
      if (!/^https?:\/\/\S+$/.test(target)) {
        res.status(400).json(error(config.nodeId, 'INVALID_TARGET', 'Redirect target must be an absolute http(s) URL'));
        return false;
      }
      return true;
    }
    // kind === 'app'
    const app = await resolveAppTarget(storage, target);
    if (!app) {
      res.status(404).json(error(config.nodeId, 'APP_NOT_FOUND', `No published app matches target "${target}" (expected "owner/filename")`));
      return false;
    }
    if (appIsRestricted(config, app)) {
      res.status(400).json(error(config.nodeId, 'APP_RESTRICTED', 'Access-code-protected or paid apps cannot be served at a subdomain root'));
      return false;
    }
    return true;
  }

  // GET /v1/admin/subdomains — list all mappings
  router.get('/v1/admin/subdomains', ...operatorOnly, async (_req, res) => {
    const sites = await storage.listSubdomainSites();
    res.json(success(config.nodeId, { sites, total: sites.length }));
  });

  // POST /v1/admin/subdomains — create a mapping
  router.post('/v1/admin/subdomains', ...operatorOnly, async (req, res) => {
    const body = req.body ?? {};
    const subdomain = String(body.subdomain ?? '').trim().toLowerCase();
    const kind = String(body.kind ?? 'app');
    const target = String(body.target ?? '').trim();
    const enabled = body.enabled === undefined ? true : Boolean(body.enabled);

    if (!SUBDOMAIN_RE.test(subdomain)) {
      res.status(400).json(error(config.nodeId, 'INVALID_SUBDOMAIN',
        'Subdomain must be 2-63 chars of lowercase a-z, 0-9 and hyphens, not starting or ending with a hyphen'));
      return;
    }
    if (RESERVED_SUBDOMAINS.has(subdomain)) {
      res.status(400).json(error(config.nodeId, 'RESERVED_SUBDOMAIN', `"${subdomain}" is a reserved subdomain`));
      return;
    }
    if (kind !== 'app' && kind !== 'redirect') {
      res.status(400).json(error(config.nodeId, 'INVALID_KIND', 'kind must be "app" or "redirect"'));
      return;
    }
    if (!target) {
      res.status(400).json(error(config.nodeId, 'INVALID_TARGET', 'target is required'));
      return;
    }
    if (!(await validateTarget(res, kind, target))) return;

    if (await storage.getSubdomainSite(subdomain)) {
      res.status(409).json(error(config.nodeId, 'ALREADY_EXISTS', `Subdomain "${subdomain}" is already mapped`));
      return;
    }

    const now = new Date().toISOString();
    const site: SubdomainSiteRecord = {
      subdomain, kind, target, enabled,
      createdBy: resolveIdentity(req.auth!, config.nodeId),
      createdAt: now, updatedAt: now,
    };
    await storage.createSubdomainSite(site);
    res.status(201).json(success(config.nodeId, { site }));
  });

  // PATCH /v1/admin/subdomains/:subdomain — update kind/target/enabled
  router.patch('/v1/admin/subdomains/:subdomain', ...operatorOnly, async (req, res) => {
    const subdomain = (req.params.subdomain as string).trim().toLowerCase();
    const existing = await storage.getSubdomainSite(subdomain);
    if (!existing) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Subdomain "${subdomain}" is not mapped`));
      return;
    }

    const body = req.body ?? {};
    const updates: Partial<Pick<SubdomainSiteRecord, 'kind' | 'target' | 'enabled'>> = {};
    if (body.kind !== undefined) {
      if (body.kind !== 'app' && body.kind !== 'redirect') {
        res.status(400).json(error(config.nodeId, 'INVALID_KIND', 'kind must be "app" or "redirect"'));
        return;
      }
      updates.kind = body.kind;
    }
    if (body.target !== undefined) updates.target = String(body.target).trim();
    if (body.enabled !== undefined) updates.enabled = Boolean(body.enabled);

    // Cross-validate the effective kind/target pair when either changes
    if (updates.kind !== undefined || updates.target !== undefined) {
      const kind = updates.kind ?? existing.kind;
      const target = updates.target ?? existing.target;
      if (!target) {
        res.status(400).json(error(config.nodeId, 'INVALID_TARGET', 'target is required'));
        return;
      }
      if (!(await validateTarget(res, kind, target))) return;
    }

    const site = await storage.updateSubdomainSite(subdomain, updates);
    res.json(success(config.nodeId, { site }));
  });

  // DELETE /v1/admin/subdomains/:subdomain — remove a mapping
  router.delete('/v1/admin/subdomains/:subdomain', ...operatorOnly, async (req, res) => {
    const subdomain = (req.params.subdomain as string).trim().toLowerCase();
    const deleted = await storage.deleteSubdomainSite(subdomain);
    if (!deleted) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Subdomain "${subdomain}" is not mapped`));
      return;
    }
    res.json(success(config.nodeId, { deleted: true, subdomain }));
  });

  return router;
}
