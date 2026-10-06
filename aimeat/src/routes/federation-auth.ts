/**
 * @file federation-auth.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Federation authentication endpoint -- allows remote nodes to verify
 *   credentials for users who have their home identity on this node. A requesting
 *   node sends the username + password, and this node verifies them locally, checks
 *   for an auth consent granting the requesting node access, and returns a signed
 *   attestation that the remote node can use to issue a federated JWT.
 *
 *   The requesting node must be an active peer whose link can carry a sign-in, and it signs the
 *   request with its node key. The person's auth consent for that node is checked before the password,
 *   and a missing consent, a missing account and a wrong password get one answer. The password goes
 *   through services/password-check.ts, with the same per-account lock as the sign-in route, and an
 *   account with two-step sign-in needs its code here too.
 * @version-history
 *   v1.2.1 -- 2026-10-06 -- A signed verify request passes once (signedMessageRefusal): the password is
 *     not signed, so a captured signature carried other passwords for five minutes (secaudit 2026-10
 *     follow-up, A7).
 *   v1.2.0 -- 2026-10-05 -- Hardened (secaudit 2026-10, D1; Jouni: "harden it"). Before, any caller
 *     could name any requesting_node in the body and test passwords with only a per-IP limit: no
 *     account lock, no second factor, no peer signature, and 401 for a wrong password against 403 for
 *     a right one without consent. Now: an active peer of a tier that may carry sign-in, a signature
 *     over services/federation-auth-payload.ts, consent before the password, one answer for every
 *     refusal before the password is known to be right, checkPassword() and checkSecondFactor().
 *   v1.1.0 -- 2026-08-23 -- A deactivated owner gets no attestation (BR-04): the home node is the
 *     only place that knows, so this is where cross-node deactivation holds.
 *   v1.0.0 -- 2026-05-20 -- Initial implementation (Federation Mesh Phase 3)
 */

import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import type { PeerInfo } from '../services/federation.js';
import { coerceTier, tierCeiling } from '../services/federation-tiers.js';
import { gatePeer } from '../services/federation-peer-gate.js';
import { federationAuthPayload } from '../services/federation-auth-payload.js';
import { checkPassword, checkSecondFactor } from '../services/password-check.js';
import { sign, verify } from '../auth/keypair.js';
import { signedMessageRefusal } from '../services/signed-node-request.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { logger } from '../utils/logger.js';

