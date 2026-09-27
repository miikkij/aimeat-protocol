/**
 * @file recovery-boundaries.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Missed-event recovery and the measured limit of floating tally persistence.
 * @version-history 1.0.0 2026-09-27 Restart, refusal, replay and actual owned-process kill.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { loadConfig } from '../../src/config.js';
import { createTrackedResponse, reconcileTrackedResponses, getTrackedResponse } from '../../src/services/tracked-response.js';
import { sendDirectMessage, type SendMessageResult } from '../../src/services/message-send.js';
import type { DirectMessageRecord } from '../../src/storage/interface.js';
import { WorkflowEngine } from '../../src/services/workflow/engine.js';
import type { WorkflowRun } from '../../src/models/workflow-schemas.js';
import { runKey } from '../../src/services/workflow/store.js';
import { reconcileActiveRun } from '../../src/services/workflow/lifecycle.js';

vi.mock('../../src/services/message-send.js', () => ({ sendDirectMessage: vi.fn() }));
const config = { ...loadConfig().config, aiProvenance: false };
afterEach(() => vi.restoreAllMocks());

async function setup(storage: SqliteStorage) {
  const owner = 'owner@recovery-test', key = `recovery.${randomUUID()}`;
  const ctx = { storage, config, peers: new Map() };
  const contract = await createTrackedResponse(ctx, owner, {
    title: 'Recovery test', source: { kind: 'message', messageId: 'source', conversationId: 'thread',
      peerGhii: 'peer@recovery-test', ownerGhii: owner, originNodeId: config.nodeId },
    watch: { key, condition: { field: 'done', equals: true } },
    response: { channel: 'message.reply', mode: 'auto', template: '{{result}}', inject: { field: 'result' } },
  });
  const now = new Date().toISOString();
  // Durable condition changed, but no memory-written event reaches the reconciler.
  await storage.setMemory({ ownerGaii: owner, key, value: { done: true, result: 'visible reply' },
    visibility: 'private', tags: [], version: 1, ttlHours: null, createdAt: now, updatedAt: now });
  return { ctx, contract, owner };
}

function receivingMailbox(storage: SqliteStorage) {
  return vi.mocked(sendDirectMessage).mockImplementation(async (_ctx, input): Promise<SendMessageResult> => {
    const message: DirectMessageRecord = { id: randomUUID(), ownerGhii: input.recipientGhii,
      conversationId: 'thread', senderGhii: input.senderGhii, recipientGhii: input.recipientGhii,
      body: input.body, direction: 'inbound', status: 'delivered', origin: 'local',
      originNodeId: config.nodeId, createdAt: new Date().toISOString() };
    await storage.createDirectMessage(message);
    return { ok: true, message };
  });
}

describe('durability boundaries', () => {
  it('a fresh workflow engine resumes an indexed completed task after its terminal event was missed', async () => {
    const storage = new SqliteStorage(':memory:');
    const now = new Date().toISOString(), owner = 'owner@recovery-test';
    const run: WorkflowRun = { runId: 'restart', workflowId: 'recovery', resolved: [], vars: {},
      mode: 'full-live', status: 'waiting-step', startedAt: now,
      steps: { step: { state: 'dispatched', attempt: 0, reads: [], writes: [], taskIds: ['completed'] } },
      defSnapshot: { id: 'recovery', title: 'Recovery', description: 'test', trigger: { kind: 'manual' },
        vars: [], steps: [{ id: 'step', agent: 'agent', offer: 'test', description: 'test', timeout_min: 10 }],
        on_step_fail: 'inspect', createdBy: owner, createdAt: now, updatedAt: now } };
    try {
      await storage.setMemory({ ownerGaii: owner, key: runKey(run.workflowId, run.runId), value: run,
        visibility: 'private', tags: [], version: 1, ttlHours: null, createdAt: now, updatedAt: now });
      await storage.createAgentTask({ id: 'completed', agentGaii: 'agent#owner@recovery-test', ownerGaii: owner,
        title: 'Completed', description: 'test', scope: [{ name: 'workflow-run', value: 'recovery/restart', type: 'text', description: 'step' }],
        rules: [], verification: { userExpects: 'done', technicalChecks: [] }, todos: [], status: 'done',
        createdAt: now, updatedAt: now });
      // Negative control: the durable run alone is not a substitute for its active-run index.
      await new WorkflowEngine(config, storage).resumeInflight();
      expect(((await storage.getMemory(owner, runKey('recovery', 'restart')))!.value as WorkflowRun).status).toBe('waiting-step');
      await reconcileActiveRun(storage, config.nodeId, owner, run);
      await new WorkflowEngine(config, storage).resumeInflight();
      const saved = (await storage.getMemory(owner, runKey('recovery', 'restart')))!;
      expect((saved.value as WorkflowRun).status).toBe('done');
      await new WorkflowEngine(config, storage).resumeInflight();
      expect((await storage.getMemory(owner, runKey('recovery', 'restart')))?.version).toBe(saved.version);
    } finally { storage.close(); }
  });

  it('reconciles a missed event from persisted state and does not replay a recorded success', async () => {
    const path = resolve('test', `.test-recovery-${randomUUID()}.db`);
    let storage = new SqliteStorage(path);
    try {
      const { contract, owner } = await setup(storage);
      storage.close();
      storage = new SqliteStorage(path); // A fresh storage connection after restart.
      receivingMailbox(storage);
      const ctx = { storage, config, peers: new Map() };
      await reconcileTrackedResponses(ctx);
      const saved = await getTrackedResponse(storage, owner, contract.id);
      expect(saved?.state).toBe('replied');
      const delivered = await storage.getDirectMessage(saved!.delivery.sentMessageId!, 'peer@recovery-test');
      expect(delivered?.body).toBe('visible reply');
      await reconcileTrackedResponses(ctx);
      expect(sendDirectMessage).toHaveBeenCalledTimes(1);
    } finally { storage.close(); removeDatabase(path); }
  });

  it('persists receiver refusal and retries through the same delivery boundary', async () => {
    const storage = new SqliteStorage(':memory:');
    try {
      const { ctx, owner, contract } = await setup(storage);
      vi.mocked(sendDirectMessage).mockReset().mockResolvedValueOnce({ ok: false, code: 'BLOCKED' });
      await reconcileTrackedResponses(ctx);
      expect(await getTrackedResponse(storage, owner, contract.id)).toMatchObject({ state: 'error',
        tracking: { attempts: 1, lastError: 'BLOCKED' } });
      receivingMailbox(storage);
      await reconcileTrackedResponses(ctx);
      const saved = await getTrackedResponse(storage, owner, contract.id);
      expect((await storage.getDirectMessage(saved!.delivery.sentMessageId!, 'peer@recovery-test'))?.body).toBe('visible reply');
    } finally { storage.close(); }
  });

  it('documents the crash boundary: committed memory does not guarantee a pending first-sighting tally', async () => {
    const path = resolve('test', `.test-tally-crash-${randomUUID()}.db`);
    const child = fork(resolve('test/fixtures/tally-crash-child.ts'), [path], {
      execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    let childError = '';
    child.stderr?.on('data', chunk => { childError += String(chunk); });
    const exited = once(child, 'exit');
    try {
      const message = await Promise.race([
        once(child, 'message', { signal: AbortSignal.timeout(10_000) }),
        exited.then(() => { throw new Error(`Fixture exited: ${childError}`); }),
      ]);
      expect(message[0]).toBe('memory-committed-tally-pending');
      child.kill('SIGKILL'); await exited;
      const storage = new SqliteStorage(path);
      try {
        expect((await storage.getMemory('owner@crash-test', 'crash.persisted'))?.value).toBe('durable');
        expect(await storage.listMemoryWriteTally({ ownerGaii: 'owner@crash-test', key: 'crash.persisted' })).toEqual([]);
      } finally { storage.close(); }
    } finally {
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
      removeDatabase(path);
    }
  }, 15_000);
});

function removeDatabase(path: string) {
  for (const suffix of ['', '-wal', '-shm']) if (existsSync(path + suffix)) unlinkSync(path + suffix);
}
