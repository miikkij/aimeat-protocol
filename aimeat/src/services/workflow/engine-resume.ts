/**
 * @file src/services/workflow/engine-resume.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The boot re-sync of in-flight workflow runs. Moved unchanged out of engine.ts
 *   (WorkflowEngine.resumeInflight) on 2026-10-20 to stay under max-file-lines; the engine method
 *   keeps its doc comment and calls this.
 * @structure ResumeDeps · resumeRuns(deps)
 * @usage await resumeRuns({ storage, nodeId, readActiveRuns, withLock, persist, onTaskTerminal });
 * @version-history
 *   v1.0.0 — 2026-10-20 — Moved from engine.ts, unchanged (max-file-lines).
 */
import type { Storage, AgentTaskRecord } from '../../storage/interface.js';
import { isTerminalTaskStatus } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { runKey } from './store.js';
import { clearOpenCalls } from './run-cost.js';
import type { WorkflowRun } from '../../models/workflow-schemas.js';

/**
 * What the re-sync needs of the engine: its storage, the active-run index, its run lock, its save and
 * its task-terminal advance. The index reader is handed over rather than imported, as in
 * engine-triggers.ts: lifecycle.ts reaches the scheduler, which reaches the engine.
 */
export interface ResumeDeps {
  storage: Storage;
  nodeId: string;
  readActiveRuns: (storage: Storage, nodeId: string) => Promise<Array<{ ownerGhii: string; workflowId: string; runId: string }>>;
  withLock: (runId: string, fn: () => Promise<void>) => Promise<void>;
  persist: (ownerGhii: string, run: WorkflowRun) => Promise<void>;
  onTaskTerminal: (task: AgentTaskRecord, outcome: 'done' | 'failed' | 'declined') => Promise<void>;
}

/** The body of WorkflowEngine.resumeInflight; its doc comment in engine.ts says what it does and why. */
export async function resumeRuns(deps: ResumeDeps): Promise<void> {
  const active = await deps.readActiveRuns(deps.storage, deps.nodeId);
  if (!active.length) return;
  logger.info(`WorkflowEngine: re-syncing ${active.length} in-flight run(s) after restart`);
  for (const a of active) {
    try {
      await deps.withLock(a.runId, async () => {
        const held = (await deps.storage.getMemory(a.ownerGhii, runKey(a.workflowId, a.runId)))?.value as WorkflowRun | undefined;
        if (held && clearOpenCalls(held)) await deps.persist(a.ownerGhii, held);
      });
      const rec = await deps.storage.getMemory(a.ownerGhii, runKey(a.workflowId, a.runId));
      if (!rec) continue;
      const run = rec.value as WorkflowRun;
      for (const [, rs] of Object.entries(run.steps)) {
        if (rs.state !== 'dispatched') continue;
        for (const tid of rs.taskIds ?? []) {
          const task = await deps.storage.getAgentTask(tid);
          if (task && isTerminalTaskStatus(task.status)) {
            await deps.onTaskTerminal(task, task.status as 'done' | 'failed' | 'declined'); // advances the run (re-checks all step tasks)
            break;
          }
        }
      }
    } catch (err) {
      logger.error('resumeInflight re-sync failed', { runId: a.runId, error: String(err) });
    }
  }
}
