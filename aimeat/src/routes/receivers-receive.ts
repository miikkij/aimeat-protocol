/**
 * @file src/routes/receivers-receive.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The receiver address an outside program calls: /v1/receive/{owner}/{name} and
 *   /v1/receive/{owner}/{name}/{sub}, with POST, PUT, PATCH, GET and DELETE, and GET
 *   /v1/receive/{owner}/{name}/_self for what the receiver takes. The credential is the receiver's own
 *   key, declared with acceptCredential('receiver') (auth/credential-strategies.ts); the handler
 *   decides nothing and answers what services/receivers/receive.ts returns, in the node's envelope.
 * @structure receiveRouter(config, storage)
 * @usage app.use(receiveRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial (wish-vastaanottimet-receivers-ulkopuolinen-ohjelma-kirjoittaa-yht).
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { acceptCredential, credentialOf } from '../auth/credential-strategies.js';
import { success, error } from '../middleware/envelope.js';
import { receive } from '../services/receivers/receive.js';
import { ReceiverError } from '../services/receivers/store.js';

export function receiveRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();
    const fanout = { storage, config };
    const deps = { storage, config };

    const handle = async (req: Request, res: Response): Promise<void> => {
        const ctx = credentialOf(req, 'receiver');
        const declared = Number(req.headers['content-length']);
        const bytes = Number.isFinite(declared) && declared >= 0
            ? declared
            : req.body === undefined ? 0 : Buffer.byteLength(JSON.stringify(req.body), 'utf8');
        const idem = req.headers['idempotency-key'];
        const ifMatch = req.headers['if-match'];
        const version = typeof ifMatch === 'string' ? Number(ifMatch.replace(/^W\//, '').replace(/"/g, '')) : NaN;
        try {
            const out = await receive(fanout, ctx, {
                method: req.method,
                sub: typeof req.params.sub === 'string' ? req.params.sub : null,
                body: req.body,
                contentType: String(req.headers['content-type'] ?? ''),
                bytes,
                idempotencyKey: typeof idem === 'string' && idem.length > 0 && idem.length <= 200 ? idem : null,
                ifMatch: Number.isInteger(version) && version >= 0 ? version : null,
                dryRun: req.query.dry_run === 'true' || req.query.dry_run === '1',
            });
            if (typeof out.data.version === 'number') res.set('ETag', `"${out.data.version}"`);
            res.status(out.status).json(success(config.nodeId, out.data));
        } catch (err) {
            if (!(err instanceof ReceiverError)) throw err;
            const retryAfter = err.extra?.retryAfter;
            if (typeof retryAfter === 'number') res.set('Retry-After', String(retryAfter));
            const details = Object.fromEntries(Object.entries(err.extra ?? {}).filter(([k]) => k !== 'retryAfter'));
            res.status(err.status).json(error(config.nodeId, err.code, err.message, undefined, Object.keys(details).length ? details : undefined));
        }
    };

    // Written out route by route, with acceptCredential('receiver', …) named in each chain, so
    // check:openapi-routes and check:open-writes read each route and its credential from the source.
    router.post('/v1/receive/:owner/:name', acceptCredential('receiver', deps), handle);
    router.put('/v1/receive/:owner/:name', acceptCredential('receiver', deps), handle);
    router.patch('/v1/receive/:owner/:name', acceptCredential('receiver', deps), handle);
    router.get('/v1/receive/:owner/:name', acceptCredential('receiver', deps), handle);
    router.delete('/v1/receive/:owner/:name', acceptCredential('receiver', deps), handle);
    router.post('/v1/receive/:owner/:name/:sub', acceptCredential('receiver', deps), handle);
    router.put('/v1/receive/:owner/:name/:sub', acceptCredential('receiver', deps), handle);
    router.patch('/v1/receive/:owner/:name/:sub', acceptCredential('receiver', deps), handle);
    router.get('/v1/receive/:owner/:name/:sub', acceptCredential('receiver', deps), handle);
    router.delete('/v1/receive/:owner/:name/:sub', acceptCredential('receiver', deps), handle);
    return router;
}
