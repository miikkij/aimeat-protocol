/**
 * @file app-grants-manage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's side of an app grant once it exists: list the keys the apps hold, narrow
 *   one, cap what one may spend, and revoke one. Extracted by pure move from routes/app-grants.ts on
 *   2026-09-05 when the narrowing door would have taken that file past 800 lines; the issuing half
 *   (authorize, consent, code, token, the silent bridge) stays there and this file changes nothing
 *   about it.
 *
 *   NARROWING NEVER WIDENS. PATCH /v1/app-grants/:grantId takes the scopes the owner wants the app
 *   to keep, and refuses anything the grant does not already hold: the consent screen is the only
 *   door that ADDS a word, because it is the only place the app's own ask is on the screen. The
 *   grant is stamped `scopesFixedAt` so the boot-time vocabulary migration leaves it alone; without
 *   the stamp the eight grandfathered words came back on the next restart, which made the page's
 *   "take this away" a lie told twice a day.
 * @structure appGrantsManageRouter(config, storage): GET /v1/app-grants, PATCH /v1/app-grants/:grantId,
 *   PATCH /v1/app-grants/:grantId/spend-cap, DELETE /v1/app-grants/:grantId
 * @usage app.use(appGrantsManageRouter(config, storage));
 * @version-history
 *   v1.1.0 — 2026-09-05 — PATCH /v1/app-grants/:grantId: keep a subset of the scopes, stamp the grant
 *     as fixed by the owner. The Access page's "take this right away" door.
 *   v1.0.0 — 2026-09-05 — Extracted verbatim from routes/app-grants.ts v1.12.0 (max-file-lines).
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';

export function appGrantsManageRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // ── GET /v1/app-grants ── the owner lists the apps they've granted access to.
  router.get('/v1/app-grants', requireAuth(), requireRole('owner'), async (req: Request, res: Response) => {
    const owner = req.auth!.owner;
    const grants = (await storage.listAppGrantsByOwner(owner)).filter(g => !g.revoked);
    res.json(success(config.nodeId, {
      grants: grants.map(g => ({
        grant_id: g.grantId, app: g.app, app_name: g.appName, app_origin: g.appOrigin,
        scopes: g.scopes, granted_at: g.createdAt, last_used_at: g.lastUsedAt,
        // Only meaningful for an app that may spend at all; the UI hides the control otherwise.
        can_spend: (g.scopes ?? []).includes('contract:spend'),
        spend_cap_morsels: g.spendCapMorsels ?? null,
        spent_morsels: g.spentMorsels ?? 0,
        scopes_fixed_at: g.scopesFixedAt ?? null,
      })),
      total: grants.length,
    }));
  });

  /**
   * PATCH /v1/app-grants/:grantId — keep only some of the rights this app holds.
   *
   * Body: `{ scopes: string[] }`, every one of them a scope the grant already carries. A word the
   * grant does not hold is refused (SCOPES_WIDEN), an empty list is refused (that is what DELETE is
   * for), and the grant is stamped as fixed by its owner. The access token the app already holds
   * keeps its claims until it expires (config.accessTtlSeconds); the next refresh mints from the
   * narrowed grant, and the response says how long that can take.
   */
  router.patch('/v1/app-grants/:grantId', requireAuth(), requireRole('owner'), async (req: Request, res: Response) => {
    const owner = req.auth!.owner;
    const grant = await storage.getAppGrant(req.params.grantId as string);
    if (!grant || grant.owner !== owner || grant.revoked) {
      return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Grant not found'));
    }
    const wanted = (req.body ?? {}).scopes;
    if (!Array.isArray(wanted) || wanted.some((s: unknown) => typeof s !== 'string')) {
      return res.status(400).json(error(config.nodeId, 'BAD_REQUEST', 'scopes must be a list of the scope words to keep'));
    }
    const keep = [...new Set(wanted as string[])];
    if (keep.length === 0) {
      return res.status(400).json(error(config.nodeId, 'BAD_REQUEST', 'Keep at least one scope, or revoke the grant with DELETE'));
    }
    const held = grant.scopes ?? [];
    const widen = keep.filter(s => !held.includes(s));
    if (widen.length) {
      return res.status(400).json(error(config.nodeId, 'SCOPES_WIDEN', `A grant can only be narrowed here; the app has to ask for [${widen.join(', ')}] on its own consent screen`));
    }
    const removed = held.filter(s => !keep.includes(s));
    const updated = await storage.updateAppGrant(grant.grantId, { scopes: keep, scopesFixedAt: new Date().toISOString() });
    return res.json(success(config.nodeId, {
      grant_id: grant.grantId, app: grant.app,
      scopes: updated?.scopes ?? keep,
      removed,
      scopes_fixed_at: updated?.scopesFixedAt ?? null,
      applies_within_seconds: config.accessTtlSeconds,
    }));
  });

  /**
   * PATCH /v1/app-grants/:grantId/spend-cap — how much of your money this app may spend.
   *
   * The `contract:spend` scope answers whether an app may buy on your behalf. This answers how much,
   * which is the answer most people actually want: a yes with no number is a blank cheque. Body:
   * `{ cap_morsels: number | null }` — null clears the ceiling, 0 stops it without revoking anything
   * else it was trusted with. `{ reset: true }` puts the counter back to zero (a new month, say).
   */
  router.patch('/v1/app-grants/:grantId/spend-cap', requireAuth(), requireRole('owner'), async (req: Request, res: Response) => {
    const owner = req.auth!.owner;
    const grant = await storage.getAppGrant(req.params.grantId as string);
    if (!grant || grant.owner !== owner) {
      return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Grant not found'));
    }
    const b = (req.body ?? {}) as Record<string, unknown>;
    const raw = b.cap_morsels;
    if (raw !== undefined && raw !== null && !(typeof raw === 'number' && Number.isInteger(raw) && raw >= 0)) {
      return res.status(400).json(error(config.nodeId, 'BAD_REQUEST', 'cap_morsels must be a whole number of morsels, or null to remove the ceiling'));
    }
    const updates: Parameters<typeof storage.updateAppGrant>[1] = {};
    if (raw !== undefined) updates.spendCapMorsels = raw === null ? null : (raw as number);
    if (b.reset === true) updates.spentMorsels = 0;
    if (!Object.keys(updates).length) {
      return res.status(400).json(error(config.nodeId, 'BAD_REQUEST', 'Nothing to change — pass cap_morsels and/or reset'));
    }
    const updated = await storage.updateAppGrant(grant.grantId, updates);
    return res.json(success(config.nodeId, {
      grant_id: grant.grantId, app: grant.app,
      cap_morsels: updated?.spendCapMorsels ?? null,
      spent_morsels: updated?.spentMorsels ?? 0,
      can_spend: (updated?.scopes ?? []).includes('contract:spend'),
    }));
  });

  // ── DELETE /v1/app-grants/:grantId ── the owner revokes an app's access.
  router.delete('/v1/app-grants/:grantId', requireAuth(), requireRole('owner'), async (req: Request, res: Response) => {
    const owner = req.auth!.owner;
    const grant = await storage.getAppGrant(req.params.grantId as string);
    if (!grant || grant.owner !== owner) {
      return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Grant not found'));
    }
    await storage.updateAppGrant(grant.grantId, { revoked: true, refreshTokenHash: null });
    res.json(success(config.nodeId, { revoked: true, grant_id: grant.grantId }));
  });

  return router;
}
