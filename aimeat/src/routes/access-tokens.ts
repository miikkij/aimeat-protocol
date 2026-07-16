/**
 * @file access-tokens.ts
 * @description Owner-created Personal Access Tokens (PATs) for agents. The owner mints a
 *   reusable, revocable Bearer token in profile > access-tab, granting either selected agent
 *   scopes (a scoped, sandboxed test GAII) or — when explicitly chosen — full owner / operator
 *   access. Agents exchange the token for a short access JWT to act on the owner's behalf
 *   (e.g. drive/verify a webapp they built). Only the SHA-256 hash of the raw token is stored.
 * @structure accessTokensRouter() — POST/GET/DELETE /v1/access/tokens (owner) + POST /v1/auth/token/exchange (token is the auth).
 * @usage app.use(accessTokensRouter(config, storage));
 * @version-history
 * v1.1.0 - 2026-07-16 - Add GET /v1/access/overview: the Access tab's 6-request mount folded into one
 *   composite (AccessTabService, Phase 4). Owner-gated; individual endpoints stay for interactive refresh.
 * v1.0.0 - 2026-06-03 - Initial (plan 2026-06-03-agent-access-tokens).
 */
import { Router } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { issueJWT } from '../auth/jwt.js';
import { buildGAII } from '../utils/gaii.js';
import { hashToken } from '../services/owner-session.js';
import { resolvePat } from '../services/access-token.js';
import { createAccessTabService } from '../services/db/access-tab-db-service.js';

