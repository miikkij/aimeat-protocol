/**
 * @file agents.ts
 * @description Agent registration, device authorization, public profiles,
 *   owner-managed metadata, heartbeat, portability, and import/export routes.
 * @structure
 *   - agentsRouter() -- Express router for agent identity and lifecycle APIs
 *   - RFC 8628 device authorization endpoints
 *   - Agent listing/profile/tag metadata endpoints
 * @usage
 *   app.use(agentsRouter(config, storage));
 * @version-history
 *   v1.0.0 -- 2026-03-15 -- Initial agent routes
 *   v1.1.0 -- 2026-05-28 -- Expose owner-managed shared-memory tags
 */
import { Router } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname_agents = dirname(fileURLToPath(import.meta.url));
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { generateKeyPair } from '../auth/keypair.js';
import { requireAuth, requireRole, requireLocalSession } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { validateAgentName, buildGAII, generateUserCode } from '../utils/gaii.js';
import { calculateTrustScore } from '../services/trust.js';
import { executeHooks } from '../services/hooks.js';
import { fireHook } from '../utils/fire-hook.js';
import { AgentRegistrationSchema, validateBody } from '../models/schemas.js';
import { verifyJWT, issueJWT, generateSessionId } from '../auth/jwt.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { emitChange } from '../services/event-bus.js';
import { createDefaultSteps } from '../models/agent-onboarding-schemas.js';
import { detectPlatform } from '../services/platform-detector.js';

/** Device authorization code expires after 30 minutes */
const DEVICE_AUTH_EXPIRY_MS = 1_800_000;

const VALID_MODES = ['autonomous', 'interactive', 'task-runner', 'coordinator'] as const;

