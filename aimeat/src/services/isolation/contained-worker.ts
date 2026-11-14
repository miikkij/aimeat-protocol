/**
 * @file src/services/isolation/contained-worker.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A worker thread with a memory limit, run inside a child Node process of its own, so
 *   that reaching the limit ends the child and never the node.
 *
 *   WHY A PROCESS. A worker thread's resourceLimits do not contain an out-of-memory: when the
 *   worker's V8 heap reaches maxOldGenerationSizeMb, V8 can call its fatal OOM handler instead of
 *   Node's ERR_WORKER_OUT_OF_MEMORY path, and that handler aborts the whole process (measured
 *   2026-11-14 on Node 24.22: a worker filling a 64 MB heap with small arrays aborted the process on
 *   the first try, with and without a terminate; CI saw the same abort in the worker's isolate
 *   disposal). A file built to make a reader allocate fast would end the node for every account.
 *   Here the worker runs in a child process started from source text (`node -e`), so the abort ends
 *   the child, and the caller sees the same 'error' (code ERR_WORKER_OUT_OF_MEMORY) and 'exit' events
 *   it saw from a worker.
 *
 *   SHAPE. The class answers the part of the Worker interface the bounded readers use: 'message',
 *   'error' and 'exit' events, postMessage, getHeapStatistics (the worker's own, through the child's
 *   main thread, which stays free while the worker reads), terminate, ref and unref. Messages cross
 *   the process boundary with structured-clone serialization, so ArrayBuffers are copied, never
 *   transferred.
 * @structure HOST_SOURCE · ContainedWorkerOptions · ContainedWorker (on, postMessage, getHeapStatistics,
 *   terminate, ref, unref) · abortedOnMemory(code, signal)
 * @usage
 *   const worker = new ContainedWorker(WORKER_SOURCE, { workerData, memoryMb: 512 });
 *   worker.on('message', (m) => ...); worker.postMessage(job);
 *   const { used_heap_size, external_memory } = await worker.getHeapStatistics();
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial: media-read-bounded.ts and pdf-bounded.ts read through it.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { logger } from '../../utils/logger.js';

/**
 * Runs in the child. The first message starts the worker; later ones are posts to it and heap
 * questions about it. When the worker ends, the child ends.
 */
const HOST_SOURCE = `
const { Worker } = require('node:worker_threads');
process.once('message', (init) => {
  const worker = new Worker(init.source, {
    eval: true,
    workerData: init.workerData,
    ...(init.memoryMb > 0 ? { resourceLimits: { maxOldGenerationSizeMb: init.memoryMb } } : {}),
  });
  const send = (m) => { try { process.send(m); } catch { /* the parent is gone */ } };
  // A heap question asked before the worker has started is answered once it has.
  const online = new Promise((resolve) => worker.once('online', resolve));
  worker.on('message', (m) => send({ t: 'message', m }));
  worker.on('error', (err) => send({ t: 'error', code: err && err.code, name: err && err.name, message: String((err && err.message) || err) }));
  worker.on('exit', (code) => {
    if (process.connected) process.send({ t: 'exit', code }, () => process.exit(0));
    else process.exit(0);
  });
  process.on('message', (x) => {
    if (x.t === 'post') worker.postMessage(x.m);
    else if (x.t === 'heap') {
      online.then(() => worker.getHeapStatistics()).then(
        (s) => send({ t: 'heap', id: x.id, s: { used_heap_size: s.used_heap_size, external_memory: s.external_memory } }),
        (err) => send({ t: 'heap', id: x.id, failed: String((err && err.message) || err) }),
      );
    }
  });
  process.on('disconnect', () => process.exit(0));
});
`;

export interface ContainedWorkerOptions {
  /** Handed to the worker as `workerData`; structured-clone serializable. */
  workerData?: unknown;
  /** The worker's V8 heap limit in MB. 0 or absent is no limit. */
  memoryMb?: number;
}

export interface ContainedHeapStatistics { used_heap_size: number; external_memory: number }

/** True when the child ended the way V8's fatal out-of-memory handler ends a process. */
export function abortedOnMemory(code: number | null, signal: NodeJS.Signals | null): boolean {
  return signal === 'SIGABRT' || code === 134;
}

