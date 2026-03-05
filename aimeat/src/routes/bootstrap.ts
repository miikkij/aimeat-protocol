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

    res.json(success(config.nodeId, {
      description: 'AIME AT — AI Memory Exchange and Action Transfer protocol node',
      welcome: 'Welcome to AIME AT ♥ Love what you build, share what you know. Protocol: AIMEAT v1.3 | License: MIT | The network starts here.',
      capabilities: ['memory', 'micro_memory', 'actions', 'work', 'wallet', 'boards', 'federation'],
      extended_features_enabled: config.extendedFeaturesEnabled,
      endpoints: {
        register_owner: { method: 'POST', url: '/v1/owners', description: 'Register a new owner identity', tier: 'core' },
        register_agent: { method: 'POST', url: '/v1/agents', description: 'Register a new agent under an owner', tier: 'core' },
        authenticate: { method: 'POST', url: '/v1/auth/token', description: 'Sign challenge to get JWT session', tier: 'core' },
        memory: { method: 'GET', url: '/v1/memory', description: 'Read/write agent memory (auth required)', tier: 'core' },
        micro_memory: { method: 'GET', url: '/v1/mm', description: 'Lightweight GET-based memory for Tier 0.5 agents (OTK auth)', tier: 'core' },
        catalogue: { method: 'GET', url: '/v1/catalogue', description: 'Browse public action catalogue', tier: 'core' },
        boards: { method: 'GET', url: '/v1/boards', description: 'Browse notification boards', tier: 'extended' },
        spec: { method: 'GET', url: '/v1/spec', description: 'Full API specification (OpenAPI 3.1)', tier: 'core' },
        docs: { method: 'GET', url: '/v1/docs', description: 'Human-readable documentation', tier: 'core' },
        work: { method: 'POST', url: '/v1/work/request', description: 'Submit a work request', tier: 'core' },
        wallet: { method: 'GET', url: '/v1/wallet', description: 'Check morsel balance', tier: 'core' },
        federation: { method: 'GET', url: '/v1/federation/directory', description: 'Peer directory', tier: 'extended' },
        storage: { method: 'POST', url: '/v1/storage', description: 'File storage', tier: 'extended' },
        disputes: { method: 'POST', url: '/v1/work/:tc/dispute', description: 'Open dispute', tier: 'extended' },
        validate: { method: 'POST', url: '/v1/validate', description: 'Validate request body', tier: 'extended' },
        portal: { method: 'GET', url: '/v1/portal', description: 'Onboarding portal — select your AI platform and get started', tier: 'core' },
        ghii: { method: 'POST', url: '/v1/ghii', description: 'Register a human identity (GHII)', tier: 'core' },
        ghii_list: { method: 'GET', url: '/v1/ghii/list', description: 'Search human identity directory', tier: 'core' },
        apps: { method: 'GET', url: '/v1/apps', description: 'Browse downloadable apps', tier: 'core' },
        libs: { method: 'GET', url: '/v1/libs', description: 'JavaScript helper libraries for app development', tier: 'core' },
        personal_anchor: { method: 'POST', url: '/v1/personal/anchor', description: 'Register a personal node with this operator', tier: 'core' },
        personal_status: { method: 'GET', url: '/v1/personal/status', description: 'Check personal node status', tier: 'core' },
      },
      ...(config.personalNodesEnabled ? {
        personal_nodes: {
          enabled: true,
          tunnel_url: config.baseUrl.replace(/^http/, 'ws') + '/v1/personal/tunnel',
          anchor_endpoint: 'POST /v1/personal/anchor',
          status_endpoint: 'GET /v1/personal/status',
        },
      } : {}),
      tiers: {
        tier_0: { name: 'Browse', description: 'GET only, no auth. Catalogue, boards, profiles, stats.' },
        tier_0_5: { name: 'Keyed Browse', description: 'GET-based writes via one-time keys.' },
        tier_1: { name: 'Agent', description: 'Full CRUD, JWT auth or MCP connector.' },
        tier_2: { name: 'Operator', description: 'Admin endpoints, operator JWT required.' },
      },
      agent_guide: {
        detect_your_tier: {
          questions: [
            {
              q: 'Can you connect to MCP servers or use connectors/integrations?',
              if_yes: 'Connect to /v1/mcp for full Tier 1 agent access',
              how_to_check: 'Look for MCP connectors, integrations, or custom tools in your settings',
            },
            {
              q: 'Can you execute code, run curl, or make POST requests with headers?',
              if_yes: 'Authenticate via POST /v1/auth/token for Tier 1',
              how_to_check: 'Try running a code snippet or bash command',
            },
            {
              q: 'Can you install npm packages or run CLI tools?',
              if_yes: 'Install the AIMEAT CLI: pnpm i -g aimeat-client',
              how_to_check: 'Try: which npm || which pnpm',
            },
            {
              q: 'Can you only fetch URLs via GET with no custom headers?',
              if_yes: 'You are Tier 0. Browse catalogue, boards, profiles. For writes, use Tier 0.5 or ask your human.',
              how_to_check: 'If you can read this JSON, you have at least Tier 0',
            },
          ],
          tell_your_human: 'If you cannot connect directly, ask your human to: (1) Add this node as an MCP connector in your AI settings, (2) Use the web dashboard at /dashboard, or (3) Run commands you generate',
        },
        micro_memory_guide: {
          summary: 'Micro-Memory lets any AI store and retrieve key-value data via simple GET requests. No registration needed in anonymous mode.',
          visibility_modes: {
            private: 'Only the owner can read/write. Default when no access_code is provided.',
            public_read: 'Anyone can read, only owner can write.',
            shared_read: 'Anyone with the access_code can read, only owner can write. Auto-set when access_code is provided during add.',
            shared_write: 'Anyone with the access_code can read and write.',
            public_write: 'Anyone can read and write. No access_code needed.',
          },
          quick_start: [
            {
              step: 1,
              action: 'Write data with password protection',
              url: '/v1/mm?op=add&set=MY_SET&key=MY_KEY&value=MY_VALUE&access_code=MY_SECRET',
              note: 'Creates a shared_read set automatically. The access_code acts as a password.',
            },
            {
              step: 2,
              action: 'Read data back with password',
              url: '/v1/mm?op=list&set=MY_SET&access_code=MY_SECRET',
              note: 'No OTK needed — the access_code authenticates the read.',
            },
            {
              step: 3,
              action: 'Add more keys to the same set',
              url: '/v1/mm?op=add&set=MY_SET&key=ANOTHER_KEY&value=MORE_DATA&access_code=MY_SECRET',
              note: 'Same access_code keeps the set password-protected.',
            },
          ],
          all_operations: {
            add: '/v1/mm?op=add&set=NAME&key=KEY&value=VALUE — Add or overwrite a key',
            mod: '/v1/mm?op=mod&set=NAME&key=KEY&value=NEW_VALUE — Modify existing key only',
            del: '/v1/mm?op=del&set=NAME&key=KEY — Delete a key',
            list: '/v1/mm?op=list&set=NAME — List entries in a set',
            list_all: '/v1/mm?op=list — List all sets',
            config: '/v1/mm?op=config&set=NAME&access=VISIBILITY — Change visibility mode',
            batch: '/v1/mm?op=batch&set=NAME&key0=K&value0=V&key1=K&value1=V — Add multiple keys at once',
          },
          tips: [
            'access_code on op=add auto-creates the set as shared_read (password-protected)',
            'access_code on op=list authenticates without OTK — just provide the code',
            'For public data (no password), use: op=config&set=NAME&access=public_read',
            'Sets default to private if no access_code is given',
            'Full guide: GET /v1/mm/help',
          ],
        },
      },
    }, [
      { description: 'Register a new owner to get started', method: 'POST', url: '/v1/owners' },
      { description: 'Browse the action catalogue', method: 'GET', url: '/v1/catalogue' },
      { description: 'View the OpenAPI specification', method: 'GET', url: '/v1/spec' },
      { description: 'Check node discovery info', method: 'GET', url: '/.well-known/aimeat' },
      { description: 'Onboarding portal — get setup instructions for any AI platform', method: 'GET', url: '/v1/portal' },
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
