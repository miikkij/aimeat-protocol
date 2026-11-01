/**
 * @file src/mcp/build-with-you.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node MCP surface for "build it with you": aimeat_build_request_submit,
 *   aimeat_build_request_status and aimeat_trail_list. Each calls the function the REST route calls
 *   (services/build-with-you.ts, services/place-trail.ts), so who may do what exists once. Nothing is
 *   decided in this file.
 * @structure registerBuildWithYouTools(mcp, storage, config, caller)
 * @usage registerBuildWithYouTools(mcp, storage, config, caller);   // mcp/register-all.ts
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial ("Rakennamme kanssasi").
 */
import type { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import { withCaughtError } from './tool-fault.js';
import { BuildError, readOp, submitOp } from '../services/build-with-you.js';
import { readOwnTrail, TrailError } from '../services/place-trail.js';

export function registerBuildWithYouTools(mcp: McpServer, storage: Storage, config: AimeatConfig, caller: () => CallerContext): void {
  const deps = { storage, config };
  const ok = (obj: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }] });
  // Each handler calls its operation in its own body, as the REST route does: the field-reach
  // measurement pairs the two by the function both call.
  const fail = (err: unknown) => {
    if (err instanceof BuildError || err instanceof TrailError) return toolError(err.code, err.message);
    return withCaughtError(toolError('BUILD_REQUEST_ERROR', err instanceof Error ? err.message : String(err)), err);
  };
  const iso = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : undefined);

  mcp.registerTool('aimeat_build_request_submit', {
    description: descriptionFor('aimeat_build_request_submit'),
    inputSchema: zodShapeFor('aimeat_build_request_submit'),
    annotations: annotationsFor('aimeat_build_request_submit'),
  }, async (args) => {
    try { return ok(await submitOp(deps, caller(), args as Record<string, unknown>)); } catch (err) { return fail(err); }
  });

  mcp.registerTool('aimeat_build_request_status', {
    description: descriptionFor('aimeat_build_request_status'),
    inputSchema: zodShapeFor('aimeat_build_request_status'),
    annotations: annotationsFor('aimeat_build_request_status'),
  }, async () => {
    try { return ok(await readOp(deps, caller())); } catch (err) { return fail(err); }
  });

  mcp.registerTool('aimeat_trail_list', {
    description: descriptionFor('aimeat_trail_list'),
    inputSchema: zodShapeFor('aimeat_trail_list'),
    annotations: annotationsFor('aimeat_trail_list'),
  }, async (args) => {
    const a = args as Record<string, unknown>;
    try {
      return ok(await readOwnTrail(storage, caller(), {
        since: iso(a.since), before: iso(a.before), limit: typeof a.limit === 'number' ? a.limit : undefined,
      }));
    } catch (err) { return fail(err); }
  });
}
