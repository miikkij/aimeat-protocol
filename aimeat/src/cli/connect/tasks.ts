/**
 * @file tasks.ts
 * @description CLI subcommand: list assigned tasks
 * @structure Loads connector credentials, fetches agent tasks, and prints them as JSON.
 * @usage Called by `aimeat connect tasks`.
 * @version-history v1.9.4 — 2026-05-28 — Handle missing config and request failures without stack traces.
 */
import { AimeatClient } from './api-client.js';
import { loadConfig } from './config.js';

export async function runTasks(): Promise<void> {
  try {
    const client = await AimeatClient.fromConfig();
    const config = loadConfig()!;
    const resp = await client.get(`/v1/agents/${encodeURIComponent(config.agent)}/tasks`);
    if (!resp.ok) {
      console.error('Failed to fetch tasks:', resp.error);
      process.exitCode = 1;
      return;
    }
    const tasks = (resp.data as { tasks?: unknown[] })?.tasks ?? [];
    if (tasks.length === 0) { console.log('No tasks.'); return; }
    console.log(JSON.stringify(tasks, null, 2));
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  }
}
