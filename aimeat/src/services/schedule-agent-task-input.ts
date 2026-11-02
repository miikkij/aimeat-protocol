/**
 * @file src/services/schedule-agent-task-input.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The stored input of an agent_task schedule, built from the create body: the task it
 *   queues on every fire (`taskTemplate`). Moved out of services/schedule-write.ts unchanged, which had
 *   reached its 800 lines, when the delivery setting needed two more there.
 * @structure agentTaskInput(body)
 * @usage const built = agentTaskInput(body); if (!built.ok) return refusal; base.input = built.input;
 * @version-history
 *   v1.0.0 — 2026-11-02 — Moved out of schedule-write.ts createScheduleRecord with its behaviour unchanged.
 */
import type { AgentTaskScope } from '../storage/interface.js';

/** The agent_task input, or the refusal when the task has no title. */
export function agentTaskInput(body: Record<string, unknown>):
  { ok: true; input: Record<string, unknown> } | { ok: false; message: string } {
  // Accept either nested task_template.{title,description} or flat
  // task_title / task_description (mirrors the MCP tool's flat fields).
  const tmpl = body.task_template as Record<string, unknown> | undefined;
  const title = (tmpl && typeof tmpl.title === 'string' ? tmpl.title : '')
    || (typeof body.task_title === 'string' ? body.task_title : '');
  if (!title) return { ok: false, message: 'task_template.title (or task_title) is required for agent_task schedules' };
  const v = (tmpl?.verification ?? {}) as { user_expects?: string; technical_checks?: string[] };
  const flatDesc = typeof body.task_description === 'string' ? body.task_description : '';
  return {
    ok: true,
    input: {
      taskTemplate: {
        title,
        description: typeof tmpl?.description === 'string' ? tmpl.description : flatDesc,
        scope: Array.isArray(tmpl?.scope) ? (tmpl!.scope as AgentTaskScope[]) : [],
        rules: Array.isArray(tmpl?.rules) ? tmpl!.rules : [],
        verification: {
          userExpects: typeof v.user_expects === 'string' ? v.user_expects : '',
          technicalChecks: Array.isArray(v.technical_checks) ? v.technical_checks : [],
        },
        resources: tmpl?.resources,
        // The node hands each finished task's result to the owner (services/task-result-delivery.ts).
        ...(body.deliver === 'owner' ? { deliver: 'owner' } : {}),
      },
    },
  };
}
