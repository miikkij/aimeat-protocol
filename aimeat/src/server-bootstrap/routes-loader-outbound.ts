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
 *   v1.0.0 — 2026-09-29 — Moved from routes-loader.ts, unchanged.
 */
import type express from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { connectionsRouter } from '../routes/connections.js';
import { refineryRouter } from '../routes/refinery.js';
import { mcpServersRouter } from '../routes/mcp-servers.js';

export function mountOutboundRouters(app: express.Express, config: AimeatConfig, storage: Storage): void {
  app.use(connectionsRouter(config, storage));  // TARGET-057: outbound connections + delegations
  app.use(refineryRouter(config, storage));     // the refinery: a mail pipeline run on the node
  app.use(mcpServersRouter(config, storage));   // the remote MCP servers this node connects OUT to
}
