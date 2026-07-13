/**
 * @file src/server.ts
 * @description Express application factory — createServer() assembles the whole HTTP stack: trust-proxy
 *   config, compression (excluding SSE streams), CORS, auth, rate-limiting and other middleware, then
 *   delegates config/service init, guard setup, and route mounting to the server-bootstrap modules.
 *
 * @structure
 *   - ServerResult: bundle returned by createServer (app + tunnel/realtime/scheduler/storage managers)
 *   - ConfigSources: provenance metadata (env/file/cli keys) passed in for accurate tracking
 *   - createServer: builds and wires the Express app and its background managers
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import express from 'express';
import compression from 'compression';
import type { AimeatConfig } from './config.js';
import type { Storage } from './storage/interface.js';
import { corsMiddleware } from './middleware/cors.js';
import { optionalAuth } from './auth/middleware.js';
import { rateLimit } from './middleware/rate-limit.js';
import { idempotency } from './middleware/idempotency.js';
import { cookieConsentMiddleware } from './middleware/cookie-consent.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { subdomainMiddleware } from './middleware/subdomain.js';
import { agentMeAliasMiddleware } from './middleware/agent-me-alias.js';
import { logger } from './utils/logger.js';
import { TunnelManager } from './services/personal-tunnel.js';
import { ConnectTunnelManager } from './services/connect-tunnel.js';
import { RealtimeManager } from './services/realtime-manager.js';
import { Scheduler } from './services/scheduler.js';

// Bootstrap modules
import { setupStaticFiles } from './server-bootstrap/static-files.js';
import { initializeConfig } from './server-bootstrap/config-init.js';
import { initializeServices } from './server-bootstrap/service-init.js';
import { setupGuards } from './server-bootstrap/middleware-guards.js';
import { mountRoutes } from './server-bootstrap/routes-loader.js';

export interface ServerResult {
  app: express.Express;
  tunnelManager: TunnelManager | null;
  connectTunnelManager: ConnectTunnelManager | null;
  realtimeManager: RealtimeManager | null;
  scheduler: Scheduler;
  storage: Storage;
}

/** Optional metadata from loadConfig() for accurate provenance tracking */
export interface ConfigSources {
  envKeys: string[];
  fileKeys: string[];
  cliKeys: string[];
  fileName: string | null;
}

