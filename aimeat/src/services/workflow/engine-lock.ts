/**
 * @file src/services/workflow/engine-lock.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The run lock: one change of a workflow run at a time. Two task completions, an answer
 *   and the watchdog may all advance one run, and each reads the run, changes it and saves it, so two
 *   at once would lose one change.
 *
 *   TWO LAYERS. In this process the changes of one run wait for each other in order (the chain of
 *   promises WorkflowEngine.withLock kept, moved here unchanged). Across processes the holder of the
 *   chain also holds the lease `lease.wf-run.<runId>` (services/process-lease.ts) while it changes the
 *   run, and a change in another process waits for it. With one process nothing else holds that
 *   lease, so a change never waits for it; it costs a read, a write and a delete per change.
 * @structure RunLock (run)
 * @usage const lock = new RunLock(storage, config); await lock.run(runId, async () => { ... });
 * @version-history
 *   v1.0.0 -- 2026-11-04 -- Initial: the in-process chain moved from engine.ts, with the lease across
 *     processes (codebase analysis 2026-11-03, item HA 2.6).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { waitForHeldLease, releaseHeldLease } from '../process-lease.js';

export class RunLock {
  /** Per-run serialization in this process: advancing the same run from two task completions is a RMW race. */
  readonly locks = new Map<string, Promise<void>>();

  constructor(private readonly storage: Storage, private readonly config: Pick<AimeatConfig, 'nodeId' | 'port'>) {}

  /** Run one change of `runId` under its lock in this process and its lease across processes. */
  async run<T>(runId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(runId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const queued = prev.then(() => gate);
    this.locks.set(runId, queued);
    await prev;
    const lease = `wf-run.${runId}`;
    try {
      await waitForHeldLease(this.storage, this.config, lease);
      try { return await fn(); }
      finally { await releaseHeldLease(this.storage, this.config, lease); }
    } finally { release(); if (this.locks.get(runId) === queued) this.locks.delete(runId); }
  }
}
