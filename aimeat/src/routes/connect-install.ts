/**
 * @file connect-install.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MCP configuration file, downloadable. A person picks their client, saves the
 *   file where the client looks, and the connection is made without walking a settings menu.
 *
 *   IT RETURNS THE FILE, NOT THE ENVELOPE. Every other route here answers with success()/error(),
 *   and this one deliberately does not on the success path: the bytes are read by Claude Code, VS
 *   Code or Cursor, and none of them knows what a `data` wrapper is. A refusal still uses error(),
 *   because a refusal is read by us. The alternative — an envelope the person has to unwrap by hand
 *   before the file works — would defeat the only thing this route is for.
 *
 *   IT IS PUBLIC, AND THAT IS SAFE BECAUSE IT HOLDS NOTHING. This node authenticates MCP over OAuth
 *   2.1 with dynamic client registration, so the file is the endpoint URL and a name. Everything
 *   personal happens afterwards, in a browser, as whoever signs in. See services/mcp-install.ts.
 * @structure connectInstallRouter(config) -> Router; GET /v1/connect/mcp.json
 * @usage app.use(connectInstallRouter(config));
 * @version-history
 *   v1.0.0 — 2026-08-27 — Initial.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import { error } from '../middleware/envelope.js';
import { MCP_INSTALL_CLIENTS, isMcpInstallClient, mcpConfigFile } from '../services/mcp-install.js';

export function connectInstallRouter(config: AimeatConfig): Router {
  const router = Router();

  // GET /v1/connect/mcp.json?client=claude-code|vscode|cursor&name=<server name>
  router.get('/v1/connect/mcp.json', (req, res) => {
    const client = req.query.client;
    if (!isMcpInstallClient(client)) {
      res.status(400).json(error(config.nodeId, 'INVALID_CLIENT',
        `client must be one of: ${MCP_INSTALL_CLIENTS.join(', ')}`));
      return;
    }

    const mcpUrl = `${config.baseUrl.replace(/\/+$/, '')}/v1/mcp`;
    const file = mcpConfigFile(client, mcpUrl, req.query.name);

    // The filename is ours, not the caller's: mcpConfigFile picks it per client and the query only
    // ever reaches the server NAME inside the JSON. Nothing from the request lands in this header.
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    // A node that moves its address serves a different file, so this is cached briefly and not for
    // a day. Public: there is nothing per-person in it to leak into a shared cache.
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.type('application/json').send(`${JSON.stringify(file.config, null, 2)}\n`);
  });

  return router;
}
