/**
 * @file src/mcp/organism-apps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_organism_apps on the node MCP: an organism's app wall from
 *   services/app/organism-wall.ts organismWall, the function GET /v1/organisms/:id/apps answers with,
 *   for the session's own principal and owner. organism:read is its word in TOOL_SCOPES, the one the
 *   route asks.
 * @structure registerOrganismAppsTools(mcp, storage, config, caller)
 * @usage registerOrganismAppsTools(mcp, storage, config, caller);  // register-all.ts
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-organisaation-oma-appisein-kollegoiden-apit-n-kyviin-eri-kul).
 */
import { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import { organismWall } from '../services/app/organism-wall.js';

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });

export function registerOrganismAppsTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  caller: () => CallerContext,
): void {
  mcp.registerTool('aimeat_organism_apps', { description: descriptionFor('aimeat_organism_apps'), inputSchema: zodShapeFor('aimeat_organism_apps'), annotations: annotationsFor('aimeat_organism_apps') }, async ({ organism_id, lang }) => {
    const c = caller();
    const out = await organismWall({ storage, config }, { sub: c.principal, owner: c.owner }, String(organism_id), String(lang ?? 'en'));
    if (!out.ok) return toolError(out.code, out.message);
    return text(out.wall);
  });
}
