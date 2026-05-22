/**
 * @file work-task-bridge.ts
 * @description Auto-creates an AgentTask when a work item is accepted by an agent
 *   that has the task system enabled. Links via workTrackingCode.
 * @version-history
 *   v1.0.0 -- 2026-05-22 -- Initial creation for Agent Dashboard Phase 3
 */
import type { Storage, WorkRecord, AgentTaskRecord } from '../storage/interface.js';
import { randomUUID } from 'node:crypto';

export async function createTaskFromWork(
  storage: Storage, work: WorkRecord, providerGaii: string
): Promise<AgentTaskRecord | null> {
  // Check if agent has directives (proxy for "task system enabled")
  const directives = await storage.getAgentDirectives(providerGaii);
  if (!directives) return null;

  const action = await storage.getAction(work.actionId, providerGaii);
  const now = new Date().toISOString();

  const task: AgentTaskRecord = {
    id: randomUUID(),
    agentGaii: providerGaii,
    ownerGaii: providerGaii.split('#')[1] ?? providerGaii,
    title: `Work: ${action?.displayName ?? work.actionId}`,
    description: `Auto-created from work request ${work.trackingCode}. Requester: ${work.requesterGaii}.`,
    scope: Object.entries(work.input || {}).map(([name, value]) => ({
      name,
      value: String(value),
      type: 'text' as const,
    })),
    rules: [],
    verification: {
      userExpects: `Deliver result for work request ${work.trackingCode}`,
      technicalChecks: [`POST /v1/work/${work.trackingCode}/deliver with result`],
    },
    resources: {},
    todos: [
      {
        id: randomUUID(),
        order: 1,
        title: 'Process work request',
        description: `Execute action "${action?.displayName ?? work.actionId}" with provided inputs`,
        environment: 'agent' as const,
        verification: 'Output matches action output schema',
        status: 'pending' as const,
      },
      {
        id: randomUUID(),
        order: 2,
        title: 'Deliver result',
        description: `POST /v1/work/${work.trackingCode}/deliver with the result`,
        environment: 'aimeat' as const,
        verification: 'Work status transitions to delivered',
        status: 'pending' as const,
      },
    ],
    status: 'queued',
    workTrackingCode: work.trackingCode,
    createdAt: now,
    updatedAt: now,
  };

  return storage.createAgentTask(task);
}
