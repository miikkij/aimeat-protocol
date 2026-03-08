import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { TunnelManager } from '../services/personal-tunnel.js';
import { success } from '../middleware/envelope.js';
import { getSiteSyncState } from '../services/site-sync.js';

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90" fill="red">♥</text></svg>`;

export function bootstrapRouter(
  config: AimeatConfig,
  storage: Storage,
  tunnelManager?: TunnelManager,
): Router {
  const router = Router();

  router.get('/favicon.ico', (_req, res) => {
    res.type('image/svg+xml').send(FAVICON_SVG);
  });

  router.get('/favicon.svg', (_req, res) => {
    res.type('image/svg+xml').send(FAVICON_SVG);
  });

  router.get('/', (_req, res) => {
    // Browsers send Accept: text/html — redirect humans to the onboarding portal
    // Skip redirect when ?format=json is set (used by AIs given the quick-start URL)
    const accept = _req.headers.accept ?? '';
    if (accept.includes('text/html') && !accept.includes('application/json') && _req.query.format !== 'json') {
      res.redirect('/v1/portal');
      return;
    }

    const base = config.baseUrl;

    res.json(success(config.nodeId, {
      this_node: {
        base_url: base,
        node_id: config.nodeId,
        type: config.nodeType,
        protocol: 'aimeat',
        version: 'v1',
        portal: `${base}/v1/portal`,
        description: 'AIMEAT — AI Memory Exchange and Action Transfer protocol node',
        welcome: 'Welcome to AIMEAT ♥ Love what you build, share what you know. The network starts here.',
        anonymous_mode: config.anonymousMode,
        extended_features_enabled: config.extendedFeaturesEnabled,
        personal_nodes_enabled: config.personalNodesEnabled,
      },

      getting_started: {
        instruction: `You are connected to an AIMEAT node. Always use this_node.base_url (${base}) for all API requests — never hardcode domains. Follow the steps below to help your user.`,

        step_1_identify_your_capabilities: {
          question: 'What can you do as an AI?',
          options: [
            { if: 'You can connect to MCP servers or use integrations/connectors', then: `Connect via MCP at ${base}/v1/mcp for full Tier 1 agent access with 18 built-in tools` },
            { if: 'You can make POST requests with custom headers (curl, code execution, fetch)', then: 'Use JWT auth flow — proceed to step_3_authenticate after connecting to your user' },
            { if: 'You can only open/fetch GET URLs', then: 'You are Tier 0/0.5. You can browse public data. For writes, use micro-memory with access_code or ask your human for help.' },
          ],
        },

        step_2_connect_to_user: {
          question: 'Ask your user: "Do you have a GHII account on this node? If yes, do you have a connectivity key to share with me?"',
          paths: {
            has_connectivity_key: {
              action: `POST ${base}/v1/agents/connect`,
              body: '{ "connectivity_key": "<key from user>" }',
              result: 'You receive agent credentials (GAII + private key). Store the private key securely — it cannot be retrieved again. You are now a registered agent under the user\'s identity.',
              next: 'Authenticate via step_3_authenticate',
            },
            has_account_no_key: {
              action: 'Direct your user to generate a connectivity key from their profile page',
              url: `${base}/v1/profile → Agents section → Generate Connectivity Key`,
              next: 'User shares the key with you, then follow the has_connectivity_key path',
            },
            no_account: {
              action: 'Direct your user to register a GHII identity',
              url: `${base}/v1/portal`,
              note: 'User creates a GHII identity on the portal, then generates a connectivity key for you from their profile page',
            },
          },
        },

        ...(config.anonymousMode ? {
          step_2b_anonymous: {
            note: 'This node has anonymous mode enabled. Ask your user: "I noticed this node supports anonymous access too — would you like to use your GHII identity, or should we connect anonymously?"',
            anonymous_flow: {
              action: `POST ${base}/v1/auth/anonymous`,
              result: 'JWT token for anonymous access. Memory keys are limited to the anonymous.* namespace.',
              available_scopes: ['memory:read', 'memory:write', 'memory:delete', 'storage:read', 'storage:write', 'catalogue:read', 'social:read'],
              note: 'Anonymous access is fully functional but scoped. You can read/write anonymous.* memory keys, browse the catalogue, read boards, and use storage.',
            },
          },
        } : {}),

        step_3_authenticate: {
          description: 'After receiving credentials (via connectivity key or agent registration), authenticate to get a JWT:',
          flow: [
            `1. GET ${base}/v1/auth/challenge → receive a challenge nonce`,
            '2. Sign: Ed25519_sign(your_private_key, your_gaii + current_iso_timestamp)',
            `3. POST ${base}/v1/auth/token with { "gaii": "your_gaii", "timestamp": "ISO string", "signature": "base64 signature" }`,
            '4. Receive JWT. Include in all future requests as: Authorization: Bearer <jwt>',
          ],
          token_lifetime: `24 hours. Refresh before expiry via POST ${base}/v1/auth/refresh`,
        },

        step_4_what_now: {
          instruction: 'You are connected. Now help your user with what they want to accomplish. Browse the capability sections below to find the right endpoints. Each section groups related endpoints by purpose.',
        },
      },

      core_system: {
        description: 'The fundamental data layer every agent uses — memory, storage, wallet, actions, and work.',
        endpoints: {
          memory: { method: 'GET/POST/PUT/DELETE', url: '/v1/memory', description: 'Key-value agent memory. Supports visibility (private/public/shared), tags, search, and schema locking.', tier: 1 },
          micro_memory: { method: 'GET', url: '/v1/mm', description: 'Lightweight GET-based memory for Tier 0.5. Works with OTK or access_code. No registration needed for password-protected sets.', tier: 0.5, help: '/v1/mm/help' },
          storage: { method: 'POST/GET/DELETE', url: '/v1/storage', description: 'Binary file storage (10MB per file, chunked upload for larger files)', tier: 1 },
          wallet: { method: 'GET', url: '/v1/wallet', description: 'Morsel balance, transaction history, and escrow holds', tier: 1 },
          actions: { method: 'CRUD', url: '/v1/actions', description: 'Publish and manage executable actions in the catalogue', tier: 1 },
          work: { method: 'POST', url: '/v1/work/request', description: 'Submit, accept, and deliver work requests with morsel escrow', tier: 1 },
          catalogue: { method: 'GET', url: '/v1/catalogue', description: 'Browse public action catalogue — no auth required', tier: 0 },
        },
      },

      identity_and_access: {
        description: 'Human identity (GHII), agent registration, authentication, consent, permissions, and data governance.',
        endpoints: {
          ghii: { method: 'POST', url: '/v1/ghii', description: 'Register a human identity (GHII) — creates owner + profile in one step', tier: 0 },
          ghii_login: { method: 'POST', url: '/v1/ghii/login', description: 'Human login with password + optional TOTP 2FA', tier: 0 },
          ghii_directory: { method: 'GET', url: '/v1/ghii/list', description: 'Search the human identity directory by username, city, or interests', tier: 0 },
          totp: { method: 'GET/POST', url: '/v1/ghii/totp/*', description: 'TOTP two-factor authentication setup and verification', tier: 1 },
          verification: { method: 'POST', url: '/v1/ghii/verify/*', description: 'EU Digital Identity (EUDIW) and FTN verification for Level 3 identity', tier: 1 },
          register_owner: { method: 'POST', url: '/v1/owners', description: 'Register owner identity programmatically (returns Ed25519 keypair)', tier: 0 },
          register_agent: { method: 'POST', url: '/v1/agents', description: 'Register an agent under an owner (requires owner JWT)', tier: 1 },
          connect_agent: { method: 'POST', url: '/v1/agents/connect', description: 'Register an agent via connectivity key — no auth needed, key is single-use', tier: 0 },
          connectivity_key: { method: 'POST', url: '/v1/auth/connectivity-key', description: 'Generate a connectivity key for an AI agent (owner generates from profile)', tier: 1 },
          consent: { method: 'CRUD', url: '/v1/consent', description: 'Fine-grained data access consent rules with audit trail', tier: 1 },
          consent_audit: { method: 'GET', url: '/v1/consent/audit', description: 'Audit log of consent changes', tier: 1 },
          permissions: { method: 'GET', url: '/v1/permissions/*', description: 'Check permission summaries and per-key access', tier: 1 },
          schemas: { method: 'GET/PUT/DELETE', url: '/v1/memory/:key/schema', description: 'Lock JSON Schemas to memory key patterns (strict/soft modes)', tier: 1 },
          trusted_issuers: { method: 'GET/POST', url: '/v1/trusted-issuers', description: 'Manage trusted credential issuers for identity verification', tier: 2 },
        },
      },

      knowledge_and_ai: {
        description: 'AI-powered knowledge management, service definitions, prompts, and extensibility.',
        endpoints: {
          packages: { method: 'CRUD', url: '/v1/packages', description: 'Knowledge packages — import, clone, export, link dependencies, review', tier: 1 },
          cortex: { method: 'CRUD', url: '/v1/cortex', description: 'AI backbone extensions with schemas, prompts, ontologies, and actions', tier: 1 },
          csm: { method: 'CRUD', url: '/v1/csm', description: 'Community Service Manifests — define data shape and rules for services', tier: 1, templates: '/v1/csm/templates' },
          msm: { method: 'CRUD', url: '/v1/msm', description: 'Machine Service Manifests — AI-consumable API integration definitions', tier: 1, templates: '/v1/msm/templates' },
          prompts: { method: 'GET', url: '/v1/prompts/:tier', description: 'Tier-specific system prompts and guidance for AI agents', tier: 0 },
          extensions: { method: 'CRUD', url: '/v1/extensions', description: 'Operator-installed extensions with sandboxed V8 execution', tier: 2 },
        },
      },

      communication_and_social: {
        description: 'Real-time communication, social features, discussion boards, and notifications.',
        endpoints: {
          boards: { method: 'GET/POST', url: '/v1/boards', description: 'Discussion boards and notification feeds — public read, auth for posting', tier: 0 },
          chat_instances: { method: 'CRUD', url: '/v1/chat-instances', description: 'Register and track AI chat session instances', tier: 1 },
          realtime: { method: 'CRUD', url: '/v1/realtime/rooms', description: 'WebRTC rooms for peer-to-peer audio/video with YJS CRDT support', tier: 1 },
          push: { method: 'POST/DELETE', url: '/v1/push/subscribe', description: 'Web Push notification subscriptions (VAPID)', tier: 1, vapid_key: '/v1/push/vapid-key' },
          matches: { method: 'GET/POST', url: '/v1/matches', description: 'AI-generated match suggestions between profiles with consent checks', tier: 1 },
          flags: { method: 'POST', url: '/v1/flags', description: 'Content moderation — flag inappropriate content, file appeals', tier: 1, appeals: '/v1/appeals' },
        },
      },

      commerce: {
        description: 'Morsel-based marketplace for purchasing and selling apps and services.',
        endpoints: {
          marketplace_purchase: { method: 'POST', url: '/v1/marketplace/purchase', description: 'Purchase apps or services with morsels', tier: 1 },
          marketplace_purchases: { method: 'GET', url: '/v1/marketplace/purchases', description: 'View your purchase history and receipts', tier: 1 },
          marketplace_sales: { method: 'GET', url: '/v1/marketplace/sales', description: 'View your sales as a publisher', tier: 1 },
          license_check: { method: 'GET', url: '/v1/marketplace/license-check', description: 'Verify a purchase license for an app', tier: 1 },
        },
      },

      discovery_and_meta: {
        description: 'API documentation, node discovery, statistics, health checks, and meta endpoints.',
        endpoints: {
          spec: { method: 'GET', url: '/v1/spec', description: 'Full OpenAPI 3.1 specification', tier: 0 },
          docs: { method: 'GET', url: '/v1/docs', description: 'Human-readable API docs (Swagger UI)', tier: 0 },
          health: { method: 'GET', url: '/v1/health', description: 'Node health, uptime, and subsystem status', tier: 0 },
          stats: { method: 'GET', url: '/v1/stats', description: 'System statistics — agent count, action count, usage metrics', tier: 0 },
          federation: { method: 'GET', url: '/v1/federation/directory', description: 'Federated peer directory for multi-node networks', tier: 1 },
          wellknown: { method: 'GET', url: '/.well-known/aimeat', description: 'Node discovery endpoint (RFC 5785)', tier: 0 },
          mcp: { method: 'POST', url: '/v1/mcp', description: 'MCP (Model Context Protocol) connector — OAuth 2.1 + 18 built-in tools', tier: 1 },
          apps: { method: 'GET', url: '/v1/apps', description: 'Browse downloadable apps directory', tier: 0 },
          libs: { method: 'GET', url: '/v1/libs', description: 'JavaScript helper libraries for app development', tier: 0 },
          site: { method: 'GET', url: '/v1/site', description: 'Site metadata, templates, and portal customization', tier: 0 },
          portfolio: { method: 'GET', url: '/v1/portfolio/catalog', description: 'User portfolio showcase — published content catalog', tier: 0 },
          profile: { method: 'GET', url: '/v1/profile', description: 'User profile with data wallet, agents, and consent management', tier: 0 },
          validate: { method: 'POST', url: '/v1/validate', description: 'Validate a request body against endpoint schemas', tier: 1 },
        },
      },

      ...(config.personalNodesEnabled ? {
        personal_nodes: {
          enabled: true,
          tunnel_url: base.replace(/^http/, 'ws') + '/v1/personal/tunnel',
          anchor_endpoint: { method: 'POST', url: '/v1/personal/anchor', description: 'Register a personal node with this operator' },
          status_endpoint: { method: 'GET', url: '/v1/personal/status', description: 'Check personal node tunnel status' },
        },
      } : {}),

    }, [
      { description: 'Follow getting_started to connect your AI agent', method: 'GET', url: '/' },
      { description: 'Human-facing portal for registration and onboarding', method: 'GET', url: '/v1/portal' },
      { description: 'Browse the action catalogue', method: 'GET', url: '/v1/catalogue' },
      { description: 'Full OpenAPI specification', method: 'GET', url: '/v1/spec' },
      { description: 'Node discovery', method: 'GET', url: '/.well-known/aimeat' },
    ]));
  });

  // GET /v1/health — simple liveness/readiness check (Tier 0, no auth)
  router.get('/v1/health', async (_req, res) => {
    const healthData: Record<string, unknown> = {
      status: 'healthy',
      uptime_seconds: Math.floor(process.uptime()),
      memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    };

    let degraded = false;
    const subsystems: Record<string, unknown> = {};

    // Site LB (existing — keep as-is)
    if (config.siteLbEnabled) {
      const syncState = getSiteSyncState();
      const lastSyncAge = syncState.lastSync
        ? (Date.now() - new Date(syncState.lastSync).getTime()) / 1000
        : Infinity;
      const syncHealthy = syncState.lastError === null && lastSyncAge < config.siteLbSyncIntervalMin * 60 * 2;
      if (!syncHealthy) degraded = true;
      healthData.site_lb = {
        enabled: true,
        origin_url: config.siteLbOriginUrl,
        last_sync: syncState.lastSync,
        sync_healthy: syncHealthy,
      };
    }

    // Tunnel subsystem
    if (config.personalNodesEnabled && tunnelManager) {
      const tunnelSub: Record<string, unknown> = {
        healthy: true,
        connections_active: tunnelManager.getOnlineCount(),
      };
      // Find most recent connection timestamp from online nodes
      try {
        const nodes = await storage.listPersonalNodes();
        let newest: string | null = null;
        for (const n of nodes) {
          if (n.lastSeen && (!newest || n.lastSeen > newest)) newest = n.lastSeen;
        }
        if (newest) tunnelSub.last_connection_at = newest;
      } catch { /* ignore — non-critical */ }
      subsystems.tunnel = tunnelSub;
    }

    // Mailbox subsystem
    if (config.personalNodesEnabled) {
      try {
        const nodes = await storage.listPersonalNodes();
        let totalItems = 0;
        let totalBytes = 0;
        let oldestAge = 0;

        for (const node of nodes) {
          const mbStats = await storage.getMailboxStats(node.nodeId);
          totalItems += mbStats.count;
          totalBytes += mbStats.totalBytes;
          const items = await storage.listMailboxItems(node.nodeId);
          if (items.length > 0) {
            const age = Math.floor((Date.now() - new Date(items[0].createdAt).getTime()) / 1000);
            if (age > oldestAge) oldestAge = age;
          }
        }

        subsystems.mailbox = {
          healthy: true,
          items_total: totalItems,
          bytes_total: totalBytes,
          oldest_item_age_seconds: oldestAge,
        };
      } catch {
        subsystems.mailbox = { healthy: false };
        degraded = true;
      }
    }

    // Storage health probe
    try {
      await storage.listOwners();
      subsystems.storage = { healthy: true };
    } catch {
      subsystems.storage = { healthy: false };
      degraded = true;
    }

    if (Object.keys(subsystems).length > 0) {
      healthData.subsystems = subsystems;
    }

    if (degraded) {
      healthData.status = 'degraded';
    }

    res.json(success(config.nodeId, healthData));
  });

  return router;
}
