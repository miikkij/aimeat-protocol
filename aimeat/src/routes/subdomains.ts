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
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, AppRecord, SubdomainSiteRecord } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';

/** Subdomains that can never be mapped (infrastructure / future use). */
export const RESERVED_SUBDOMAINS = new Set([
  'www', 'mail', 'api', 'admin', 'static', 'cdn',
  'portal', 'app', 'apps', 'docs', 'status', 'mcp',
]);

/** Valid subdomain label: lowercase alphanumeric + hyphens, 2–63 chars, no edge hyphens. */
export const SUBDOMAIN_RE = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;

/**
 * CSP for an app served on the app origin. Same as /v1/apps inline mode, but `frame-ancestors`
 * also allows the apex origin: the in-SPA sandboxed viewer (on the apex) frames the app
 * cross-origin (H-2), so without the apex here the browser would block it. `'self'` keeps the
 * app frameable within its own origin; we do NOT open it to `*` (clickjacking).
 */
function appCsp(apexOrigin: string): string {
  const ancestors = apexOrigin ? `'self' ${apexOrigin}` : "'self'";
  // The app frames the apex silent-SSO bridge (hidden iframe → apex/app-silent.html), so frame-src
  // must allow the apex origin explicitly (https://aimeat.io is also covered by `https:`, but an http
  // dev apex like http://localtest.me is not — include it so seamless SSO works there too).
  // The app also fetches the apex directly for the H-2 grant token exchange (POST
  // /v1/app-grants/token) and the silent bridge, so connect-src must allow the apex origin
  // (https://aimeat.io is covered by `https:`; an http dev apex like http://localtest.me is not).
  const apexAllow = apexOrigin ? ' ' + apexOrigin : '';
  return `default-src 'none'; script-src 'self' 'unsafe-inline' blob: https: http://localhost:*; style-src 'unsafe-inline' https: http://localhost:*; img-src * data: blob:; font-src data: https:; connect-src 'self' https: http://localhost:* wss: ws: data:${apexAllow}; worker-src blob:; object-src 'none'; frame-src 'self' blob: data: https: http://localhost:*${apexAllow}; frame-ancestors ${ancestors}`;
}

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

/**
 * Write a published app's HTML body with the app CSP + cache/security headers. When `injectSrc`
 * is set and the body is HTML, the seamless-SSO shim (`<script src=injectSrc>`) is injected so the
 * app gets a scoped grant token without a separate login (H-2 seamless SSO).
 */
function serveApp(res: Response, storage: Storage, app: AppRecord, csp: string, injectSrc?: string): void {
  res.setHeader('Content-Type', app.mimeType);
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  storage.incrementAppDownloads(app.ownerGaii, app.filename).catch(() => { });

  if (injectSrc && /text\/html/i.test(app.mimeType)) {
    const buf = injectAppScript(app.data as Buffer | Uint8Array | string, injectSrc);
    res.setHeader('Content-Length', buf.length.toString());
    res.send(buf);
    return;
  }
  res.setHeader('Content-Length', app.size.toString());
  res.send(app.data);
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
  try { apexOrigin = new URL(config.baseUrl).origin; } catch { /* no apex frame-ancestor */ }
  const csp = appCsp(apexOrigin);

  router.get('/', async (req: Request, res: Response, next) => {
    const sub = req.subdomain;
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

    const app = await resolveAppTarget(storage, site.target);
    if (!app || appIsRestricted(config, app)) return notFound();

    serveApp(res, storage, app, csp);  // the SDK (aimeat-auth.js) does the silent SSO itself
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
      try { const b = new URL(config.baseUrl); scheme = b.protocol.replace(':', ''); portSuffix = b.port ? `:${b.port}` : ''; } catch { /* keep https */ }
      res.setHeader('Cache-Control', 'no-store');
      res.redirect(302, `${scheme}://${sub}.${config.appHost}${portSuffix}/`);
      return;
    }
    serveApp(res, storage, app, csp); // no subdomain available → serve on the shared host (no SSO)
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
