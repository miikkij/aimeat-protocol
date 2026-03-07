import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { generateKeyPair } from '../auth/keypair.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { validateAgentName, buildGAII } from '../utils/gaii.js';
import { calculateTrustScore } from '../services/trust.js';
import { executeHooks } from '../services/hooks.js';
import { AgentRegistrationSchema, validateBody } from '../models/schemas.js';

export function agentsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // POST /v1/agents — register a new agent (requires owner JWT)
  router.post('/v1/agents', requireAuth(), requireRole('owner'), validateBody(AgentRegistrationSchema, config.nodeId), async (req, res) => {
    const { name, owner, display_name, description, capabilities, scopes } = req.body ?? {};

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

    // REQ-006 — Resolve agent scopes
    const requestedScopes: string[] = Array.isArray(scopes) ? scopes : config.defaultAgentScopes;

    // Validate scopes against node maximum
    if (!config.maxAgentScopes.includes('*')) {
      const invalid = requestedScopes.filter(s => {
        if (s === '*') return true; // only operator can have global wildcard
        const [domain] = s.split(':');
        return !config.maxAgentScopes.includes(s) && !config.maxAgentScopes.includes(`${domain}:*`);
      });
      if (invalid.length > 0) {
        res.status(400).json(error(config.nodeId, 'INVALID_SCOPES', `Scopes exceed node maximum: ${invalid.join(', ')}`));
        return;
      }
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
      defaultScopes: requestedScopes,
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

    // SECURITY: Prevent caching of response containing private key
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.status(201).json(success(config.nodeId, {
      agent: {
        gaii: agent.gaii,
        display_name: agent.displayName,
        description: agent.description,
        capabilities: agent.capabilities,
        scopes: agent.defaultScopes,
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
      // Check for redirect pointer (ported agent)
      const redirect = await storage.getMemory(gaii, '__redirect__');
      if (redirect && typeof redirect.value === 'object' && redirect.value !== null && 'target_node_url' in (redirect.value as Record<string, unknown>)) {
        const val = redirect.value as { target_node_url: string; target_node_id?: string; ported_at?: string };
        const location = `${val.target_node_url}/v1/agents/${encodeURIComponent(gaii)}`;
        res.setHeader('Location', location);
        res.status(301).json(success(config.nodeId, {
          ported: true,
          target_node_url: val.target_node_url,
          target_node_id: val.target_node_id,
          ported_at: val.ported_at,
          message: 'Agent has been ported. Follow the Location header.',
        }));
        return;
      }
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
        '@type': 'schema:Rating',
        'schema:ratingValue': trust.score,
        'schema:bestRating': 100,
        'schema:worstRating': 0,
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
      semantic: agent.semantic,
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
        name: a.name,
        display_name: a.displayName,
        description: a.description,
        capabilities: a.capabilities,
        default_scopes: a.defaultScopes ?? ['*'],
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
        semantic: agent.semantic,
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

    // SECURITY: Prevent caching of response containing private key
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
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

  // POST /v1/agents/:gaii/rekey — Rotate agent keys (owner auth)
  router.post('/v1/agents/:gaii/rekey', requireAuth(), requireRole('owner'), async (req, res) => {
    const gaii = decodeURIComponent(req.params.gaii as string);
    const agent = await storage.getAgent(gaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', `Agent not found: ${gaii}`));
      return;
    }
    if (agent.owner !== req.auth!.owner) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only rekey your own agents'));
      return;
    }

    const keyPair = await generateKeyPair();
    await storage.updateAgent(gaii, { publicKey: keyPair.publicKey });

    // Extension hook: agent_rekey (fire-and-forget)
    executeHooks(config, storage, 'agent_rekey', { gaii, owner: agent.owner }).catch(() => { });

    // SECURITY: Prevent caching of response containing private key
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.json(success(config.nodeId, {
      rekeyed: true,
      gaii,
      private_key: keyPair.privateKey,
      public_key: keyPair.publicKey,
      note: 'New keys generated. Store the private key securely. Old JWT tokens are invalidated.',
    }));
  });

  // POST /v1/agents/:gaii/port — Port agent to another node (owner auth)
  // Sets a redirect pointer on this node + deducts porting fee
  router.post('/v1/agents/:gaii/port', requireAuth(), requireRole('owner'), async (req, res) => {
    const gaii = decodeURIComponent(req.params.gaii as string);
    const agent = await storage.getAgent(gaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', `Agent not found: ${gaii}`));
      return;
    }
    if (agent.owner !== req.auth!.owner) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only port your own agents'));
      return;
    }

    const { target_node_url, target_node_id } = req.body ?? {};
    if (!target_node_url) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'target_node_url is required'));
      return;
    }

    // Porting fee — atomic debit prevents double-spending
    const PORTING_FEE = config.agentPortingFeeMorsels;
    const debited = await storage.debitBalance(gaii, PORTING_FEE);
    if (!debited) {
      res.status(402).json(error(config.nodeId, 'INSUFFICIENT_MORSELS',
        `Porting requires ${PORTING_FEE} morsels, you have ${agent.morselBalance}`));
      return;
    }
    await storage.addTransaction({
      id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      gaii,
      type: 'spent',
      amount: -PORTING_FEE,
      timestamp: new Date().toISOString(),
    });

    // Store redirect pointer (use memory to persist the redirect)
    await storage.setMemory({
      key: `__redirect__`,
      ownerGaii: gaii,
      value: { target_node_url, target_node_id: target_node_id ?? 'unknown', ported_at: new Date().toISOString() },
      visibility: 'public',
      tags: ['system', 'redirect'],
      ttlHours: 30 * 24,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    res.json(success(config.nodeId, {
      ported: true,
      gaii,
      target_node_url,
      porting_fee: PORTING_FEE,
      note: 'Redirect pointer set. Export and import agent data to complete the port.',
    }, [
      { description: 'Export agent data', method: 'POST', url: `/v1/agents/${encodeURIComponent(gaii)}/export` },
    ]));
  });

  // PATCH /v1/agents/:name/scopes — update agent scopes (owner only)
  router.patch('/v1/agents/:name/scopes', requireAuth(), requireRole('owner'), async (req, res) => {
    const agentName = req.params.name as string;
    const ownerName = req.auth!.owner;
    const { scopes } = req.body ?? {};

    if (!Array.isArray(scopes) || scopes.length === 0) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'scopes must be a non-empty array of strings'));
      return;
    }

    // Validate all scopes are strings
    if (!scopes.every((s: unknown) => typeof s === 'string')) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Each scope must be a string'));
      return;
    }

    // Validate scopes against node maximum
    if (!config.maxAgentScopes.includes('*')) {
      const invalid = scopes.filter((s: string) => {
        if (s === '*') return true;
        const [domain] = s.split(':');
        return !config.maxAgentScopes.includes(s) && !config.maxAgentScopes.includes(`${domain}:*`);
      });
      if (invalid.length > 0) {
        res.status(400).json(error(config.nodeId, 'INVALID_SCOPES', `Scopes exceed node maximum: ${invalid.join(', ')}`));
        return;
      }
    }

    // Find the agent by name under this owner
    const agents = await storage.getAgentsByOwner(ownerName);
    const agent = agents.find(a => a.name === agentName);

    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent "${agentName}" not found under owner "${ownerName}"`));
      return;
    }

    // Defense-in-depth: verify ownership even though getAgentsByOwner is scoped
    if (agent.owner !== req.auth!.owner) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only modify your own agents'));
      return;
    }

    const updated = await storage.updateAgent(agent.gaii, { defaultScopes: scopes });
    if (!updated) {
      res.status(500).json(error(config.nodeId, 'INTERNAL', 'Failed to update agent scopes'));
      return;
    }

    res.json(success(config.nodeId, {
      gaii: updated.gaii,
      scopes: updated.defaultScopes,
    }, [
      { description: 'Re-authenticate to get a new JWT with updated scopes', method: 'POST', url: '/v1/auth/token' },
    ]));
  });

  // ── CORS per-agent management ──

  // GET /v1/agents/:name/cors — Get agent CORS allowed origins
  router.get('/v1/agents/:name/cors', requireAuth(), requireRole('owner'), async (req, res) => {
    const agentName = req.params.name as string;
    const ownerName = req.auth!.owner;

    const agents = await storage.getAgentsByOwner(ownerName);
    const agent = agents.find(a => a.name === agentName);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent "${agentName}" not found`));
      return;
    }

    // Resolve effective origins: agent → GHII owner → node default
    let effective = config.corsAllowedOrigins;
    let inherited = 'node';
    if (agent.allowedOrigins?.length) {
      effective = agent.allowedOrigins;
      inherited = 'none';
    } else {
      const ghii = await storage.getGHIIByOwner(ownerName);
      if (ghii?.allowedOrigins?.length) {
        effective = ghii.allowedOrigins;
        inherited = 'ghii';
      }
    }

    res.json(success(config.nodeId, {
      gaii: agent.gaii,
      allowed_origins: agent.allowedOrigins ?? null,
      effective,
      inherited_from: inherited,
    }));
  });

  // PUT /v1/agents/:name/cors — Set agent CORS allowed origins
  router.put('/v1/agents/:name/cors', requireAuth(), requireRole('owner'), async (req, res) => {
    const agentName = req.params.name as string;
    const ownerName = req.auth!.owner;

    const agents = await storage.getAgentsByOwner(ownerName);
    const agent = agents.find(a => a.name === agentName);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent "${agentName}" not found`));
      return;
    }

    // Defense-in-depth: verify ownership even though getAgentsByOwner is scoped
    if (agent.owner !== req.auth!.owner) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only modify your own agents'));
      return;
    }

    const { allowed_origins } = req.body ?? {};

    if (allowed_origins !== null && !Array.isArray(allowed_origins)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'allowed_origins must be an array of origin URLs or null to inherit'));
      return;
    }

    if (Array.isArray(allowed_origins)) {
      for (const origin of allowed_origins) {
        if (typeof origin !== 'string' || (origin !== '*' && !/^https?:\/\//.test(origin))) {
          res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `Invalid origin: ${origin}. Must be an http(s) URL or '*'`));
          return;
        }
      }
    }

    const updated = await storage.updateAgent(agent.gaii, {
      allowedOrigins: allowed_origins === null ? undefined : allowed_origins,
    });
    if (!updated) {
      res.status(500).json(error(config.nodeId, 'INTERNAL', 'Failed to update CORS settings'));
      return;
    }

    res.json(success(config.nodeId, {
      gaii: updated.gaii,
      allowed_origins: updated.allowedOrigins ?? null,
    }));
  });

  return router;
}
