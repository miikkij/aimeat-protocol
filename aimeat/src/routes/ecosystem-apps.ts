/**
 * @file ecosystem-apps.ts
 * @description The GEAI (ecosystem application) onboarding router — a near-copy of the agent
 *   device-authorization flow (RFC 8628) in routes/agents.ts, minus tasks. An ecosystem app (or an
 *   owner-initiated start) says "hello integration"; the owner approves it from their portal and
 *   selects scopes + data-area allowlist; the connector picks up a long-lived GEAI credential once.
 *   Additive: it does not touch the agent/owner paths.
 * @structure
 *   - POST /v1/ecosystem-apps/hello      — start the handshake, pin the app's key (TOFU), enter pending
 *   - POST /v1/ecosystem-apps/token      — connector polls for the GEAI credential (one-time pickup)
 *   - GET  /v1/ecosystem-apps/pending    — owner lists pending requests
 *   - POST /v1/ecosystem-apps/:userCode/approve — owner approves/denies + selects scopes + data-areas
 *   - GET  /v1/ecosystem-apps            — owner lists their connected GEAIs
 *   - GET  /v1/ecosystem-apps/:app/data  — owner lists the memory the app wrote (its eco: namespace)
 *   - DELETE /v1/ecosystem-apps/:app     — owner revokes a GEAI (status → revoked)
 * @usage app.use(ecosystemAppsRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-06-14 — Created for ecosystem-apps foundation (chunk 1).
 *   v1.1.0 — 2026-06-15 — Add GET /v1/ecosystem-apps/:app/data — owner-scoped listing of the memory
 *     entries an ecosystem app wrote into its own eco: namespace (profile "Ecosystem apps" tab).
 */
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, EcoDataAreaGrant } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { validateAppName, validateOwnerName, buildGEAI, generateUserCode } from '../utils/gaii.js';
import { issueJWT, generateSessionId } from '../auth/jwt.js';
import { validateEcoManifest } from '../models/ecosystem-manifest.js';
import { emitChange } from '../services/event-bus.js';
import { emitEcosystemBindingRevoked } from '../services/ecosystem-events.js';

/** Hello-integration request codes expire after 30 minutes (parallel to device-auth). */
const ECO_AUTH_EXPIRY_MS = 1_800_000;

/** Validate a list of requested scopes against the node's ceiling (mirror of agents.ts:318-330). */
function scopesWithinCeiling(requested: string[], ceiling: string[]): string[] {
  if (ceiling.includes('*')) return [];
  return requested.filter((s) => {
    if (s === '*') return true; // only operator may hold the global wildcard
    const [domain] = s.split(':');
    return !ceiling.includes(s) && !ceiling.includes(`${domain}:*`);
  });
}

