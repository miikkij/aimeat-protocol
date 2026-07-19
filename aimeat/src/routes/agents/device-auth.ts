/**
 * @file src/routes/agents/device-auth.ts
 * @description RFC 8628 device authorization flow routes (authorize, token poll, consent info, verify submit). Extracted from agents.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from agents.ts (max-file-lines)
 *   v1.1.0 — 2026-07-16 — Same-owner auto-approval (Agent-Bundled Apps): a device-authorize call
 *     authenticated as the SAME owner (owner session or that owner's agent, e.g. crew-forge
 *     spawning a deployed sibling) is approved immediately — no manual consent step. Guards:
 *     never cross-owner, an agent approver cannot grant scopes beyond its own token's, and the
 *     approval is attributed (approvedBy). Config gate: sameOwnerAutoApprove (default on).
 *     Approve flow extracted to approveDeviceAuth(), shared with the /verify consent path.
 *   v1.2.0 — 2026-07-19 — device-authorize `owner` accepts the account's verified EMAIL as well as
 *     the handle: an `owner` containing '@' is resolved (case-insensitive, verified-email only) to the
 *     bare handle before anything downstream. Email only selects the target account — not an auth
 *     factor — so the RFC 8628 approval semantics are unchanged.
 */
import type { Router, Request } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage, DeviceAuthorizationRecord } from '../../storage/interface.js';
import { generateKeyPair } from '../../auth/keypair.js';
import { success, error } from '../../middleware/envelope.js';
import { validateAgentName, buildGAII, generateUserCode } from '../../utils/gaii.js';
import { executeHooks } from '../../services/hooks.js';
import { fireHook } from '../../utils/fire-hook.js';
import { verifyJWT, issueJWT, generateSessionId } from '../../auth/jwt.js';
import { optionalAuth } from '../../auth/middleware.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { emitChange } from '../../services/event-bus.js';
import { createDefaultSteps } from '../../models/agent-onboarding-schemas.js';
import { detectPlatform } from '../../services/platform-detector.js';
import { resolveOwnerByVerifiedEmail } from '../../services/contacts.js';
import { DEVICE_AUTH_EXPIRY_MS, VALID_MODES } from './constants.js';

/** Validate requested scopes against the node maximum (shared by consent + auto-approve). */
function scopesExceedNodeMax(config: AimeatConfig, finalScopes: string[]): string[] {
  if (config.maxAgentScopes.includes('*')) return [];
  return finalScopes.filter((s: string) => {
    if (s === '*') return true; // only operator can have global wildcard
    const [domain] = s.split(':');
    return !config.maxAgentScopes.includes(s) && !config.maxAgentScopes.includes(`${domain}:*`);
  });
}

/**
 * The APPROVE flow shared by the /verify consent submission and same-owner auto-approval:
 * registration hooks → create agent (or rotate keys on an existing one) → issue the agent
 * JWT → stash credentials on the device-auth record for the poll → auto-start onboarding.
 * Scope validation happens BEFORE this is called (the two callers differ in how).
 */
async function approveDeviceAuth(
  config: AimeatConfig,
  storage: Storage,
  request: DeviceAuthorizationRecord,
  approvedBy: string,
  finalScopes: string[],
  userAgent: string | undefined,
): Promise<{ ok: true; gaii: string; existing: boolean } | { ok: false; status: number; code: string; message: string }> {
  // Pre-registration hook
  const hookResult = await executeHooks(config, storage, 'pre_agent_registration', {
    name: request.agentName,
    owner: request.ownerName,
    display_name: request.displayName,
  });
  if (!hookResult.allowed) {
    return { ok: false, status: 403, code: 'HOOK_REJECTED', message: hookResult.reason ?? 'Agent registration denied by extension hook' };
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
    approvedBy,
    agentCredentials: {
      gaii,
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
      token: agentJwt,
      expires_at: expiresAt,
    },
  });
  emitChange('agents');

  // ── Auto-start Hello Integration onboarding ──
  const onboardingSteps = createDefaultSteps(request.mode ?? 'interactive');
  onboardingSteps[0].status = 'passed';
  onboardingSteps[0].validatedAt = now;
  onboardingSteps[0].validationMethod = 'automatic';
  onboardingSteps[0].details = { createdAt: existing?.createdAt ?? now };

  const detectedPlatform = detectPlatform(userAgent);
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
        ownerGaii: `${request.ownerName}@${config.nodeId}`,
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

  return { ok: true, gaii, existing: !!existing };
}

/**
 * Same-owner auto-approval eligibility: the request must be authenticated (never anonymous)
 * as the SAME owner the registration is for — either the owner session itself, or one of
 * that owner's agents. App grants and ecosystem principals never qualify. An agent approver
 * additionally may not grant scopes beyond its own token's (checked by the caller).
 */
function autoApprovePrincipal(req: Request, owner: string): { kind: 'owner' | 'agent'; scopes: string[] } | null {
  const auth = req.auth;
  if (!auth || auth.anonymous) return null;
  const roles = auth.roles as string[];
  if (roles.includes('app') || roles.includes('ecosystem')) return null;
  const bare = auth.owner.includes('@') ? auth.owner.split('@')[0] : auth.owner;
  if (bare !== owner) return null;
  if (roles.includes('agent')) return { kind: 'agent', scopes: (auth.scopes ?? []) as string[] };
  if (roles.includes('owner')) return { kind: 'owner', scopes: [] };
  return null;
}

