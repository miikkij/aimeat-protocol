/**
 * @file src/routes/totp.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Routes for TOTP two-factor authentication on GHII accounts: setup
 *   (generate secret + QR + backup codes), verify/activate, disable, and backup-code
 *   handling. Gated on config.totpEnabled and driven by the totp service; secrets are
 *   stored encrypted.
 *
 * @structure
 *   - totpRouter(config, storage): Router mounting the /v1/ghii/totp/* endpoints
 *   - POST /v1/ghii/totp/setup: create encrypted secret, backup codes, and provisioning URI/QR
 *
 * @version-history
 *   v1.1.0 — 2026-08-11 — Security audit H-1/H-7: all four routes are behind
 *     requireOwnerPrincipal(). They ran on requireAuth() alone and keyed off req.auth.owner, so an
 *     agent, a GEAI or a granted app could arm a second factor on the human's account with a secret
 *     only it held — and removing it needs a code from that secret, which the human does not have.
 *     There is no operator TOTP reset, so this was a lock-out with no key.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireOwnerPrincipal } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { setupTotp, validateTotpCode, validateBackupCode, generateBackupCodes } from '../services/totp.js';
import type { TotpConfig } from '../services/totp.js';

export function totpRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  const totpConfig: TotpConfig = {
    issuer: config.totpIssuer,
    algorithm: 'SHA1' as const,
    digits: 6 as const,
    period: config.totpPeriod,
    window: config.totpWindow,
    backupCodeCount: config.totpBackupCodeCount,
    encryptionKey: config.totpSecretEncryptionKey
      ? Buffer.from(config.totpSecretEncryptionKey, 'hex')
      : undefined,
  };

  // POST /v1/ghii/totp/setup — Start TOTP setup (account holder only)
  // The secret is returned to whoever calls this, and it becomes the account's second factor. It
  // belongs in the hands of the person who will be asked for the codes.
  router.post('/v1/ghii/totp/setup', requireAuth(), requireOwnerPrincipal(), async (req, res) => {
    if (!config.totpEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'TOTP two-factor authentication is not enabled on this node'));
      return;
    }

    const ghiiRecord = await storage.getGHIIByOwner(req.auth!.owner ?? '');
    if (!ghiiRecord) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No GHII profile found for your identity'));
      return;
    }

    if (ghiiRecord.totpEnabled === true) {
      res.status(409).json(error(config.nodeId, 'TOTP_ALREADY_ENABLED', 'TOTP is already enabled for this account'));
      return;
    }

    const result = await setupTotp(ghiiRecord.username, totpConfig);

    // Save encrypted secret and hashed backup codes, but keep totpEnabled = false until verified
    await storage.updateGHII(ghiiRecord.ghii, {
      totpSecret: result.encryptedSecret,
      totpBackupCodes: result.hashedBackupCodes,
    });

    res.json(success(config.nodeId, {
      totp_secret: result.secret,
      totp_uri: result.uri,
      qr_data_url: result.qrDataUrl,
      backup_codes: result.backupCodes,
      note: 'Scan the QR code with your authenticator app, then verify with a code from the app to activate TOTP.',
    }, [
      { description: 'Verify and activate TOTP', method: 'POST', url: '/v1/ghii/totp/verify' },
    ]));
    emitChange('totp');
  });

  // POST /v1/ghii/totp/verify — Verify and activate TOTP (account holder only)
  router.post('/v1/ghii/totp/verify', requireAuth(), requireOwnerPrincipal(), async (req, res) => {
    const ghiiRecord = await storage.getGHIIByOwner(req.auth!.owner ?? '');
    if (!ghiiRecord) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No GHII profile found for your identity'));
      return;
    }

    if (!ghiiRecord.totpSecret) {
      res.status(400).json(error(config.nodeId, 'TOTP_NOT_SETUP', 'Two-step sign-in is not set up yet. Set it up first in Profile → Security, then come back.'));
      return;
    }

    if (ghiiRecord.totpEnabled === true) {
      res.status(409).json(error(config.nodeId, 'TOTP_ALREADY_ENABLED', 'TOTP is already enabled for this account'));
      return;
    }

    const { code } = req.body ?? {};
    if (!code || typeof code !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'code is required'));
      return;
    }

    const result = validateTotpCode(ghiiRecord.totpSecret, code, totpConfig);
    if (!result.valid) {
      res.status(401).json(error(config.nodeId, 'INVALID_TOTP', 'Invalid TOTP code. Please try again.'));
      return;
    }

    await storage.updateGHII(ghiiRecord.ghii, {
      totpEnabled: true,
    });

    res.json(success(config.nodeId, {
      status: 'totp_enabled',
      note: 'TOTP two-factor authentication is now active.',
    }, [
      { description: 'Regenerate backup codes', method: 'POST', url: '/v1/ghii/totp/backup-codes' },
      { description: 'Disable TOTP', method: 'DELETE', url: '/v1/ghii/totp' },
    ]));
    emitChange('totp');
  });

  // DELETE /v1/ghii/totp — Disable TOTP (account holder only)
  router.delete('/v1/ghii/totp', requireAuth(), requireOwnerPrincipal(), async (req, res) => {
    const ghiiRecord = await storage.getGHIIByOwner(req.auth!.owner ?? '');
    if (!ghiiRecord) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No GHII profile found for your identity'));
      return;
    }

    if (!ghiiRecord.totpEnabled) {
      res.status(400).json(error(config.nodeId, 'TOTP_NOT_ENABLED', 'TOTP is not enabled for this account'));
      return;
    }

    const { code, backup_code } = req.body ?? {};

    let verified = false;

    // Try TOTP code first
    if (code && typeof code === 'string' && ghiiRecord.totpSecret) {
      const totpResult = validateTotpCode(ghiiRecord.totpSecret, code, totpConfig);
      if (totpResult.valid) verified = true;
    }

    // Try backup code if TOTP code was not provided or invalid
    if (!verified && backup_code && typeof backup_code === 'string' && ghiiRecord.totpBackupCodes) {
      const backupResult = validateBackupCode(backup_code, ghiiRecord.totpBackupCodes);
      if (backupResult.valid) verified = true;
    }

    if (!verified) {
      res.status(401).json(error(config.nodeId, 'INVALID_TOTP', 'A valid TOTP code or backup code is required to disable TOTP.'));
      return;
    }

    await storage.updateGHII(ghiiRecord.ghii, {
      totpEnabled: false,
      totpSecret: undefined,
      totpBackupCodes: undefined,
    });

    res.json(success(config.nodeId, {
      status: 'totp_disabled',
    }, [
      { description: 'Re-enable TOTP', method: 'POST', url: '/v1/ghii/totp/setup' },
    ]));
    emitChange('totp');
  });

  // POST /v1/ghii/totp/backup-codes — Regenerate backup codes (account holder only)
  // Regenerating invalidates the codes the person wrote down, so it is the same decision as
  // arming the factor in the first place.
  router.post('/v1/ghii/totp/backup-codes', requireAuth(), requireOwnerPrincipal(), async (req, res) => {
    const ghiiRecord = await storage.getGHIIByOwner(req.auth!.owner ?? '');
    if (!ghiiRecord) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No GHII profile found for your identity'));
      return;
    }

    if (!ghiiRecord.totpEnabled) {
      res.status(400).json(error(config.nodeId, 'TOTP_NOT_ENABLED', 'TOTP is not enabled for this account'));
      return;
    }

    const { code } = req.body ?? {};
    if (!code || typeof code !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'code is required'));
      return;
    }

    if (!ghiiRecord.totpSecret) {
      res.status(400).json(error(config.nodeId, 'TOTP_NOT_SETUP', 'TOTP secret is missing'));
      return;
    }

    const totpResult = validateTotpCode(ghiiRecord.totpSecret, code, totpConfig);
    if (!totpResult.valid) {
      res.status(401).json(error(config.nodeId, 'INVALID_TOTP', 'Invalid TOTP code. Please try again.'));
      return;
    }

    const newCodes = generateBackupCodes(config.totpBackupCodeCount);

    await storage.updateGHII(ghiiRecord.ghii, {
      totpBackupCodes: newCodes.hashed,
    });

    res.json(success(config.nodeId, {
      backup_codes: newCodes.plain,
      note: 'Save these backup codes in a secure location. Previous backup codes are now invalid.',
    }));
    emitChange('totp');
  });

  return router;
}
