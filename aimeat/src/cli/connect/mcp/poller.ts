/**
 * @file poller.ts
 * @description Background poller for new tasks and messages. Per-agent: each
 *   loaded agent gets its own poll loop with its own seen-id state, its own
 *   wake adapter, and its own optional task-runner hook. When a task-runner
 *   agent sees a new queued task, it launches the configured subprocess in
 *   addition to firing the wake adapter (the subprocess will post
 *   task_complete or task_fail when it finishes).
 *
 *   Recursive setTimeout (not setInterval) prevents overlapping polls if a
 *   round trip slows. Auth-style envelope errors stop only that agent's poller
 *   (a stale token for one agent should not silence the rest).
 *
 * @usage Started by `aimeat connect serve` -- one call per loaded agent.
 *   Since Phase 4 (forward tunnel) this loop is the DEGRADED-MODE fallback in
 *   the serve daemon: when an agent's tunnel is online, realtime `deliver`/
 *   `backlog` frames drive the same wake adapter + task-runner hook (see
 *   mcp/local-server.ts) and no upstream poll runs for that agent. Stdio serve
 *   (CI/serverless) still polls unconditionally.
 *
 * @version-history
 *   v1.9.4 -- 2026-05-28 -- Name-based message inbox endpoint
 *   v1.9.5 -- 2026-05-28 -- Track IDs (not counts), recursive setTimeout, surface auth failures
 *   v2.0.0 -- 2026-05-29 -- Per-agent poll loop + task-runner hook for subprocess agents
 *   v2.1.0 -- 2026-06-10 -- Export legacyWakeAdapter for the push path (Phase 4)
 */
import type { RegisteredAgent } from '../agent-registry.js';
import { wakeAgent } from './wakeup.js';
import { launchTaskRunner, isRunner } from '../task-runner.js';

interface TaskLike { id?: unknown; title?: unknown; description?: unknown }
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

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function startPollerForAgent(agent: RegisteredAgent): void {
  const interval = (agent.config.poll_interval ?? 30) * 1000;
  const enc = encodeURIComponent(agent.agent);
  const tag = `poller:${agent.agent}`;
  const runnerEnabled = isRunner(agent);

  let seenTaskIds = new Set<string>();
  let seenMessageIds = new Set<string>();
  let bootstrapped = false;
  let consecutiveFailures = 0;
  let stopped = false;

  async function pollOnce(): Promise<void> {
    let anyOk = false;

    // ---- Tasks ----
    try {
      const tasksResp = await agent.client.get(`/v1/agents/${enc}/tasks?status=queued`);
      if (tasksResp.ok) {
        anyOk = true;
        const queuedTasks = (tasksResp.data as { tasks?: TaskLike[] })?.tasks ?? [];
        const currentTaskIds = extractIds(queuedTasks);
        if (bootstrapped) {
          const newIds = diff(currentTaskIds, seenTaskIds);
          if (newIds.length > 0) {
            await wakeAgent(legacyWakeAdapter(agent), 'task_new', `${newIds.length} new task(s) queued`);

            if (runnerEnabled) {
              for (const id of newIds) {
                const task = queuedTasks.find(t => asString(t.id) === id);
                if (!task) continue;
                launchTaskRunner(agent, {
                  id,
                  title: asString(task.title),
                  description: asString(task.description),
                }).catch(err => {
                  console.error(`[${tag}] runner launch failed for ${id}: ${(err as Error).message}`);
                });
              }
            }
          }
        }
        seenTaskIds = currentTaskIds;
      } else if (tasksResp.error && AUTH_ERROR_CODES.has(tasksResp.error.code)) {
        console.error(`[${tag}] Stopped: ${tasksResp.error.code} -- ${tasksResp.error.message}. Run: aimeat connect`);
        stopped = true;
        return;
      }
    } catch (err) {
      console.error(`[${tag}] Tasks poll error: ${(err as Error).message}`);
    }

    // ---- Messages ----
    try {
      const msgResp = await agent.client.get(`/v1/agents/${enc}/messages/inbox`);
      if (msgResp.ok) {
        anyOk = true;
        const messages = (msgResp.data as { messages?: MessageLike[] })?.messages ?? [];
        const currentMessageIds = extractIds(messages);
        if (bootstrapped) {
          const newIds = diff(currentMessageIds, seenMessageIds);
          if (newIds.length > 0) {
            await wakeAgent(legacyWakeAdapter(agent), 'message_new', `${newIds.length} new message(s)`);
          }
        }
        seenMessageIds = currentMessageIds;
      } else if (msgResp.error && AUTH_ERROR_CODES.has(msgResp.error.code)) {
        console.error(`[${tag}] Stopped: ${msgResp.error.code} -- ${msgResp.error.message}. Run: aimeat connect`);
        stopped = true;
        return;
      }
    } catch (err) {
      console.error(`[${tag}] Messages poll error: ${(err as Error).message}`);
    }

    if (anyOk) {
      bootstrapped = true;
      consecutiveFailures = 0;
    } else {
      consecutiveFailures += 1;
      if (consecutiveFailures === FAILURE_NOTICE_THRESHOLD) {
        console.error(`[${tag}] ${consecutiveFailures} consecutive failed polls -- check connectivity at ${agent.client.getBaseUrl()}`);
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
  const runnerNote = runnerEnabled ? ` (task-runner: ${agent.config.runner!.command})` : '';
  console.error(`[${tag}] polling every ${agent.config.poll_interval ?? 30}s${runnerNote}`);
}

/**
 * Shim for the existing wakeAgent signature which expects `AimeatConnectConfig`.
 * Builds a minimal config from the per-agent config so wakeAgent's per-strategy
 * logic continues to work unchanged. Exported so the tunnel push path
 * (mcp/local-server.ts) fires the identical wake adapter.
 */
export function legacyWakeAdapter(agent: RegisteredAgent): import('../config.js').AimeatConnectConfig {
  return {
    agent: agent.agent,
    owner: agent.owner,
    node_url: agent.config.node_url,
    wake: agent.config.wake,
    poll_interval: agent.config.poll_interval,
  };
}
