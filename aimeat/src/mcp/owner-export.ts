/**
 * @file src/mcp/owner-export.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node MCP tool of the person's data export: aimeat_account_export. It calls the
 *   operations REST calls (services/owner-export/ops.ts) for the session's own account, with the
 *   session as the caller; an agent never gets the download links (ops.ts says why).
 * @structure registerOwnerExportTools(mcp, storage, config, caller)
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-owner-data-export-as-a-chosen-parts-background-job).
 */
import type { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import { cancelExportFor, exportPlanFor, exportStatusFor, startExportFor } from '../services/owner-export/ops.js';

type Out = { ok: true; data: Record<string, unknown> } | { ok: false; code: string; message: string };

export function registerOwnerExportTools(mcp: McpServer, storage: Storage, config: AimeatConfig, caller: () => CallerContext): void {
  const deps = { storage, config };
  const ok = (data: Record<string, unknown>) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] });
  const run = async (a: Record<string, unknown>): Promise<Out> => {
    const c = caller();
    const name = c.owner;
    if (a.action === 'plan') return exportPlanFor(deps, c, name);
    if (a.action === 'start') return startExportFor(deps, c, name, a.parts !== undefined ? { parts: a.parts } : {});
    if (a.action === 'status') return exportStatusFor(deps, c, name);
    if (a.action === 'cancel') return cancelExportFor(deps, c, name);
    return { ok: false, code: 'INVALID_INPUT', message: 'action is plan, start, status or cancel.' };
  };
  mcp.registerTool('aimeat_account_export', {
    description: descriptionFor('aimeat_account_export'), inputSchema: zodShapeFor('aimeat_account_export'), annotations: annotationsFor('aimeat_account_export'),
  }, async (args) => {
    const out = await run(args as Record<string, unknown>);
    if (!out.ok) return toolError(out.code, out.message);
    return ok(out.data);
  });
}
