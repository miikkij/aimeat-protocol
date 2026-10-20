/**
 * @file src/mcp/publish-requests.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_publish_requests on the node's own MCP surface: list the account's requests to
 *   make something public, read one, approve or decline one (plan doc-mvcn6c7e4e5q, V4.3).
 *
 *   WHY FROM A CHAT. An owner's AI chat is an agent, so the owner can settle a request by talking:
 *   an agent of theirs decides it here under services/publish-requests/policy.ts. It approves only a
 *   request it did not file, and only holding publish:public; otherwise it is told the owner approves
 *   on their Notifications page.
 *
 *   ONE IMPLEMENTATION. The work is services/publish-requests/decide.ts, the functions the
 *   /v1/publish-requests routes call; this file reads who is asking and renders the answer.
 *   memory:write is its word in TOOL_SCOPES, the one those routes ask.
 * @structure registerPublishRequestTools(mcp, storage, config, caller)
 * @usage registerPublishRequestTools(mcp, storage, config, caller);  // register-all.ts
 * @version-history
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   2026-10-20 — Tools register with mcp.registerTool(name, { description, inputSchema, annotations }, handler), the form the MCP SDK v2 keeps (plan doc-mvguy322f9se, step 3). No behaviour change.
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4.3).
 */
import { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import { listPublishRequestsFor, readPublishRequestFor, decidePublishRequest } from '../services/publish-requests/decide.js';

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

export function registerPublishRequestTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  caller: () => CallerContext,
): void {
  mcp.registerTool('aimeat_publish_requests', { description: descriptionFor('aimeat_publish_requests'), inputSchema: zodShapeFor('aimeat_publish_requests'), annotations: annotationsFor('aimeat_publish_requests') }, async ({ request_id, decision }) => {
    // The owner the session acts for comes from its identity, never from input.
    const who = { caller: caller() };
    const ctx = { storage, config };
    if (decision !== undefined) {
      if (!request_id) return toolError('INVALID_INPUT', 'Name the request to decide with request_id. List them by calling this tool with no arguments.');
      const out = await decidePublishRequest(ctx, who, request_id, decision);
      if (!out.ok) return toolError(out.code, out.message);
      return text({ decision: out.decision, request: out.request });
    }
    if (request_id) {
      const out = await readPublishRequestFor(ctx, who, request_id);
      if (!out.ok) return toolError(out.code, out.message);
      return text({ request: out.request });
    }
    const out = await listPublishRequestsFor(ctx, who);
    if (!out.ok) return toolError(out.code, out.message);
    return text({ requests: out.requests, waiting: out.waiting });
  });
}
