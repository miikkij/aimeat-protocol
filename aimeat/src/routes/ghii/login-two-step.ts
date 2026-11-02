/**
 * @file src/routes/ghii/login-two-step.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Required two-step sign-in (services/sign-in-policy.ts): the enrolment a person makes
 *   when the operator requires two-step sign-in and their account has no code app set up yet.
 *
 *   HOW IT STARTS. The password sign-in (POST /v1/ghii/login) and the emailed link
 *   (GET /v1/ghii/magic-link/open) check the credential as before. For an account the policy covers
 *   and that has no TOTP armed, they open no session: the password route answers 403
 *   TWO_STEP_SETUP_REQUIRED with `setup_token` in the error details (twoStepSetupAnswer), and the link
 *   route redirects to the front page with `?auth_step=two_step_setup#two_step=<token>`
 *   (twoStepSetupRedirect), where the sign-in dialog opens on the enrolment step. A fragment is not
 *   sent to any server and not in a Referer header.
 *
 *   POST /v1/ghii/login/two-step/start { setup_token } makes a new TOTP secret with the profile's own
 *   setup (services/totp.ts setupTotp), keeps it encrypted in the ticket, and answers { secret,
 *   otpauth_url, qr_data_url, expires_at }. A second start replaces the secret.
 *
 *   POST /v1/ghii/login/two-step/finish { setup_token, code } checks the code against that secret
 *   with the account's TOTP lock (a wrong code counts toward it, and the ticket stays for another try),
 *   spends the ticket, arms TOTP on the account with fresh backup codes, and completes the sign-in
 *   through completeOwnerLogin, the password route's own end, adding `backup_codes` (shown once) and,
 *   for a link, `redirect`. Every refusal comes before the write (invariant 14).
 * @structure twoStepSetupAnswer() · twoStepSetupRedirect() · registerLoginTwoStepRoutes(router, config, storage)
 * @usage registerLoginTwoStepRoutes(router, config, storage);
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial (IT review: an operator can require two-step sign-in).
 */
import type { Router, Request, Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, GHIIRecord } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { emitChange } from '../../services/event-bus.js';
import { recordAccountEvent } from '../../services/account-events.js';
import { setupTotp, generateBackupCodes, totpConfigOf, TotpEncryptionUnavailableError } from '../../services/totp.js';
import { checkEnrolmentCode } from '../../services/password-check.js';
import { twoStepArmed } from '../../services/passkeys.js';
import { TWO_STEP_SETUP_REQUIRED } from '../../services/sign-in-policy.js';
import { issueSetupToken, readSetupTicket, storePendingSecret, spendSetupTicket, SETUP_TOKEN_TTL_MS } from '../../services/two-step-setup.js';
import { completeOwnerLogin } from './owner-session.js';
import { TwoStepStartSchema, TwoStepFinishSchema, validateBody } from '../../models/schemas.js';

const WHY = 'The operator of this server requires two-step sign-in for this account. Set up an authenticator app to finish signing in.';
const EXPIRED = 'The time to set up two-step sign-in has run out, or this step has already ended. Sign in again.';

/** The password route's answer for a covered account without TOTP: no session, a setup token. */
export async function twoStepSetupAnswer(storage: Storage, config: AimeatConfig, res: Response, ghii: GHIIRecord): Promise<void> {
  const { token, expiresAt } = await issueSetupToken(storage, ghii);
  res.set('Cache-Control', 'no-store');
  res.status(403).json(error(config.nodeId, TWO_STEP_SETUP_REQUIRED, WHY, undefined, {
    setup_token: token, expires_at: expiresAt, expires_in: SETUP_TOKEN_TTL_MS / 1000,
    start: '/v1/ghii/login/two-step/start', finish: '/v1/ghii/login/two-step/finish',
  }));
}

/** The emailed link's answer for a covered account without TOTP: the front page's enrolment step. */
export async function twoStepSetupRedirect(storage: Storage, config: AimeatConfig, res: Response, ghii: GHIIRecord, back: string | null): Promise<void> {
  const { token } = await issueSetupToken(storage, ghii, back);
  res.redirect(`${config.baseUrl}/?auth_step=two_step_setup#two_step=${token}`);
}

