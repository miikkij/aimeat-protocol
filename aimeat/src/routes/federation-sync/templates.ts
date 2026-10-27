/**
 * @file src/routes/federation-sync/templates.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Cross-node template sharing (serve/sync template listings) + peer-to-peer memory listing.
 *   Extracted from federation-sync.ts to satisfy max-file-lines.
 * @version-history
 *   v1.6.2 — 2026-10-27 — POST /v1/federation/memory/list refuses a person whose account is
 *     deactivated (403 ACCOUNT_DISABLED, asked after the consent), and a peer under this node's own id
 *     lists nobody here as its own people (secaudit2026oct26).
 *   v1.6.1 — 2026-10-22 — The inventory consent check names the local person with localAccountOf()
 *     (check:identity-shortening).
 *   v1.6.0 — 2026-10-22 — POST /v1/federation/memory/list lists a principal of the requesting node as
 *     before, a person of this node only while that person's sign-in consent for the requesting node
 *     holds (403 CONSENT_REQUIRED otherwise; an agent follows its owner's consent), and refuses a
 *     third node's principal (403 NAMESPACE_NOT_ALLOWED). It had listed any local person's private
 *     key names for any linked member peer (secaudit 2026-10 wave 3, v70).
 *   v1.5.0 — 2026-10-16 — POST /v1/federation/templates/sync stores what it fetched, one memory record
 *     per peer (services/federation-remote-templates.ts), and answers per peer whether it was stored;
 *     it had counted each listing and dropped it (QA audit F1-04).
 *   2026-10-16 — The template listing names this node as its audience in headers (x-audience,
 *     x-audience-signature) and passes once inside five minutes (signedGetRefusal); the sync sends the
 *     headers (QA audit S6-09).
 *   v1.4.0 — 2026-10-10 — A peer that has once sent a verified audience or delivery proof is refused a
 *     memory-list request without one, whatever AIMEAT_FEDERATION_AUDIENCE_REQUIRED says (pinnedRefusal;
 *     secaudit 2026-10-10 I21).
 *   v1.3.0 — 2026-10-06 — The memory-list request names this node as its audience (audienceRefusal;
 *     secaudit 2026-10 follow-up, A7).
 *   v1.2.1 — 2026-10-06 — A signed memory-list request passes once (signedMessageRefusal; secaudit
 *     2026-10 follow-up, A7). The template listing is a read of the shared catalogue and keeps its window only.
 *   v1.2.0 — 2026-10-05 — The operator routes ask requireOperator (askOperator with operator:admin), so the operator's agent holding operator:admin passes as on MCP (secaudit 2026-10, C2).
 *   v1.1.0 — 2026-08-10 — Security audit H-15 (the July F2): POST /v1/federation/memory/list requires an
 *     Ed25519 peer signature and a fresh timestamp. Its only gate was a node id, which the public
 *     directory publishes, so anyone could read anyone's whole memory key inventory. BREAKING for a
 *     peer on older code: it gets a clean 401 and re-federates. Developer decision, security first.
 *   v1.0.0 — 2026-07-13 — Extracted from federation-sync.ts (max-file-lines)
 */

import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireOperator } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { logger } from '../../utils/logger.js';
import type { PeerInfo } from '../../services/federation.js';
import { emitChange } from '../../services/event-bus.js';
import { verify } from '../../auth/keypair.js';
import { syncRemoteTemplates } from '../../services/federation-remote-templates.js';
import {
    signedMessageRefusal, audienceRefusal, pinnedRefusal, federationPeerProofPin, signedGetRefusal,
} from '../../services/signed-node-request.js';
import { gatePeer } from '../../services/federation-peer-gate.js';
import { peerMayActFor, signInConsentRefusal, accountDisabledRefusal } from '../../services/federation-auth-consent.js';
import { parseGaiiLoose, localAccountOf } from '../../utils/gaii.js';

