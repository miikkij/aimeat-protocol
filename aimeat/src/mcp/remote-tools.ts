/**
 * @file src/mcp/remote-tools.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Flattening: a remote server's own tools, listed one by one with their own schemas,
 *   for a server the owner marked `exposure: 'flatten'`.
 *
 *   WHY THIS IS OPT-IN AND NOT THE DEFAULT. This node publishes about 340 tools. An AI given all of
 *   them plus everything anybody attached stops choosing well, and a client with a tool-count limit
 *   simply truncates. The gateway (`aimeat_mcp_list` / `_tools` / `_call`) costs one lookup before
 *   the first call and costs the list nothing, which is the right trade for a server used twice a
 *   month. Flattening costs list space and buys native calling with real schemas and no lookup,
 *   which is the right trade for the one server somebody uses all day. The owner knows which is
 *   which; nothing here can guess it.
 *
 *   IT REGISTERS AFTER THE PATCH WINDOW CLOSES, in the same place and for the same reason managed
 *   prompts do. The gate in createMcpServer monkeypatches `mcp.tool` to filter by the STATIC
 *   catalogue, and `descriptionFor()` throws for a name that catalogue does not hold. A remote tool
 *   is a runtime name and can never be in it, so it must not pass through that gate at all.
 *
 *   THE GATE IS NOT SKIPPED, IT IS ANSWERED EARLIER. Nothing reaches this function unless the
 *   session already holds `mcp:use` and the owner's grant already allows the tool, and each call
 *   goes back through the same `callRemoteTool` chokepoint as the gateway — so a flattened tool has
 *   exactly the reach a gateway call would have had, and not a step more.
 * @structure remoteToolName · splitRemoteToolName · registerRemoteTools
 * @usage await registerRemoteTools(mcp, { storage, config, agentGaii, scopes });
 * @version-history
 *   v1.0.0 — 2026-09-16 — Phase 3 of the MCP proxy.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { MCP_TOOL_SEPARATOR, type McpServerRecord } from '../models/mcp-server-schemas.js';
import { callRemoteTool } from '../services/mcp-client/invoke.js';
import { resolveMcpAccess } from '../services/mcp-client/grants.js';
import { listOwnedServers } from '../services/mcp-client/registry.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { logger } from '../utils/logger.js';

/**
 * The name a remote tool takes on our surface: `{slug}__{tool}`.
 *
 * Two underscores, and the slug pattern forbids underscores entirely, so this splits on the FIRST
 * occurrence with no ambiguity. A single separator would make `jira_create_issue` unanswerable
 * about where the server's name ends.
 */
export const remoteToolName = (slug: string, tool: string): string =>
  `${slug}${MCP_TOOL_SEPARATOR}${tool}`;

export function splitRemoteToolName(name: string): { slug: string; tool: string } | null {
  const at = name.indexOf(MCP_TOOL_SEPARATOR);
  if (at <= 0) return null;
  return {
    slug: name.slice(0, at),
    tool: name.slice(at + MCP_TOOL_SEPARATOR.length),
  };
}

/**
 * A ceiling on how many flattened tools ONE session may carry.
 *
 * Not a guess: this node already publishes about 340, and a client that truncates a tool list
 * truncates OURS as readily as anybody's. An owner who flattens four busy servers is served; one
 * who flattens everything they ever attached is protected from making their own AI worse, and the
 * log says which server was cut so it is not a mystery.
 */
const MAX_FLATTENED = 120;

export interface RemoteToolDeps {
  storage: Storage;
  config: AimeatConfig;
  agentGaii: () => string;
  scopes: string[];
}

/**
 * Register the flattened tools this session is entitled to.
 *
 * Returns how many were registered, which the caller logs beside the scope report — a session whose
 * tool list silently grew by forty is worth being able to explain afterwards.
 */
