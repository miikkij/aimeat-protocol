/**
 * @file src/routes/file-store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where stored files keep their bytes, over REST. A person reads their stores and the ones
 *   they may choose, connects a named store of their own or makes one the default, disconnects one,
 *   and moves files between places (`/v1/file-store`); an operator reads every store, adds, changes and
 *   removes the node's named stores, tests one, moves files between node places, and decides who may
 *   use their own (`/v1/admin/file-store`). The work is in services/file-store/; the MCP tools
 *   (src/mcp/file-store.ts) call the same functions.
 *
 *   WHO MAY CONNECT. A store decides where later uploads of the person go, and it carries a key, so
 *   connecting, replacing and disconnecting take the person in person or an agent holding
 *   secrets:manage, the permission that already governs their credentials. Reading the view takes
 *   storage:read; moving files takes storage:write. Every body is checked against its schema here.
 * @structure fileStoreRouter(config, storage)
 * @usage app.use(fileStoreRouter(config, storage));
 * @version-history
 *   v1.1.0 — 2026-10-30 — Named stores: `name` and `make_default` on connect, `?name=` on disconnect,
 *     `to` and `from` on a move; the operator's PUT and DELETE /v1/admin/file-store/stores/{name}, a
 *     test by name, and a move with `from` and `to` (wish-useampi-tiedostos-il-yksi-oletus-ja-tallentaja-voi-valita-s-).
 *   v1.0.0 — 2026-10-29 — Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import { validateBody } from '../models/schemas.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope, requireOperator } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { callerOf } from '../middleware/caller.js';
import { localAccountName } from '../utils/gaii.js';
import type { FileStoreResult } from '../services/file-store/file-store-admin.js';
import { moveFilesToNodeStore, nodeFileStoreStatus, testNodeFileStore } from '../services/file-store/file-store-admin.js';
import {
  connectOwnerFileStore, decideOwnerFileStore, moveOwnerFiles, ownerFileStoreView, removeOwnerFileStore,
} from '../services/file-store/owner-file-store-actions.js';
import { removeNodeFileStore, setNodeFileStore } from '../services/file-store/node-file-store-actions.js';

const text = (max: number) => z.string().max(max).optional();

/** The address and key fields of a store. Which a kind needs is the service's check, which names the missing ones. */
const STORE_FIELDS = {
  kind: z.enum(['s3', 'azure']).optional(),
  endpoint: text(2048), region: text(64), bucket: text(255), addressing: z.enum(['auto', 'path', 'host']).optional(),
  access_key_id: text(256), secret_access_key: text(512),
  account: text(64), container: text(63), credential: text(4096),
  prefix: text(200),
};

/** PUT /v1/file-store. Without `kind` only `make_default` applies, to the store `name` names. */
const ConnectSchema = z.object({ ...STORE_FIELDS, name: text(40), make_default: z.boolean().optional(), reason: text(500) }).strict();
const MoveSchema = z.object({
  to: text(100), from: text(100), direction: z.enum(['own', 'home']).optional(), limit: z.number().int().min(1).max(200).optional(),
}).strict();
const NodeStoreSchema = z.object({ ...STORE_FIELDS, selectable: z.boolean().optional(), make_default: z.boolean().optional() }).strict();
const AdminTestSchema = z.object({ name: text(40) }).strict();
const AdminMoveSchema = z.object({ limit: z.number().int().min(1).max(500).optional(), after: text(2048), from: text(100), to: text(100) }).strict();
const DecisionSchema = z.object({ decision: z.enum(['approve', 'decline', 'revoke']), note: text(500) }).strict();

export function fileStoreRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const ctx = { storage, config };

  const answer = <T>(res: Response, r: FileStoreResult<T>, okStatus = 200) => {
    if (!r.ok) { res.status(r.status).json(error(config.nodeId, r.code, r.message)); return; }
    res.status(okStatus).json(success(config.nodeId, r.data));
  };

  /** The person behind the caller, or a refusal already sent. */
  const personOf = (req: Request, res: Response) => {
    const c = callerOf(req, config.nodeId, storage);
    if (c.visitor) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'A session from another node has no storage here.'));
      return null;
    }
    return c;
  };

  router.get('/v1/file-store', requireAuth(), requireScope('storage:read'), async (req, res) => {
    const c = personOf(req, res);
    if (!c) return;
    res.json(success(config.nodeId, await ownerFileStoreView(ctx, c.owner, { operator: await c.operator() })));
  });

  // secrets:manage: the owner in person passes requireScope; an agent or an app needs the word.
  router.put('/v1/file-store', requireAuth(), requireScope('secrets:manage'), validateBody(ConnectSchema, config.nodeId), async (req, res) => {
    const c = personOf(req, res);
    if (!c) return;
    const r = await connectOwnerFileStore(ctx, { account: c.owner, actor: c.principal, operator: await c.operator() }, req.body as Record<string, unknown>);
    answer(res, r, r.ok && r.data.outcome === 'waiting_for_operator' ? 202 : 200);
  });

  router.delete('/v1/file-store', requireAuth(), requireScope('secrets:manage'), async (req, res) => {
    const c = personOf(req, res);
    if (!c) return;
    answer(res, await removeOwnerFileStore(ctx, c.owner, req.query.name));
  });

  router.post('/v1/file-store/move', requireAuth(), requireScope('storage:write'), validateBody(MoveSchema, config.nodeId), async (req, res) => {
    const c = personOf(req, res);
    if (!c) return;
    answer(res, await moveOwnerFiles(ctx, { account: c.owner, operator: await c.operator() }, req.body as Record<string, unknown>));
  });

  router.get('/v1/admin/file-store', requireAuth(), requireOperator(storage), async (_req, res) => {
    res.json(success(config.nodeId, await nodeFileStoreStatus(ctx)));
  });

  router.put('/v1/admin/file-store/stores/:name', requireAuth(), requireOperator(storage), validateBody(NodeStoreSchema, config.nodeId), async (req, res) => {
    const c = callerOf(req, config.nodeId, storage);
    const r = await setNodeFileStore(ctx, c.principal, { ...(req.body as Record<string, unknown>), name: req.params.name as string });
    answer(res, r, r.ok && r.data.outcome === 'added' ? 201 : 200);
  });

  router.delete('/v1/admin/file-store/stores/:name', requireAuth(), requireOperator(storage), async (req, res) => {
    answer(res, await removeNodeFileStore(ctx, req.params.name as string));
  });

  router.post('/v1/admin/file-store/test', requireAuth(), requireOperator(storage), validateBody(AdminTestSchema, config.nodeId), async (req, res) => {
    answer(res, await testNodeFileStore(ctx, (req.body as { name?: string }).name));
  });

  router.post('/v1/admin/file-store/move', requireAuth(), requireOperator(storage), validateBody(AdminMoveSchema, config.nodeId), async (req, res) => {
    answer(res, await moveFilesToNodeStore(ctx, req.body as Record<string, unknown>));
  });

  router.post('/v1/admin/file-store/owners/:owner/decision', requireAuth(), requireOperator(storage), validateBody(DecisionSchema, config.nodeId), async (req, res) => {
    const c = callerOf(req, config.nodeId, storage);
    const body = req.body as { decision?: unknown; note?: unknown };
    answer(res, await decideOwnerFileStore(ctx, c.principal, { owner: localAccountName(req.params.owner as string), decision: body.decision, note: body.note }));
  });

  return router;
}
