/**
 * @file public-catalogue.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What this node can do, answered to a caller who has no credential.
 *
 *   THE QUESTION THIS EXISTS FOR. A stranger's agent arrives knowing nothing but the hostname and
 *   wants to decide whether it is worth asking its owner for an account here. Until now the only
 *   honest answer it could get was 401: the MCP endpoint required a credential before it would say
 *   anything at all, including what it was. `/.well-known/mcp.json` names the transport but not one
 *   capability, so "what can this node actually do" had no machine answer without signing up first.
 *
 *   WHAT IS GIVEN AWAY, AND WHAT IS NOT. Names, descriptions and input shapes — the contract, which
 *   is public in `openapi.json` and in this repository already. No data, no identity, no session,
 *   and no call: `tools/call` still answers 401 like everything else. Knowing that
 *   `aimeat_memory_read` exists and takes a key is not access to anybody's memory.
 *
 *   ONLY WHAT THE PUBLIC SURFACE CARRIES. `visibility.publicMcp` is the filter, so an operator-only
 *   or connector-only tool is not advertised to the open internet. The list is the same catalogue
 *   both MCP surfaces and the CLI dispatch are held to by `check:mcp-tools`, so this cannot drift
 *   into a fourth answer to "which tools are there".
 * @structure
 *   - publicToolCatalogue() — the MCP `tools/list` result shape, built from the shared catalogue
 * @usage
 *   import { publicToolCatalogue } from './public-catalogue.js';
 *   res.json({ jsonrpc: '2.0', id, result: { tools: publicToolCatalogue() } });
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial: anonymous `tools/list` so capability is discoverable without an
 *     account. `initialize` deliberately still answers 401 — see mcp/index.ts for why.
 */
import { CLI_FALLBACK_TOOL_DEFINITIONS } from './catalog/definitions.js';
import type { ToolInputField } from './catalog/definitions/types.js';

/** One tool as MCP's `tools/list` describes it: a name, a sentence, and a JSON Schema for the input. */
interface PublicTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
}

/** The catalogue's field type, in JSON Schema's words. `unknown` has no schema type; it is omitted. */
function schemaProperty(field: ToolInputField): { type: string; description: string; enum?: string[] } {
  return {
    type: field.type === 'unknown' ? 'string' : field.type,
    description: field.description,
    ...(field.enum ? { enum: field.enum } : {}),
  };
}

/**
 * Every tool the public MCP surface carries, as an MCP `tools/list` result.
 *
 * Computed once. The catalogue is a module constant, so recomputing it per request would be work
 * done for nothing on a route a scanner may hit repeatedly.
 */
let cached: PublicTool[] | null = null;

export function publicToolCatalogue(): PublicTool[] {
  if (cached) return cached;
  cached = CLI_FALLBACK_TOOL_DEFINITIONS
    .filter(def => def.visibility.publicMcp)
    .map(def => {
      const properties: PublicTool['inputSchema']['properties'] = {};
      const required: string[] = [];
      for (const [name, field] of Object.entries(def.input)) {
        properties[name] = schemaProperty(field);
        if (field.required) required.push(name);
      }
      return {
        name: def.name,
        description: def.description,
        inputSchema: {
          type: 'object' as const,
          properties,
          ...(required.length ? { required } : {}),
        },
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return cached;
}
