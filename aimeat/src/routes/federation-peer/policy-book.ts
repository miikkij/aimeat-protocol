/**
 * @file src/routes/federation-peer/policy-book.ts
 * @description Network-policy (genesis-defined federation rules) + federation-book (operator phone-book)
 *   routes — policy get/put/pull with signature verification, node-card, book get/rebuild/pull. Extracted from federation-peer.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from federation-peer.ts (max-file-lines)
 */

import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import type { PeerInfo } from '../../services/federation.js';
import { sign, verify } from '../../auth/keypair.js';
import { validateOutboundUrl } from '../../utils/url-validator.js';
import { emitChange } from '../../services/event-bus.js';
import { peerKeyCache } from '../../services/federation-helpers.js';
import { logger } from '../../utils/logger.js';
import {
    getActivePolicy, storeActivePolicy, coercePolicy, policySignString,
    type NetworkPolicyDoc,
} from '../../services/network-policy.js';
import {
    buildNodeCard, assembleBook, getActiveBook, pullBook,
} from '../../services/federation-book.js';

export function registerPolicyBookRoutes(router: Router, config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): void {
    // ── Network policy (genesis-defined federation rules) ──

    // GET /v1/federation/network-policy — public: the active signed policy doc (peers fetch + verify this).
    router.get('/v1/federation/network-policy', async (_req, res) => {
        const policy = await getActivePolicy(storage);
        res.json(success(config.nodeId, { policy }));
    });

    // PUT /v1/federation/network-policy — author the network policy (operator). Signed with the node key.
    router.put('/v1/federation/network-policy', requireAuth(), requireRole('operator'), async (req, res) => {
        const incoming = coercePolicy(req.body ?? {});
        const current = await getActivePolicy(storage);
        const doc: NetworkPolicyDoc = {
            ...incoming,
            policy_version: Math.max(incoming.policy_version || 0, (current.policy_version || 0) + 1),
            issued_by: config.nodeId,
            issued_at: new Date().toISOString(),
            signature: undefined,
        };
        const nodeKey = await storage.getNodeKey();
        if (nodeKey) doc.signature = await sign(nodeKey.privateKey, policySignString(doc));
        await storeActivePolicy(storage, doc);
        res.json(success(config.nodeId, { policy: doc }));
        emitChange('federation');
    });

    // POST /v1/federation/network-policy/pull — fetch the policy from this node's genesis and apply it
    // (operator). The doc is signature-verified against the genesis peer's known public key and only
    // applied if its policy_version is newer than the local one.
    router.post('/v1/federation/network-policy/pull', requireAuth(), requireRole('operator'), async (req, res) => {
        const source = (req.body?.source_url as string) || config.genesisUrl;
        if (!source) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'No genesis/source URL configured'));
            return;
        }
        const urlCheck = await validateOutboundUrl(source);
        if (!urlCheck.valid) {
            res.status(400).json(error(config.nodeId, 'INVALID_URL', urlCheck.reason ?? 'source URL failed validation'));
            return;
        }
        let doc: NetworkPolicyDoc;
        try {
            const resp = await fetch(`${source.replace(/\/+$/, '')}/v1/federation/network-policy`, { signal: AbortSignal.timeout(config.federationTimeoutMs ?? 5_000) });
            if (!resp.ok) { res.status(502).json(error(config.nodeId, 'FETCH_FAILED', `Source returned ${resp.status}`)); return; }
            const body = await resp.json() as { data?: { policy?: unknown } };
            doc = coercePolicy(body?.data?.policy);
        } catch (e) {
            res.status(502).json(error(config.nodeId, 'FETCH_FAILED', e instanceof Error ? e.message : 'fetch failed'));
            return;
        }

        // Verify the genesis signature against the issuing node's known public key (peer record or key cache).
        const issuer = peers.get(doc.issued_by) ?? [...peers.values()].find(p => p.nodeId === doc.issued_by);
        const issuerKey = issuer?.publicKey || peerKeyCache.get(doc.issued_by)?.publicKey;
        if (!issuerKey) {
            res.status(403).json(error(config.nodeId, 'UNKNOWN_ISSUER', `Policy issuer ${doc.issued_by} is not a known peer`));
            return;
        }
        const sigOk = doc.signature ? await verify(issuerKey, policySignString(doc), doc.signature).catch(err => { logger.warn('source: continuing after a suppressed failure', { error: String(err) }); return false; }) : false;
        if (!sigOk) {
            res.status(401).json(error(config.nodeId, 'INVALID_SIGNATURE', 'Policy signature verification failed'));
            return;
        }

        const current = await getActivePolicy(storage);
        if (doc.policy_version <= current.policy_version) {
            res.json(success(config.nodeId, { applied: false, reason: 'not_newer', current_version: current.policy_version }));
            return;
        }
        await storeActivePolicy(storage, doc);
        res.json(success(config.nodeId, { applied: true, policy_version: doc.policy_version }));
        emitChange('federation');
    });

    // ── Federation book (operator phone-book: GHIIs + resources + version + settings) ──

    // GET /v1/federation/node-card — public: this node's card (descriptor + operators + resources).
    router.get('/v1/federation/node-card', async (_req, res) => {
        const card = await buildNodeCard(config, storage);
        res.json(success(config.nodeId, card));
    });

    // GET /v1/federation/book — public: the active book (primary = authoritative; leaf = cached mirror).
    router.get('/v1/federation/book', async (_req, res) => {
        const book = await getActiveBook(storage);
        res.json(success(config.nodeId, {
            book: book ?? { book_version: 0, issued_by: config.nodeId, issued_at: new Date(0).toISOString(), nodes: [] },
            is_primary: !config.genesisUrl,
        }));
    });

    // POST /v1/federation/book/rebuild — primary reassembles the book from peers' node-cards (operator).
    router.post('/v1/federation/book/rebuild', requireAuth(), requireRole('operator'), async (_req, res) => {
        const book = await assembleBook(config, storage, peers);
        res.json(success(config.nodeId, { book, nodes: book.nodes.length }));
        emitChange('federation');
    });

    // POST /v1/federation/book/pull — leaf mirrors the book from its genesis: fetch + verify + version-gate.
    router.post('/v1/federation/book/pull', requireAuth(), requireRole('operator'), async (req, res) => {
        const r = await pullBook(config, storage, peers, req.body?.source_url as string | undefined);
        if (!r.ok) {
            res.status(r.status).json(error(config.nodeId, r.code ?? 'FETCH_FAILED', r.message ?? 'pull failed'));
            return;
        }
        res.json(success(config.nodeId, { applied: r.applied, reason: r.reason, book_version: r.book_version, nodes: r.nodes }));
        emitChange('federation');
    });
}
