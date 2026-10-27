/**
 * @file test/unit/workflow-ecosystem-step-caller.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who a workflow's ecosystem step (trigger-geai, export-out) names as the caller on the
 *   invoke frame it sends to the owner's connected app (secaudit2026oct26,
 *   workflow/engine-steps:ecosystem-step-caller-is-owner-not-run-principal).
 *
 *   A run that acts for an agent names that agent, as the capability door and an agent's
 *   eco-capability schedule do; a run that acts for an ecosystem app names that app. The usage cases:
 *   a run the owner started, a run an app grant started and a run started before runs recorded a
 *   principal name the owner, exactly as before, and the call goes out with the same capability.
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { dispatchEcosystemStep } from '../../src/services/workflow/engine-steps.js';
import { setActiveConnectTunnelManager, type ConnectTunnelManager } from '../../src/services/connect-tunnel.js';
import type { WorkflowRun, WorkflowSaver, WorkflowStep } from '../../src/models/workflow-schemas.js';

const NODE = 'test-node';
const OWNER = `alice@${NODE}`;
const GEAI = `eco:shop#alice@${NODE}`;

type Frame = { capability: string; input: unknown; caller: string };

/** A tunnel that records each invoke frame and answers ok. */
function recordingTunnel(): Frame[] {
  const frames: Frame[] = [];
  setActiveConnectTunnelManager({
    invokeOnPrincipal: async (_p: string, frame: Frame) => { frames.push(frame); return { ok: true, result: {} }; },
  } as unknown as ConnectTunnelManager);
  return frames;
}

afterEach(() => setActiveConnectTunnelManager(null));

function runFor(principal?: WorkflowSaver): WorkflowRun {
  return {
    runId: 'r1', workflowId: 'wf', vars: {}, mode: 'full-live', keyPrefix: '', status: 'running', steps: {},
    defSnapshot: { description: 'd' }, resolved: [], ...(principal ? { principal } : {}),
  } as unknown as WorkflowRun;
}

const trigger: WorkflowStep = {
  id: 'kick', description: 'kick the shop',
  action: { kind: 'trigger-geai', geai: GEAI, capability: 'restock', input: { n: 1 } },
} as WorkflowStep;

/** Dispatch the trigger-geai step and wait for its answer. */
async function fire(run: WorkflowRun): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    dispatchEcosystemStep({ storage: {} as never, config: { nodeId: NODE } as never } as never, OWNER, run, trigger,
      trigger.action as never, (_o, _w, _r, _s, ok) => { resolve(ok); });
  });
}

describe('the caller on an ecosystem step\'s invoke frame', () => {
  it('usage: a run the owner started names the owner', async () => {
    const frames = recordingTunnel();
    expect(await fire(runFor({ kind: 'owner', id: OWNER }))).toBe(true);
    expect(frames).toEqual([{ capability: 'restock', input: { n: 1 }, caller: OWNER }]);
  });

  it('usage: a run started before runs recorded a principal names the owner', async () => {
    const frames = recordingTunnel();
    expect(await fire(runFor())).toBe(true);
    expect(frames[0]?.caller).toBe(OWNER);
  });

  it('usage: a run an app grant started names the owner, as an app\'s schedule does', async () => {
    const frames = recordingTunnel();
    expect(await fire(runFor({ kind: 'app', id: 'grant-123' }))).toBe(true);
    expect(frames[0]?.caller).toBe(OWNER);
  });

  it('a run that acts for an agent names the agent', async () => {
    const frames = recordingTunnel();
    expect(await fire(runFor({ kind: 'agent', id: `bot#alice@${NODE}` }))).toBe(true);
    expect(frames).toEqual([{ capability: 'restock', input: { n: 1 }, caller: `bot#alice@${NODE}` }]);
  });

  it('a run that acts for an ecosystem app names that app', async () => {
    const frames = recordingTunnel();
    expect(await fire(runFor({ kind: 'ecosystem', id: `eco:crm#alice@${NODE}` }))).toBe(true);
    expect(frames[0]?.caller).toBe(`eco:crm#alice@${NODE}`);
  });
});
