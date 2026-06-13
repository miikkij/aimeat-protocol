/**
 * @file workflows.ts
 * @description MCP tools letting an agent author + operate Agent Workflows (declared, ordered agent
 *   pipelines with per-step input/output signals). Deliberately TIGHT — three tools: save, get,
 *   run. The full descriptor is passed as one `definition` object (validated server-side against the
 *   offer contract + DAG), so the surface stays small as the descriptor grows. Workflows belong to
 *   the owner (shared across their agents); an agent needs the `workflow:write` scope to author.
 * @structure registerWorkflowTools(mcp, storage, config, getAgentGaii)
 * @usage import { registerWorkflowTools } from './workflows.js';
 *   registerWorkflowTools(mcp, storage, config, () => agentGaii);
 * @version-history
 *   v1.0.0 — 2026-06-13 — Phase 8: tight MCP surface (save/get/run) for agent-authored workflows.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { parseGAII } from '../utils/gaii.js';
import { getActiveScheduler } from '../services/scheduler.js';
import { getActiveWorkflowEngine } from '../services/workflow/engine.js';
import {
  saveWorkflow, getWorkflow, listWorkflows, listRuns, validateWorkflow, buildBlueprint,
} from '../services/workflow/store.js';
import { syncWorkflowTriggers } from '../services/workflow/lifecycle.js';

export function registerWorkflowTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
): void {
  const agentGaii = getAgentGaii();
  const owner = parseGAII(agentGaii)?.owner ?? '';
  const ownerGhii = `${owner}@${config.nodeId}`;

  const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
  const err = (msg: string) => ({ content: [{ type: 'text' as const, text: msg }], isError: true });

  // ── aimeat_workflow_save ──
  mcp.tool(
    'aimeat_workflow_save',
    descriptionFor('aimeat_workflow_save'),
    {
      id: z.string().describe('Workflow id (lowercase slug). Creating with an existing id updates it.'),
      definition: z.record(z.string(), z.unknown()).describe('The workflow descriptor: { title, description (both localized string | {locale:text}), trigger {kind:"schedule"|"manual"|"event", cron?, timezone?, on?, match?}, vars[], steps[{id, agent, offer, after?, description, required_to_function?, success_signal?, retry?, timeout_min}], on_step_fail:"inspect", llm?{approved} }. Signals/deliverable.location are inherited from each step\'s offer; a step using an `llm` signal leaf requires llm.approved=true. Rejected if the graph is not a DAG or an offer is not workflow-compatible.'),
    },
    annotationsFor('aimeat_workflow_save'),
    async (a) => {
      if (!owner) return err('Could not resolve caller owner');
      const result = await saveWorkflow(storage, config, ownerGhii, owner, a.id, a.definition, agentGaii);
      if (!result.ok) return err(`Validation failed:\n- ${(result.errors ?? []).join('\n- ')}`);
      const scheduler = getActiveScheduler();
      if (scheduler) await syncWorkflowTriggers(storage, scheduler, config.nodeId, result.def!, ownerGhii, agentGaii);
      return text({ saved: true, id: a.id, trigger: result.def!.trigger.kind, steps: result.def!.steps.length });
    },
  );

  // ── aimeat_workflow_get ──
  mcp.tool(
    'aimeat_workflow_get',
    descriptionFor('aimeat_workflow_get'),
    {
      id: z.string().optional().describe('Omit to list all your workflows; pass an id for its definition + derived blueprint + recent runs.'),
    },
    annotationsFor('aimeat_workflow_get'),
    async (a) => {
      if (!a.id) {
        const defs = await listWorkflows(storage, ownerGhii);
        return text({ workflows: defs.map(d => ({ id: d.id, trigger: d.trigger.kind, steps: d.steps.length })), count: defs.length });
      }
      const def = await getWorkflow(storage, ownerGhii, a.id);
      if (!def) return err(`Workflow "${a.id}" not found`);
      const v = await validateWorkflow(storage, config, owner, def);
      const blueprint = v.ok && v.resolved ? buildBlueprint(def, v.resolved) : { stale: true, errors: v.errors };
      const runs = (await listRuns(storage, ownerGhii, a.id)).slice(0, 5)
        .map(r => ({ runId: r.runId, status: r.status, mode: r.mode, startedAt: r.startedAt }));
      return text({ definition: def, blueprint, recentRuns: runs });
    },
  );

  // ── aimeat_workflow_run ──
  mcp.tool(
    'aimeat_workflow_run',
    descriptionFor('aimeat_workflow_run'),
    {
      id: z.string().describe('The workflow id.'),
      mode: z.enum(['signals-only', 'full']).describe('signals-only = evaluate every step\'s signals against existing memory (no dispatch — an instant health check); full = execute the steps live.'),
    },
    annotationsFor('aimeat_workflow_run'),
    async (a) => {
      const engine = getActiveWorkflowEngine();
      if (!engine) return err('Workflow engine not started');
      const result = await engine.startRun(ownerGhii, owner, a.id, { mode: a.mode === 'full' ? 'full-live' : 'signals-only' });
      if ('error' in result) return err(`Could not start run:\n- ${result.error.join('\n- ')}`);
      // For signals-only the run completes synchronously — return the per-step verdicts inline.
      if (a.mode === 'signals-only') {
        const runs = await listRuns(storage, ownerGhii, a.id);
        const run = runs.find(r => r.runId === result.runId);
        const steps = run ? Object.fromEntries(Object.entries(run.steps).map(([k, s]) => [k, s.state])) : {};
        return text({ runId: result.runId, status: run?.status, steps });
      }
      return text({ runId: result.runId, mode: 'full', note: 'Dispatched; poll aimeat_workflow_get for run status.' });
    },
  );
}
