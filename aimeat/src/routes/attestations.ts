/**
 * @file src/routes/attestations.ts
 * @description REST adapter for dual-signed attestations (TINKI phase 1): create (as a party),
 *   sign with your registered Ed25519 key, and read/verify publicly. The signing key is the same
 *   one the party's auth already uses, so no new key distribution exists — an agent signs a deed
 *   with the identity it already is.
 * @structure
 *   - POST /v1/attestations           create (creator must be a party; 2-4 parties)
 *   - GET  /v1/attestations/:id       public read + server-side signature verification
 *   - POST /v1/attestations/:id/sign  add the caller's signature (completes when all have signed)
 * @version-history
 *   v1.0.0 — 2026-08-06 — Initial attestation routes (TINKI phase 1)
 */
import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { createAttestation, getAttestation, signAttestation, verifyAttestation } from '../services/attestation.js';
import { CommerceError } from '../commerce/errors.js';

const CreateSchema = z.object({
  payload: z.unknown(),
  parties: z.array(z.string().min(3).max(300)).min(2).max(4),
  reference: z.string().min(1).max(200).optional(),
});

const SignSchema = z.object({
  signature: z.string().min(16).max(2000),
});

function sendError(res: Response, config: AimeatConfig, err: unknown): void {
  if (err instanceof CommerceError) {
    res.status(err.statusCode).json(error(config.nodeId, err.code, err.message));
    return;
  }
  res.status(500).json(error(config.nodeId, 'ATTESTATION_ERROR', err instanceof Error ? err.message : String(err)));
}

export function attestationsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // POST /v1/attestations — create; the creator must be one of the parties.
  router.post('/v1/attestations', requireAuth(), async (req, res) => {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json(error(config.nodeId, 'INVALID_ATTESTATION', parsed.error.message)); return; }
    try {
      const attestation = await createAttestation(storage, config, {
        payload: parsed.data.payload,
        parties: parsed.data.parties,
        reference: parsed.data.reference,
        creatorIdentity: resolveIdentity(req.auth!, config.nodeId),
      });
      res.status(201).json(success(config.nodeId, { attestation }, [
        { description: 'Sign', method: 'POST', url: `/v1/attestations/${attestation.id}/sign` },
      ]));
    } catch (err) { sendError(res, config, err); }
  });

  // GET /v1/attestations/:id — public read; the node re-verifies every signature on the way out.
  router.get('/v1/attestations/:id', async (req, res) => {
    try {
      const attestation = await getAttestation(storage, req.params.id as string);
      const verified = await verifyAttestation(storage, attestation);
      res.json(success(config.nodeId, { attestation, verified }));
    } catch (err) { sendError(res, config, err); }
  });

  // POST /v1/attestations/:id/sign — the caller signs as the identity they are.
  router.post('/v1/attestations/:id/sign', requireAuth(), async (req, res) => {
    const parsed = SignSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json(error(config.nodeId, 'INVALID_ATTESTATION', parsed.error.message)); return; }
    try {
      const attestation = await signAttestation(storage, config, {
        id: req.params.id as string,
        signerIdentity: resolveIdentity(req.auth!, config.nodeId),
        signature: parsed.data.signature,
      });
      res.json(success(config.nodeId, { attestation }));
    } catch (err) { sendError(res, config, err); }
  });

  return router;
}
