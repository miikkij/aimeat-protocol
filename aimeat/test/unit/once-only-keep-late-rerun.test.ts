/**
 * @file test/unit/once-only-keep-late-rerun.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A once-only keep step that failed or whose claim lapsed runs at a later start, after
 *   the node has served under the new rule. It keeps only what existed when the rule first took effect
 *   on the node, never what was made meanwhile (secaudit2026oct26,
 *   once-only-keep-steps.ts:late-rerun-keeps-state-made-under-new-rule):
 *   - the claim carries `ruleSince`, the first try's time, which a release does not remove;
 *   - the first-use keep marks an extension installed before it and not one an agent installed after;
 *   - the publish keep lists an agent-installed extension from before it and not one from after;
 *   - the ai-schedule keep lists an agent's schedule from before it and not one made after;
 *   - the app-tool keep (an existedBefore step) lists an agent from before it and not one made after;
 *   - the use kept: what existed at the first try is kept across the failed first run, and a step that
 *     runs once on its first start keeps exactly what it kept before.
 * @usage cd aimeat && pnpm exec vitest run test/unit/once-only-keep-late-rerun.test.ts
 * @version-history
 *   2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, ExtensionRecord, ScheduledJobRecord } from '../../src/storage/interface.js';
import { claimOnceOnlyStep, ruleSinceKey } from '../../src/services/once-only-step.js';
import { keepExtensionFirstUseOnce, FIRST_USE_KEEP_STEP_KEY } from '../../src/services/extension-first-use-keep.js';
import { keepExtensionPublishOnce, PUBLISH_KEEP_STEP_KEY } from '../../src/services/extension-publish-keep.js';
import { keepAiScheduleReadsOnce, AI_SCHEDULE_READ_KEEP_KEY } from '../../src/services/schedule-ai-read.js';
import { keepAppToolInvokeOnce, APP_TOOL_INVOKE_KEEP_KEY } from '../../src/services/app-tool-invoke-keep.js';

const NODE_ID = 'aimeat-late-rerun';
const SYSTEM = `system@${NODE_ID}`;
const config = { nodeId: NODE_ID };
const OWNER = 'lateowner';
const AGENT = `helper#${OWNER}@${NODE_ID}`;

let storage: Storage;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

async function extension(name: string, installedAt: string, byPrincipal: string): Promise<void> {
  await storage.createExtension({
    name, version: '1.0.0', description: 'd', author: OWNER, status: 'active', requiredApis: [], limits: {}, federation: {}, actions: [
      { id: 'run', method: 'POST', path: '/run', inputSchema: {}, outputSchema: {}, scriptContent: 'return 1' },
    ], config: {}, active: true, installedBy: OWNER, installedByPrincipal: byPrincipal, installedAt,
  } as unknown as ExtensionRecord);
}

async function aiSchedule(id: string, createdAt: string): Promise<void> {
  await storage.createScheduledJob({
    id, name: id, type: 'ai', cron: '0 * * * *', enabled: true, input: { prompt: 'p', inputKeys: [] },
    createdBy: AGENT, createdByAgent: true, ownerScope: `${OWNER}@${NODE_ID}`, createdAt, updatedAt: createdAt,
  } as unknown as ScheduledJobRecord);
}

/** A first start whose step threw: the claim was taken and released, as runOnceOnlyKeepSteps' catch leaves it. */
async function failedFirstStart(key: string): Promise<void> {
  const claim = await claimOnceOnlyStep(storage, SYSTEM, key);
  expect(claim).not.toBeNull();
  await claim!.release();
}

beforeEach(() => { storage = new SqliteStorage(':memory:') as unknown as Storage; });

