/**
 * @file test/unit/classification-clearance.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An agent's clearance (plan doc-mvdipuyqraas, L2) on a real SQLite store with the
 *   switch on for everyone: the reader hides, refuses and keeps behind what ranks above the agent's
 *   clearance, its own label or its container's; a person, an agent without a clearance and a
 *   classification switched off are not limited; the agent record is read once per reader; and who
 *   may set it: the owner in person any way, an agent of the owner only lower and never its own,
 *   another owner never; an unknown label is refused; a dry run writes nothing; a new agent takes the
 *   node's start value.
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvdipuyqraas, L2).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AgentRecord, ContentLabelTarget } from '../../src/storage/interface.js';
import { memoryTarget } from '../../src/services/classification/labels.js';
import { workspaceTarget } from '../../src/services/classification/containers.js';
import { readerFor, readerForAgent } from '../../src/services/classification/reader.js';
import { clearanceFor } from '../../src/services/classification/clearance.js';
import { setAgentClearance, newAgentClearance } from '../../src/services/agent-clearance.js';
import { callerFromAuth } from '../../src/services/caller-context.js';
import type { AimeatConfig } from '../../src/config.js';

// A node id of the real shape: an agent's identity is recognised only when it is a whole GAII.
const N = 'unit-node';
const ALICE = `alice@${N}`;
const BOT = `bot#alice@${N}`;
const HELPER = `helper#alice@${N}`;
const MALLORY = `mal#bob@${N}`;
const cfg = { classificationMode: 'all' as const, nodeId: N, agentClearanceDefault: '' };
const deps = (storage: SqliteStorage) => ({ storage, config: cfg as unknown as AimeatConfig });

async function put(storage: SqliteStorage, t: ContentLabelTarget, label: string): Promise<void> {
  await storage.putContentLabel({
    ...t, id: `row-${t.kind}-${t.key}`, ownerGaii: null, label, source: 'human', locked: true,
    suggestion: null, justification: null, humanSaid: null, history: [], setBy: ALICE, updatedAt: '2026-10-18T00:00:00.000Z',
  });
}

async function agent(storage: SqliteStorage, gaii: string, extra: Partial<AgentRecord> = {}): Promise<void> {
  const [name, rest] = gaii.split('#');
  const owner = rest!.split('@')[0]!;
  await storage.createAgent({
    name: name!, owner, gaii, capabilities: [], publicKey: 'pk', trustScore: 0, morselBalance: 0,
    createdAt: '2026-10-18T00:00:00.000Z', lastSeen: '2026-10-18T00:00:00.000Z', defaultScopes: ['*'], ...extra,
  });
}

const owner = (storage: SqliteStorage, name = 'alice') => callerFromAuth({ sub: name, owner: name, roles: ['owner'], scopes: [] }, N, storage);
const asAgent = (storage: SqliteStorage, gaii: string, scopes: string[]) =>
  callerFromAuth({ sub: gaii, owner: gaii.split('#')[1]!.split('@')[0]!, roles: ['agent'], scopes }, N, storage);

const PUBLIC = memoryTarget(ALICE, 'notes.public');
const INTERNAL = memoryTarget(ALICE, 'notes.internal');
const SECRET = memoryTarget(ALICE, 'notes.secret');
const IN_WS = memoryTarget(ALICE, 'organism.o1.w.ws1.items.plan');

describe('the reader and an agent\'s clearance', () => {
  let storage: SqliteStorage;
  beforeEach(async () => {
    storage = new SqliteStorage(':memory:');
    await put(storage, PUBLIC, 'julkinen');
    await put(storage, INTERNAL, 'sisainen');
    await put(storage, SECRET, 'luottamuksellinen');
    await put(storage, IN_WS, 'julkinen');
    await put(storage, workspaceTarget('o1', 'ws1'), 'luottamuksellinen');
  });
  afterEach(() => storage.close());
  const all = [PUBLIC, INTERNAL, SECRET, IN_WS];

  it('hides what ranks above the clearance, by its own label or its workspace\'s, and audits each as refused', async () => {
    await agent(storage, BOT, { clearance: 'sisainen' });
    const shown = await readerForAgent(deps(storage), BOT).show(all, t => t);
    expect(shown.map(t => t.key)).toEqual(['notes.public', 'notes.internal']);
  });

  it('shows everything to an agent with no clearance, to the owner, and when classification is off', async () => {
    await agent(storage, BOT);
    expect(await readerForAgent(deps(storage), BOT).show(all, t => t)).toHaveLength(4);
    await storage.updateAgent(BOT, { clearance: 'sisainen' });
    const person = readerFor(deps(storage), { sub: 'alice', owner: 'alice', roles: ['owner'] });
    expect(await person.show(all, t => t)).toHaveLength(4);
    const off = { storage, config: { ...cfg, classificationMode: 'off' as const } as unknown as AimeatConfig };
    expect(await readerForAgent(off, BOT).show(all, t => t)).toHaveLength(4);
  });

  it('refuses an AI call with content above the clearance, and keeps it behind on the way out', async () => {
    await agent(storage, BOT, { clearance: 'sisainen' });
    const reader = readerForAgent(deps(storage), BOT);
    await expect(reader.useForAi([PUBLIC, SECRET], { capability: 'chat' })).rejects.toMatchObject({ code: 'CLASSIFIED' });
    await expect(reader.useForAi([PUBLIC, INTERNAL], { capability: 'chat' })).resolves.toBeUndefined();
    const out = await reader.leave([PUBLIC, IN_WS], t => t, { kind: 'external', to: 'mail' });
    expect(out.kept.map(t => t.key)).toEqual(['notes.public']);
    expect(out.left).toHaveLength(1);
    expect(out.left[0]!.from).toBe('workspace');
    expect(out.left[0]!.reason).toMatch(/above what this agent may read/);
  });

  it('reads the agent record once per reader, and not at all for a person', async () => {
    await agent(storage, BOT, { clearance: 'sisainen' });
    const spy = vi.spyOn(storage, 'getAgent');
    await readerForAgent(deps(storage), BOT).show(all, t => t);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();
    await readerFor(deps(storage), { sub: 'alice', owner: 'alice', roles: ['owner'] }).show(all, t => t);
    expect(spy).not.toHaveBeenCalled();
  });

  it('fails closed on a clearance the policy no longer has: everything classified is hidden', async () => {
    await agent(storage, BOT, { clearance: 'poistettu' });
    expect(await readerForAgent(deps(storage), BOT).show(all, t => t)).toEqual([]);
  });

  it('clearanceFor never refuses a person, an ecosystem app or a personal access token', async () => {
    const label = { rank: 999 } as never;
    for (const who of [{ kind: 'human', principal: ALICE }, { kind: 'ai', principal: `eco:drum#alice@${N}` }, { kind: 'ai', principal: ALICE }]) {
      expect(await clearanceFor(deps(storage), who).refuses(label, {} as never)).toBe(false);
    }
  });
});

describe('setAgentClearance: who may set it, and which way', () => {
  let storage: SqliteStorage;
  beforeEach(async () => {
    storage = new SqliteStorage(':memory:');
    await agent(storage, BOT);
    await agent(storage, HELPER);
    await agent(storage, MALLORY);
  });
  afterEach(() => storage.close());

  it('the owner in person sets, raises and removes it', async () => {
    const me = owner(storage);
    expect(await setAgentClearance(deps(storage), me, 'bot', 'sisainen')).toMatchObject({ ok: true, changed: true, from: null });
    expect((await storage.getAgent(BOT))?.clearance).toBe('sisainen');
    expect(await setAgentClearance(deps(storage), me, 'bot', 'luottamuksellinen')).toMatchObject({ ok: true, from: 'sisainen' });
    expect(await setAgentClearance(deps(storage), me, 'bot', null)).toMatchObject({ ok: true, changed: true });
    expect((await storage.getAgent(BOT))?.clearance ?? null).toBeNull();
    expect(await setAgentClearance(deps(storage), me, 'bot', null)).toMatchObject({ ok: true, changed: false });
  });

  it('an agent of the owner lowers another agent\'s, and may not raise it, remove it or change its own', async () => {
    const helper = asAgent(storage, HELPER, ['agent:permissions']);
    expect(await setAgentClearance(deps(storage), helper, 'bot', 'luottamuksellinen')).toMatchObject({ ok: true, changed: true });
    expect(await setAgentClearance(deps(storage), helper, 'bot', 'sisainen')).toMatchObject({ ok: true, changed: true });
    expect(await setAgentClearance(deps(storage), helper, 'bot', 'luottamuksellinen')).toMatchObject({ ok: false, status: 403, code: 'PERSON_REQUIRED' });
    expect(await setAgentClearance(deps(storage), helper, 'bot', null)).toMatchObject({ ok: false, status: 403, code: 'PERSON_REQUIRED' });
    const bot = asAgent(storage, BOT, ['*', 'agent:permissions']);
    expect(await setAgentClearance(deps(storage), bot, 'bot', null)).toMatchObject({ ok: false, status: 403, code: 'ACCESS_DENIED' });
    expect(await setAgentClearance(deps(storage), bot, 'bot', 'julkinen')).toMatchObject({ ok: false, status: 403, code: 'ACCESS_DENIED' });
    expect((await storage.getAgent(BOT))?.clearance).toBe('sisainen');
  });

  it('refuses another owner, an unknown label, and an app grant', async () => {
    const bob = owner(storage, 'bob');
    expect(await setAgentClearance(deps(storage), bob, BOT, 'julkinen')).toMatchObject({ ok: false, status: 403, code: 'ACCESS_DENIED' });
    expect(await setAgentClearance(deps(storage), bob, 'bot', 'julkinen')).toMatchObject({ ok: false, status: 404 });
    expect(await setAgentClearance(deps(storage), owner(storage), 'bot', 'salainen')).toMatchObject({ ok: false, status: 400, code: 'INVALID_INPUT' });
    const app = callerFromAuth({ sub: 'alice', owner: 'alice', roles: ['app'], scopes: ['*'] }, N, storage);
    expect(await setAgentClearance(deps(storage), app, 'bot', 'julkinen')).toMatchObject({ ok: false, status: 403 });
    expect((await storage.getAgent(BOT))?.clearance ?? null).toBeNull();
  });

  it('a dry run checks everything and writes nothing', async () => {
    const helper = asAgent(storage, HELPER, ['agent:permissions']);
    expect(await setAgentClearance(deps(storage), helper, 'bot', 'sisainen', { dryRun: true })).toMatchObject({ ok: true, changed: true });
    expect((await storage.getAgent(BOT))?.clearance ?? null).toBeNull();
  });
});

describe('newAgentClearance: the node\'s start value for a new agent', () => {
  it('is nothing by default and the setting when one is set', () => {
    expect(newAgentClearance({ agentClearanceDefault: '' })).toEqual({});
    expect(newAgentClearance({ agentClearanceDefault: 'sisainen' })).toEqual({ clearance: 'sisainen' });
  });
});
