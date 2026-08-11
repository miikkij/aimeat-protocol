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
 *   v1.2.0 — 2026-07-16 — Human-in-the-loop: aimeat_workflow_pending_inputs (waiting-human roster) +
 *     aimeat_workflow_answer (relay the owner's decision to a parked step).
 *   v1.1.0 — 2026-07-06 — aimeat_workflow_save gains opt-in propose-then-confirm (propose:true →
 *     diff + single-use payload-bound confirm_token; plain saves unchanged). Server MCP only.
 *   v1.0.0 — 2026-06-13 — Phase 8: tight MCP surface (save/get/run) for agent-authored workflows.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { emitChange } from '../services/event-bus.js';
import { parseGAII } from '../utils/gaii.js';
import { getActiveScheduler } from '../services/scheduler.js';
import { getActiveWorkflowEngine, HUMAN_TIMEOUT_MIN_DEFAULT } from '../services/workflow/engine.js';
import {
  saveWorkflow, getWorkflow, listWorkflows, listRuns, getRun, validateWorkflow, buildBlueprint,
} from '../services/workflow/store.js';
import { syncWorkflowTriggers, readActiveRuns } from '../services/workflow/lifecycle.js';
import { mintConfirmToken, verifyConfirmToken, ConfirmTokenError } from '../services/operator-confirm.js';

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
      propose: z.boolean().optional().describe('Operator flow: return a diff vs the current definition + a single-use confirm_token WITHOUT saving. Default false (direct save, unchanged behavior).'),
      confirm_token: z.string().optional().describe('Token from the propose step — applies exactly the proposed definition.'),
    },
    annotationsFor('aimeat_workflow_save'),
    async (a) => {
      if (!owner) return err('Could not resolve caller owner');

      // Operator propose-then-confirm (opt-in; plain saves stay untouched).
      if (a.propose && !a.confirm_token) {
        const current = await getWorkflow(storage, ownerGhii, a.id);
        const INPUT_FIELDS = ['title', 'description', 'trigger', 'vars', 'steps', 'on_step_fail', 'llm'] as const;
        const diff: Record<string, { from: unknown; to: unknown }> = {};
        const cur = (current ?? {}) as Record<string, unknown>;
        const next = a.definition as Record<string, unknown>;
        for (const f of INPUT_FIELDS) {
          if (JSON.stringify(cur[f] ?? null) !== JSON.stringify(next[f] ?? null)) {
            diff[f] = { from: cur[f] ?? null, to: next[f] ?? null };
          }
        }
        const token = await mintConfirmToken(agentGaii, 'workflow_save', { id: a.id, definition: a.definition });
        return text({
          mode: 'proposal',
          id: a.id,
          exists: !!current,
          diff,
          confirm_token: token,
          expires_in_seconds: 600,
          instructions: 'Show this diff to the owner. To apply EXACTLY this definition, call again with the same id + definition plus confirm_token. Any change invalidates the token.',
        });
      }
      if (a.confirm_token) {
        try {
          await verifyConfirmToken(a.confirm_token, agentGaii, 'workflow_save', { id: a.id, definition: a.definition });
        } catch (e) {
          if (e instanceof ConfirmTokenError) return err(`${e.code}: ${e.message}`);
          throw e;
        }
      }

      const result = await saveWorkflow(storage, config, ownerGhii, owner, a.id, a.definition, agentGaii);
      // routes/workflows.ts emits this on save. A workflow an agent authored did not appear in the
      // owner's list, which reads as the save having failed.
      emitChange('workflows');
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

  // ── aimeat_workflow_pending_inputs ──
  mcp.tool(
    'aimeat_workflow_pending_inputs',
    descriptionFor('aimeat_workflow_pending_inputs'),
    {},
    annotationsFor('aimeat_workflow_pending_inputs'),
    async () => {
      const active = (await readActiveRuns(storage, config.nodeId)).filter(a => a.ownerGhii === ownerGhii);
      const inputs: Array<Record<string, unknown>> = [];
      for (const a of active) {
        const run = await getRun(storage, ownerGhii, a.workflowId, a.runId);
        if (!run) continue;
        for (const step of run.defSnapshot.steps) {
          const rs = run.steps[step.id];
          if (rs?.state !== 'waiting-human' || !rs.human) continue;
          const deadline = new Date(new Date(rs.human.askedAt).getTime()
            + (step.timeout_min ?? HUMAN_TIMEOUT_MIN_DEFAULT) * 60_000).toISOString();
          inputs.push({
            workflow_id: a.workflowId, run_id: a.runId, step_id: step.id,
            question: rs.human.question, asked_at: rs.human.askedAt, deadline,
          });
        }
      }
      return text({ inputs, count: inputs.length });
    },
  );

  // ── aimeat_workflow_answer ──
  mcp.tool(
    'aimeat_workflow_answer',
    descriptionFor('aimeat_workflow_answer'),
    {
      workflow_id: z.string().describe('The workflow id.'),
      run_id: z.string().describe('The run id (from aimeat_workflow_pending_inputs).'),
      step_id: z.string().describe('The waiting step id.'),
      picks: z.array(z.string()).describe('Option ids from the pinned question (may be empty when answering with `other` alone).'),
      other: z.string().optional().describe('Free-text answer; only when the question allows it.'),
    },
    annotationsFor('aimeat_workflow_answer'),
    async (a) => {
      const engine = getActiveWorkflowEngine();
      if (!engine) return err('Workflow engine not started');
      const result = await engine.onHumanAnswer(ownerGhii, a.workflow_id, a.run_id, a.step_id, {
        picks: a.picks, other: a.other, by: agentGaii,
      });
      if (!result.ok) return err(`${result.code}: ${result.error}`);
      return text({ answered: a.step_id, run_id: a.run_id, note: 'Step green; the run advanced. Poll aimeat_workflow_get for status.' });
    },
  );
}
