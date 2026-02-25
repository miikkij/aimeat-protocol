import { Router } from 'express';
import type { MeatConfig } from '../config.js';
import { success } from '../middleware/envelope.js';

export function bootstrapRouter(config: MeatConfig): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(success(config.nodeId, {
      description: 'AI Memory Exchange and Action Transfer protocol node',
      welcome: 'Welcome to MEAT — AI Infrastructure: Memory, Economy, Actions, Trust. Protocol: AIMEAT v1.2 | License: MIT | The network starts here.',
      capabilities: ['memory', 'actions', 'work', 'wallet', 'boards', 'federation'],
      extended_features_enabled: config.extendedFeaturesEnabled,
      endpoints: {
        register_owner: { method: 'POST', url: '/v1/owners', description: 'Register a new owner identity', tier: 'core' },
        register_agent: { method: 'POST', url: '/v1/agents', description: 'Register a new agent under an owner', tier: 'core' },
        authenticate: { method: 'POST', url: '/v1/auth/token', description: 'Sign challenge to get JWT session', tier: 'core' },
        memory: { method: 'GET', url: '/v1/memory', description: 'Read/write agent memory (auth required)', tier: 'core' },
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
      },
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
              if_yes: 'Install the MEAT CLI: pnpm i -g aimeat-client',
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
      },
    }, [
      { description: 'Register a new owner to get started', method: 'POST', url: '/v1/owners' },
      { description: 'Browse the action catalogue', method: 'GET', url: '/v1/catalogue' },
      { description: 'View the OpenAPI specification', method: 'GET', url: '/v1/spec' },
      { description: 'Check node discovery info', method: 'GET', url: '/.well-known/aimeat' },
    ]));
  });

  // GET /v1/health — simple liveness/readiness check (Tier 0, no auth)
  router.get('/v1/health', (_req, res) => {
    res.json(success(config.nodeId, {
      status: 'healthy',
      uptime_seconds: Math.floor(process.uptime()),
      memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    }));
  });

  return router;
}
