/**
 * @file src/routes/secrets.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's secrets vault: three doors, one promise. A value goes in through PUT and
 *   comes out of nothing — not GET, which answers names and times; not an export; not an error
 *   message. The only reader on this node is `ctx.fetch`, resolving `{{secret:NAME}}` in an
 *   outbound header after a sandboxed script has already handed its request over. So a script
 *   written by an AI, published in a document a stranger opens, can SEND a credential and cannot
 *   LEARN one.
 *
 *   BEHIND secrets:manage, WHICH IS A NEW WORD. `memory:write-as-owner` and `memory:read` were the
 *   obvious reuse and both are wrong. A secret is not a memory record — memory's contract is that
 *   its owner can read it back, and this one nobody can. And `memory:write` is among the most
 *   commonly granted words here: putting the vault behind it would have handed every live agent and
 *   app grant the power to rotate the owner's credentials, retroactively, with no owner ever asked.
 *   The word is out of every wildcard (utils/scope-coverage.ts) for the same reason `commerce:psp`
 *   is: "Full access" is one click.
 *
 *   NOT requireOwnerPrincipal(). The vault is not a door back INTO the account — nothing here
 *   changes who can sign in — and agents are first-class users: an agent that sets up an
 *   integration should be able to store the key that integration needs. What it costs is its own
 *   tick, which is what the scope word is.
 *
 *   THE COORDINATE IS THE OWNER GHII, through `ownerCoordinate(req.auth!, nodeId)`: the owner's
 *   session, their agent and their granted app all reach the same vault, because the credential
 *   belongs to the human in whose name each of them acts. Never `req.auth!.sub`, which would file an
 *   agent's write under the agent and leave it invisible to the person who owns it.
 *
 * @structure
 *   - GET    /v1/secrets           — names, times, and which extensions used each one lately
 *   - PUT    /v1/secrets/:name     — set or replace. Same call either way.
 *   - DELETE /v1/secrets/:name     — remove one
 * @usage app.use(secretsRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-09-06 — Initial. The owner's secrets vault.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { ownerCoordinate } from '../utils/gaii.js';
import { SECRETS_MANAGE_SCOPE } from '../utils/scope-coverage.js';
import { listOwnerSecrets, putOwnerSecret, deleteOwnerSecret } from '../services/owner-secrets.js';

export function secretsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const gate = [requireAuth(), requireScope(SECRETS_MANAGE_SCOPE)];

  router.get('/v1/secrets', ...gate, async (req, res) => {
    const secrets = await listOwnerSecrets(storage, ownerCoordinate(req.auth!, config.nodeId));
    res.json(success(config.nodeId, { secrets, count: secrets.length }, [
      { description: 'Store or replace one', method: 'PUT', url: '/v1/secrets/{name}' },
    ]));
  });

  router.put('/v1/secrets/:name', ...gate, async (req, res) => {
    const ownerGhii = ownerCoordinate(req.auth!, config.nodeId);
    const r = await putOwnerSecret(storage, config, ownerGhii, req.params.name as string, req.body?.value);
    if (!r.ok) { res.status(r.status).json(error(config.nodeId, r.code, r.message)); return; }
    // Owner-scoped: whose vault changed is nobody else's business, and an unscoped emit would wake
    // every open stream on the node with the news that SOMEBODY set a credential.
    emitChange('secrets', ownerGhii);
    res.json(success(config.nodeId, r.data));
  });

  router.delete('/v1/secrets/:name', ...gate, async (req, res) => {
    const name = req.params.name as string;
    const ownerGhii = ownerCoordinate(req.auth!, config.nodeId);
    const r = await deleteOwnerSecret(storage, ownerGhii, name);
    if (!r.ok) { res.status(r.status).json(error(config.nodeId, r.code, r.message)); return; }
    emitChange('secrets', ownerGhii);
    res.json(success(config.nodeId, { name, deleted: true }));
  });

  return router;
}
