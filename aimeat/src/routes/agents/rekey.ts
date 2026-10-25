/**
 * @file src/routes/agents/rekey.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description POST /v1/agents/:gaii/rekey: the owner rotates an agent's key, and every credential
 *   issued to the agent before the rotation stops: its session rows, its connect tunnel, its open MCP
 *   transports, and its MCP OAuth grant (the access tokens through agent.credentialsValidAfter, which
 *   auth/agent-alive.ts reads, and the refresh tokens, which are deleted).
 * @structure registerRekeyRoute(router, config, storage)
 * @usage registerRekeyRoute(router, config, storage) inside registerManagementRoutes (./management.ts).
 * @version-history
 *   2026-10-25 — Moved out of ./management.ts (max-file-lines). The rotation now ends the agent's MCP
 *     OAuth grant: it stamps credentialsValidAfter and deletes the agent's OAuth refresh tokens, and
 *     the answer says that each AI connected as the agent asks the owner to approve it once more
 *     (`mcp_reconsent`, `mcp_refresh_tokens_ended`; secaudit2026oct22, mcp-oauth:rekey-leaves-oauth-grant-live).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { generateKeyPair } from '../../auth/keypair.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { fireHook } from '../../utils/fire-hook.js';
import { emitChange } from '../../services/event-bus.js';
import { getActiveConnectTunnelManager } from '../../services/connect-tunnel.js';
import { closeMcpSessionsForGaii } from '../../mcp/session-registry.js';
import { logger } from '../../utils/logger.js';

/** What the answer tells the owner, in plain words. */
const REKEY_NOTE = 'New keys generated. Store the private key securely. Every token issued to this agent before now has stopped working. '
  + 'An AI tool connected as this agent over MCP (Claude, ChatGPT, Claude Code and others) asks you to approve its connection once more the next time it connects.';

export function registerRekeyRoute(router: Router, config: AimeatConfig, storage: Storage): void {
  // POST /v1/agents/:gaii/rekey — Rotate agent keys (owner auth)
  router.post('/v1/agents/:gaii/rekey', requireAuth(), requireRole('owner'), async (req, res) => {
    const gaii = decodeURIComponent(req.params.gaii as string);
    const agent = await storage.getAgent(gaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', `Agent not found: ${gaii}`));
      return;
    }
    if (agent.owner !== req.auth!.owner) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only rekey your own agents'));
      return;
    }

    const keyPair = await generateKeyPair();
    // credentialsValidAfter: an agent credential issued before this instant is refused on every
    // request (auth/agent-alive.ts). An MCP OAuth access token carries no session id, so this stamp is
    // what ends it; the session rows below end the rest.
    await storage.updateAgent(gaii, { publicKey: keyPair.publicKey, credentialsValidAfter: new Date().toISOString() });
    // The tokens issued before the rekey stop now. A key is rotated because the old one may have
    // leaked, and the answer below, openapi.yaml and the feature list all say they are invalidated;
    // they worked until they expired (feature-list audit row 34).
    await storage.revokeSessionsByGaii(gaii);
    // The MCP OAuth refresh tokens had no expiry and minted new access tokens for the rekeyed agent
    // without end. Deleted, so each connected AI goes through the consent once more.
    const refreshTokensEnded = await storage.deleteOAuthRefreshTokensByGaii(gaii);
    // A tunnel verifies its bearer once, at upgrade, so a connector holding the old token kept its
    // live socket after the rotation. It is cut here, as agent delete does, without a reason the
    // connector would read as "forget this agent" (QA audit F03b-01).
    try { getActiveConnectTunnelManager()?.closeForGaii(gaii, 'rekeyed'); } catch (err) { logger.warn('rekey: tunnel close failed', { gaii, error: String(err) }); }
    // An open MCP session is the same shape of long-lived socket, and it was left standing: the
    // transport verified its bearer once, at initialize. Closed here, so the client re-initializes
    // with a credential this node reads again (mcp/session-registry.ts).
    closeMcpSessionsForGaii(gaii);

    // Extension hook: agent_rekey (fire-and-forget)
    fireHook(config, storage, 'agent_rekey', { gaii, owner: agent.owner });

    // SECURITY: Prevent caching of response containing private key
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.json(success(config.nodeId, {
      rekeyed: true,
      gaii,
      private_key: keyPair.privateKey,
      public_key: keyPair.publicKey,
      mcp_reconsent: true,
      mcp_refresh_tokens_ended: refreshTokensEnded,
      note: REKEY_NOTE,
    }));
    emitChange('agents');
  });
}
