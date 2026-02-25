import { Router } from 'express';
import type { MeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { generateKeyPair } from '../auth/keypair.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { validateAgentName, buildGAII, parseGAII } from '../utils/gaii.js';
import { calculateTrustScore } from '../services/trust.js';

export function agentsRouter(config: MeatConfig, storage: Storage): Router {
  const router = Router();

  // POST /v1/agents — register a new agent (requires owner JWT)
  router.post('/v1/agents', requireAuth(), requireRole('owner'), async (req, res) => {
    const { name, owner, display_name, description, capabilities } = req.body ?? {};

    if (!name || !owner) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'name and owner are required'));
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

  return router;
}