export function accessTokensRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const accessDb = createAccessTabService(storage);

  /* ── GET /v1/access/overview — the whole Access tab mount in ONE call (consent + ghii public key +
   * app-grants + access-tokens + sharing-groups + agent-defaults), composed in one read scope by
   * AccessTabService. Owner-scope: requires 'owner' role — stricter than the six folded endpoints
   * (some of which agents may reach with a scope), so no section is exposed more widely. Each section is
   * returned in its source endpoint's payload shape; the individual endpoints stay for interactive
   * re-fetches. ── */
  router.get('/v1/access/overview', requireAuth(), requireRole('owner'), async (req, res) => {
    const owner = req.auth!.owner as string;
    const data = await accessDb.overview(owner, `${owner}@${config.nodeId}`);
    res.json(success(config.nodeId, data));
  });

  // POST /v1/access/tokens — create a personal access token (owner only)
  router.post('/v1/access/tokens', requireAuth(), requireRole('owner'), async (req, res) => {
    const owner = req.auth!.owner;
    const isOperator = req.auth!.roles.includes('operator');
    const { label, scopes, grant_owner, grant_operator, read_owner_data, expires_in } = req.body ?? {};

    if (!label || typeof label !== 'string' || label.length > 120) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'label is required (max 120 chars)'));
      return;
    }

    const grantOwner = grant_owner === true;
    const grantOperator = grant_operator === true;
    const readOwnerData = read_owner_data === true;

    // Only an operator may mint an operator token.
    if (grantOperator && !isOperator) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only an operator can create an operator-level token'));
      return;
    }

    // Scopes required + validated only for scoped tokens (owner/operator bypass scopes).
    let tokenScopes: string[] = [];
    if (!grantOwner && !grantOperator) {
      tokenScopes = Array.isArray(scopes) ? scopes.filter((s: unknown): s is string => typeof s === 'string') : [];
      if (tokenScopes.length === 0) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'At least one scope is required for a scoped token'));
        return;
      }
      // Validate against the node maximum — same rule as agent provisioning.
      if (!config.maxAgentScopes.includes('*')) {
        const invalid = tokenScopes.filter((s) => {
          if (s === '*') return true; // global wildcard is operator-only
          const [domain] = s.split(':');
          return !config.maxAgentScopes.includes(s) && !config.maxAgentScopes.includes(`${domain}:*`);
        });
        if (invalid.length > 0) {
          res.status(400).json(error(config.nodeId, 'INVALID_SCOPES', `Scopes exceed node maximum: ${invalid.join(', ')}`));
          return;
        }
      }
    }

    // Optional absolute expiry.
    let expiresAt: string | null = null;
    if (expires_in != null && expires_in !== '') {
      const secs = parseInt(String(expires_in), 10);
      if (isNaN(secs) || secs <= 0) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'expires_in must be a positive number of seconds'));
        return;
      }
      expiresAt = new Date(Date.now() + secs * 1000).toISOString();
    }

    const id = randomUUID();
    // Owner/operator tokens act as the owner; scoped tokens get a dedicated sandboxed GAII.
    const gaii = (grantOwner || grantOperator)
      ? `${owner}@${config.nodeId}`
      : buildGAII(`apptester-${id.slice(0, 8)}`, owner, config.nodeId);

    const rawToken = 'aimeat_pat_' + randomBytes(32).toString('hex');
    const now = new Date().toISOString();

    await storage.createPat({
      id, tokenHash: hashToken(rawToken), label, owner,
      scopes: tokenScopes, grantOwner, grantOperator, readOwnerData, gaii,
      createdAt: now, expiresAt, lastUsedAt: null, revoked: false,
    });

    // SECURITY: the raw token is shown only once; never cache it.
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.status(201).json(success(config.nodeId, {
      id,
      token: rawToken,
      label,
      gaii,
      scopes: tokenScopes,
      grant_owner: grantOwner,
      grant_operator: grantOperator,
      read_owner_data: readOwnerData,
      expires_at: expiresAt,
      exchange_url: '/v1/auth/token/exchange',
      note: 'Shown only once. Agents exchange it at POST /v1/auth/token/exchange (Authorization: Bearer <token>) for a short access token.',
    }));
  });

  // GET /v1/access/tokens — list the owner's active tokens (never the raw token)
  router.get('/v1/access/tokens', requireAuth(), requireRole('owner'), async (req, res) => {
    const pats = await storage.listPats(req.auth!.owner);
    res.json(success(config.nodeId, {
      tokens: pats.map((p) => ({
        id: p.id,
        label: p.label,
        gaii: p.gaii,
        scopes: p.scopes,
        grant_owner: p.grantOwner,
        grant_operator: p.grantOperator,
        read_owner_data: p.readOwnerData,
        created_at: p.createdAt,
        last_used_at: p.lastUsedAt,
        expires_at: p.expiresAt,
      })),
      total: pats.length,
    }));
  });

  // DELETE /v1/access/tokens/:id — revoke a token
  router.delete('/v1/access/tokens/:id', requireAuth(), requireRole('owner'), async (req, res) => {
    const id = req.params.id as string;
    const ok = await storage.revokePat(id, req.auth!.owner);
    if (!ok) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Token not found or already revoked'));
      return;
    }
    res.json(success(config.nodeId, { revoked: true, id }));
  });

  // POST /v1/auth/token/exchange — exchange a PAT (the token is the auth) for a short access JWT
  router.post('/v1/auth/token/exchange',
    rateLimit({ max: config.loginRateLimitMax, windowMs: config.loginRateLimitWindowMs }),
    async (req, res) => {
      const authHeader = req.headers.authorization;
      const raw = (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null)
        || (typeof req.body?.token === 'string' ? req.body.token : null);
      if (!raw) {
        res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Provide the access token as a Bearer header or body.token'));
        return;
      }

      const r = await resolvePat(storage, raw);
      if (!r) {
        res.status(401).json(error(config.nodeId, 'INVALID_TOKEN', 'Invalid, revoked, or expired access token'));
        return;
      }
      await storage.touchPat(r.patId, new Date().toISOString());

      const includeScopes = r.roles.includes('agent');
      const token = await issueJWT({
        sub: r.sub,
        owner: r.owner,
        node: config.nodeId,
        roles: r.roles,
        ...(includeScopes ? { scopes: r.scopes } : {}),
      }, config.accessTtlSeconds);

      res.set('Cache-Control', 'no-store');
      res.json(success(config.nodeId, {
        access_token: token,
        token_type: 'Bearer',
        expires_in: config.accessTtlSeconds,
        identity: { sub: r.sub, owner: r.owner, roles: r.roles, ...(includeScopes ? { scopes: r.scopes } : {}) },
      }));
    });

  return router;
}
