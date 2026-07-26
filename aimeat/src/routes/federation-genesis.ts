/**
 * @file src/routes/federation-genesis.ts
 * @description Cross-federation "genesis" routes — genesis peering CRUD, the aggregated
 *   cross-federation catalogue, signed catalogue ingest, cross-genesis memory read/routing with
 *   consent + caching, prefix subscriptions, network stats, and organism reputation.
 *
 * @structure
 *   - federationGenesisRouter(config, storage, peers, networkDirectory): mounts /v1/federation/genesis-* endpoints
 *   - peering: request/list/approve/suspend/remove (operator-only), cross-catalogue aggregation
 *   - genesis-catalogue-ingest: verifies active peer + Ed25519 signature, stores entries as __genesis__ memory
 *   - genesis-memory-read (POST/GET): forwards reads to peers or answers peer reads under federation consent
 *   - subscriptions + network-stats + /v1/organisms/:id/reputation
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */

import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import type { PeerInfo } from '../services/federation.js';
import type { ServiceSummary } from '../utils/service-summary.js';
import { verify } from '../auth/keypair.js';
import { validateOutboundUrl } from '../utils/url-validator.js';
import { emitChange } from '../services/event-bus.js';
import { createGenesisPeeringService } from '../services/genesis-peering.js';
import { createOrganismReputationService } from '../services/organism-reputation.js';
import { matchesKeyword, matchesActionKeyword, matchesGenesisKeyword, matchesLocation } from '../services/federation-helpers.js';
import { logger } from '../utils/logger.js';

