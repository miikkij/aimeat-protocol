/**
 * @file src/services/agent-task-rules.ts
 * @description The two task decisions that are the same decision whichever door the call came down.
 *
 *   Both were written out twice for a while — once in the HTTP handler and once in the MCP tool
 *   beside it — and both got there the same way: the tool was missing the rule, and the quickest
 *   repair is to paste the rule in. The copies agree today. They agree until somebody edits one.
 *
 *   AUTO-ACTIVATION is the owner's standing instruction. Setting an agent to `task-runner` is the
 *   person saying "start without asking me each time", so a queued task for such an agent flips to
 *   active and carries the same 'started' event an owner-approved task would. Which door delegated
 *   the task is not part of that instruction.
 *
 *   THE LIVE-PLAN GUARD protects work already done. The preserve step on a re-proposal keeps only
 *   todos already marked 'outdated', so proposing a second plan mid-run drops every in-progress and
 *   completed todo, their completedAt stamps included — the plan the owner approved and the record
 *   of what was finished, both gone. Mid-execution changes go through PATCH instead.
 * @structure
 *   - resolveAutoActivation() — should this queued task start on its own
 *   - canProposeTodos() — may a plan be proposed on this task right now
 *   - statusAfterProposal() — what accepting a plan does to the status
 * @usage
 *   const { autoActivated, effectiveStatus } = resolveAutoActivation(targetAgent, body.status);
 *   if (!canProposeTodos(task)) return refuse(TODO_PROPOSE_REFUSAL(task.status));
 * @version-history
 *   v1.0.0 — 2026-08-11 — Extracted after the audit's own diff was checked for duplication and both
 *     rules were found copied into the tool surface rather than shared.
 */
import type { AgentTaskRecord, AgentRecord } from '../storage/interface.js';

/**
 * Should a task created in 'queued' start immediately?
 *
 * Only for a `task-runner` agent, which is the explicit signal that the owner has pre-authorised
 * this agent to begin without per-task gating. Every other mode keeps the queued → approve → active
 * gate.
 */
export function resolveAutoActivation(
    targetAgent: Pick<AgentRecord, 'mode'> | null | undefined,
    requestedStatus: AgentTaskRecord['status'] | undefined,
): { autoActivated: boolean; effectiveStatus: AgentTaskRecord['status'] } {
    const status = requestedStatus ?? 'queued';
    const autoActivated = status === 'queued' && (targetAgent as { mode?: string } | null)?.mode === 'task-runner';
    return { autoActivated, effectiveStatus: autoActivated ? 'active' : status };
}

/** The event message both doors append when a task starts on its own. */
export const AUTO_ACTIVATED_EVENT_MESSAGE = 'Task auto-activated (agent mode: task-runner)';

/**
 * May a TODO plan be proposed on this task right now?
 *
 * Queued and revision_requested always; an ACTIVE task only while it has no live plan. A todo that
 * is not already 'outdated' is a live plan.
 */
export function canProposeTodos(task: Pick<AgentTaskRecord, 'status' | 'todos'>): boolean {
    const hasLivePlan = (task.todos ?? []).some(t => t.status !== 'outdated');
    return task.status === 'queued'
        || task.status === 'revision_requested'
        || (task.status === 'active' && !hasLivePlan);
}

/** The refusal both doors give, so the wording does not drift either. */
export function todoProposeRefusal(status: string): string {
    return `TODOs can only be proposed on queued, revision_requested, or plan-less active tasks (current: ${status})`;
}

/**
 * What a plan proposal does to the task's status.
 *
 * A revision_requested task returns to queued — the agent answered the request, so it is waiting for
 * the owner again. A queued task belonging to a task-runner agent starts on its own, for the same
 * reason as on creation: the owner already said "start without asking me each time". Everything else
 * keeps the status it had.
 *
 * Byte-identical in both doors until 2026-08-11, which is the shape that agrees today and diverges
 * the next time either is touched.
 */
export async function statusAfterProposal(
    getAgent: (gaii: string) => Promise<Pick<AgentRecord, 'mode'> | null | undefined>,
    task: Pick<AgentTaskRecord, 'status' | 'agentGaii'>,
): Promise<{ nextStatus: AgentTaskRecord['status']; autoActivated: boolean }> {
    let nextStatus: AgentTaskRecord['status'] = task.status === 'revision_requested' ? 'queued' : task.status;
    let autoActivated = false;
    if (task.status === 'queued') {
        const agent = await getAgent(task.agentGaii);
        if ((agent as { mode?: string } | null | undefined)?.mode === 'task-runner') {
            nextStatus = 'active';
            autoActivated = true;
        }
    }
    return { nextStatus, autoActivated };
}
