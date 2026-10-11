/**
 * @file src/services/agent-first-run.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one task a new agent gets the moment it is made, so its owner sees that it works
 *   and has a first result to look at.
 *
 *   WHY EVERY NEW AGENT RUNS ONCE (Jouni, 2026-10-11: "when the agent is created its task should
 *   always run once, to see that it works and to get the structure"). An agent that works on a
 *   clock would otherwise show nothing until its first hour comes, and one that works when asked
 *   shows nothing at all; in both cases a person cannot tell a working agent from a broken one, and
 *   nothing that reads the agent's results (the app offer on the home, an app built on its work)
 *   has a result to read.
 *
 *   WHAT THE TASK SAYS. The agent's display name as the title and its purpose as the description,
 *   which is word for word what a clock agent's schedule gives it (public/js/services/agent-draft.js
 *   scheduleFor). So the first run is the agent's ordinary work done once now, never a separate
 *   test prompt whose result would look different from every later one.
 *
 *   It is created through the task service, so it starts, waits or is refused by the same rules as
 *   any task: an agent whose computer is away gets it when the computer connects.
 * @structure FIRST_RUN_KIND · giveFirstRun
 * @usage const run = await giveFirstRun({ storage, config }, { agentGaii, displayName, purpose, creator, actor });
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial (decision "From an agent to an app", ruling 2).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { FileRefAccessor } from './file-refs.js';
import { createTask } from './agent-task-write.js';
import { logger } from '../utils/logger.js';

/** The scope value that marks the task, so a page can call it the first run. */
export const FIRST_RUN_KIND = 'first-run';

export type FirstRunResult =
  | { ok: true; task_id: string; started: boolean }
  | { ok: false; code: string; message: string };

/**
 * Give a newly made agent its work once. Never throws: the agent exists whatever happens here, and
 * the caller reports a failure as a fact about the first run, not about the approval.
 */
export async function giveFirstRun(
  deps: { storage: Storage; config: AimeatConfig },
  args: { agentGaii: string; displayName: string; purpose: string; creator: FileRefAccessor; actor: string },
): Promise<FirstRunResult> {
  try {
    const agent = await deps.storage.getAgent(args.agentGaii);
    if (!agent) return { ok: false, code: 'AGENT_NOT_FOUND', message: 'The agent record could not be read back.' };
    const out = await createTask(deps, {
      agent,
      agentGaii: args.agentGaii,
      agentName: agent.name,
      creator: args.creator,
      actor: args.actor,
      body: {
        title: args.displayName.slice(0, 256) || agent.name,
        description: args.purpose,
        scope: [{
          name: 'kind', value: FIRST_RUN_KIND, type: 'text',
          description: 'The run a new agent makes once, so its owner sees that it works.',
        }],
      },
    });
    if (!out.ok) return { ok: false, code: out.code, message: out.message };
    return { ok: true, task_id: out.task.id, started: out.deduplicated ? false : out.autoActivated };
  } catch (err) {
    logger.error('giving a new agent its first run failed', { agent: args.agentGaii, error: String(err) });
    return { ok: false, code: 'FIRST_RUN_FAILED', message: 'The first run could not be created.' };
  }
}
