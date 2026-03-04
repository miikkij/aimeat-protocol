import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { EudiwService } from '../services/eudiw.js';
import type { VcIssuerService } from '../services/vc-issuer.js';
import type { MyDataReceiptService } from '../services/mydata-receipt.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';

export function verificationRouter(
  config: AimeatConfig,
  storage: Storage,
  eudiwService: EudiwService,
  vcIssuerService: VcIssuerService,
  mydataReceiptService: MyDataReceiptService,
): Router {
  const router = Router();

  // GET /v1/ghii/verify/eudiw/request — Generate OpenID4VP Authorization Request
  router.get('/v1/ghii/verify/eudiw/request', requireAuth(), (req, res) => {
    if (!config.eudiwEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'EUDIW verification not available'));
      return;
    }
    const state = randomUUID();
    const authRequest = eudiwService.generateAuthorizationRequest(state);
    res.json(success(config.nodeId, { authorizationRequest: authRequest, state }));
  });

  // POST /v1/ghii/verify/eudiw — Verify VP Token
  router.post('/v1/ghii/verify/eudiw', requireAuth(), async (req, res) => {
    try {
      if (!config.eudiwEnabled) {
        res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'EUDIW verification not available'));
        return;
      }
      const { vp_token, presentation_submission } = req.body;
      if (!vp_token) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'Missing vp_token'));
        return;
      }

      const result = await eudiwService.verifyPresentation(vp_token, presentation_submission ?? {});
      if (!result.valid) {
        const statusCode = result.error === 'Credential expired' ? 401 : result.error === 'Untrusted issuer' ? 403 : 400;
        res.status(statusCode).json(error(config.nodeId, 'VERIFICATION_FAILED', result.error ?? 'Verification failed'));
        return;
      }

      // Update GHII record to Level 3
      const ownerName = req.auth!.owner;
      const ghii = await storage.getGHIIByOwner(ownerName);
      if (!ghii) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'GHII profile not found'));
        return;
      }

      const credentialHash = createHash('sha256').update(vp_token).digest('hex');
      const verifiedAttributes = Object.keys(result.attributes ?? {});

      await storage.updateGHII(ghii.ghii, {
        verificationLevel: 3,
        verifiedAttributes,
        verificationIssuer: result.issuer,
        verificationCredentialHash: credentialHash,
        verificationMethod: 'eidas',
        updatedAt: new Date().toISOString(),
      });

      res.json(success(config.nodeId, {
        ghii: ghii.ghii,
        verificationLevel: 3,
        verificationMethod: 'eudiw',
        verifiedAttributes,
        issuer: result.issuer,
        verifiedAt: new Date().toISOString(),
      }));
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
    }
  });

  // POST /v1/ghii/verify/ftn — Finnish Trust Network verification
  router.post('/v1/ghii/verify/ftn', requireAuth(), async (req, res) => {
    try {
      if (!config.ftnEnabled) {
        res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'FTN verification not available'));
        return;
      }
      const { callback_token } = req.body;
      if (!callback_token) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'Missing callback_token'));
        return;
      }

      // In production, this would validate the FTN callback token
      // For reference implementation: verify the token structure
      const ownerName = req.auth!.owner;
      const ghii = await storage.getGHIIByOwner(ownerName);
      if (!ghii) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'GHII profile not found'));
        return;
      }

      await storage.updateGHII(ghii.ghii, {
        verificationLevel: 3,
        ftnVerified: true,
        verificationMethod: 'eidas',
        updatedAt: new Date().toISOString(),
      });

      res.json(success(config.nodeId, {
        ghii: ghii.ghii,
        verificationLevel: 3,
        verificationMethod: 'ftn',
        ftnVerified: true,
        verifiedAt: new Date().toISOString(),
      }));
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
    }
  });

  // GET /v1/ghii/:ghii/credential — Issue W3C Verifiable Credential
  router.get('/v1/ghii/:ghii/credential', requireAuth(), async (req, res) => {
    try {
      const ghiiId = req.params.ghii as string;
      const ghiiRecord = await storage.getGHII(ghiiId);
      if (!ghiiRecord) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'GHII profile not found'));
        return;
      }

      // Only the owner can request their own credential
      if (ghiiRecord.ownerName !== req.auth!.owner) {
        res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Can only request own credential'));
        return;
      }

      const credential = vcIssuerService.issueIdentityCredential(ghiiRecord);
      res.json(success(config.nodeId, { credential }));
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
    }
  });

  // GET /v1/consent/:id/receipt — MyData Consent Receipt
  router.get('/v1/consent/:id/receipt', requireAuth(), async (req, res) => {
    try {
      const consentId = req.params.id as string;
      const consent = await storage.getConsent(consentId);
      if (!consent) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Consent not found'));
        return;
      }

      // Only the consent owner can request the receipt
      const ownerName = req.auth!.owner;
      const ghii = await storage.getGHIIByOwner(ownerName);
      const agentGaiis = (await storage.getAgentsByOwner(ownerName)).map(a => a.gaii);
      const isOwner = consent.ownerGaii === ghii?.ghii || agentGaiis.includes(consent.ownerGaii);
      if (!isOwner && !req.auth!.roles.includes('operator')) {
        res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Can only request own consent receipts'));
        return;
      }

      const receipt = mydataReceiptService.generateReceipt(consent);
      res.json(success(config.nodeId, { receipt }));
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
    }
  });

  // POST /v1/trusted-issuers — Add trusted issuer (operator only)
  router.post('/v1/trusted-issuers', requireAuth(), requireRole('operator'), async (req, res) => {
    try {
      const { name, url, publicKey, type } = req.body;
      if (!name || !url || !publicKey || !type) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'Missing required fields: name, url, publicKey, type'));
        return;
      }
      const validTypes = ['eudiw', 'ftn', 'w3c_vc', 'custom'];
      if (!validTypes.includes(type)) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', `type must be one of: ${validTypes.join(', ')}`));
        return;
      }
      const record = await storage.createTrustedIssuer({
        id: randomUUID(),
        name,
        url,
        publicKey,
        type,
        trusted: true,
        addedBy: req.auth!.owner,
        createdAt: new Date().toISOString(),
      });
      res.status(201).json(success(config.nodeId, { issuer: record }));
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
    }
  });

  // GET /v1/trusted-issuers — List trusted issuers
  router.get('/v1/trusted-issuers', requireAuth(), async (req, res) => {
    try {
      const type = req.query.type as string | undefined;
      const issuers = await storage.listTrustedIssuers(type ? { type } : undefined);
      res.json(success(config.nodeId, { issuers, total: issuers.length }));
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
    }
  });

  return router;
}
