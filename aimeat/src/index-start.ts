/**
 * @file src/index-start.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `aimeat start` / `serve` runtime: asset self-heal, server listen + banner, WebSocket upgrade routing (personal tunnel / connector tunnel / realtime P2P + echat), and graceful shutdown. Extracted from index.ts to satisfy max-file-lines.
 * @version-history
 *   2026-10-23 — The setup code is issued on every node without an operator, loopback included: a
 *     request from outside the machine is asked for it there too, and the line says so (secaudit2026oct22).
 *   2026-10-17 — A node set to signed-in content access refuses an anonymous realtime or echat
 *     upgrade, whatever the anonymous mode says (plan doc-mvcn6c7e4e5q V1).
 *   2026-10-16 — The setup code is issued while the node has no OPERATOR, not only no owner, because the
 *     no-operator self-heal grants the role too; the line says where to use it in each case (Jouni, 2026-10-16).
 *   2026-10-16 — A node whose base URL is not loopback and that has no owner issues the one-time setup
 *     code (services/setup-code.ts) and prints it in the start banner at warn level, with where to
 *     enter it; POST /v1/setup/init refuses without it (Jouni, 2026-10-16).
 *   2026-10-16 — The settings loadConfig() set aside reach createServer, which records them on the
 *     Security page (Jouni, decision 2026-10-16).
 *   2026-10-16 — The posture header says "this node": the test and dev mode warnings are reported on
 *     any node whose public URL is not a loopback address, not only on the public profile (QA audit S1-08).
 *   2026-10-16 — The shutdown handler stops the workflow engine's sweep and the scheduler, and waits
 *     up to 4 s for scheduled runs in progress (Scheduler.shutdown; QA audit E4-07).
 *   2026-10-15 — The shutdown handler flushes the write buffers through flushProcessBuffers, which
 *     also flushes the agent refusal notes; they were lost on shutdown before (feature-list audit #30).
 *   v1.10.0 — 2026-10-12 — The three WebSocket servers add the Deprecation headers to the 101 answer
 *     of an upgrade let in on ?token= (upgradeDeprecationHeaderLines, Core 2026-11 HTTP-07).
 *   v1.9.1 — 2026-10-09 — The TOTP start-up warning says what a node without either key does now:
 *     it refuses to set the factor up, rather than store the secret in plain text.
 *   v1.9.0 — 2026-10-09 — The three upgrade code paths read their credential through
 *     authenticateUpgrade (auth/ws-upgrade.ts): the Authorization header, a single-use ?ticket= from
 *     POST /v1/ws/ticket, or the deprecated ?token= while AIMEAT_WS_QUERY_TOKEN is on (secrets audit
 *     2026-10-09, d3). A refusal names its code in X-AIMEAT-Error. A realtime upgrade with a credential
 *     that fails is refused; only an upgrade with no credential falls back to anonymous mode.
 *   v1.9.0 — 2026-10-10 — The connect tunnel upgrade reads X-AIMEAT-Install-Name, the name the
 *     connector reports for its installation, and hands it to the tunnel manager.
 *   v1.8.0 — 2026-10-09 — The generated admin secret is no longer written to stderr. While the node
 *     has no owner it goes to a 0600 file, admin-setup-secret in the data directory, and the log
 *     names only the file; once the node has an owner a file left from an earlier boot is deleted
 *     (services/admin-setup-secret.ts; secrets audit 2026-10-09, 1.4).
 *   v1.8.0 — 2026-10-12 — The connect tunnel upgrade reads X-AIMEAT-Features, what the connector's
 *     crew runtime honours beyond its tools, and hands it to the tunnel manager.
 *   v1.7.0 — 2026-10-09 — One boot warning when the deprecated static TURN pair is set: it names
 *     AIMEAT_TURN_SECRET as the replacement (services/turn-credentials.ts).
 *   v1.6.1 — 2026-10-05 — The anonymous chat connection limit counts with services/rate-buckets.ts
 *     in place of a hand copy that never pruned its map (secaudit 2026-10, C5).
 *   v1.6.0 — 2026-10-02 — The connect tunnel upgrade reads X-AIMEAT-Run-Modes, the run modes the
 *     connector can honour, and hands them to the tunnel manager beside the install id.
 *   v1.5.0 — 2026-10-02 — Graceful shutdown flushes the scope-use record (services/scope-use.ts).
 *   v1.4.0 — 2026-09-29 — Graceful shutdown flushes the classification audit buffer (TARGET-082 V4).
 *   v1.3.0 — 2026-09-26 — A WebSocket upgrade runs as this node (runAsNode, utils/gaii.ts), so it
 *     answers for this node also in a process that serves more than one node. The handler body is
 *     onUpgrade, unchanged. One node per process in production, so nothing there changes.
 *   v1.2.0 — 2026-09-24 — The personal tunnel upgrade asks the question its anchor door asks: is this
 *     the account holder in person (isOwnerPrincipal). It verified the token and then found the node
 *     by the token's owner NAME, so any of the owner's agents, and a visitor from another node sharing
 *     the name, took the tunnel over; a new socket replaces the live one (secaudit 2026-09, found in
 *     verification).
 *   v1.1.0 — 2026-09-17 — A failed listen is reported and ends the process. Express 5 hands the
 *     listen error to the same callback as success, and the banner used to print over it.
 *   v1.0.0 — 2026-07-13 — Extracted from index.ts (max-file-lines)
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { createServer, type ConfigSources } from './server.js';
import { securityPostureWarnings } from './config.js';
import type { AimeatConfig } from './config-types.js';
import { logger } from './utils/logger.js';
import { runAsNode } from './utils/gaii.js';
import { turnDeprecationWarning } from './services/turn-credentials.js';
import { adminSetupSecretDir, syncAdminSetupSecretFile } from './services/admin-setup-secret.js';
import { setupCodeGateFor, setupCodeRequired } from './services/setup-code.js';
import { signedInOnly } from './config-visibility.js';

/** How long shutdown waits for scheduled runs in progress; the process exits 5 s after server.close. */
const SCHEDULER_SHUTDOWN_GRACE_MS = 4000;

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
  const { envKeys, fileKeys, cliKeys, fileName, settingFallbacks } = sources;

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
  // Auto-generate admin password if not set. It lives in memory for this process, and reaches a
  // person only through the 0600 file written below, never through a log.
  const generatedAdminSecret = config.adminPassword ? null : randomBytes(16).toString('base64url');
  if (generatedAdminSecret) config.adminPassword = generatedAdminSecret;
  const { app, tunnelManager, connectTunnelManager, realtimeManager, storage } = await createServer(config, { envKeys, fileKeys, cliKeys, fileName, settingFallbacks });

  // The generated secret opens POST /v1/admin/setup/register, so it goes to a file only this
  // user can read, and only while the node has no owner (the `anonymous` system owner of
  // anonymous mode is nobody's and does not count). With an owner, or with a secret the operator
  // set, a file left from an earlier boot is deleted. Secrets audit 2026-10-09, 1.4.
  let hasOwner = true;
  let hasOperator = true;
  try {
    ({ anyOwner: hasOwner, anyOperator: hasOperator } = await storage.operatorAccountState());
    const written = syncAdminSetupSecretFile({ dir: adminSetupSecretDir(config), secret: generatedAdminSecret, hasOwner });
    if (written.action === 'written') {
      logger.info(`   Admin setup secret: written to ${written.path} (readable by this user only). Use it at ${config.baseUrl}/v1/admin/setup to create the first operator.`);
    } else if (written.action === 'removed') {
      logger.info(`   Admin setup secret file removed (${written.path}): the node has an owner, or an admin password is configured.`);
    }
  } catch (err) {
    logger.warn(`Admin setup secret could not be written to a file: ${err instanceof Error ? err.message : String(err)}. Set AIMEAT_ADMIN_PASSWORD to choose the secret yourself.`);
  }
  // A node that has no operator: every path that would make an account its operator (the first-owner
  // setup, the first registration, the no-operator self-heal at registration or sign-in) asks for this
  // one-time code, which only the start log carries (services/setup-code.ts; Jouni, 2026-10-16). It is
  // issued on a loopback node too, because a request from outside that machine is asked for it as well
  // (secaudit2026oct22; Jouni, 2026-10-23). Printed at warn level, so a node started with
  // AIMEAT_LOG_LEVEL=warn shows it.
  const setupCode = !hasOperator ? setupCodeGateFor(config).issue() : null;
  const server = app.listen(config.port, (listenError?: Error) => {
    // Express 5 calls this for the server's 'error' event too, not only for 'listening'. Without
    // this check a node whose port was taken printed "AIMEAT node started", ran its schedulers and
    // served nothing, and the error was lost: every "node never bound its port" failure of the
    // nightly Postgres sweep from 2026-09-15 to 2026-09-17 was this. A node that cannot serve says
    // why and stops, so whatever supervises it sees the failure at once.
    if (listenError) {
      const code = (listenError as NodeJS.ErrnoException).code;
      logger.error(`AIMEAT node could not listen on port ${config.port}: ${code ?? ''} ${listenError.message}`.replace(/\s+/g, ' ').trim());
      if (code === 'EADDRINUSE') {
        logger.error(`Port ${config.port} is in use. Stop what holds it, or start this node with another port (--port or AIMEAT_PORT).`);
      }
      process.exit(1);
    }
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
    if (setupCode) {
      logger.warn(hasOwner
        ? `   Setup code: ${setupCode}. This node has no operator: send it as setupCode when you register or sign in, and that account becomes the operator; it works once.`
        : `   Setup code: ${setupCode}. Enter it in the setup wizard at ${config.baseUrl}/v1/setup/wizard to create this node's first owner; it works once.`);
      if (!setupCodeRequired(config, true)) {
        logger.warn(`   The code is asked only from another machine or from outside a container (Docker); the setup from this machine itself needs none.`);
      }
    }
    logger.info(`──────────────────────────────────────────────────────────`);

    // Security warnings
    if (config.totpEnabled && !config.encryptionKey && !config.totpSecretEncryptionKey) {
      // A secret is never stored in plain text since 2026-10-09 (services/totp.ts): without a key
      // the setup endpoint refuses instead.
      logger.warn('SECURITY: TOTP is enabled but neither AIMEAT_ENCRYPTION_KEY nor AIMEAT_TOTP_ENCRYPTION_KEY is set, so nobody can set up two-step sign-in.');
    }
    if (config.devMode) {
      const looksProduction = config.storageProvider !== 'memory' ||
        (config.baseUrl && !config.baseUrl.includes('localhost') && !config.baseUrl.includes('127.0.0.1'));
      if (looksProduction) {
        logger.warn('SECURITY: Dev mode is ON with non-local configuration. Dev mode allows account wipe on duplicate registration.');
      }
    }
    const turnWarning = turnDeprecationWarning(config);
    if (turnWarning) logger.warn(`SECURITY: ${turnWarning}`);
    if (process.platform === 'win32' && !process.env.AIMEAT_KEY_PASSPHRASE) {
      logger.warn('SECURITY: Node key is stored unencrypted. Windows does not enforce Unix file permissions. Set AIMEAT_KEY_PASSPHRASE to encrypt.');
    }
    // Posture self-check: on a `public`-profile node, warn loudly on unsafe combinations so being
    // insecure on the internet is a conscious choice. Warn-only. See security-development-dna.md.
    const postureWarnings = securityPostureWarnings(config);
    if (postureWarnings.length > 0) {
      logger.warn(`SECURITY: this node has ${postureWarnings.length} risky setting(s) — override deliberately or harden:`);
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
    const { authenticateUpgrade, refuseUpgrade, upgradeDeprecationHeaderLines } = await import('./auth/ws-upgrade.js');
    const { isAnonymousMode, isOwnerPrincipal } = await import('./auth/middleware.js');
    const { CONNECT_TUNNEL_PATH } = await import('./services/connect-tunnel.js');
    const tunnelWss = tunnelManager ? new WebSocketServer({ noServer: true }) : null;
    const realtimeWss = realtimeManager ? new WebSocketServer({ noServer: true }) : null;
    // Cap forward-tunnel frame size (ws defaults to 100 MiB). An authenticated
    // agent could otherwise buffer huge frames in memory (cheap DoS). Sized a
    // little above the largest JSON body the routes accept; bulk uploads use
    // presigned URLs, not the tunnel.
    const connectMaxPayload = (config.jsonBodyLimitLargeMb + 1) * 1024 * 1024;
    const connectWss = connectTunnelManager ? new WebSocketServer({ noServer: true, maxPayload: connectMaxPayload }) : null;
    // An upgrade let in on the deprecated ?token= says so in its 101 answer (Core 2026-11 HTTP-07).
    for (const wss of [tunnelWss, realtimeWss, connectWss]) {
      wss?.on('headers', (headers: string[], request: IncomingMessage) => { headers.push(...upgradeDeprecationHeaderLines(request)); });
    }

    // Echat anonymous connection rate limiter (10 connections per IP per minute). The counting is
    // services/rate-buckets.ts, which every limiter shares: the hand copy here never pruned its map,
    // so each new address stayed in memory for the life of the process (secaudit 2026-10, C5).
    const { rateBuckets } = await import('./services/rate-buckets.js');
    const echatTake = rateBuckets(60_000);
    const echatRateCheck = (ip: string): boolean => echatTake(`echat:${ip}`, 10).ok;

    const onUpgrade = async (request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> => {
      const url = new URL(request.url ?? '', `http://${request.headers.host}`);

      // ── Personal tunnel upgrade ──
      if (url.pathname === '/v1/personal/tunnel' && tunnelManager && tunnelWss) {
        try {
          // Header, single-use ticket, or the deprecated ?token= (auth/ws-upgrade.ts).
          const auth = await authenticateUpgrade(request, url, 'personal-tunnel', config.wsQueryToken);
          if (auth.outcome === 'refused') { refuseUpgrade(socket, auth.status, auth.code, auth.message); return; }
          if (auth.outcome === 'none') { refuseUpgrade(socket, 401, 'AUTH_REQUIRED', 'Authentication required'); return; }
          const { payload } = auth;

          // The tunnel is the account holder's own, as POST /v1/personal/anchor is (requireRole
          // owner). The owner NAME alone is on every token of the account: its agents, its app
          // grants, and a visitor from another node that shares the local part. A new socket replaces
          // the live one, so any of them took the node's traffic over (secaudit 2026-09).
          if (!isOwnerPrincipal(payload)) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
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
        try {
          // Header, single-use ticket, or the deprecated ?token= (auth/ws-upgrade.ts). A ticket
          // resolves to the token it was minted with, which is reused as the forward bearer.
          const auth = await authenticateUpgrade(request, url, 'connect-tunnel', config.wsQueryToken);
          if (auth.outcome === 'refused') { refuseUpgrade(socket, auth.status, auth.code, auth.message); return; }
          if (auth.outcome === 'none') { refuseUpgrade(socket, 401, 'AUTH_REQUIRED', 'Authentication required'); return; }
          const { payload, token } = auth;
          // Only scoped external principals (agent OR ecosystem app) may hold a forward tunnel.
          // Owner/operator sessions bypass scopes and are not the connector's transport. The
          // tunnel manager keys by identity.sub, so a GEAI tunnel needs no further change.
          if (!payload.roles?.includes('agent') && !payload.roles?.includes('ecosystem')) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return;
          }

          // Which installation this socket belongs to. A header rather than a claim in the
          // token, because it is a property of the MACHINE and the token is a property of the
          // agent: one credential is used from a laptop and a server, and the point is telling
          // those apart. Unsigned and untrusted by design — it decides which of an owner's OWN
          // daemons an offer goes to, and nothing else.
          const installHeader = request.headers['x-aimeat-install'];
          const installId = Array.isArray(installHeader) ? installHeader[0] : installHeader;
          // How the connector runs agents (`spawn`, `resident`), comma-separated. Also unsigned: it
          // decides only whether a proposed run mode is corrected to one the connector can run.
          const modesHeader = request.headers['x-aimeat-run-modes'];
          const runModes = Array.isArray(modesHeader) ? modesHeader[0] : modesHeader;
          // The name the connector reports for its installation (its host name unless the person
          // set one), URI-encoded. Unsigned as well: the owner reads it and nothing decides on it.
          const nameHeader = request.headers['x-aimeat-install-name'];
          const installName = Array.isArray(nameHeader) ? nameHeader[0] : nameHeader;
          // What the connector's crew runtime honours beyond its tools, comma-separated names.
          // Unsigned too: it decides only what a page offers the connector's own owner.
          const featuresHeader = request.headers['x-aimeat-features'];
          const features = Array.isArray(featuresHeader) ? featuresHeader[0] : featuresHeader;
          connectWss.handleUpgrade(request, socket, head, (ws) => {
            connectTunnelManager.handleConnection(ws, payload, token, installId ?? null, runModes ?? null, installName ?? null, features ?? null);
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
          // A node that shows its content to its own accounts only lets no anonymous visitor in.
          if (!config.echatAnonymous || signedInOnly(config)) {
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

        try {
          // Authenticate: Authorization header, single-use ticket, or the deprecated ?token=
          // (auth/ws-upgrade.ts). A credential that fails is refused; only NO credential falls back
          // to anonymous mode.
          const auth = await authenticateUpgrade(request, url, 'realtime', config.wsQueryToken);
          if (auth.outcome === 'refused') { refuseUpgrade(socket, auth.status, auth.code, auth.message); return; }
          if (auth.outcome === 'none' && (!isAnonymousMode() || signedInOnly(config))) {
            refuseUpgrade(socket, 401, 'AUTH_REQUIRED', 'Authentication required');
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
    };

    // An upgrade runs as THIS node (runAsNode, utils/gaii.ts). The server listens outside
    // createServer, so an upgrade arrives as no node, and this line gives it its node, also in a
    // process that serves more than one node. A production process serves one node, so nothing there
    // changes. An event that arrives later on the open socket arrives as no node again, and the socket
    // managers (connect-tunnel.ts, personal-tunnel.ts, realtime-manager.ts) run each handler that
    // reaches storage or an identity as their node.
    server.on('upgrade', (request, socket, head) => { void runAsNode(config.nodeId, () => onUpgrade(request, socket, head)); });

    if (tunnelManager) logger.info('WebSocket upgrade handler registered for /v1/personal/tunnel');
    if (realtimeManager) logger.info('WebSocket upgrade handler registered for /v1/realtime/ws');
    if (connectTunnelManager) logger.info('WebSocket upgrade handler registered for /v1/connect/tunnel');
  }

  // Graceful shutdown handler -- flush stats and close connections
  const { getStats: getStatsInstance } = await import('./services/stats.js');
  const handleShutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down...`);
    // The chat agent is a child of this process; it goes when we go, or it is orphaned.
    const { shutdownChat } = await import('./services/chat-session.js');
    shutdownChat();
    // No new scheduled fire and no workflow sweep from here on; the runs in progress get a bounded
    // wait, and one still going after it is written to its run log as cut off (Scheduler.shutdown).
    const { getActiveScheduler } = await import('./services/scheduler.js');
    const { getActiveWorkflowEngine } = await import('./services/workflow/engine.js');
    getActiveWorkflowEngine()?.stop();
    await getActiveScheduler()?.shutdown(SCHEDULER_SHUTDOWN_GRACE_MS)
      .catch(err => logger.warn('index-start: scheduler shutdown failed', { error: String(err) }));
    const statsInstance = getStatsInstance();
    if (statsInstance) await statsInstance.shutdown();
    // Every write buffer, the agent refusal notes included (server-bootstrap/process-buffers.ts).
    const { flushProcessBuffers } = await import('./server-bootstrap/process-buffers.js');
    await flushProcessBuffers();
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
