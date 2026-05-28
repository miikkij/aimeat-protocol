/**
 * @file poller.ts
 * @description Background poller for new tasks and messages. Triggers agent wake-up.
 * @structure Tracks task and message IDs seen on the last poll and wakes the agent
 *   when previously-unseen IDs appear. Uses recursive setTimeout (not setInterval)
 *   so overlapping polls cannot stack up if a round trip slows down. Treats
 *   auth-style envelope errors as terminal: a stale token will never recover by
 *   polling, so the poller stops and prints a clear next step instead of silently
 *   spinning.
 * @usage Started by `aimeat connect serve` after MCP server registration.
 * @version-history v1.9.4 -- 2026-05-28 -- Use the name-based message inbox endpoint.
 * @version-history v1.9.5 -- 2026-05-28 -- Track IDs instead of counts (interleaved completes+arrivals were missed); recursive setTimeout; surface auth failures.
 */
import type { AimeatClient } from '../api-client.js';
import type { AimeatConnectConfig } from '../config.js';
import { wakeAgent } from './wakeup.js';

interface TaskLike { id?: unknown }
interface MessageLike { id?: unknown }

const AUTH_ERROR_CODES = new Set(['UNAUTHORIZED', 'INVALID_TOKEN', 'TOKEN_EXPIRED', 'FORBIDDEN']);
const FAILURE_NOTICE_THRESHOLD = 5;

function extractIds<T extends { id?: unknown }>(items: ReadonlyArray<T> | undefined): Set<string> {
  const ids = new Set<string>();
  if (!items) return ids;
  for (const item of items) {
    if (typeof item.id === 'string' && item.id) ids.add(item.id);
  }
  return ids;
}

function diff(current: Set<string>, seen: Set<string>): string[] {
  const out: string[] = [];
  for (const id of current) if (!seen.has(id)) out.push(id);
  return out;
}

export function startPoller(client: AimeatClient, config: AimeatConnectConfig): void {
  const interval = (config.poll_interval ?? 30) * 1000;
  const enc = encodeURIComponent(config.agent);

  let seenTaskIds = new Set<string>();
  let seenMessageIds = new Set<string>();
  let bootstrapped = false;
  let consecutiveFailures = 0;
  let stopped = false;

  async function pollOnce(): Promise<void> {
    let anyOk = false;

    try {
      const tasksResp = await client.get(`/v1/agents/${enc}/tasks?status=queued`);
      if (tasksResp.ok) {
        anyOk = true;
        const tasks = (tasksResp.data as { tasks?: TaskLike[] })?.tasks ?? [];
        const currentTaskIds = extractIds(tasks);
        if (bootstrapped) {
          const newIds = diff(currentTaskIds, seenTaskIds);
          if (newIds.length > 0) {
            await wakeAgent(config, 'task_new', `${newIds.length} new task(s) queued`);
          }
        }
        seenTaskIds = currentTaskIds;
      } else if (tasksResp.error && AUTH_ERROR_CODES.has(tasksResp.error.code)) {
        console.error(`[poller] Stopped: ${tasksResp.error.code} -- ${tasksResp.error.message}. Run: npx aimeat connect`);
        stopped = true;
        return;
      }
    } catch (err) {
      console.error(`[poller] Tasks poll error: ${(err as Error).message}`);
    }

    try {
      const msgResp = await client.get(`/v1/agents/${enc}/messages/inbox`);
      if (msgResp.ok) {
        anyOk = true;
        const messages = (msgResp.data as { messages?: MessageLike[] })?.messages ?? [];
        const currentMessageIds = extractIds(messages);
        if (bootstrapped) {
          const newIds = diff(currentMessageIds, seenMessageIds);
          if (newIds.length > 0) {
            await wakeAgent(config, 'message_new', `${newIds.length} new message(s)`);
          }
        }
        seenMessageIds = currentMessageIds;
      } else if (msgResp.error && AUTH_ERROR_CODES.has(msgResp.error.code)) {
        console.error(`[poller] Stopped: ${msgResp.error.code} -- ${msgResp.error.message}. Run: npx aimeat connect`);
        stopped = true;
        return;
      }
    } catch (err) {
      console.error(`[poller] Messages poll error: ${(err as Error).message}`);
    }

    if (anyOk) {
      bootstrapped = true;
      consecutiveFailures = 0;
    } else {
      consecutiveFailures += 1;
      if (consecutiveFailures === FAILURE_NOTICE_THRESHOLD) {
        console.error(`[poller] ${consecutiveFailures} consecutive failed polls -- check node connectivity at ${client.getBaseUrl()}.`);
      }
    }
  }

  async function loop(): Promise<void> {
    if (stopped) return;
    await pollOnce();
    if (stopped) return;
    setTimeout(loop, interval).unref();
  }

  loop();
  console.error(`[poller] Polling every ${config.poll_interval ?? 30}s for tasks and messages`);
}
