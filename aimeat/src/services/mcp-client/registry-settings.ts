/**
 * @file registry-settings.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Changing and detaching a remote MCP server: updateMcpServerSettings and detachMcpServer,
 *   moved out of registry.ts at the max-file-lines boundary. A move, not a rewrite; registry.ts
 *   re-exports both, so every importer is unchanged.
 * @structure McpServerSettings · updateMcpServerSettings · detachMcpServer
 * @usage import { detachMcpServer } from './registry.js';
 * @version-history
 *   v1.0.0 — 2026-11-02 — Extracted from registry.ts.
 */
import type { Storage } from '../../storage/interface.js';
import type { McpServerRecord, McpExposure } from '../../models/mcp-server-schemas.js';
import { mcpClientPool } from './pool.js';
import { emitChange } from '../event-bus.js';

/** What either door may change after a server is attached. Not the slug and not the credential. */
export interface McpServerSettings {
  enabled?: boolean;
  title?: string;
  description?: string;
  exposure?: McpExposure;
}

/**
 * Change a server's settings.
 *
 * ONE IMPLEMENTATION, TWO DOORS. The REST route and aimeat_mcp_update both call this, so the
 * pool invalidation and the change announcement cannot happen on one door and not the other — and
 * a tool that reached `storage.updateMcpServer` directly would be the second implementation this
 * project has fixed the same defect in three times.
 *
 * SWITCHING OFF STOPS IT, rather than marking it for later. A pooled client would keep answering
 * through a server the owner has just switched off, for as long as the idle sweeper takes to
 * notice, and "I turned it off and it kept working" is the worst possible answer to somebody
 * cutting an integration.
 */
export async function updateMcpServerSettings(
  storage: Storage, server: McpServerRecord, settings: McpServerSettings,
): Promise<McpServerRecord> {
  await storage.updateMcpServer(server.id, settings);
  if (settings.enabled === false) await mcpClientPool.invalidate(server.id);
  if (server.ownerGhii) emitChange('mcp-servers', server.ownerGhii);
  return (await storage.getMcpServer(server.id)) ?? server;
}

/**
 * Detach a server.
 *
 * The pool is invalidated FIRST. A client left open would keep answering calls through a server the
 * owner has just removed, for as long as the idle sweeper takes to notice — and "I deleted it and
 * it kept working" is the worst possible answer to a person removing an integration.
 */
export async function detachMcpServer(
  storage: Storage, server: McpServerRecord,
): Promise<void> {
  await mcpClientPool.invalidate(server.id);
  await storage.deleteMcpServer(server.id);
  if (server.ownerGhii) emitChange('mcp-servers', server.ownerGhii);
}
