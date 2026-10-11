/**
 * @file agent-integration.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Agent inbox and integration kit endpoints.
 *   Provides a consolidated view of pending work for agents and a machine-readable
 *   integration kit describing how to interact with the task system.
 *
 *   THERE IS NO LONG POLL HERE ANY MORE. GET /v1/agents/:name/tasks/wait was written on 2026-05-21
 *   and answered 404 from that day: GET /v1/agents/:name/tasks/:id is registered first and read
 *   `wait` as a task id. Nobody reported it in five months, because new work reaches a runtime over
 *   the connector socket or a webhook, and a runtime with neither reads this inbox. It was removed
 *   on 2026-10-11 on the developer's word rather than repaired: a third way to wake an agent would
 *   need every rule about waking one written into it as well (services/agent-stop-rules.ts).
 * @structure
 *   - GET /v1/agents/:name/inbox            -- Consolidated inbox
 *   - GET /v1/agents/:name/integration-kit  -- Full integration kit JSON
 * @version-history
 *   v1.3.0 -- 2026-10-11 -- GET /v1/agents/:name/tasks/wait removed: unreachable since it was added, and
 *     the inbox answer no longer points at it.
 *   v1.2.0 -- 2026-10-11 -- A stopped agent's own /inbox carries only active tasks and says
 *     `agent_stopped` (services/agent-stop-rules.ts).
 *   v1.1.1 -- 2026-10-05 -- The account holder in person is asked with isOwnerInPerson (utils/gaii.ts; secaudit 2026-10, C4).
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 *   v1.1.0 -- 2026-05-23 -- Add cursor-based ?since= and ?limit= to inbox endpoint
 */

import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { refuseNotYours } from '../middleware/refusals.js';
import { requireAuth } from '../auth/middleware.js';
import { agentGaiiFromIdentifier, isOwnerInPerson, resolveIdentity } from '../utils/gaii.js';
import { isStopped } from '../services/agent-stop-rules.js';

/* ── Cursor helpers for inbox pagination ── */

interface ParsedCursor {
  timestamp: string;
  tiebreaker: string;
}

function parseCursor(since: string): ParsedCursor | null {
  const atIdx = since.lastIndexOf('@');
  if (atIdx === -1) return null;
  const timestamp = since.substring(0, atIdx);
  const tiebreaker = since.substring(atIdx + 1);
  if (!timestamp || !tiebreaker) return null;
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return null;
  return { timestamp, tiebreaker };
}

function buildCursor(timestamp: string, id: string): string {
  return `${timestamp}@${id.substring(0, 12)}`;
}

