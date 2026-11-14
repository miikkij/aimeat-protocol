/**
 * @file test/unit/contained-worker.test.ts
 * SPDX-License-Identifier: MIT
 * @description ContainedWorker (src/services/isolation/contained-worker.ts): a worker that fills its heap ends its
 *   own child process and reports ERR_WORKER_OUT_OF_MEMORY, while this process goes on; and the parts
 *   of the Worker interface the bounded readers use still work (messages, heap statistics, terminate).
 *
 *   ATTACK. The worker below pushes small arrays until its 64 MB heap is full. In a plain worker thread
 *   this aborted the whole process on Node 24.22 (FATAL ERROR: Reached heap limit), with and without a
 *   terminate, which is how CI lost a unit run on 2026-11-14. Run three times here, so one lucky run
 *   through Node's own out-of-memory path does not pass the test.
 * @structure attack · use kept
 * @usage pnpm exec vitest run test/unit/contained-worker.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { ContainedWorker, abortedOnMemory } from '../../src/services/isolation/contained-worker.js';

const FILL_HEAP = `
const { parentPort } = require('node:worker_threads');
parentPort.on('message', () => {
  const keep = [];
  for (;;) keep.push(new Array(1000).fill({ a: Math.random() }));
});
`;

const ECHO = `
const { parentPort, workerData } = require('node:worker_threads');
parentPort.on('message', (m) => parentPort.postMessage({ echo: m, prefix: workerData.prefix, bytes: m.bytes ? m.bytes.byteLength : 0 }));
`;

function runToEnd(worker: ContainedWorker): Promise<{ errors: string[]; exit: number }> {
  return new Promise((resolve) => {
    const errors: string[] = [];
    worker.on('error', (err: Error & { code?: string }) => errors.push(err.code ?? err.message));
    worker.on('exit', (exit: number) => resolve({ errors, exit }));
  });
}

describe('a worker that fills its heap ends its own process, not this one', () => {
  it('reports ERR_WORKER_OUT_OF_MEMORY and exits, three times over', async () => {
    for (let i = 0; i < 3; i++) {
      const worker = new ContainedWorker(FILL_HEAP, { memoryMb: 64 });
      const ended = runToEnd(worker);
      worker.postMessage('go');
      const { errors } = await ended;
      expect(errors).toContain('ERR_WORKER_OUT_OF_MEMORY');
    }
    // Still here: this process was not aborted.
    expect(process.memoryUsage().rss).toBeGreaterThan(0);
  }, 90_000);

  it('a child ended by SIGABRT or exit code 134 counts as the memory limit, a kill does not', () => {
    expect(abortedOnMemory(null, 'SIGABRT')).toBe(true);
    expect(abortedOnMemory(134, null)).toBe(true);
    expect(abortedOnMemory(null, 'SIGKILL')).toBe(false);
    expect(abortedOnMemory(0, null)).toBe(false);
  });
});

describe('the Worker interface the bounded readers use', () => {
  it('carries workerData and messages both ways, an ArrayBuffer included', async () => {
    const worker = new ContainedWorker(ECHO, { workerData: { prefix: 'p' } });
    try {
      const reply = new Promise<Record<string, unknown>>((resolve) => worker.on('message', resolve));
      const bytes = new Uint8Array([1, 2, 3, 4, 5]).buffer;
      worker.postMessage({ hello: 'world', bytes }, [bytes]);
      expect(await reply).toMatchObject({ echo: { hello: 'world' }, prefix: 'p', bytes: 5 });
    } finally {
      await worker.terminate();
    }
  }, 30_000);

  it('answers the worker\'s heap statistics, and rejects them once it has ended', async () => {
    const worker = new ContainedWorker(ECHO, { workerData: { prefix: 'p' }, memoryMb: 64 });
    const s = await worker.getHeapStatistics();
    expect(s.used_heap_size).toBeGreaterThan(0);
    expect(typeof s.external_memory).toBe('number');
    const code = await worker.terminate();
    expect(typeof code).toBe('number');
    await expect(worker.getHeapStatistics()).rejects.toThrow(/ended/);
  }, 30_000);

  it('emits exit once when terminated', async () => {
    const worker = new ContainedWorker(ECHO, { workerData: { prefix: 'p' } });
    let exits = 0;
    worker.on('exit', () => { exits++; });
    await worker.getHeapStatistics();
    await worker.terminate();
    await worker.terminate();
    await new Promise((r) => setTimeout(r, 100));
    expect(exits).toBe(1);
  }, 30_000);
});