describe('the rule\'s first-seen time', () => {
  it('is written by the first claim, survives a release, and is the time a later claim carries', async () => {
    const first = await claimOnceOnlyStep(storage, SYSTEM, 'migrations.test-step', Date.now() - 600_000);
    const since = first!.ruleSince;
    await first!.release();
    expect(await storage.getMemory(SYSTEM, 'migrations.test-step')).toBeNull();
    expect(await storage.getMemory(SYSTEM, ruleSinceKey('migrations.test-step'))).not.toBeNull();
    const later = await claimOnceOnlyStep(storage, SYSTEM, 'migrations.test-step');
    expect(later!.ruleSince).toBe(since);
  });
});

describe('a keep step that runs late keeps only what existed when its rule took effect', () => {
  it('first-use keep: the extension from before is marked, the one an agent installed after is not', async () => {
    await extension('before-ext', iso(-3_600_000), OWNER);
    await failedFirstStart(FIRST_USE_KEEP_STEP_KEY);
    await new Promise(r => setTimeout(r, 5));
    await extension('after-ext', iso(0), AGENT);
    const r = await keepExtensionFirstUseOnce(storage, config);
    expect(r.ran).toBe(true);
    expect(r.names).toEqual(['before-ext']);
  });

  it('publish keep: the agent-installed extension from before is kept, the one from after is not', async () => {
    await extension('agent-before', iso(-3_600_000), AGENT);
    await failedFirstStart(PUBLISH_KEEP_STEP_KEY);
    await new Promise(r => setTimeout(r, 5));
    await extension('agent-after', iso(0), AGENT);
    const r = await keepExtensionPublishOnce(storage, config);
    expect(r.names).toEqual(['agent-before']);
  });

  it('ai-schedule keep: the agent\'s schedule from before is kept, the one made after is not', async () => {
    await aiSchedule('job-before', iso(-3_600_000));
    await failedFirstStart(AI_SCHEDULE_READ_KEEP_KEY);
    await new Promise(r => setTimeout(r, 5));
    await aiSchedule('job-after', iso(0));
    const r = await keepAiScheduleReadsOnce(storage, config);
    expect(r.ids).toEqual(['job-before']);
  });

  it('a step that runs once on its first start keeps exactly what it kept before', async () => {
    await extension('only-ext', iso(-3_600_000), AGENT);
    await aiSchedule('only-job', iso(-3_600_000));
    expect((await keepExtensionFirstUseOnce(storage, config)).names).toEqual(['only-ext']);
    expect((await keepExtensionPublishOnce(storage, config)).names).toEqual(['only-ext']);
    expect((await keepAiScheduleReadsOnce(storage, config)).ids).toEqual(['only-job']);
  });

  it('app-tool keep: a later run\'s existedBefore does not reach past the first try', async () => {
    await failedFirstStart(APP_TOOL_INVOKE_KEEP_KEY);
    const firstTry = (await storage.getMemory(SYSTEM, ruleSinceKey(APP_TOOL_INVOKE_KEEP_KEY)))!.value as { at: string };
    await new Promise(r => setTimeout(r, 5));
    // An agent made after the first try, which called app tools without the word: a later run whose
    // boot clock is later still must not count it as existing before.
    await storage.createAgent({
      name: 'helper', owner: OWNER, gaii: AGENT, publicKey: 'k', trustScore: 50, morselBalance: 0, capabilities: [],
      defaultScopes: ['memory:read'], createdAt: iso(0), lastSeen: iso(0),
    } as never);
    await storage.appendUsageCall([{
      id: randomUUID(), ts: iso(0), ownerGhii: `${OWNER}@${NODE_ID}`, actorGaii: AGENT, actorKind: 'agent', surface: 'apptool',
      coordinate: 'apptool:seller/tools.html/run', appId: 'seller/tools.html', counterpartyGhii: '', outcome: 'ok', reason: '',
      durationMs: 0, chargedUnits: 0, unit: '', currency: '', entitlementId: '', runId: '', meta: {},
    }]);
    const r = await keepAppToolInvokeOnce(storage, config, { existedBefore: iso(60_000) });
    expect(r.ran).toBe(true);
    expect(r.kept.map(p => p.id)).not.toContain(AGENT);
    expect(Date.parse(firstTry.at)).toBeLessThan(Date.now());
  });
});
