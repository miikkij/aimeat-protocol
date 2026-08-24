/**
 * @file src/routes/signals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The signals door: define what is measured (owner side, scoped), and count a hit
 *   (public, unauthenticated, capped). Generic on purpose — an email open, a click, a page fetch, a
 *   QR scan and an app's own event all arrive here, so one report can hold them side by side.
 *
 *   TWO PUBLIC DOORS, AND WHY EACH EXISTS. The tracking image answers a GET with an SVG, because
 *   that is the only thing a mail client will fetch: it runs no scripts and posts nothing. The JSON
 *   hit answers everything else — a click-through page, an app event, a QR landing — where a script
 *   IS running and a body can be sent. Neither reads anything back: a stranger holding the address
 *   can add to a count and learn nothing, which is the whole security posture of this file.
 *
 *   THE OWNER IS IN THE PATH, deliberately. A hit is a direct key lookup that way
 *   (`getMemory(owner, signals.stream.<id>)`), with no index and no scan over every stream on the
 *   node. The alternative, an opaque token, would need a global lookup table and would hide a name
 *   the recipient already knows: they are reading an email this person sent them.
 *
 *   NO REDIRECT LIVES HERE. Handing this route a destination URL would make the node an open
 *   redirect for anyone's phishing link, so the click-through page belongs to the app that owns the
 *   campaign and reads its own saved link map. The node counts; it does not forward.
 *
 * @structure PIXEL_SVG · signalsRouter (streams CRUD · report · public pixel · public hit)
 * @usage app.use(signalsRouter(config, storage)) in routes-loader
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial: generic hit collection.
 */
import { Router, type Response } from 'express';
import { z } from 'zod';
import type { AimeatConfig } from '../config-types.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { emitChange } from '../services/event-bus.js';
import { resolveIdentity } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';
import {
  SignalError, saveStream, listStreams, deleteStream, recordHit, readReport,
} from '../services/signals/signal-service.js';
import { SIGNAL_CHANNELS, SIGNAL_EVENTS } from '../models/signal-schemas.js';

/**
 * A 1x1 fully transparent SVG. SVG rather than a GIF because it is text, so it is readable in the
 * source of any email it is embedded in: a person who wonders what this image is can see that it
 * carries no content.
 */
const PIXEL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill-opacity="0"/></svg>';

const StreamSchema = z.object({
  stream_id: z.string().min(2).max(64),
  label: z.string().max(200).optional(),
  channel: z.enum(SIGNAL_CHANNELS).optional(),
  per_subject: z.boolean().optional(),
  group: z.string().max(80).nullish(),
  enabled: z.boolean().optional(),
}).strict();

const HitSchema = z.object({
  event: z.enum(SIGNAL_EVENTS).optional(),
  channel: z.enum(SIGNAL_CHANNELS).optional(),
  subject: z.string().max(64).nullish(),
  ref: z.string().max(64).nullish(),
}).strict();

function sendErr(res: Response, config: AimeatConfig, e: unknown): boolean {
  if (e instanceof SignalError) {
    res.status(e.statusCode).json(error(config.nodeId, e.code, e.message));
    return true;
  }
  return false;
}

/** Serve the tracking image. Always 200, always uncached, whatever the counting did. */
function sendPixel(res: Response): void {
  res.setHeader('Content-Type', 'image/svg+xml');
  // Without these a proxy caches the image and the second open never reaches the node at all.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // The image is embedded in mail clients and pages everywhere; it must never become a frame.
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  res.status(200).send(PIXEL_SVG);
}

