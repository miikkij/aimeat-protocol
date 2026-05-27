/**
 * @file poller.ts
 * @description Background poller for new tasks and messages. Triggers agent wake-up.
 * @structure Polls queued tasks and pending messages, compares counts, and calls the wake-up adapter on new work.
 * @usage Started by `aimeat connect serve` after MCP server registration.
 * @version-history v1.9.4 — 2026-05-28 — Use the name-based message inbox endpoint.
 */
import type { AimeatClient } from '../api-client.js';
import type { AimeatConnectConfig } from '../config.js';
import { wakeAgent } from './wakeup.js';

let lastTaskCount = -1;
let lastMessageCount = -1;

export function startPoller(client: AimeatClient, config: AimeatConnectConfig): void {
  const interval = (config.poll_interval ?? 30) * 1000;
  const enc = encodeURIComponent(config.agent);

  async function poll() {
    try {
      const tasksResp = await client.get(`/v1/agents/${enc}/tasks?status=queued`);
      if (tasksResp.ok) {
        const tasks = (tasksResp.data as { tasks?: unknown[] })?.tasks ?? [];
        if (lastTaskCount >= 0 && tasks.length > lastTaskCount) {
          await wakeAgent(config, 'task_new', `${tasks.length - lastTaskCount} new task(s) queued`);
        }
        lastTaskCount = tasks.length;
      }

      const msgResp = await client.get(`/v1/agents/${enc}/messages/inbox`);
      if (msgResp.ok) {
        const messages = (msgResp.data as { messages?: unknown[] })?.messages ?? [];
        if (lastMessageCount >= 0 && messages.length > lastMessageCount) {
          await wakeAgent(config, 'message_new', `${messages.length - lastMessageCount} new message(s)`);
        }
        lastMessageCount = messages.length;
      }
    } catch (err) {
      console.error(`[poller] Error: ${(err as Error).message}`);
    }
  }

  poll();
  setInterval(poll, interval);
  console.error(`[poller] Polling every ${config.poll_interval ?? 30}s for tasks and messages`);
}
