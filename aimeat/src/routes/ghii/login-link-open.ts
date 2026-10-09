/**
 * @file src/routes/ghii/login-link-open.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/ghii/magic-link/open: the address an emailed sign-in link points at. It spends
 *   the link, opens an owner session the way a Google or Entra sign-in does (refresh cookie, then the
 *   SPA boots signed in), and redirects to the place the link was asked from: the `redirect` it
 *   carries, when loginReturnTarget() (services/login-link.ts) accepts it here, on open, and the
 *   node's front page otherwise. A refused link redirects to the front page with
 *   `auth_error=<CODE>`, the same query parameter the OAuth callback uses, whatever address it
 *   carries.
 *
 *   Before 2026-09-29 the emailed link pointed at GET /v1/ghii/magic-link/verify, which answers JSON
 *   with an agent token and private keys: correct for a program, and raw JSON for a person clicking
 *   the link in their mail. That endpoint is unchanged; only the emailed address moved here.
 *
 *   TWO-STEP SIGN-IN. On an account with TOTP armed the link opens no session: it leaves a
 *   five-minute ticket and sends the browser to the front page's code view, and
 *   POST /v1/ghii/magic-link/second-factor opens the session when the code is right
 *   (login-link-second-factor.ts).
 * @version-history
 *   v1.3.0 — 2026-10-09 — An account with two-step sign-in gets no session from the link alone: a
 *     ticket and the code view instead (secaudit 2026-10-09, S1).
 *   v1.2.0 — 2026-10-05 — The return address is checked after the redeem, against the account it
 *     signed in: an app address must be the account's own app or one it holds a grant for (secaudit
 *     2026-10, WEB-3).
 *   v1.1.0 — 2026-09-29 — The link returns to the place it was asked from. The address is checked
 *     here, before the token is spent, because the link in a mailbox can be edited.
 *   v1.0.0 — 2026-09-29 — Initial (install packages: users created at install can sign in).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { AccountDisabledError } from '../../auth/jwt.js';
import { establishForGhii } from '../../services/external-login.js';
import { loginReturnTarget, redeemLoginLink } from '../../services/login-link.js';
import { startLinkSecondFactor, registerLoginLinkSecondFactorRoute } from './login-link-second-factor.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { logger } from '../../utils/logger.js';

export function registerLoginLinkOpenRoute(router: Router, config: AimeatConfig, storage: Storage): void {
    router.get('/v1/ghii/magic-link/open', rateLimit({ max: 20, windowMs: 10 * 60 * 1000, keyBy: 'ip' }), async (req, res) => {
        const fail = (code: string) => res.redirect(`${config.baseUrl}/?auth_error=${encodeURIComponent(code)}`);
        res.set('Cache-Control', 'no-store');
        const token = typeof req.query.token === 'string' ? req.query.token : '';
        try {
            // Checked again on open: the link was mailed with an address that passed when it was
            // asked for, and anything in a mailbox can be edited before it is clicked. A failed check
            // is not a refusal: the token is good, so the person is signed in and lands on the front
            // page. Checked after the redeem, which names the account: an app address must be one of
            // the account's own apps or one it holds a grant for (secaudit 2026-10, WEB-3).
            const result = await redeemLoginLink(storage, config, token);
            if (!result.ok) { fail(result.code); return; }
            const back = await loginReturnTarget(storage, config, req.query.redirect, result.ghii.ownerName);
            // The same test checkSecondFactor() makes (services/password-check.ts): an account with
            // TOTP armed is asked for its code here as it is on the password sign-in. The link is
            // spent either way; the ticket carries the sign-in to the code (secaudit 2026-10-09, S1).
            if (result.ghii.totpEnabled && result.ghii.totpSecret) {
                await startLinkSecondFactor(storage, config, req, res, result.ghii, back);
                return;
            }
            await establishForGhii(storage, config, req, res, result.ghii);
            res.redirect(back ?? `${config.baseUrl}/`);
        } catch (err) {
            if (err instanceof AccountDisabledError) { fail('ACCOUNT_DISABLED'); return; }
            logger.error('login link sign-in failed', { error: String(err) });
            fail('LOGIN_LINK_FAILED');
        }
    });

    // POST /v1/ghii/magic-link/second-factor: the code that finishes a link on a TOTP account.
    // Registered here, beside the route that starts it.
    registerLoginLinkSecondFactorRoute(router, config, storage);
}
