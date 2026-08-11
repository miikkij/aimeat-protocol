/**
 * @file verification.ts
 * @description Routes for identity verification (EUDIW, FTN), W3C VC issuance,
 *   MyData consent receipts, and trusted issuer management.
 * @version-history
 *   v1.0.0 — 2026-03-01 — Initial scaffold
 *   v2.0.0 — 2026-05-02 — Nonce validation, FTN OIDC authorize/callback, VC JWT format
 *   v2.1.0 — 2026-08-11 — Security audit H-1/H-7: the two routes that raise the human's
 *     verification level to 3 are behind requireOwnerPrincipal(). Both keyed off req.auth.owner,
 *     which is the human's account name on an agent, ecosystem or app-grant token, so a machine
 *     principal could stamp a state identity onto a person's record. The two callback routes are
 *     unauthenticated by design and bind to the owner recorded on the nonce instead.
 */

import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { EudiwService } from '../services/eudiw.js';
import type { VcIssuerService } from '../services/vc-issuer.js';
import type { MyDataReceiptService } from '../services/mydata-receipt.js';
import type { OidcClient } from '../services/oidc-client.js';
import { requireAuth, requireOwnerPrincipal, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';

export function verificationRouter(
  config: AimeatConfig,
  storage: Storage,
  eudiwService: EudiwService,
  vcIssuerService: VcIssuerService,
  mydataReceiptService: MyDataReceiptService,
  oidcClient: OidcClient | null,
): Router {
  const router = Router();

  // GET /v1/ghii/verify/eudiw/request — Generate OpenID4VP Authorization Request
  router.get('/v1/ghii/verify/eudiw/request', requireAuth(), async (req, res) => {
    try {
      if (!config.eudiwEnabled) {
        res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'EUDIW verification not available'));
        return;
      }
      const state = randomUUID();
      const authRequest = eudiwService.generateAuthorizationRequest(state);

      const nonceTtl = config.nonceTtlSeconds * 1000;
      await storage.createVerificationNonce({
        id: randomUUID(),
        owner: req.auth!.owner,
        type: 'eudiw',
        state,
        nonce: authRequest.nonce as string,
        redirectUri: '',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + nonceTtl).toISOString(),
      });

      res.json(success(config.nodeId, { authorizationRequest: authRequest, state }));
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
    }
  });

  // POST /v1/ghii/verify/eudiw — Verify VP Token (same-device flow, account holder only)
  // This writes verificationLevel 3 and the issuer's attributes onto the person's record. Who the
  // person is, proved by a wallet the person holds, is not something a connected machine says.
  router.post('/v1/ghii/verify/eudiw', requireAuth(), requireOwnerPrincipal(), async (req, res) => {
    try {
      if (!config.eudiwEnabled) {
        res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'EUDIW verification not available'));
        return;
      }
      const { vp_token, presentation_submission, state } = req.body;
      if (!vp_token) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'Missing vp_token'));
        return;
      }

      // Validate nonce/state if provided
      if (state) {
        const nonceRecord = await storage.getVerificationNonce(state);
        if (!nonceRecord) {
          res.status(400).json(error(config.nodeId, 'INVALID_STATE', 'Invalid or expired state parameter'));
          return;
        }
        if (nonceRecord.owner !== req.auth!.owner) {
          res.status(403).json(error(config.nodeId, 'STATE_MISMATCH', 'State does not belong to this user'));
          return;
        }
        if (new Date(nonceRecord.expiresAt) < new Date()) {
          await storage.deleteVerificationNonce(state);
          res.status(400).json(error(config.nodeId, 'STATE_EXPIRED', 'Verification request expired'));
          return;
        }
        await storage.deleteVerificationNonce(state);
      }

      const result = await eudiwService.verifyPresentation(vp_token, presentation_submission ?? {});
      if (!result.valid) {
        const statusCode = result.error === 'Credential expired' ? 401 : result.error === 'Untrusted issuer' ? 403 : 400;
        res.status(statusCode).json(error(config.nodeId, 'VERIFICATION_FAILED', result.error ?? 'Verification failed'));
        return;
      }

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
      emitChange('verification');
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
    }
  });

  // POST /v1/ghii/verify/eudiw/callback — OpenID4VP Wallet Callback (cross-device, unauthenticated)
  router.post('/v1/ghii/verify/eudiw/callback', async (req, res) => {
    try {
      if (!config.eudiwEnabled) {
        res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'EUDIW verification not available'));
        return;
      }

      const { vp_token, state } = req.body;
      let { presentation_submission } = req.body;

      if (!vp_token) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'Missing vp_token'));
        return;
      }
      if (!state) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'Missing state parameter'));
        return;
      }

      const nonceRecord = await storage.getVerificationNonce(state);
      if (!nonceRecord) {
        res.status(400).json(error(config.nodeId, 'INVALID_STATE', 'Invalid or expired state parameter'));
        return;
      }
      if (new Date(nonceRecord.expiresAt) < new Date()) {
        await storage.deleteVerificationNonce(state);
        res.status(400).json(error(config.nodeId, 'STATE_EXPIRED', 'Verification request expired'));
        return;
      }
      await storage.deleteVerificationNonce(state);

      if (typeof presentation_submission === 'string') {
        try {
          presentation_submission = JSON.parse(presentation_submission);
        } catch {
          res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'Invalid presentation_submission JSON'));
          return;
        }
      }

      const result = await eudiwService.verifyPresentation(vp_token, presentation_submission ?? {});
      if (!result.valid) {
        const statusCode = result.error === 'Credential expired' ? 401 : result.error === 'Untrusted issuer' ? 403 : 400;
        res.status(statusCode).json(error(config.nodeId, 'VERIFICATION_FAILED', result.error ?? 'Verification failed'));
        return;
      }

      const ownerName = nonceRecord.owner;
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
      emitChange('verification');
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
    }
  });

  // GET /v1/ghii/verify/ftn/authorize — Initiate FTN OIDC flow
  router.get('/v1/ghii/verify/ftn/authorize', requireAuth(), async (req, res) => {
    try {
      if (!config.ftnEnabled || !oidcClient?.initialized) {
        res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'FTN verification not available'));
        return;
      }

      const authRequest = oidcClient.createAuthRequest();
      const nonceTtl = config.nonceTtlSeconds * 1000;
      await storage.createVerificationNonce({
        id: randomUUID(),
        owner: req.auth!.owner,
        type: 'ftn',
        state: authRequest.state,
        nonce: authRequest.nonce,
        redirectUri: '',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + nonceTtl).toISOString(),
      });

      res.json(success(config.nodeId, {
        authorizationUrl: authRequest.authorizationUrl,
        state: authRequest.state,
      }));
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
    }
  });

  // GET /v1/ghii/verify/ftn/callback — FTN OIDC redirect callback
  router.get('/v1/ghii/verify/ftn/callback', async (req, res) => {
    try {
      if (!config.ftnEnabled || !oidcClient?.initialized) {
        res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'FTN verification not available'));
        return;
      }

      const code = req.query.code as string | undefined;
      const state = req.query.state as string | undefined;
      if (!code || !state) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'Missing code or state'));
        return;
      }

      const nonceRecord = await storage.getVerificationNonce(state);
      if (!nonceRecord) {
        res.status(400).json(error(config.nodeId, 'INVALID_STATE', 'Invalid or expired state'));
        return;
      }
      if (new Date(nonceRecord.expiresAt) < new Date()) {
        await storage.deleteVerificationNonce(state);
        res.status(400).json(error(config.nodeId, 'STATE_EXPIRED', 'Verification request expired'));
        return;
      }

      const tokenResult = await oidcClient.exchangeCode(code, state, nonceRecord.nonce);
      await storage.deleteVerificationNonce(state);

      if (!tokenResult.valid || !tokenResult.claims) {
        res.status(400).json(error(config.nodeId, 'VERIFICATION_FAILED', tokenResult.error ?? 'FTN verification failed'));
        return;
      }

      const ghii = await storage.getGHIIByOwner(nonceRecord.owner);
      if (!ghii) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'GHII profile not found'));
        return;
      }

      const pidClaim = config.nationalEidPidClaim;
      const pidValue = tokenResult.claims[pidClaim] as string | undefined;
      let credentialHash = '';
      if (pidValue) {
        credentialHash = createHash('sha256').update(pidValue).digest('hex');
      }

      const verifiedAttributes = ['given_name', 'family_name', 'birthdate', pidClaim]
        .filter(k => tokenResult.claims![k] !== undefined);

      await storage.updateGHII(ghii.ghii, {
        verificationLevel: 3,
        ftnVerified: true,
        verificationMethod: 'eidas',
        verifiedAttributes,
        verificationIssuer: config.ftnProviderUrl,
        verificationCredentialHash: credentialHash,
        updatedAt: new Date().toISOString(),
      });

      if (req.accepts('html')) {
        res.redirect(`${config.baseUrl}/v1/profile`);
      } else {
        res.json(success(config.nodeId, {
          ghii: ghii.ghii,
          verificationLevel: 3,
          verificationMethod: 'ftn',
          ftnVerified: true,
          verifiedAttributes,
          verifiedAt: new Date().toISOString(),
        }));
      }
      emitChange('verification');
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
    }
  });

  // POST /v1/ghii/verify/ftn — Finnish Trust Network verification (manual/API path, account
  // holder only). Same reason as the EUDIW route above: it stamps verification level 3.
  router.post('/v1/ghii/verify/ftn', requireAuth(), requireOwnerPrincipal(), async (req, res) => {
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
      emitChange('verification');
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

      if (ghiiRecord.ownerName !== req.auth!.owner) {
        res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Can only request own credential'));
        return;
      }

      const format = (req.query.format as string) ?? 'json';
      if (format === 'jwt') {
        const signedJwt = await vcIssuerService.issueSignedCredential(ghiiRecord);
        res.json(success(config.nodeId, { credential: signedJwt, format: 'vc+ld+jwt' }));
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
      emitChange('verification');
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
