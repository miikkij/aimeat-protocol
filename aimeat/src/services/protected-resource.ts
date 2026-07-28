/**
 * @file protected-resource.ts
 * @description RFC 9728 Protected Resource Metadata, answered for the ORIGIN the client actually
 *   used. This node serves three families of origin from one process: the apex (`aimeat.io`), the
 *   per-app origins (`<sub>.apps.<apex>`, H-2 app-origin isolation), and the portfolio origins
 *   (`<username>.portfolio.<apex>`). Each app origin is its own protected resource — its own
 *   session-less host, its own scoped app grant, its own consent — so answering every one of them
 *   with the apex's `/v1/mcp` resource identifier was a wrong answer, not merely an incomplete one:
 *   RFC 9728 §3.3 has the client REJECT metadata whose `resource` is not the resource it is talking
 *   to, so an agent standing on an app origin learned nothing about how to authenticate there.
 *
 *   The apex response is unchanged (same fields, same values) — only the other origins gain an
 *   answer of their own, naming the app, its declared scopes, and where its tools live.
 * @structure
 *   - requestOrigin(req, config) — the origin the client used (app/portfolio host aware)
 *   - resourceMetadataUrl(req, config) — that origin's `/.well-known/oauth-protected-resource`
 *   - buildProtectedResourceMetadata(req, config, storage) — the document to serve
 * @usage
 *   import { buildProtectedResourceMetadata } from '../services/protected-resource.js';
 *   res.json(await buildProtectedResourceMetadata(req, config, storage));
 * @version-history
 *   v1.0.0 — 2026-07-28 — Initial: per-origin protected-resource metadata (app + portfolio origins
 *     described themselves as the apex, so isitagentready and any RFC-conformant client rejected it).
 */
import type { Request } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, AppRecord } from '../storage/interface.js';
import { cached, TTL } from './cache.js';

/** The document served at `/.well-known/oauth-protected-resource` (RFC 9728 + AIMEAT extension). */
export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  scopes_supported?: string[];
  bearer_methods_supported: string[];
  resource_name?: string;
  resource_documentation?: string;
  /** AIMEAT extension: what this resource IS, in this node's own terms. */
  aimeat?: Record<string, unknown>;
}

/** Scheme + port of the node's apex, so a derived origin matches how the node is actually reached. */
function apexSchemeAndPort(config: AimeatConfig): { scheme: string; portSuffix: string } {
  try {
    const b = new URL(config.baseUrl);
    return { scheme: b.protocol.replace(':', ''), portSuffix: b.port ? `:${b.port}` : '' };
  } catch {
    return { scheme: 'https', portSuffix: '' };
  }
}

/**
 * The origin this request was made to. Derived from the node's own host config when the request
 * carries an app/portfolio marker (that path holds behind a proxy that rewrites Host), and from the
 * Host header otherwise. Falls back to the apex baseUrl when neither is usable.
 */
export function requestOrigin(req: Request, config: AimeatConfig): string {
  const { scheme, portSuffix } = apexSchemeAndPort(config);
  if (req.appOrigin && config.appHost) {
    const host = req.subdomain ? `${req.subdomain}.${config.appHost}` : config.appHost;
    return `${scheme}://${host}${portSuffix}`;
  }
  if (req.portfolioOrigin && config.portfolioHost) {
    const host = req.subdomain ? `${req.subdomain}.${config.portfolioHost}` : config.portfolioHost;
    return `${scheme}://${host}${portSuffix}`;
  }
  const hostHeader = req.get('host');
  if (hostHeader) return `${req.protocol || scheme}://${hostHeader}`;
  return config.baseUrl.replace(/\/+$/, '');
}

/** Where THIS origin publishes its protected-resource metadata (the `resource_metadata` hint). */
export function resourceMetadataUrl(req: Request, config: AimeatConfig): string {
  return `${requestOrigin(req, config)}/.well-known/oauth-protected-resource`;
}

/**
 * Read an app's declared scopes from its `<meta name="aimeat-scopes">`. That meta is the app's own
 * statement of what it will ask the owner to grant (H-2 app grant), so it is the honest answer to
 * "what scopes can a token for this resource carry". Returns [] when the app declares none.
 */
