/**
 * @file tasks.ts
 * @description CLI subcommand: list assigned tasks
 */
import { AimeatClient } from './api-client.js';
import { loadConfig } from './config.js';

export async function runTasks(): Promise<void> {
  const client = await AimeatClient.fromConfig();
  const config = loadConfig()!;
  const resp = await client.get(`/v1/agents/${encodeURIComponent(config.agent)}/tasks`);
  if (!resp.ok) { console.error('Failed to fetch tasks:', resp.error); return; }
  const tasks = (resp.data as { tasks?: unknown[] })?.tasks ?? [];
  if (tasks.length === 0) { console.log('No tasks.'); return; }
  console.log(JSON.stringify(tasks, null, 2));
}
