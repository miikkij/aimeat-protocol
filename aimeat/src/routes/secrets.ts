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
 *   - PUT    /v1/secrets/:name     — set or replace. Same call either way. Optional `host` binds it now.
 *   - PATCH  /v1/secrets/:name     — set, change or remove the address, without the value
 *   - DELETE /v1/secrets/:name     — remove one
 *   - GET    /v1/secrets/:name/approval?extension=&host= — a waiting request (in person only)
 *   - POST   /v1/secrets/:name/approvals            — allow it (in person only)
 *   - POST   /v1/secrets/:name/approvals/decline    — say no to it (in person only)
 *   - DELETE /v1/secrets/:name/approvals?extension=&installer=&host= — withdraw one
 * @usage app.use(secretsRouter(config, storage));
 * @version-history
 *   v1.2.0 — 2026-10-21 — PATCH sets the address without the value; the approvals routes answer a
 *     refused first use (services/secret-approvals.ts; secaudit 2026-10, v58 and v59 follow-up).
 *   v1.1.0 — 2026-10-09 — PUT takes an optional `host` (host or host:port): the secret goes only there
 *     from its first call on, and the list records who set it. Without it the first use binds, and
 *     the list names its principal and extension (secrets audit 2026-10-09, item 10).
 *   v1.0.0 — 2026-09-06 — Initial. The owner's secrets vault.
 */
import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { callerOf } from '../middleware/caller.js';
import { emitChange } from '../services/event-bus.js';
import { ownerCoordinate, resolveIdentity } from '../utils/gaii.js';
import { SECRETS_MANAGE_SCOPE } from '../utils/scope-coverage.js';
import { putOwnerSecret, deleteOwnerSecret, setOwnerSecretHost } from '../services/owner-secrets.js';
import {
  listOwnerSecretsWithUses, readApprovalRequest, approveSecretUse, declineSecretUse, withdrawSecretApproval,
} from '../services/secret-approvals.js';

export function secretsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const gate = [requireAuth(), requireScope(SECRETS_MANAGE_SCOPE)];

  router.get('/v1/secrets', ...gate, async (req, res) => {
    const secrets = await listOwnerSecretsWithUses(storage, ownerCoordinate(req.auth!, config.nodeId));
    res.json(success(config.nodeId, { secrets, count: secrets.length }, [
      { description: 'Store or replace one', method: 'PUT', url: '/v1/secrets/{name}' },
    ]));
  });

  router.put('/v1/secrets/:name', ...gate, async (req, res) => {
    const ownerGhii = ownerCoordinate(req.auth!, config.nodeId);
    // `host` binds the secret now instead of at its first use; the principal is recorded with it.
    const r = await putOwnerSecret(storage, config, ownerGhii, req.params.name as string, req.body?.value, {
      host: req.body?.host, by: resolveIdentity(req.auth!, config.nodeId),
    });
    if (!r.ok) { res.status(r.status).json(error(config.nodeId, r.code, r.message)); return; }
    // Owner-scoped: whose vault changed is nobody else's business, and an unscoped emit would wake
    // every open stream on the node with the news that SOMEBODY set a credential.
    emitChange('secrets', ownerGhii);
    res.json(success(config.nodeId, r.data));
  });

  // The address, without the value: set it, change it, or send null to remove it (2026-10-21).
  router.patch('/v1/secrets/:name', ...gate, async (req, res) => {
    const ownerGhii = ownerCoordinate(req.auth!, config.nodeId);
    if (!req.body || !('host' in req.body)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Send { "host": "api.example.com" } to set the address, or { "host": null } to remove it.'));
      return;
    }
    // Changing or removing an existing address is the account holder's in person (secaudit 2026-10, R62).
    const r = await setOwnerSecretHost(storage, ownerGhii, req.params.name as string, req.body.host, resolveIdentity(req.auth!, config.nodeId),
      { inPerson: callerOf(req, config.nodeId, storage).inPerson });
    if (!r.ok) { res.status(r.status).json(error(config.nodeId, r.code, r.message)); return; }
    emitChange('secrets', ownerGhii);
    res.json(success(config.nodeId, r.data));
  });

  // ── Approvals: the owner answers a refused first use (services/secret-approvals.ts) ──
  // Reading the question and answering it are the account holder's in person: an approval decides
  // where the person's credential goes, and no agent, app or visitor answers that for them.
  const inPerson = (req: Request, res: Response): string | null => {
    if (!callerOf(req, config.nodeId, storage).inPerson) {
      res.status(403).json(error(config.nodeId, 'IN_PERSON_ONLY',
        'Only the account holder, signed in, answers where a secret may be sent. Open this page while signed in to your own account.'));
      return null;
    }
    return ownerCoordinate(req.auth!, config.nodeId);
  };
  const keyOf = (src: Record<string, unknown> | undefined) => ({
    extension: typeof src?.extension === 'string' ? src.extension : '',
    host: typeof src?.host === 'string' ? src.host.toLowerCase() : '',
  });

  // The vault's own gate first (an owner session passes it), then the in-person test, so an app grant
  // or an agent is refused at the scope and again here.
  router.get('/v1/secrets/:name/approval', ...gate, async (req, res) => {
    const ownerGhii = inPerson(req, res);
    if (!ownerGhii) return;
    const k = keyOf(req.query as Record<string, unknown>);
    const view = await readApprovalRequest(storage, ownerGhii, req.params.name as string, k.extension, k.host);
    if (!view) { res.status(404).json(error(config.nodeId, 'APPROVAL_NOT_FOUND', 'Nothing about this extension and host is waiting on this secret.')); return; }
    res.json(success(config.nodeId, view));
  });

  router.post('/v1/secrets/:name/approvals', ...gate, async (req, res) => {
    const ownerGhii = inPerson(req, res);
    if (!ownerGhii) return;
    const k = keyOf(req.body);
    const r = await approveSecretUse(storage, ownerGhii, req.params.name as string, k.extension, k.host, resolveIdentity(req.auth!, config.nodeId));
    if (!r.ok) { res.status(r.status).json(error(config.nodeId, r.code, r.message)); return; }
    res.json(success(config.nodeId, { approval: r.approval }));
  });

  router.post('/v1/secrets/:name/approvals/decline', ...gate, async (req, res) => {
    const ownerGhii = inPerson(req, res);
    if (!ownerGhii) return;
    const k = keyOf(req.body);
    const declined = await declineSecretUse(storage, ownerGhii, req.params.name as string, k.extension, k.host);
    res.json(success(config.nodeId, { declined }));
  });

  // Withdraw an approval, or drop a waiting request: a narrowing, so secrets:manage is enough.
  router.delete('/v1/secrets/:name/approvals', ...gate, async (req, res) => {
    const ownerGhii = ownerCoordinate(req.auth!, config.nodeId);
    const q = req.query as Record<string, unknown>;
    const k = { ...keyOf(q), installer: typeof q.installer === 'string' ? q.installer : '' };
    if (!k.extension || !k.host || !k.installer) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Name the approval with extension, installer and host.'));
      return;
    }
    const withdrawn = await withdrawSecretApproval(storage, ownerGhii, req.params.name as string, k);
    if (!withdrawn) { res.status(404).json(error(config.nodeId, 'APPROVAL_NOT_FOUND', 'No approval for that extension, installer and host on this secret.')); return; }
    res.json(success(config.nodeId, { withdrawn: true }));
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