/** Max age for cursors (90 days in milliseconds) */
const CURSOR_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export function agentIntegrationRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /** Build GAII for the named agent under the authenticated owner */
  function resolveAgentGaii(req: Express.Request, agentName: string): string {
    const owner = req.auth!.owner as string;
    return agentGaiiFromIdentifier(agentName, owner, config.nodeId);
  }

  /** Check if the caller is allowed to access this agent's data */
  function canAccessAgent(req: Express.Request, agentName: string): boolean {
    if (isOwnerInPerson(req.auth)) return true; // Owners can access all their agents
    // Agent session -- must be the named agent
    const expectedGaii = resolveAgentGaii(req, agentName);
    return req.auth!.sub === expectedGaii;
  }

  /* ── GET /v1/agents/:name/inbox -- Consolidated inbox ── */
  router.get('/v1/agents/:name/inbox', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;

    if (!canAccessAgent(req, agentName)) {
      res.status(403).json(refuseNotYours(config, { thing: 'agent', action: 'use', listUrl: '/v1/agents' }));
      return;
    }

    const agentGaii = resolveAgentGaii(req, agentName);

    // Verify agent exists
    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }

    // Parse limit (default 50, max 200)
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string || '50', 10)));

    // Parse optional cursor
    const sinceParam = req.query.since as string | undefined;
    let cursor: ParsedCursor | null = null;

    if (sinceParam) {
      cursor = parseCursor(sinceParam);
      if (!cursor) {
        res.status(400).json(error(config.nodeId, 'INVALID_CURSOR', 'Malformed cursor. Expected format: {ISO timestamp}@{id_prefix}'));
        return;
      }

      // Check if cursor is older than 90 days
      const cursorAge = Date.now() - new Date(cursor.timestamp).getTime();
      if (cursorAge > CURSOR_MAX_AGE_MS) {
        res.status(400).json(error(config.nodeId, 'PRUNED_CURSOR', 'Cursor expired. Omit ?since to perform full sync.'));
        return;
      }
    }

    // Fetch queued and active tasks + pending messages. A stopped agent reading its OWN inbox gets
    // only the work it is already doing: queued tasks and unread messages wait until it is started
    // (services/agent-stop-rules.ts). The owner, or a sibling agent, reading the same inbox sees all of it.
    const held = isStopped(agent) && resolveIdentity(req.auth!, config.nodeId) === agentGaii;
    const [queuedResult, activeResult, pendingMessages] = await Promise.all([
      held ? { tasks: [] as Awaited<ReturnType<typeof storage.listAgentTasks>>['tasks'] } : storage.listAgentTasks(agentGaii, { status: 'queued', perPage: limit }),
      storage.listAgentTasks(agentGaii, { status: 'active', perPage: limit }),
      held ? [] : storage.listPendingMessages(agentGaii),
    ]);

    // Build unified inbox items with a common timestamp and id for cursor logic
    interface InboxItem {
      type: 'queued_task' | 'active_task' | 'pending_message';
      id: string;
      timestamp: string;
      data: Record<string, unknown>;
    }

    const allItems: InboxItem[] = [];

    for (const t of queuedResult.tasks) {
      allItems.push({
        type: 'queued_task',
        id: t.id,
        timestamp: t.createdAt,
        data: t as unknown as Record<string, unknown>,
      });
    }
    for (const t of activeResult.tasks) {
      allItems.push({
        type: 'active_task',
        id: t.id,
        timestamp: t.createdAt,
        data: t as unknown as Record<string, unknown>,
      });
    }
    for (const m of pendingMessages) {
      allItems.push({
        type: 'pending_message',
        id: m.id,
        timestamp: m.createdAt,
        data: {
          id: m.id,
          thread_id: m.threadId,
          preview: m.content.substring(0, 100),
          from: m.senderGaii,
          created_at: m.createdAt,
        },
      });
    }

    // Sort by timestamp ascending (oldest first) for consistent cursor ordering
    allItems.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    // Apply cursor filter if provided
    let filteredItems = allItems;
    let cursorStatus: 'exact' | 'approximate' = 'exact';

    if (cursor) {
      const cursorTs = cursor.timestamp;
      const cursorTb = cursor.tiebreaker;

      // Filter to items strictly after the cursor timestamp,
      // or same timestamp but different from the cursor tiebreaker
      filteredItems = allItems.filter(item => {
        if (item.timestamp > cursorTs) return true;
        if (item.timestamp === cursorTs) {
          // Same timestamp: exclude items at or before the tiebreaker position
          return item.id.substring(0, 12) > cursorTb;
        }
        return false;
      });

      // Check if tiebreaker matches any known event
      const tiebreakerMatches = allItems.some(
        item => item.id.substring(0, 12) === cursorTb
      );
      if (!tiebreakerMatches) {
        cursorStatus = 'approximate';
      }
    }

    // Apply limit
    const paginatedItems = filteredItems.slice(0, limit);
    const hasMore = filteredItems.length > limit;

    // Build next_cursor from last item, or echo the input cursor if no new items
    let nextCursor: string;
    if (paginatedItems.length > 0) {
      const lastItem = paginatedItems[paginatedItems.length - 1];
      nextCursor = buildCursor(lastItem.timestamp, lastItem.id);
    } else if (sinceParam) {
      nextCursor = sinceParam;
    } else {
      // Initial sync with no items -- use current time as cursor
      nextCursor = buildCursor(new Date().toISOString(), '000000000000');
    }

    // Separate back into typed arrays for response
    const queuedTasks = paginatedItems
      .filter(i => i.type === 'queued_task')
      .map(i => i.data);
    const activeTasks = paginatedItems
      .filter(i => i.type === 'active_task')
      .map(i => i.data);
    const messages = paginatedItems
      .filter(i => i.type === 'pending_message')
      .map(i => i.data);

    res.json(success(config.nodeId, {
      items: paginatedItems.map(i => i.data),
      queued_tasks: queuedTasks,
      active_tasks: activeTasks,
      pending_messages: messages,
      next_cursor: nextCursor,
      cursor_status: cursorStatus,
      has_more: hasMore,
      // Why a stopped agent's own inbox has no waiting task and no message. A runtime that lists
      // neither tasks nor messages reads its state from this one field.
      ...(held ? { agent_stopped: true } : {}),
    }, [
      { description: 'View integration kit', method: 'GET', url: `/v1/agents/${agentName}/integration-kit` },
    ]));
  });

  /* ── GET /v1/agents/:name/integration-kit -- Full integration kit JSON ── */
  router.get('/v1/agents/:name/integration-kit', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;

    if (!canAccessAgent(req, agentName)) {
      res.status(403).json(refuseNotYours(config, { thing: 'agent', action: 'use', listUrl: '/v1/agents' }));
      return;
    }

    const agentGaii = resolveAgentGaii(req, agentName);

    // Verify agent exists
    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }

    const kit = {
      agent_name: agentName,
      agent_gaii: agentGaii,
      node_url: config.baseUrl,
      node_id: config.nodeId,
      watchdog_spec: {
        poll_interval_seconds: 60,
        // How many tasks the runner may process concurrently. 1 = serial
        // (safe for any engine); >1 requires an engine with a per-task
        // liaison/worker pool (e.g. a CrewAI daemon). Owner-configurable.
        max_concurrent_tasks: agent.maxConcurrentTasks ?? 1,
        inbox_endpoint: `/v1/agents/${agentName}/inbox`,
        task_event_endpoint: `/v1/agents/${agentName}/tasks/{id}/event`,
        task_todo_endpoint: `/v1/agents/${agentName}/tasks/{id}/todos/{todoId}`,
        task_complete_endpoint: `/v1/agents/${agentName}/tasks/{id}/complete`,
        task_fail_endpoint: `/v1/agents/${agentName}/tasks/{id}/fail`,
      },
      error_protocol: {
        max_retries: 3,
        backoff_seconds: [5, 30, 120],
        report_endpoint: `/v1/agents/${agentName}/tasks/{id}/fail`,
      },
      directives_endpoint: `/v1/agents/${agentName}/directives`,
    };

    res.json(success(config.nodeId, { kit }));
  });

  return router;
}
