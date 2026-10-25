/**
 * @file src/services/mcp-client-cleanup.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The daily cleanup of MCP client registrations nobody uses. POST /v1/mcp/register is
 *   open Dynamic Client Registration (RFC 7591): Claude, Claude Code and other MCP clients register
 *   there before the sign-in, without a credential, so a registration whose sign-in never finished
 *   stayed in storage for good, and nothing removed it (secaudit2026oct22,
 *   dcr-unbounded-client-records). This job deletes a registration older than
 *   config.mcpUnusedClientDays (mcp.unused_client_days, default 30) that holds no refresh token and
 *   no remembered approval. A client that signed someone in keeps its row: its refresh token or its
 *   approval names it. 0 keeps every registration.
 * @structure runMcpClientCleanup(storage, config, now?)
 * @usage scheduler.registerCoreHandler('mcp-client-cleanup', () => runMcpClientCleanup(storage, config));
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, dcr-unbounded-client-records).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Delete the unused registrations past the setting's age. Returns how many went (0 when the setting is 0). */
export async function runMcpClientCleanup(storage: Storage, config: AimeatConfig, now: Date = new Date()): Promise<number> {
  const days = config.mcpUnusedClientDays;
  if (!(Number.isInteger(days) && days > 0)) return 0;
  const removed = await storage.deleteUnusedOAuthClients(new Date(now.getTime() - days * DAY_MS).toISOString());
  if (removed > 0) logger.info(`[mcp-client-cleanup] removed ${removed} MCP client registration(s) older than ${days} days that no sign-in used`);
  return removed;
}
