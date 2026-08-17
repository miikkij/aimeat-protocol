/**
 * @file src/routes/owners.ts
 * @description Owner (GHII human account) routes — registration of new owners with keypair
 *   generation, first-owner operator bootstrap, pre-registration extension hooks, and owner
 *   profile/trust surfacing.
 *
 * @structure
 *   - ownersRouter(config, storage): builds the owners router
 *   - POST /v1/owners: validates name, runs pre_owner_registration hook, creates owner + keypair
 *
 * @version-history
 *   v1.5.0 — 2026-08-18 — Registration-mode gate (open|invite|closed): POST /v1/owners is a direct door, 403 REGISTRATION_CLOSED when the node is invite-only or closed.
 *   v1.4.0 — 2026-08-17 — Writes the account_created row at account creation, for the same reason
 *     v1.2.0 writes the track marker: an account made through this door opened on an empty feed,
 *     because only POST /v1/ghii recorded it.
 *   v1.3.0 — 2026-08-11 — Security audit H-1/H-7: DELETE /v1/owners/:name is behind
 *     requireOwnerPrincipal(). Its own check answers "is this a DIFFERENT owner", which every one
 *     of the owner's machine principals passes, because req.auth.owner holds the human's account
 *     name on an agent, ecosystem and app-grant token alike.
 *   v1.2.0 — 2026-08-07 — Writes onboarding.track at account creation (remake phase 0) so the
 *     programmatic door produces the same cohort marker as POST /v1/ghii.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 *   v1.1.0 — 2026-07-16 — GDPR export hoists owner-invariant reads out of the per-agent loop
 *     (boards+posts+flags loaded once; per-agent getGHIIByOwner re-fetch dropped) — was O(agents×boards)
 */
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { generateKeyPair } from '../auth/keypair.js';
import { requireAuth, requireOwnerPrincipal, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { validateOwnerName } from '../utils/gaii.js';
import { calculateTrustScore } from '../services/trust.js';
import { executeHooks } from '../services/hooks.js';
import { fireHook } from '../utils/fire-hook.js';
import { OwnerRegistrationSchema, validateBody } from '../models/schemas.js';
import { registrationRefusal } from '../services/owner-provisioning.js';
import { emitChange } from '../services/event-bus.js';
import { eraseOwner } from '../services/owner-erasure.js';
import { logger } from '../utils/logger.js';
import { registerOwnerExportRoute } from './owners/export.js';

export function ownersRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // POST /v1/owners — register a new owner (no auth required)
  router.post('/v1/owners', validateBody(OwnerRegistrationSchema, config.nodeId), async (req, res) => {
    const { name, display_name } = req.body ?? {};

    // Registration mode: this is a direct door, refused in 'invite' and 'closed'.
    const modeRefusal = registrationRefusal(config, 'direct');
    if (modeRefusal) {
      res.status(403).json(error(config.nodeId, 'REGISTRATION_CLOSED', modeRefusal));
      return;
    }

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

    // Check if this is the first real owner — they get operator role
    // Skip the "anonymous" system owner when counting
    const allOwners = await storage.listOwners();
    const realOwners = allOwners.filter(o => o.name !== 'anonymous');
    const roles = ['owner'];
    if (realOwners.length === 0) {
      roles.push('operator');
    }

    const owner = await storage.createOwner({
      name,
      displayName: display_name,
      publicKey: keyPair.publicKey,
      roles,
      createdAt: new Date().toISOString(),
    });

    // Auto-create GHII record for single-balance economy (welcome bonus on GHII)
    const ghii = `${name}@${config.nodeId}`;
    const existingGhii = await storage.getGHIIByOwner(name);
    if (!existingGhii) {
      const now = new Date().toISOString();
      await storage.createGHII({
        ghii,
        username: name,
        nodeId: config.nodeId,
        displayName: display_name ?? name,
        ownerName: name,
        bio: '',
        avatar: '',
        locale: 'en',
        verificationLevel: 0,
        totpEnabled: false,
        morselBalance: config.welcomeBonus,
        createdAt: now,
        updatedAt: now,
      });
      // Record welcome bonus transaction
      await storage.addTransaction({
        id: `tx-${randomUUID()}`,
        gaii: ghii,
        type: 'welcome_bonus',
        amount: config.welcomeBonus,
        timestamp: now,
      });
    }

    // Which onboarding path this account was created on (05-mittaus.md). BOTH creation doors write
    // it — an account created through this programmatic one and left untracked would be missing
    // from every cohort rather than counted in the wrong one, which is the harder bug to notice.
    void import('../services/onboarding-funnel.js')
      .then(m => m.recordTrack(storage, config, owner.name))
      .catch(err => logger.warn('owners register: track marker failed', { error: String(err) }));

    // The first row in this person's record. BOTH creation doors write it, for the same reason the
    // track marker above is on both: an account created through this programmatic door would open
    // on an empty feed, which reads as broken rather than as new. Fire-and-forget — a feed row must
    // never be able to fail a registration.
    void import('../services/account-events.js')
      .then(m => m.recordAccountEvent(storage, {
        ownerGhii: ghii, kind: 'account_created', actorGaii: ghii, link: '/v1/home',
      }, config))
      .catch(err => logger.warn('owners register: first feed row failed', { error: String(err) }));

    // The operator's welcome into the new mailbox. Same fire-and-forget contract as above.
    void import('../services/welcome-message.js')
      .then(m => m.sendOperatorWelcome(storage, config, owner.name))
      .catch(err => logger.warn('owners register: welcome message failed', { error: String(err) }));

    // Extension hook: post_owner_registration (fire-and-forget)
    fireHook(config, storage, 'post_owner_registration', { name: owner.name, roles: owner.roles });

    // SECURITY: Prevent caching of response containing private key
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.status(201).json(success(config.nodeId, {
      owner: {
        name: owner.name,
        display_name: owner.displayName,
        roles: owner.roles,
        created_at: owner.createdAt,
      },
      private_key: keyPair.privateKey,
      public_key: keyPair.publicKey,
      note: 'SECURITY: Store the private key securely. It cannot be retrieved again. Consider client-side key generation for enhanced security.',
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
    emitChange('owners');
  });

  // GET /v1/owners/:name — public owner profile. The AGENT ROSTER (GAIIs) and ROLES (which would
  // disclose who the operators are) are NOT public — only the owner themselves (a real signed-in
  // principal) or an operator sees them; the shared anonymous identity and other users get the
  // minimal public card.
  router.get('/v1/owners/:name', async (req, res) => {
    const owner = await storage.getOwner(req.params.name);
    if (!owner) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Owner not found: ${req.params.name}`));
      return;
    }

    const isSelf = !!req.auth && !req.auth.anonymous && req.auth.owner === owner.name;
    const isOperator = !!req.auth && !req.auth.anonymous && req.auth.roles?.includes('operator');
    const privileged = isSelf || isOperator;
    const agents = privileged ? await storage.getAgentsByOwner(owner.name) : [];

    res.json(success(config.nodeId, {
      name: owner.name,
      display_name: owner.displayName,
      created_at: owner.createdAt,
      ...(privileged ? {
        roles: owner.roles,
        agents: agents.map(a => ({ gaii: a.gaii, display_name: a.displayName, trust_score: a.trustScore })),
      } : {}),
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

  // GDPR export lives in its own file (max-file-lines); mounted here so the route table is
  // still one list.
  registerOwnerExportRoute(router, config, storage);

  // DELETE /v1/owners/:name — GDPR delete (cascade) (account holder or operator)
  // The check below says which ACCOUNT may be erased; requireOwnerPrincipal says which of that
  // account's principals may ask. Erasing everything the person owns is the person's decision.
  router.delete('/v1/owners/:name', requireAuth(), requireOwnerPrincipal(), async (req, res) => {
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

    // The whole erasure lives in one service function, in one transaction, so a failure between
    // steps cannot leave the account half-deleted and a second door can reach it. GAP-001.
    const { agentsDeleted, deletionLog } = await eraseOwner(storage, config.nodeId, name);

    res.json(success(config.nodeId, {
      deleted: true,
      owner: name,
      agents_deleted: agentsDeleted,
      deletion_log: deletionLog,
    }));
    emitChange('owners');
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
    fireHook(config, storage, 'owner_recovery', { owner: name });

    res.json(success(config.nodeId, {
      recovered: true,
      owner: name,
      private_key: keyPair.privateKey,
      public_key: keyPair.publicKey,
      note: 'New keys generated. Store the private key securely. Old keys are invalidated.',
    }));
    emitChange('owners');
  });

  return router;
}
