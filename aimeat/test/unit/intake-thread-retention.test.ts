/**
 * @file test/unit/intake-thread-retention.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The visitor conversations of a public intake form are deleted on their date by the
 *   scheduled job core:intake-thread-retention, whatever state the form is in. Until 2026-10-15 the
 *   deletion ran only when a new conversation started on the same form, so a form nobody wrote to
 *   kept everything, and a deleted form could never start the deletion again (feature-list audit
 *   #64). Driven against in-memory SQLite; the job and its registration are the code under test.
 * @usage cd aimeat && pnpm exec vitest run test/unit/intake-thread-retention.test.ts
 * @version-history
 *   2026-10-15 — Initial (feature-list audit #64).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { runIntakeThreadRetention, registerThreadForm, entryOfFormConfig } from '../../src/services/intake-thread-retention.js';
import { seedCoreScheduledJobs } from '../../src/services/job-seeding.js';
import { registerCoreHandlers } from '../../src/services/core-jobs.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, OrganismRecord, OrganismMembershipRecord } from '../../src/storage/interface.js';
import type { Scheduler } from '../../src/services/scheduler.js';

const NODE = 'test-node';
const ALICE = `alice@${NODE}`;
const ORG = 'org-chat';
const WS = 'ws1';
const ROOT = `organism.${ORG}.w.${WS}`;
const DAY = 86_400_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const FORM_CFG = {
  formId: 'chat', orgId: ORG, ws: WS, namespace: 'chat.threads', ownerGhii: ALICE, allowedFields: [], requiredFields: [],
  defaults: {}, mode: 'publish', honeypotField: null, enabled: true, discoverable: true, maxPerDay: null, title: 'Chat',
  fields: [], successMessage: '', redirectUrl: null, createdAt: iso(0), updatedAt: iso(0),
  thread: { replyNamespace: 'chat.replies', signalNamespace: 'chat.signals', maxTurns: 20, maxChars: 2000, ttlDays: 30, maxAgentTurnsPerDay: 300 },
};

describe('the intake conversation retention job', () => {
  let storage: InstanceType<typeof SqliteStorage>;

  const put = (key: string, value: unknown) => storage.setMemory({
    key, ownerGaii: ALICE, value, visibility: 'owner', tags: [], ttlHours: null, version: 1, createdAt: iso(0), updatedAt: iso(0),
  });
  /** One conversation: the thread record (with a version row), its reply and its signal. */
  async function conversation(id: string, lastTurnMsAgo: number, formId = 'chat'): Promise<void> {
    const at = iso(lastTurnMsAgo);
    const thread = { id, form_id: formId, started_at: at, updated_at: at, turns: [{ text: 'hello', at }], signalled_turn: 1 };
    await put(`${ROOT}.chat.threads.${id}.latest`, thread);
    await put(`${ROOT}.chat.threads.${id}.version.1`, thread);
    await put(`${ROOT}.chat.replies.${id}.latest`, { id, replies: [{ text: 'hi', at }] });
    await put(`${ROOT}.chat.signals.${id}.latest`, { id, thread: id, turn: 1, at });
  }
  const left = async (id: string) => {
    const keys: string[] = [];
    for (const ns of ['chat.threads', 'chat.replies', 'chat.signals']) {
      const { items } = await storage.listAllMemory({ prefix: `${ROOT}.${ns}.${id}.`, limit: 100 });
      keys.push(...items.map((r) => r.key));
    }
    return keys;
  };
  const registry = async () => (await storage.getMemory(`system@${NODE}`, 'intake.thread-forms'))?.value as { forms: Record<string, unknown>; backfilledAt?: string } | undefined;

  beforeEach(async () => {
    storage = new SqliteStorage(':memory:');
    await storage.createOrganism({
      id: ORG, name: 'Org', description: 'x', type: 'project', interests: [], creatorGhii: 'alice', admins: ['alice'],
      members: ['alice'], agentGaiis: [], boardId: 'b1', joinPolicy: 'open', maxMembers: 10, visibility: 'private',
      moderationConfig: { flagsEnabled: true, autoHideThreshold: 5, appealsEnabled: false },
      memoryNamespace: `organism.${ORG}`, createdAt: iso(0), updatedAt: iso(0),
    } as OrganismRecord);
    await storage.createMembership({ id: 'm1', organismId: ORG, ghii: 'alice', role: 'creator', status: 'active', joinedAt: iso(0) } as OrganismMembershipRecord);
    await put(`organism.${ORG}.meta.workspaces`, { workspaces: [{ id: WS, name: 'Chat', createdBy: 'alice' }] });
    await put(`${ROOT}.meta.intake.chat`, FORM_CFG);
  });
  afterEach(() => { storage.close(); });

  it('a form defined before the registry existed is found, and only its expired conversations go', async () => {
    await conversation('told', 31 * DAY);
    await conversation('fresh', 2 * DAY);
    await conversation('other-form', 90 * DAY, 'someone-else');
    const removed = await runIntakeThreadRetention(storage as unknown as Storage, NODE);
    expect(removed).toBe(1);
    expect(await left('told')).toEqual([]);
    expect((await left('fresh')).length).toBe(4);
    // Another form's record in the same space is not this form's to delete.
    expect((await left('other-form')).length).toBe(4);
    expect((await registry())?.backfilledAt).toBeTruthy();
  });

  it('a form switched off still has its conversations deleted on their date', async () => {
    await put(`${ROOT}.meta.intake.chat`, { ...FORM_CFG, enabled: false });
    await conversation('old', 40 * DAY);
    expect(await runIntakeThreadRetention(storage as unknown as Storage, NODE)).toBe(1);
    expect(await left('old')).toEqual([]);
  });

  it('a deleted form keeps its entry until its last conversation is deleted, then the entry goes', async () => {
    await registerThreadForm(storage as unknown as Storage, NODE, entryOfFormConfig(ORG, WS, FORM_CFG as never)!);
    await storage.deleteMemory(ALICE, `${ROOT}.meta.intake.chat`);
    await conversation('later', 10 * DAY);
    await runIntakeThreadRetention(storage as unknown as Storage, NODE);
    expect((await left('later')).length).toBe(4);
    expect(Object.keys((await registry())!.forms)).toHaveLength(1);
    // Time passes: thirty days after the last turn the node deletes it without the form.
    const removed = await runIntakeThreadRetention(storage as unknown as Storage, NODE, Date.now() + 21 * DAY);
    expect(removed).toBe(1);
    expect(await left('later')).toEqual([]);
    expect(Object.keys((await registry())!.forms)).toHaveLength(0);
  });

  it('the owner\'s changed keeping time counts while the form exists', async () => {
    await registerThreadForm(storage as unknown as Storage, NODE, entryOfFormConfig(ORG, WS, FORM_CFG as never)!);
    await put(`${ROOT}.meta.intake.chat`, { ...FORM_CFG, thread: { ...FORM_CFG.thread, ttlDays: 7 } });
    await conversation('week', 8 * DAY);
    expect(await runIntakeThreadRetention(storage as unknown as Storage, NODE)).toBe(1);
  });

  it('is seeded as a scheduled job and has its handler registered', async () => {
    const plain = { consentEnabled: false, personalNodesEnabled: false, emailEnabled: false, nodeId: NODE } as unknown as AimeatConfig;
    const created: string[] = [];
    await seedCoreScheduledJobs(plain, { getScheduledJob: async () => null, createScheduledJob: async (j: { id: string }) => { created.push(j.id); } } as unknown as Storage);
    expect(created).toContain('core:intake-thread-retention');
    const handlers = new Map<string, () => Promise<void>>();
    registerCoreHandlers({ registerCoreHandler: (n: string, fn: () => Promise<void>) => { handlers.set(n, fn); } } as unknown as Scheduler, plain, storage as unknown as Storage);
    expect(handlers.has('intake-thread-retention')).toBe(true);
    await conversation('via-job', 45 * DAY);
    await handlers.get('intake-thread-retention')!();
    expect(await left('via-job')).toEqual([]);
  });
});
