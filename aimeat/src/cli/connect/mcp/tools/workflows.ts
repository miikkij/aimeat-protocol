/**
 * @file workflows.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector MCP registrations for the Agent Workflows tools — parity with the server
 *   MCP (src/mcp/workflows.ts) so `aimeat connect serve --surface agent` exposes the same
 *   save/get/run tools locally. Thin REST wrappers over /v1/workflows.
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.4.3 -- 2026-09-26 -- The definition's text says an ai step's call holds its share of
 *     maxCostUsd until it answers, the share is one attempt, and a step expected to cost more than
 *     the whole cap starts alone (secaudit 2026-09, A6-11).
 *   v1.4.2 -- 2026-09-26 -- The definition's text says an ai step starts only when what it is
 *     expected to cost fits in what is left of maxCostUsd (secaudit 2026-09, A6-11).
 *   v1.4.1 -- 2026-09-26 -- maxCostUsd counts the judging of a run's llm signals too (secaudit
 *     2026-09, A6-11); the definition's text says so.
 *   v1.4.0 -- 2026-09-25 -- workflow_save's definition names maxCostUsd, the per-run cap on what a
 *     run's ai steps spend; the route's `warnings` reach the caller with the rest of its answer.
 *   v1.3.0 -- 2026-09-06 -- workflow_answer takes workflow_id + picks/other. It sent { answer } at a
 *     route reading { picks, other }, so every human-input answer given through this door left the
 *     run parked -- the same broken shape the CLI dispatch carried.
 *   v1.2.0 -- 2026-08-30 -- workflow_run forwards `vars` and `target`, which the route has always
 *     read and none of the three tool surfaces sent. Without vars a workflow that takes input runs
 *     at its defaults, which makes it a constant.
 *   v1.1.0 -- 2026-07-19 -- Add workflow_answer + workflow_pending_inputs (human-input steps).
 *   v1.0.0 -- 2026-06-13 -- Close the connector-surface gap for workflow_save/get/run.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';

export function registerWorkflowTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  mcp.tool('aimeat_workflow_save', descriptionFor('aimeat_workflow_save'), {
    id: z.string().describe('Workflow id (lowercase slug); existing id = update.'),
    definition: z.record(z.string(), z.unknown()).describe('The workflow descriptor: { title, description, trigger, vars[], steps[], on_step_fail:"inspect", llm?{approved}, maxCostUsd? }. Validated against the offer contract + DAG on save. maxCostUsd (US dollars, per run) caps what a run spends on AI, its ai steps and the judging of its llm signals together: an ai step\'s model call starts only when what one attempt is expected to cost fits in what is left, and holds that share until the call answers, also after a timeout or a retry; otherwise the step waits for the open calls or stops the run. A step expected to cost more than the whole cap starts alone while the run has spent less.'),
  }, annotationsFor('aimeat_workflow_save'), async ({ id, definition }) => {
    return out(await client.put(`/v1/workflows/${encodeURIComponent(id)}`, definition as Record<string, unknown>));
  });

}
