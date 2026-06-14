/**
 * @file ecosystem-events.ts
 * @description The GEAI (ecosystem app) event plane HTTP surface: the INBOUND event ingress a GEAI
 *   posts to (over its tunnel or directly), and the owner-facing OUTBOUND subscription CRUD. Inbound
 *   events are authenticated as the emitting GEAI (the app + geai come from the token, never the body,
 *   so an app can't spoof another's events), audit-logged, and replayed into the workflow engine's
 *   `ecosystem.event` trigger. Additive — no agent/owner path is touched.
 * @structure
 *   - POST /v1/ecosystem/events            — GEAI emits an inbound event (role ecosystem, scope events:emit)
 *   - GET  /v1/ecosystem/subscriptions     — owner lists outbound subscriptions
 *   - POST /v1/ecosystem/subscriptions     — owner subscribes a GEAI to an outbound event
 *   - DELETE /v1/ecosystem/subscriptions   — owner removes a subscription (?app=&event=)
 * @usage app.use(ecosystemEventsRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-06-14 — Created for ecosystem events & triggers (chunk 2).
 */
import { Router } from 'express';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { parseGEAI, buildGEAI } from '../utils/gaii.js';
import { getActiveWorkflowEngine } from '../services/workflow/engine.js';
import { getActiveConnectTunnelManager } from '../services/connect-tunnel.js';
import { getOwnerScopeMemory } from '../services/owner-memory.js';
import { ECOSYSTEM_EVENT_VERSION } from '../models/ecosystem-event-schemas.js';
import {
  listSubscriptions, addSubscription, removeSubscriptions, appendInboundEcosystemLog,
  type EcosystemSubscription,
} from '../services/ecosystem-events.js';
import { logger } from '../utils/logger.js';