/** How stale a signed peer request may be. Same window /v1/federation/peer/introduce uses. */
const FRESHNESS_MS = 5 * 60 * 1000;

export function registerTemplatesRoutes(router: Router, config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): void {
    /**
     * Whose key inventory a peer may list, or the refusal (secaudit 2026-10 wave 3, v70). Two callers
     * exist (routes/memory/federation.ts): list-remote names a principal of the requesting node itself,
     * and list-home names a person of this node who is signed in on the requesting node as a visitor,
     * which this node allowed only after it found the person's sign-in consent for that node
     * (routes/federation-auth.ts). So the requesting node's own principals are listed as before; a
     * person of this node is listed only while that same consent holds (an agent or app of this node
     * follows its owner's consent); a third node's principal is refused, as the replicate route does.
     * Until 2026-10-22 the gaii in the body was not checked, and a linked peer listed any local
     * person's private key names.
     */
    const inventoryRefusal = async (gaii: string, requestingNode: string, peer: PeerInfo): Promise<{ code: string; message: string } | null> => {
        const parsed = parseGaiiLoose(gaii);
        if (!parsed.owner || !parsed.node) {
            return { code: 'NAMESPACE_NOT_ALLOWED', message: `A memory list names a person or agent of the node that asks or of this node, and "${gaii}" is neither. Send the full identity, such as name@node.` };
        }
        // A peer under this node's own id has no people of its own here (secaudit2026oct26).
        if (parsed.node === requestingNode && requestingNode !== config.nodeId) return null;
        if (parsed.node !== config.nodeId) {
            return { code: 'NAMESPACE_NOT_ALLOWED', message: `A node lists its own people's records here, and ${gaii} is on ${parsed.node}, not on ${requestingNode}, the node that signed this request.` };
        }
        const account = localAccountOf(gaii);
        if (!account) {
            return { code: 'NAMESPACE_NOT_ALLOWED', message: `A memory list names a person or agent of the node that asks or of this node, and "${gaii}" is neither. Send the full identity, such as name@node.` };
        }
        const person = `${account.toLowerCase()}@${config.nodeId}`;
        // A deactivated account is listed for nobody, asked after the consent (secaudit2026oct26).
        if (await peerMayActFor(storage, { tier: peer.tier, nodeId: requestingNode }, person)) return await accountDisabledRefusal(storage, person, config.nodeId);
        return { code: 'CONSENT_REQUIRED', message: signInConsentRefusal(person, requestingNode, config.nodeId) };
    };

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

        // A template listing is catalogue, so it rides the catalogue word.
        const gate = gatePeer(peers, sourceNode, 'shareCatalogue');
        if (!gate.ok) {
            res.status(gate.status).json(error(config.nodeId, gate.code, gate.message));
            return;
        }

        // SECURITY: the only gate here used to be that `x-source-node` NAMED an active peer, and a
        // node id is public — GET /v1/federation/directory publishes it. Anyone who could read the
        // directory could set the header and read this. That is decoration, not a gate, and it is the
        // same finding as audit H-15 on /v1/federation/memory/list, closed the same way: the caller
        // signs `{ source_node, timestamp }` and proves it is the node it names.
        //
        // BREAKING for a peer running older code, which sends no signature and gets a clean 401. Same
        // trade the developer took for /memory/list on 2026-08-10: a gate that does not gate is worth
        // less than version skew. The client half below signs, so a node on this version speaks to a
        // node on this version.
        const signature = req.headers['x-signature'] as string | undefined;
        const timestamp = req.headers['x-timestamp'] as string | undefined;
        if (!signature || !timestamp) {
            res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Missing x-signature / x-timestamp on template listing request'));
            return;
        }
        const listTs = new Date(timestamp).getTime();
        if (isNaN(listTs) || Math.abs(Date.now() - listTs) > 300_000) {
            res.status(400).json(error(config.nodeId, 'STALE_TIMESTAMP', 'Timestamp is missing, invalid, or outside the 5-minute window'));
            return;
        }
        const listSigned = JSON.stringify({ source_node: sourceNode, timestamp });
        if (!await verify(gate.peer.publicKey, listSigned, signature)) {
            res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Invalid signature on template listing request'));
            return;
        }
        // The node it is for (x-audience) and one use inside the window, as every other signed
        // federation message (Core 2026-11 FED-08; QA audit S6-09). It had the window only.
        const listRefusal = await signedGetRefusal({
            pin: await federationPeerProofPin(storage, gate.peer), headers: req.headers, signed: listSigned,
            sourceNode, timestamp, signature, publicKey: gate.peer.publicKey, thisNodeId: config.nodeId,
            required: config.federationAudienceRequired,
        });
        if (listRefusal) { res.status(listRefusal.status).json(error(config.nodeId, listRefusal.code, listRefusal.message)); return; }

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
    router.post('/v1/federation/templates/sync', requireAuth(), requireOperator(storage), async (req, res) => {
        if (!config.packageFederationEnabled) {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Package federation is not enabled on this node'));
            return;
        }

        // Only peers this node shares its catalogue with. A template listing is catalogue, and asking
        // a peer we would refuse in the other direction is the asymmetry that makes a promise a lie.
        // The service fetches each listing over the peer-signed GET and STORES it, one record per
        // peer, which the Packages page reads through GET /v1/packages/tab. Until 2026-10-16 this
        // handler counted each listing and dropped it, and answered 200 (QA audit F1-04).
        const results = await syncRemoteTemplates(config, storage, peers);

        emitChange('templates');
        emitChange('packages');
        res.json(success(config.nodeId, {
            syncResults: results,
            stored: results.filter(r => r.stored).length,
            failed: results.filter(r => !r.stored).length,
        }, [{ description: 'Read the stored listings', method: 'GET', url: '/v1/packages/tab' }]));
    });

    // POST /v1/federation/memory/list — List memory entries for a user (peer-to-peer)
    router.post('/v1/federation/memory/list', async (req, res) => {
        const { requesting_node, gaii, signature, timestamp } = req.body ?? {};

        if (!requesting_node || !gaii) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'requesting_node and gaii are required'));
            return;
        }

        // A memory key inventory is memory, so it rides the replication word. Until now the only
        // gate was "an active peer with a signature", which let a VISITING peer read any local
        // person's whole key list — a tier that exists to browse a catalogue, reading the inventory.
        const gate = gatePeer(peers, requesting_node, 'replicateMemory');
        if (!gate.ok) {
            res.status(gate.status).json(error(config.nodeId, gate.code, gate.message));
            return;
        }
        const peer = gate.peer;

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
        // A person's key inventory: one listing per signed request (secaudit 2026-10 follow-up, A7).
        // And it names this node as its audience (A7).
        // A peer that has once sent the proof is held to it (pinnedRefusal; secaudit 2026-10-10 I21).
        const replayed = await pinnedRefusal(await federationPeerProofPin(storage, peer), req.body ?? {}, provenSince => audienceRefusal({
            signed: listPayload, audience: req.body?.audience, audienceSignature: req.body?.audience_signature,
            publicKey: peer.publicKey, thisNodeId: config.nodeId, required: config.federationAudienceRequired, provenSince,
        })) ?? signedMessageRefusal(String(requesting_node), timestamp, String(signature));
        if (replayed) { res.status(replayed.status).json(error(config.nodeId, replayed.code, replayed.message)); return; }

        // Whose inventory, after the peer has proved who it is and before anything is read.
        const whose = await inventoryRefusal(String(gaii), String(requesting_node), peer);
        if (whose) {
            res.status(403).json(error(config.nodeId, whose.code, whose.message, 403, { gaii: String(gaii), requesting_node: String(requesting_node) }));
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
