/**
 * @file src/utils/mcp-resource.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description This node's MCP endpoint as a resource identifier (RFC 8707): the audience every MCP
 *   token of this node names. A leaf, so a service that mints such a token (services/chat-agent.ts)
 *   reads it without importing src/mcp/, which the layer rules refuse. mcp/oauth-binding.ts
 *   re-exports it for the MCP side.
 * @structure mcpResourceOf
 * @usage const aud = mcpResourceOf(config); // https://node.example/v1/mcp
 * @version-history
 *   v1.0.0 — 2026-10-31 — Moved out of mcp/oauth-binding.ts unchanged, for the chat's session token
 *     (v27 P2).
 */
import type { AimeatConfig } from '../config.js';
import { stripTrailingSlashes } from './url-validator.js';

/** The audience every MCP token of this node carries: the canonical MCP endpoint. */
export function mcpResourceOf(config: AimeatConfig): string {
    return `${stripTrailingSlashes(config.baseUrl)}/v1/mcp`;
}