export function signalsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const owned = (req: { auth?: unknown }): string => resolveIdentity((req as { auth: Parameters<typeof resolveIdentity>[0] }).auth, config.nodeId);
  const ownerFromName = (name: string): string => `${name}@${config.nodeId}`;

  // ── Owner side: what is measured ────────────────────────────────────────────────────────────

  router.post('/v1/signals/streams', requireAuth(), requireScope('signals:write'), async (req, res) => {
    const parsed = StreamSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', parsed.error.message));
      return;
    }
    try {
      const cfg = await saveStream(storage, owned(req), {
        streamId: parsed.data.stream_id,
        label: parsed.data.label,
        channel: parsed.data.channel,
        perSubject: parsed.data.per_subject,
        group: parsed.data.group ?? null,
        enabled: parsed.data.enabled,
      });
      const owner = (req.auth!.owner as string);
      emitChange('signals', owned(req));
      res.json(success(config.nodeId, {
        stream: cfg,
        pixel_url: `/v1/signals/${owner}/${cfg.streamId}/px.svg`,
        hit_url: `/v1/signals/${owner}/${cfg.streamId}/hit`,
      }, [{ description: 'Read what this stream collected', method: 'GET', url: `/v1/signals/streams/${cfg.streamId}/report` }]));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  router.get('/v1/signals/streams', requireAuth(), requireScope('signals:read'), async (req, res) => {
    const owner = (req.auth!.owner as string);
    const streams = await listStreams(storage, owned(req));
    res.json(success(config.nodeId, {
      streams: streams.map((s) => ({
        ...s,
        pixel_url: `/v1/signals/${owner}/${s.streamId}/px.svg`,
        hit_url: `/v1/signals/${owner}/${s.streamId}/hit`,
      })),
    }));
  });

  router.delete('/v1/signals/streams/:streamId', requireAuth(), requireScope('signals:write'), async (req, res) => {
    const out = await deleteStream(storage, owned(req), req.params.streamId as string);
    emitChange('signals', owned(req));
    res.json(success(config.nodeId, out));
  });

  router.get('/v1/signals/streams/:streamId/report', requireAuth(), requireScope('signals:read'), async (req, res) => {
    try {
      const report = await readReport(storage, owned(req), req.params.streamId as string, {
        from: typeof req.query.from === 'string' ? req.query.from : undefined,
        to: typeof req.query.to === 'string' ? req.query.to : undefined,
        includeSubjects: req.query.subjects === 'true',
      });
      res.json(success(config.nodeId, report));
    } catch (e) {
      if (!sendErr(res, config, e)) throw e;
    }
  });

  // ── Public side: counting ───────────────────────────────────────────────────────────────────

  /* GET /v1/signals/:owner/:streamId/px.svg — the tracking image. PUBLIC, no auth.
   * Answers the image whatever happens: an unknown stream, a disabled one and a flood past the cap
   * all get the same 200 and the same bytes, so the address discloses nothing about what exists. */
  router.get('/v1/signals/:owner/:streamId/px.svg',
    rateLimit({ windowMs: 60_000, max: 120, keyBy: 'ip' }),
    async (req, res) => {
      try {
        await recordHit(storage, {
          ownerGhii: ownerFromName(req.params.owner as string),
          streamId: req.params.streamId as string,
          event: typeof req.query.e === 'string' ? req.query.e : 'open',
          channel: typeof req.query.c === 'string' ? req.query.c : undefined,
          subject: typeof req.query.s === 'string' ? req.query.s : null,
          ref: typeof req.query.r === 'string' ? req.query.r : null,
          userAgent: req.get('user-agent'),
        });
      } catch (e) {
        // A counter must never cost the reader their image, so this is swallowed on purpose —
        // but never silently: a collector that has started failing has to be visible somewhere.
        logger.warn('signals: the tracking image could not be counted', {
          streamId: String(req.params.streamId), error: String(e),
        });
      }
      sendPixel(res);
    });

  /* POST /v1/signals/:owner/:streamId/hit — everything a script can send. PUBLIC, no auth.
   * The click-through page, an app event, a QR landing. Answers 200 with what was counted, and
   * never says whether the stream exists: `counted:false` covers unknown, off and over-cap alike. */
  router.post('/v1/signals/:owner/:streamId/hit',
    rateLimit({ windowMs: 60_000, max: 120, keyBy: 'ip' }),
    async (req, res) => {
      const parsed = HitSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', parsed.error.message));
        return;
      }
      let counted: boolean;
      try {
        const out = await recordHit(storage, {
          ownerGhii: ownerFromName(req.params.owner as string),
          streamId: req.params.streamId as string,
          event: parsed.data.event ?? 'click',
          channel: parsed.data.channel,
          subject: parsed.data.subject ?? null,
          ref: parsed.data.ref ?? null,
          userAgent: req.get('user-agent'),
        });
        counted = out.counted;
      } catch (e) {
        // Same reasoning as the image: the visitor's page must not break because a count failed.
        logger.warn('signals: a hit could not be counted', {
          streamId: String(req.params.streamId), error: String(e),
        });
        counted = false;
      }
      res.json(success(config.nodeId, { counted }));
    });

  return router;
}
