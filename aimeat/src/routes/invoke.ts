/**
 * @file src/routes/invoke.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The second primitive: run a capability you found with `discover`.
 *
 *     GET  /v1/capabilities/node          — the catalogue, or a slice of it
 *     GET  /v1/capabilities/node/:id      — one capability's contract
 *     POST /v1/invoke                     — run one, as yourself
 *
 *   A DOOR BESIDE THE OTHERS, NOT INSTEAD OF THEM. Every one of this node's existing tools and
 *   routes answers exactly as it did; nothing here replaces anything. What it adds is the pair a
 *   model can hold in context — find a capability, run it — so an agent no longer needs several
 *   hundred tool descriptions loaded to know what this node can do.
 *
 *   THE CALL RUNS AS THE CALLER. `invoke` dispatches over loopback with the caller's own bearer
 *   through the node's real Express stack, so the target route's own `requireAuth`, `requireScope`
 *   and ownership checks decide, exactly as they would if the caller had called it directly. There
 *   is no privileged path here: `invoke` cannot do anything its caller could not already do, which
 *   is why this route itself carries no scope of its own. A scope here would be a second, weaker
 *   opinion in front of the real one.
 *
 *   The catalogue reads are unauthenticated because the catalogue is a description of the NODE, the
 *   same list `/v1/spec` and every MCP tool listing already publish. Knowing that a capability
 *   exists gives nobody access to it.
 *
 * @structure invokeRouter(config, storage)
 * @usage app.use(invokeRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V2: discover + invoke).
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth } from '../auth/middleware.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { listNodeCapabilities, findNodeCapability, searchNodeCapabilities } from '../services/node-capabilities.js';
import { invokeNodeCapability } from '../services/node-invoke.js';

/** Never send the whole catalogue at once by accident; a caller that wants it all asks page by page. */
const MAX_LIST = 100;

export function invokeRouter(config: AimeatConfig, _storage: Storage): Router {
  const router = Router();

  // ── GET /v1/capabilities/node — the catalogue ──
  router.get('/v1/capabilities/node', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const segment = typeof req.query.segment === 'string' ? req.query.segment : undefined;
    const rawLimit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : NaN;
    const limit = Math.min(Number.isFinite(rawLimit) ? Math.max(rawLimit, 1) : 20, MAX_LIST);
    const found = searchNodeCapabilities(q, segment, limit);
    const all = listNodeCapabilities();
    res.json(success(config.nodeId, {
      total: all.length,
      returned: found.length,
      // The families a caller can filter on, so browsing does not start with a guess.
      segments: [...new Set(all.map(c => c.segment))].sort(),
      capabilities: found.map(c => ({ id: c.id, title: c.title, segment: c.segment, description: c.description, required: c.required })),
    }, [
      { description: 'Read one capability\'s contract', method: 'GET', url: '/v1/capabilities/node/{id}' },
      { description: 'Run one', method: 'POST', url: '/v1/invoke' },
    ]));
  });

  // ── GET /v1/capabilities/node/:id — one contract ──
  router.get('/v1/capabilities/node/:id', (req, res) => {
    const cap = findNodeCapability(req.params.id as string);
    if (!cap) {
      res.status(404).json(error(config.nodeId, 'NO_SUCH_CAPABILITY', 'This node has nothing by that name. Browse what it does have, or search for what you need.'));
      return;
    }
    res.json(success(config.nodeId, { capability: cap }, [
      { description: 'Run it', method: 'POST', url: '/v1/invoke' },
    ]));
  });

  // ── POST /v1/invoke — run one, as yourself ──
  //
  // requireAuth() and no scope, deliberately: the dispatch carries the caller's own bearer back
  // through the real route, so that route's gates apply unchanged. Anything added here would gate a
  // call that is about to be gated properly, and would have to guess which scope the target wants.
  router.post('/v1/invoke', requireAuth(), async (req, res) => {
    const header = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    // The handful of capabilities addressed as /v1/agents/:name/… need the caller's own name. An
    // owner session has no agent name and those capabilities refuse it, which is the same answer
    // they give an owner calling them directly.
    const agentName = parseGaiiLoose(req.auth!.sub).agent || req.auth!.owner;

    const out = await invokeNodeCapability(config, {
      id: (req.body ?? {}).capability,
      input: (req.body ?? {}).input,
      bearer,
      agentName,
    });
    if (!out.ok) {
      res.status(out.status).json(error(config.nodeId, out.code, out.message, out.status, out.details));
      return;
    }
    res.json(success(config.nodeId, {
      capability: out.capability,
      result: out.result,
      duration_ms: out.duration_ms,
    }));
  });

  return router;
}
