/**
 * @file public-events.ts
 * @description Public, unauthenticated landing-feed transport. Two endpoints:
 *   GET /v1/public/activity-feed?category=apps|organisms|agents&limit= — initial
 *   load of recent public activity (cached + rate-limited, like public-stats.ts);
 *   GET /v1/public/events — a PUBLIC Server-Sent Events stream (no auth, no ticket)
 *   that pushes each public activity event live as a full JSON payload. Both serve
 *   ONLY events recorded by services/public-activity.ts, which already enforces the
 *   public-only privacy contract. Modeled on routes/sse.ts (keepalive, flush,
 *   cleanup) but ticket-free and broadcasting the full payload (not a marker).
 * @structure publicEventsRouter(config, storage) -> Router
 * @usage app.use(publicEventsRouter(config, storage)); client: EventSource('/v1/public/events')
 * @version-history
 *   v1.0.0 — 2026-06-16 — Initial: public landing activity feed + SSE.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { onPublicActivityEvent, offPublicActivityEvent } from '../services/event-bus.js';
import type { PublicActivityEvent } from '../services/event-bus.js';
import { readPublicActivity } from '../services/public-activity.js';
import type { PublicActivityCategory } from '../services/public-activity.js';

const VALID_CATEGORIES = new Set<PublicActivityCategory>(['apps', 'organisms', 'agents']);
const MAX_SSE_CONNECTIONS = 200; // cap concurrent public streams

interface CacheSlot { at: number; value: unknown | null; }

export function publicEventsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  // One small cache slot per category (+ 'all'); 10s like the existing ticker.
  const feedCache = new Map<string, CacheSlot>();
  let openConnections = 0;

  // GET /v1/public/activity-feed — initial load for the landing feed.
  router.get('/v1/public/activity-feed', rateLimit({ windowMs: 60_000, max: 120 }), async (req, res) => {
    const rawCat = typeof req.query.category === 'string' ? req.query.category : '';
    const category = VALID_CATEGORIES.has(rawCat as PublicActivityCategory)
      ? (rawCat as PublicActivityCategory)
      : undefined;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

    const cacheKey = `${category ?? 'all'}:${limit}`;
    const slot = feedCache.get(cacheKey);
    if (slot && Date.now() - slot.at < 10_000 && slot.value) {
      res.json(success(config.nodeId, slot.value));
      return;
    }

    let items: PublicActivityEvent[] = [];
    try {
      items = await readPublicActivity(storage, config, { category, limit });
    } catch { /* fall through to empty — frontend has an empty-state */ }

    const payload = { items };
    feedCache.set(cacheKey, { at: Date.now(), value: payload });
    res.json(success(config.nodeId, payload));
  });

  // GET /v1/public/events — public SSE stream of full activity events.
  router.get('/v1/public/events', rateLimit({ windowMs: 60_000, max: 60 }), (req, res) => {
    if (openConnections >= MAX_SSE_CONNECTIONS) {
      res.status(503).json(error(config.nodeId, 'TOO_MANY_STREAMS', 'Too many open activity streams; retry shortly'));
      return;
    }
    openConnections++;

    // Setting text/event-stream excludes this response from the compression
    // middleware (server.ts filters on that header), which would otherwise buffer it.
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const flush = () => { (res as unknown as { flush?: () => void }).flush?.(); };

    // Initial comment so proxies open the stream immediately.
    res.write(':ok\n\n');
    flush();

    const keepalive = setInterval(() => {
      res.write(':keepalive\n\n');
      flush();
    }, 30_000);

    // Push each public event as a full JSON payload. Unlike the UI `change` stream,
    // there is no coalescing — every public event is distinct and individually useful.
    const handler = (evt: PublicActivityEvent): void => {
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
      flush();
    };
    onPublicActivityEvent(handler);

    req.on('close', () => {
      clearInterval(keepalive);
      offPublicActivityEvent(handler);
      openConnections = Math.max(0, openConnections - 1);
    });
  });

  return router;
}
