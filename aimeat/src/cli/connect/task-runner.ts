/**
 * @file task-runner.ts
 * @description Subprocess-based task runner for AIMEAT connector agents that
 *   are configured with a `runner` block in their per-agent config. When a
 *   queued task arrives for such an agent, the connector launches the
 *   configured executable as a subprocess, passes the task prompt + id + token
 *   via env vars, captures stdout (or a file), and posts the result back as
 *   `task_complete` (or `task_fail` on non-zero exit).
 *
 *   The subprocess is treated as a black box. Internal noise (CrewAI agent
 *   chatter, intermediate LLM calls) is intentionally NOT surfaced to AIMEAT;
 *   only the final deliverable shows up on the task. Subprocesses that want
 *   richer integration can call back to AIMEAT themselves via
 *   `aimeat connect call <tool> --json '{...}'` using the token env var the
 *   runner sets.
 *
 *   SECURITY: `runner.command` is exec'd verbatim. Same foot-gun as
 *   `wake.command` in wakeup.ts. Trust your own ~/.aimeat/ contents.
 *
 * @structure
 *   - `isRunner(agent)` -- does this agent have runner config?
 *   - `launchTaskRunner(agent, task)` -- spawn subprocess, capture output, post result
 *   - In-flight task tracking prevents the same task being launched twice while
 *     the previous subprocess is still alive.
 *
 * @version-history
 *   v1.0.0 -- 2026-05-29 -- Initial subprocess task runner
 */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import type { RegisteredAgent } from './agent-registry.js';
import { logger } from '../../utils/logger.js';

const SUMMARY_MAX_BYTES = 64 * 1024;
const STDERR_MAX_BYTES = 8 * 1024;
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_SECONDS = 3600;

const inFlight = new Map<string, Set<string>>(); // agentName -> Set<taskId>

function markInFlight(agentName: string, taskId: string): boolean {
  if (!inFlight.has(agentName)) inFlight.set(agentName, new Set());
  const set = inFlight.get(agentName)!;
  if (set.has(taskId)) return false;
  set.add(taskId);
  return true;
}

function clearInFlight(agentName: string, taskId: string): void {
  inFlight.get(agentName)?.delete(taskId);
}

export function isRunner(agent: RegisteredAgent): boolean {
  return !!agent.config.runner?.command;
}

export interface TaskRunnerInput {
  id: string;
  title?: string;
  description?: string;
}

