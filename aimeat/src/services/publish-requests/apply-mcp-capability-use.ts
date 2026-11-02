/**
 * @file src/services/publish-requests/apply-mcp-capability-use.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The account holder allowed another account's capability to run a tool on a remote MCP
 *   server with their own sign-in there (services/mcp-client/capability-consent.ts filed it). That
 *   capability runs for the account holder, their agents and their apps from now on. A capability
 *   removed, moved to another publisher or changed to another tool since, or a question no longer
 *   waiting on this request, ends the request `outdated`.
 * @structure applyMcpCapabilityUse
 * @usage registered in appliers.ts under the kind 'mcp-capability-use'
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial (secaudit2026nov02d round 13,
 *     capability-invoke.ts:mcp-source:personal-sign-in-server-spends-caller-credential).
 */
import { allowCapabilityUse } from '../mcp-client/capability-consent.js';
import type { PublishApplyResult, PublishRequest, PublishStoreCtx } from './store.js';

export async function applyMcpCapabilityUse(ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest): Promise<PublishApplyResult> {
  const t = request.target;
  const target = { capability: String(t.capability ?? ''), publisher: String(t.publisher ?? ''), server: String(t.server ?? ''), tool: String(t.tool ?? '') };
  if (!target.capability || !target.publisher || !target.server || !target.tool) return { ok: false, reason: 'the request names no capability' };
  const changed = await allowCapabilityUse(ctx, ownerGhii, target, request.id);
  return changed ? { ok: true } : { ok: false, reason: 'the capability is gone or changed, or it no longer waits for this answer' };
}