export function registerDeviceAuthRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  // POST /v1/agents/device-authorize — start device authorization flow (RFC 8628).
  // optionalAuth: an UNAUTHENTICATED call gets the standard pending flow (owner approves in
  // the profile Agents tab); a call authenticated as the SAME owner is auto-approved below.
  router.post('/v1/agents/device-authorize', optionalAuth(), async (req, res) => {
    const { agent_name, display_name, description, owner, mode, scopes } = req.body ?? {};

    if (!owner) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'owner is required'));
      return;
    }
    if (!agent_name) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'agent_name is required'));
      return;
    }

    // `owner` may be the account HANDLE (as today) or the account's verified EMAIL. An email only
    // NAMES which account this device request targets — it is never an auth factor (the human still
    // approves the device code while logged in). Everything downstream keys off the resolved bare
    // handle, so resolve up front, before rate-limit/auto-approval/GAII construction.
    let ownerName: string = owner;
    if (typeof owner === 'string' && owner.includes('@')) {
      const resolved = await resolveOwnerByVerifiedEmail(storage, owner);
      if (!resolved.ok) {
        const status = resolved.code === 'INVALID_EMAIL' ? 400 : resolved.code === 'AMBIGUOUS' ? 409 : 404;
        res.status(status).json(error(config.nodeId, resolved.code, resolved.message));
        return;
      }
      ownerName = resolved.ownerName;
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
    const pendingCount = await storage.countPendingDeviceAuthByOwner(ownerName);
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

    const authRequest: DeviceAuthorizationRecord = {
      deviceCode,
      userCode,
      ownerName,
      agentName: agent_name,
      displayName: display_name,
      description,
      status: 'pending',
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      pollInterval: 5,
      mode: mode ?? 'interactive',
    };
    await storage.createDeviceAuth(authRequest);

    // ── Same-owner auto-approval (Agent-Bundled Apps friction-killer) ──
    // A request authenticated as the owner it registers FOR — the owner session, or one of
    // that owner's already-approved agents (crew-forge registering the agent it just
    // deployed) — skips the manual consent step: the agent is created and the credentials
    // are staged so the very first device-token poll returns them. Hard limits: never
    // cross-owner (a foreign or anonymous caller falls through to the normal pending flow),
    // an AGENT approver can only grant scopes its own token already holds (no escalation),
    // and approvedBy records who approved. The cross-owner case keeps RFC 8628 semantics
    // untouched — Slice 1 forbids it anyway.
    let autoApproved = false;
    let autoApproveNote: string | undefined;
    const requestedScopes: string[] = Array.isArray(scopes)
      ? scopes.filter((s: unknown) => typeof s === 'string')
      : config.defaultAgentScopes;
    const principal = config.sameOwnerAutoApprove ? autoApprovePrincipal(req, ownerName) : null;
    if (principal) {
      const invalid = scopesExceedNodeMax(config, requestedScopes);
      if (invalid.length > 0) {
        res.status(400).json(error(config.nodeId, 'INVALID_SCOPES', `Scopes exceed node maximum: ${invalid.join(', ')}`));
        return;
      }
      const escalating = principal.kind === 'agent' && !principal.scopes.includes('*')
        ? requestedScopes.filter(s =>
            !principal.scopes.includes(s) && !principal.scopes.includes(`${s.split(':')[0]}:*`))
        : [];
      if (escalating.length > 0) {
        // No escalation via a sibling: fall through to the manual consent flow where the
        // OWNER decides — the request stays pending rather than failing the registration.
        autoApproveNote = `Scopes beyond the approving agent's own (${escalating.join(', ')}) need the owner's manual approval.`;
      } else {
        const approvedByGaii = principal.kind === 'agent' ? req.auth!.sub : ownerName;
        const result = await approveDeviceAuth(
          config, storage, authRequest, approvedByGaii, requestedScopes,
          req.headers['user-agent'] as string | undefined,
        );
        if (!result.ok) {
          await storage.updateDeviceAuth(deviceCode, { status: 'denied' });
          res.status(result.status).json(error(config.nodeId, result.code, result.message));
          return;
        }
        autoApproved = true;
      }
    }

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
      status: autoApproved ? 'approved' : 'pending',
      auto_approved: autoApproved,
      user_instructions: autoApproved
        ? `Auto-approved (same-owner registration). Fetch your credentials now: POST /v1/agents/device-token with { "device_code": "${deviceCode}", "grant_type": "urn:ietf:params:oauth:grant-type:device_code" } — the first poll returns your token.`
        : `Tell your owner to approve this request. They can find it in their AIMEAT profile under Agents (${baseUrl}/v1/profile -> Agents tab). The verification code is: ${userCode}. Once approved, poll POST /v1/agents/device-token with { "device_code": "${deviceCode}", "grant_type": "urn:ietf:params:oauth:grant-type:device_code" } every 5 seconds until you receive your token.${autoApproveNote ? ` NOTE: ${autoApproveNote}` : ''}`,
    }, [
      ...(autoApproved ? [] : [{ description: 'Owner approves in AIMEAT profile -> Agents tab', method: 'GET' as const, url: `${baseUrl}/v1/profile` }]),
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
    const invalid = scopesExceedNodeMax(config, finalScopes);
    if (invalid.length > 0) {
      res.status(400).json(error(config.nodeId, 'INVALID_SCOPES', `Scopes exceed node maximum: ${invalid.join(', ')}`));
      return;
    }

    const result = await approveDeviceAuth(
      config, storage, request, ownerPayload.owner, finalScopes,
      req.headers['user-agent'] as string | undefined,
    );
    if (!result.ok) {
      res.status(result.status).json(error(config.nodeId, result.code, result.message));
      return;
    }

    res.json(success(config.nodeId, {
      status: 'approved',
      gaii: result.gaii,
      agent_name: request.agentName,
      existing_agent: result.existing,
    }));
  });
}
