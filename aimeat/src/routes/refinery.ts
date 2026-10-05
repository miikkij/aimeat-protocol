/**
 * @file src/routes/refinery.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The refinery's HTTP endpoints: the class packs, starting a batch, and reading how far
 *   it is. The work is src/services/refinery/, which the MCP tools and the scheduler call too.
 *
 *   A batch spends four of the owner's permissions at once (the mailbox, the model, the rows, the
 *   definition's memory), so the start asks for all four: an app or agent token that lacks one is
 *   refused here, by name, rather than halfway through a batch. A visitor from another node is
 *   refused: the mailbox and the rows belong to a local account.
 * @structure refineryRouter(config, storage) · refineryCallerOf(req, nodeId)
 * @usage app.use(refineryRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-09-29 — Initial (wish aimeat-refinery).
 *   v1.0.1 — 2026-10-05 — The run scopes and the prefix rule are the one copy in
 *     services/refinery/schedule-input.ts (secaudit 2026-10, drift 1).
 */
import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { resolveIdentity, isForeignPrincipal } from '../utils/gaii.js';
import { isOwnerPrincipal } from '../auth/account-security.js';
import { CLASS_PACKS } from '../data/refinery-classes.js';
import { startRun, getRun } from '../services/refinery/runs.js';
import type { RefineryCaller } from '../services/refinery/pipeline.js';

import { REFINERY_RUN_SCOPES, REFINERY_PREFIX_RE as PREFIX_RE } from '../services/refinery/schedule-input.js';

/** The scopes a batch spends, all four needed: the one copy in services/refinery/schedule-input.ts. */
export { REFINERY_RUN_SCOPES };

/** Who is asking, as the pipeline takes it: the human whose mailbox and budget, and who asked. */
export function refineryCallerOf(req: Request, nodeId: string): RefineryCaller {
  const auth = req.auth!;
  return {
    ownerGhii: `${auth.owner}@${nodeId}`,
    owner: auth.owner,
    principal: resolveIdentity(auth, nodeId),
    roles: auth.roles,
    scopes: auth.scopes ?? [],
    isOwner: isOwnerPrincipal(auth),
    ...((auth as { app?: string }).app ? { appRef: (auth as { app?: string }).app } : {}),
  };
}

export function refineryRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // ── GET /v1/refinery/classes ── the class packs, for any signed-in caller.
  router.get('/v1/refinery/classes', requireAuth(), (_req: Request, res: Response) => {
    res.json(success(config.nodeId, { classes: CLASS_PACKS }));
  });

  // ── POST /v1/refinery/runs ── start a batch; answers at once with the run, 202.
  router.post('/v1/refinery/runs', requireAuth(), requireScope(...REFINERY_RUN_SCOPES), (req: Request, res: Response) => {
    if (isForeignPrincipal(req.auth!)) {
      res.status(403).json(error(config.nodeId, 'LOCAL_ACCOUNT_REQUIRED', 'A refinery reads a local account\'s mailbox; a visitor from another node cannot run one here.'));
      return;
    }
    const prefix = typeof req.body?.prefix === 'string' ? req.body.prefix.trim() : '';
    if (!PREFIX_RE.test(prefix)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'prefix names the definition: lowercase letters, digits, - or _, 2 to 41 characters (the definition is <prefix>.config).'));
      return;
    }
    const ids = Array.isArray(req.body?.message_ids)
      ? (req.body.message_ids as unknown[]).filter((x): x is string => typeof x === 'string' && /^[A-Za-z0-9_=-]{1,200}$/.test(x)).slice(0, 50)
      : undefined;
    const { run, already } = startRun({ storage, config }, refineryCallerOf(req, config.nodeId), prefix, { messageIds: ids });
    res.status(already ? 200 : 202).json(success(config.nodeId, { run, already_running: already }, [
      { description: 'Follow the batch', method: 'GET', url: `/v1/refinery/runs/${run.id}` },
    ]));
  });

  // ── GET /v1/refinery/runs/:id ── how far a batch is; only the owner it runs for sees it, and only
  //    with the word that reads a mailbox, because the rows name the subjects it read.
  router.get('/v1/refinery/runs/:id', requireAuth(), requireScope('connections:read-through'), (req: Request, res: Response) => {
    const run = getRun(req.params.id as string, `${req.auth!.owner}@${config.nodeId}`);
    if (!run) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such run. A finished run is kept for an hour; the batch\'s rows and <prefix>.runs keep the rest.'));
      return;
    }
    res.json(success(config.nodeId, { run }));
  });

  return router;
}