export function ecosystemAppsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // ── POST /v1/ecosystem-apps/hello — start the "hello integration" handshake ──
  // Bidirectional: works whether the ecosystem app dials in or the owner initiates from AIMEAT.
  // The body is identical either way: who the owner is, the app's global name, and the app's
  // verification key (pinned TOFU here). Returns RFC-8628-style codes.
  router.post('/v1/ecosystem-apps/hello', async (req, res) => {
    const { owner, app, display_name, description, public_key, scopes, data_areas, bound_ref, manifest } = req.body ?? {};

    if (!owner) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'owner is required'));
      return;
    }
    if (!app) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'app is required'));
      return;
    }
    if (!public_key) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'public_key is required (pinned TOFU at first connect)'));
      return;
    }
    const ownerErr = validateOwnerName(owner);
    if (ownerErr) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', ownerErr));
      return;
    }
    const appErr = validateAppName(app);
    if (appErr) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', appErr));
      return;
    }

    // Rate limit: max 10 pending hello requests per owner.
    const pendingCount = await storage.countPendingEcoAuthByOwner(owner);
    if (pendingCount >= 10) {
      res.status(429).json(error(config.nodeId, 'RATE_LIMITED', 'Too many pending ecosystem-app requests for this owner'));
      return;
    }

    await storage.cleanupExpiredEcoAuth();

    const deviceCode = randomBytes(32).toString('hex');
    let userCode = generateUserCode();
    let attempts = 0;
    while (await storage.getEcoAuthByUserCode(userCode) && attempts < 10) {
      userCode = generateUserCode();
      attempts++;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ECO_AUTH_EXPIRY_MS);

    // Static compatibility validation: if a manifest is provided, validate it now so the owner
    // approves a known-good integration. Optional (back-compat): no manifest ⇒ no validation gate.
    const requestedScopes = Array.isArray(scopes) ? scopes : config.defaultEcoScopes;
    const validationResult = manifest !== undefined
      ? validateEcoManifest(app, requestedScopes, manifest, config.maxEcoScopes)
      : undefined;

    await storage.createEcoAuth({
      deviceCode,
      userCode,
      ownerName: owner,
      app,
      displayName: display_name,
      description,
      status: 'pending',
      publicKey: public_key,
      scopes: Array.isArray(scopes) ? scopes : undefined,
      dataAreas: Array.isArray(data_areas) ? (data_areas as EcoDataAreaGrant[]) : undefined,
      boundRef: bound_ref,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      pollInterval: 5,
      validationResult,
    });

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const verificationUri = `${baseUrl}/v1/profile#ecosystem-apps`;

    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.json(success(config.nodeId, {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: verificationUri,
      verification_uri_complete: `${verificationUri}?code=${userCode}`,
      expires_in: Math.floor(ECO_AUTH_EXPIRY_MS / 1000),
      interval: 5,
      validation: validationResult ? { ok: validationResult.ok, checks: validationResult.checks } : null,
      user_instructions: `Ask the AIMEAT owner "${owner}" to approve this integration in their portal ` +
        `(Profile → Ecosystem apps) using the code ${userCode}. Poll POST /v1/ecosystem-apps/token ` +
        `with the device_code until approved.`,
    }, [
      { description: 'Poll for the credential once approved', method: 'POST', url: '/v1/ecosystem-apps/token' },
    ]));
    emitChange('ecosystem-apps');
  });

  // ── POST /v1/ecosystem-apps/token — connector polls for the GEAI credential ──
  router.post('/v1/ecosystem-apps/token', async (req, res) => {
    const { device_code, grant_type } = req.body ?? {};

    if (grant_type !== 'urn:ietf:params:oauth:grant-type:device_code') {
      res.status(400).json({ error: 'unsupported_grant_type', error_description: 'Only device_code grant type is supported.' });
      return;
    }
    if (!device_code) {
      res.status(400).json({ error: 'invalid_request', error_description: 'device_code is required.' });
      return;
    }

    const request = await storage.getEcoAuthByDeviceCode(device_code);
    if (!request) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'Unknown device code.' });
      return;
    }

    if (new Date(request.expiresAt) <= new Date()) {
      if (request.status === 'pending') await storage.updateEcoAuth(device_code, { status: 'expired' });
      res.status(400).json({ error: 'expired_token', error_description: 'This authorization request has expired.' });
      return;
    }

    // Poll-interval enforcement (slow_down) — mirror of the agent path.
    if (request.lastPolledAt) {
      const elapsed = Date.now() - new Date(request.lastPolledAt).getTime();
      if (elapsed < request.pollInterval * 1000) {
        await storage.updateEcoAuth(device_code, {
          pollInterval: request.pollInterval + 5,
          lastPolledAt: new Date().toISOString(),
        });
        res.status(400).json({ error: 'slow_down', error_description: `Polling too frequently. Wait ${request.pollInterval + 5} seconds between requests.` });
        return;
      }
    }
    await storage.updateEcoAuth(device_code, { lastPolledAt: new Date().toISOString() });

    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');

    switch (request.status) {
      case 'pending':
        res.status(400).json({ error: 'authorization_pending', error_description: 'The owner has not yet approved this request.' });
        return;
      case 'denied':
        res.status(400).json({ error: 'access_denied', error_description: 'The owner denied this authorization request.' });
        return;
      case 'approved': {
        if (!request.appCredentials) {
          res.status(400).json({ error: 'expired_token', error_description: 'Credentials have already been retrieved.' });
          return;
        }
        const creds = request.appCredentials;
        await storage.updateEcoAuth(device_code, { appCredentials: null as unknown as undefined });
        res.json({
          access_token: creds.token,
          token: creds.token,
          token_type: 'Bearer',
          geai: creds.geai,
          app: request.app,
          owner: request.ownerName,
          expires_at: creds.expires_at,
          publicKey: creds.publicKey,
          scopes: request.scopes ?? config.defaultEcoScopes,
          morselBalance: 0,
        });
        return;
      }
      default:
        res.status(400).json({ error: 'expired_token', error_description: 'This authorization request has expired.' });
    }
  });

  // ── GET /v1/ecosystem-apps/pending — owner lists pending hello requests ──
  router.get('/v1/ecosystem-apps/pending', requireAuth(), requireRole('owner'), async (req, res) => {
    const pending = await storage.listPendingEcoAuthByOwner(req.auth!.owner);
    res.json(success(config.nodeId, {
      requests: pending.map((r) => ({
        user_code: r.userCode,
        app: r.app,
        display_name: r.displayName,
        description: r.description,
        requested_scopes: r.scopes ?? config.defaultEcoScopes,
        requested_data_areas: r.dataAreas ?? [],
        status: r.status,
        // Static-validation outcome: 'validated' | 'failed' | 'none' (no manifest submitted).
        validation: r.validationResult ? (r.validationResult.ok ? 'validated' : 'failed') : 'none',
        validation_checks: r.validationResult?.checks ?? [],
        created_at: r.createdAt,
        expires_in: Math.max(0, Math.ceil((new Date(r.expiresAt).getTime() - Date.now()) / 1000)),
      })),
    }));
  });

  // ── POST /v1/ecosystem-apps/:userCode/approve — owner approve/deny + scope/area selection ──
  router.post('/v1/ecosystem-apps/:userCode/approve', requireAuth(), requireRole('owner'), async (req, res) => {
    const userCode = req.params.userCode as string;
    const { action, scopes, data_areas } = req.body ?? {};

    const request = await storage.getEcoAuthByUserCode(userCode);
    if (!request) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Authorization request not found'));
      return;
    }
    if (request.ownerName !== req.auth!.owner) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only approve requests for your own account'));
      return;
    }
    if (request.status !== 'pending') {
      res.status(409).json(error(config.nodeId, 'ALREADY_PROCESSED', `This request has already been ${request.status}`));
      return;
    }
    if (new Date(request.expiresAt) <= new Date()) {
      await storage.updateEcoAuth(request.deviceCode, { status: 'expired' });
      res.status(410).json(error(config.nodeId, 'EXPIRED', 'This authorization request has expired'));
      return;
    }

    if (action === 'deny') {
      await storage.updateEcoAuth(request.deviceCode, { status: 'denied' });
      res.json(success(config.nodeId, { status: 'denied' }));
      emitChange('ecosystem-apps');
      return;
    }
    if (action !== 'approve') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'action must be "approve" or "deny"'));
      return;
    }

    // Compatibility gate: a submitted-but-failed manifest blocks approval (the app must fix + re-hello).
    if (request.validationResult && !request.validationResult.ok) {
      const failed = request.validationResult.checks.filter(c => !c.ok).map(c => c.name).join(', ');
      res.status(409).json(error(config.nodeId, 'VALIDATION_FAILED', `Compatibility validation failed (${failed}); the app must fix its manifest and reconnect`));
      return;
    }

    // Owner may narrow the requested scopes/areas; fall back to what the app asked for, then defaults.
    const finalScopes: string[] = Array.isArray(scopes) ? scopes : (request.scopes ?? config.defaultEcoScopes);
    const finalAreas: EcoDataAreaGrant[] = Array.isArray(data_areas)
      ? (data_areas as EcoDataAreaGrant[])
      : (request.dataAreas ?? []);

    const invalid = scopesWithinCeiling(finalScopes, config.maxEcoScopes);
    if (invalid.length > 0) {
      res.status(400).json(error(config.nodeId, 'INVALID_SCOPES', `Scopes exceed node maximum: ${invalid.join(', ')}`));
      return;
    }

    const geai = buildGEAI(request.app, request.ownerName, config.nodeId);
    const existing = await storage.getEcosystemAppByOwnerAndApp(request.ownerName, request.app);
    // The app brings its OWN verification key (submitted at hello, pinned TOFU). Unlike agents, the
    // node does not mint a keypair — the connector signs with the app's own private half. A
    // re-approval after a fresh hello re-pins whatever key that hello carried (key rotation).
    const appPublicKey = request.publicKey ?? existing?.publicKey ?? '';
    const now = new Date().toISOString();

    if (existing) {
      // Re-approval: re-pin the key + refresh the grant rather than duplicating the principal.
      await storage.updateEcosystemApp(geai, {
        publicKey: appPublicKey,
        scopes: finalScopes,
        dataAreas: finalAreas,
        boundRef: request.boundRef,
        status: 'active',
        lastSeen: now,
      });
    } else {
      await storage.createEcosystemApp({
        app: request.app,
        owner: request.ownerName,
        geai,
        displayName: request.displayName ?? request.app,
        description: request.description,
        publicKey: appPublicKey,
        scopes: finalScopes,
        dataAreas: finalAreas,
        boundRef: request.boundRef,
        status: 'active',
        morselBalance: 0,
        createdAt: now,
        lastSeen: now,
      });
    }

    const sessionId = generateSessionId();
    const geaiJwt = await issueJWT({
      sub: geai,
      owner: request.ownerName,
      node: config.nodeId,
      roles: ['ecosystem'],
      scopes: finalScopes,
      eco_app: request.app,
    }, config.ecoJwtTtlSeconds, sessionId);
    const expiresAt = new Date(Date.now() + config.ecoJwtTtlSeconds * 1000).toISOString();

    await storage.updateEcoAuth(request.deviceCode, {
      status: 'approved',
      scopes: finalScopes,
      dataAreas: finalAreas,
      approvedBy: req.auth!.owner,
      appCredentials: {
        geai,
        publicKey: appPublicKey,
        token: geaiJwt,
        expires_at: expiresAt,
      },
    });

    res.json(success(config.nodeId, {
      status: 'approved',
      geai,
      app: request.app,
      existing_app: !!existing,
    }));
    emitChange('ecosystem-apps');
  });

  // ── GET /v1/ecosystem-apps — owner lists their connected GEAIs ──
  router.get('/v1/ecosystem-apps', requireAuth(), requireRole('owner'), async (req, res) => {
    const apps = await storage.getEcosystemAppsByOwner(req.auth!.owner);
    res.json(success(config.nodeId, {
      ecosystem_apps: apps.map((a) => ({
        geai: a.geai,
        app: a.app,
        owner: a.owner,
        display_name: a.displayName,
        description: a.description,
        scopes: a.scopes,
        data_areas: a.dataAreas ?? [],
        status: a.status,
        public_key: a.publicKey,
        created_at: a.createdAt,
        last_seen: a.lastSeen,
      })),
    }, [
      { description: 'Connect a new ecosystem app', method: 'POST', url: '/v1/ecosystem-apps/hello' },
    ]));
  });

  // ── GET /v1/ecosystem-apps/:app/data — owner lists the memory this app wrote ──
  // An ecosystem app deposits under its OWN eco: namespace (resolveIdentity returns the GEAI sub
  // verbatim). This owner-scoped endpoint reads that namespace so the owner can see exactly what a
  // connected app has written for them. Generic: any connected app uses the same route.
  router.get('/v1/ecosystem-apps/:app/data', requireAuth(), requireRole('owner'), async (req, res) => {
    const app = req.params.app as string;
    const owner = req.auth!.owner;

    // You can only list data for an app you actually connected.
    const record = await storage.getEcosystemAppByOwnerAndApp(owner, app);
    if (!record) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Ecosystem app "${app}" not found under owner "${owner}"`));
      return;
    }

    const geai = buildGEAI(app, owner, config.nodeId);
    const prefix = req.query.prefix as string | undefined;
    const visibility = req.query.visibility as string | undefined;

    const records = await storage.listMemory(geai, { prefix, visibility });
    // Newest first by updatedAt (fall back to createdAt), then cap to a sane limit.
    records.sort((a, b) => {
      const ta = new Date(a.updatedAt ?? a.createdAt ?? 0).getTime();
      const tb = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime();
      return tb - ta;
    });
    const total = records.length;
    const items = records.slice(0, 200).map((r) => ({
      key: r.key,
      value: r.value,
      visibility: r.visibility,
      tags: r.tags,
      version: r.version,
      updated_at: r.updatedAt,
      created_at: r.createdAt,
    }));

    res.json(success(config.nodeId, { items, total }));
  });

  // ── DELETE /v1/ecosystem-apps/:app — owner revokes a GEAI (status → revoked) ──
  router.delete('/v1/ecosystem-apps/:app', requireAuth(), requireRole('owner'), async (req, res) => {
    const app = req.params.app as string;
    const record = await storage.getEcosystemAppByOwnerAndApp(req.auth!.owner, app);
    if (!record) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Ecosystem app "${app}" not found under owner "${req.auth!.owner}"`));
      return;
    }
    // Lifecycle outbound event FIRST (best-effort) — emit while the grant is still active so the
    // live grant re-check passes; the status flip to 'revoked' then stops all further delivery.
    const ownerGhii = `${req.auth!.owner}@${config.nodeId}`;
    await emitEcosystemBindingRevoked(storage, config, ownerGhii, record.geai, 'owner_revoked').catch(() => { /* best-effort */ });
    await storage.updateEcosystemApp(record.geai, { status: 'revoked', lastSeen: new Date().toISOString() });
    res.json(success(config.nodeId, { revoked: true, app, geai: record.geai }));
    emitChange('ecosystem-apps');
  });

  return router;
}
