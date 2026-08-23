/**
 * @file src/routes/auth-otk.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The connectivity-key mint: POST /v1/auth/connectivity-key creates the registration
 *   key an agent onboards with (redeemed in routes/agents/registration.ts). The Tier 0.5 one-time
 *   key routes that used to live beside it — POST /v1/auth/otk, POST /v1/auth/initial-otk and the
 *   unauthenticated GET /v1/otk/:key — were REMOVED on 2026-08-23: RFC v4.0 deprecated Tier 0.5,
 *   three of its write paths were deleted in 9723f018, and the security audit's AI triage flagged
 *   both mints for storing a raw `sub` as the write target. The legacy challenge-session OTKs and
 *   micro-memory's `?otk=` consumption live elsewhere (routes/auth.ts, routes/micro-memory.ts) and
 *   were not part of that removal.
 * @structure registerOtkRoutes(router, config, storage)
 * @usage registerOtkRoutes(router, config, storage) from authRouter().
 * @version-history
 *   v1.0.0 -- 2026-08-15 -- Extracted from auth.ts (max-file-lines) as part of E2E test-quality
 *     audit finding A8, which gave the mint its scope gate and its reserved-key check and moved the
 *     execution onto the shared memory write.
 *   v2.0.0 -- 2026-08-23 -- Tier 0.5 OTK routes removed (deprecated in RFC v4.0); only the
 *     connectivity-key mint remains. E2E asserts the removed routes answer 404.
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { validateAgentName, buildGAII } from '../utils/gaii.js';
import { generateOtk } from '../utils/otk.js';

export function registerOtkRoutes(
  router: Router,
  config: AimeatConfig,
  storage: Storage,
): void {

  // POST /v1/auth/connectivity-key — generate a connectivity key for AI agent registration
  router.post('/v1/auth/connectivity-key', requireAuth(), requireRole('owner'), async (req, res) => {
    const { agent_name, description } = req.body ?? {};
    const owner = req.auth!.owner;

    if (agent_name) {
      const nameError = validateAgentName(agent_name);
      if (nameError) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', nameError));
        return;
      }

      const gaii = buildGAII(agent_name, owner, config.nodeId);
      const existing = await storage.getAgent(gaii);
      if (existing) {
        res.status(409).json(error(config.nodeId, 'NAME_TAKEN', `Agent "${agent_name}" already exists under your identity`));
        return;
      }
    }

    const key = generateOtk();
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString();

    await storage.createOtk({
      key,
      ownerGaii: req.auth!.sub,
      action: 'register_agent',
      params: {
        owner,
        agent_name: agent_name ?? null,
        description: description ?? null,
      },
      expiresAt: farFuture,
      initial: true,
      used: false,
      usedAt: null,
      sessionId: null,
      createdAt: new Date().toISOString(),
    });

    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.status(201).json(success(config.nodeId, {
      connectivity_key: key,
      owner,
      agent_name: agent_name ?? null,
    }));
  });
}
