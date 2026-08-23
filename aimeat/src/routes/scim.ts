/**
 * @file src/routes/scim.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The SCIM 2.0 door (BR-04): /v1/scim/v2/:id, where an organisation's directory
 *   pushes its people in and out. SCIMMY + scimmy-routers carry the protocol; the resource
 *   handlers live in services/scim-users.ts; THIS file is the authorization boundary.
 *
 *   requireScimConnection() is a credential family of its own and deliberately never touches
 *   req.auth: the presented bearer's SHA-256 resolves to a CONNECTION RECORD, and the fence is
 *   "the connection the token belongs to must equal the connection the path names" — the gate
 *   reads the stored record, never the request. A JWT or PAT on this door answers 401 (SCIM has
 *   its own token), a SCIM token on any OTHER door is just an unknown bearer, and a valid token
 *   against another connection's path answers 403.
 *
 *   The `/v1` prefix is load-bearing: it keeps these routes inside the wizard, maintenance and
 *   relay guards (middleware-guards.ts matches /^\/v\d+\//), and a SCIM client does not care what
 *   base URL it is given. Responses are SCIM-shaped (application/scim+json, RFC 7644 errors) —
 *   the one route family off the AIMEAT envelope, because the protocol dictates the shape.
 * @structure requireScimConnection() (the gate — listed in scripts/check-route-scopes.ts GATES);
 *   scimRouter(config, storage).
 * @usage app.use(scimRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial (BR-04 phase 3).
 */
import express, { Router } from 'express';
import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import SCIMMYRouters from 'scimmy-routers';
import type { AimeatConfig } from '../config.js';
import type { Storage, SsoConnectionRecord } from '../storage/interface.js';
import { error } from '../middleware/envelope.js';
import { declareScimResources, normalizeEntraPatchBody, type ScimContext } from '../services/scim-users.js';
import { logger } from '../utils/logger.js';

/** How often the playbook's "the directory has called" stamp is worth a write. */
const SCIM_STAMP_THROTTLE_MS = 60_000;
const lastScimStamp = new Map<string, number>();

/** The resolved connection rides the request between the gate and the SCIMMY context. */
interface ScimRequest extends Request {
  scimConnection?: SsoConnectionRecord;
}

/**
 * The SCIM gate. Bearer → SHA-256 → connection record → the record's id must equal the path's.
 * Never sets req.auth; refuses anything that already carries a platform principal.
 */
export function requireScimConnection(config: AimeatConfig, storage: Storage) {
  return async (req: ScimRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!config.ssoEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Provisioning is not enabled on this node'));
      return;
    }
    // A JWT/PAT principal on this door is the wrong credential family, full stop. (The global
    // optionalAuth may have injected the ANONYMOUS identity, which is not a credential.)
    if (req.auth && !req.auth.anonymous) {
      res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Provisioning takes the connection\'s own token, not a sign-in credential'));
      return;
    }
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) {
      res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Provisioning token required'));
      return;
    }
    const conn = await storage.getSsoConnectionByScimTokenHash(createHash('sha256').update(token).digest('hex'));
    if (!conn) {
      res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Unknown provisioning token'));
      return;
    }
    // The fence: a valid token for connection B never acts on connection A's path.
    if (conn.id !== (req.params.id as string)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'This token belongs to a different connection'));
      return;
    }
    req.scimConnection = conn;

    // Playbook evidence, throttled: the directory has actually called this endpoint.
    const now = Date.now();
    if (now - (lastScimStamp.get(conn.id) ?? 0) > SCIM_STAMP_THROTTLE_MS) {
      lastScimStamp.set(conn.id, now);
      storage.updateSsoConnection(conn.id, { lastScimRequestAt: new Date(now).toISOString() })
        .catch(err => logger.warn('lastScimRequestAt stamp failed', { connection: conn.id, error: String(err) }));
    }
    next();
  };
}

export function scimRouter(config: AimeatConfig, storage: Storage): Router {
  declareScimResources();
  const router = Router({ mergeParams: true });

  router.use('/v1/scim/v2/:id',
    requireScimConnection(config, storage),
    // Parse SCIM bodies HERE (the global parser skips application/scim+json), so the Entra
    // string-boolean shim sees the parsed message before SCIMMY's strict schema does.
    express.json({ type: ['application/scim+json', 'application/json'], limit: '1mb' }),
    (req: Request, _res: Response, next: NextFunction) => {
      if (req.method === 'PATCH') normalizeEntraPatchBody(req.body);
      next();
    },
    new SCIMMYRouters({
      type: 'bearer',
      // The gate above already authenticated; SCIMMY only wants an identifier for /Me, which this
      // surface does not serve (a connection is not a person).
      handler: (req: ScimRequest) => {
        if (!req.scimConnection) throw new Error('unauthenticated');
        return '';
      },
      context: (req: ScimRequest): ScimContext => ({ storage, config, conn: req.scimConnection! }),
    }),
  );

  return router;
}
