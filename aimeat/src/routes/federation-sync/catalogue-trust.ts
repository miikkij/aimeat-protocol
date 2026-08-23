/**
 * @file src/routes/federation-sync/catalogue-trust.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Federation catalogue sync (signed upsert of peer actions) + trust-advisory routes
 *   (warning/suspend/ban with tier demotion and peer purge). Extracted from federation-sync.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from federation-sync.ts (max-file-lines)
 */

import type { Router } from 'express';
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { logger } from '../../utils/logger.js';
import type { PeerInfo } from '../../services/federation.js';
import { verify } from '../../auth/keypair.js';
import { deriveTierFlags, tierRank, coerceTier } from '../../services/federation-tiers.js';
import { gatePeer } from '../../services/federation-peer-gate.js';
import { emitChange } from '../../services/event-bus.js';

export function registerCatalogueTrustRoutes(router: Router, config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): void {
    // POST /v1/federation/catalogue-sync — Receive catalogue updates from peer
    // Supports incremental sync: if `since_timestamp` is provided, only actions
    // newer than that timestamp are expected. Existing actions are updated rather
    // than duplicated (upsert by federated ID).
    router.post('/v1/federation/catalogue-sync', async (req, res) => {
        const { source_node, actions: actionList, since_timestamp, catalogue_hash, signature } = req.body ?? {};

        if (!source_node || !Array.isArray(actionList)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'source_node and actions array required'));
            return;
        }

        const gate = gatePeer(peers, source_node, 'shareCatalogue');
        if (!gate.ok) {
            res.status(gate.status).json(error(config.nodeId, gate.code, gate.message));
            return;
        }
        const peer = gate.peer;

        // P1-11: Require signed catalogue sync — verify peer signature
        if (!signature) {
            res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Missing signature on catalogue-sync request'));
            return;
        }
        const catalogueSyncPayload = JSON.stringify({ source_node, actions: actionList, since_timestamp, catalogue_hash });
        const catalogueSyncValid = await verify(peer.publicKey, catalogueSyncPayload, signature);
        if (!catalogueSyncValid) {
            res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Invalid signature on catalogue-sync request'));
            return;
        }

        let synced = 0;
        let updated = 0;
        const now = new Date().toISOString();

        for (const action of actionList) {
            if (!action.id || !action.provider_gaii || !action.display_name) continue;

            const federatedId = `${source_node}:${action.id}`;
            const actionData = {
                id: federatedId,
                providerGaii: action.provider_gaii,
                displayName: `[${source_node}] ${action.display_name}`,
                description: action.description ?? '',
                category: action.category,
                inputSchema: action.input_schema ?? {},
                outputSchema: action.output_schema ?? {},
                pricing: {
                    baseMorsels: action.pricing?.base_morsels ?? 0,
                    perUnit: action.pricing?.per_unit,
                },
                tags: [...(action.tags ?? []), `federated:${source_node}`],
                semantic: action.semantic,
                createdAt: action.created_at ?? now,
                updatedAt: now,
            };

            // Try to update existing federated action; create if not found
            const existing = await storage.getAction(federatedId, action.provider_gaii);
            if (existing) {
                await storage.updateAction(federatedId, action.provider_gaii, {
                    displayName: actionData.displayName,
                    description: actionData.description,
                    category: actionData.category,
                    inputSchema: actionData.inputSchema,
                    outputSchema: actionData.outputSchema,
                    pricing: actionData.pricing,
                    tags: actionData.tags,
                    updatedAt: now,
                });
                updated++;
            } else {
                try {
                    await storage.createAction(actionData);
                    synced++;
                } catch (err) { logger.warn('POST /v1/federation/catalogue-sync: skip if race condition', { error: String(err) }); }
            }
        }

        res.json(success(config.nodeId, {
            synced,
            updated,
            source_node,
            total_received: actionList.length,
            incremental: !!since_timestamp,
            catalogue_hash: catalogue_hash ?? null,
        }));
        emitChange('federation');
    });

    // POST /v1/federation/trust-advisory — Receive trust advisory about a node
    router.post('/v1/federation/trust-advisory', requireAuth(), requireRole('operator'), async (req, res) => {
        const { target_node, advisory_type, reason, evidence_hash, issued_by } = req.body ?? {};

        if (!target_node || !advisory_type || !reason) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'target_node, advisory_type, and reason are required'));
            return;
        }

        const validTypes = ['warning', 'suspend', 'ban'];
        if (!validTypes.includes(advisory_type)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `advisory_type must be one of: ${validTypes.join(', ')}`));
            return;
        }

        // Store advisory and optionally de-peer
        const advisoryId = `adv-${randomBytes(8).toString('hex')}`;
        const advisory = {
            id: advisoryId,
            target_node,
            advisory_type,
            reason,
            evidence_hash,
            issued_by: issued_by ?? config.nodeId,
            created_at: new Date().toISOString(),
        };

        // If ban advisory, auto-de-peer the target (and purge from storage).
        if (advisory_type === 'ban') {
            const targetPeer = [...peers.entries()].find(([, p]) => p.nodeId === target_node);
            if (targetPeer) {
                peers.delete(targetPeer[0]);
                storage.deleteFederationPeer(targetPeer[1].nodeId).catch(err => { logger.warn('POST /v1/federation/trust-advisory: continuing after a suppressed failure', { error: String(err) }); });
            }
        }

        // If suspend advisory, demote a full member back to the low-trust visiting tier and strip
        // its elevated permission flags (provider/relay/replication/auth). This is the trust-revocation
        // lever for the visiting/member model — a suspended node can never be a provider until re-vouched.
        //
        // A demotion has to check it IS one. The test used to be "not already visiting", which for a
        // `contact` peer is true, so suspending the least-trusted kind of peer we have would have
        // handed it catalogue read and taken it out of privacy — a punishment that promotes.
        if (advisory_type === 'suspend') {
            const entry = [...peers.entries()].find(([, p]) => p.nodeId === target_node);
            if (entry) {
                const peer = entry[1];
                if (tierRank(coerceTier(peer.tier)) > tierRank('visiting')) {
                    peer.tier = 'visiting';
                    Object.assign(peer, deriveTierFlags('visiting'));
                    storage.saveFederationPeer(peer).catch(err => { logger.warn('POST /v1/federation/trust-advisory: continuing after a suppressed failure', { error: String(err) }); });
                    logger.warn(`Peer ${target_node} demoted to visiting after suspend advisory`, { reason });
                }
            }
        }

        res.status(201).json(success(config.nodeId, {
            '@type': 'aimeat:TrustAdvisory',
            ...advisory,
        }));
        emitChange('federation');
    });
}
