/**
 * @file src/routes/agents/stop-start.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description POST /v1/agents/:name/stop and POST /v1/agents/:name/start: the owner stops one of
 *   their agents, and starts it again (services/agent-stop.ts, which the MCP tools aimeat_agent_stop
 *   and aimeat_agent_start call as well).
 *
 *   WHAT STOPPED MEANS is in services/agent-stop-rules.ts: the agent starts no new work, work it is
 *   doing finishes, its scheduled runs are skipped, and what it is given waits until it is started.
 *   Its key and its permissions are untouched.
 *
 *   WHO. `agent:write`, the permission that can change the agent anyway: the owner, or another of
 *   the owner's agents that holds it. Never the agent itself; the service refuses that.
 *
 *   BOTH ARE IDEMPOTENT. A second stop answers 200 with `changed: false`, so a person or an AI that
 *   asks twice is not told it failed.
 * @structure registerStopStartRoutes(router, config, storage)
 * @usage registerStopStartRoutes(router, config, storage);
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial (wish-pys-yt-agentti-agentille-pys-ytetty-tila-ja-k-ynnistys-uudel).
 */
import type { Router, RequestHandler } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { resolveIdentity } from '../../utils/gaii.js';
import { setAgentStopped } from '../../services/agent-stop.js';
import { stoppedView } from '../../services/agent-stop-rules.js';

const STATUS: Record<string, number> = { AGENT_NOT_FOUND: 404, ACCESS_DENIED: 403, INVALID_INPUT: 400 };

export function registerStopStartRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  const handle = (stop: boolean): RequestHandler => async (req, res) => {
    const outcome = await setAgentStopped({ storage, config }, req.auth!.owner as string,
      resolveIdentity(req.auth!, config.nodeId), req.params.name as string, stop);
    if (!outcome.ok) {
      res.status(STATUS[outcome.code] ?? 500).json(error(config.nodeId, outcome.code, outcome.message));
      return;
    }
    res.json(success(config.nodeId, {
      gaii: outcome.agent.gaii,
      name: outcome.agent.name,
      ...stoppedView(outcome.agent),
      changed: outcome.changed,
      // On a start: how many waiting tasks began with it. Always 0 on a stop.
      released: outcome.released,
    }));
  };

  router.post('/v1/agents/:name/stop', requireAuth(), requireScope('agent:write'), handle(true));
  router.post('/v1/agents/:name/start', requireAuth(), requireScope('agent:write'), handle(false));
}
