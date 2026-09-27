/**
 * @file src/services/db/agent-messages-overview-db-service.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Purpose-built Application DB Service for the agent-card **Messages** subtab — the ONE call
 *   behind GET /v1/agents/:name/messages/overview. The subtab mounted three requests: the agent's command
 *   palette (a memory read), the thread list (with per-thread task-title enrichment), and the message
 *   history (page 1). This composes all three in one read scope. Single-master: the Messages subtab mount
 *   only. The individual endpoints stay for interactive re-fetch (thread switch, send, live-update).
 *
 * @structure AgentMessagesOverviewService.overview(agentGaii, agentName, opts?) → { commands, threads, messages }
 * @usage const ov = await createAgentMessagesOverviewService(storage).overview(agentGaii, agentName);
 * @version-history
 *   v1.0.0 — 2026-07-16 — Phase 4: fold the Messages subtab's commands + threads + messages reads into one.
 */
import type { Storage } from '../../storage/interface.js';
import { runInReadScope } from '../../storage/read-scope/read-scope.js';
import { enrichThreadTitles } from '../thread-titles.js';

export interface AgentMessagesOverview {
  commands: unknown;
  threads: Array<Record<string, unknown>>;
  messages: { messages: unknown[]; total: number; page: number; per_page: number };
}

export class AgentMessagesOverviewService {
  constructor(private readonly storage: Storage) {}

  /**
   * The Messages subtab mount for one agent in a single read scope. Threads are enriched with their linked
   * task's title (task-based threads use the task id as threadId), mirroring GET /messages/threads exactly;
   * the message page mirrors GET /messages (page 1). Commands come from the agent-authored
   * `agents.{name}.commands` memory key (its own GAII namespace).
   */
  overview(agentGaii: string, agentName: string, opts: { perPage?: number } = {}): Promise<AgentMessagesOverview> {
    const perPage = Math.min(100, Math.max(1, opts.perPage ?? 20));

    return runInReadScope(async () => {
      const [commandsRec, threads, msgResult] = await Promise.all([
        this.storage.getMemory(agentGaii, `agents.${agentName}.commands`),
        this.storage.listThreads(agentGaii),
        this.storage.listMessages(agentGaii, { page: 1, perPage }),
      ]);

      const enriched = await enrichThreadTitles(this.storage, threads);

      return {
        commands: commandsRec?.value ?? [],
        threads: enriched,
        messages: { messages: msgResult.messages, total: msgResult.total, page: 1, per_page: perPage },
      };
    });
  }
}

/** Assemble the Messages subtab composite over the given storage. */
export function createAgentMessagesOverviewService(storage: Storage): AgentMessagesOverviewService {
  return new AgentMessagesOverviewService(storage);
}