export function registerLoginTwoStepRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  const limit = rateLimit({ max: 20, windowMs: 10 * 60 * 1000, keyBy: 'ip' });
  const totpConfig = totpConfigOf(config);

  /** The ticket and its account, or the answer already sent. */
  async function ticketAndAccount(req: Request, res: Response) {
    res.set('Cache-Control', 'no-store');
    const ticket = await readSetupTicket(storage, req.body?.setup_token);
    const ghii = ticket ? await storage.getGHII(`${ticket.owner}@${config.nodeId}`) : null;
    if (!ticket || !ghii) {
      res.status(401).json(error(config.nodeId, 'SETUP_TOKEN_EXPIRED', EXPIRED));
      return null;
    }
    const owner = await storage.getOwner(ghii.ownerName);
    if (owner?.disabledAt) {
      await spendSetupTicket(storage, ticket);
      res.status(403).json(error(config.nodeId, 'ACCOUNT_DISABLED', 'This account has been deactivated'));
      return null;
    }
    if (twoStepArmed(ghii)) {
      // Armed some other way since the token was made: the ordinary sign-in with a code is the way in.
      await spendSetupTicket(storage, ticket);
      res.status(409).json(error(config.nodeId, 'TOTP_ALREADY_ENABLED', 'Two-step sign-in is already set up for this account. Sign in again with your code.'));
      return null;
    }
    return { ticket, ghii };
  }

  // POST /v1/ghii/login/two-step/start — the secret and the QR code for the authenticator app.
  router.post('/v1/ghii/login/two-step/start', limit, validateBody(TwoStepStartSchema, config.nodeId), async (req, res) => {
    if (!config.totpEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Two-step sign-in is switched off on this server, so it cannot be set up here. Ask its operator.'));
      return;
    }
    const found = await ticketAndAccount(req, res);
    if (!found) return;
    let made: Awaited<ReturnType<typeof setupTotp>>;
    try {
      made = await setupTotp(found.ghii.username, totpConfig);
    } catch (err) {
      if (err instanceof TotpEncryptionUnavailableError) {
        res.status(err.status).json(error(config.nodeId, err.code, err.message));
        return;
      }
      throw err;
    }
    await storePendingSecret(storage, found.ticket, made.encryptedSecret);
    res.json(success(config.nodeId, {
      secret: made.secret,
      otpauth_url: made.uri,
      qr_data_url: made.qrDataUrl,
      expires_at: found.ticket.expiresAt,
    }, [{ description: 'Send the first code from the app', method: 'POST', url: '/v1/ghii/login/two-step/finish' }]));
  });

  // POST /v1/ghii/login/two-step/finish — the first code arms TOTP and opens the session.
  router.post('/v1/ghii/login/two-step/finish', limit, validateBody(TwoStepFinishSchema, config.nodeId), async (req, res) => {
    const found = await ticketAndAccount(req, res);
    if (!found) return;
    const { ticket, ghii } = found;
    if (!ticket.pendingSecret) {
      res.status(409).json(error(config.nodeId, 'TWO_STEP_NOT_STARTED', 'The setup has not started yet. Start it first, so your authenticator app gets its key, then enter the code the app shows.'));
      return;
    }
    const code = typeof req.body?.code === 'string' ? req.body.code.replace(/\s+/g, '') : req.body?.code;
    const check = await checkEnrolmentCode(storage, config, ghii, ticket.pendingSecret, code);
    if (!check.ok) {
      res.status(check.status).json(error(config.nodeId, check.code, check.message));
      return;
    }
    // Single use: only the request whose delete removed the ticket goes on to write.
    if (!await spendSetupTicket(storage, ticket)) {
      res.status(401).json(error(config.nodeId, 'SETUP_TOKEN_EXPIRED', EXPIRED));
      return;
    }
    const backup = generateBackupCodes(config.totpBackupCodeCount);
    const armedAt = new Date().toISOString();
    const armed = await storage.updateGHII(ghii.ghii, {
      totpSecret: ticket.pendingSecret,
      totpEnabled: true,
      totpBackupCodes: backup.hashed,
      // The code that armed the factor does not sign in a second time (replay protection).
      totpLastUsedCode: code as string,
      totpLastUsedAt: armedAt,
    });
    void recordAccountEvent(storage, {
      ownerGhii: ghii.ghii, kind: 'two_factor_armed', actorGaii: ghii.ghii,
      link: '/v1/profile?tab=security', subject: 'two-factor',
    }, config);
    emitChange('totp');
    await completeOwnerLogin(config, storage, req, res, {
      ghiiRecord: armed ?? { ...ghii, totpEnabled: true },
      loginName: ghii.ownerName,
      wantsOwnerKey: req.body?.request_owner_key === true,
      extra: { backup_codes: backup.plain, ...(ticket.back ? { redirect: ticket.back } : {}) },
    });
  });
}
