import { Router } from 'express';
import type { MeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { generateKeyPair } from '../auth/keypair.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { validateAgentName, buildGAII, parseGAII } from '../utils/gaii.js';
import { calculateTrustScore } from '../services/trust.js';
import { executeHooks } from '../services/hooks.js';

export function agentsRouter(config: MeatConfig, storage: Storage): Router {
  const router = Router();

  // POST /v1/agents — register a new agent (requires owner JWT)
  router.post('/v1/agents', requireAuth(), requireRole('owner'), async (req, res) => {
    const { name, owner, display_name, description, capabilities } = req.body ?? {};

    if (!name || !owner) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'name and owner are required'));
      return;
    }

    // Extension hook: pre_agent_registration
    const hookResult = await executeHooks(config, storage, 'pre_agent_registration', { name, owner, display_name });
    if (!hookResult.allowed) {
      res.status(403).json(error(config.nodeId, 'HOOK_REJECTED', hookResult.reason ?? 'Agent registration denied by extension hook'));
      return;
    }

    // Verify the authenticated owner matches
    if (req.auth!.owner !== owner) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only register agents under your own owner identity'));
      return;
    }

    const nameError = validateAgentName(name);
    if (nameError) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', nameError));
      return;
    }

    // Verify owner exists
    const ownerRecord = await storage.getOwner(owner);
    if (!ownerRecord) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Owner "${owner}" not found`));
      return;
    }

    const gaii = buildGAII(name, owner, config.nodeId);

    // Check for duplicate
    const existing = await storage.getAgent(gaii);
    if (existing) {
      res.status(409).json(error(config.nodeId, 'NAME_TAKEN', `Agent "${name}" already exists under owner "${owner}"`));
      return;
    }

    const keyPair = await generateKeyPair();
    const now = new Date().toISOString();

    const agent = await storage.createAgent({
      name,
      owner,
      gaii,
      displayName: display_name,
      description,
      capabilities: capabilities ?? [],
      publicKey: keyPair.publicKey,
      trustScore: 50,
      morselBalance: config.welcomeBonus,
      createdAt: now,
      lastSeen: now,
    });

    // Record welcome bonus transaction
    if (config.welcomeBonus > 0) {
      await storage.addTransaction({
        id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        gaii,
        type: 'welcome_bonus',
        amount: config.welcomeBonus,
        timestamp: now,
      });
    }

    // Extension hook: post_agent_registration (fire-and-forget)
    executeHooks(config, storage, 'post_agent_registration', { gaii: agent.gaii, owner: agent.owner }).catch(() => { });

    res.status(201).json(success(config.nodeId, {
      agent: {
        gaii: agent.gaii,
        display_name: agent.displayName,
        description: agent.description,
        capabilities: agent.capabilities,
        trust_score: agent.trustScore,
        morsel_balance: agent.morselBalance,
        created_at: agent.createdAt,
      },
      private_key: keyPair.privateKey,
      public_key: keyPair.publicKey,
      note: 'Store the private key securely. It cannot be retrieved again. Use it to authenticate as this agent.',
    }, [
      {
        description: 'Authenticate as this agent to get a JWT',
        method: 'POST',
        url: '/v1/auth/token',
        example_body: {
          gaii,
          timestamp: new Date().toISOString(),
          signature: 'base64(Ed25519_sign(private_key, gaii + timestamp))',
        },
      },
      {
        description: 'Store something in memory',
        method: 'POST',
        url: '/v1/memory',
        example_body: {
          key: 'hello',
          value: 'world',
          visibility: 'private',
        },
      },
    ]));
  });

  // GET /v1/agents/:gaii — public agent profile (no auth)
  router.get('/v1/agents/:gaii', async (req, res) => {
    // GAII contains # and @ which need URL encoding
    const gaii = decodeURIComponent(req.params.gaii as string);
    const agent = await storage.getAgent(gaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', `Agent not found: ${gaii}`));
      return;
    }

    const trust = await calculateTrustScore(gaii, storage);
    const actions = await storage.listActions();
    const actionsPublished = actions.filter(a => a.providerGaii === gaii).length;

    // Update cached trust score
    await storage.updateAgent(gaii, { trustScore: trust.score });

    res.json(success(config.nodeId, {
      gaii: agent.gaii,
      display_name: agent.displayName,
      description: agent.description,
      capabilities: agent.capabilities,
      trust: {
        score: trust.score,
        total_deliveries: trust.totalDeliveries,
        successful_deliveries: trust.successfulDeliveries,
        success_rate: trust.successRate,
        avg_delivery_time_seconds: trust.avgDeliveryTimeSeconds,
        positive_ratings: trust.positiveRatings,
        negative_ratings: trust.negativeRatings,
        age_days: trust.ageDays,
      },
      actions_published: actionsPublished,
      home_node: config.nodeId,
      created_at: agent.createdAt,
      last_seen: agent.lastSeen,
    }, [
      { description: 'Browse the action catalogue', method: 'GET', url: '/v1/catalogue' },
      { description: 'View node discovery info', method: 'GET', url: '/.well-known/aimeat' },
    ]));
  });

  // GET /v1/agents — list agents (auth required, returns own agents)
  router.get('/v1/agents', requireAuth(), async (req, res) => {
    const agents = await storage.getAgentsByOwner(req.auth!.owner);

    res.json(success(config.nodeId, {
      agents: agents.map(a => ({
        gaii: a.gaii,
        display_name: a.displayName,
        description: a.description,
        capabilities: a.capabilities,
        trust_score: a.trustScore,
        morsel_balance: a.morselBalance,
        created_at: a.createdAt,
        last_seen: a.lastSeen,
      })),
    }, [
      { description: 'Register a new agent', method: 'POST', url: '/v1/agents' },
    ]));
  });

  // POST /v1/checkin — agent heartbeat (agent auth)
  router.post('/v1/checkin', requireAuth(), requireRole('agent'), async (req, res) => {
    const gaii = req.auth!.sub;
    const now = new Date().toISOString();
    const agent = await storage.updateAgent(gaii, { lastSeen: now });
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', `Agent not found: ${gaii}`));
      return;
    }

    res.json(success(config.nodeId, {
      gaii,
      checked_in: now,
      trust_score: agent.trustScore,
      morsel_balance: agent.morselBalance,
    }));
  });

  // POST /v1/agents/:gaii/export — Export agent data for portability (owner auth)
  router.post('/v1/agents/:gaii/export', requireAuth(), requireRole('owner'), async (req, res) => {
    const gaii = decodeURIComponent(req.params.gaii as string);
    const agent = await storage.getAgent(gaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', `Agent not found: ${gaii}`));
      return;
    }
    if (agent.owner !== req.auth!.owner) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only export your own agents'));
      return;
    }

    const memories = await storage.listMemory(gaii);
    const transactions = await storage.getTransactions(gaii, 100_000);
    const actions = await storage.listActionsByProvider(gaii);
    const trust = await calculateTrustScore(gaii, storage);

    res.json(success(config.nodeId, {
      portability_version: '1.0',
      exported_at: new Date().toISOString(),
      source_node: config.nodeId,
      agent: {
        name: agent.name,
        owner: agent.owner,
        gaii: agent.gaii,
        display_name: agent.displayName,
        description: agent.description,
        capabilities: agent.capabilities,
        public_key: agent.publicKey,
        trust_score: trust.score,
        morsel_balance: agent.morselBalance,
        created_at: agent.createdAt,
      },
      memory: memories.map(m => ({
        key: m.key,
        value: m.value,
        visibility: m.visibility,
        tags: m.tags,
        ttl_hours: m.ttlHours,
        version: m.version,
      })),
      actions: actions.map(a => ({
        id: a.id,
        display_name: a.displayName,
        description: a.description,
        category: a.category,
        input_schema: a.inputSchema,
        output_schema: a.outputSchema,
        pricing: a.pricing,
        tags: a.tags,
      })),
      trust_history: {
        total_deliveries: trust.totalDeliveries,
        successful_deliveries: trust.successfulDeliveries,
        positive_ratings: trust.positiveRatings,
        negative_ratings: trust.negativeRatings,
      },
      transaction_count: transactions.length,
    }, [
      { description: 'Import to another node', method: 'POST', url: '/v1/agents/import' },
    ]));
  });

  // POST /v1/agents/import — Import agent from another node (owner auth)
  router.post('/v1/agents/import', requireAuth(), requireRole('owner'), async (req, res) => {
    const { agent: agentData, memory: memoryData, actions: actionData } = req.body ?? {};

    if (!agentData?.name || !agentData?.owner) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'agent.name and agent.owner are required'));
      return;
    }

    if (agentData.owner !== req.auth!.owner) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only import agents under your own owner identity'));
      return;
    }

    const newGaii = buildGAII(agentData.name, agentData.owner, config.nodeId);
    const existing = await storage.getAgent(newGaii);
    if (existing) {
      res.status(409).json(error(config.nodeId, 'NAME_TAKEN', `Agent "${agentData.name}" already exists on this node`));
      return;
    }

    const keyPair = await generateKeyPair();
    const now = new Date().toISOString();

    // Import with capped trust score (new node starts lower)
    const importedTrust = Math.min(agentData.trust_score ?? 50, 65);

    const agent = await storage.createAgent({
      name: agentData.name,
      owner: agentData.owner,
      gaii: newGaii,
      displayName: agentData.display_name,
      description: agentData.description,
      capabilities: agentData.capabilities ?? [],
      publicKey: keyPair.publicKey,
      trustScore: importedTrust,
      morselBalance: config.welcomeBonus, // fresh balance on new node
      createdAt: now,
      lastSeen: now,
    });

    // Import memories
    let memoriesImported = 0;
    if (Array.isArray(memoryData)) {
      for (const m of memoryData) {
        if (!m.key) continue;
        await storage.setMemory({
          key: m.key,
          ownerGaii: newGaii,
          value: m.value,
          visibility: m.visibility ?? 'private',
          tags: m.tags ?? [],
          ttlHours: m.ttl_hours ?? null,
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
        memoriesImported++;
      }
    }

    // Import actions
    let actionsImported = 0;
    if (Array.isArray(actionData)) {
      for (const a of actionData) {
        if (!a.id || !a.display_name) continue;
        try {
          await storage.createAction({
            id: a.id,
            providerGaii: newGaii,
            displayName: a.display_name,
            description: a.description ?? '',
            category: a.category,
            inputSchema: a.input_schema ?? {},
            outputSchema: a.output_schema ?? {},
            pricing: a.pricing ?? { baseMorsels: 0 },
            tags: a.tags ?? [],
            createdAt: now,
            updatedAt: now,
          });
          actionsImported++;
        } catch { /* skip duplicates */ }
      }
    }

    res.status(201).json(success(config.nodeId, {
      agent: {
        gaii: agent.gaii,
        display_name: agent.displayName,
        trust_score: agent.trustScore,
        morsel_balance: agent.morselBalance,
      },
      imported: {
        memories: memoriesImported,
        actions: actionsImported,
      },
      private_key: keyPair.privateKey,
      public_key: keyPair.publicKey,
      note: 'Agent imported with new keys. Store the private key securely.',
    }));
  });

  return router;
}
