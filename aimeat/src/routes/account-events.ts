/**
 * @file src/routes/account-events.ts
 * @description The account's own record of what happened: read it, and — for an app acting under a
 *   grant — add to it. Design: docs/internal/telemetria/04-account-events.md
 *
 *   AN APP MAY ONLY WRITE ITS OWN KINDS. Every kind an app records is namespaced
 *   `app:{appId}:{kind}` by the SERVER, from the grant, never from the body. That is what makes the
 *   namespace a guarantee rather than a convention: an app cannot claim `payment_received`, cannot
 *   write in another app's name, and cannot collide with the node's own vocabulary however it
 *   spells its own.
 *
 *   AND ONLY ONTO ITS OWN OWNER'S RECORD. The owner comes from the resolved identity, so there is no
 *   shape of this request that writes onto somebody else's feed.
 *
 *   The archive is a separate route rather than a flag, because it answers a different question and
 *   has a different cost. A person asking "what happened lately" should never accidentally page
 *   through a year.
 *
 *   UNDER /v1/account, NOT /v1/events. `GET /v1/events` was already the SSE stream, mounted first,
 *   so the read here answered with its "ticket query parameter required" and nothing said why.
 *   These three are about ONE account's record, and the prefix says so.
 * @structure
 *   - POST /v1/account/events          -- an app records one of its own
 *   - GET  /v1/account/events          -- the window, newest first
 *   - GET  /v1/account/events/archive  -- everything that fell out of it
 * @usage
 *   import { accountEventsRouter } from './routes/account-events.js';
 *   app.use(accountEventsRouter(config, storage));
 * @version-history
 *   v1.1.0 — 2026-08-17 — Moved to /v1/account/events. /v1/events belongs to the SSE stream and
 *     matched first, so the window read returned MISSING_TICKET on every call.
 *   v1.0.0 — 2026-08-17 — Initial: the app-facing write door and the two reads.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, AccountEventKind } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity, ownerGhiiOf } from '../utils/gaii.js';
import {
  recordAccountEvent, readAccountEvents, readAccountEventArchive, windowSize,
} from '../services/account-events.js';

/** A kind an app may spell: lower-case, short, no separators that would break the namespace. */
const APP_KIND = /^[a-z][a-z0-9_]{1,39}$/;

/** What a row may carry. Enough to render and link; not a place to park a payload. */
const MAX_DATA_KEYS = 12;
const MAX_VALUE_CHARS = 200;

/**
 * Reduce a caller's `data` to what a feed row can use: short string values, few of them.
 *
 * The store takes open JSON on purpose, so a kind added next year needs no migration. That freedom
 * is for the SHAPE of a row, not for its size — anything bigger than a label belongs behind the
 * link, and a feed that carries payloads becomes a database nobody indexed.
 */
function safeData(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_DATA_KEYS) break;
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(k)) continue;
    if (v === null || v === undefined) continue;
    const s = typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
    if (!s) continue;
    out[k] = s.slice(0, MAX_VALUE_CHARS);
  }
  return out;
}

/** A link is followed by a person, so it stays on this node. */
function safeLink(raw: unknown): string {
  return typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') ? raw.slice(0, 300) : '';
}

export function accountEventsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /**
   * POST /v1/account/events — an app adds one of its own events to its owner's record.
   *
   * `memory:write` gates it: an app holding that word can already write into the owner's memory, and
   * recording one line of its own history is strictly less than that. No new vocabulary for a
   * capability that is narrower than one the owner already grants.
   */
  router.post('/v1/account/events', requireAuth(), requireScope('memory:write'), async (req: Request, res: Response) => {
    const identity = resolveIdentity(req.auth!, config.nodeId);
    const ownerGhii = ownerGhiiOf(identity);

    const rawKind = typeof req.body?.kind === 'string' ? req.body.kind.trim() : '';
    if (!APP_KIND.test(rawKind)) {
      return res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        'kind must be 2-40 characters of a-z, 0-9 and _ — it is a key the interface translates, not a sentence.'));
    }

    // The app id comes from the GRANT, never from the body. An app that could name itself could
    // name another, and the namespace would stop being a guarantee.
    const appId = typeof req.auth!.app === 'string' && req.auth!.app ? req.auth!.app : '';
    if (!appId) {
      return res.status(403).json(error(config.nodeId, 'APP_ONLY',
        'This door is for an app acting under a grant. A person or an agent records events by doing the thing that is worth recording.'));
    }

    const kind = `app:${appId}:${rawKind}` as AccountEventKind;
    await recordAccountEvent(storage, {
      ownerGhii,
      kind,
      actorGaii: identity,
      subject: typeof req.body?.subject === 'string' ? req.body.subject.slice(0, 200) : '',
      link: safeLink(req.body?.link),
      data: safeData(req.body?.data),
    }, config);

    res.status(201).json(success(config.nodeId, { recorded: true, kind }));
  });

  /** GET /v1/account/events — the window. Same gate as the home feed: this is the same record. */
  router.get('/v1/account/events', requireAuth(), requireScope('memory:read'), async (req: Request, res: Response) => {
    const ownerGhii = ownerGhiiOf(resolveIdentity(req.auth!, config.nodeId));
    const limit = Number(req.query.limit);
    const events = await readAccountEvents(storage, ownerGhii, {
      limit: Number.isFinite(limit) ? limit : undefined,
    }, config);
    res.json(success(config.nodeId, {
      events,
      count: events.length,
      window: windowSize(config),
    }, [
      { description: 'Everything older than the window', method: 'GET', url: '/v1/account/events/archive' },
    ]));
  });

  /**
   * GET /v1/account/events/archive — everything that fell out of the window.
   *
   * Its own route rather than a flag on the read above: it answers a different question and costs
   * more, and someone asking what happened lately should never page through a year by accident.
   */
  router.get('/v1/account/events/archive', requireAuth(), requireScope('memory:read'), async (req: Request, res: Response) => {
    const ownerGhii = ownerGhiiOf(resolveIdentity(req.auth!, config.nodeId));
    const limit = Number(req.query.limit);
    const offset = Number(req.query.offset);
    const [events, total] = await Promise.all([
      readAccountEventArchive(storage, ownerGhii, {
        limit: Number.isFinite(limit) ? limit : 50,
        offset: Number.isFinite(offset) ? offset : 0,
        from: typeof req.query.from === 'string' ? req.query.from : undefined,
        to: typeof req.query.to === 'string' ? req.query.to : undefined,
      }),
      storage.countAccountEventArchive(ownerGhii),
    ]);
    res.json(success(config.nodeId, { events, count: events.length, total }));
  });

  return router;
}
