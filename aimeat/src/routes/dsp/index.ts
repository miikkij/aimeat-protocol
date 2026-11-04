/**
 * @file src/routes/dsp/index.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Eclipse Dataspace Protocol 2025-1 endpoints, provider side (plan doc-mvwxcas3dom3,
 *   D8), HTTPS binding. Every answer is the DSP shape (compacted JSON-LD with the DSP context), never
 *   the node's envelope, because a DSP connector reads these and nothing else.
 *
 *   OFF BY DEFAULT. While AIMEAT_DATASPACE_ENABLED is off, /.well-known/dspace-version and every path
 *   under /dsp/2025-1 answer 404 with nothing to tell that the protocol exists here. The router is
 *   mounted always and asks the running config on each request, so the switch on the Config page takes
 *   effect without a restart.
 *
 *   WHO IS CALLING. The version endpoint takes no credential (DSP: unversioned and unauthenticated).
 *   Every other endpoint declares acceptCredential('dsp-participant') (auth/credential-strategies.ts),
 *   which asks the DSP verifier (services/dataspace/verifier.ts) for the participant before the
 *   handler runs; the global auth middleware leaves these paths alone (takesDataspaceCredential), and
 *   req.auth is never set or read here. A request with no valid credential is 401 on every endpoint; a valid
 *   participant asking for a process of another participant is 404, as DSP has unauthorized access.
 *   Then the body is checked against DspMessageSchema, and a body of the wrong shape is 400.
 * @structure
 *   - GET  /.well-known/dspace-version                 the versions this node speaks
 *   - GET  /.well-known/did.json                       the node's participant DID document (while on; else the node's own)
 *   - POST /dsp/2025-1/catalog/request                 the catalog for this participant (paged, Link rel=next)
 *   - GET  /dsp/2025-1/catalog/datasets/:id            one dataset
 *   - GET  /dsp/2025-1/negotiations/:pid               a negotiation's state
 *   - POST /dsp/2025-1/negotiations/request            a new negotiation (201)
 *   - POST /dsp/2025-1/negotiations/:pid/request       a counter-offer
 *   - POST /dsp/2025-1/negotiations/:pid/events        the ACCEPTED event
 *   - POST /dsp/2025-1/negotiations/:pid/agreement/verification
 *   - POST /dsp/2025-1/negotiations/:pid/termination
 *   - GET  /dsp/2025-1/transfers/:pid                  a transfer's state
 *   - POST /dsp/2025-1/transfers/request               a new transfer (201)
 *   - POST /dsp/2025-1/transfers/:pid/{start,completion,suspension,termination}
 * @usage app.use(dspRouter(config, storage))
 * @version-history
 *   2026-11-04 — The participant is verified by the declared credential strategy
 *     acceptCredential('dsp-participant') instead of participantOf() in each handler; same answers
 *     (codebase analysis 2026-11-03, item B8).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8).
 */
