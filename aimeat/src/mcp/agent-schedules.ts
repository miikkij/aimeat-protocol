/**
 * @file agent-schedules.ts
 * @description MCP tools letting an agent create and manage its own recurring
 *   schedules (the server owns the clock — these persist ScheduledJobRecords and
 *   register them on the live cron via the active Scheduler). Kinds:
 *     - ai         : server-side OpenRouter completion over predefined memory keys
 *     - agent_task : materialise a task into the agent's own queue each fire
 *     - extension  : run an installed extension action (zero-token)
 *   Plus aimeat_schedule_report_internal, which writes the agent's self-reported
 *   internal scheduler mirror (agents.<name>.scheduler) for display in the UI.
 * @structure
 *   - registerAgentScheduleTools() — registers the schedule tools on an McpServer
 * @usage
 *   import { registerAgentScheduleTools } from './agent-schedules.js';
 *   registerAgentScheduleTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
 *   v1.0.0 — 2026-06-03 — Initial: agent-created recurring schedules + internal mirror
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, ScheduledJobRecord } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { parseGAII, buildGAII } from '../utils/gaii.js';
import { getActiveScheduler } from '../services/scheduler.js';
import { mergeConstraintDefaults } from '../services/schedule-constraints.js';
import { emitChange } from '../services/event-bus.js';
import { checkScheduleGate } from '../services/schedule-gate.js';

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

      // The same gate POST /v1/schedules applies (services/schedule-gate.ts). This tool applied
      // none of it: any kind for any caller, and any string as a cron. An MCP session is an agent,
      // never an owner session, so the per-kind scope is checked rather than bypassed.
      const gateRefusal = checkScheduleGate(
        { kind: a.kind, cron: a.cron, timezone: a.timezone },
        { isOwnerSession: false, scopes: sessionScopes },
      );
      if (gateRefusal) return err(`${gateRefusal.code}: ${gateRefusal.message}`);

      const now = new Date().toISOString();
      const id = randomUUID();
      const targetName = a.kind === 'agent_task' ? (a.target_agent ?? selfName) : selfName;
      const targetGaii = buildGAII(targetName, owner, config.nodeId);
      const targetAgent = await storage.getAgent(targetGaii);
      if (a.kind === 'agent_task' && !targetAgent) return err(`Target agent "${targetName}" not found under this owner`);

      const record: ScheduledJobRecord = {
        id,
        name: `schedule:${id}`,
        type: a.kind,
        cron: a.cron,
        enabled: true,
        createdBy: agentGaii,
        createdAt: now,
        updatedAt: now,
        ownerScope,
        agentName: targetName,
        agentGaii: targetGaii,
        createdByAgent: true,
        displayName: a.display_name.slice(0, 200),
        description: a.description,
        purpose: a.purpose,
        timezone: a.timezone,
        runCount: 0,
        constraints: mergeConstraintDefaults(undefined, targetAgent?.scheduleConstraintDefaults),
      };

      if (a.kind === 'ai') {
        if (!a.prompt) return err('prompt is required for ai schedules');
        record.input = {
          inputKeys: a.input_keys ?? [], prompt: a.prompt,
          systemPrompt: a.system_prompt, model: a.model,
          outputKey: a.output_key, outputVisibility: 'private',
        };
      } else if (a.kind === 'agent_task') {
        if (!a.task_title) return err('task_title is required for agent_task schedules');
        record.input = { taskTemplate: { title: a.task_title, description: a.task_description ?? '' } };
      } else if (a.kind === 'extension') {
        if (!a.extension_name || !a.action_id) return err('extension_name and action_id are required for extension schedules');
        const ext = await storage.getExtension(a.extension_name);
        if (!ext) return err(`Extension "${a.extension_name}" not found`);
        record.extensionName = a.extension_name;
        record.actionId = a.action_id;
      }

      const created = await storage.createScheduledJob(record);
      getActiveScheduler()?.addJob(created);
      emitChange('scheduler');
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
      const job = await storage.getScheduledJob(a.schedule_id);
      if (!job || job.ownerScope !== ownerScope || !job.createdByAgent) return err('Schedule not found or not yours to manage');
      const updates: Partial<ScheduledJobRecord> = { updatedAt: new Date().toISOString() };
      if (typeof a.enabled === 'boolean') updates.enabled = a.enabled;
      if (typeof a.cron === 'string') updates.cron = a.cron;
      if (typeof a.timezone === 'string') updates.timezone = a.timezone;
      if (typeof a.display_name === 'string') updates.displayName = a.display_name.slice(0, 200);
      await storage.updateScheduledJob(a.schedule_id, updates);
      await getActiveScheduler()?.reschedule(a.schedule_id);
      emitChange('scheduler');
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
      const job = await storage.getScheduledJob(a.schedule_id);
      if (!job || job.ownerScope !== ownerScope || !job.createdByAgent) return err('Schedule not found or not yours to manage');
      getActiveScheduler()?.removeJob(a.schedule_id);
      await storage.deleteScheduledJob(a.schedule_id);
      emitChange('scheduler');
      return text({ deleted: a.schedule_id });
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
      const existing = await storage.getMemory(agentGaii, key);
      await storage.setMemory({
        key, ownerGaii: agentGaii,
        value: { version: 1, updatedAt: now, entries },
        visibility: 'owner', tags: ['scheduler', 'internal'], ttlHours: null,
        version: existing ? existing.version + 1 : 1,
        createdAt: existing?.createdAt ?? now, updatedAt: now,
      });
      emitChange('scheduler');
      return text({ reported: true, count: entries.length, key });
    },
  );
}