function buildPrompt(task: TaskRunnerInput): string {
  const title = task.title?.trim() ?? '';
  const desc = task.description?.trim() ?? '';
  if (title && desc) return `${title}\n\n${desc}`;
  return title || desc || `Task ${task.id}`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n\n... (truncated; original length ${text.length} bytes)`;
}

async function postEvent(agent: RegisteredAgent, taskId: string, type: string, message: string): Promise<void> {
  const enc = encodeURIComponent(agent.agent);
  try {
    await agent.client.post(`/v1/agents/${enc}/tasks/${encodeURIComponent(taskId)}/event`, { type, message });
  } catch (err) { logger.warn('postEvent: best-effort', { error: String(err) }); }
}

/**
 * Launch the configured subprocess for a task. Returns immediately after
 * spawning; the subprocess runs in the background and posts task_complete or
 * task_fail when done. Safe to call concurrently for different tasks; calling
 * twice for the same (agent, task) within the same process is a no-op.
 */
export async function launchTaskRunner(agent: RegisteredAgent, task: TaskRunnerInput): Promise<void> {
  const runner = agent.config.runner;
  if (!runner) return;
  if (!markInFlight(agent.agent, task.id)) {
    console.error(`[runner:${agent.agent}] task ${task.id} already in flight, skip`);
    return;
  }

  const promptEnv = runner.prompt_env || 'AIMEAT_TASK_PROMPT';
  const taskIdEnv = runner.task_id_env || 'AIMEAT_TASK_ID';
  const agentNameEnv = runner.agent_name_env || 'AIMEAT_AGENT_NAME';
  const tokenEnv = runner.token_env || 'AIMEAT_TOKEN';
  const nodeUrlEnv = runner.node_url_env || 'AIMEAT_NODE_URL';
  const timeoutSec = runner.timeout_seconds && runner.timeout_seconds > 0 ? runner.timeout_seconds : DEFAULT_TIMEOUT_SECONDS;

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    ...(runner.env ?? {}),
    [promptEnv]: buildPrompt(task),
    [taskIdEnv]: task.id,
    [agentNameEnv]: agent.agent,
    [tokenEnv]: agent.client.getTokenValue() ?? '',
    [nodeUrlEnv]: agent.client.getBaseUrl(),
  };

  const cmd = runner.command;
  const args = runner.args ?? [];

  console.error(`[runner:${agent.agent}] task ${task.id} -- launching: ${cmd} ${args.join(' ')}`);
  await postEvent(agent, task.id, 'progress', `Task runner starting: ${cmd} ${args.join(' ')}`);

  let child;
  try {
    child = spawn(cmd, args, {
      cwd: runner.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    clearInFlight(agent.agent, task.id);
    const message = `Runner spawn failed: ${(err as Error).message}`;
    console.error(`[runner:${agent.agent}] ${message}`);
    await failTask(agent, task.id, message);
    return;
  }

  let stdoutBuf = '';
  let stderrBuf = '';
  child.stdout?.on('data', (d: Buffer) => {
    stdoutBuf += d.toString('utf-8');
    if (stdoutBuf.length > SUMMARY_MAX_BYTES * 2) {
      // soft cap: keep the tail so we have the most recent output if it grows huge
      stdoutBuf = stdoutBuf.slice(stdoutBuf.length - SUMMARY_MAX_BYTES * 2);
    }
  });
  child.stderr?.on('data', (d: Buffer) => {
    stderrBuf += d.toString('utf-8');
    if (stderrBuf.length > STDERR_MAX_BYTES * 2) {
      stderrBuf = stderrBuf.slice(stderrBuf.length - STDERR_MAX_BYTES * 2);
    }
  });

  const heartbeat = setInterval(() => {
    postEvent(agent, task.id, 'progress', 'Runner still working').catch(err => { logger.warn('launchTaskRunner: continuing after a suppressed failure', { error: String(err) }); });
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  const timeoutTimer = setTimeout(() => {
    console.error(`[runner:${agent.agent}] task ${task.id} timed out after ${timeoutSec}s, sending SIGTERM`);
    try { child.kill('SIGTERM'); } catch (err) { logger.warn('launchTaskRunner: ignore', { error: String(err) }); }
    // give it 10s grace then SIGKILL
    setTimeout(() => { try { child.kill('SIGKILL'); } catch (err) { logger.warn('launchTaskRunner: ignore', { error: String(err) }); } }, 10_000).unref();
  }, timeoutSec * 1000);
  timeoutTimer.unref();

  child.on('error', async (err: Error) => {
    clearInterval(heartbeat);
    clearTimeout(timeoutTimer);
    clearInFlight(agent.agent, task.id);
    const message = `Runner subprocess error: ${err.message}`;
    console.error(`[runner:${agent.agent}] ${message}`);
    await failTask(agent, task.id, message);
  });

  child.on('exit', async (code: number | null, signal: NodeJS.Signals | null) => {
    clearInterval(heartbeat);
    clearTimeout(timeoutTimer);
    clearInFlight(agent.agent, task.id);

    if (signal === 'SIGTERM' || signal === 'SIGKILL') {
      const message = `Runner timed out after ${timeoutSec}s and was killed (${signal})`;
      console.error(`[runner:${agent.agent}] ${message}`);
      await failTask(agent, task.id, message);
      return;
    }

    if (code === 0) {
      const summary = readDeliverable(runner.output_capture, stdoutBuf);
      console.error(`[runner:${agent.agent}] task ${task.id} -- done (exit 0, ${summary.length} bytes)`);
      await completeTask(agent, task.id, truncate(summary, SUMMARY_MAX_BYTES));
    } else {
      const message = `Runner exited with code ${code}.${stderrBuf ? `\n\nstderr:\n${truncate(stderrBuf, STDERR_MAX_BYTES)}` : ''}`;
      console.error(`[runner:${agent.agent}] task ${task.id} -- failed (exit ${code})`);
      await failTask(agent, task.id, message);
    }
  });
}

function readDeliverable(outputCapture: string | undefined, stdoutBuf: string): string {
  if (!outputCapture || outputCapture === 'stdout') return stdoutBuf;
  if (outputCapture.startsWith('file:')) {
    const path = outputCapture.slice('file:'.length);
    try {
      if (existsSync(path)) return readFileSync(path, 'utf-8');
      return `(output_capture file not found: ${path}; stdout fallback)\n\n${stdoutBuf}`;
    } catch (err) {
      return `(failed to read ${path}: ${(err as Error).message}; stdout fallback)\n\n${stdoutBuf}`;
    }
  }
  return stdoutBuf;
}

async function completeTask(agent: RegisteredAgent, taskId: string, summary: string): Promise<void> {
  const enc = encodeURIComponent(agent.agent);
  try {
    await agent.client.post(`/v1/agents/${enc}/tasks/${encodeURIComponent(taskId)}/complete`, { message: summary });
  } catch (err) {
    console.error(`[runner:${agent.agent}] failed to post task_complete for ${taskId}: ${(err as Error).message}`);
  }
}

async function failTask(agent: RegisteredAgent, taskId: string, reason: string): Promise<void> {
  const enc = encodeURIComponent(agent.agent);
  try {
    await agent.client.post(`/v1/agents/${enc}/tasks/${encodeURIComponent(taskId)}/fail`, { message: reason });
  } catch (err) {
    console.error(`[runner:${agent.agent}] failed to post task_fail for ${taskId}: ${(err as Error).message}`);
  }
}
