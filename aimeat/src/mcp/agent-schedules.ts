/**
 * @file agent-schedules.ts
 * @description MCP tools letting an agent create and manage its own recurring
 *   schedules. The server owns the clock: create, update and delete go through
 *   services/schedule-write.ts, the same service the /v1/schedules routes use, which
 *   stores the record and arms it on the live Scheduler. Kinds:
 *     - ai         : server-side OpenRouter completion over predefined memory keys
 *     - agent_task : materialise a task into the agent's own queue each fire
 *     - extension  : run an installed extension action (zero-token)
 *   Plus aimeat_schedule_trigger, which runs one now so a freshly created schedule can be
 *   PROVEN rather than assumed, and aimeat_schedule_report_internal, which writes the agent's
 *   self-reported internal scheduler mirror (agents.<name>.scheduler) for display in the UI.
 * @structure
 *   - registerAgentScheduleTools() — registers the schedule tools on an McpServer
 * @usage
 *   import { registerAgentScheduleTools } from './agent-schedules.js';
 *   registerAgentScheduleTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
 *   v1.2.0 — 2026-08-13 — aimeat_schedule_trigger: run one now, through the same
 *     services/schedule-write.ts the HTTP trigger route uses. Creating a morning job from a chat
 *     was possible; proving it works before the user is told it works was not.
 *   v1.1.0 — 2026-08-11 — August 2026 audit step 8: create, update and delete go through
 *     services/schedule-write.ts, the same service POST/PATCH/DELETE /v1/schedules use. The record
 *     these tools built by hand had drifted from the route's: description and purpose were stored
 *     whole where HTTP cuts them to 2000 and 500 characters, an edit accepted any string as a cron
 *     where HTTP validates it, and a target agent that does not exist was caught for agent_task only.
 *   v1.0.0 — 2026-06-03 — Initial: agent-created recurring schedules + internal mirror
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { parseGAII } from '../utils/gaii.js';
import { emitChange } from '../services/event-bus.js';
import { createScheduleRecord, updateScheduleRecord, deleteScheduleRecord, triggerScheduleRecord } from '../services/schedule-write.js';
import type { ScheduleWriteCaller } from '../services/schedule-write.js';
import { writeMemoryRecord } from '../services/memory-write.js';

export function registerAgentScheduleTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
  _emitResourceUpdated: (agentGaii: string, uri: string) => void,
  _emitResourceListChanged: (agentGaii: string) => void,
  /** The session's own scopes, for the per-kind gate in services/schedule-gate.ts. */
  sessionScopes: string[] = [],
): void {
  const agentGaii = getAgentGaii();
  const parsed = parseGAII(agentGaii);
  const owner = parsed?.owner ?? '';
  const ownerScope = `${owner}@${config.nodeId}`;
  const selfName = agentGaii.split('#')[0];

  const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
  const err = (msg: string) => ({ content: [{ type: 'text' as const, text: msg }], isError: true });

  /**
   * This session in the terms services/schedule-write.ts speaks. An MCP session is an agent acting
   * for its owner and never an owner session, so the per-kind scope is checked rather than bypassed,
   * and everything these tools create is createdByAgent (the agent may manage its own schedules,
   * the owner may manage all of them).
   */
  const writeCaller: ScheduleWriteCaller = { owner, identity: agentGaii, isOwnerSession: false, scopes: sessionScopes };

  // ── aimeat_schedule_create ──
  mcp.tool(
    'aimeat_schedule_create',
    descriptionFor('aimeat_schedule_create'),
    {
      kind: z.enum(['ai', 'agent_task', 'extension']).describe('ai = server-side OpenRouter completion; agent_task = queue a task for this agent each fire; extension = run an installed extension action.'),
      cron: z.string().describe('Cron expression, e.g. "0 7 * * *" for 07:00 daily.'),
      display_name: z.string().describe('Human-readable label, e.g. "Morning news translation".'),
      timezone: z.string().optional().describe('IANA timezone, e.g. "Europe/Helsinki" (recommended for daily schedules).'),
      description: z.string().optional(),
      purpose: z.string().optional().describe('Why this runs (shown in the owner UI).'),
      target_agent: z.string().optional().describe('agent_task only: target agent name (defaults to yourself; must be same owner).'),
      // ai
      prompt: z.string().optional().describe('ai: the instruction applied to the input memory values.'),
      input_keys: z.array(z.string()).optional().describe('ai: owner memory keys whose values are fed in as context.'),
      system_prompt: z.string().optional(),
      model: z.string().optional(),
      output_key: z.string().optional().describe('ai: memory key to store the result (auto-generated if omitted).'),
      // agent_task
      task_title: z.string().optional().describe('agent_task: title of the task created each fire.'),
      task_description: z.string().optional().describe('agent_task: the instruction for each created task.'),
      // extension
      extension_name: z.string().optional(),
      action_id: z.string().optional(),
    },
    annotationsFor('aimeat_schedule_create'),
    async (a) => {
      if (!owner) return err('Could not resolve caller owner');

      // A schedule an agent creates is targeted at that agent by default, so it shows up in the
      // agent's own view; an agent_task may name a sibling agent under the same owner instead.
      const targetName = a.kind === 'agent_task' ? (a.target_agent ?? selfName) : selfName;

      // The write itself lives in services/schedule-write.ts, the service POST /v1/schedules calls:
      // the gate, the per-kind input checks, the record build, the store, and registering the job on
      // the live clock. The body field names below are the aliases the route already accepts, so
      // there is nothing to translate at the seam.
      const out = await createScheduleRecord({ storage, config }, writeCaller, {
        kind: a.kind,
        cron: a.cron,
        timezone: a.timezone,
        display_name: a.display_name,
        description: a.description,
        purpose: a.purpose,
        agent_name: targetName,
        prompt: a.prompt,
        input_keys: a.input_keys,
        system_prompt: a.system_prompt,
        model: a.model,
        output_key: a.output_key,
        task_title: a.task_title,
        task_description: a.task_description,
        extension_name: a.extension_name,
        action_id: a.action_id,
      });
      if (!out.ok) return err(`${out.code}: ${out.message}`);
      const created = out.schedule;
      return text({ created: true, schedule_id: created.id, kind: created.type, cron: created.cron, display_name: created.displayName });
    },
  );

  // ── aimeat_schedule_list ──
  mcp.tool(
    'aimeat_schedule_list',
    descriptionFor('aimeat_schedule_list'),
    {},
    annotationsFor('aimeat_schedule_list'),
    async () => {
      const all = await storage.listScheduledJobs({ ownerScope });
      const mine = all.filter(j => j.createdByAgent || j.agentGaii === agentGaii);
      return text({
        schedules: mine.map(j => ({
          id: j.id, display_name: j.displayName, kind: j.type, cron: j.cron, timezone: j.timezone,
          enabled: j.enabled, last_run_at: j.lastRunAt, last_run_result: j.lastRunResult,
          next_run_at: j.nextRunAt, run_count: j.runCount, created_by_agent: j.createdByAgent,
        })),
        total: mine.length,
      });
    },
  );

  // ── aimeat_schedule_update (pause/resume/edit) ──
  mcp.tool(
    'aimeat_schedule_update',
    descriptionFor('aimeat_schedule_update'),
    {
      schedule_id: z.string(),
      enabled: z.boolean().optional().describe('false = pause, true = resume.'),
      cron: z.string().optional(),
      timezone: z.string().optional(),
      display_name: z.string().optional(),
    },
    annotationsFor('aimeat_schedule_update'),
    async (a) => {
      // Same service as PATCH /v1/schedules/:id, which means an edit here is judged the way an edit
      // there is: only a schedule this agent created, and a cron expression that parses.
      const out = await updateScheduleRecord({ storage, config }, writeCaller, a.schedule_id, {
        enabled: a.enabled,
        cron: a.cron,
        timezone: a.timezone,
        display_name: a.display_name,
      });
      if (!out.ok) return err(`${out.code}: ${out.message}`);
      return text({ updated: true, schedule_id: a.schedule_id });
    },
  );

  // ── aimeat_schedule_delete (cancel) ──
  mcp.tool(
    'aimeat_schedule_delete',
    descriptionFor('aimeat_schedule_delete'),
    { schedule_id: z.string() },
    annotationsFor('aimeat_schedule_delete'),
    async (a) => {
      const out = await deleteScheduleRecord({ storage, config }, writeCaller, a.schedule_id);
      if (!out.ok) return err(`${out.code}: ${out.message}`);
      return text({ deleted: a.schedule_id });
    },
  );

  // ── aimeat_schedule_trigger (run now) ──
  // The proving step. A schedule that has never fired is a guess, so the tool that creates one is
  // worth little without the one that runs it while the caller is still there to read the result.
  mcp.tool(
    'aimeat_schedule_trigger',
    descriptionFor('aimeat_schedule_trigger'),
    { schedule_id: z.string() },
    annotationsFor('aimeat_schedule_trigger'),
    async (a) => {
      // Same service as POST /v1/schedules/:id/trigger: same manage rule, same clock, same outcome.
      const out = await triggerScheduleRecord({ storage, config }, writeCaller, a.schedule_id);
      if (!out.ok) return err(`${out.code}: ${out.message}`);
      const { code, taskId, detail } = out.outcome;
      // The outcome is relayed whole, and `succeeded` is stated rather than left to be inferred:
      // 'busy', 'limited' and 'error' all come back from a call that did not throw, and a caller
      // reading only "triggered: true" would report a working job that wrote nothing.
      return text({
        triggered: true,
        succeeded: code === 'created' || code === 'ran',
        outcome: code,
        ...(taskId ? { task_id: taskId } : {}),
        ...(detail ? { reason: detail } : {}),
        next: 'Read the key this job writes to and check it has content. That is the proof, not this reply.',
      });
    },
  );

  // ── aimeat_schedule_report_internal ──
  // Agents that run their OWN cron (outside AIMEAT) publish a structured mirror
  // so the owner can see those schedules alongside AIMEAT-managed ones.
  mcp.tool(
    'aimeat_schedule_report_internal',
    descriptionFor('aimeat_schedule_report_internal'),
    {
      entries: z.array(z.object({
        id: z.string().optional(),
        name: z.string(),
        description: z.string().optional(),
        purpose: z.string().optional(),
        cron: z.string().optional(),
        timezone: z.string().optional(),
        schedule: z.string().optional().describe('Human-readable schedule if no cron, e.g. "Every day 07:00".'),
        status: z.enum(['active', 'paused']).optional(),
        kind: z.string().optional(),
      })).describe('Your full set of internal schedules (replaces the previous report).'),
    },
    annotationsFor('aimeat_schedule_report_internal'),
    async (a) => {
      const key = `agents.${selfName}.scheduler`;
      const now = new Date().toISOString();
      const entries = a.entries.map(e => ({ id: e.id ?? randomUUID(), ...e }));
      // The mirror is a memory record, so it answers to memory's rules. Writing it straight to
      // storage meant no value-size limit, no key ceiling, no byte budget, no archive guard, no
      // schema lock and no memory change event — and the entries list is an unbounded array from the
      // caller, so the ceiling was the only thing that would ever have bounded it.
      const written = await writeMemoryRecord({ storage, config }, {
        principal: agentGaii,
        targetGaii: agentGaii,
        scopes: sessionScopes,
        roles: ['agent'],
      }, {
        key,
        value: { version: 1, updatedAt: now, entries },
        visibility: 'owner',
        tags: ['scheduler', 'internal'],
        pipeline: 'mcp.schedule_report_internal',
        ownerScoped: true,
      });
      if (!written.ok) return err(`${written.code}: ${written.message}`);
      emitChange('scheduler');
      return text({ reported: true, count: entries.length, key });
    },
  );
}
