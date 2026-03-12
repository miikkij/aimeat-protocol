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
import { logger } from './utils/logger.js';
import { TunnelManager } from './services/personal-tunnel.js';
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
    app.set('trust proxy', true);
  } else if (trustProxy) {
    app.set('trust proxy', trustProxy);
  } else if (config.baseUrl && !config.baseUrl.includes('localhost') && !config.baseUrl.includes('127.0.0.1')) {
    app.set('trust proxy', 'loopback');
  }

  // Compress all responses (gzip/deflate based on Accept-Encoding)
  app.use(compression());

  // Global body parsing middleware
  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
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

  // optionalAuth() runs before CORS so req.auth is available for per-entity origin resolution
  app.use(optionalAuth());

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
  let invalidateHasOwnersCache = () => { /* no-op initially */ };
  const guards = setupGuards(app, config, storage,
    { get: () => services.maintenanceCache },
    invalidateHasOwnersCache,
  );

  // ── Route Mounting ──
  const { realtimeManager } = mountRoutes(app, config, storage, {
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
    tunnelManager: services.tunnelManager,
    mailboxNotificationService: services.mailboxNotificationService,
    scheduler: services.scheduler,
    invalidateHasOwnersCache: guards.invalidateHasOwnersCache,
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
    realtimeManager,
    scheduler: services.scheduler,
    storage,
  };
}
