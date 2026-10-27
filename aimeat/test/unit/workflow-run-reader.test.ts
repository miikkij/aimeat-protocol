/**
 * @file test/unit/workflow-run-reader.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A workflow step reads the owner's records with the reader of the principal the run acts
 *   for (secaudit2026oct26, workflow/engine-steps:step-reads-use-system-reader-not-run-principal).
 *
 *   On a real SQLite store with classification on: an export-out step of a run that acts for an agent
 *   whose clearance is below the record's label sends nothing, as the agent's own read of that record
 *   is refused. The usage cases send the record as before: the owner's run, a run started before runs
 *   recorded a principal, and an agent with no clearance (an agent holding the owner's reach reads in
 *   a workflow what it read before).
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AgentRecord } from '../../src/storage/interface.js';
import { memoryTarget } from '../../src/services/classification/labels.js';
import { dispatchEcosystemStep } from '../../src/services/workflow/engine-steps.js';
import { runReader } from '../../src/services/workflow/run-reader.js';
import { setActiveConnectTunnelManager, type ConnectTunnelManager } from '../../src/services/connect-tunnel.js';
import type { AimeatConfig } from '../../src/config.js';
import type { WorkflowRun, WorkflowSaver, WorkflowStep } from '../../src/models/workflow-schemas.js';

const N = 'unit-node';
const ALICE = `alice@${N}`;
const BOT = `bot#alice@${N}`;
const GEAI = `eco:shop#alice@${N}`;
const KEY = 'plans.secret';
const cfg = { classificationMode: 'all', nodeId: N, agentClearanceDefault: '', baseUrl: 'http://localhost' } as unknown as AimeatConfig;

let storage: SqliteStorage;
let frames: Array<{ capability: string; input: unknown; caller: string }>;

async function agent(extra: Partial<AgentRecord> = {}): Promise<void> {
  await storage.createAgent({
    name: 'bot', owner: 'alice', gaii: BOT, capabilities: [], publicKey: 'pk', trustScore: 0, morselBalance: 0,
    createdAt: '2026-10-27T00:00:00.000Z', lastSeen: '2026-10-27T00:00:00.000Z', defaultScopes: ['*'], ...extra,
  });
}

beforeEach(async () => {
  storage = new SqliteStorage(':memory:');
  const now = '2026-10-27T00:00:00.000Z';
  await storage.setMemory({ key: KEY, ownerGaii: ALICE, value: { plan: 'dummy' }, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now } as never);
  const t = memoryTarget(ALICE, KEY);
  await storage.putContentLabel({
    ...t, id: `row-${t.kind}-${t.key}`, ownerGaii: null, label: 'luottamuksellinen', source: 'human', locked: true,
    suggestion: null, justification: null, humanSaid: null, history: [], setBy: ALICE, updatedAt: now,
  });
  frames = [];
  setActiveConnectTunnelManager({
    invokeOnPrincipal: async (_p: string, f: { capability: string; input: unknown; caller: string }) => { frames.push(f); return { ok: true, result: {} }; },
  } as unknown as ConnectTunnelManager);
});

afterEach(() => { setActiveConnectTunnelManager(null); storage.close(); });

const exportStep: WorkflowStep = {
  id: 'send', description: 'send the plan', action: { kind: 'export-out', geai: GEAI, from: KEY },
} as WorkflowStep;

function runFor(principal?: WorkflowSaver): WorkflowRun {
  return {
    runId: 'r1', workflowId: 'wf', vars: {}, mode: 'full-live', keyPrefix: '', status: 'running', steps: {},
    defSnapshot: { description: 'd' }, resolved: [], ...(principal ? { principal } : {}),
  } as unknown as WorkflowRun;
}

async function fire(run: WorkflowRun): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    dispatchEcosystemStep({ storage, config: cfg }, ALICE, run, exportStep, exportStep.action as never, (_o, _w, _r, _s, ok) => resolve(ok));
  });
}

describe('an export-out step reads as the principal the run acts for', () => {
  it('usage: the owner\'s run sends the record', async () => {
    expect(await fire(runFor({ kind: 'owner', id: ALICE }))).toBe(true);
    expect(frames).toHaveLength(1);
  });

  it('usage: a run started before runs recorded a principal sends the record', async () => {
    expect(await fire(runFor())).toBe(true);
    expect(frames).toHaveLength(1);
  });

  it('usage: an agent with no clearance sends the record, as it reads it directly', async () => {
    await agent();
    expect(await fire(runFor({ kind: 'agent', id: BOT }))).toBe(true);
    expect(frames).toHaveLength(1);
  });

  it('an agent whose clearance is below the record\'s label sends nothing', async () => {
    await agent({ clearance: 'sisainen' });
    expect(await fire(runFor({ kind: 'agent', id: BOT }))).toBe(false);
    expect(frames).toHaveLength(0);
  });
});

describe('runReader', () => {
  it('shows the record to the owner\'s run and hides it from an agent above whose clearance it is', async () => {
    await agent({ clearance: 'sisainen' });
    const rec = (await storage.getMemory(ALICE, KEY))!;
    const target = () => memoryTarget(ALICE, KEY);
    expect(await runReader({ storage, config: cfg }, runFor({ kind: 'owner', id: ALICE }), ALICE).show([rec], target)).toHaveLength(1);
    expect(await runReader({ storage, config: cfg }, runFor({ kind: 'agent', id: BOT }), ALICE).show([rec], target)).toHaveLength(0);
  });
});
