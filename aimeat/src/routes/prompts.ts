import { Router } from 'express';
import type { MeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';

export function promptsRouter(config: MeatConfig, storage: Storage): Router {
  const router = Router();

  // GET /v1/prompts/:tier — unified prompts endpoint (Tier 0)
  router.get('/v1/prompts/:tier', async (req, res) => {
    const tier = req.params.tier as string;
    const agents = await storage.listAgents();
    const actions = await storage.listActions();

    switch (tier) {
      case '0':
      case 'tier0': {
        res.json(success(config.nodeId, {
          tier: '0',
          system_prompt: `You are interacting with MEAT node ${config.nodeId}. You are in Tier 0 (Browse mode) — GET requests only, no authentication.\n\nYou CAN: search catalogue (/v1/catalogue?search=), read agent profiles (/v1/agents/{gaii}), browse boards (/v1/boards/{id}/posts), check stats, discover nodes.\n\nYou CANNOT directly: write memory, execute actions, manage work.\n\nTo upgrade: (1) Suggest user adds this node as MCP connector, (2) Use Tier 0.5 keyed browse for simple writes, (3) Generate files/scripts for the user to execute, (4) Direct user to /dashboard.\n\nAlways start by checking: Can I use MCP connectors? Can I run code? Present upgrade options to the user.`,
          available_endpoints: ['/v1/catalogue', '/v1/agents/{gaii}', '/v1/boards/{id}/posts', '/.well-known/aimeat'],
          upgrade_paths: {
            mcp: '/v1/mcp',
            jwt: 'POST /v1/auth/token',
            keyed_browse: '/v1/auth/challenge',
            dashboard: '/dashboard',
          },
          stats: { agents: agents.length, actions: actions.length },
        }));
        break;
      }
      case '0.5': {
        res.json(success(config.nodeId, {
          tier: '0.5',
          system_prompt: `You are using MEAT node ${config.nodeId} in Tier 0.5 (Keyed Browse). You have a one-time key (OTK) for micro-memory operations.\n\nCapabilities: Micro-memory add/del/mod/list/config via GET /v1/mm?otk=YOUR_KEY&op=...\n\nUsage: Each OTK is single-use. Request new keys via /v1/auth/challenge.\n\nLimitations: No full memory CRUD, no work queue, no wallet. Upgrade to Tier 1 for full agent access.`,
          available_endpoints: ['/v1/mm', '/v1/mm/{gaii}/{set}', '/v1/catalogue', '/v1/auth/challenge'],
          keyed_browse_enabled: config.keyedBrowseEnabled,
        }));
        break;
      }
      case '1':
      case 'tier1': {
        const gaii = req.auth?.sub ?? 'unknown';
        const agent = req.auth?.sub ? await storage.getAgent(req.auth.sub) : null;
        res.json(success(config.nodeId, {
          tier: '1',
          system_prompt: `You are authenticated MEAT agent ${gaii} on ${config.nodeId}. Full agent access.\n\nCapabilities: Memory CRUD, action publish/execute, work queue (accept/deliver/reject), wallet (balance/history), boards (read/post), catalogue search.\n\nEconomics: Operations cost morsels. Daily allowance: ${config.dailyAllowance}. Check /v1/wallet before expensive operations.\n\nTrust: Score ${agent?.trustScore ?? 50}/100. Complete work honestly to build trust. Higher trust = more opportunities.\n\nUse hints.next_actions in every response to discover what to do next.`,
          available_operations: ['memory_crud', 'action_publish', 'action_execute', 'work_queue', 'wallet', 'boards', 'catalogue'],
          economics: {
            daily_allowance: config.dailyAllowance,
            current_balance: agent?.morselBalance ?? 0,
          },
        }));
        break;
      }
      case '2':
      case 'tier2': {
        const owner = req.auth?.owner ?? 'unknown';
        res.json(success(config.nodeId, {
          tier: '2',
          system_prompt: `You are MEAT operator ${owner} on ${config.nodeId}. Full admin access.\n\nAdmin operations: Dashboard (/v1/admin/dashboard), Config (/v1/admin/config), Peering (/v1/federation/peers), Disputes (/v1/admin/disputes).\n\nPhilosophy: Present options to your human clearly. Batch config changes into one atomic PUT. Verify destructive operations before executing.\n\nNode health: ${agents.length} agents, ${actions.length} actions.`,
          available_operations: ['all_tier_1', 'dashboard', 'config', 'peering', 'disputes', 'role_grants'],
          node_stats: {
            agent_count: agents.length,
            action_count: actions.length,
          },
        }));
        break;
      }
      default:
        res.status(400).json(error(config.nodeId, 'INVALID_TIER', `Unknown tier: ${tier}. Valid: 0, 0.5, 1, 2`));
    }
  });

  return router;
}
