/**
 * @file src/routes/agents/registration.ts
 * @description Agent registration routes (connectivity-key connect, owner-authed create, pending list, consent HTML page). Extracted from agents.ts to satisfy max-file-lines.
 * @version-history
 *   v1.2.0 — 2026-08-13 — The created agent records `registeredBy`: this door is owner-only, so it
 *     is the owner's own name.
 *   v1.0.0 — 2026-07-13 — Extracted from agents.ts (max-file-lines)
 *   v1.1.0 — 2026-08-08 — The pending device-auth listing carries `existing_agent` +
 *     `current_scopes`, so the consent card can tell an agent coming BACK from a first approval.
 *     It preselected "Standard" either way, which narrowed a full-access agent every time its
 *     token expired — on a click that meant "yes, this is my agent". Owner-authenticated, so the
 *     scopes are the owner's own to see; the unauthenticated consent-page endpoint gets only the
 *     boolean. Covered by test/e2e-agent-reapproval.ts.
 */
import type { Router } from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { generateKeyPair } from '../../auth/keypair.js';
import { requireAuth, requireRole, requireLocalSession } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { validateAgentName, buildGAII } from '../../utils/gaii.js';
import { executeHooks } from '../../services/hooks.js';
import { fireHook } from '../../utils/fire-hook.js';
import { AgentRegistrationSchema, validateBody } from '../../models/schemas.js';
import { emitChange } from '../../services/event-bus.js';
import { createDefaultSteps } from '../../models/agent-onboarding-schemas.js';
import { detectPlatform } from '../../services/platform-detector.js';
import { VALID_MODES } from './constants.js';

