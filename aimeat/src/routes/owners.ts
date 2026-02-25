import { Router } from 'express';
import type { MeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { generateKeyPair } from '../auth/keypair.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { validateOwnerName } from '../utils/gaii.js';
import { calculateTrustScore } from '../services/trust.js';
import { executeHooks } from '../services/hooks.js';
import { OwnerRegistrationSchema, validateBody } from '../models/schemas.js';

export function ownersRouter(config: MeatConfig, storage: Storage): Router {
  const router = Router();

  // POST /v1/owners — register a new owner (no auth required)
  router.post('/v1/owners', validateBody(OwnerRegistrationSchema, config.nodeId), async (req, res) => {
    const { name, display_name } = req.body ?? {};

    // Extension hook: pre_owner_registration
    const hookResult = await executeHooks(config, storage, 'pre_owner_registration', { name, display_name });
    if (!hookResult.allowed) {
      res.status(403).json(error(config.nodeId, 'HOOK_REJECTED', hookResult.reason ?? 'Registration denied by extension hook'));
      return;
    }

    const nameError = validateOwnerName(name);
    if (nameError) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', nameError));
      return;
    }

    const existing = await storage.getOwner(name);
    if (existing) {
      res.status(409).json(error(config.nodeId, 'NAME_TAKEN', `Owner name "${name}" is already registered`));
      return;
    }

    const keyPair = await generateKeyPair();

    // Check if this is the first owner — they get operator role
    const allOwners = await storage.listOwners();
    const roles = ['owner'];
    if (allOwners.length === 0) {
      roles.push('operator');
    }

    const owner = await storage.createOwner({
      name,
      displayName: display_name,
      publicKey: keyPair.publicKey,
      roles,
      createdAt: new Date().toISOString(),
    });

    // Extension hook: post_owner_registration (fire-and-forget)
    executeHooks(config, storage, 'post_owner_registration', { name: owner.name, roles: owner.roles }).catch(() => { });

    res.status(201).json(success(config.nodeId, {
      owner: {
        name: owner.name,
        display_name: owner.displayName,
        roles: owner.roles,
        created_at: owner.createdAt,
      },
      private_key: keyPair.privateKey,
      public_key: keyPair.publicKey,
      note: 'Store the private key securely. It cannot be retrieved again. You need it to authenticate and register agents.',
    }, [
      {
        description: 'Authenticate with your owner key to get a JWT',
        method: 'POST',
        url: '/v1/auth/token',
        example_body: {
          owner: name,
          timestamp: new Date().toISOString(),
          signature: 'base64(Ed25519_sign(private_key, owner + node + timestamp))',
        },
      },
      {
        description: 'Register your first agent',
        method: 'POST',
        url: '/v1/agents',
        example_body: {
          name: 'my-agent',
          owner: name,
          display_name: 'My AI Agent',
        },
      },
    ]));
  });

  // GET /v1/owners/:name — public owner profile
  router.get('/v1/owners/:name', async (req, res) => {
    const owner = await storage.getOwner(req.params.name);
    if (!owner) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Owner not found: ${req.params.name}`));
      return;
    }

    const agents = await storage.getAgentsByOwner(owner.name);

    res.json(success(config.nodeId, {
      name: owner.name,
      display_name: owner.displayName,
      agents: agents.map(a => ({
        gaii: a.gaii,
        display_name: a.displayName,
        trust_score: a.trustScore,
      })),
      created_at: owner.createdAt,
    }));
  });

  // GET /v1/owners/:ownerName@:node/trust — owner trust profile (Tier 0)
  router.get('/v1/owners/:ownerName@:node/trust', async (req, res) => {
    const ownerName = (req.params as Record<string, string>).ownerName;
    const owner = await storage.getOwner(ownerName);
    if (!owner) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Owner not found: ${ownerName}`));
      return;
    }

    const agents = await storage.getAgentsByOwner(ownerName);
    let totalDeliveries = 0, successfulDeliveries = 0, totalTrust = 0;
    for (const agent of agents) {
      const trust = await calculateTrustScore(agent.gaii, storage);
      totalDeliveries += trust.totalDeliveries;
      successfulDeliveries += trust.successfulDeliveries;
      totalTrust += trust.score;
    }

    const avgTrust = agents.length > 0 ? Math.round(totalTrust / agents.length) : 50;
    const successRate = totalDeliveries > 0 ? successfulDeliveries / totalDeliveries : 1;
    const ageDays = Math.floor((Date.now() - new Date(owner.createdAt).getTime()) / 86_400_000);

    res.json(success(config.nodeId, {
      owner: ownerName,
      node: (req.params as Record<string, string>).node,
      trust_score: avgTrust,
      agents: agents.length,
      success_rate: Math.round(successRate * 100) / 100,
      total_deliveries: totalDeliveries,
      successful_deliveries: successfulDeliveries,
      age_days: ageDays,
      components: {
        delivery_reliability: Math.round(successRate * 40),
        agent_reputation: Math.min(30, agents.length * 10),
        account_age: Math.min(20, ageDays),
        dispute_history: 10,
      },
    }));
  });

  // GET /v1/owners/:name/export — GDPR data export (owner auth)
  router.get('/v1/owners/:name/export', requireAuth(), async (req, res) => {
    const name = req.params.name as string;
    if (req.auth!.owner !== name && !req.auth!.roles.includes('operator')) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only export your own data'));
      return;
    }

    const owner = await storage.getOwner(name);
    if (!owner) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Owner not found: ${name}`));
      return;
    }

    const agents = await storage.getAgentsByOwner(name);
    const agentData = [];

    for (const agent of agents) {
      const memories = await storage.listMemory(agent.gaii);
      const providerWork = await storage.listWorkByProvider(agent.gaii);
      const requesterWork = await storage.listWorkByRequester(agent.gaii);
      const transactions = await storage.getTransactions(agent.gaii, 10000);
      const trust = await calculateTrustScore(agent.gaii, storage);

      agentData.push({
        gaii: agent.gaii,
        display_name: agent.displayName,
        description: agent.description,
        capabilities: agent.capabilities,
        trust,
        morsel_balance: agent.morselBalance,
        created_at: agent.createdAt,
        memories: memories.map(m => ({ key: m.key, value: m.value, visibility: m.visibility, tags: m.tags })),
        work_provided: providerWork.length,
        work_requested: requesterWork.length,
        transactions: transactions.length,
      });
    }

    res.json(success(config.nodeId, {
      owner: {
        name: owner.name,
        display_name: owner.displayName,
        roles: owner.roles,
        created_at: owner.createdAt,
      },
      agents: agentData,
      exported_at: new Date().toISOString(),
    }));
  });

  // DELETE /v1/owners/:name — GDPR delete (cascade) (owner auth)
  router.delete('/v1/owners/:name', requireAuth(), async (req, res) => {
    const name = req.params.name as string;
    if (req.auth!.owner !== name && !req.auth!.roles.includes('operator')) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only delete your own account'));
      return;
    }

    const owner = await storage.getOwner(name);
    if (!owner) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Owner not found: ${name}`));
      return;
    }

    // Cascade delete: agents, memories, actions, transactions
    const agents = await storage.getAgentsByOwner(name);
    for (const agent of agents) {
      // Cancel in-flight work and return escrow
      const providerWork = await storage.listWorkByProvider(agent.gaii);
      const requesterWork = await storage.listWorkByRequester(agent.gaii);
      for (const w of [...providerWork, ...requesterWork]) {
        if (['pending', 'accepted', 'in_progress'].includes(w.status)) {
          await storage.updateWork(w.trackingCode, { status: 'cancelled', updatedAt: new Date().toISOString() });
          // Return escrow to requester
          if (w.cost.inEscrow > 0) {
            const requester = await storage.getAgent(w.requesterGaii);
            if (requester) {
              await storage.updateAgent(w.requesterGaii, { morselBalance: requester.morselBalance + w.cost.total });
            }
          }
        }
      }

      await storage.deleteAllMemory(agent.gaii);
      await storage.deleteActionsByProvider(agent.gaii);
      await storage.deleteTransactions(agent.gaii);
      await storage.deleteAgent(agent.gaii);
    }

    await storage.deleteOwner(name);

    res.json(success(config.nodeId, {
      deleted: true,
      owner: name,
      agents_deleted: agents.length,
    }));
  });

  // POST /v1/owners/:name/recover — Owner key recovery (operator-assisted)
  router.post('/v1/owners/:name/recover', requireAuth(), requireRole('operator'), async (req, res) => {
    const name = req.params.name as string;
    const owner = await storage.getOwner(name);
    if (!owner) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Owner not found: ${name}`));
      return;
    }

    // Generate new keypair for the owner
    const keyPair = await generateKeyPair();
    await storage.updateOwner(name, { publicKey: keyPair.publicKey });

    // Extension hook: owner_recovery (fire-and-forget)
    executeHooks(config, storage, 'owner_recovery', { owner: name }).catch(() => { });

    res.json(success(config.nodeId, {
      recovered: true,
      owner: name,
      private_key: keyPair.privateKey,
      public_key: keyPair.publicKey,
      note: 'New keys generated. Store the private key securely. Old keys are invalidated.',
    }));
  });

  return router;
}