export function parseAppScopes(html: string): string[] {
  const metas = html.slice(0, 64 * 1024).match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metas) {
    if (!/name\s*=\s*["']aimeat-scopes["']/i.test(tag)) continue;
    const m = /content\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (!m) continue;
    return m[1].split(/\s+/).map(s => s.trim()).filter(Boolean);
  }
  return [];
}

/** Resolve the published app a mapped app subdomain serves, or null. */
async function appOfSubdomain(storage: Storage, subdomain: string): Promise<AppRecord | null> {
  const site = await storage.getSubdomainSite(subdomain);
  if (!site || !site.enabled || site.kind !== 'app') return null;
  const slash = site.target.indexOf('/');
  if (slash <= 0 || slash === site.target.length - 1) return null;
  const owner = site.target.slice(0, slash);
  const filename = site.target.slice(slash + 1);
  const bare = owner.includes('@') ? owner.split('@')[0] : owner;
  return storage.getAppByOwnerName(bare, filename);
}

/** Decode app body bytes to a UTF-8 string. */
function appHtml(app: AppRecord): string {
  const data = app.data as Buffer | Uint8Array | string;
  return typeof data === 'string' ? data : Buffer.from(data).toString('utf-8');
}

/**
 * Build the protected-resource metadata for the origin this request arrived on.
 *
 * Apex (and anything not on an app/portfolio host) keeps the exact document it has always served:
 * the MCP endpoint as the resource, this node as its authorization server.
 */
export async function buildProtectedResourceMetadata(
  req: Request,
  config: AimeatConfig,
  storage: Storage,
): Promise<ProtectedResourceMetadata> {
  const apex = config.baseUrl.replace(/\/+$/, '');
  // Gated on the ORIGIN the request arrived on, never on the serve-enable flags: the answer to
  // "which resource am I talking to" cannot depend on whether that resource is currently serving.
  const onAppOrigin = Boolean(req.appOrigin);
  const onPortfolioOrigin = Boolean(req.portfolioOrigin);

  if (!onAppOrigin && !onPortfolioOrigin) {
    return {
      resource: `${apex}/v1/mcp`,
      authorization_servers: [apex],
      scopes_supported: ['aimeat:full'],
      bearer_methods_supported: ['header'],
    };
  }

  const origin = requestOrigin(req, config);
  const base: ProtectedResourceMetadata = {
    resource: origin,
    // The node is the authorization server for every origin it serves: an app origin holds no keys
    // and issues no tokens — it receives them, through the apex grant exchange.
    authorization_servers: [apex],
    bearer_methods_supported: ['header'],
  };

  if (onPortfolioOrigin) {
    if (!req.subdomain) return base;
    return {
      ...base,
      scopes_supported: ['memory:read'],
      resource_name: `${req.subdomain} — portfolio on AIMEAT`,
      aimeat: { kind: 'portfolio', owner: req.subdomain, auth_guide: `${apex}/auth.md` },
    };
  }

  if (!req.subdomain) return base;
  const app = await appOfSubdomain(storage, req.subdomain);
  if (!app) return base;

  // Scopes are parsed out of the served body; cache per published version so a scan (or a burst of
  // 401 hints) does not re-read a 250 KB app on every request.
  const scopes = await cached(
    `prm-scopes:${app.ownerName}/${app.filename}:v${app.versionNumber}`,
    TTL.dashboard,
    async () => parseAppScopes(appHtml(app)),
    ['domain:apps'],
  );

  const o = encodeURIComponent(app.ownerName);
  const f = encodeURIComponent(app.filename);
  return {
    ...base,
    ...(scopes.length ? { scopes_supported: scopes } : {}),
    resource_name: `${app.manifest?.name ?? app.filename} — an app on AIMEAT`,
    resource_documentation: `${origin}/?format=md`,
    aimeat: {
      kind: 'app',
      // The app id is a FILENAME and keeps its extension; the subdomain label drops it, and every
      // tool lookup made from the label alone misses.
      app: `${app.ownerName}/${app.filename}`,
      owner: app.ownerName,
      app_id: app.filename,
      tools: `${apex}/v1/apps/${o}/${f}/webmcp`,
      mcp: `${apex}/v1/mcp`,
      auth_guide: `${apex}/auth.md`,
    },
  };
}
