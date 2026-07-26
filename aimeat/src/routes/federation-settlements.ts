/**
 * @file src/routes/federation-settlements.ts
 * @description Express routes for signed cross-node morsel settlements — receives Ed25519-signed
 *   settlements from approved peers and initiates outbound settlements, with multi-hop relay-fee logic.
 *
 * @structure
 *   - federationSettlementsRouter(config, storage, peers): mounts /v1/federation/settle endpoints
 *   - POST /v1/federation/settle: validates addressing, positive amount, known active peer, and signature
 *   - uses buildHopSigningMessage / computeRelayFeeDistribution for relayed multi-hop settlements
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */

import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { logger } from '../utils/logger.js';
import type { PeerInfo } from '../services/federation.js';
import { sign, verify } from '../auth/keypair.js';
import { validateOutboundUrl } from '../utils/url-validator.js';
import type { RouteManifest } from '../types/route-manifest.js';
import { buildHopSigningMessage, computeRelayFeeDistribution } from '../types/route-manifest.js';
import type { RelayFeeDistribution } from '../types/route-manifest.js';
import { emitChange } from '../services/event-bus.js';

export function federationSettlementsRouter(config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): Router {
    const router = Router();

    // ── P1-11: Signed Federation Settlements ──

    // POST /v1/federation/settle — Receive a signed settlement from a peer node
    // Used for cross-node morsel transfers (e.g., work completed on a remote node
    // that needs to credit/debit morsels on this node). The request must be
    // cryptographically signed by the sending node's Ed25519 private key.
    router.post('/v1/federation/settle', async (req, res) => {
        const {
            from_node,
            to_node,
            gaii,
            amount,
            tracking_code,
            reason,
            timestamp: settlementTimestamp,
            signature,
        } = req.body ?? {};

        // Validate required fields
        if (!from_node || !to_node || !gaii || amount === undefined || !tracking_code || !signature) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                'from_node, to_node, gaii, amount, tracking_code, and signature are required'));
            return;
        }

        // Verify this settlement is addressed to us
        if (to_node !== config.nodeId) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                `Settlement addressed to ${to_node}, but this node is ${config.nodeId}`));
            return;
        }

        // Validate amount is a positive number
        if (typeof amount !== 'number' || amount <= 0 || !Number.isFinite(amount)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'amount must be a positive finite number'));
            return;
        }

        // Verify the sending node is a known active peer
        const peer = [...peers.values()].find(p => p.nodeId === from_node);
        if (!peer || (peer.status !== 'active' && peer.status !== 'depeering')) {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN',
                `Node ${from_node} is not a known active peer`));
            return;
        }

        // Verify peer has a public key for signature verification
        if (!peer.publicKey) {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN',
                'Peer has no public key on file for signature verification'));
            return;
        }

        // Verify the cryptographic signature
        const settlementPayload = JSON.stringify({
            from_node,
            to_node,
            gaii,
            amount,
            tracking_code,
            reason,
            timestamp: settlementTimestamp,
        });
        const signatureValid = await verify(peer.publicKey, settlementPayload, signature);
        if (!signatureValid) {
            logger.warn(`Invalid settlement signature from node ${from_node} for tracking code ${tracking_code}`);
            res.status(401).json(error(config.nodeId, 'UNAUTHORIZED',
                'Invalid signature on settlement request'));
            return;
        }

        // Prevent replay attacks: check if tracking code was already settled
        const existingTxns = await storage.getTransactions(gaii);
        const duplicate = existingTxns.find((t: { trackingCode?: string; type: string }) =>
            t.trackingCode === `settle:${tracking_code}` && t.type === 'federation_settlement',
        );
        if (duplicate) {
            res.status(409).json(error(config.nodeId, 'CONFLICT',
                `Settlement already processed for tracking code ${tracking_code}`));
            return;
        }

        // F.3: Route manifest verification and relay fee distribution
        const routeManifest = req.body.route_manifest as RouteManifest | undefined;
        let relayDistribution: RelayFeeDistribution | null = null;

        if (routeManifest && routeManifest.hops.length > 0) {
            // Verify signature chain contiguity
            let chainValid = true;
            for (let i = 0; i < routeManifest.hops.length; i++) {
                const hop = routeManifest.hops[i];
                const prevSig = i > 0 ? routeManifest.hops[i - 1].signature : '';
                const expectedMessage = buildHopSigningMessage(hop.node_id, hop.received_at, hop.forwarded_to, prevSig);

                // Look up peer key for this hop node
                const hopPeer = [...peers.values()].find(p => p.nodeId === hop.node_id);
                if (hopPeer?.publicKey) {
                    const hopValid = await verify(hopPeer.publicKey, expectedMessage, hop.signature);
                    if (!hopValid) {
                        chainValid = false;
                        logger.warn(`Route manifest hop ${i} signature invalid for node ${hop.node_id}`);
                        break;
                    }
                }

                // Verify contiguity
                if (i < routeManifest.hops.length - 1) {
                    if (hop.forwarded_to !== routeManifest.hops[i + 1].node_id) {
                        chainValid = false;
                        logger.warn(`Route manifest contiguity broken at hop ${i}`);
                        break;
                    }
                }
            }

            if (chainValid) {
                // Compute relay fee distribution
                const networkFee = Math.floor(amount * 0.1); // 10% network fee
                relayDistribution = computeRelayFeeDistribution(networkFee, routeManifest.hops);

                // Credit relay nodes their shares
                for (const share of relayDistribution.relay_shares) {
                    const relayAgent = await storage.getAgent(share.node_id).catch(err => { logger.warn('POST /v1/federation/settle: continuing after a suppressed failure', { error: String(err) }); return null; });
                    if (relayAgent) {
                        await storage.creditBalance(relayAgent.gaii, share.amount);
                        await storage.addTransaction({
                            id: `txn-${randomBytes(8).toString('hex')}`,
                            gaii: relayAgent.gaii,
                            type: 'relay_fee',
                            amount: share.amount,
                            trackingCode: `relay:${tracking_code}`,
                            timestamp: new Date().toISOString(),
                        });
                    }
                }
            } else {
                logger.warn(`Route manifest verification failed for settlement ${tracking_code}`);
            }
        }

        // Apply the settlement: credit morsels to the target agent
        const credited = await storage.creditBalance(gaii, Math.floor(amount));
        if (!credited) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND',
                `Agent ${gaii} not found on this node`));
            return;
        }

        // Record the settlement transaction
        await storage.addTransaction({
            id: `txn-${randomBytes(8).toString('hex')}`,
            gaii,
            type: 'federation_settlement',
            amount: Math.floor(amount),
            counterpartyGaii: from_node,
            trackingCode: `settle:${tracking_code}`,
            timestamp: new Date().toISOString(),
        });

        logger.info(`Federation settlement applied: ${amount} morsels to ${gaii} from node ${from_node} (tc: ${tracking_code})`);

        res.json(success(config.nodeId, {
            settled: true,
            from_node,
            to_node,
            gaii,
            amount: Math.floor(amount),
            tracking_code,
            relay_distribution: relayDistribution,
        }));
        emitChange('federation');
    });

    // POST /v1/federation/settle/outbound — Send a signed settlement to a peer node (operator only)
    // This endpoint allows operators to initiate a settlement to credit morsels on a remote node.
    router.post('/v1/federation/settle/outbound', requireAuth(), requireRole('operator'), async (req, res) => {
        const { target_node, gaii, amount, tracking_code, reason } = req.body ?? {};

        if (!target_node || !gaii || amount === undefined || !tracking_code) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                'target_node, gaii, amount, and tracking_code are required'));
            return;
        }

        if (typeof amount !== 'number' || amount <= 0 || !Number.isFinite(amount)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'amount must be a positive finite number'));
            return;
        }

        const peer = [...peers.values()].find(p => p.nodeId === target_node && p.status === 'active');
        if (!peer) {
            res.status(404).json(error(config.nodeId, 'FEDERATION_ERROR',
                `No active peer for node ${target_node}`));
            return;
        }

        const nodeKey = await storage.getNodeKey();
        if (!nodeKey?.privateKey) {
            res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR',
                'Node private key not available for signing'));
            return;
        }

        const settlementTimestamp = new Date().toISOString();
        const settlementPayload = JSON.stringify({
            from_node: config.nodeId,
            to_node: target_node,
            gaii,
            amount,
            tracking_code,
            reason: reason ?? 'operator_settlement',
            timestamp: settlementTimestamp,
        });
        const settlementSignature = await sign(nodeKey.privateKey, settlementPayload);

        try {
            // SSRF validation
            const settleUrlCheck = await validateOutboundUrl(peer.url);
            if (!settleUrlCheck.valid) {
                res.status(400).json(error(config.nodeId, 'INVALID_URL', settleUrlCheck.reason ?? 'URL validation failed'));
                return;
            }

            const response = await fetch(`${peer.url}/v1/federation/settle`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    from_node: config.nodeId,
                    to_node: target_node,
                    gaii,
                    amount,
                    tracking_code,
                    reason: reason ?? 'operator_settlement',
                    timestamp: settlementTimestamp,
                    signature: settlementSignature,
                }),
                signal: AbortSignal.timeout(30_000),
            });

            const data = await response.json().catch(err => { logger.warn('POST /v1/federation/settle/outbound: continuing after a suppressed failure', { error: String(err) }); return null; });

            if (response.ok) {
                logger.info(`Outbound settlement sent: ${amount} morsels for ${gaii} to node ${target_node} (tc: ${tracking_code})`);
                res.json(success(config.nodeId, {
                    sent: true,
                    target_node,
                    gaii,
                    amount,
                    tracking_code,
                    response_data: data,
                }));
                emitChange('federation');
            } else {
                res.status(response.status).json(error(config.nodeId, 'FEDERATION_ERROR',
                    `Settlement rejected by peer: ${JSON.stringify(data)}`));
            }
        } catch (err) {
            res.status(502).json(error(config.nodeId, 'FEDERATION_ERROR',
                `Failed to send settlement to ${target_node}: ${err instanceof Error ? err.message : 'unknown error'}`));
        }
    });

    return router;
}