import express, { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { z } from 'zod';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { DspMessageSchema } from '../../models/dataspace-schemas.js';
import { DSP_PATH, DSP_VERSION, catalogError, negotiationError, transferError } from '../../services/dataspace/contract.js';
import type { Participant } from '../../services/dataspace/verifier.js';
import { acceptCredential, credentialOf } from '../../auth/credential-strategies.js';
import { CATALOG_PAGE, catalogJson, datasetFor, datasetJson, visibleDatasets } from '../../services/dataspace/catalog.js';
import { tckDataset, tckDatasets } from '../../services/dataspace/tck.js';
import { tckModeOn } from '../../services/dataspace/settings.js';
import {
    counterOffer, negotiationEvent, readNegotiationFor, requestNegotiation, terminateNegotiation, verifyAgreement,
} from '../../services/dataspace/negotiation.js';
import { readTransferFor, requestTransfer, transferMessage } from '../../services/dataspace/transfer.js';
import { logger } from '../../utils/logger.js';
import { exportJWK } from 'jose';
import { getNodeCryptoKeys } from '../../auth/jwt.js';
import { dataspaceDidDocument } from '../../services/dataspace/identity.js';

type Kind = 'catalog' | 'negotiation' | 'transfer';
type Answer = { status: number; body: Record<string, unknown> };
const pidOf = (req: Request): string => String(req.params.pid ?? '');

export function dspRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();
    const deps = { storage, config };
    const off = (_req: Request, res: Response, next: NextFunction): void => {
        if (!config.dataspaceEnabled) { res.status(404).json({ error: 'Not found' }); return; }
        next();
    };
    const errorBody = (kind: Kind, code: string, reason: string, pid = '') =>
        kind === 'catalog' ? catalogError(code, reason) : kind === 'negotiation' ? negotiationError(pid, '', code, reason) : transferError(pid, '', code, reason);

    // The participant is verified by the route's acceptCredential('dsp-participant') (auth/credential-strategies.ts),
    // which answers the 401 in the DSP error shape of `process`; each handler reads it with credentialOf().
    const catalog = { config, process: 'catalog' } as const;
    const negotiation = { config, process: 'negotiation' } as const;
    const transfer = { config, process: 'transfer' } as const;
    const participantOf = (req: Request): Participant => credentialOf(req, 'dsp-participant');
    /** Send the 400 of a body that is not a DSP message. */
    const invalid = (res: Response, kind: Kind, err: z.ZodError, pid = ''): void => {
        res.status(400).json(errorBody(kind, 'INVALID_MESSAGE', `The message does not have the DSP shape: ${err.issues.map(i => `${i.path.join('.') || '(body)'} ${i.message}`).join('; ').slice(0, 400)}`, pid));
    };
    const send = (res: Response, out: Answer): void => { res.status(out.status).json(out.body); };

    // ── Version metadata (unauthenticated) ──
    router.get('/.well-known/dspace-version', off, (_req, res) => {
        res.json({
            protocolVersions: [{
                version: DSP_VERSION, path: DSP_PATH, binding: 'HTTPS', serviceId: `${config.nodeId}-dsp`,
                identifierType: 'did:web', auth: { protocol: 'DCP', version: '1.0', profile: ['vc20-bssl/jwt'] },
            }],
        });
    });

    // ── The node's DID document while the dataspace is on (D8.5) ──
    // Mounted before the node's own did.json route (routes-loader.ts, registered once the node key has
    // loaded), which answers whenever this one passes: the same key, without the DSP relationships.
    router.get('/.well-known/did.json', async (_req, res, next) => {
        if (!config.dataspaceEnabled) { next(); return; }
        try {
            const jwk = await exportJWK(getNodeCryptoKeys().publicKey);
            res.json(dataspaceDidDocument(config, jwk, config.vcIssuerDid || undefined));
        } catch (err) {
            logger.warn('dataspace: the DID document could not be built', { error: String(err) });
            next();
        }
    });

    router.use(DSP_PATH, off, express.json({ type: ['application/json', 'application/ld+json'], limit: '1mb' }));

    // ── Catalog ──
    router.post('/dsp/2025-1/catalog/request', acceptCredential('dsp-participant', catalog), async (req, res) => {
        const participant = participantOf(req);
        const m = DspMessageSchema.safeParse(req.body ?? {});
        if (!m.success) { invalid(res, 'catalog', m.error); return; }
        const msg = m.data as Record<string, unknown>;
        if (msg['@type'] !== 'CatalogRequestMessage') { res.status(400).json(catalogError('INVALID_MESSAGE', 'A CatalogRequestMessage is expected.')); return; }
        if (Array.isArray(msg.filter) && msg.filter.length) { res.status(400).json(catalogError('UNSUPPORTED_FILTER', 'This server takes no catalog filter; send an empty one.')); return; }
        const all = [...(tckModeOn(config) ? tckDatasets() : []), ...(await visibleDatasets(deps, participant))];
        const offset = Math.max(0, Number.parseInt(String(req.query.continuationToken ?? '0'), 10) || 0);
        const page = all.slice(offset, offset + CATALOG_PAGE);
        const self = `${config.baseUrl.replace(/\/+$/, '')}${DSP_PATH}/catalog/request`;
        const links: string[] = [];
        if (offset + CATALOG_PAGE < all.length) links.push(`<${self}?continuationToken=${offset + CATALOG_PAGE}>; rel="next"`);
        if (offset > 0) links.push(`<${self}?continuationToken=${Math.max(0, offset - CATALOG_PAGE)}>; rel="previous"`);
        if (links.length) res.setHeader('Link', links.join(', '));
        res.json(catalogJson(config, page));
    });

    router.get('/dsp/2025-1/catalog/datasets/:id', acceptCredential('dsp-participant', catalog), async (req, res) => {
        const participant = participantOf(req);
        const id = String(req.params.id ?? '');
        const ds = (tckModeOn(config) ? tckDataset(id) : null) ?? await datasetFor(deps, participant, id);
        if (!ds) { res.status(404).json(catalogError('NOT_FOUND', 'No such dataset for this participant.')); return; }
        res.json(datasetJson(config, ds, true));
    });

    // ── Contract negotiation ──
    router.post('/dsp/2025-1/negotiations/request', acceptCredential('dsp-participant', negotiation), async (req, res) => {
        const participant = participantOf(req);
        const m = DspMessageSchema.safeParse(req.body ?? {});
        if (!m.success) { invalid(res, 'negotiation', m.error); return; }
        send(res, await requestNegotiation(deps, participant, m.data as Record<string, unknown>));
    });
    router.get('/dsp/2025-1/negotiations/:pid', acceptCredential('dsp-participant', negotiation), async (req, res) => {
        send(res, await readNegotiationFor(deps, participantOf(req), pidOf(req)));
    });
    router.post('/dsp/2025-1/negotiations/:pid/request', acceptCredential('dsp-participant', negotiation), async (req, res) => {
        const participant = participantOf(req);
        const m = DspMessageSchema.safeParse(req.body ?? {});
        if (!m.success) { invalid(res, 'negotiation', m.error, pidOf(req)); return; }
        send(res, await counterOffer(deps, participant, pidOf(req), m.data as Record<string, unknown>));
    });
    router.post('/dsp/2025-1/negotiations/:pid/events', acceptCredential('dsp-participant', negotiation), async (req, res) => {
        const participant = participantOf(req);
        const m = DspMessageSchema.safeParse(req.body ?? {});
        if (!m.success) { invalid(res, 'negotiation', m.error, pidOf(req)); return; }
        send(res, await negotiationEvent(deps, participant, pidOf(req), m.data as Record<string, unknown>));
    });
    router.post('/dsp/2025-1/negotiations/:pid/agreement/verification', acceptCredential('dsp-participant', negotiation), async (req, res) => {
        const participant = participantOf(req);
        const m = DspMessageSchema.safeParse(req.body ?? {});
        if (!m.success) { invalid(res, 'negotiation', m.error, pidOf(req)); return; }
        send(res, await verifyAgreement(deps, participant, pidOf(req), m.data as Record<string, unknown>));
    });
    router.post('/dsp/2025-1/negotiations/:pid/termination', acceptCredential('dsp-participant', negotiation), async (req, res) => {
        const participant = participantOf(req);
        const m = DspMessageSchema.safeParse(req.body ?? {});
        if (!m.success) { invalid(res, 'negotiation', m.error, pidOf(req)); return; }
        send(res, await terminateNegotiation(deps, participant, pidOf(req), m.data as Record<string, unknown>));
    });

    // ── Transfer process ──
    router.post('/dsp/2025-1/transfers/request', acceptCredential('dsp-participant', transfer), async (req, res) => {
        const participant = participantOf(req);
        const m = DspMessageSchema.safeParse(req.body ?? {});
        if (!m.success) { invalid(res, 'transfer', m.error); return; }
        send(res, await requestTransfer(deps, participant, m.data as Record<string, unknown>));
    });
    router.get('/dsp/2025-1/transfers/:pid', acceptCredential('dsp-participant', transfer), async (req, res) => {
        send(res, await readTransferFor(deps, participantOf(req), pidOf(req)));
    });
    router.post('/dsp/2025-1/transfers/:pid/start', acceptCredential('dsp-participant', transfer), async (req, res) => {
        const participant = participantOf(req);
        const m = DspMessageSchema.safeParse(req.body ?? {});
        if (!m.success) { invalid(res, 'transfer', m.error, pidOf(req)); return; }
        send(res, await transferMessage(deps, participant, pidOf(req), 'start', m.data as Record<string, unknown>));
    });
    router.post('/dsp/2025-1/transfers/:pid/completion', acceptCredential('dsp-participant', transfer), async (req, res) => {
        const participant = participantOf(req);
        const m = DspMessageSchema.safeParse(req.body ?? {});
        if (!m.success) { invalid(res, 'transfer', m.error, pidOf(req)); return; }
        send(res, await transferMessage(deps, participant, pidOf(req), 'completion', m.data as Record<string, unknown>));
    });
    router.post('/dsp/2025-1/transfers/:pid/suspension', acceptCredential('dsp-participant', transfer), async (req, res) => {
        const participant = participantOf(req);
        const m = DspMessageSchema.safeParse(req.body ?? {});
        if (!m.success) { invalid(res, 'transfer', m.error, pidOf(req)); return; }
        send(res, await transferMessage(deps, participant, pidOf(req), 'suspension', m.data as Record<string, unknown>));
    });
    router.post('/dsp/2025-1/transfers/:pid/termination', acceptCredential('dsp-participant', transfer), async (req, res) => {
        const participant = participantOf(req);
        const m = DspMessageSchema.safeParse(req.body ?? {});
        if (!m.success) { invalid(res, 'transfer', m.error, pidOf(req)); return; }
        send(res, await transferMessage(deps, participant, pidOf(req), 'termination', m.data as Record<string, unknown>));
    });

    return router;
}