const InboundEventBody = z.object({
  event: z.string().min(1).max(120),
  version: z.number().int().min(1).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

const SubscriptionBody = z.object({
  app: z.string().min(1).max(100),
  event: z.string().min(1).max(120),               // outbound event name, or '*'
  match: z.record(z.string().max(120), z.string().max(400)).optional(),
  transport: z.array(z.enum(['tunnel', 'webhook'])).min(1).optional(),
});

export function ecosystemEventsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // ── POST /v1/ecosystem/events — a GEAI emits an inbound event ──
  router.post('/v1/ecosystem/events', requireAuth(), requireRole('ecosystem'), requireScope('events:emit'), async (req, res) => {
    const parsed = InboundEventBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', parsed.error.issues.map(i => i.message).join('; ')));
      return;
    }
    const geai = req.auth!.sub;                                  // authoritative — pinned at tunnel upgrade
    const app = req.auth!.eco_app ?? parseGEAI(geai)?.app;       // the bound app name from the token
    if (!app) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Could not resolve the emitting app from the GEAI'));
      return;
    }
    const event = parsed.data.event;
    const version = parsed.data.version ?? ECOSYSTEM_EVENT_VERSION;
    const data = parsed.data.data ?? {};
    const ownerGhii = `${req.auth!.owner}@${config.nodeId}`;

    // Audit log (per-GEAI, capped) then fuel the workflow engine's ecosystem.event triggers.
    await appendInboundEcosystemLog(storage, geai, { event, version, timestamp: new Date().toISOString(), data });
    getActiveWorkflowEngine()?.onEcosystemEvent(app, event, version, ownerGhii, data)
      .catch(e => logger.error('ecosystem.event trigger dispatch failed', { app, event, error: String(e) }));

    res.json(success(config.nodeId, { accepted: true, app, event, version }));
  });

  // ── GET /v1/ecosystem/subscriptions — owner lists outbound subscriptions ──
  router.get('/v1/ecosystem/subscriptions', requireAuth(), requireRole('owner'), async (req, res) => {
    const ownerGhii = `${req.auth!.owner}@${config.nodeId}`;
    const appFilter = req.query.app as string | undefined;
    let geai: string | undefined;
    if (appFilter) {
      const rec = await storage.getEcosystemAppByOwnerAndApp(req.auth!.owner, appFilter);
      geai = rec?.geai ?? '__none__';
    }
    const subs = await listSubscriptions(storage, config.nodeId, ownerGhii, geai);
    res.json(success(config.nodeId, { subscriptions: subs }));
  });

  // ── POST /v1/ecosystem/subscriptions — owner subscribes a GEAI to an outbound event ──
  router.post('/v1/ecosystem/subscriptions', requireAuth(), requireRole('owner'), async (req, res) => {
    const parsed = SubscriptionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', parsed.error.issues.map(i => i.message).join('; ')));
      return;
    }
    const { app, event, match, transport } = parsed.data;
    const rec = await storage.getEcosystemAppByOwnerAndApp(req.auth!.owner, app);
    if (!rec) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Ecosystem app "${app}" not found under owner "${req.auth!.owner}"`));
      return;
    }
    const ownerGhii = `${req.auth!.owner}@${config.nodeId}`;
    const sub: Omit<EcosystemSubscription, 'createdAt'> = {
      geai: rec.geai, ownerGhii, event, match,
      transport: transport ?? ['tunnel', 'webhook'],
    };
    const stored = await addSubscription(storage, config.nodeId, sub);
    res.json(success(config.nodeId, { subscription: stored }));
  });

  // ── POST /v1/ecosystem/read-through — fetch live content behind an ecosystem_ref ──
  // AIMEAT stores only a reference (pointer + schema + cached metadata), never the live content. This
  // reads through to the ecosystem app over the tunnel on demand and returns the result WITHOUT
  // persisting it. If the GEAI is offline, returns the cached metadata + a read_through_unavailable flag.
  router.post('/v1/ecosystem/read-through', requireAuth(), requireRole('owner'), async (req, res) => {
    const key = (req.body?.key as string | undefined);
    if (!key) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'key is required'));
      return;
    }
    const rec = await getOwnerScopeMemory(storage, config.nodeId, req.auth!.owner, key);
    const ref = rec?.value as { _type?: string; app?: string; remoteId?: string; readCapability?: string; schema?: unknown; title?: string; updatedAt?: string } | undefined;
    if (!ref || ref._type !== 'ecosystem_ref' || !ref.app) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No ecosystem_ref found at that key'));
      return;
    }
    const cached = { app: ref.app, remoteId: ref.remoteId, schema: ref.schema, title: ref.title, updatedAt: ref.updatedAt };
    const geai = buildGEAI(ref.app, req.auth!.owner, config.nodeId);
    const ownerGhii = `${req.auth!.owner}@${config.nodeId}`;
    const mgr = getActiveConnectTunnelManager();
    if (!mgr) {
      res.json(success(config.nodeId, { read_through_unavailable: true, reason: 'tunnel_unavailable', cached }));
      return;
    }
    try {
      const reply = await mgr.invokeOnPrincipal(geai, {
        capability: ref.readCapability ?? '__read__',
        input: { remoteId: ref.remoteId },
        caller: ownerGhii,
      });
      if (!reply.ok) {
        res.json(success(config.nodeId, { read_through_unavailable: true, reason: 'ecosystem_refused', cached }));
        return;
      }
      res.json(success(config.nodeId, { content: reply.result, schema: ref.schema, cached }));
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? 'ECOSYSTEM_OFFLINE';
      res.json(success(config.nodeId, { read_through_unavailable: true, reason: code, cached }));
    }
  });

  // ── DELETE /v1/ecosystem/subscriptions?app=&event= — owner removes subscription(s) ──
  router.delete('/v1/ecosystem/subscriptions', requireAuth(), requireRole('owner'), async (req, res) => {
    const app = req.query.app as string | undefined;
    const event = req.query.event as string | undefined;
    if (!app) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'app query parameter is required'));
      return;
    }
    const rec = await storage.getEcosystemAppByOwnerAndApp(req.auth!.owner, app);
    if (!rec) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Ecosystem app "${app}" not found under owner "${req.auth!.owner}"`));
      return;
    }
    const ownerGhii = `${req.auth!.owner}@${config.nodeId}`;
    const removed = await removeSubscriptions(storage, config.nodeId, ownerGhii, rec.geai, event);
    res.json(success(config.nodeId, { removed }));
  });

  return router;
}
