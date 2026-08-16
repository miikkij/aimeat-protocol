/**
 * @file subdomains.ts
 * @description Subdomain routing: serves operator-mapped subdomains
 *              (`<sub>.<apex>` → published app HTML or 301 redirect) and the
 *              operator-only management CRUD under /v1/admin/subdomains.
 *              A mapping's target is always an existing published app
 *              ("owner/filename.html") or an absolute redirect URL — never raw
 *              HTML, so content stays in one place (app versions).
 * @structure subdomainServeRouter — root catch (GET /) for subdomain requests;
 *            RESERVED_SUBDOMAINS, SUBDOMAIN_RE — validation primitives;
 *            unlockRedirect — a browser at a code-gated app is sent to the apex code form.
 *            The operator CRUD lives in subdomain-admin.ts.
 * @usage app.use(subdomainServeRouter(config, storage)); // BEFORE bootstrapRouter
 * @version-history
 *   v1.16.0 — 2026-08-16 — Installable apps: /manifest.webmanifest (per-app web-app manifest, the
 *     app's own name + emoji icon) and /icon.svg (the emoji on the house ground, code-point
 *     truncated + entity-escaped because it is owner input inside XML) join the per-origin
 *     documents. The matching manifest link is injected by app-head-meta.ts on the same serve pass.
 *   v1.15.0 — 2026-08-15 — A browser that meets a CODE-gated app here with no usable grant is sent
 *     to the apex unlock page (302, ?unlock=1) instead of the uniform 404. The app origin is the
 *     address people actually hold — the catalog opens it, aimeat_app_list hands it out, a link
 *     carries it — and the code form only ever existed on the apex, so a stranger following that
 *     link and an owner reloading after the hour-long grant expired both dead-ended in JSON with
 *     no field to type into. No code is checked here and the gate has not moved; price-gated apps,
 *     API callers and every other path keep the uniform 404.
 *   v1.14.0 — 2026-08-11 — Audit H-19: a gated app (access code, or a price) is served here when
 *     the request carries a valid app-access grant minted by the apex, and answers the uniform 404
 *     without one. Before this the app origin refused gated apps outright, which is why the apex
 *     kept serving them itself — on the origin holding the session. The path form forwards its
 *     query to the per-app subdomain so the grant survives that hop.
 *   v1.x — 2026-08-08 — The co origin serves a company's own page (front page 'portfolio')
 *     through servePortfolio, the same path the portfolio origin uses.
 *   v1.13.0 — 2026-08-07 — Company origin: `{slug}.co.<apex>` serves a registered company's front
 *     page through the same app-serving path (same CSP + marks), resolved from the company registry
 *     rather than the subdomain-site table — so a company and an app may carry the same word.
 *   v1.12.0 — 2026-08-07 — subdomainAdminRouter extracted to subdomain-admin.ts (max-file-lines);
 *     resolveAppTarget + appIsRestricted exported for it. Behaviour unchanged.
 *   v1.11.0 — 2026-08-01 — TARGET-058 Phase 4 step 0a: serveApp() and serveDraftPreview() set the
 *     Content-Type through appContentType(), so an app on its own origin is served as
 *     `text/html; charset=utf-8`. A bare `text/html` fell back to windows-1252 and mangled every
 *     non-ASCII byte the document (or the node) put in it. All 110 published apps were scanned for
 *     the double-encoding signature first — 0 found — because an HTTP charset overrides `<meta>`.
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
import type { Storage, AppRecord } from '../storage/interface.js';
import { error } from '../middleware/envelope.js';
import { readCompanyPortfolioHtml } from '../services/company/company-portfolio.js';
import {
  loadServedProvenance, setProvenanceHeaders, type ServedProvenance,
} from '../services/ai-provenance-marks.js';
import { applyServeMarks } from '../services/app-serve-marks.js';
import { appCsp } from '../utils/app-csp.js';
import { appContentType } from '../utils/app-content-type.js';
import { appToolNames } from '../services/app-tool-names.js';
import { recordAppOpen } from '../services/usage/record-app-open.js';
import { verifyDraftToken, verifyFrameToken, DraftTokenError } from '../services/draft-token.js';
import { appAccessGranted } from '../services/app-access-token.js';
import { prefersMarkdown } from '../services/markdown-negotiation.js';
import { serveAppAgentFace } from '../services/agent-face.js';
import { resolvePublishedPortfolio } from './portfolio.js';
import { logger } from '../utils/logger.js';
import { registerAppOriginWebmcp } from './subdomain-webmcp.js';
import { registerAppOriginDocs, appOriginFor } from './subdomain-origin-docs.js';
import { detectLocale, type Locale } from '../i18n.js';

/** Subdomains that can never be mapped (infrastructure / future use). */
export const RESERVED_SUBDOMAINS = new Set([
  'www', 'mail', 'api', 'admin', 'static', 'cdn',
  'portal', 'app', 'apps', 'docs', 'status', 'mcp',
  'portfolio',
  // The company family's own parent label: an apex subdomain named "co" would shadow
  // the whole {slug}.co.<apex> family.
  'co',
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
export async function resolveAppTarget(storage: Storage, target: string): Promise<AppRecord | null> {
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
export function appIsRestricted(config: AimeatConfig, app: AppRecord): boolean {
  if (app.accessCode) return true;
  if (config.marketplaceEnabled && app.manifest.priceMorsels && app.manifest.priceMorsels > 0) return true;
  return false;
}

/**
 * A CODE-gated app met by a browser that holds no usable grant: send it to the apex, where the
 * code form already lives, instead of the uniform 404. Returns true when the redirect was sent.
 *
 * Why here. The public address of every app is its own origin — it is what the catalog opens, what
 * `aimeat_app_list` hands out and what a person shares — but the code form only ever existed on the
 * apex, so a stranger following that link, and an owner reloading after the hour-long grant died,
 * both got `{"error":{"code":"NOT_FOUND"}}` with no way back to the field. The gate is not moved and
 * no code is checked here: this origin has no session and still verifies nothing but a signed grant.
 * It only points a human at the door.
 *
 * Three conditions, each load-bearing:
 *   - An ACCESS CODE, never a price. A paid app refuses anything without a Bearer, which is the one
 *     credential a browser navigation cannot carry, so a form would only dead-end more slowly.
 *   - A browser NAVIGATION (`Accept: text/html`), the same test the apex unlock page uses. An API
 *     caller, an agent and a script's own request keep the uniform 404 they contract for.
 *   - `unlock` absent. The apex stamps it back onto the grant it mints, so a grant that fails to
 *     verify HERE (clock skew, a rotated node key) bounces exactly once and then 404s.
 *
 * The disclosure this trades away, deliberately: a code-gated app's origin stops being
 * indistinguishable from an unmapped subdomain for a browser. The apex has always said as much to
 * the same visitor — it answers the code form rather than 404 — so this aligns the two doors
 * instead of opening a new one. Everything else on this origin keeps the uniform 404.
 */
function unlockRedirect(req: Request, res: Response, config: AimeatConfig, app: AppRecord): boolean {
  if (!app.accessCode) return false;
  if (!(req.headers.accept ?? '').includes('text/html')) return false;
  if (req.query.unlock === '1') return false;
  const target = `${config.baseUrl}/v1/apps/${encodeURIComponent(app.ownerName)}`
    + `/${encodeURIComponent(app.filename)}?mode=inline&unlock=1`;
  // no-store for the same reason the apex grant redirect carries it: this address is a step in an
  // unlock, and a cached copy of it would send the next visit somewhere it no longer belongs.
  res.setHeader('Cache-Control', 'no-store');
  res.redirect(302, target);
  return true;
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
// appOriginFor and the per-origin document routes (llms.txt, robots.txt, sitemap.xml, the MCP
// server card, the web-app manifest + icon, AGENTS.md, the markdown mirrors) live in
// ./subdomain-origin-docs.ts — a pure extraction when this file hit the line ceiling.

function serveApp(res: Response, storage: Storage, app: AppRecord, csp: string, apexOrigin?: string,
                  protect?: { config: AimeatConfig; viewer: string },
                  discover?: { baseUrl: string; toolNames: string[]; origin?: string },
                  prov?: ServedProvenance,
                  // TARGET-058: what the VISIBLE label needs. Separate from `protect` because this
                  // one is a compliance mark rather than an owner-chosen protection, and it must not
                  // become conditional on a protection flag by accident.
                  visible?: { config: AimeatConfig; locale: Locale }): void {
  // charset=utf-8, via appContentType(): a bare `text/html` falls back to windows-1252 and turns
  // every UTF-8 byte in the document into mojibake. See utils/app-content-type.ts for the corpus
  // scan that had to happen before this could be declared.
  res.setHeader('Content-Type', appContentType(app.mimeType));
  // TARGET-058: the AI-Disclosure + Link headers travel with the document on the app origin too.
  setProvenanceHeaders(res, prov);
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  storage.incrementAppDownloads(app.ownerGaii, app.filename).catch(err => { logger.warn('serveApp: continuing after a suppressed failure', { error: String(err) }); });
  // The lifetime counter above answers "how many"; this answers when, and by whom.
  recordAppOpen({ appOwnerGaii: app.ownerGaii, filename: app.filename, viewer: protect?.viewer });

  if (/text\/html/i.test(app.mimeType)) {
    // Relax the author's CSP meta so the H-2 SSO bridge works (only when apex framing is on),
    // then append the permanent aimeat.io "publish your own app" attribution badge so an
    // external visitor who opens a shared app reaches the project + sees the publish hint.
    const relaxed = apexOrigin
      ? relaxAppCspMeta(app.data as Buffer | Uint8Array | string, apexOrigin)
      : (app.data as Buffer | Uint8Array | string);
    // SERVE TIME ONLY. Every mark is added to the bytes on their way out; `app.data` stays the
    // author's upload, so the hash in the provenance record keeps meaning what it says. ONE pass:
    // the attribution badge, the AI-disclosure marks, the agent-discovery block (the body of a
    // single-file app is empty until its JavaScript runs, so a fetching agent would otherwise see
    // the meta tags and nothing else) and the head metadata the app almost certainly has none of
    // (measured on a live app origin: lang, canonical, description, og:*, JSON-LD all absent —
    // authors write apps, not meta tags, and author-declared tags always win).
    let buf = applyServeMarks(relaxed, {
      badge: true,
      provenance: prov,
      visibleLabel: visible,
      discovery: discover
        ? {
            owner: app.ownerName, filename: app.filename,
            appName: app.manifest?.name ?? null, description: app.manifest?.description ?? null,
            baseUrl: discover.baseUrl, toolNames: discover.toolNames,
            webmcp: wantsWebmcpBridge(relaxed),
          }
        : undefined,
      headMeta: discover?.origin
        ? {
            owner: app.ownerName, filename: app.filename,
            appName: app.manifest?.name ?? null, description: app.manifest?.description ?? null,
            origin: discover.origin, baseUrl: discover.baseUrl,
            updatedAt: app.createdAt ?? null,
          }
        : undefined,
    });
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
  res.setHeader('Content-Type', appContentType(draft.mimeType));
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('Cache-Control', 'no-store');       // a draft is never cached
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (/text\/html/i.test(draft.mimeType)) {
    const relaxed = apexOrigin
      ? relaxAppCspMeta(draft.data as Buffer | Uint8Array | string, apexOrigin)
      : (draft.data as Buffer | Uint8Array | string);
    const buf = applyServeMarks(relaxed, { badge: true });
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
  if (portfolioConfig.showBadge !== false) buf = applyServeMarks(buf, { badge: true });
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

    // Company origin: {slug}.co.<apex> — the label is the company slug, resolved from the
    // company registry (NOT the subdomain-site table the apps family uses, so a company and
    // an app may carry the same word). Uniform 404 for every failure mode, so the origin is
    // not a company-enumeration oracle.
    if (req.coOrigin) {
      if (!config.coOriginEnabled) return next();
      if (!sub) {
        res.redirect(301, config.baseUrl + '/v1/profile?tab=companies'); // bare co.<apex>
        return;
      }
      const companyNotFound = () =>
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Unknown company address'));
      if (RESERVED_SUBDOMAINS.has(sub) || !SUBDOMAIN_RE.test(sub)) return companyNotFound();
      const company = await storage.getCompanyBySlug(sub);
      if (!company || company.status !== 'active') return companyNotFound();

      if (company.frontPage.kind === 'redirect' && company.frontPage.target) {
        res.redirect(301, company.frontPage.target);
        return;
      }
      if (company.frontPage.kind === 'portfolio') {
        // The company's own document, served exactly the way a personal portfolio is served on
        // the portfolio origin: same bridge, same CSP, same isolated session-less host.
        const html = await readCompanyPortfolioHtml(storage, company);
        if (!html) return companyNotFound();
        servePortfolio(res, html, {}, csp);
        return;
      }
      // 'none' answers exactly like an unmapped address: reserving a name and publishing a
      // page are two separate acts, and serving a placeholder would claim otherwise.
      if (company.frontPage.kind !== 'app' || !company.frontPage.target) return companyNotFound();

      const companyApp = await resolveAppTarget(storage, company.frontPage.target);
      if (!companyApp || appIsRestricted(config, companyApp)) return companyNotFound();
      // The front page is an app, so it is served through the app path unchanged: same CSP,
      // same serve-time marks, same download accounting.
      serveApp(res, storage, companyApp, csp, apexOrigin,
        { config, viewer: req.auth?.sub ?? 'anon' },
        { baseUrl: config.baseUrl, toolNames: await appToolNames(storage, companyApp.ownerGaii, companyApp.filename) },
        await loadServedProvenance(storage, config, companyApp.aiProvenanceId),
        { config, locale: detectLocale(req.headers['accept-language']) });
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
    if (!app) return notFound();
    // A gated app is served here only against a grant the APEX issued after it checked the access
    // code or the licence (services/app-access-token.ts). This origin holds no session, so the
    // grant is the whole authorization. Without one the answer stays the uniform 404 an unmapped
    // subdomain gets, so the origin still tells a stranger nothing about which apps exist.
    if (appIsRestricted(config, app) && !(await appAccessGranted(req.query.access, app.ownerName, app.filename))) {
      if (unlockRedirect(req, res, config, app)) return;
      return notFound();
    }

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

  // Every document an app origin publishes about ITSELF (llms.txt, robots.txt, sitemap.xml, the
  // MCP server card, the web-app manifest + icon, AGENTS.md, the markdown mirrors) lives in
  // ./subdomain-origin-docs.ts — a pure extraction when this file hit the line ceiling.
  registerAppOriginDocs(router, config, storage, {
    resolveApp: t => resolveAppTarget(storage, t),
    isRestricted: a => appIsRestricted(config, a),
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
    if (appIsRestricted(config, app) && !(await appAccessGranted(req.query.access, app.ownerName, app.filename))) {
      if (unlockRedirect(req, res, config, app)) return;
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Unknown app'));
      return;
    }
    const sub = await ensureAppSubdomain(storage, config, bareOwner, filename);
    if (sub) {
      let scheme = 'https', portSuffix = '';
      // eslint-disable-next-line aimeat/no-silent-catch -- keep https
      try { const b = new URL(config.baseUrl); scheme = b.protocol.replace(':', ''); portSuffix = b.port ? `:${b.port}` : ''; } catch { /* keep https */ }
      res.setHeader('Cache-Control', 'no-store');
      // The query travels: an access grant rides in it, and dropping it here would send a visitor
      // who has just unlocked the app to a 404 on the per-app origin.
      const q = req.originalUrl.indexOf('?');
      res.redirect(302, `${scheme}://${sub}.${config.appHost}${portSuffix}/${q >= 0 ? req.originalUrl.slice(q) : ''}`);
      return;
    }
    const discoverShared = { baseUrl: config.baseUrl, toolNames: await appToolNames(storage, app.ownerGaii, app.filename) };
    serveApp(res, storage, app, csp, apexOrigin, { config, viewer: req.auth?.sub ?? 'anon' }, discoverShared,
      await loadServedProvenance(storage, config, app.aiProvenanceId), // no subdomain available → serve on the shared host (no SSO)
      { config, locale: detectLocale(req.headers['accept-language']) });
  });

  return router;
}
