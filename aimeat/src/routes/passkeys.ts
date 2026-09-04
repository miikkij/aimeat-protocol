/**
 * @file src/routes/passkeys.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The passkey doors: register a device on an account, list and manage the devices, and
 *   sign in with one. A passkey is a sign-in method of its OWN here, not a second factor on top of
 *   the password — the person proves themselves to their own device and the device proves itself to
 *   this node. The password and two-step sign-in stay beside it for whoever has no device.
 *
 *   FOUR OF THESE NEED A SESSION AND TWO MUST NOT HAVE ONE. Managing your devices is an account
 *   change, so it sits behind requireOwnerPrincipal() for the same reason the TOTP routes do: an
 *   agent, a granted app or a GEAI carries the human's account name in `owner`, and one that could
 *   register a device would hold a key to the account the human never made. The two login doors take
 *   no credential by definition, and are rate-limited on the login tier because of it.
 *
 *   THE SESSION IS MINTED BY THE SAME CODE AS A PASSWORD LOGIN (routes/ghii/owner-session.ts), so a
 *   passkey sign-in cannot drift from a password one: same deactivation refusal, same login count,
 *   same owner key handling, same response.
 *
 * @structure
 *   - POST /v1/ghii/passkeys/register/options|verify: add a device
 *   - GET /v1/ghii/passkeys · PATCH|DELETE /v1/ghii/passkeys/:id: the person's own list
 *   - POST /v1/ghii/login/passkey/options|verify: sign in with a device
 * @usage app.use(passkeysRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireOwnerPrincipal } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { recordAccountEvent } from '../services/account-events.js';
import { resolveIdentity } from '../utils/gaii.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { beginRegistration, finishRegistration, beginLogin, finishLogin } from '../services/passkeys.js';
import { completeOwnerLogin } from './ghii/owner-session.js';
import type { PasskeyRecord } from '../storage/types/passkeys.js';

/** What a person sees about their own device. Never the public key: it is ours, not theirs to read. */
function publicView(p: PasskeyRecord) {
  return {
    id: p.id,
    label: p.label,
    transports: p.transports,
    backed_up: p.backedUp,
    created_at: p.createdAt,
    last_used_at: p.lastUsedAt,
  };
}