type Pending = { resolve: (s: ContainedHeapStatistics) => void; reject: (e: Error) => void };

export class ContainedWorker extends EventEmitter {
  private readonly child: ChildProcess;
  private readonly heapAsks = new Map<number, Pending>();
  private nextAsk = 1;
  private exited = false;
  private readonly exitPromise: Promise<number>;

  constructor(source: string, options: ContainedWorkerOptions = {}) {
    super();
    const memoryMb = options.memoryMb && options.memoryMb > 0 ? options.memoryMb : 0;
    // A plain node: no loader or heap flag of the parent's reaches the child.
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    this.child = spawn(process.execPath, ['-e', HOST_SOURCE], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      serialization: 'advanced',
      windowsHide: true,
      env,
    });
    this.exitPromise = new Promise<number>((resolve) => {
      let workerExit: number | null = null;
      this.child.on('message', (x: { t: string; m?: unknown; code?: string | number; name?: string; message?: string; id?: number; s?: ContainedHeapStatistics; failed?: string }) => {
        if (x.t === 'message') this.emit('message', x.m);
        else if (x.t === 'error') {
          const err = new Error(x.message ?? 'the worker failed') as Error & { code?: string };
          if (x.name) err.name = x.name;
          if (typeof x.code === 'string') err.code = x.code;
          this.emit('error', err);
        } else if (x.t === 'exit') workerExit = typeof x.code === 'number' ? x.code : 0;
        else if (x.t === 'heap' && typeof x.id === 'number') {
          const ask = this.heapAsks.get(x.id);
          this.heapAsks.delete(x.id);
          if (!ask) return;
          if (x.s) ask.resolve(x.s);
          else ask.reject(new Error(x.failed ?? 'the heap statistics did not read'));
        }
      });
      this.child.on('error', (err) => this.emit('error', err));
      this.child.on('exit', (code, signal) => {
        this.exited = true;
        for (const ask of this.heapAsks.values()) ask.reject(new Error('the worker has ended'));
        this.heapAsks.clear();
        if (abortedOnMemory(code, signal)) {
          const err = new Error(`the worker reached its memory limit of ${memoryMb} MB`) as Error & { code?: string };
          err.code = 'ERR_WORKER_OUT_OF_MEMORY';
          this.emit('error', err);
        }
        const exitCode = workerExit ?? (typeof code === 'number' ? code : 1);
        this.emit('exit', exitCode);
        resolve(exitCode);
      });
    });
    this.child.send({ source, workerData: options.workerData, memoryMb });
  }

  /** Posts to the worker. A transfer list is accepted and ignored: the message is copied. */
  postMessage(message: unknown, _transfer?: readonly unknown[]): void {
    if (this.exited || !this.child.connected) return;
    try { this.child.send({ t: 'post', m: message }); } catch (err) {
      // The child is ending; its 'exit' event tells the caller.
      logger.debug(`[contained-worker] a message to an ending worker was dropped: ${(err as Error)?.message ?? String(err)}`);
    }
  }

  /** The worker's heap statistics. Rejects once the worker has ended. */
  getHeapStatistics(): Promise<ContainedHeapStatistics> {
    if (this.exited || !this.child.connected) return Promise.reject(new Error('the worker has ended'));
    const id = this.nextAsk++;
    return new Promise<ContainedHeapStatistics>((resolve, reject) => {
      this.heapAsks.set(id, { resolve, reject });
      try { this.child.send({ t: 'heap', id }); } catch (err) {
        this.heapAsks.delete(id);
        reject(err as Error);
      }
    });
  }

  /** Ends the child, and with it the worker. Resolves with the exit code once it has ended. */
  terminate(): Promise<number> {
    if (!this.exited) this.child.kill('SIGKILL');
    return this.exitPromise;
  }

  /** Lets the node exit while the worker is up. */
  unref(): void {
    this.child.unref();
    (this.child.channel as { unref?: () => void } | undefined)?.unref?.();
  }

  /** Keeps the node up while the worker is up. */
  ref(): void {
    this.child.ref();
    (this.child.channel as { ref?: () => void } | undefined)?.ref?.();
  }
}
