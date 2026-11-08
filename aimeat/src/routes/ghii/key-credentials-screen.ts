/**
 * @file src/routes/ghii/key-credentials-screen.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description POST /v1/ghii/key-credentials: the sign-in details screen of a code key's first
 *   sign-in asks here for the new password, once.
 *
 *   WHY. A code key's code is the account's password until its holder's first sign-in, and the person
 *   who minted the key knows it. The password and passkey sign-ins answer with the new details in
 *   their JSON. An emailed sign-in link and an identity provider answer with a redirect, so their first
 *   sign-in replaces the key with a password nobody holds and sends the browser to the front page's
 *   screen (`/?auth_step=key_credentials`), which asks here (services/key-credentials.ts
 *   owePendingKeyCredentials, takeOwedKeyCredentials). Only the session that completed that sign-in
 *   gets the answer, and only once. The details are shown, never mailed (the developer's ruling 1 of
 *   2026-11-08; secaudit2026nov08 round 14).
 * @structure registerKeyCredentialsScreenRoute(router, config, storage)
 * @usage registerKeyCredentialsScreenRoute(router, config, storage) from routes/ghii.ts
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08 round 14,
 *     key-credentials:rotation-gated-on-login-count-not-pending-invitation).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireOwnerPrincipal } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { takeOwedKeyCredentials } from '../../services/key-credentials.js';
import { rateLimit } from '../../middleware/rate-limit.js';

export function registerKeyCredentialsScreenRoute(router: Router, config: AimeatConfig, storage: Storage): void {
    router.post('/v1/ghii/key-credentials', rateLimit({ max: 20, windowMs: 10 * 60 * 1000 }), requireAuth(), requireOwnerPrincipal(), async (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.set('Pragma', 'no-cache');
        const owner = req.auth!.owner as string;
        const sessionId = req.auth!.sessionId;
        const taken = sessionId ? await takeOwedKeyCredentials(storage, `${owner}@${config.nodeId}`, sessionId) : null;
        if (!taken) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND',
                'No new sign-in details wait for this sign-in. They are shown once, to the browser that signed in. '
                + 'If you did not see them, sign in with your email link again and set a password under Account security.'));
            return;
        }
        res.json(success(config.nodeId, { key_credentials: taken.credentials, continue_to: taken.back }, [
            { description: 'Add a passkey to this account', method: 'POST', url: '/v1/ghii/passkeys/register/options' },
            { description: 'Confirm an email address of your own', method: 'POST', url: '/v1/ghii/email/verify' },
        ]));
    });
}
