/**
 * @file src/index-start.ts
 * @description `aimeat start` / `serve` runtime: asset self-heal, server listen + banner, WebSocket upgrade routing (personal tunnel / connector tunnel / realtime P2P + echat), and graceful shutdown. Extracted from index.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from index.ts (max-file-lines)
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createServer, type ConfigSources } from './server.js';
import { securityPostureWarnings } from './config.js';
import type { AimeatConfig } from './config-types.js';
import { logger } from './utils/logger.js';

/**
 * Start an AIMEAT node. Runs the post-upgrade asset self-heal, launches the HTTP
 * server (with the node banner + security posture warnings), wires the WebSocket
 * upgrade handler for the personal tunnel / connector forward tunnel / realtime P2P
 * rooms, and registers the graceful-shutdown handlers. Preserves the exact startup
 * sequence of the original inline block in index.ts.
 *
 * @param pkgRoot Package root (aimeat/ dir) — used to read package.json for the version.
 */
export async function runStart(config: AimeatConfig, sources: ConfigSources, pkgRoot: string): Promise<void> {
  const { envKeys, fileKeys, cliKeys, fileName } = sources;

  // Self-heal runtime assets after a package upgrade. The server serves
  // CWD/{public,locales,static} ahead of the package's own copies, so an
  // `npm i -g aimeat@latest` alone would keep serving the pages/translations
  // scaffolded by the previous version. Refresh them here (operator edits preserved)
  // so the upgrade is the only step — no manual `aimeat update` to remember.
  try {
    const { autoHealAssets, findPackageRoot } = await import('./cli/scaffold.js');
    const assetsRoot = findPackageRoot(dirname(fileURLToPath(import.meta.url)));
    if (assetsRoot) {
      let pkgVersion = '0.0.0';
      try {
        pkgVersion = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf-8')).version as string;
      // eslint-disable-next-line aimeat/no-silent-catch -- leave 0.0.0 — still distinct from any real manifest version
      } catch { /* leave 0.0.0 — still distinct from any real manifest version */ }
      const healed = autoHealAssets(assetsRoot, process.cwd(), pkgVersion);
      if (healed && (healed.copied + healed.updated) > 0) {
        logger.info(`📦 Refreshed ${healed.copied + healed.updated} runtime file(s) for aimeat v${pkgVersion} — pages & translations are up to date.`);
        if (healed.skippedModified > 0) {
          logger.info(`   Your own edits were kept (${healed.skippedModified} customized file${healed.skippedModified === 1 ? '' : 's'} preserved).`);
        }
      }
    }
  } catch (err) {
    logger.warn(`Asset self-heal skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Start the server
  // Auto-generate admin password if not set
  if (!config.adminPassword) {
    config.adminPassword = randomBytes(16).toString('base64url');
  }
  const { app, tunnelManager, connectTunnelManager, realtimeManager, storage } = await createServer(config, { envKeys, fileKeys, cliKeys, fileName });
  const server = app.listen(config.port, () => {
    // ── Node type banner ──
    const bannerLabel =
      config.federationRole === 'operator' ? 'GENESIS-OPERATOR NODE' :
        config.federationRole === 'contributor' ? 'FEDERATION NODE' :
          config.nodeType === 'personal' ? 'PRIVATE NODE' :
            config.devMode ? 'DEV NODE' :
              'STANDALONE NODE';
    const pad = 4;
    const inner = bannerLabel.length + pad * 2;
    const line = '─'.repeat(inner + 2);
    logger.info('');
    logger.info(`   ┌${line}┐`);
    logger.info(`   │${' '.repeat(pad)}${bannerLabel}${' '.repeat(pad)}│`);
    logger.info(`   └${line}┘`);
    logger.info('');

    logger.info(`   ❤️  AIMEAT node started`);
    logger.info(`   Node ID:   ${config.nodeId}`);
    logger.info(`   Port:      ${config.port}`);
    logger.info(`   Storage:   ${config.storageProvider}${config.storageProvider === 'sqlite' ? ` (${config.sqlitePath})` : ''}`);
    logger.info(`   URL:       ${config.baseUrl}/`);
    logger.info(`   Protocol:  AIMEAT v1.3 | License: MIT`);
    if (config.devMode) {
      logger.info(`   ⚠ DEV MODE: OTK validation bypassed on micro-memory`);
    }
    if (config.anonymousMode) {
      logger.info(`   ⚠ ANONYMOUS MODE: No auth required — all agents share one memory space`);
      logger.info(`   Anonymous prompt: ${config.baseUrl}/v1/prompts/anonymous`);
      logger.info(`   Share with others: ${config.baseUrl}/v1/prompts/anonymous/share?format=text`);
    }
    if (tunnelManager) {
      logger.info(`   🔌 Personal Node tunnel: ws://localhost:${config.port}/v1/personal/tunnel`);
    }
    if (realtimeManager) {
      logger.info(`   📡 Realtime P2P rooms: ws://localhost:${config.port}/v1/realtime/ws`);
    }
    if (connectTunnelManager) {
      logger.info(`   🔗 Connector forward tunnel: ws://localhost:${config.port}/v1/connect/tunnel`);
    }
    logger.info(``);
    logger.info(`   Admin Setup: ${config.baseUrl}/v1/admin/setup`);
    if (!process.env.AIMEAT_ADMIN_PASSWORD) {
      process.stderr.write(`   Admin Secret: ${config.adminPassword}\n`);
    }
    logger.info(`──────────────────────────────────────────────────────────`);

    // Security warnings
    if (config.totpEnabled && !config.totpSecretEncryptionKey) {
      logger.warn('SECURITY: TOTP is enabled but AIMEAT_TOTP_ENCRYPTION_KEY is not set. TOTP secrets are stored in plaintext.');
    }
    if (config.devMode) {
      const looksProduction = config.storageProvider !== 'memory' ||
        (config.baseUrl && !config.baseUrl.includes('localhost') && !config.baseUrl.includes('127.0.0.1'));
      if (looksProduction) {
        logger.warn('SECURITY: Dev mode is ON with non-local configuration. Dev mode allows account wipe on duplicate registration.');
      }
    }
    if (process.platform === 'win32' && !process.env.AIMEAT_KEY_PASSPHRASE) {
      logger.warn('SECURITY: Node key is stored unencrypted. Windows does not enforce Unix file permissions. Set AIMEAT_KEY_PASSPHRASE to encrypt.');
    }
    // Posture self-check: on a `public`-profile node, warn loudly on unsafe combinations so being
    // insecure on the internet is a conscious choice. Warn-only. See security-development-dna.md.
    const postureWarnings = securityPostureWarnings(config);
    if (postureWarnings.length > 0) {
      logger.warn(`SECURITY: public-profile node has ${postureWarnings.length} risky setting(s) — override deliberately or harden:`);
      for (const msg of postureWarnings) logger.warn(`  • ${msg}`);
    }

    // Log active service extensions and their instances
    storage.listExtensions().then(async (extensions) => {
      const active = extensions.filter(e => e.status === 'active');
      if (active.length === 0) return;

      logger.info('');
      for (const ext of active) {
        const instances = ext.instances?.supported
          ? await storage.listExtensionInstances(ext.name).catch(err => { logger.warn('runStart: continuing after a suppressed failure', { error: String(err) }); return []; })
          : [];
        const activeInstances = instances.filter(i => i.status === 'active');
        const actionIds = ext.actions.map(a => a.id).join(', ');

        logger.info(`   ────────────────────────────────────────────────────`);
        logger.info(`   Extension: ${ext.name} v${ext.version} [active]`);
        logger.info(`   Actions:   ${actionIds}`);
        if (ext.instances?.supported) {
          logger.info(`   Instances:  ${activeInstances.length} active / ${instances.length} total`);
          for (const inst of activeInstances) {
            const vis = (inst.config as Record<string, unknown>)?.visibility || 'public';
            logger.info(`     - ${inst.id} (${vis})`);
          }
        }
      }
      logger.info(`   ────────────────────────────────────────────────────`);
      logger.info('');
    }).catch(err => { logger.warn('vis: ignore', { error: String(err) }); });

    // Check and display maintenance mode warning
    storage.getMaintenanceMode().then(state => {
      if (state?.enabled) {
        logger.info('');
        logger.info(`   ┌──────────────────────────────────────────────────────┐`);
        logger.info(`   │  🚧 MAINTENANCE MODE IS ON                          │`);
        logger.info(`   │  Message: ${(state.message || '(none)').padEnd(41)}│`);
        logger.info(`   │  Since:   ${(state.enabledAt ?? 'unknown').padEnd(41)}│`);
        logger.info(`   │                                                      │`);
        logger.info(`   │  Run "aimeat maintenance off" to disable             │`);
        logger.info(`   └──────────────────────────────────────────────────────┘`);
        logger.info('');
      }
    }).catch(err => { logger.warn('vis: ignore', { error: String(err) }); });
  });

  // WebSocket upgrade handling for personal node tunnels + realtime P2P + connector forward tunnel
  if (tunnelManager || realtimeManager || connectTunnelManager) {
    const { WebSocketServer } = await import('ws');
    const { verifyJWT } = await import('./auth/jwt.js');
    const { isAnonymousMode } = await import('./auth/middleware.js');
    const { CONNECT_TUNNEL_PATH } = await import('./services/connect-tunnel.js');
    const tunnelWss = tunnelManager ? new WebSocketServer({ noServer: true }) : null;
    const realtimeWss = realtimeManager ? new WebSocketServer({ noServer: true }) : null;
    // Cap forward-tunnel frame size (ws defaults to 100 MiB). An authenticated
    // agent could otherwise buffer huge frames in memory (cheap DoS). Sized a
    // little above the largest JSON body the routes accept; bulk uploads use
    // presigned URLs, not the tunnel.
    const connectMaxPayload = (config.jsonBodyLimitLargeMb + 1) * 1024 * 1024;
    const connectWss = connectTunnelManager ? new WebSocketServer({ noServer: true, maxPayload: connectMaxPayload }) : null;

    // Echat anonymous connection rate limiter (10 connections per IP per minute)
    const echatIpCounts = new Map<string, { count: number; resetAt: number }>();
    function echatRateCheck(ip: string): boolean {
      const now = Date.now();
      const entry = echatIpCounts.get(ip);
      if (!entry || now > entry.resetAt) {
        echatIpCounts.set(ip, { count: 1, resetAt: now + 60_000 });
        return true;
      }
      if (entry.count >= 10) return false;
      entry.count++;
      return true;
    }

    server.on('upgrade', async (request, socket, head) => {
      const url = new URL(request.url ?? '', `http://${request.headers.host}`);

      // ── Personal tunnel upgrade ──
      if (url.pathname === '/v1/personal/tunnel' && tunnelManager && tunnelWss) {
        const authHeader = request.headers.authorization;
        const tokenParam = url.searchParams.get('token');
        const token = authHeader?.startsWith('Bearer ')
          ? authHeader.slice(7)
          : tokenParam;

        if (!token) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        try {
          const payload = await verifyJWT(token);
          if (!payload || !payload.sub) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }

          const ownerName = (payload.owner as string) ?? '';
          const personalNode = await storage.getPersonalNodeByOwner(ownerName);
          if (!personalNode) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return;
          }

          tunnelWss.handleUpgrade(request, socket, head, (ws) => {
            tunnelManager.handleConnection(ws, personalNode.nodeId, ownerName, personalNode.agentGaiis);
          });
        } catch (err) {
          logger.warn('index-start: suppressed failure, continuing', { error: String(err) });
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
        }
        return;
      }

      // ── Connector forward tunnel upgrade ──
      // Agent JWT (roles include 'agent') validated here; identity pinned to the
      // socket and the same raw token reused as the forward bearer. Express
      // middleware can't run on the raw upgrade, so verify manually like the
      // personal tunnel above.
      if (url.pathname === CONNECT_TUNNEL_PATH && connectTunnelManager && connectWss) {
        const authHeader = request.headers.authorization;
        const token = authHeader?.startsWith('Bearer ')
          ? authHeader.slice(7)
          : url.searchParams.get('token');

        if (!token) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        try {
          const payload = await verifyJWT(token);
          if (!payload || !payload.sub) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }
          // Only scoped external principals (agent OR ecosystem app) may hold a forward tunnel.
          // Owner/operator sessions bypass scopes and are not the connector's transport. The
          // tunnel manager keys by identity.sub, so a GEAI tunnel needs no further change.
          if (!payload.roles?.includes('agent') && !payload.roles?.includes('ecosystem')) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return;
          }

          connectWss.handleUpgrade(request, socket, head, (ws) => {
            connectTunnelManager.handleConnection(ws, payload, token);
          });
        } catch (err) {
          logger.warn('index-start: suppressed failure, continuing', { error: String(err) });
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
        }
        return;
      }

      // ── Realtime P2P upgrade ──
      if (url.pathname === '/v1/realtime/ws' && realtimeManager && realtimeWss) {
        // ── Echat anonymous connection ──
        const isEchat = url.searchParams.get('echat') === '1';
        if (isEchat) {
          const roomName = url.searchParams.get('room');
          if (!roomName) {
            socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
            socket.destroy();
            return;
          }
          if (!config.echatAnonymous) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return;
          }
          // Rate limit anonymous echat connections per IP
          const clientIp = request.socket.remoteAddress ?? 'unknown';
          if (!echatRateCheck(clientIp)) {
            socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
            socket.destroy();
            return;
          }
          try {
            const room = await realtimeManager.getOrCreateRoomByName(
              roomName,
              'echat-anonymous',
            );
            const anonNick = 'anon-' + Math.random().toString(16).slice(2, 6);
            realtimeWss.handleUpgrade(request, socket, head, (ws) => {
              realtimeManager.handleUpgrade(ws, room.id, anonNick);
            });
          } catch (err: unknown) {
            if (err instanceof Error && err.message === 'ROOM_LIMIT_REACHED') {
              socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
            } else if (err instanceof Error && err.message === 'INVALID_ROOM_NAME') {
              socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
            } else {
              socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
            }
            socket.destroy();
          }
          return;
        }

        const roomId = url.searchParams.get('room');
        const nick = url.searchParams.get('nick') ?? 'anonymous';

        if (!roomId) {
          socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
          socket.destroy();
          return;
        }

        // Authenticate: JWT from ?token= or Authorization header
        const authHeader = request.headers.authorization;
        const tokenParam = url.searchParams.get('token');
        const token = authHeader?.startsWith('Bearer ')
          ? authHeader.slice(7)
          : tokenParam;

        if (!token) {
          // Allow anonymous mode without token for realtime WS
          if (isAnonymousMode()) {
            const room = realtimeManager.getRoom(roomId);
            if (!room) {
              socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
              socket.destroy();
              return;
            }
            realtimeWss.handleUpgrade(request, socket, head, (ws) => {
              realtimeManager.handleUpgrade(ws, roomId, nick);
            });
            return;
          }
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        try {
          const payload = await verifyJWT(token);
          if (!payload || !payload.sub) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }

          // Verify room exists
          const room = realtimeManager.getRoom(roomId);
          if (!room) {
            socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
            socket.destroy();
            return;
          }

          realtimeWss.handleUpgrade(request, socket, head, (ws) => {
            realtimeManager.handleUpgrade(ws, roomId, nick);
          });
        } catch (err) {
          logger.warn('index-start: suppressed failure, continuing', { error: String(err) });
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
        }
        return;
      }

      // Unknown WebSocket path
      socket.destroy();
    });

    if (tunnelManager) logger.info('WebSocket upgrade handler registered for /v1/personal/tunnel');
    if (realtimeManager) logger.info('WebSocket upgrade handler registered for /v1/realtime/ws');
    if (connectTunnelManager) logger.info('WebSocket upgrade handler registered for /v1/connect/tunnel');
  }

  // Graceful shutdown handler -- flush stats and close connections
  const { getStats: getStatsInstance } = await import('./services/stats.js');
  const handleShutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down...`);
    const statsInstance = getStatsInstance();
    if (statsInstance) await statsInstance.shutdown();
    const { shutdownTelemetryBuffer } = await import('./services/telemetry-buffer.js');
    await shutdownTelemetryBuffer();
    const { shutdownUsageBuffer } = await import('./services/usage/usage-buffer.js');
    await shutdownUsageBuffer();
    const { shutdownConsentAuditBuffer } = await import('./services/consent-audit-buffer.js');
    await shutdownConsentAuditBuffer();
    const { shutdownCache } = await import('./services/cache.js');
    shutdownCache();
    if (tunnelManager) await tunnelManager.shutdown();
    if (connectTunnelManager) await connectTunnelManager.shutdown();
    if (realtimeManager) await realtimeManager.shutdown();
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000);
  };
  process.on('SIGTERM', () => void handleShutdown('SIGTERM'));
  process.on('SIGINT', () => void handleShutdown('SIGINT'));
}
