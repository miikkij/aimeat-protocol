/**
 * @file presence.ts
 * @description Generic presence/availability API. Lets an owner read & set their
 *   own presence config (manual/auto status + who-can-see visibility) and lets any
 *   authenticated viewer read the viewer-scoped status of one or many identities.
 *   All status reads resolve LOCALLY through the PresenceTracker (local owners are
 *   computed live; remote owners come from the federated cache) — never a
 *   cross-node fetch. Visibility (`everyone`/`contacts`/`nobody`) is enforced here
 *   via the tracker.
 * @structure presenceRouter(config, storage) -> Router
 *   - GET  /v1/presence/me        — own config + computed status
 *   - PUT  /v1/presence/me        — update own config
 *   - GET  /v1/presence?ids=a,b   — batch viewer-scoped status
 *   - GET  /v1/presence/:ghii     — single viewer-scoped status
 * @usage app.use(presenceRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-06-19 — Initial presence API (own config + viewer-scoped reads).
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import {
  presence,
  type PresenceConfig,
  type PresenceMode,
  type ManualStatus,
  type Visibility,
} from '../services/presence.js';

const MODES = new Set<PresenceMode>(['auto', 'manual']);
const MANUAL_STATUSES = new Set<ManualStatus>(['available', 'busy', 'away', 'invisible']);
const VISIBILITIES = new Set<Visibility>(['everyone', 'contacts', 'nobody']);

const MAX_BATCH = 200;

export function presenceRouter(config: AimeatConfig, _storage: Storage): Router {
  const router = Router();

  // GET /v1/presence/me — own config + own computed status (visibility never hides it from self)
  router.get('/v1/presence/me', requireAuth(), async (req, res) => {
    const me = resolveIdentity(req.auth!, config.nodeId);
    const [cfg, status] = await Promise.all([presence.getConfig(me), presence.getOwnStatus(me)]);
    res.json(success(config.nodeId, { ghii: me, config: cfg, status: status.status, since: status.since }, [
      { description: 'Update your presence', method: 'PUT', url: '/v1/presence/me' },
    ]));
  });

  // PUT /v1/presence/me — update own config (partial: mode / status / visibility)
  router.put('/v1/presence/me', requireAuth(), async (req, res) => {
    const me = resolveIdentity(req.auth!, config.nodeId);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const partial: Partial<PresenceConfig> = {};

    if (body.mode !== undefined) {
      if (!MODES.has(body.mode as PresenceMode)) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'mode must be "auto" or "manual"'));
        return;
      }
      partial.mode = body.mode as PresenceMode;
    }
    if (body.status !== undefined) {
      if (!MANUAL_STATUSES.has(body.status as ManualStatus)) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'status must be one of: available, busy, away, invisible'));
        return;
      }
      partial.status = body.status as ManualStatus;
    }
    if (body.visibility !== undefined) {
      if (!VISIBILITIES.has(body.visibility as Visibility)) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'visibility must be one of: everyone, contacts, nobody'));
        return;
      }
      partial.visibility = body.visibility as Visibility;
    }

    const cfg = await presence.setConfig(me, partial);
    const status = await presence.getOwnStatus(me);
    res.json(success(config.nodeId, { ghii: me, config: cfg, status: status.status, since: status.since }));
  });

  // GET /v1/presence?ids=a,b,c — batch viewer-scoped status
  router.get('/v1/presence', requireAuth(), async (req, res) => {
    const viewer = resolveIdentity(req.auth!, config.nodeId);
    const raw = (req.query.ids as string | undefined) ?? '';
    const ids = raw.split(',').map(s => s.trim()).filter(Boolean).slice(0, MAX_BATCH);
    const views = await presence.getVisibleMany(viewer, ids);
    const map: Record<string, { status: string; since: string | null }> = {};
    for (const v of views) map[v.ghii] = { status: v.status, since: v.since };
    res.json(success(config.nodeId, { presence: map }));
  });

  // GET /v1/presence/:ghii — single viewer-scoped status
  router.get('/v1/presence/:ghii', requireAuth(), async (req, res) => {
    const viewer = resolveIdentity(req.auth!, config.nodeId);
    const target = decodeURIComponent(req.params.ghii as string);
    const view = await presence.getVisible(viewer, target);
    res.json(success(config.nodeId, { ghii: view.ghii, status: view.status, since: view.since }));
  });

  return router;
}
