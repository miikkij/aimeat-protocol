/**
 * @file src/routes/ghii/secret-host-ask.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The account's "Ask me before my secret is sent to a new address for the first time"
 *   (services/secret-host-ask-setting.ts), read and changed. The Access page's switch calls these, and
 *   the MCP tool aimeat_secret_host_ask and its CLI twin call the same service.
 *
 *   GET /v1/ghii/me/secret-host-ask   what is in force, whether the owner chose it, the node's default
 *   PUT /v1/ghii/me/secret-host-ask   { on: boolean }. On: at once. Off: at once for the owner in
 *                                     person or a principal holding secrets:manage; anyone else gets
 *                                     202 with `approval_request`, and it stays on until the owner allows.
 * @structure registerSecretHostAskRoutes(router, config, storage)
 * @usage registerSecretHostAskRoutes(router, config, storage) in routes/ghii.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, leads 68 and 386 reworked; Jouni, 2026-10-25).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireScope, requireLocalSession } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { callerOf } from '../../middleware/caller.js';
import { readSecretHostAsk, changeSecretHostAsk } from '../../services/secret-host-ask-setting.js';

export function registerSecretHostAskRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  router.get('/v1/ghii/me/secret-host-ask', requireAuth(), requireLocalSession(), requireScope('memory:read'), async (req, res) => {
    const caller = callerOf(req, config.nodeId, storage);
    res.json(success(config.nodeId, { setting: await readSecretHostAsk(storage, config, caller.ownerGhii) }, [
      { description: 'Switch the question on or off', method: 'PUT', url: '/v1/ghii/me/secret-host-ask', example_body: { on: true } },
    ]));
  });

  router.put('/v1/ghii/me/secret-host-ask', requireAuth(), requireLocalSession(), requireScope('memory:write'), async (req, res) => {
    const out = await changeSecretHostAsk({ storage, config }, callerOf(req, config.nodeId, storage), (req.body as { on?: unknown } | undefined)?.on, req.auth?.app);
    if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
    res.status(out.approval_request ? 202 : 200).json(success(config.nodeId, {
      setting: out.setting, ...(out.approval_request ? { approval_request: out.approval_request } : {}),
    }));
  });
}
