/**
 * @file connections.ts
 * @description REST surface for outbound connections (TARGET-057): a principal's own accounts at
 *   external services, and the delegations an app owner grants over a shared channel.
 *
 *   NOTHING HERE RETURNS A CREDENTIAL. `toPublic()` is the only projection any response uses, and it
 *   carries provider, label and status. Not scopes: an app cannot know what a provider's scope names
 *   mean, so it asks a capability question and gets a yes or no (decision K1).
 *
 *   ABSENT AND NOT-YOURS ANSWER IDENTICALLY. Every lookup compares `principal` against
 *   resolveIdentity() and 404s on a mismatch with the same body as a genuinely missing row —
 *   otherwise the difference between the two answers enumerates other people's connections.
 *
 *   THE CALLBACK IS THE ONE UNAUTHENTICATED ROUTE, and it must be: the provider redirects a browser
 *   to it. Its gate is the single-use `state`, which is bound to the principal who started the round
 *   and consumed before the code is exchanged.
 * @structure connectionsRouter(config, storage):
 *   GET    /v1/connections/providers            -- discovery (enabled providers + capabilities)
 *   POST   /v1/connections/start                -- begin an authorization
 *   GET    /v1/connections/callback             -- provider redirect (unauthenticated by necessity)
 *   GET    /v1/connections                      -- the caller's own connections
 *   DELETE /v1/connections/:id                  -- revoke at the provider, then locally
 *   POST   /v1/connections/:id/delegations      -- grant an app one named action over a channel
 *   GET    /v1/connections/:id/delegations      -- what has been granted over it
 *   PATCH  /v1/connections/delegations/:did     -- the one-gesture stop
 *   GET    /v1/connections/delegations/:did/quota -- allowance left, BEFORE anything is refused
 * @usage app.use(connectionsRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-08-02 — TARGET-057 Phase 1e.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { resolveIdentity } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';
import {
  buildOutboundProviders, listProviderMeta, findProvider,
} from '../services/connections/providers.js';
import { requireEncryptionKey } from '../services/connections/credential.js';
import { startAuthorization, completeAuthorization, type ConnectContext } from '../services/connections/oauth.js';
import { revokeConnection } from '../services/connections/refresh.js';
import { attachCredential } from '../services/connections/attach.js';
import { quotaStatus } from '../services/connections/publish-gate.js';
import type {
  ConnectionRecord, PublicConnection, ConnectionMode, ModerationMode,
} from '../models/connection-schemas.js';

/** The ONLY shape a connection leaves this file in. */
function toPublic(c: ConnectionRecord): PublicConnection {
  return { id: c.id, provider: c.provider, mode: c.mode, accountLabel: c.accountLabel, status: c.status };
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function connectionsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const providers = buildOutboundProviders(config);
  const resolve = (req: Request): string => resolveIdentity(req.auth!, config.nodeId);

  /**
   * Build the service context, or explain why not. A missing encryption key is a hard stop rather
   * than a degraded mode: storing someone's token in the clear because a key was absent is worse
   * than refusing to store it.
   */
  function ctx(res: Response): ConnectContext | null {
    const key = requireEncryptionKey(config);
    if (!key) {
      res.status(503).json(error(
        config.nodeId, 'NO_ENCRYPTION_KEY',
        'This node has no encryption key configured, so it cannot hold an account credential. Set AIMEAT_ENCRYPTION_KEY.',
      ));
      return null;
    }
    return { config, storage, providers, key };
  }

  /** Capability gate. Returns false and answers when connections are switched off on this node. */
  function capabilityOn(res: Response): boolean {
    if (config.connectionsEnabled) return true;
    res.status(503).json(error(
      config.nodeId, 'CONNECTIONS_DISABLED',
      'Outbound connections are not enabled on this node (AIMEAT_CONNECTIONS_ENABLED).',
    ));
    return false;
  }

  // ── GET /v1/connections/providers ──
  // Discovery. Disabled providers are omitted, but the reason is available to an operator through
  // the node's own config rather than leaking configuration state to every caller.
  router.get('/v1/connections/providers', requireAuth(), (_req: Request, res: Response) => {
    res.json(success(config.nodeId, { providers: listProviderMeta(providers) }, [
      { description: 'Start connecting an account', method: 'POST', url: '/v1/connections/start' },
    ]));
  });

  // ── GET /v1/connections ── the caller's own, never anyone else's.
  router.get('/v1/connections', requireAuth(), requireScope('connections:read'), async (req: Request, res: Response) => {
    if (!capabilityOn(res)) return;
    const principal = resolve(req);
    const rows = await storage.listConnections({ principal });
    res.json(success(config.nodeId, { connections: rows.map(toPublic) }));
  });

  // ── POST /v1/connections/start ──
  router.post('/v1/connections/start', requireAuth(), requireScope('connections:write'), async (req: Request, res: Response) => {
    if (!capabilityOn(res)) return;
    const c = ctx(res);
    if (!c) return;

    const provider = str(req.body?.provider);
    if (!provider) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'provider is required'));
      return;
    }
    const mode: ConnectionMode = req.body?.mode === 'shared' ? 'shared' : 'personal';
    const result = await startAuthorization(c, {
      principal: resolve(req),
      provider,
      instance: str(req.body?.instance) || undefined,
      mode,
      returnUrl: str(req.body?.return_url),
    });
    if (!result.ok) {
      // The reason travels with the refusal. "Disabled" alone leaves an operator nothing to act on.
      res.status(result.code === 'UNKNOWN_PROVIDER' ? 404 : 400)
        .json(error(config.nodeId, result.code, result.reason));
      return;
    }
    res.json(success(config.nodeId, { authorize_url: result.authorizeUrl, state: result.state }));
  });

  // ── POST /v1/connections/attach ──
  // The other half of connecting: a provider with no authorization round, where the user supplies a
  // credential instead. It existed as a provider entry before it existed as a route, which meant
  // Bluesky was advertised in discovery with no way to connect it — the same "the gate is
  // decorative" failure the YouTube case is asserted against.
  router.post('/v1/connections/attach', requireAuth(), requireScope('connections:write'), async (req: Request, res: Response) => {
    if (!capabilityOn(res)) return;
    const c = ctx(res);
    if (!c) return;
    const provider = str(req.body?.provider);
    if (!provider) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'provider is required'));
      return;
    }
    const raw = (req.body?.fields && typeof req.body.fields === 'object' ? req.body.fields : {}) as Record<string, unknown>;
    const fields: Record<string, string> = {};
    for (const k of Object.keys(raw)) if (typeof raw[k] === 'string') fields[k] = raw[k];

    const result = await attachCredential(c, {
      principal: resolve(req),
      provider,
      mode: req.body?.mode === 'shared' ? 'shared' : 'personal',
      fields,
    });
    if (!result.ok) {
      res.status(result.code === 'UNKNOWN_PROVIDER' ? 404 : 400)
        .json(error(config.nodeId, result.code, result.reason));
      return;
    }
    // The supplied secret is not echoed anywhere in this response, and toPublic() has no field for
    // it at any level.
    res.status(result.created ? 201 : 200)
      .json(success(config.nodeId, { connection: toPublic(result.connection), created: result.created }));
  });

  // ── GET /v1/connections/callback ──
  // Unauthenticated BY NECESSITY: the provider redirects a browser here and that browser may carry
  // no session. The gate is the single-use state, bound to the principal who started the round.
  router.get('/v1/connections/callback', async (req: Request, res: Response) => {
    if (!config.connectionsEnabled) {
      res.status(503).send('Outbound connections are not enabled on this node.');
      return;
    }
    const key = requireEncryptionKey(config);
    if (!key) {
      res.status(503).send('This node has no encryption key configured.');
      return;
    }
    const state = str(req.query.state);
    const code = str(req.query.code);
    const providerError = str(req.query.error);

    if (providerError) {
      // The user pressed cancel, or the provider refused. Not our failure, and not an error page:
      // the state still needs consuming so a stale row does not sit until it expires.
      await storage.deleteVerificationNonce(state).catch((err: unknown) => {
        logger.warn('connections: could not clear the state after a provider-side refusal', { error: String(err) });
      });
      res.status(400).send(`The provider did not complete the connection: ${providerError}`);
      return;
    }
    if (!state || !code) {
      res.status(400).send('This connection callback is missing its state or code.');
      return;
    }

    const result = await completeAuthorization({ config, storage, providers, key }, { state, code });
    if (!result.ok) {
      res.status(400).send(`Could not finish connecting: ${result.reason}`);
      return;
    }
    // Back to wherever the flow started, when the starter said where that was. Same-origin only:
    // an absolute URL from the request would make this an open redirect.
    const target = result.returnUrl && result.returnUrl.startsWith('/') ? result.returnUrl : '/profile#access';
    res.redirect(target);
  });

  // ── DELETE /v1/connections/:id ──
  router.delete('/v1/connections/:id', requireAuth(), requireScope('connections:write'), async (req: Request, res: Response) => {
    if (!capabilityOn(res)) return;
    const c = ctx(res);
    if (!c) return;
    const id = req.params.id as string;
    const conn = await storage.getConnection(id);
    // Identical answer for absent and not-yours: the difference between them is an enumeration.
    if (!conn || conn.principal !== resolve(req)) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such connection'));
      return;
    }
    const result = await revokeConnection(c, id);
    if (!result.ok) {
      res.status(400).json(error(config.nodeId, result.code, result.reason));
      return;
    }
    // told_provider is reported honestly: the local credential is always gone, but whether the
    // provider was reachable to be told is a fact the owner may want to act on.
    res.json(success(config.nodeId, { revoked: true, told_provider: result.toldProvider }));
  });

  // ── POST /v1/connections/:id/delegations ──
  // Granting an app ONE named action over a channel, with the parameters it may not choose already
  // decided. This is deliberately not "let this app use my connection".
  router.post('/v1/connections/:id/delegations', requireAuth(), requireScope('connections:write'), async (req: Request, res: Response) => {
    if (!capabilityOn(res)) return;
    const id = req.params.id as string;
    const conn = await storage.getConnection(id);
    if (!conn || conn.principal !== resolve(req)) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such connection'));
      return;
    }
    if (conn.mode !== 'shared') {
      res.status(400).json(error(
        config.nodeId, 'NOT_A_SHARED_CHANNEL',
        'Only a shared channel can be delegated. A personal connection is used by its owner alone.',
      ));
      return;
    }
    const appId = str(req.body?.app_id);
    const action = str(req.body?.action);
    if (!appId || !action) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'app_id and action are required'));
      return;
    }
    const provider = findProvider(providers, conn.provider);
    if (provider && !provider.capabilities.includes(action)) {
      res.status(400).json(error(
        config.nodeId, 'UNKNOWN_ACTION',
        `${conn.provider} has no action '${action}'. Available: ${provider.capabilities.join(', ')}`,
      ));
      return;
    }

    const raw = req.body?.per_user_limit as { count?: unknown; window_hours?: unknown } | undefined;
    const perUserLimit = raw && typeof raw.count === 'number' && raw.count > 0
      ? { count: raw.count, windowHours: typeof raw.window_hours === 'number' && raw.window_hours > 0 ? raw.window_hours : 24 }
      : null;
    // 'hold' is the default and stays the default: content published under the owner's name on
    // their own channel is exactly the case where a preview is worth the friction.
    const moderation: ModerationMode = req.body?.moderation === 'auto' ? 'auto' : 'hold';
    const now = new Date().toISOString();

    await storage.upsertDelegation({
      id: randomUUID(),
      connectionId: id,
      appId,
      action,
      fixed: (req.body?.fixed && typeof req.body.fixed === 'object' ? req.body.fixed : {}) as Record<string, unknown>,
      perUserLimit,
      moderation,
      enabled: req.body?.enabled !== false,
      createdAt: now,
      updatedAt: now,
    });
    const stored = await storage.findDelegation(appId, action);
    res.status(201).json(success(config.nodeId, { delegation: stored }));
  });

  // ── GET /v1/connections/:id/delegations ──
  router.get('/v1/connections/:id/delegations', requireAuth(), requireScope('connections:read'), async (req: Request, res: Response) => {
    if (!capabilityOn(res)) return;
    const id = req.params.id as string;
    const conn = await storage.getConnection(id);
    if (!conn || conn.principal !== resolve(req)) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such connection'));
      return;
    }
    res.json(success(config.nodeId, { delegations: await storage.listDelegations(id) }));
  });

  // ── PATCH /v1/connections/delegations/:did ── the one-gesture stop.
  router.patch('/v1/connections/delegations/:did', requireAuth(), requireScope('connections:write'), async (req: Request, res: Response) => {
    if (!capabilityOn(res)) return;
    const did = req.params.did as string;
    const delegation = await storage.getDelegation(did);
    const conn = delegation ? await storage.getConnection(delegation.connectionId) : undefined;
    if (!delegation || !conn || conn.principal !== resolve(req)) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such delegation'));
      return;
    }
    if (typeof req.body?.enabled !== 'boolean') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'enabled (boolean) is required'));
      return;
    }
    await storage.setDelegationEnabled(did, req.body.enabled);
    res.json(success(config.nodeId, { delegation: await storage.getDelegation(did) }));
  });

  // ── GET /v1/connections/delegations/:did/quota ──
  // Readable BEFORE anything is refused. A ceiling a person only meets by hitting it is
  // indistinguishable from a broken feature.
  router.get('/v1/connections/delegations/:did/quota', requireAuth(), requireScope('connections:read'), async (req: Request, res: Response) => {
    if (!capabilityOn(res)) return;
    const did = req.params.did as string;
    const delegation = await storage.getDelegation(did);
    const conn = delegation ? await storage.getConnection(delegation.connectionId) : undefined;
    if (!delegation || !conn || conn.principal !== resolve(req)) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such delegation'));
      return;
    }
    const provider = findProvider(providers, conn.provider);
    const status = await quotaStatus(storage, did, provider?.sharedDailyLimit ?? null);
    res.json(success(config.nodeId, { quota: status, per_user_limit: delegation.perUserLimit }));
  });

  return router;
}