export async function createServer(config: AimeatConfig, configSources?: ConfigSources): Promise<ServerResult> {
  const app = express();

  // SECURITY: Trust proxy configuration for correct IP detection behind reverse proxies
  const trustProxy = process.env.AIMEAT_TRUST_PROXY;
  if (trustProxy === 'true') {
    // SECURITY: `true` trusts the X-Forwarded-For header from ANY upstream, so a
    // direct client can spoof its source IP and defeat per-IP rate limiting. Only
    // safe when every request is guaranteed to pass through a trusted proxy that
    // overwrites XFF. Prefer a hop count (e.g. AIMEAT_TRUST_PROXY=1) or a subnet.
    app.set('trust proxy', true);
    logger.warn('AIMEAT_TRUST_PROXY=true trusts X-Forwarded-For from any upstream — source IPs are spoofable unless a trusted proxy always overwrites XFF. Prefer a hop count (e.g. "1") or a CIDR.');
  } else if (trustProxy) {
    app.set('trust proxy', trustProxy);
  } else if (config.baseUrl && !config.baseUrl.includes('localhost') && !config.baseUrl.includes('127.0.0.1')) {
    app.set('trust proxy', 'loopback');
  }

  // Compress all responses (gzip/deflate based on Accept-Encoding).
  // EXCEPTION: never compress Server-Sent Event streams. The compression
  // middleware buffers the response body, so the per-event `data:` chunks the
  // SSE route writes would be held in the buffer and never flushed to the
  // client — the connection opens but no events ever arrive, silently killing
  // all live updates (memory tab, agent task event logs, etc.). Skipping
  // text/event-stream lets those writes pass straight through.
  app.use(compression({
    filter: (req, res) => {
      if (res.getHeader('Content-Type') === 'text/event-stream') return false;
      return compression.filter(req, res);
    },
  }));

  // Global body parsing middleware (skip for presigned upload — it reads raw body)
  app.use((req, res, next) => {
    if (req.path.startsWith('/v1/upload/')) return next();
    // /v1/storage accepts base64-encoded files in JSON; sized at the same envelope
    // as apps/extensions/cortex so it can carry files up to storageMaxFileSizeMb
    // without 413s. (Raw-body and chunked paths are unaffected by this limit.)
    const needsLargeBody = req.path.startsWith('/v1/apps') || req.path.startsWith('/v1/extensions') || req.path.startsWith('/v1/cortex') || req.path.startsWith('/v1/storage');
    const limit = needsLargeBody ? `${config.jsonBodyLimitLargeMb}mb` : `${config.jsonBodyLimitMb}mb`;
    express.json({ limit })(req, res, next);
  });
  app.use((req, res, next) => {
    if (req.path.startsWith('/v1/upload/')) return next();
    express.urlencoded({ extended: false, limit: '1mb' })(req, res, next);
  });
  app.use(express.text({ limit: '1mb', type: ['text/yaml', 'application/x-yaml'] }));

  // Static file serving (public, locales, PWA)
  setupStaticFiles(app, config);

  // Cookie consent banner injection (opt-in for service builders)
  app.use(cookieConsentMiddleware(config));

  // CORS — per-entity origin resolution (defaults to config.corsAllowedOrigins)
  // Uses lazy storage getter — storage is initialized later but available before first request
  let storageForCors: Storage | null = null;

  // Request ID — assigns a unique ID to every request (uses X-Request-Id if present)
  app.use(requestIdMiddleware());

  // Subdomain resolution — sets req.subdomain from nginx's X-Subdomain header
  // (hostname fallback for dev). Serving happens in subdomainServeRouter.
  app.use(subdomainMiddleware(config));

  // optionalAuth() runs before CORS so req.auth is available for per-entity origin resolution
  app.use(optionalAuth());

  // Rewrite /v1/agents/me/... to /v1/agents/{agentName}/... when the caller is an
  // agent. The handbook tells agents to use "/me/" everywhere; this middleware
  // makes that promise true for all routes (handbook itself is excluded).
  app.use(agentMeAliasMiddleware());

  // CORS after auth — can look up GHII-level origins for authenticated requests.
  // OPTIONS preflights bypass rate limiting since CORS responds with 204.
  app.use(corsMiddleware(config, () => storageForCors));

  // Rate limiting — global (with role multipliers)
  app.use(rateLimit(config.rateLimits.global, config.rateLimits.roleMultipliers));

  // Per-tier rate limits
  app.use('/v1/auth', rateLimit(config.rateLimits.auth, config.rateLimits.roleMultipliers));
  app.use('/v1/work', rateLimit(config.rateLimits.work, config.rateLimits.roleMultipliers));
  app.use('/v1/memory', rateLimit(config.rateLimits.memory, config.rateLimits.roleMultipliers));
  app.use('/v1/boards', rateLimit(config.rateLimits.boards, config.rateLimits.roleMultipliers));

  // Per-endpoint rate limits (configurable, fall back to global)
  app.use('/v1/auth/challenge', rateLimit(config.rateLimits.authChallenge, config.rateLimits.roleMultipliers));
  app.use('/v1/owners', rateLimit(config.rateLimits.owners, config.rateLimits.roleMultipliers));
  app.use('/v1/ghii', rateLimit(config.rateLimits.ghii, config.rateLimits.roleMultipliers));
  app.use('/v1/flags', rateLimit(config.rateLimits.flags, config.rateLimits.roleMultipliers));
  app.use('/v1/appeals', rateLimit(config.rateLimits.appeals, config.rateLimits.roleMultipliers));
  app.use('/v1/admin/setup', rateLimit(config.rateLimits.adminSetup, config.rateLimits.roleMultipliers));
  app.use('/v1/federation/peer/introduce', rateLimit(config.rateLimits.federation, config.rateLimits.roleMultipliers));
  app.use('/v1/catalogue', rateLimit(config.rateLimits.catalogue, config.rateLimits.roleMultipliers));

  // Idempotency-Key support for POST/PUT
  app.use(idempotency());

  // ── Storage & Config Initialization ──
  const { storage, provenance, consulService } = await initializeConfig(config, configSources);

  // Wire storage into CORS middleware (lazy reference, now populated)
  storageForCors = storage;

  // ── Service Initialization ──
  const services = await initializeServices(config, storage);

  // ── Middleware Guards (maintenance, relay/mirror, first-run wizard) ──
  const invalidateHasOwnersCache = () => { /* no-op initially */ };
  const guards = setupGuards(app, config, storage,
    { get: () => services.maintenanceCache },
    invalidateHasOwnersCache,
  );

  // ── Route Mounting ──
  const { realtimeManager } = await mountRoutes(app, config, storage, {
    rejectForRelay: guards.rejectForRelay,
    mirrorReadOnly: guards.mirrorReadOnly,
    maintenanceState: {
      get: () => services.maintenanceCache,
      set: services.setMaintenanceCache,
    },
    provenance,
    consulService,
    directoryService: services.directoryService,
    peers: services.peers,
    networkDirectory: services.networkDirectory,
    tunnelManager: services.tunnelManager,
    mailboxNotificationService: services.mailboxNotificationService,
    scheduler: services.scheduler,
    workflowEngine: services.workflowEngine,
    invalidateHasOwnersCache: guards.invalidateHasOwnersCache,
  });

  // JSON 404 handler — prevent Express from returning HTML for unknown routes
  app.use((_req: express.Request, res: express.Response) => {
    res.status(404).json({
      ok: false, protocol: 'aimeat', version: 'v1', node: config.nodeId,
      timestamp: new Date().toISOString(),
      error: { code: 'NOT_FOUND', message: `Route not found: ${_req.method} ${_req.path}` },
    });
  });

  // Global error handler
  app.use((err: Error & { status?: number; type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = err.status ?? 500;
    const isPayloadError = err.type === 'entity.too.large' || status === 413;
    if (status >= 500) {
      logger.error('Unhandled error', { error: err.message, stack: err.stack });
    }
    res.status(status).json({
      ok: false,
      protocol: 'aimeat',
      version: 'v1',
      node: config.nodeId,
      timestamp: new Date().toISOString(),
      error: {
        code: isPayloadError ? 'QUOTA_EXCEEDED' : status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
        message: isPayloadError ? 'Request body too large' : status >= 500 ? 'An unexpected error occurred' : err.message,
      },
      hints: {
        next_actions: [
          { description: 'Try again or check node status', method: 'GET', url: '/' },
        ],
      },
    });
  });

  return {
    app,
    tunnelManager: services.tunnelManager,
    connectTunnelManager: services.connectTunnelManager,
    realtimeManager,
    scheduler: services.scheduler,
    storage,
  };
}
