/**
 * @file src/services/build-with-you-send.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two pieces build-with-you.ts needs to send a store place's build request with the
 *   person's OWN account on the builders' node: the MCP server the person attached for that node, and
 *   the queue's answer read out of what that node's aimeat_app_tool_invoke returned.
 *
 *   WHY THE PLACE CALLS. The first version handed the person's AI a `send` block (the address, the tool,
 *   the arguments) to fill in and call through aimeat_mcp_call. On the test lane the place's chat put the
 *   address where aimeat_mcp_call wants the attached server's short name, and nothing was sent
 *   (aimeat-commercial-1c, crew54, 2026-11-01). The place holds the attached row and the person's own
 *   sign-in on it, so it makes the call itself, and the AI has one tool with four fields to fill.
 * @structure attachedQueueServer(storage, ownerGhii, mcpUrl) · queueAnswerOf(content, structured) ·
 *   answerText(content)
 * @usage const row = await attachedQueueServer(storage, caller.ownerGhii, via.mcp);
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial.
 */
import type { Storage } from '../storage/interface.js';
import type { McpServerRecord } from '../models/mcp-server-schemas.js';
import { logger } from '../utils/logger.js';

/** An address as origin and path without a trailing slash, so `…/v1/mcp/` and `…/v1/mcp` are one. */
function sameAddress(u: string): string {
  if (!URL.canParse(u)) return u;
  const url = new URL(u);
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/**
 * The server the person attached for the builders' node: their own, switched on, whose address is that
 * node's MCP address. Null when they have not attached one. Matched by address, never by the short name,
 * because the person chose the name.
 */
export async function attachedQueueServer(storage: Storage, ownerGhii: string, mcpUrl: string): Promise<McpServerRecord | null> {
  const want = sameAddress(mcpUrl);
  const rows = await storage.listMcpServers({ ownership: 'owner', ownerGhii, enabled: true });
  return rows.find((r) => (r.transport.kind === 'http' || r.transport.kind === 'sse') && sameAddress(r.transport.url) === want) ?? null;
}

/** The text parts of an MCP tool result, joined. */
export function answerText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content.map((c) => (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : '')).join('\n');
}

/** The first object at most four levels down that carries a `requestId` string. */
function withRequestId(v: unknown, depth = 0): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || depth > 4) return null;
  if (Array.isArray(v)) {
    for (const item of v) {
      const found = withRequestId(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const obj = v as Record<string, unknown>;
  if (typeof obj.requestId === 'string' && obj.requestId) return obj;
  for (const value of Object.values(obj)) {
    const found = withRequestId(value, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * The queue's answer to submitRequest: the object with its requestId (and statusToken, state, position),
 * from the structured result or from the JSON in the text. The far side wraps it in its own envelope
 * (aimeat_app_tool_invoke's answer, then the extension's), so it is looked for rather than addressed.
 * Null when no requestId is there.
 */
export function queueAnswerOf(content: unknown, structured?: unknown): Record<string, unknown> | null {
  const direct = withRequestId(structured);
  if (direct) return direct;
  const text = answerText(content).trim();
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    logger.warn(`[build-with-you] the builders' answer was not JSON, so it names no requestId: ${(err as Error).message}`);
    return null;
  }
  return withRequestId(parsed);
}
