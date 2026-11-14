/**
 * @file test/unit/help-storage.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description HelpRepository (Ask someone who knows) behaves the same on both storage providers: the
 *   participant row round trip with its JSON topics and nullable asker, the helpers list, a question
 *   replaced only on the version it read (the second writer loses), the routes per question, per
 *   helper and per thread, the due and pending lists, the owner erasure (their questions with routes,
 *   the routes that sent questions to them, their participant row) and the purge of closed questions
 *   that are not kept for others.
 *
 *   Runs SQLite always and PostgreSQL when DATABASE_URL is set (AIMEAT_CONFORMANCE_REQUIRE_POSTGRES=true
 *   makes a missing DATABASE_URL a failure). Every id carries a run tag, and the owner delete at the
 *   end removes what the run wrote.
 * @usage cd aimeat && pnpm exec vitest run test/unit/help-storage.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import type { HelpParticipantRecord, HelpQuestionRecord, HelpRouteRecord } from '../../src/storage/types/help.js';

const SQLITE_PATH = `./test/.help-storage-${process.pid}.db`;
const PG_URL = process.env.DATABASE_URL ?? '';
const REQUIRE_POSTGRES = process.env.AIMEAT_CONFORMANCE_REQUIRE_POSTGRES === 'true';
const RUN = randomUUID().slice(0, 8);
const NODE = 'help-node';
const ALICE = `alice-${RUN}@${NODE}`;
const BOB = `bob-${RUN}@${NODE}`;

interface Provider { name: string; storage: Storage }
const provs: Provider[] = [];

beforeAll(async () => {
  if (REQUIRE_POSTGRES && !PG_URL) throw new Error('Postgres conformance requires DATABASE_URL.');
  provs.push({ name: 'sqlite', storage: await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH }) });
  if (PG_URL) provs.push({ name: 'postgres-kysely', storage: await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL }) });
  else console.warn('[help-storage] DATABASE_URL not set — the Postgres half is skipped, sqlite still runs');
}, 60_000);

afterAll(async () => {
  for (const { storage } of provs) {
    for (const who of [ALICE, BOB]) await storage.deleteHelpDataByOwner(who).catch(() => 0);
    await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
  }
  for (const suffix of ['', '-wal', '-shm']) {
    const p = SQLITE_PATH + suffix;
    if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch file */ } }
  }
});

const T0 = '2026-11-14T10:00:00.000Z';
const T1 = '2026-11-14T11:00:00.000Z';

const participant = (owner: string, over: Partial<HelpParticipantRecord> = {}): HelpParticipantRecord => ({
  ownerGhii: owner, helper: true, asker: null, topics: ['Entra', 'PostgreSQL'], audience: 'node', capPerWeek: 2,
  status: 'available', statusUntil: null, aiMode: 'draft', autoTopics: [], aiMaySend: true, agentsMayAsk: false,
  createdAt: T0, updatedAt: T0, ...over,
});

const question = (id: string, owner: string, over: Partial<HelpQuestionRecord> = {}): HelpQuestionRecord => ({
  id, ownerGhii: owner, askedBy: owner, subject: 'Entra sign-in', question: 'How?', tried: 'Guest invite',
  topics: ['Entra'], attachments: [{ storage_key: 'files/a.pdf', mime: 'application/pdf', size: 10, kind: 'file', name: 'a.pdf' }],
  audience: 'people', state: 'open', answeredBy: null, answeredByAi: false, answer: '', thanks: '', rewardMorsels: 0,
  saved: false, savedConfirmedAt: null, stale: false, deadline: '2026-11-21T10:00:00.000Z', remindedAt: null,
  version: 1, createdAt: T0, updatedAt: T0, closedAt: null, ...over,
});

const route = (id: string, questionId: string, helper: string, over: Partial<HelpRouteRecord> = {}): HelpRouteRecord => ({
  id, questionId, helperGhii: helper, conversationId: `conv-${id}`, routedAt: T0, outcome: 'pending', outcomeAt: null,
  referredTo: null, draft: null, answer: '', answeredByAi: false, keepAllowed: false, ...over,
});

