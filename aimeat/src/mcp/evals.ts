/**
 * @file src/mcp/evals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node MCP tools of the stored eval sets: aimeat_eval_set, aimeat_eval_get,
 *   aimeat_eval_run. Each calls the operation REST calls (services/evals/eval-ops.ts), with the session
 *   as the caller; the scope word each needs is on its catalog entry (tool-catalog/definitions/evals.ts).
 * @structure registerEvalTools(mcp, storage, config, caller)
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-stored-eval-sets-for-crews-skills-and-library-packs-scored-p).
 */
import type { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import { getEvalFor, runEvalFor, setEvalFor } from '../services/evals/eval-ops.js';

type Out = { ok: true; data: Record<string, unknown> } | { ok: false; code: string; message: string };

export function registerEvalTools(mcp: McpServer, storage: Storage, config: AimeatConfig, caller: () => CallerContext): void {
  const deps = { storage, config };
  const ok = (data: Record<string, unknown>) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] });
  const s = (v: unknown) => (typeof v === 'string' ? v : '');

  mcp.registerTool('aimeat_eval_set', {
    description: descriptionFor('aimeat_eval_set'), inputSchema: zodShapeFor('aimeat_eval_set'), annotations: annotationsFor('aimeat_eval_set'),
  }, async (args) => {
    const a = args as Record<string, unknown>;
    const out: Out = await setEvalFor(deps, caller(), s(a.kind), s(a.name), { cases: a.cases, ...(a.repeats !== undefined ? { repeats: a.repeats } : {}) });
    if (!out.ok) return toolError(out.code, out.message);
    return ok(out.data);
  });

  mcp.registerTool('aimeat_eval_get', {
    description: descriptionFor('aimeat_eval_get'), inputSchema: zodShapeFor('aimeat_eval_get'), annotations: annotationsFor('aimeat_eval_get'),
  }, async (args) => {
    const a = args as Record<string, unknown>;
    const out: Out = await getEvalFor(deps, caller(), s(a.kind), s(a.name));
    if (!out.ok) return toolError(out.code, out.message);
    return ok(out.data);
  });

  mcp.registerTool('aimeat_eval_run', {
    description: descriptionFor('aimeat_eval_run'), inputSchema: zodShapeFor('aimeat_eval_run'), annotations: annotationsFor('aimeat_eval_run'),
  }, async (args) => {
    const a = args as Record<string, unknown>;
    const out: Out = await runEvalFor(deps, caller(), s(a.kind), s(a.name), { dry_run: a.dry_run === true });
    if (!out.ok) return toolError(out.code, out.message);
    return ok(out.data);
  });
}
