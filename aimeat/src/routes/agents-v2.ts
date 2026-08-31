/**
 * @file src/routes/agents-v2.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Agent v2: the key-and-card identity path, built ALONGSIDE the device-authorization
 *   one. Nothing here changes, reads or deprecates a v1 route — an existing agent connects, polls,
 *   tunnels and works exactly as before, and every door in this router refuses an agent that is not
 *   marked `identityVersion: 2`.
 *
 *   The four doors, and what each is for:
 *     POST /v1/agents/v2/basic-agents  the owner's button: three agents, no pasting, no restart
 *     GET  /v1/agents/v2/basic-agents  what the set is and whether a daemon is there to serve it
 *     POST /v1/agents/v2/enrol         the connected daemon turns a grant plus cards into credentials
 *     POST /v1/agents/v2/token         an agent turns its key into a short-lived credential
 *     GET  /v1/agents/:gaii/card       the agent's signed card (public)
 *     GET  /v1/agents/:gaii/jwks.json  the key that verifies it (public)
 *
 *   MOUNT ORDER MATTERS. This router must be mounted BEFORE agentsRouter, or `/v1/agents/:name`
 *   swallows `/v1/agents/v2/...` and reads "v2" as an agent name — the same trap routes-loader.ts
 *   already documents for the task, directive and capability routers.
 *
 * @structure agentsV2Router(config, storage) — mounts basic-agents, enrolment, token and card routes
 * @usage app.use(agentsV2Router(config, storage));  // BEFORE agentsRouter
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial (Agent v2, V1): key, card, JWKS, token exchange, the basic-agents
 *     button and enrolment into a live daemon.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { registerBasicAgentsRoutes } from './agents-v2/basic-agents.js';
import { registerAgentV2EnrolRoute } from './agents-v2/enrolment.js';
import { registerAgentV2TokenRoute } from './agents-v2/token.js';
import { registerAgentCardRoutes } from './agents-v2/card.js';

export function agentsV2Router(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // Literal paths before the `:gaii` ones, so `/v1/agents/v2/...` is never read as an identity.
  registerBasicAgentsRoutes(router, config, storage);
  registerAgentV2EnrolRoute(router, config, storage);
  registerAgentV2TokenRoute(router, config, storage);
  registerAgentCardRoutes(router, config, storage);

  return router;
}