export function federationAuthRouter(config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): Router {
    const router = Router();

    /**
     * POST /v1/federation/auth/verify
     *
     * Called by a remote node when a user tries to log in as username@thisNode
     * on that remote node. Verifies the password locally and checks that the
     * user has granted an auth consent to the requesting node.
     *
     * Body: { username, password, requesting_node, timestamp, signature, totp_code?, backup_code? }
     * Returns: signed attestation on success
     */
    router.post('/v1/federation/auth/verify',
        rateLimit({ max: config.loginRateLimitMax, windowMs: config.loginRateLimitWindowMs }),
        async (req, res) => {
            const { username, password, requesting_node, timestamp, signature, totp_code, backup_code } = req.body ?? {};

            // --- Input validation ---
            if (!username || typeof username !== 'string') {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'username is required'));
                return;
            }
            if (!password || typeof password !== 'string') {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'password is required'));
                return;
            }
            if (!requesting_node || typeof requesting_node !== 'string') {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'requesting_node is required'));
                return;
            }
            if (!timestamp || typeof timestamp !== 'string') {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'timestamp is required'));
                return;
            }

            // Reject requests with timestamps too far from now (5 minute window)
            const requestTime = new Date(timestamp).getTime();
            if (isNaN(requestTime) || Math.abs(Date.now() - requestTime) > 5 * 60 * 1000) {
                res.status(400).json(error(config.nodeId, 'INVALID_TIMESTAMP', 'Request timestamp is too old or invalid'));
                return;
            }

            // --- The requesting node: an active peer whose link may carry a sign-in, signing this ---
            // Before anything about the person is read, so a caller that is not such a peer learns
            // nothing about any account here.
            const gate = gatePeer(peers, requesting_node, null);
            if (!gate.ok) {
                res.status(gate.status).json(error(config.nodeId, gate.code, gate.message));
                return;
            }
            if (!tierCeiling(coerceTier(gate.peer.tier)).allowFederatedAuth) {
                res.status(403).json(error(config.nodeId, 'FEDERATION_AUTH_NOT_ALLOWED', 'This link does not carry sign-ins'));
                return;
            }
            const payload = federationAuthPayload({ username, requesting_node, timestamp });
            if (typeof signature !== 'string' || !signature || !await verify(gate.peer.publicKey, payload, signature)) {
                res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'The request is not signed by the requesting node'));
                return;
            }
            // The password is not part of what is signed, so one captured signature could carry other
            // passwords for this person for five minutes: a signature carries one try (secaudit 2026-10
            // follow-up, A7). The window is checked again here, after the signature.
            const replayed = signedMessageRefusal(requesting_node, timestamp, signature);
            if (replayed) { res.status(replayed.status).json(error(config.nodeId, replayed.code, replayed.message)); return; }

            // One answer for a missing consent, a missing account and a wrong password: the caller
            // learns whether the password is right only together with a consent that lets it ask.
            const failed = () => res.status(401).json(error(config.nodeId, 'FEDERATION_AUTH_FAILED',
                'Sign-in failed. Check the password, and that your home node lets this node sign you in.'));

            // --- Check for auth consent, before the password ---
            // The user must have an active consent granting auth access to the requesting node.
            // Consent recipient format: "node:requesting-node-id", scope field: any (we check purpose).
            // Since findMatchingConsents uses memory key patterns (dataPattern) and accessor GAII,
            // and we need to check by node ID (not a real GAII), we query consents directly
            // and filter for auth-related consents targeting this node.
            const ghii = `${username.toLowerCase().trim()}@${config.nodeId}`;
            const consents = await storage.listConsents(ghii, { status: 'active' });
            const hasAuthConsent = consents.some(c => {
                if (c.scope !== 'auth') return false;
                if (c.recipient === `node:${requesting_node}`) return true;
                if (c.recipient === '*') return true;
                if (c.recipient === 'domain:*') return true;
                return false;
            });
            if (!hasAuthConsent) {
                logger.info(`Federation auth denied: ${ghii} has no auth consent for node ${requesting_node}`);
                failed();
                return;
            }

            // --- Look up the GHII record, and the password with the account's lock ---
            const ghiiRecord = await storage.getGHII(ghii);
            if (!ghiiRecord) {
                logger.warn(`Federation auth: GHII not found: ${ghii} (requested by ${requesting_node})`);
                failed();
                return;
            }
            const pw = await checkPassword(storage, config, ghiiRecord, password);
            if (!pw.ok) {
                logger.warn(`Federation auth: ${pw.code} for ${ghii} (requested by ${requesting_node})`);
                // The lock is the account's own state and is said as such, as the sign-in route says it.
                if (pw.code === 'PASSWORD_LOCKED') res.status(pw.status).json(error(config.nodeId, pw.code, pw.message));
                else failed();
                return;
            }

            // Deactivated account (BR-04): this attestation is how the person signs in ELSEWHERE in
            // the federation, and the home node is the only place that knows they were switched off.
            // The remote-side middleware deliberately skips federated principals, so refusing here is
            // what makes deactivation hold across nodes. After the password check (no disclosure).
            const ownerRecord = await storage.getOwner(ghiiRecord.ownerName);
            if (ownerRecord?.disabledAt) {
                res.status(403).json(error(config.nodeId, 'ACCOUNT_DISABLED', 'This account has been deactivated'));
                return;
            }

            // --- The second factor, for an account with two-step sign-in ---
            // The requesting node passes on the code the person typed there. Without one the answer is
            // TOTP_REQUIRED, which that node hands back so its sign-in form asks for the code.
            const second = await checkSecondFactor(storage, config, ghiiRecord, { totp_code, backup_code });
            if (!second.ok) {
                res.status(second.status).json(error(config.nodeId, second.code, second.message));
                return;
            }

            // --- Build and sign the attestation ---
            const nodeKey = await storage.getNodeKey();
            if (!nodeKey) {
                res.status(500).json(error(config.nodeId, 'INTERNAL', 'Node keys not available'));
                return;
            }

            const now = new Date().toISOString();
            const attestation = {
                verified: true,
                ghii,
                display_name: ghiiRecord.displayName,
                home_node: config.nodeId,
                home_url: config.baseUrl,
                owner: ghiiRecord.ownerName,
                scopes: [],
                requesting_node,
                issued_at: now,
                expires_at: new Date(Date.now() + 3600 * 1000).toISOString(), // 1 hour
            };

            // Sign the attestation payload with the node's Ed25519 private key
            const attestationJson = JSON.stringify(attestation);
            const attestationSignature = await sign(nodeKey.privateKey, attestationJson);

            logger.info(`Federation auth success: ${ghii} verified for node ${requesting_node}`);

            res.json(success(config.nodeId, { ...attestation, signature: attestationSignature }));
        },
    );

    return router;
}
