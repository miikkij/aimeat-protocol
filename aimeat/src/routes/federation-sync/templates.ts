/**
 * @file src/routes/federation-sync/templates.ts
 * @description Cross-node template sharing (serve/sync template listings) + peer-to-peer memory listing.
 *   Extracted from federation-sync.ts to satisfy max-file-lines.
 * @version-history
 *   v1.1.0 — 2026-08-10 — Security audit H-15 (the July F2): POST /v1/federation/memory/list requires an
 *     Ed25519 peer signature and a fresh timestamp. Its only gate was a node id, which the public
 *     directory publishes, so anyone could read anyone's whole memory key inventory. BREAKING for a
 *     peer on older code: it gets a clean 401 and re-federates. Developer decision, security first.
 *   v1.0.0 — 2026-07-13 — Extracted from federation-sync.ts (max-file-lines)
 */

import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { logger } from '../../utils/logger.js';
import type { PeerInfo } from '../../services/federation.js';
import { validateOutboundUrl } from '../../utils/url-validator.js';
import { emitChange } from '../../services/event-bus.js';
import { verify } from '../../auth/keypair.js';

/** How stale a signed peer request may be. Same window /v1/federation/peer/introduce uses. */
const FRESHNESS_MS = 5 * 60 * 1000;

export function registerTemplatesRoutes(router: Router, config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): void {
    // ── Federation Template Sharing ──

    // GET /v1/federation/templates — Serve template listings to peer nodes
    router.get('/v1/federation/templates', async (req, res) => {
        if (!config.packageFederationEnabled) {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Package federation is not enabled on this node'));
            return;
        }

        const sourceNode = req.headers['x-source-node'] as string | undefined;
        if (!sourceNode) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'x-source-node header is required'));
            return;
        }

        const peer = [...peers.values()].find(p => p.nodeId === sourceNode);
        if (!peer || peer.status !== 'active') {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Source node is not an active peer'));
            return;
        }

        const category = req.query.category as string | undefined;
        const tagsRaw = req.query.tags as string | undefined;
        const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : undefined;
        const search = req.query.search as string | undefined;
        const limit = Math.min(parseInt(req.query.limit as string || '20', 10), 100);
        const offset = parseInt(req.query.offset as string || '0', 10);

        const { listings } = await storage.listTemplateListings({
            status: 'listed',
            category,
            tags,
            search,
            limit,
            offset,
        });

        // Enrich with package data
        const templates = [];
        for (const l of listings) {
            const pkg = await storage.getLatestPublished(l.packageGroupId);
            const componentTypes = pkg ? [...new Set(pkg.components.map(c => c.type))] : [];
            const componentCount = pkg ? pkg.components.length : 0;
            const sizeMb = pkg
                ? pkg.components.reduce((sum, c) => sum + Buffer.byteLength(c.content, 'utf8'), 0) / (1024 * 1024)
                : 0;

            templates.push({
                name: l.packageName,
                author: l.packageAuthor,
                sourceNode: config.nodeId,
                packageGroupId: l.packageGroupId,
                title: l.title,
                description: l.description,
                category: l.category,
                tags: l.tags,
                rating: l.rating,
                installCount: l.installCount,
                reviewCount: l.reviewCount,
                componentTypes,
                componentCount,
                sizeMb: Math.round(sizeMb * 100) / 100,
            });
        }

        res.json(success(config.nodeId, { templates }));
    });

    // POST /v1/federation/templates/sync — Pull templates from all active peers
    router.post('/v1/federation/templates/sync', requireAuth(), requireRole('operator'), async (req, res) => {
        if (!config.packageFederationEnabled) {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Package federation is not enabled on this node'));
            return;
        }

        const activePeers = [...peers.values()].filter(p => p.status === 'active');
        const results: { node: string; templates: number; error?: string }[] = [];

        for (const peer of activePeers) {
            try {
                const peerUrl = `${peer.url}/v1/federation/templates?limit=100`;
                const urlCheck = await validateOutboundUrl(peerUrl);
                if (!urlCheck.valid) {
                    results.push({ node: peer.nodeId, templates: 0, error: urlCheck.reason ?? 'URL validation failed' });
                    continue;
                }

                const response = await fetch(peerUrl, {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-source-node': config.nodeId,
                    },
                    signal: AbortSignal.timeout(30_000),
                });

                if (response.ok) {
                    const data = await response.json() as { data?: { templates?: unknown[] } };
                    const templateCount = Array.isArray(data?.data?.templates) ? data.data.templates.length : 0;
                    results.push({ node: peer.nodeId, templates: templateCount });
                } else {
                    results.push({ node: peer.nodeId, templates: 0, error: `HTTP ${response.status}` });
                }
            } catch (err) {
                results.push({
                    node: peer.nodeId,
                    templates: 0,
                    error: err instanceof Error ? err.message : 'unknown error',
                });
            }
        }

        emitChange('templates');
        res.json(success(config.nodeId, { syncResults: results }));
    });

    // POST /v1/federation/memory/list — List memory entries for a user (peer-to-peer)
    router.post('/v1/federation/memory/list', async (req, res) => {
        const { requesting_node, gaii, signature, timestamp } = req.body ?? {};

        if (!requesting_node || !gaii) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'requesting_node and gaii are required'));
            return;
        }

        const peer = [...peers.values()].find(p => p.nodeId === requesting_node);
        if (!peer || peer.status !== 'active') {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Requesting node is not an active peer'));
            return;
        }

        // SECURITY (audit H-15, the July audit's deferred F2): this route returns a person's whole
        // memory key inventory — every key name, its visibility, tags and version. Its only gate was
        // that the body named an active peer, and a node id is public (GET /v1/federation/directory
        // publishes it), so the gate was not one: anyone could read anyone's inventory.
        //
        // The peer must now PROVE it is that node, the same way /replicate and /catalogue-sync do.
        // This is a BREAKING change for any caller that does not sign, which is why it was deferred
        // in July; the developer took that decision on 2026-08-10 (security over version skew), and
        // the client half below signs, so a node on this version speaks to a node on this version.
        // A peer running older code gets a clean 401 and re-federates.
        if (!signature) {
            res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Missing signature on memory-list request'));
            return;
        }
        if (!peer.publicKey) {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Peer has no public key on file for signature verification'));
            return;
        }
        // The timestamp is inside the signed payload, so a captured request cannot be replayed
        // beyond the window — the inventory changes, and an old answer is not a fresh one.
        const ts = Date.parse(String(timestamp ?? ''));
        if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > FRESHNESS_MS) {
            res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Missing or stale timestamp on memory-list request'));
            return;
        }
        const listPayload = JSON.stringify({ requesting_node, gaii, timestamp });
        const listValid = await verify(peer.publicKey, listPayload, signature);
        if (!listValid) {
            res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Invalid signature on memory-list request'));
            return;
        }

        try {
            const memories = await storage.listMemory(gaii as string, {});
            const entries = memories.map(m => ({
                key: m.key,
                visibility: m.visibility,
                tags: m.tags ?? [],
                updatedAt: m.updatedAt,
                version: m.version,
            }));

            res.json(success(config.nodeId, { entries, total: entries.length }));
        } catch (err) {
            logger.error('Federation memory list error', { gaii, error: String(err) });
            res.status(500).json(error(config.nodeId, 'INTERNAL', 'Failed to list memory entries'));
        }
    });
}