export function federationGenesisRouter(config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>, networkDirectory?: Map<string, ServiceSummary>): Router {
    const router = Router();
    const genesisPeeringService = createGenesisPeeringService(config, storage);

    // ── Phase 3.4: Genesis Peering ──

    // POST /v1/federation/genesis-peer — Request genesis peering (operator only)
    router.post('/v1/federation/genesis-peer', requireAuth(), requireRole('operator'), async (req, res) => {
        try {
            const { genesisNodeId, genesisUrl, publicKey } = req.body;
            if (!genesisNodeId || !genesisUrl || !publicKey) {
                res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'Missing: genesisNodeId, genesisUrl, publicKey'));
                return;
            }
            const peer = await genesisPeeringService.requestPeering(genesisNodeId, genesisUrl, publicKey);
            res.status(201).json(success(config.nodeId, {
                peer,
                semantic: {
                    '@context': { schema: 'https://schema.org/' },
                    '@type': 'schema:Organization',
                    'schema:memberOf': 'aimeat:CrossFederation',
                },
            }));
            emitChange('federation');
        } catch (err) {
            res.status(409).json(error(config.nodeId, 'CONFLICT', String(err)));
        }
    });

    // GET /v1/federation/genesis-peers — List genesis peers (operator only)
    router.get('/v1/federation/genesis-peers', requireAuth(), requireRole('operator'), async (req, res) => {
        try {
            const status = req.query.status as string | undefined;
            const genesisPeers = await storage.listGenesisPeers(status ? { status } : undefined);
            res.json(success(config.nodeId, {
                peers: genesisPeers,
                total: genesisPeers.length,
                semantic: {
                    '@context': { schema: 'https://schema.org/' },
                    '@type': 'schema:ItemList',
                    'schema:itemListElement': 'schema:Organization',
                },
            }));
        } catch (err) {
            res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
        }
    });

    // PUT /v1/federation/genesis-peer/:id/approve — Approve genesis peering
    router.put('/v1/federation/genesis-peer/:id/approve', requireAuth(), requireRole('operator'), async (req, res) => {
        try {
            const id = req.params.id as string;
            const peer = await genesisPeeringService.approvePeering(id);
            if (!peer) {
                res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Genesis peer not found'));
                return;
            }
            res.json(success(config.nodeId, { peer }));
            emitChange('federation');
        } catch (err) {
            res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
        }
    });

    // DELETE /v1/federation/genesis-peer/:id — Remove genesis peering
    router.delete('/v1/federation/genesis-peer/:id', requireAuth(), requireRole('operator'), async (req, res) => {
        try {
            const id = req.params.id as string;
            const removed = await genesisPeeringService.removePeering(id);
            if (!removed) {
                res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Genesis peer not found'));
                return;
            }
            res.json(success(config.nodeId, { removed: true }));
            emitChange('federation');
        } catch (err) {
            res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
        }
    });

    // GET /v1/federation/cross-catalogue — E.4: Enhanced cross-federation catalogue
    // Aggregates local CSMs + federated actions + genesis entries with filtering
    router.get('/v1/federation/cross-catalogue', async (req, res) => {
        try {
            const serviceType = req.query.service_type as string | undefined;
            const location = req.query.location as string | undefined;
            const keyword = req.query.keyword as string | undefined;
            const sourceFilter = req.query.source as string | undefined; // 'local' | 'federated' | 'genesis' | undefined (all)

            const entries: Array<Record<string, unknown>> = [];

            // 1. Local federable CSMs (unless filtering to genesis/federated only)
            if (!sourceFilter || sourceFilter === 'local') {
                const localCsms = await storage.listCsms(
                    serviceType ? { serviceType } : undefined,
                );
                for (const csm of localCsms) {
                    if (!csm.federate) continue;
                    if (keyword && !matchesKeyword(csm, keyword)) continue;
                    entries.push({
                        type: 'csm',
                        id: csm.name,
                        name: csm.name,
                        service_type: csm.serviceType,
                        source_node: config.nodeId,
                        source_type: 'local',
                        federated: true,
                    });
                }
            }

            // 2. Federated actions from same-genesis peers (tagged federated:*)
            if (!sourceFilter || sourceFilter === 'federated') {
                const allActions = await storage.listActions(
                    serviceType ? { category: serviceType } : undefined,
                );
                for (const action of allActions) {
                    const federatedTag = action.tags.find(t => t.startsWith('federated:'));
                    if (!federatedTag) continue;
                    if (keyword && !matchesActionKeyword(action, keyword)) continue;

                    entries.push({
                        type: 'action',
                        id: action.id,
                        display_name: action.displayName,
                        description: action.description,
                        category: action.category,
                        source_node: federatedTag.replace('federated:', ''),
                        source_type: 'federated',
                        pricing: {
                            base_morsels: action.pricing.baseMorsels,
                            per_unit: action.pricing.perUnit,
                        },
                        tags: action.tags,
                        semantic: action.semantic,
                    });
                }
            }

            // 3. Genesis entries (stored as memory with genesis:* prefix)
            if (!sourceFilter || sourceFilter === 'genesis') {
                try {
                    const genesisMemories = await storage.listMemory('__genesis__', { prefix: 'genesis:' });
                    for (const mem of genesisMemories) {
                        // Skip subscription metadata entries
                        if (mem.key.endsWith(':subscriptions')) continue;

                        const val = mem.value as Record<string, unknown>;
                        if (serviceType && val.service_type !== serviceType && val.category !== serviceType) continue;
                        if (keyword && !matchesGenesisKeyword(val, keyword)) continue;
                        if (location && !matchesLocation(val, location)) continue;

                        entries.push({
                            type: val.type ?? 'genesis_entry',
                            id: mem.key,
                            source_type: 'genesis',
                            source_genesis: val.source_genesis,
                            source_node: val.sourceNode ?? val.source_node,
                            fetched_at: val.fetched_at,
                            ...val,
                        });
                    }
                } catch (err) {
                    // No genesis entries yet — that's fine
                  logger.warn('GET /v1/federation/cross-catalogue: continuing after a suppressed failure', { error: String(err) });
                }
            }

            // 4. Network directory entries (aggregated peer summaries)
            if ((!sourceFilter || sourceFilter === 'network') && networkDirectory) {
                for (const [nodeId, summary] of networkDirectory) {
                    for (const action of summary.actions) {
                        if (serviceType && action.category !== serviceType) continue;
                        if (keyword && !action.displayName.toLowerCase().includes(keyword.toLowerCase())) continue;
                        entries.push({
                            type: 'action',
                            id: action.id,
                            name: action.displayName,
                            category: action.category,
                            source_node: nodeId,
                            source_type: 'network',
                            provider_gaii: action.providerGaii,
                        });
                    }
                    for (const agent of summary.agents) {
                        if (keyword && !(agent.displayName || '').toLowerCase().includes(keyword.toLowerCase())) continue;
                        entries.push({
                            type: 'agent',
                            id: agent.gaii,
                            name: agent.displayName || agent.gaii,
                            source_node: nodeId,
                            source_type: 'network',
                        });
                    }
                    for (const board of summary.boards) {
                        if (keyword && !board.name.toLowerCase().includes(keyword.toLowerCase())) continue;
                        entries.push({
                            type: 'board',
                            id: board.id,
                            name: board.name,
                            source_node: nodeId,
                            source_type: 'network',
                        });
                    }
                    for (const csm of summary.csms) {
                        if (serviceType && csm.serviceType !== serviceType) continue;
                        if (keyword && !csm.name.toLowerCase().includes(keyword.toLowerCase())) continue;
                        entries.push({
                            type: 'csm',
                            id: csm.name,
                            name: csm.name,
                            service_type: csm.serviceType,
                            source_node: nodeId,
                            source_type: 'network',
                        });
                    }
                }
            }

            // 5. Add active genesis peer metadata
            const activePeers = await storage.listGenesisPeers({ status: 'active' });
            const peerSummary = activePeers.map(p => ({
                node_id: p.genesisNodeId,
                url: p.genesisUrl,
                status: p.status,
                last_sync_at: p.lastSyncAt,
                catalogue_hash: p.catalogueHash,
            }));

            res.json(success(config.nodeId, {
                entries,
                total: entries.length,
                genesis_peers: peerSummary,
                catalogue_hash: await (async () => {
                    const { computeCatalogueHash: computeHash } = await import('../utils/catalogue-hash.js');
                    return computeHash(storage);
                })(),
                filters: {
                    service_type: serviceType ?? null,
                    location: location ?? null,
                    keyword: keyword ?? null,
                    source: sourceFilter ?? null,
                },
            }));
        } catch (err) {
            res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
        }
    });

    // POST /v1/federation/genesis-catalogue-ingest — Receive catalogue push from genesis peer
    router.post('/v1/federation/genesis-catalogue-ingest', async (req, res) => {
        try {
            const { source_node, entries: ingestEntries, csms: ingestCsms, catalogue_hash, signature } = req.body ?? {};

            if (!source_node) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'source_node required'));
                return;
            }

            // Verify the source is an active genesis peer
            const genesisPeer = await storage.getGenesisPeerByNodeId(source_node);
            if (!genesisPeer || genesisPeer.status !== 'active') {
                res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Source is not an active genesis peer'));
                return;
            }

            // Verify signature if peer has a public key
            if (signature && genesisPeer.publicKey) {
                const payload = JSON.stringify({ source_node, entries: ingestEntries, csms: ingestCsms, catalogue_hash });
                const isValid = await verify(genesisPeer.publicKey, payload, signature);
                if (!isValid) {
                    res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Invalid signature on genesis catalogue ingest'));
                    return;
                }
            }

            const now = new Date().toISOString();
            let stored = 0;

            // Ensure __genesis__ system agent exists
            const agents = await storage.listAgents();
            if (!agents.find(a => a.gaii === '__genesis__')) {
                try {
                    await storage.createAgent({
                        name: '__genesis__',
                        owner: '__system__',
                        gaii: '__genesis__',
                        publicKey: '',
                        displayName: 'Genesis Sync System',
                        capabilities: ['genesis-sync'],
                        createdAt: now,
                        lastSeen: now,
                        trustScore: 100,
                        morselBalance: 0,
                    });
                // eslint-disable-next-line aimeat/no-silent-catch -- may already exist
                } catch { /* may already exist */ }
            }

            // Store received entries as genesis memory
            const allEntries = [...(ingestEntries ?? []), ...(ingestCsms ?? [])];
            for (const entry of allEntries) {
                const entryId = (entry.id ?? entry.name ?? `ingest-${stored}`) as string;
                const key = `genesis:${source_node}:${entryId}`;

                await storage.setMemory({
                    key,
                    ownerGaii: '__genesis__',
                    value: {
                        ...entry,
                        source_genesis: source_node,
                        ingested_at: now,
                    },
                    visibility: 'public',
                    tags: ['genesis', `genesis:${source_node}`],
                    ttlHours: config.genesisMemoryCacheTtlHours || null,
                    version: 1,
                    createdAt: now,
                    updatedAt: now,
                });
                stored++;
            }

            // Update peer sync metadata
            await storage.updateGenesisPeer(genesisPeer.id, {
                lastSyncAt: now,
                catalogueHash: catalogue_hash ?? '',
                updatedAt: now,
            });

            res.json(success(config.nodeId, {
                stored,
                catalogue_hash: catalogue_hash ?? null,
            }));
            emitChange('federation');
        } catch (err) {
            res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
        }
    });

    // POST /v1/federation/genesis-memory-read — E.2: Cross-genesis memory routing
    // Forwards memory read requests to genesis peers, aggregates responses
    router.post('/v1/federation/genesis-memory-read', requireAuth(), async (req, res) => {
        try {
            const { target_gaii, key, prefix, target_scope } = req.body ?? {};

            if (!target_gaii && !key && !prefix) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'target_gaii, key, or prefix required'));
                return;
            }

            // Only process genesis-scoped requests
            if (target_scope !== 'genesis') {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'target_scope must be "genesis"'));
                return;
            }

            const activePeers = await storage.listGenesisPeers({ status: 'active' });
            if (activePeers.length === 0) {
                res.json(success(config.nodeId, { results: [], total: 0, peers_queried: 0 }));
                return;
            }

            // Check local genesis cache first (if enabled)
            if (config.genesisMemoryCache && key) {
                try {
                    const cachePrefix = 'genesis:';
                    const cachedEntries = await storage.listMemory('__genesis__', { prefix: cachePrefix });
                    const cached = cachedEntries.find(m => {
                        const val = m.value as Record<string, unknown>;
                        return val.key === key && (!target_gaii || val.gaii === target_gaii);
                    });
                    if (cached) {
                        const val = cached.value as Record<string, unknown>;
                        res.json(success(config.nodeId, {
                            results: [{
                                key: val.key,
                                value: val.value,
                                source_genesis: val.source_genesis,
                                source_node: val.source_node,
                                cached: true,
                            }],
                            total: 1,
                            peers_queried: 0,
                            from_cache: true,
                        }));
                        return;
                    }
                } catch (err) {
                    // Cache miss — proceed to query peers
                  logger.warn('POST /v1/federation/genesis-memory-read: continuing after a suppressed failure', { error: String(err) });
                }
            }

            // Forward to genesis peers
            const results: Array<Record<string, unknown>> = [];
            let peersQueried = 0;

            const peerPromises = activePeers.map(async (peer) => {
                try {
                    const urlCheck = await validateOutboundUrl(peer.genesisUrl);
                    if (!urlCheck.valid) return;

                    const queryParams = new URLSearchParams();
                    if (target_gaii) queryParams.set('gaii', target_gaii);
                    if (key) queryParams.set('key', key);
                    if (prefix) queryParams.set('prefix', prefix);

                    const resp = await fetch(
                        `${peer.genesisUrl}/v1/federation/genesis-memory-read?${queryParams}`,
                        {
                            method: 'GET',
                            headers: { 'Accept': 'application/json' },
                            signal: AbortSignal.timeout(config.federationTimeoutMs),
                        },
                    );

                    peersQueried++;

                    if (!resp.ok) return;

                    const body = await resp.json() as {
                        data?: { results?: Array<Record<string, unknown>> };
                    };

                    if (body.data?.results) {
                        for (const result of body.data.results) {
                            results.push({
                                ...result,
                                source_genesis: peer.genesisNodeId,
                            });
                        }
                    }
                } catch (err) {
                    // Skip failed peer
                  logger.warn('POST /v1/federation/genesis-memory-read: continuing after a suppressed failure', { error: String(err) });
                }
            });

            await Promise.allSettled(peerPromises);

            // Optionally cache results
            if (config.genesisMemoryCache && results.length > 0) {
                const now = new Date().toISOString();
                for (const result of results) {
                    try {
                        const cacheKey = `genesis-cache:${result.source_genesis}:${result.key ?? 'unknown'}`;
                        await storage.setMemory({
                            key: cacheKey,
                            ownerGaii: '__genesis__',
                            value: result,
                            visibility: 'public',
                            tags: ['genesis-cache'],
                            ttlHours: config.genesisMemoryCacheTtlHours,
                            version: 1,
                            createdAt: now,
                            updatedAt: now,
                        });
                    } catch (err) {
                        // Cache write failure is non-critical
                      logger.warn('POST /v1/federation/genesis-memory-read: continuing after a suppressed failure', { error: String(err) });
                    }
                }
            }

            res.json(success(config.nodeId, {
                results,
                total: results.length,
                peers_queried: peersQueried,
                from_cache: false,
            }));
        } catch (err) {
            res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
        }
    });

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

            const results: Array<Record<string, unknown>> = [];

            if (gaii && key) {
                // Direct lookup
                const memory = await storage.getMemory(gaii, key);
                if (memory && memory.visibility === 'public') {
                    // Check for federation consent
                    const consents = await storage.listConsents(gaii);
                    const hasConsent = consents.some(c =>
                        c.status === 'active' && c.scope === 'federation',
                    );
                    if (hasConsent) {
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
                const hasConsent = consents.some(c =>
                    c.status === 'active' && c.scope === 'federation',
                );

                if (hasConsent) {
                    for (const memory of memories) {
                        if (memory.key.startsWith('replica:') || memory.key.startsWith('genesis:') ||
                            memory.key.startsWith('expiring:')) continue;

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
            } else if (prefix) {
                // Prefix search across all agents
                const agents = await storage.listAgents();
                for (const agent of agents) {
                    if (agent.gaii === '__genesis__') continue;
                    try {
                        const consents = await storage.listConsents(agent.gaii);
                        const hasConsent = consents.some(c =>
                            c.status === 'active' && c.scope === 'federation',
                        );
                        if (!hasConsent) continue;

                        const memories = await storage.listMemory(agent.gaii, { prefix, visibility: 'public' });
                        for (const memory of memories) {
                            if (memory.key.startsWith('replica:') || memory.key.startsWith('genesis:') ||
                                memory.key.startsWith('expiring:')) continue;

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

            res.json(success(config.nodeId, {
                results,
                total: results.length,
            }));
        } catch (err) {
            res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
        }
    });

    // PUT /v1/federation/genesis-peer/:id/subscriptions — E.3: Set memory prefix subscriptions
    router.put('/v1/federation/genesis-peer/:id/subscriptions', requireAuth(), requireRole('operator'), async (req, res) => {
        try {
            const id = req.params.id as string;
            const { prefixes } = req.body ?? {};

            if (!Array.isArray(prefixes)) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'prefixes array required'));
                return;
            }

            const peer = await storage.getGenesisPeer(id);
            if (!peer) {
                res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Genesis peer not found'));
                return;
            }

            // Store subscription preferences as memory
            const now = new Date().toISOString();
            const subscriptionKey = `genesis:${peer.genesisNodeId}:subscriptions`;

            // Ensure __genesis__ system agent exists
            const agents = await storage.listAgents();
            if (!agents.find(a => a.gaii === '__genesis__')) {
                try {
                    await storage.createAgent({
                        name: '__genesis__',
                        owner: '__system__',
                        gaii: '__genesis__',
                        publicKey: '',
                        displayName: 'Genesis Sync System',
                        capabilities: ['genesis-sync'],
                        createdAt: now,
                        lastSeen: now,
                        trustScore: 100,
                        morselBalance: 0,
                    });
                // eslint-disable-next-line aimeat/no-silent-catch -- may already exist
                } catch { /* may already exist */ }
            }

            await storage.setMemory({
                key: subscriptionKey,
                ownerGaii: '__genesis__',
                value: { prefixes, updated_at: now },
                visibility: 'public',
                tags: ['genesis-subscriptions'],
                ttlHours: null,
                version: 1,
                createdAt: now,
                updatedAt: now,
            });

            res.json(success(config.nodeId, {
                peer_id: id,
                peer_node_id: peer.genesisNodeId,
                subscribed_prefixes: prefixes,
            }));
            emitChange('federation');
        } catch (err) {
            res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
        }
    });

    // GET /v1/federation/genesis-peer/:id/subscriptions — E.3: Get memory prefix subscriptions
    router.get('/v1/federation/genesis-peer/:id/subscriptions', requireAuth(), requireRole('operator'), async (req, res) => {
        try {
            const id = req.params.id as string;
            const peer = await storage.getGenesisPeer(id);
            if (!peer) {
                res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Genesis peer not found'));
                return;
            }

            const subscriptionKey = `genesis:${peer.genesisNodeId}:subscriptions`;
            const record = await storage.getMemory('__genesis__', subscriptionKey);

            const subscriptions = record
                ? (record.value as { prefixes?: string[] }).prefixes ?? []
                : [];

            res.json(success(config.nodeId, {
                peer_id: id,
                peer_node_id: peer.genesisNodeId,
                subscribed_prefixes: subscriptions,
            }));
        } catch (err) {
            res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
        }
    });

    // GET /v1/federation/network-stats — Network statistics
    router.get('/v1/federation/network-stats', async (_req, res) => {
        try {
            const stats = await genesisPeeringService.getNetworkStats();
            res.json(success(config.nodeId, { stats }));
        } catch (err) {
            res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
        }
    });

    // PUT /v1/federation/genesis-peer/:id/suspend — Suspend genesis peering
    router.put('/v1/federation/genesis-peer/:id/suspend', requireAuth(), requireRole('operator'), async (req, res) => {
        try {
            const id = req.params.id as string;
            const peer = await genesisPeeringService.suspendPeering(id);
            if (!peer) {
                res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Genesis peer not found'));
                return;
            }
            res.json(success(config.nodeId, { peer }));
            emitChange('federation');
        } catch (err) {
            res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
        }
    });

    // ── Phase 3.4: Organism Reputation ──

    const organismReputationService = createOrganismReputationService(config, storage);

    // GET /v1/organisms/:id/reputation — Get organism reputation score
    router.get('/v1/organisms/:id/reputation', async (req, res) => {
        try {
            const id = req.params.id as string;
            const reputation = await organismReputationService.calculateReputation(id);
            if (!reputation) {
                res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Organism not found: ${id}`));
                return;
            }
            res.json(success(config.nodeId, {
                reputation,
                semantic: {
                    '@context': { schema: 'https://schema.org/' },
                    '@type': 'schema:Rating',
                    'schema:ratingValue': reputation.score,
                    'schema:bestRating': 100,
                    'schema:worstRating': 0,
                },
            }));
        } catch (err) {
            res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
        }
    });

    return router;
}
