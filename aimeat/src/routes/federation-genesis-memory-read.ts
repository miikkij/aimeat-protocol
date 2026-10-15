/**
 * @file src/routes/federation-genesis-memory-read.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The answering half of a cross-genesis memory read: GET /v1/federation/genesis-memory-read,
 *   which an approved genesis peer calls when one of its members asks across federations. It answers
 *   only a request the peer signed for this node (checkNodeRequest against the key pinned on the
 *   genesis peering) and only public keys a federation consent pattern of their identity covers. The
 *   asking half, POST /v1/federation/genesis-memory-read, stays in federation-genesis.ts and signs with
 *   genesisMemoryReadFields.
 * @structure genesisMemoryReadFields(query) · registerGenesisMemoryReadAnswer(router, config, storage)
 * @version-history
 *   v1.0.0 — 2026-10-15 — Moved out of federation-genesis.ts when the peer check and the consent
 *     pattern check made it pass 800 lines (feature-list audit 166).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { error, success } from '../middleware/envelope.js';
import { checkNodeRequest } from '../services/signed-node-request.js';
import { federationConsentCovers } from '../services/memory-replication.js';
import { leaveMemoriesToPeer } from '../services/classification-exits.js';
import { logger } from '../utils/logger.js';

/** What a genesis memory read signs: its purpose and the three query values, each empty when absent. */
export function genesisMemoryReadFields(q: { gaii?: unknown; key?: unknown; prefix?: unknown }): Record<string, string> {
    const value = (v: unknown): string => (v ? String(v) : '');
    return { purpose: 'genesis-memory-read', gaii: value(q.gaii), key: value(q.key), prefix: value(q.prefix) };
}

export function registerGenesisMemoryReadAnswer(router: Router, config: AimeatConfig, storage: Storage): void {
    // GET /v1/federation/genesis-memory-read — E.2: Local memory read handler for genesis peer queries
    // Responds to incoming genesis peer memory read requests
    router.get('/v1/federation/genesis-memory-read', async (req, res) => {
        try {
            const gaii = req.query.gaii as string | undefined;
            const key = req.query.key as string | undefined;
            const prefix = req.query.prefix as string | undefined;

            if (!gaii && !key && !prefix) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'gaii, key, or prefix required'));
                return;
            }

            // Only an approved genesis peer is answered, on a request it signed for this node. The
            // route answered anyone who asked (feature-list audit 166); the POST handler in federation-genesis.ts signs.
            const asker = await checkNodeRequest(req.headers as Record<string, string | string[] | undefined>, {
                thisNodeId: config.nodeId,
                fields: genesisMemoryReadFields({ gaii, key, prefix }),
                keyOf: async (sourceNode) => {
                    const peer = await storage.getGenesisPeerByNodeId(sourceNode);
                    if (!peer || peer.status !== 'active' || !peer.publicKey) {
                        return { ok: false as const, status: 403, code: 'FORBIDDEN', message: 'Only an approved genesis peer can read memory from this node.' };
                    }
                    return { publicKey: peer.publicKey };
                },
                missingMessage: 'A genesis memory read is signed by the asking genesis peer (x-source-node, x-timestamp, x-signature).',
                badSignatureMessage: 'The signature on this genesis memory read does not match the peer\'s key.',
            });
            if (!asker.ok) {
                res.status(asker.status).json(error(config.nodeId, asker.code, asker.message));
                return;
            }

            const results: Array<Record<string, unknown>> = [];

            if (gaii && key) {
                // Direct lookup
                const memory = await storage.getMemory(gaii, key);
                if (memory && memory.visibility === 'public') {
                    // A federation consent whose pattern covers this key (feature-list audit 166).
                    if (federationConsentCovers(await storage.listConsents(gaii), memory.key)) {
                        results.push({
                            key: memory.key,
                            gaii: memory.ownerGaii,
                            value: memory.value,
                            visibility: memory.visibility,
                            version: memory.version,
                            source_node: config.nodeId,
                            updated_at: memory.updatedAt,
                        });
                    }
                }
            } else if (gaii && prefix) {
                // Prefix search for a specific agent
                const memories = await storage.listMemory(gaii, { prefix, visibility: 'public' });
                const consents = await storage.listConsents(gaii);
                for (const memory of memories) {
                    if (memory.key.startsWith('replica:') || memory.key.startsWith('genesis:') ||
                        memory.key.startsWith('expiring:')) continue;
                    if (!federationConsentCovers(consents, memory.key)) continue;

                    results.push({
                        key: memory.key,
                        gaii: memory.ownerGaii,
                        value: memory.value,
                        visibility: memory.visibility,
                        version: memory.version,
                        source_node: config.nodeId,
                        updated_at: memory.updatedAt,
                    });
                }
            } else if (prefix) {
                // Prefix search across all agents
                const agents = await storage.listAgents();
                for (const agent of agents) {
                    if (agent.gaii === '__genesis__') continue;
                    try {
                        const consents = await storage.listConsents(agent.gaii);
                        if (!consents.some(c => c.status === 'active' && c.scope === 'federation')) continue;

                        const memories = await storage.listMemory(agent.gaii, { prefix, visibility: 'public' });
                        for (const memory of memories) {
                            if (memory.key.startsWith('replica:') || memory.key.startsWith('genesis:') ||
                                memory.key.startsWith('expiring:')) continue;
                            if (!federationConsentCovers(consents, memory.key)) continue;

                            results.push({
                                key: memory.key,
                                gaii: memory.ownerGaii,
                                value: memory.value,
                                visibility: memory.visibility,
                                version: memory.version,
                                source_node: config.nodeId,
                                updated_at: memory.updatedAt,
                            });
                        }
                    } catch (err) { logger.warn('GET /v1/federation/genesis-memory-read: skip agent', { error: String(err) }); }
                }
            }

            // Memory leaving this node for a peer asks the classification component first (TARGET-082).
            // What stays is counted in the answer, never named: the keys are logged on this node.
            const { kept: leaving, withheld } = await leaveMemoriesToPeer({ storage, config },
                results.map(r => ({ ...r, ownerGaii: String(r.gaii), key: String(r.key) })), 'genesis-peer', 'genesis memory read');
            const sent = leaving.map(({ ownerGaii: _o, ...r }) => r);
            res.json(success(config.nodeId, {
                results: sent,
                total: sent.length,
                ...(withheld ? { withheld } : {}),
            }));
        } catch (err) {
            res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
        }
    });
}
