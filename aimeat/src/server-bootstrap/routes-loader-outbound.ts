/**
 * @file src/server-bootstrap/routes-loader-outbound.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The routers for what this node reaches OUT to: connected outside accounts, the mail
 *   refinery that reads them, and remote MCP servers. A pure move out of routes-loader.ts
 *   (max-file-lines): the one call there stands where the three mounts stood, so what matches first
 *   is unchanged.
 * @structure mountOutboundRouters(app, config, storage)
 * @version-history
 *   v1.2.0 — 2026-10-09 — Mounts connectionsAgentsRouter ahead of connectionsRouter: the owner sees
 *     and revokes the accounts their agents connected (secrets audit 2026-10-09, F2).
 *   v1.1.0 — 2026-10-09 — Mounts oauthRoundsRouter: the owner confirms a sign-in round an agent
 *     started (secrets audit 2026-10-09, chapter 2).
 *   v1.0.0 — 2026-09-29 — Moved from routes-loader.ts, unchanged.
 */
import type express from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { connectionsRouter } from '../routes/connections.js';
import { refineryRouter } from '../routes/refinery.js';
import { mcpServersRouter } from '../routes/mcp-servers.js';
import { oauthRoundsRouter } from '../routes/oauth-rounds.js';
import { connectionsAgentsRouter } from '../routes/connections-agents.js';

export function mountOutboundRouters(app: express.Express, config: AimeatConfig, storage: Storage): void {
  app.use(connectionsAgentsRouter(config, storage)); // the owner sees and revokes their agents' connections
  app.use(connectionsRouter(config, storage));  // TARGET-057: outbound connections + delegations
  app.use(refineryRouter(config, storage));     // the refinery: a mail pipeline run on the node
  app.use(mcpServersRouter(config, storage));   // the remote MCP servers this node connects OUT to
  app.use(oauthRoundsRouter(config, storage));  // the owner confirms a sign-in round an agent started
}