export function registerRegistrationRoutes(
  router: Router, config: AimeatConfig, storage: Storage, dirnameAgents: string,
): void {
  // POST /v1/agents/connect — register an agent via connectivity key (no auth required)
  router.post('/v1/agents/connect', async (req, res) => {
    const { connectivity_key, agent_name, display_name } = req.body ?? {};

    if (!connectivity_key) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'connectivity_key is required'));
      return;
    }

    const otk = await storage.consumeOtk(connectivity_key, config.otkGraceMs);
    if (!otk || otk.action !== 'register_agent') {
      res.status(404).json(error(config.nodeId, 'INVALID_KEY', 'Connectivity key not found, already used, or invalid'));
      return;
    }

    const owner = otk.params.owner as string;
    const finalName = agent_name ?? (otk.params.agent_name as string | null);

    if (!finalName) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'agent_name is required (either in the connectivity key or in the request body)'));
      return;
    }

    const nameError = validateAgentName(finalName);
    if (nameError) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', nameError));
      return;
    }

    const ownerRecord = await storage.getOwner(owner);
    if (!ownerRecord) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Owner "${owner}" not found`));
      return;
    }

    const gaii = buildGAII(finalName, owner, config.nodeId);

    const existing = await storage.getAgent(gaii);
    if (existing) {
      res.status(409).json(error(config.nodeId, 'NAME_TAKEN', `Agent "${finalName}" already exists under owner "${owner}"`));
      return;
    }

    const keyPair = await generateKeyPair();
    const now = new Date().toISOString();
    const description = (otk.params.description as string | null) ?? undefined;
    const requestedScopes = config.defaultAgentScopes;

    await storage.createAgent({
      name: finalName,
      owner,
      gaii,
      displayName: display_name ?? finalName,
      description,
      capabilities: [],
      defaultScopes: requestedScopes,
      publicKey: keyPair.publicKey,
      trustScore: 50,
      morselBalance: 0,
      createdAt: now,
      lastSeen: now,
    });

    fireHook(config, storage, 'post_agent_registration', { gaii, owner });

    // Auto-start Hello Integration onboarding
    const connectSteps = createDefaultSteps();
    connectSteps[0].status = 'passed';
    connectSteps[0].validatedAt = now;
    connectSteps[0].validationMethod = 'automatic';
    connectSteps[0].details = { createdAt: now };

    const connectDetected = detectPlatform(req.headers['user-agent'] as string | undefined);
    if (connectDetected) {
      connectSteps[1].status = 'passed';
      connectSteps[1].validatedAt = now;
      connectSteps[1].validationMethod = 'automatic';
      connectSteps[1].details = { platform: connectDetected.id, version: connectDetected.version };
      await storage.updateAgent(gaii, {
        platform: connectDetected.id,
        platformVersion: connectDetected.version,
        platformDetectedBy: connectDetected.detectedBy,
      });
    }

    await storage.createOnboarding({
      agentGaii: gaii,
      status: 'in_progress',
      startedAt: now,
      steps: connectSteps,
      detectedPlatform: connectDetected?.id,
    });
    emitChange('agent-onboarding');

    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.status(201).json(success(config.nodeId, {
      agent: {
        gaii,
        display_name: display_name ?? finalName,
        description,
        scopes: requestedScopes,
      },
      private_key: keyPair.privateKey,
      public_key: keyPair.publicKey,
    }, [
      {
        description: 'Authenticate as this agent to get a JWT',
        method: 'POST',
        url: '/v1/auth/token',
      },
    ]));
    emitChange('agents');
  });

  // POST /v1/agents — register a new agent (requires owner JWT, local session only)
  router.post('/v1/agents', requireAuth(), requireLocalSession(), requireRole('owner'), validateBody(AgentRegistrationSchema, config.nodeId), async (req, res) => {
    const { name, owner, display_name, description, capabilities, scopes, mode } = req.body ?? {};

    if (mode !== undefined && !VALID_MODES.includes(mode)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        `mode must be one of: ${VALID_MODES.join(', ')}`));
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
        res.status(400).json(error(config.nodeId, 'INVALID_SCOPES', `Your assistant asked for more than this node allows. Choose fewer permissions, or ask whoever runs this node.`));
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
      morselBalance: 0,
      createdAt: now,
      lastSeen: now,
      mode: mode ?? 'interactive',
      // This door is owner-only (requireRole('owner') + requireLocalSession), so the person asked
      // for it themselves. Same field the device-authorization path writes; see AgentRecord.
      registeredBy: req.auth!.owner,
    });

    // Extension hook: post_agent_registration (fire-and-forget)
    fireHook(config, storage, 'post_agent_registration', { gaii: agent.gaii, owner: agent.owner });

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
    emitChange('agents');

    // ── Auto-start Hello Integration onboarding (direct registration path) ──
    const regOnboardingSteps = createDefaultSteps();
    regOnboardingSteps[0].status = 'passed';
    regOnboardingSteps[0].validatedAt = now;
    regOnboardingSteps[0].validationMethod = 'automatic';
    regOnboardingSteps[0].details = { createdAt: now };

    const regDetected = detectPlatform(req.headers['user-agent'] as string | undefined);
    if (regDetected) {
      regOnboardingSteps[1].status = 'passed';
      regOnboardingSteps[1].validatedAt = now;
      regOnboardingSteps[1].validationMethod = 'automatic';
      regOnboardingSteps[1].details = { platform: regDetected.id, version: regDetected.version };
      await storage.updateAgent(gaii, {
        platform: regDetected.id,
        platformVersion: regDetected.version,
        platformDetectedBy: regDetected.detectedBy,
      });
    }

    await storage.createOnboarding({
      agentGaii: gaii,
      status: 'in_progress',
      startedAt: now,
      steps: regOnboardingSteps,
      detectedPlatform: regDetected?.id,
    });
    emitChange('agent-onboarding');
  });

  // GET /v1/agents/device-authorize/pending — list pending device auth requests for the logged-in owner
  router.get('/v1/agents/device-authorize/pending', requireAuth(), requireRole('owner'), async (req, res) => {
    const pending = await storage.listPendingDeviceAuthByOwner(req.auth!.owner);
    // Which of these are agents coming BACK. The consent card preselected "Standard" regardless, so
    // re-approving a full-access agent after its token expired narrowed it on a click that meant
    // "yes, this is mine". The owner is entitled to see their own agent's scopes (the Agents tab
    // shows them), so this authenticated listing carries them and the card can offer to keep them.
    const existing = await Promise.all(pending.map(r =>
      storage.getAgent(buildGAII(r.agentName, req.auth!.owner, config.nodeId))));
    res.json(success(config.nodeId, {
      requests: pending.map((r, i) => ({
        user_code: r.userCode,
        agent_name: r.agentName,
        display_name: r.displayName,
        description: r.description,
        status: r.status,
        existing_agent: !!existing[i],
        current_scopes: existing[i]?.defaultScopes ?? null,
        created_at: r.createdAt,
        expires_in: Math.max(0, Math.ceil((new Date(r.expiresAt).getTime() - Date.now()) / 1000)),
      })),
    }));
  });

  // GET /v1/agents/verify — device authorization consent page (must be BEFORE :gaii catch-all)
  router.get('/v1/agents/verify', (_req, res) => {
    const candidates = [
      join(dirnameAgents, '..', '..', 'public', 'agent-consent.html'),      // dev: src/routes/../../public
      join(dirnameAgents, '..', '..', '..', 'public', 'agent-consent.html'), // dist: dist/src/routes/../../../public
    ];
    const htmlPath = candidates.find(p => existsSync(p));
    if (htmlPath) {
      let html = readFileSync(htmlPath, 'utf-8');
      const nonce = res.locals.cspNonce as string || '';
      if (nonce) {
        html = html.replace(/<script(?=[ >])/g, `<script nonce="${nonce}"`);
        html = html.replace(/<style(?=[ >])/g, `<style nonce="${nonce}"`);
      }
      res.type('text/html').send(html);
    } else {
      res.status(404).type('text/plain').send('Agent consent page not found');
    }
  });
}
