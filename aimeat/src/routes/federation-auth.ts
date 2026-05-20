/**
 * @file federation-auth.ts
 * @description Federation authentication endpoint -- allows remote nodes to verify
 *   credentials for users who have their home identity on this node. A requesting
 *   node sends the username + password, and this node verifies them locally, checks
 *   for an auth consent granting the requesting node access, and returns a signed
 *   attestation that the remote node can use to issue a federated JWT.
 * @version-history
 *   v1.0.0 -- 2026-05-20 -- Initial implementation (Federation Mesh Phase 3)
 */

import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { verifyPassword } from '../services/password.js';
import { sign } from '../auth/keypair.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { logger } from '../utils/logger.js';

export function federationAuthRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();

    /**
     * POST /v1/federation/auth/verify
     *
     * Called by a remote node when a user tries to log in as username@thisNode
     * on that remote node. Verifies the password locally and checks that the
     * user has granted an auth consent to the requesting node.
     *
     * Body: { username, password, requesting_node, timestamp }
     * Returns: signed attestation on success
     */
    router.post('/v1/federation/auth/verify',
        rateLimit({ max: 10, windowMs: 60 * 1000 }),
        async (req, res) => {
            const { username, password, requesting_node, timestamp } = req.body ?? {};

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

            // --- Look up the GHII record ---
            const ghii = `${username.toLowerCase().trim()}@${config.nodeId}`;
            const ghiiRecord = await storage.getGHII(ghii);
            if (!ghiiRecord) {
                // Use generic error to avoid revealing whether user exists
                res.status(401).json(error(config.nodeId, 'FEDERATION_AUTH_FAILED', 'Authentication failed'));
                return;
            }

            if (!ghiiRecord.passwordHash) {
                res.status(401).json(error(config.nodeId, 'FEDERATION_AUTH_FAILED', 'Authentication failed'));
                return;
            }

            // --- Verify password ---
            const valid = await verifyPassword(password, ghiiRecord.passwordHash);
            if (!valid) {
                res.status(401).json(error(config.nodeId, 'FEDERATION_AUTH_FAILED', 'Authentication failed'));
                return;
            }

            // --- Check for auth consent ---
            // The user must have an active consent granting auth access to the requesting node.
            // Consent recipient format: "node:requesting-node-id", scope field: any (we check purpose).
            // Since findMatchingConsents uses memory key patterns (dataPattern) and accessor GAII,
            // and we need to check by node ID (not a real GAII), we query consents directly
            // and filter for auth-related consents targeting this node.
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
                res.status(403).json(error(config.nodeId, 'NO_AUTH_CONSENT',
                    'User has not granted federation auth consent for the requesting node'));
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
                ghii,
                display_name: ghiiRecord.displayName,
                home_node: config.nodeId,
                home_url: config.baseUrl,
                requesting_node,
                issued_at: now,
                expires_at: new Date(Date.now() + 3600 * 1000).toISOString(), // 1 hour
            };

            // Sign the attestation payload with the node's Ed25519 private key
            const attestationJson = JSON.stringify(attestation);
            const signature = await sign(nodeKey.privateKey, attestationJson);

            logger.info(`Federation auth success: ${ghii} verified for node ${requesting_node}`);

            res.json(success(config.nodeId, {
                attestation,
                signature,
            }));
        },
    );

    return router;
}
