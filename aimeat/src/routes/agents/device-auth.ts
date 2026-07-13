/**
 * @file src/routes/agents/device-auth.ts
 * @description RFC 8628 device authorization flow routes (authorize, token poll, consent info, verify submit). Extracted from agents.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from agents.ts (max-file-lines)
 */
import type { Router } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { generateKeyPair } from '../../auth/keypair.js';
import { success, error } from '../../middleware/envelope.js';
import { validateAgentName, buildGAII, generateUserCode } from '../../utils/gaii.js';
import { executeHooks } from '../../services/hooks.js';
import { fireHook } from '../../utils/fire-hook.js';
import { verifyJWT, issueJWT, generateSessionId } from '../../auth/jwt.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { emitChange } from '../../services/event-bus.js';
import { createDefaultSteps } from '../../models/agent-onboarding-schemas.js';
import { detectPlatform } from '../../services/platform-detector.js';
import { DEVICE_AUTH_EXPIRY_MS, VALID_MODES } from './constants.js';

export function registerDeviceAuthRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
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
        await storage.updateDeviceAuth(device_code, { agentCredentials: undefined });

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
}