describe('HelpRepository on both providers', () => {
  it('a participant row round-trips; asker null means the default; helpers are listed', async () => {
    for (const { name, storage } of provs) {
      await storage.putHelpParticipant(participant(BOB));
      await storage.putHelpParticipant(participant(ALICE, { helper: false, asker: true }));
      const bob = await storage.getHelpParticipant(BOB);
      expect(bob, name).toMatchObject({ helper: true, asker: null, topics: ['Entra', 'PostgreSQL'], aiMode: 'draft' });
      await storage.putHelpParticipant(participant(BOB, { status: 'away', updatedAt: T1 }));
      expect((await storage.getHelpParticipant(BOB))?.status, name).toBe('away');
      const helpers = (await storage.listHelpers()).map(p => p.ownerGhii);
      expect(helpers, name).toContain(BOB);
      expect(helpers, name).not.toContain(ALICE);
      expect((await storage.getHelpParticipant(ALICE))?.asker, name).toBe(true);
    }
  });

  it('a question is replaced only on the version it read', async () => {
    for (const { name, storage } of provs) {
      const id = `hq_${RUN}${name.slice(0, 2)}a`;
      await storage.createHelpQuestion(question(id, ALICE));
      const q = await storage.getHelpQuestion(id);
      expect(q?.attachments[0]?.storage_key, name).toBe('files/a.pdf');
      expect(await storage.updateHelpQuestion({ ...q!, state: 'answered', answeredBy: BOB }, 1), name).toBe(true);
      expect(await storage.updateHelpQuestion({ ...q!, state: 'cancelled' }, 1), name).toBe(false);
      const after = await storage.getHelpQuestion(id);
      expect(after, name).toMatchObject({ state: 'answered', answeredBy: BOB, version: 2 });
      expect((await storage.listHelpQuestionsByOwner(ALICE)).some(x => x.id === id), name).toBe(true);
      expect((await storage.listHelpQuestions({ states: ['answered'] })).some(x => x.id === id), name).toBe(true);
      expect((await storage.listHelpQuestionsDue(['answered'], '2026-11-22T00:00:00.000Z')).some(x => x.id === id), name).toBe(true);
      expect((await storage.listHelpQuestionsDue(['answered'], '2026-11-20T00:00:00.000Z')).some(x => x.id === id), name).toBe(false);
    }
  });

  it('routes are found per question, per helper, per thread and while pending', async () => {
    for (const { name, storage } of provs) {
      const qid = `hq_${RUN}${name.slice(0, 2)}b`;
      await storage.createHelpQuestion(question(qid, ALICE));
      const rid = `hr_${RUN}${name.slice(0, 2)}b`;
      await storage.addHelpRoute(route(rid, qid, BOB));
      expect((await storage.listHelpRoutes(qid)).length, name).toBe(1);
      expect((await storage.listHelpRoutesForHelper(BOB, { since: T0 })).some(r => r.id === rid), name).toBe(true);
      expect((await storage.getHelpRouteByConversation(`conv-${rid}`))?.id, name).toBe(rid);
      expect((await storage.listPendingHelpRoutes(T1)).some(r => r.id === rid), name).toBe(true);
      await storage.updateHelpRoute(route(rid, qid, BOB, { outcome: 'answered', outcomeAt: T1, answer: 'Do this.', keepAllowed: true, draft: { answer: 'd', by: 'ai#bob@n', at: T1 } }));
      const r = (await storage.listHelpRoutes(qid))[0];
      expect(r, name).toMatchObject({ outcome: 'answered', answer: 'Do this.', keepAllowed: true });
      expect(r.draft?.by, name).toBe('ai#bob@n');
      expect((await storage.listPendingHelpRoutes(T1)).some(x => x.id === rid), name).toBe(false);
    }
  });

  it('closed questions not kept for others are purged with their routes; kept ones stay', async () => {
    for (const { name, storage } of provs) {
      const gone = `hq_${RUN}${name.slice(0, 2)}c`;
      const kept = `hq_${RUN}${name.slice(0, 2)}d`;
      await storage.createHelpQuestion(question(gone, ALICE, { state: 'solved', closedAt: T0 }));
      await storage.createHelpQuestion(question(kept, ALICE, { state: 'solved', closedAt: T0, saved: true }));
      await storage.addHelpRoute(route(`hr_${RUN}${name.slice(0, 2)}c`, gone, BOB));
      expect(await storage.purgeClosedHelpQuestions(T1), name).toBeGreaterThanOrEqual(1);
      expect(await storage.getHelpQuestion(gone), name).toBeNull();
      expect((await storage.listHelpRoutes(gone)).length, name).toBe(0);
      expect(await storage.getHelpQuestion(kept), name).not.toBeNull();
    }
  });

  it('erasing a person removes their questions with routes, the routes sent to them and their row', async () => {
    for (const { name, storage } of provs) {
      const q = `hq_${RUN}${name.slice(0, 2)}e`;
      await storage.createHelpQuestion(question(q, BOB));
      await storage.addHelpRoute(route(`hr_${RUN}${name.slice(0, 2)}e`, q, ALICE));
      expect(await storage.deleteHelpDataByOwner(BOB), name).toBeGreaterThan(0);
      expect(await storage.getHelpParticipant(BOB), name).toBeNull();
      expect(await storage.getHelpQuestion(q), name).toBeNull();
      expect((await storage.listHelpRoutesForHelper(BOB)).length, name).toBe(0);
      expect((await storage.listHelpRoutesForHelper(ALICE)).some(r => r.questionId === q), name).toBe(false);
    }
  });
});