export function agentsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // POST /v1/agents/device-authorize — start device authorization flow (RFC 8628)
  router.post('/v1/agents/device-authorize', async (req, res) => {
    const { agent_name, display_name, description, owner, mode } = req.body ?? {};

    if (!owner) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'owner is required'));
      return;
    }
    if (!agent_name) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'agent_name is required'));
      return;
    }
    if (mode !== undefined && !VALID_MODES.includes(mode)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        `mode must be one of: ${VALID_MODES.join(', ')}`));
      return;
    }

    const nameError = validateAgentName(agent_name);
    if (nameError) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', nameError));
      return;
    }

    // Rate limit: max 10 pending per owner name
    const pendingCount = await storage.countPendingDeviceAuthByOwner(owner);
    if (pendingCount >= 10) {
      res.status(429).json(error(config.nodeId, 'RATE_LIMITED', 'Too many pending authorization requests for this owner'));
      return;
    }

    // Cleanup expired requests lazily
    await storage.cleanupExpiredDeviceAuth();

    // Generate codes
    const deviceCode = randomBytes(32).toString('hex');
    let userCode = generateUserCode();

    // Ensure user code uniqueness
    let attempts = 0;
    while (await storage.getDeviceAuthByUserCode(userCode) && attempts < 10) {
      userCode = generateUserCode();
      attempts++;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + DEVICE_AUTH_EXPIRY_MS);

    await storage.createDeviceAuth({
      deviceCode,
      userCode,
      ownerName: owner,
      agentName: agent_name,
      displayName: display_name,
      description,
      status: 'pending',
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      pollInterval: 5,
      mode: mode ?? 'interactive',
    });

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const verificationUri = `${baseUrl}/v1/agents/verify`;
    const verificationUriComplete = `${baseUrl}/v1/agents/verify?code=${userCode}`;

    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.json(success(config.nodeId, {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: verificationUri,
      verification_uri_complete: verificationUriComplete,
      expires_in: 1800,
      interval: 5,
      user_instructions: `Tell your owner to approve this request. They can find it in their AIMEAT profile under Agents (${baseUrl}/v1/profile -> Agents tab). The verification code is: ${userCode}. Once approved, poll POST /v1/agents/device-token with { "device_code": "${deviceCode}", "grant_type": "urn:ietf:params:oauth:grant-type:device_code" } every 5 seconds until you receive your token.`,
    }, [
      { description: 'Owner approves in AIMEAT profile -> Agents tab', method: 'GET', url: `${baseUrl}/v1/profile` },
      { description: 'Poll for authorization result', method: 'POST', url: '/v1/agents/device-token' },
    ]));
    emitChange('agents');
  });

  // POST /v1/agents/device-token — poll for device authorization result (RFC 8628)
  router.post('/v1/agents/device-token', async (req, res) => {
    const { device_code, grant_type } = req.body ?? {};

    if (grant_type !== 'urn:ietf:params:oauth:grant-type:device_code') {
      res.status(400).json({ error: 'unsupported_grant_type', error_description: 'Only device_code grant type is supported.' });
      return;
    }
    if (!device_code) {
      res.status(400).json({ error: 'invalid_request', error_description: 'device_code is required.' });
      return;
    }

    const request = await storage.getDeviceAuthByDeviceCode(device_code);
    if (!request) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'Unknown device code.' });
      return;
    }

    // Check expiry
    if (new Date(request.expiresAt) <= new Date()) {
      if (request.status === 'pending') {
        await storage.updateDeviceAuth(device_code, { status: 'expired' });
      }
      res.status(400).json({ error: 'expired_token', error_description: 'This authorization request has expired.' });
      return;
    }

    // Rate limiting: enforce poll interval
    if (request.lastPolledAt) {
      const elapsed = Date.now() - new Date(request.lastPolledAt).getTime();
      if (elapsed < request.pollInterval * 1000) {
        // Increase interval by 5s on slow_down
        await storage.updateDeviceAuth(device_code, {
          pollInterval: request.pollInterval + 5,
          lastPolledAt: new Date().toISOString(),
        });
        res.status(400).json({ error: 'slow_down', error_description: `Polling too frequently. Wait ${request.pollInterval + 5} seconds between requests.` });
        return;
      }
    }

    // Update last polled time
    await storage.updateDeviceAuth(device_code, { lastPolledAt: new Date().toISOString() });

    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');

    switch (request.status) {
      case 'pending':
        res.status(400).json({ error: 'authorization_pending', error_description: 'The user has not yet approved this request.' });
        return;

      case 'denied':
        res.status(400).json({ error: 'access_denied', error_description: 'The user denied this authorization request.' });
        return;

      case 'approved': {
        if (!request.agentCredentials) {
          // Credentials already consumed
          res.status(400).json({ error: 'expired_token', error_description: 'Credentials have already been retrieved.' });
          return;
        }
        // Return credentials and immediately clear them
        const creds = request.agentCredentials;
        await storage.updateDeviceAuth(device_code, { agentCredentials: null as any });

        const baseUrl = config.baseUrl;
        const agentName = request.agentName;
        res.json({
          access_token: creds.token,
          token: creds.token,
          token_type: 'Bearer',
          gaii: creds.gaii,
          name: agentName,
          owner: request.ownerName,
          expires_at: creds.expires_at,
          privateKey: creds.privateKey,
          publicKey: creds.publicKey,
          scopes: request.scopes,
          morselBalance: 0,
          next_steps: {
            message: 'Authentication successful. Next steps below.',
            step_1_skill_bundle: {
              action: 'Fetch your configuration and API reference. Read SKILL.md for your role on this node.',
              method: 'GET',
              url: `${baseUrl}/v1/agents/${agentName}/skill-bundle`,
              auth: 'Authorization: Bearer <your token from above>',
            },
            step_2_handbook: {
              action: 'Fetch additional operating context for this node.',
              method: 'GET',
              url: `${baseUrl}/v1/agents/me/handbook`,
              auth: 'Authorization: Bearer <your token from above>',
            },
            step_3_onboarding: {
              action: 'Check for pending requests from your owner.',
              method: 'GET',
              url: `${baseUrl}/v1/agents/${agentName}/onboarding`,
              auth: 'Authorization: Bearer <your token from above>',
            },
          },
        });
        return;
      }

      default:
        res.status(400).json({ error: 'expired_token', error_description: 'This authorization request has expired.' });
    }
  });

  // GET /v1/agents/verify/info/:userCode — device auth request details for consent page
  // Rate limited by IP (10/min) to prevent user code enumeration per spec
  router.get('/v1/agents/verify/info/:userCode', rateLimit({ max: 10, windowMs: 60_000 }), async (req, res) => {
    const userCode = (req.params.userCode as string).toUpperCase();

    const request = await storage.getDeviceAuthByUserCode(userCode);
    if (!request || new Date(request.expiresAt) <= new Date()) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Authorization request not found or expired'));
      return;
    }

    const remainingMs = new Date(request.expiresAt).getTime() - Date.now();

    res.json(success(config.nodeId, {
      user_code: request.userCode,
      agent_name: request.agentName,
      display_name: request.displayName,
      description: request.description,
      owner: request.ownerName,
      status: request.status,
      expires_in: Math.ceil(remainingMs / 1000),
    }));
  });

  // POST /v1/agents/verify — consent form submission (approve/deny)
  router.post('/v1/agents/verify', async (req, res) => {
    const { user_code, action, scopes, owner_token } = req.body ?? {};

    if (!user_code || !action || !owner_token) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'user_code, action, and owner_token are required'));
      return;
    }

    // Verify owner JWT
    const ownerPayload = await verifyJWT(owner_token);
    if (!ownerPayload || !ownerPayload.roles?.includes('owner')) {
      res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Invalid or expired owner token'));
      return;
    }

    const request = await storage.getDeviceAuthByUserCode(user_code);
    if (!request) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Authorization request not found'));
      return;
    }

    if (request.status !== 'pending') {
      res.status(409).json(error(config.nodeId, 'ALREADY_PROCESSED', `This request has already been ${request.status}`));
      return;
    }

    if (new Date(request.expiresAt) <= new Date()) {
      await storage.updateDeviceAuth(request.deviceCode, { status: 'expired' });
      res.status(410).json(error(config.nodeId, 'EXPIRED', 'This authorization request has expired'));
      return;
    }

    // Verify owner matches
    if (ownerPayload.owner !== request.ownerName) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only approve requests for your own account'));
      return;
    }

    if (action === 'deny') {
      await storage.updateDeviceAuth(request.deviceCode, { status: 'denied' });
      res.json(success(config.nodeId, { status: 'denied' }));
      emitChange('agents');
      return;
    }

    if (action !== 'approve') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'action must be "approve" or "deny"'));
      return;
    }

    // === APPROVE FLOW ===

    // Validate scopes against config.maxAgentScopes (same pattern as POST /v1/agents)
    const finalScopes = scopes ?? config.defaultAgentScopes;
    if (!config.maxAgentScopes.includes('*')) {
      const invalid = finalScopes.filter((s: string) => {
        if (s === '*') return true; // only operator can have global wildcard
        const [domain] = s.split(':');
        return !config.maxAgentScopes.includes(s) && !config.maxAgentScopes.includes(`${domain}:*`);
      });
      if (invalid.length > 0) {
        res.status(400).json(error(config.nodeId, 'INVALID_SCOPES', `Scopes exceed node maximum: ${invalid.join(', ')}`));
        return;
      }
    }

    // Pre-registration hook
    const hookResult = await executeHooks(config, storage, 'pre_agent_registration', {
      name: request.agentName,
      owner: request.ownerName,
      display_name: request.displayName,
    });
    if (!hookResult.allowed) {
      res.status(403).json(error(config.nodeId, 'HOOK_REJECTED', hookResult.reason ?? 'Agent registration denied by extension hook'));
      return;
    }

    // Check if agent already exists — if so, issue new JWT for existing agent
    const gaii = buildGAII(request.agentName, request.ownerName, config.nodeId);
    const existing = await storage.getAgent(gaii);
    let keyPair: { privateKey: string; publicKey: string };
    const now = new Date().toISOString();

    if (existing) {
      // Existing agent: generate new keypair (rotate keys) and issue JWT
      keyPair = await generateKeyPair();
      await storage.updateAgent(gaii, {
        publicKey: keyPair.publicKey,
        defaultScopes: finalScopes,
        lastSeen: now,
      });
    } else {
      // New agent: create from scratch
      keyPair = await generateKeyPair();

      await storage.createAgent({
        name: request.agentName,
        owner: request.ownerName,
        gaii,
        displayName: request.displayName ?? request.agentName,
        description: request.description,
        capabilities: [],
        defaultScopes: finalScopes,
        publicKey: keyPair.publicKey,
        trustScore: 50,
        morselBalance: 0,
        createdAt: now,
        lastSeen: now,
        mode: request.mode ?? 'interactive',
      });

      // Post-registration hook
      fireHook(config, storage, 'post_agent_registration', { gaii, owner: request.ownerName });
    }

    // Issue long-lived JWT for the agent
    const sessionId = generateSessionId();
    const agentJwt = await issueJWT({
      sub: gaii,
      owner: request.ownerName,
      node: config.nodeId,
      roles: ['agent'],
      scopes: finalScopes,
    }, config.agentJwtTtlSeconds, sessionId);

    const expiresAt = new Date(Date.now() + config.agentJwtTtlSeconds * 1000).toISOString();

    // Store credentials + JWT for agent to poll
    await storage.updateDeviceAuth(request.deviceCode, {
      status: 'approved',
      scopes: finalScopes,
      approvedBy: ownerPayload.owner,
      agentCredentials: {
        gaii,
        privateKey: keyPair.privateKey,
        publicKey: keyPair.publicKey,
        token: agentJwt,
        expires_at: expiresAt,
      },
    });

    res.json(success(config.nodeId, {
      status: 'approved',
      gaii,
      agent_name: request.agentName,
      existing_agent: !!existing,
    }));
    emitChange('agents');

    // ── Auto-start Hello Integration onboarding ──
    const onboardingSteps = createDefaultSteps(request.mode ?? 'interactive');
    onboardingSteps[0].status = 'passed';
    onboardingSteps[0].validatedAt = now;
    onboardingSteps[0].validationMethod = 'automatic';
    onboardingSteps[0].details = { createdAt: existing?.createdAt ?? now };

    const detectedPlatform = detectPlatform(req.headers['user-agent'] as string | undefined);
    const platformStepDA = onboardingSteps.find(s => s.id === 'identify_platform');
    if (detectedPlatform && platformStepDA) {
      platformStepDA.status = 'passed';
      platformStepDA.validatedAt = now;
      platformStepDA.validationMethod = 'automatic';
      platformStepDA.details = { platform: detectedPlatform.id, version: detectedPlatform.version };
      await storage.updateAgent(gaii, {
        platform: detectedPlatform.id,
        platformVersion: detectedPlatform.version,
        platformDetectedBy: detectedPlatform.detectedBy,
      });
    }

    const existingOnboarding = await storage.getOnboarding(gaii);
    if (!existingOnboarding) {
      // Test task only when the agent's Hello Integration includes accept_test_task
      const acceptStepDA = onboardingSteps.find(s => s.id === 'accept_test_task');
      if (acceptStepDA) {
        const testTaskId = randomUUID();
        await storage.createAgentTask({
          id: testTaskId,
          agentGaii: gaii,
          ownerGaii: `${ownerPayload.owner}@${config.nodeId}`,
          title: 'Onboarding verification',
          description: 'This is a test task created during Hello Integration. Propose todos, get approval, execute, and complete.',
          status: 'queued',
          scope: [],
          rules: [],
          todos: [],
          verification: { userExpects: 'Agent completes the onboarding test task successfully', technicalChecks: [] },
          createdAt: now,
          updatedAt: now,
        });
        acceptStepDA.details = { testTaskId };
      }
      await storage.createOnboarding({
        agentGaii: gaii,
        status: 'in_progress',
        startedAt: now,
        steps: onboardingSteps,
        detectedPlatform: detectedPlatform?.id,
      });
      emitChange('agent-onboarding');
    }
  });

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
      morselBalance: 0,
      createdAt: now,
      lastSeen: now,
      mode: mode ?? 'interactive',
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
    res.json(success(config.nodeId, {
      requests: pending.map(r => ({
        user_code: r.userCode,
        agent_name: r.agentName,
        display_name: r.displayName,
        description: r.description,
        status: r.status,
        created_at: r.createdAt,
        expires_in: Math.max(0, Math.ceil((new Date(r.expiresAt).getTime() - Date.now()) / 1000)),
      })),
    }));
  });

  // GET /v1/agents/verify — device authorization consent page (must be BEFORE :gaii catch-all)
  router.get('/v1/agents/verify', (_req, res) => {
    const candidates = [
      join(__dirname_agents, '..', '..', 'public', 'agent-consent.html'),      // dev: src/routes/../../public
      join(__dirname_agents, '..', '..', '..', 'public', 'agent-consent.html'), // dist: dist/src/routes/../../../public
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
      tags: agent.tags ?? [],
      semantic: agent.semantic,
      federate: agent.federate ?? false,
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
        owner: a.owner,
        display_name: a.displayName,
        description: a.description,
        capabilities: a.capabilities,
        technical_capabilities: a.technicalCapabilities,
        domain_capabilities: a.domainCapabilities,
        languages: a.languages ?? [],
        default_scopes: a.defaultScopes ?? ['*'],
        trust_score: a.trustScore,
        morsel_balance: a.morselBalance,
        created_at: a.createdAt,
        last_seen: a.lastSeen,
        public_key: a.publicKey,
        federate: a.federate ?? false,
        tags: a.tags ?? [],
        mode: a.mode ?? 'interactive',
      })),
    }, [
      { description: 'Register a new agent', method: 'POST', url: '/v1/agents' },
    ]));
  });

  // PATCH /v1/agents/:name/tags — update owner-managed sharing tags
  router.patch('/v1/agents/:name/tags', requireAuth(), requireRole('owner'), async (req, res) => {
    const identifier = decodeURIComponent(req.params.name as string);
    const gaii = identifier.includes('#') ? identifier : buildGAII(identifier, req.auth!.owner, config.nodeId);
    const agent = await storage.getAgent(gaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', `Agent not found: ${identifier}`));
      return;
    }
    if (agent.owner !== req.auth!.owner) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only update tags for your own agents'));
      return;
    }

    const rawTags = req.body?.tags;
    if (!Array.isArray(rawTags)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'tags must be an array of strings'));
      return;
    }

    const tags: string[] = [];
    for (const value of rawTags) {
      if (typeof value !== 'string') {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'tags must be an array of strings'));
        return;
      }
      const tag = value.trim().toLowerCase();
      if (!tag) continue;
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(tag)) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `Invalid tag: ${value}`));
        return;
      }
      if (!tags.includes(tag)) tags.push(tag);
    }

    if (tags.length > 20) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'An agent can have at most 20 tags'));
      return;
    }

    const updated = await storage.updateAgent(gaii, { tags });
    if (!updated) {
      res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', `Agent not found: ${identifier}`));
      return;
    }

    res.json(success(config.nodeId, {
      gaii: updated.gaii,
      name: updated.name,
      tags: updated.tags ?? [],
    }));
    emitChange('agents');
  });

  // PATCH /v1/agents/:name/mode — owner sets agent operational mode
  // (autonomous | interactive | task-runner | coordinator). Affects Hello
  // Integration step set: task-runner gets a reduced 5-step flow.
  router.patch('/v1/agents/:name/mode', requireAuth(), requireRole('owner'), async (req, res) => {
    const identifier = decodeURIComponent(req.params.name as string);
    const gaii = identifier.includes('#') ? identifier : buildGAII(identifier, req.auth!.owner, config.nodeId);
    const agent = await storage.getAgent(gaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', `Agent not found: ${identifier}`));
      return;
    }
    if (agent.owner !== req.auth!.owner) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only update the mode of your own agents'));
      return;
    }

    const newMode = req.body?.mode;
    if (!VALID_MODES.includes(newMode)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        `mode must be one of: ${VALID_MODES.join(', ')}`));
      return;
    }

    const updated = await storage.updateAgent(gaii, { mode: newMode });
    if (!updated) {
      res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', `Agent not found: ${identifier}`));
      return;
    }

    res.json(success(config.nodeId, {
      gaii: updated.gaii,
      name: updated.name,
      mode: updated.mode ?? 'interactive',
    }));
    emitChange('agents');
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
    emitChange('agents');
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
        tags: agent.tags ?? [],
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
    emitChange('agents');
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
      morselBalance: 0, // agents use GHII owner balance
      tags: Array.isArray(agentData.tags) ? agentData.tags : [],
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
    emitChange('agents');
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
    fireHook(config, storage, 'agent_rekey', { gaii, owner: agent.owner });

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
    emitChange('agents');
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
      id: `tx-${randomUUID()}`,
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
    emitChange('agents');
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
    emitChange('agents');
  });

  // PATCH /v1/agents/:name/federate — toggle agent federation visibility (owner only)
  router.patch('/v1/agents/:name/federate', requireAuth(), requireRole('owner'), async (req, res) => {
    const agentName = req.params.name as string;
    const ownerName = req.auth!.owner;
    const { federate } = req.body ?? {};

    if (typeof federate !== 'boolean') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'federate must be a boolean'));
      return;
    }

    const agents = await storage.getAgentsByOwner(ownerName);
    const agent = agents.find(a => a.name === agentName);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent "${agentName}" not found under owner "${ownerName}"`));
      return;
    }
    if (agent.owner !== req.auth!.owner) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only modify your own agents'));
      return;
    }

    const updated = await storage.updateAgent(agent.gaii, { federate });
    if (!updated) {
      res.status(500).json(error(config.nodeId, 'INTERNAL', 'Failed to update agent'));
      return;
    }

    res.json(success(config.nodeId, {
      gaii: updated.gaii,
      name: updated.name,
      federate: updated.federate ?? false,
    }));
    emitChange('agents');
  });

  // DELETE /v1/agents/:name — delete an agent (owner only)
  router.delete('/v1/agents/:name', requireAuth(), requireRole('owner'), async (req, res) => {
    const agentName = req.params.name as string;
    const ownerName = req.auth!.owner;

    const agents = await storage.getAgentsByOwner(ownerName);
    const agent = agents.find(a => a.name === agentName);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent "${agentName}" not found under owner "${ownerName}"`));
      return;
    }
    if (agent.owner !== req.auth!.owner) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only delete your own agents'));
      return;
    }

    const deleted = await storage.deleteAgent(agent.gaii);
    if (!deleted) {
      res.status(500).json(error(config.nodeId, 'INTERNAL', 'Failed to delete agent'));
      return;
    }

    res.json(success(config.nodeId, { deleted: true, name: agentName, gaii: agent.gaii }));
    emitChange('agents');
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
    emitChange('agents');
  });

  return router;
}