export async function registerRemoteTools(
  mcp: McpServer, deps: RemoteToolDeps,
): Promise<number> {
  const { storage, config, agentGaii, scopes } = deps;

  // Nothing to do for a session that could not call one anyway. Asked before any storage read, so
  // the ordinary session pays nothing for a feature it is not using.
  if (!scopeIsCovered(scopes, 'mcp:use')) return 0;

  const owner = ownerGhiiOf(agentGaii());
  if (!owner) return 0;

  let servers: McpServerRecord[];
  try {
    servers = await listOwnedServers(storage, owner);
  } catch (err) {
    // A session must still open when this lookup fails. The gateway tools are already registered
    // and reach the same servers, so the cost of a failure here is a smaller tool list, not a
    // broken connection.
    logger.warn('mcp-remote-tools: the attached servers could not be listed for this session', {
      agent: agentGaii(), error: String(err),
    });
    return 0;
  }

  let registered = 0;
  for (const server of servers) {
    if (server.exposure !== 'flatten' || server.status !== 'active') continue;

    for (const tool of server.toolCache) {
      if (registered >= MAX_FLATTENED) {
        logger.warn('mcp-remote-tools: the flattened tool ceiling was reached, the rest stay behind the gateway', {
          agent: agentGaii(), ceiling: MAX_FLATTENED, from: server.slug,
        });
        return registered;
      }

      // The owner's narrowing decides which of this server's tools appear AT ALL. A tool the grant
      // does not allow is not offered rather than offered-and-refused: a control whose only
      // possible answer is a refusal costs the AI a turn to discover.
      const access = await resolveMcpAccess({
        storage, server, grantee: agentGaii(), tool: tool.name, scopes,
      });
      if (!access.allowed) continue;

      const name = remoteToolName(server.slug, tool.name);
      mcp.registerTool(
        name,
        {
          // The far side's own words, with one sentence saying whose tool this is. Without that a
          // person reading their AI's transcript has no idea a call left this node.
          description: `${tool.description}\n\n(From "${server.title || server.slug}", a server `
            + `attached to this account. This node holds the credential and spends it for you.)`,
          // The upstream schema, verbatim. A schema we rewrote is one that disagrees with the
          // server that will validate the call.
          inputSchema: toZodShape(tool.inputSchema),
          annotations: {
            title: `${tool.name} (${server.slug})`,
            // Honest and wide: this node cannot know what somebody else's tool does, and a client
            // deciding whether to auto-run must not be told "safe" on our guess about a stranger.
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
          },
        },
        async (args: Record<string, unknown>) => {
          // The SAME chokepoint the gateway calls. A flattened tool has exactly the reach a
          // gateway call would have had, including the grant, the locked arguments and the meter.
          const result = await callRemoteTool({
            storage, config, server, tool: tool.name,
            args: args ?? {},
            caller: agentGaii(), callerKind: 'agent', scopes,
          });
          if (!result.ok) {
            return { content: [{ type: 'text' as const, text: result.message }], isError: true };
          }
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result.content, null, 2) }],
            ...(result.isError ? { isError: true } : {}),
          };
        },
      );
      registered++;
    }
  }
  return registered;
}

/**
 * The upstream JSON Schema, as the shape `registerTool` wants.
 *
 * DELIBERATELY SHALLOW. The SDK takes a record of Zod types for the top-level properties, and the
 * far side is what actually validates the call — so translating its whole schema would be a second
 * validator that can only ever be wrong in a way this node cannot detect. What this needs to get
 * right is the NAMES and which are required, because that is what the AI reads to build a call;
 * everything deeper travels as-is and the far side judges it.
 */
function toZodShape(schema: Record<string, unknown>): Record<string, z.ZodTypeAny> {
  const props = (schema?.properties ?? {}) as Record<string, { description?: string; type?: string }>;
  const required = new Set((schema?.required as string[] | undefined) ?? []);
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, spec] of Object.entries(props)) {
    let field = baseType(spec?.type);
    if (spec?.description) field = field.describe(spec.description);
    shape[key] = required.has(key) ? field : field.optional();
  }
  return shape;
}

/**
 * One declared JSON Schema type, as the nearest Zod type.
 *
 * MAPPED RATHER THAN LEFT UNKNOWN so the AI is told what a field takes; the far side still does the
 * real validation, and anything deeper than this travels as-is.
 *
 * `z.custom()` was tried here and is WRONG in a way no unit test caught: it cannot be represented
 * in JSON Schema, so `tools/list` threw for the entire session — every tool gone, not just this
 * one. Found by opening a real MCP session against the node, which is the only place a
 * serialisation failure can show up. `z.unknown()` serialises to `{}` and still lands in the
 * emitted `required` array, which is what a client actually reads; `isOptional()` reporting true
 * for it is a Zod detail that never reaches the wire.
 */
function baseType(type: string | undefined): z.ZodTypeAny {
  switch (type) {
    case 'string': return z.string();
    case 'number': case 'integer': return z.number();
    case 'boolean': return z.boolean();
    case 'array': return z.array(z.unknown());
    case 'object': return z.record(z.string(), z.unknown());
    default: return z.unknown();
  }
}