export function passkeysRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // Both login doors take no credential, so both are limited, but not by the same number: a passkey
  // sign-in is TWO requests where a password sign-in is one. Putting the login tier on both would
  // give an office behind one address half as many passkey sign-ins as password ones, which would
  // punish the better credential.
  //
  // `verify` carries the login tier: it mints the session and it costs a signature check. `options`
  // hands out a random value and does one indexed read, and it answers a name nobody has exactly
  // like a name that exists, so repeating it teaches nothing; its limit is about cost alone and
  // sits four times higher, which keeps one sign-in at one unit of the tier that matters.
  const verifyLimit = rateLimit({ max: config.loginRateLimitMax, windowMs: config.loginRateLimitWindowMs });
  const optionsLimit = rateLimit({ max: config.loginRateLimitMax * 4, windowMs: config.loginRateLimitWindowMs });

  // ── Adding a device to an account that is already signed in ──

  router.post('/v1/ghii/passkeys/register/options', requireAuth(), requireOwnerPrincipal(), async (req, res) => {
    const owner = req.auth!.owner as string;
    const ghiiRecord = await storage.getGHIIByOwner(owner);
    if (!ghiiRecord) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No profile found for your identity'));
      return;
    }
    const r = await beginRegistration(config, storage, owner, ghiiRecord.displayName ?? owner);
    if (!r.ok) { res.status(r.status).json(error(config.nodeId, r.code, r.message)); return; }
    res.json(success(config.nodeId, r.data, [
      { description: 'Finish adding this device', method: 'POST', url: '/v1/ghii/passkeys/register/verify' },
    ]));
  });

  router.post('/v1/ghii/passkeys/register/verify', requireAuth(), requireOwnerPrincipal(), async (req, res) => {
    const owner = req.auth!.owner as string;
    const ghiiRecord = await storage.getGHIIByOwner(owner);
    if (!ghiiRecord) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No profile found for your identity'));
      return;
    }
    const { ceremony_id, response, label } = req.body ?? {};
    if (typeof ceremony_id !== 'string' || !response || typeof response !== 'object') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ceremony_id and response are required'));
      return;
    }

    const r = await finishRegistration(config, storage, {
      ceremonyId: ceremony_id,
      owner,
      ghii: ghiiRecord.ghii,
      label: typeof label === 'string' ? label : '',
      response,
    });
    if (!r.ok) { res.status(r.status).json(error(config.nodeId, r.code, r.message)); return; }

    void recordAccountEvent(storage, {
      ownerGhii: ghiiRecord.ghii, kind: 'passkey_added', actorGaii: resolveIdentity(req.auth!, config.nodeId),
      data: { label: r.data.passkey.label }, link: '/v1/profile?tab=security', subject: 'passkey',
    }, config);

    emitChange('passkeys');
    res.status(201).json(success(config.nodeId, { passkey: publicView(r.data.passkey) }));
  });

  // ── The person's own list of devices ──

  router.get('/v1/ghii/passkeys', requireAuth(), requireOwnerPrincipal(), async (req, res) => {
    const keys = await storage.listPasskeysByOwner(req.auth!.owner as string);
    res.json(success(config.nodeId, {
      passkeys: keys.map(publicView),
      count: keys.length,
      available: config.passkeyEnabled,
    }));
  });

  router.patch('/v1/ghii/passkeys/:id', requireAuth(), requireOwnerPrincipal(), async (req, res) => {
    const label = typeof req.body?.label === 'string' ? req.body.label.trim().slice(0, 80) : '';
    if (!label) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'label is required'));
      return;
    }
    const done = await storage.renamePasskey(req.params.id as string, req.auth!.owner as string, label);
    if (!done) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No passkey of yours with that id'));
      return;
    }
    emitChange('passkeys');
    res.json(success(config.nodeId, { id: req.params.id, label }));
  });

  router.delete('/v1/ghii/passkeys/:id', requireAuth(), requireOwnerPrincipal(), async (req, res) => {
    const owner = req.auth!.owner as string;
    const key = await storage.getPasskey(req.params.id as string);
    const done = await storage.deletePasskey(req.params.id as string, owner);
    if (!done) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No passkey of yours with that id'));
      return;
    }
    const ghiiRecord = await storage.getGHIIByOwner(owner);
    if (ghiiRecord) {
      void recordAccountEvent(storage, {
        ownerGhii: ghiiRecord.ghii, kind: 'passkey_removed', actorGaii: resolveIdentity(req.auth!, config.nodeId),
        data: { label: key?.label ?? '' }, link: '/v1/profile?tab=security', subject: 'passkey',
      }, config);
    }
    emitChange('passkeys');
    res.json(success(config.nodeId, { id: req.params.id, removed: true }));
  });

  // ── Signing in with a device ──

  // A username is optional. Without one the ceremony is discoverable: the device offers whatever it
  // holds for this domain and its answer names the account, which is the whole point of a passkey.
  router.post('/v1/ghii/login/passkey/options', optionsLimit, async (req, res) => {
    const username = typeof req.body?.username === 'string' ? req.body.username : undefined;
    const r = await beginLogin(config, storage, username);
    if (!r.ok) { res.status(r.status).json(error(config.nodeId, r.code, r.message)); return; }
    res.json(success(config.nodeId, r.data, [
      { description: 'Finish signing in', method: 'POST', url: '/v1/ghii/login/passkey/verify' },
    ]));
  });

  router.post('/v1/ghii/login/passkey/verify', verifyLimit, async (req, res) => {
    const { ceremony_id, response, want_owner_key } = req.body ?? {};
    if (typeof ceremony_id !== 'string' || !response || typeof response !== 'object') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ceremony_id and response are required'));
      return;
    }

    const r = await finishLogin(config, storage, { ceremonyId: ceremony_id, response });
    if (!r.ok) { res.status(r.status).json(error(config.nodeId, r.code, r.message)); return; }

    const ghiiRecord = await storage.getGHIIByOwner(r.data.passkey.owner);
    if (!ghiiRecord) {
      // The credential outlived its account. Refuse rather than mint a session for nobody.
      res.status(401).json(error(config.nodeId, 'PASSKEY_UNKNOWN', 'That device is not registered here. Sign in with your password, then add it under Account security.'));
      return;
    }

    // From here it is a login like any other, in the same code the password door runs.
    await completeOwnerLogin(config, storage, req, res, {
      ghiiRecord,
      loginName: r.data.passkey.owner,
      wantsOwnerKey: want_owner_key === true,
    });
  });

  return router;
}
