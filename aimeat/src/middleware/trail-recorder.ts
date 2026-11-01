/**
 * @file src/middleware/trail-recorder.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Writes every authenticated REST change to the usage stream as surface `http`, so the
 *   place's trail (services/place-trail.ts) lists what was done through REST as it lists every MCP
 *   tool call (mcp/tool-usage-wrap.ts). One line per request that changed something: POST, PUT, PATCH
 *   or DELETE on a matched /v1 route, by a signed-in caller.
 *
 *   WHY HERE. A route is the one place every REST change passes, and the matched route's template
 *   (`PUT /v1/memory/:key`) is known only once the router has run, so the line is written when the
 *   response finishes, as middleware/refusal-recorder.ts writes its refusals.
 *
 *   WHAT IS NOT WRITTEN. MCP, which records each tool call itself; an anonymous request; the
 *   high-frequency bookkeeping a page or an agent sends while it runs (telemetry, heartbeats,
 *   presence, read marks); a request a route already recorded (`res.locals.trailRecorded`, set by
 *   recordTrailEvent's callers). A path value whose name says it is a credential is left out of the
 *   target, so a token in a path never reaches the trail.
 * @structure trailRecorder()
 * @usage app.use(optionalAuth()); app.use(trailRecorder(config, () => storage));   // server.ts
 * @version-history
 *   v1.1.0 — 2026-11-02 — A request with no path target takes a string `key` from its body as the target
 *     (POST /v1/memory), so the home's trail can file its own bookkeeping keys as routine (aimeat-protocol-bb).
 *   v1.0.0 — 2026-11-01 — Initial ("Rakennamme kanssasi", part C; Jouni, 1.11 16.22).
 */
import type { Request, Response, NextFunction } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, UsageActorKind } from '../storage/interface.js';
import { recordUsageCall } from '../services/usage/usage-buffer.js';
import { callerOf } from './caller.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import type { CallerKind } from '../services/caller-context.js';

const CHANGES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** Bookkeeping a running page or agent sends, not an action a person would look for in the trail. */
const NOT_ACTIONS = /\/(telemetry|heartbeat|presence|mcp)(\/|$)|^\/v1\/notifications\/read$|^\/v1\/sse(\/|$)/;
/** A path value with one of these names is a credential, never a target. */
const SECRET_PARAM = /token|secret|password|code|signature/i;
const MAX_TARGET = 200;

/** The usage stream's word for each kind of caller (services/caller-context.ts). */
const USAGE_KIND: Record<CallerKind, UsageActorKind | null> = {
  owner: 'owner', agent: 'agent', app: 'app', ecosystem: 'eco', visitor: 'owner', anonymous: null,
};

function targetOf(req: Request): string {
  const params = (req.params ?? {}) as Record<string, string | string[]>;
  const parts = Object.entries(params)
    .filter(([name]) => !SECRET_PARAM.test(name))
    .map(([, v]) => (Array.isArray(v) ? v.join('/') : String(v)));
  if (parts.length) return parts.join('/').slice(0, MAX_TARGET);
  // A write that names its record in the body (POST /v1/memory { key }): the key is the target, so a
  // reader of the trail can tell a page's own bookkeeping (home.visits) from what the person saved.
  const key = (req.body as { key?: unknown } | undefined)?.key;
  return typeof key === 'string' ? key.slice(0, MAX_TARGET) : '';
}

export function trailRecorder(config: AimeatConfig, storage: () => Storage | null) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!CHANGES.has(req.method) || !req.path.startsWith('/v1/')) { next(); return; }
    const startedAt = Date.now();
    res.on('finish', () => {
      const store = storage();
      if (!store || !req.auth || req.auth.anonymous || res.locals.trailRecorded) return;
      // The matched route's template; a request no route took (404) is not an action.
      const template = req.route?.path;
      if (typeof template !== 'string') return;
      const path = `${req.baseUrl ?? ''}${template}`;
      if (NOT_ACTIONS.test(path)) return;
      const caller = callerOf(req, config.nodeId, store);
      const kind = USAGE_KIND[caller.kind];
      if (!kind) return;
      const actor = caller.principal;
      recordUsageCall({
        ownerGhii: caller.visitor ? actor : ownerGhiiOf(actor),
        actorGaii: actor,
        actorKind: kind,
        surface: 'http',
        coordinate: `${req.method} ${path}`,
        outcome: res.statusCode < 400 ? 'ok' : 'error',
        reason: res.statusCode < 400 ? '' : String(res.statusCode),
        durationMs: Date.now() - startedAt,
        meta: { target: targetOf(req) },
      });
    });
    next();
  };
}
