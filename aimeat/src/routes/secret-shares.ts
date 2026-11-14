/**
 * @file src/routes/secret-shares.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Secret shares over REST. Every handler calls services/secret-shares/, the same functions
 *   the MCP tools call, so the rules and refusals are written once.
 *
 *   - POST   /v1/secret-shares                     — make a share (with content) or a request (kind: request)
 *   - GET    /v1/secret-shares                     — what I made, what waits for me, what I am asked to fill, my organisms'
 *   - GET    /v1/secret-shares/:id                  — one, with its events (maker, recipient or depositor)
 *   - GET    /v1/secret-shares/:id/card             — what the pickup and deposit pages show before sign-in
 *   - GET    /v1/secret-shares/:id/deposit-card     — the deposit page with its token (header X-Deposit-Token)
 *   - POST   /v1/secret-shares/:id/deposit          — fill a request as a named depositor, signed in
 *   - POST   /v1/secret-shares/:id/deposit-with-token — fill a request with the link's token, no account needed
 *   - POST   /v1/secret-shares/:id/pickup           — pick up, signed in (to: reveal | vault)
 *   - POST   /v1/secret-shares/:id/pickup-with-code — pick up with the pickup code; signed in when the maker asked
 *   - POST   /v1/secret-shares/:id/revoke           — the maker withdraws it
 *   - GET    /v1/vault/device-keys                  — my browsers' public keys for end-to-end shares
 *   - POST   /v1/vault/device-keys                  — register this browser's public key (in person)
 *   - DELETE /v1/vault/device-keys/:keyId           — remove one (in person)
 *   - GET    /v1/vault/device-keys/of/:who          — a person's public keys, to encrypt a share to
 * @usage app.use(secretSharesRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-holvi-salaisuuksien-talletus-jako-ja-nouto-ihmisille-ja-agen).
 */
import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { optionalAuth, requireAuth, requireScope, hasSession } from '../auth/middleware.js';
import { acceptCredential } from '../auth/credential-strategies.js';
import { success, error } from '../middleware/envelope.js';
import { callerOf } from '../middleware/caller.js';
import { SECRETS_SHARE_SCOPE } from '../utils/scope-coverage.js';
import {
  createShare, depositShare, listShares, getShare, revokeShare, shareCard, depositCard,
} from '../services/secret-shares/service.js';
import { pickupShare } from '../services/secret-shares/pickup.js';
import { registerDeviceKey, listOwnDeviceKeys, removeDeviceKey, deviceKeysOf } from '../services/secret-shares/device-keys.js';
import type { ShareResult } from '../services/secret-shares/rules.js';

export function secretSharesRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const deps = { storage, config };
  const gate = [requireAuth(), requireScope(SECRETS_SHARE_SCOPE)];
  // Each handler hands its own req.body to its own service function: one shared body helper made a
  // static reading of the routes take every route's fields as every other route's (check:field-reach).
  const send = <T>(res: Response, r: ShareResult<T>, status = 200): void => {
    if (!r.ok) { res.status(r.status).json(error(config.nodeId, r.code, r.message)); return; }
    res.status(status).json(success(config.nodeId, r.data));
  };
  const id = (req: Request): string => String(req.params.id ?? '');

  router.post('/v1/secret-shares', ...gate, async (req, res) => {
    send(res, await createShare(deps, callerOf(req, config.nodeId, storage), req.body ?? {}), 201);
  });

  router.get('/v1/secret-shares', ...gate, async (req, res) => {
    send(res, await listShares(deps, callerOf(req, config.nodeId, storage)));
  });

  router.get('/v1/secret-shares/:id/card', async (req, res) => {
    send(res, await shareCard(deps, id(req)));
  });

  router.get('/v1/secret-shares/:id/deposit-card', async (req, res) => {
    const token = req.get('x-deposit-token') ?? '';
    send(res, await depositCard(deps, id(req), token));
  });

  router.get('/v1/secret-shares/:id', ...gate, async (req, res) => {
    send(res, await getShare(deps, callerOf(req, config.nodeId, storage), id(req)));
  });

  router.post('/v1/secret-shares/:id/deposit', ...gate, async (req, res) => {
    send(res, await depositShare(deps, callerOf(req, config.nodeId, storage), id(req), req.body ?? {}));
  });

  // The link's token is the credential; a session, when there is one, is recorded as the depositor.
  router.post('/v1/secret-shares/:id/deposit-with-token', acceptCredential('secret-share-deposit', deps), optionalAuth(), async (req, res) => {
    const caller = hasSession(req) ? callerOf(req, config.nodeId, storage) : null;
    send(res, await depositShare(deps, caller, id(req), req.body ?? {}));
  });

  router.post('/v1/secret-shares/:id/pickup', ...gate, async (req, res) => {
    send(res, await pickupShare(deps, callerOf(req, config.nodeId, storage), id(req), req.body ?? {}, req.ip ?? ''));
  });

  // The code is the credential; the service asks for a session too when the maker chose that.
  router.post('/v1/secret-shares/:id/pickup-with-code', acceptCredential('secret-share-code', deps), optionalAuth(), async (req, res) => {
    const caller = hasSession(req) ? callerOf(req, config.nodeId, storage) : null;
    send(res, await pickupShare(deps, caller, id(req), req.body ?? {}, req.ip ?? ''));
  });

  router.post('/v1/secret-shares/:id/revoke', ...gate, async (req, res) => {
    send(res, await revokeShare(deps, callerOf(req, config.nodeId, storage), id(req)));
  });

  router.get('/v1/vault/device-keys', ...gate, async (req, res) => {
    send(res, await listOwnDeviceKeys(deps, callerOf(req, config.nodeId, storage)));
  });

  router.post('/v1/vault/device-keys', requireAuth(), async (req, res) => {
    send(res, await registerDeviceKey(deps, callerOf(req, config.nodeId, storage), req.body ?? {}), 201);
  });

  router.delete('/v1/vault/device-keys/:keyId', requireAuth(), async (req, res) => {
    send(res, await removeDeviceKey(deps, callerOf(req, config.nodeId, storage), String(req.params.keyId ?? '')));
  });

  router.get('/v1/vault/device-keys/of/:who', ...gate, async (req, res) => {
    send(res, await deviceKeysOf(deps, String(req.params.who ?? '')));
  });

  return router;
}
