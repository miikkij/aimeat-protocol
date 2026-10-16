/**
 * @file test/unit/task-runner-completion.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The connector's task runner (cli/connect/task-runner.ts) reads the node's answer to
 *   a completion. QA audit E5-02: completeTask discarded the envelope client.post returns and logged
 *   only a throw, after the runner had printed "done", so a refused completion (409 INVALID_STATE)
 *   and one sent while the tunnel reconnected lost the result with a log line that said the opposite.
 *   The existing launch case (a client that always answers ok) is in connect-current-credential.test.ts.
 * @usage cd aimeat && pnpm exec vitest run test/unit/task-runner-completion.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit E5-02).
 */
import { describe, it, expect, vi, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The connector reads AIMEAT_HOME on first import, so it is set before the runner is loaded.
vi.setConfig({ testTimeout: 20_000 });   // each case spawns a child process and waits for its result
const home = mkdtempSync(join(tmpdir(), 'aimeat-runner-'));
process.env.AIMEAT_HOME = home;
afterAll(() => rmSync(home, { recursive: true, force: true }));

const { launchTaskRunner, RUNNER_POST_RETRY } = await import('../../src/cli/connect/task-runner.js');

const NODE_URL = 'http://127.0.0.1:9';
const resultFile = (taskId: string) => join(home, 'runner-results', 'alice', 'reporter', `${taskId}.json`);

let lines: string[] = [];
beforeEach(() => {
  lines = [];
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')); });
  // Guarded so the cases run their assertions against a runner without the retry as well.
  if (RUNNER_POST_RETRY) RUNNER_POST_RETRY.delaysMs = [20, 20, 20];
});
afterEach(() => { vi.restoreAllMocks(); });

/** Launch the runner on a child that prints `deliverable` and exits 0, with `answer` deciding each /complete. */
async function runWith(taskId: string, answer: (n: number) => unknown) {
  const completes: unknown[] = [];
  const client = {
    post: async (path: string, body: unknown) => {
      if (!path.endsWith('/complete')) return { ok: true };
      completes.push(body);
      const a = answer(completes.length);
      if (a instanceof Error) throw a;
      return a;
    },
    getBaseUrl: () => NODE_URL,
    getTokenValue: () => '',
  };
  await launchTaskRunner({
    gaii: 'reporter#alice@aimeat-test', agent: 'reporter', owner: 'alice', client,
    config: { node_url: NODE_URL, runner: { command: process.execPath, args: ['-e', 'process.stdout.write("the deliverable")'] } },
  } as never, { id: taskId, title: 'report' });
  return completes;
}

async function until(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 150 && !cond(); i++) await new Promise(r => setTimeout(r, 100));
  expect(cond(), what).toBe(true);
}

describe('task runner: the completion is read, not assumed', () => {
  it('a refused completion (409 INVALID_STATE) prints the code and message, never "done", and keeps the result', async () => {
    const taskId = 'task-refused';
    const completes = await runWith(taskId, () => ({
      ok: false, error: { code: 'INVALID_STATE', message: 'Only active or stalled tasks can be completed (current: queued)' },
    }));
    await until(() => existsSync(resultFile(taskId)), 'the result was not kept in a file');
    expect(completes).toHaveLength(1);   // a refusal is final: not sent again
    const out = lines.join('\n');
    expect(out).toContain('INVALID_STATE: Only active or stalled tasks can be completed (current: queued)');
    expect(out).not.toMatch(/-- done/);
    expect(out).toContain(`is kept in ${resultFile(taskId)}`);
    const kept = JSON.parse(readFileSync(resultFile(taskId), 'utf-8'));
    expect(kept.message).toBe('the deliverable');
    expect(kept.node_answer.code).toBe('INVALID_STATE');
  });

  it('a completion sent during a reconnect is tried again until the node takes it, then says done', async () => {
    const taskId = 'task-reconnect';
    const completes = await runWith(taskId, (n) => n === 1 ? new Error('Tunnel not connected')
      : n === 2 ? { ok: false, error: { code: 'TUNNEL_DISCONNECTED', message: 'Tunnel connection lost before a response arrived' } }
        : { ok: true });
    await until(() => lines.some(l => l.includes(`task ${taskId} -- done`)), 'the runner never said done');
    expect(completes).toHaveLength(3);
    expect(lines.filter(l => l.includes('trying again'))).toHaveLength(2);
    expect(existsSync(resultFile(taskId))).toBe(false);
  });

  it('a tunnel that stays down past the last attempt keeps the result and says where', async () => {
    const taskId = 'task-never';
    const completes = await runWith(taskId, () => new Error('Tunnel not connected'));
    await until(() => existsSync(resultFile(taskId)), 'the result was not kept in a file');
    expect(completes).toHaveLength(4);   // the first attempt and the three retries set above
    expect(lines.join('\n')).not.toMatch(/-- done/);
  });
});
