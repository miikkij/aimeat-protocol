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
 *   v1.1.0 — 2026-08-02 — A publish to one's OWN connection runs through the shared runOwnPublish(),
 *     so the scheduler (schedules kind 'connections-publish') takes the identical idempotency-gated
 *     path rather than a second copy of it.
 *   v1.0.0 — 2026-08-02 — TARGET-057 Phase 1e.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireScope, requireAnyScope } from '../auth/middleware.js';
import { resolveIdentity } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';
import {
  buildOutboundProviders, listProviderMeta, findProvider,
} from '../services/connections/providers.js';
import { requireEncryptionKey, sealCredential } from '../services/connections/credential.js';
import { startAuthorization, completeAuthorization, type ConnectContext } from '../services/connections/oauth.js';
import { revokeConnection, ensureFreshCredential } from '../services/connections/refresh.js';
import { attachCredential } from '../services/connections/attach.js';
import { quotaStatus, openPublish } from '../services/connections/publish-gate.js';
import { publishToProvider } from '../services/connections/publish.js';
import { readMetrics, toStoredSample } from '../services/connections/metrics.js';
import { runOwnPublish } from '../services/connections/publish-run.js';
import type {
  ConnectionRecord, PublicConnection, ConnectionMode, ModerationMode,
  ProviderClientRecord, PublicProviderClient,
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

  // ── History and reach ────────────────────────────────────────────────────────
  //
  // Registered before /v1/connections/:id so a literal segment is never eaten by the id parameter.
  //
  // WHAT THIS IS FOR. The ledger that stops double posts already recorded everything ever published
  // through this node, and nothing could read it. A person running accounts needs to see what went
  // out, where it landed, and how it did — otherwise "publish" is a write-only hole.

  /** The caller's own history. Scoped by the query, so there is nothing to filter afterwards. */
  router.get('/v1/connections/attempts', requireAuth(), requireAnyScope('connections:read', 'connections:use'), async (req: Request, res: Response) => {
    if (!capabilityOn(res)) return;
    const principal = resolve(req);
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    const attempts = (await storage.listPublishAttempts({ publisher: principal })).slice(0, limit);
    // One lookup for every row on the page rather than one per row: an N+1 here is a history view
    // that takes a second to open and gets blamed on the network.
    const [metrics, connections] = await Promise.all([
      storage.latestPublishMetrics(attempts.map(a => a.id)),
      storage.listConnections({ principal }),
    ]);
    const byId = new Map(connections.map(c => [c.id, c]));

    const items = attempts.map(a => {
      const c = byId.get(a.connectionId);
      return {
        id: a.id,
        connectionId: a.connectionId,
        // A connection that has since been disconnected leaves its history behind. Saying
        // "(disconnected)" beats a blank where an account name should be.
        provider: c?.provider ?? 'unknown',
        accountLabel: c?.accountLabel ?? '(disconnected)',
        status: a.status,
        externalRef: a.externalRef,
        storageKey: a.storageKey,
        error: a.error,
        createdAt: a.createdAt,
        latest: metrics.get(a.id) ?? null,
      };
    });
    res.json(success(config.nodeId, { attempts: items }));
  });

  /** One item's whole series, oldest first, so a curve can be drawn rather than a single number. */
  router.get('/v1/connections/attempts/:id/metrics', requireAuth(), requireAnyScope('connections:read', 'connections:use'), async (req: Request, res: Response) => {
    if (!capabilityOn(res)) return;
    const principal = resolve(req);
    const attempt = await storage.getPublishAttempt(req.params.id as string);
    // Absent and not-yours answer alike, as everywhere else in this file.
    if (!attempt || attempt.publisher !== principal) {
      return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'no such published item of yours'));
    }
    res.json(success(config.nodeId, { samples: await storage.listPublishMetrics(attempt.id) }));
  });

  /**
   * Ask the platform how an item is doing, now, and keep the answer.
   *
   * A POST because it has effects: it spends a request at the provider and, on X, actual money.
   * Nothing in this node schedules it — a reading happens because a person asked for one. A timer
   * that refreshes a dashboard would be a standing bill nobody agreed to.
   */
  router.post('/v1/connections/attempts/:id/metrics', requireAuth(), requireScope('connections:use'), async (req: Request, res: Response) => {
    if (!capabilityOn(res)) return;
    const principal = resolve(req);
    const attempt = await storage.getPublishAttempt(req.params.id as string);
    if (!attempt || attempt.publisher !== principal) {
      return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'no such published item of yours'));
    }
    if (attempt.status !== 'done' || !attempt.externalRef) {
      return res.status(400).json(error(config.nodeId, 'NOT_PUBLISHED',
        'that item was never published, so there is nothing to measure'));
    }

    const connection = await storage.getConnection(attempt.connectionId);
    if (!connection || connection.principal !== principal) {
      return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'the account it went to is gone'));
    }
    const provider = findProvider(providers, connection.provider);
    if (!provider) {
      return res.status(400).json(error(config.nodeId, 'PROVIDER_GONE', 'that provider is no longer available'));
    }

    const key = requireEncryptionKey(config);
    if (!key) {
      return res.status(503).json(error(config.nodeId, 'NO_ENCRYPTION_KEY', 'this node cannot read stored credentials'));
    }
    const ctx: ConnectContext = { config, storage, providers, key };
    const fresh = await ensureFreshCredential(ctx, connection.id);
    if (!fresh.ok) {
      return res.status(400).json(error(config.nodeId, fresh.code, fresh.reason));
    }

    const out = await readMetrics({
      provider, connection, credential: fresh.credential, externalRef: attempt.externalRef,
    });
    if (!out.ok) {
      // 409 rather than 502 when the platform simply will not tell an author this: nothing is
      // broken and nothing is worth retrying, which a 5xx would invite.
      return res.status(out.permanent ? 409 : 502).json(
        error(config.nodeId, out.permanent ? 'NOT_MEASURABLE' : 'METRICS_UNAVAILABLE', out.reason));
    }

    const stored = toStoredSample(attempt.id, out.sample);
    await storage.addPublishMetric(stored);
    res.json(success(config.nodeId, { sample: stored }));
  });

  // ── The caller's OWN app credentials at a provider ───────────────────────────
  //
  // Registered BEFORE /v1/connections/:id so a literal path segment is never eaten by the id
  // parameter. `clients` would otherwise be a perfectly valid connection id as far as the router is
  // concerned, and the bug only appears once someone actually calls it.
  //
  // WHAT THIS IS FOR. Without it, every user of a node reaches a provider through one registration:
  // the node's. To LinkedIn or X they are one application, sharing one rate limit, one reputation
  // and, on X, one bill, because pay-per-use charges the app rather than the member. A principal
  // who brings their own app spends their own allowance and carries their own name.

  /** Never the secret, and never another principal's row. */
  function toPublicClient(row: ProviderClientRecord, connectionCount: number): PublicProviderClient {
    return {
      provider: row.provider,
      clientId: row.clientId,
      registeredAt: row.registeredAt,
      connectionCount,
    };
  }

  router.get('/v1/connections/clients', requireAuth(), requireScope('connections:read'), async (req: Request, res: Response) => {
    if (!capabilityOn(res)) return;
    const principal = resolve(req);
    const rows = await storage.listPrincipalProviderClients(principal);
    const clients = await Promise.all(rows.map(async (r) =>
      toPublicClient(r, await storage.countConnectionsByProviderClient(r.id))));
    res.json(success(config.nodeId, { clients }));
  });

  router.put('/v1/connections/clients', requireAuth(), requireScope('connections:write'), async (req: Request, res: Response) => {
    if (!capabilityOn(res)) return;
    const principal = resolve(req);
    const body = req.body as { provider?: unknown; client_id?: unknown; client_secret?: unknown };
    const providerId = typeof body.provider === 'string' ? body.provider : '';
    const clientId = typeof body.client_id === 'string' ? body.client_id.trim() : '';
    const clientSecret = typeof body.client_secret === 'string' ? body.client_secret.trim() : '';

    const provider = findProvider(providers, providerId);
    if (!provider) {
      return res.status(404).json(error(config.nodeId, 'UNKNOWN_PROVIDER', `no provider '${providerId}'`));
    }
    // An attach-only provider has no authorization round, so a client id means nothing to it. Taking
    // one and storing it would be accepting a secret this node can never use.
    if (provider.credentialShape !== 'oauth2') {
      return res.status(400).json(error(config.nodeId, 'NOT_AN_OAUTH_PROVIDER',
        `${provider.id} is connected by supplying a credential, not by registering an app`));
    }
    if (!clientId || !clientSecret) {
      return res.status(400).json(error(config.nodeId, 'INVALID_CLIENT',
        'both client_id and client_secret are required'));
    }

    const key = requireEncryptionKey(config);
    if (!key) {
      return res.status(503).json(error(config.nodeId, 'NO_ENCRYPTION_KEY',
        'This node is not set up to keep secrets safely yet. Whoever runs it can switch that on.'));
    }

    const stored = await storage.upsertPrincipalProviderClient({
      id: randomUUID(),
      provider: provider.id,
      instance: null,
      principal,
      clientId,
      // Sealed exactly like a user token. It is the caller's secret, not the node's, and a table
      // that holds one in the clear teaches the next one to do the same.
      clientSecret: sealCredential({ shape: 'oauth2', accessToken: clientSecret }, key),
      registeredAt: new Date().toISOString(),
    });

    // EXISTING CONNECTIONS ARE NOT RETARGETED. Each one remembers the client that minted its token
    // and can only be refreshed by that one. Silently repointing them here would break every
    // connection made before this moment, on its next renewal, hours later.
    const count = await storage.countConnectionsByProviderClient(stored.id);
    logger.info('connections: a principal registered their own client', {
      principal, provider: provider.id,
    });
    res.json(success(config.nodeId, { client: toPublicClient(stored, count) }, [
      { description: 'Connect an account with it', method: 'POST', url: '/v1/connections/start' },
    ]));
  });

  router.delete('/v1/connections/clients/:provider', requireAuth(), requireScope('connections:write'), async (req: Request, res: Response) => {
    if (!capabilityOn(res)) return;
    const principal = resolve(req);
    const providerId = req.params.provider as string;

    const existing = await storage.getPrincipalProviderClient(providerId, principal);
    // Absent and not-yours are the same 404: the lookup is scoped to the principal, so a row that
    // belongs to someone else is simply not found rather than found and then denied.
    if (!existing) {
      return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'no client of yours for that provider'));
    }

    // REFUSED WHILE ANYTHING STILL DEPENDS ON IT. Those connections can only be refreshed by this
    // client; deleting it would leave them working until their token expires and then failing with
    // an error nobody could trace back to this moment. Saying so now beats a mystery next week.
    const count = await storage.countConnectionsByProviderClient(existing.id);
    if (count > 0) {
      return res.status(409).json(error(config.nodeId, 'CLIENT_IN_USE',
        `${count} connected account(s) were made with this app and can only be renewed by it. Disconnect them first.`));
    }

    await storage.deletePrincipalProviderClient(providerId, principal);
    res.json(success(config.nodeId, { deleted: true }));
  });

  // ── GET /v1/connections ── the caller's own, never anyone else's.
  //
  // `connections:use` is accepted alongside `connections:read` because a granted app holds only the
  // former, and an app that may publish to a connection has to be able to NAME one. Building a test
  // app against this capability is what surfaced it: the publish verb existed with no way to reach
  // a connection id, which is a permission that cannot be exercised.
  //
  // Safe because the projection is the gate, not the scope: toPublic() is the ONLY thing that ever
  // leaves this route, and it carries provider, account label and status — decision K1's answer to
  // "what may an app know" — while the credential and the provider's own scope vocabulary never
  // appear in it.
  router.get('/v1/connections', requireAuth(), requireAnyScope('connections:read', 'connections:use'), async (req: Request, res: Response) => {
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

  // ── POST /v1/connections/publish ──
  // Gate, then credential, then recipe, then record the outcome. The gate has already written the
  // attempt by the time anything leaves the node, which is what makes a retry safe.
  router.post('/v1/connections/publish', requireAuth(), requireScope('connections:use'), async (req: Request, res: Response) => {
    if (!capabilityOn(res)) return;
    const c = ctx(res);
    if (!c) return;
    const principal = resolve(req);
    const storageKey = str(req.body?.storage_key);
    const caption = typeof req.body?.caption === 'string' ? req.body.caption : '';
    const params = (req.body?.params && typeof req.body.params === 'object' ? req.body.params : {}) as Record<string, unknown>;
    const connectionId = str(req.body?.connection_id);
    const appId = str(req.body?.app_id);
    const action = str(req.body?.action);

    if (!connectionId && !(appId && action)) {
      res.status(400).json(error(
        config.nodeId, 'INVALID_INPUT',
        'either connection_id (your own account) or app_id + action (a delegated channel) is required',
      ));
      return;
    }

    // A publish to one's OWN connection goes through runOwnPublish, which is the SAME path the
    // scheduler takes. Two copies of "open the gate, refresh, call the recipe, record" is how one of
    // them eventually skips the gate, and skipping the gate publishes the same video twice.
    if (connectionId) {
      const out = await runOwnPublish(c, { publisher: principal, connectionId, storageKey, caption, params });
      if (!out.ok) {
        // A failure AFTER an attempt was opened is a 502 (the provider's answer); one before it is
        // the caller's own input.
        const status = out.notFound ? 404 : out.attemptId ? 502 : 400;
        res.status(status).json(error(config.nodeId, out.code, out.reason));
        return;
      }
      // Waiting states are honest outcomes, not errors: `held` is moderation and `queued` is a spent
      // allowance. Reporting either as a failure teaches a caller to retry, which makes both worse.
      res.json(success(config.nodeId, { attempt: out.attempt, replay: out.replay, url: out.url }));
      return;
    }

    // The delegated path: an app acting over someone else's shared channel. Different gate, because
    // the interesting constraints (per-user cap, moderation, fixed parameters) live on a delegation.
    let file: { bytes: Buffer; mimeType: string; name: string } | null = null;
    if (storageKey) {
      const stored = await storage.getStorageFile(principal, storageKey);
      if (!stored) {
        res.status(404).json(error(config.nodeId, 'NO_SUCH_FILE', `You have no file saved under "${storageKey}". Check the name, or upload it first.`));
        return;
      }
      file = { bytes: stored.data, mimeType: stored.mimeType, name: storageKey.split('/').pop() ?? storageKey };
    }

    const gate = await openPublish(
      storage, { publisher: principal, appId, action, storageKey, caption, params }, { sharedDailyLimit: null },
    );

    if (!gate.ok) {
      res.status(gate.code === 'NOT_FOUND' ? 404 : 400).json(error(config.nodeId, gate.code, gate.reason));
      return;
    }
    if (gate.replay) {
      res.json(success(config.nodeId, { attempt: gate.attempt, replay: true }));
      return;
    }
    if (gate.attempt.status === 'held' || gate.attempt.status === 'queued') {
      res.json(success(config.nodeId, { attempt: gate.attempt, replay: false }));
      return;
    }

    const fresh = await ensureFreshCredential(c, gate.connection.id);
    if (!fresh.ok) {
      await storage.updatePublishAttempt(gate.attempt.id, { status: 'failed', error: fresh.reason });
      res.status(400).json(error(config.nodeId, fresh.code, fresh.reason));
      return;
    }

    const provider = findProvider(providers, fresh.connection.provider);
    if (!provider) {
      await storage.updatePublishAttempt(gate.attempt.id, { status: 'failed', error: 'provider no longer configured' });
      res.status(400).json(error(config.nodeId, 'PROVIDER_GONE', 'that provider is no longer configured on this node'));
      return;
    }
    const outcome = await publishToProvider({
      provider,
      connection: fresh.connection,
      credential: fresh.credential,
      caption,
      params: gate.params,
      file,
    });

    if (outcome.ok) {
      await storage.updatePublishAttempt(gate.attempt.id, { status: 'done', externalRef: outcome.externalRef });
      await storage.touchConnectionOk(gate.connection.id);
      res.json(success(config.nodeId, {
        attempt: await storage.getPublishAttempt(gate.attempt.id),
        url: outcome.externalRef,
      }));
      return;
    }
    // `rejected` never retries; `failed` may. The distinction is the provider's, not ours.
    await storage.updatePublishAttempt(gate.attempt.id, {
      status: outcome.permanent ? 'rejected' : 'failed',
      error: outcome.reason,
    });
    res.status(502).json(error(config.nodeId, outcome.permanent ? 'REJECTED' : 'PUBLISH_FAILED', outcome.reason));
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
