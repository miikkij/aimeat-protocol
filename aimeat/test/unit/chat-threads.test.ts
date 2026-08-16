/**
 * @file chat-threads.test.ts
 * @description Unit tests for where a chat conversation lives.
 *
 *   Two ceilings are the reason this file exists, and both are the kind that only bite after months
 *   of ordinary use: a memory namespace holds 1000 keys, so one key per conversation forever spends
 *   them, and one value holds 1024 kB, so a long conversation eventually fails to save — losing the
 *   newest turn, which is the one that mattered. The tests pin the rolling and the trimming rather
 *   than the happy path.
 * @usage cd aimeat && pnpm vitest run test/unit/chat-threads.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-16 — initial: create/append/read/list, titling, turn trim, archive rollover.
 */
import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, GHIIRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import {
  createThread, appendTurn, readThread, listThreads, deleteThread,
  archiveOverflow, setGooseSession, MAX_TURNS_PER_THREAD,
} from '../../src/services/chat-threads.js';

const NODE = 'node-test';
const GAII = `alice@${NODE}`;

const cfg = (over: Record<string, unknown> = {}): AimeatConfig =>
  ({ nodeId: NODE, chatMaxLiveThreads: 50, ...over }) as unknown as AimeatConfig;

function assert(cond: boolean, msg: string): void {
  expect(cond, msg).toBe(true);
}

async function freshStorage(): Promise<Storage> {
  const storage = new SqliteStorage(':memory:');
  const now = new Date().toISOString();
  const ghii: GHIIRecord = {
    username: 'alice', nodeId: NODE, ghii: GAII, displayName: 'alice',
    verificationLevel: 0, ownerName: 'alice', createdAt: now, updatedAt: now, totpEnabled: false,
  };
  await storage.createGHII(ghii);
  return storage as unknown as Storage;
}

const turn = (role: 'user' | 'agent', text: string, at = new Date().toISOString()) =>
  ({ role, text, at });

describe('a conversation', () => {
  it('round-trips through storage', async () => {
    const storage = await freshStorage();
    const t = await createThread(storage, cfg(), GAII);

    await appendTurn(storage, GAII, t.id, turn('user', 'build me pong'));
    await appendTurn(storage, GAII, t.id, turn('agent', 'Done, it is live.'));

    const read = await readThread(storage, GAII, t.id);
    assert(read?.turns.length === 2, `two turns, got ${read?.turns.length}`);
    assert(read?.turns[0]?.text === 'build me pong', 'the first turn is what was said');
    assert(read?.turns[1]?.role === 'agent', 'the second is the answer');

    storage.close?.();
  });

  it('takes its title from the first thing the person said', async () => {
    // A list of conversations all called "New chat" is a list nobody can use.
    const storage = await freshStorage();
    const t = await createThread(storage, cfg(), GAII);
    assert(t.title === 'New chat', 'starts as a placeholder');

    await appendTurn(storage, GAII, t.id, turn('user', 'make me a pong game with two paddles'));
    const read = await readThread(storage, GAII, t.id);
    assert(read?.title.startsWith('make me a pong game'), `titled from the first ask, got "${read?.title}"`);

    await appendTurn(storage, GAII, t.id, turn('user', 'now change the colours'));
    const again = await readThread(storage, GAII, t.id);
    assert(again?.title.startsWith('make me a pong game'), 'and the second ask does not rename it');

    storage.close?.();
  });

  it('an agent turn does not steal the title', async () => {
    const storage = await freshStorage();
    const t = await createThread(storage, cfg(), GAII);
    await appendTurn(storage, GAII, t.id, turn('agent', 'Hello, what shall we build?'));
    const read = await readThread(storage, GAII, t.id);
    assert(read?.title === 'New chat', `still the placeholder, got "${read?.title}"`);
    storage.close?.();
  });

  it('trims the oldest turns rather than growing past what a record can hold', async () => {
    // Growing past the value ceiling would fail the save, and the turn that fails is the newest one.
    const storage = await freshStorage();
    const t = await createThread(storage, cfg(), GAII);

    for (let i = 0; i < MAX_TURNS_PER_THREAD + 25; i++) {
      await appendTurn(storage, GAII, t.id, turn('user', `turn ${i}`));
    }

    const read = await readThread(storage, GAII, t.id);
    assert(read?.turns.length === MAX_TURNS_PER_THREAD, `capped at ${MAX_TURNS_PER_THREAD}, got ${read?.turns.length}`);
    assert(read?.turns.at(-1)?.text === `turn ${MAX_TURNS_PER_THREAD + 24}`, 'the newest turn survives');
    assert(read?.turns[0]?.text === 'turn 25', 'the oldest went, not the newest');

    storage.close?.();
  });

  it('lists newest first', async () => {
    const storage = await freshStorage();
    const a = await createThread(storage, cfg(), GAII, 'first');
    const b = await createThread(storage, cfg(), GAII, 'second');
    await appendTurn(storage, GAII, a.id, turn('user', 'later', new Date(Date.now() + 60_000).toISOString()));

    const list = await listThreads(storage, GAII);
    assert(list.length === 2, `two conversations, got ${list.length}`);
    assert(list[0]?.id === a.id, 'the one touched most recently is first');
    assert(list[1]?.id === b.id, 'the other follows');

    storage.close?.();
  });

  it('remembers, and can forget, which goose session it is running on', async () => {
    const storage = await freshStorage();
    const t = await createThread(storage, cfg(), GAII);

    await setGooseSession(storage, GAII, t.id, '20260816_1');
    assert((await readThread(storage, GAII, t.id))?.gooseSessionId === '20260816_1', 'attached');

    // Forgetting matters: the agent process restarts and the id it handed out means nothing.
    await setGooseSession(storage, GAII, t.id, undefined);
    assert((await readThread(storage, GAII, t.id))?.gooseSessionId === undefined, 'detached');

    storage.close?.();
  });

  it('deletes', async () => {
    const storage = await freshStorage();
    const t = await createThread(storage, cfg(), GAII);
    await deleteThread(storage, GAII, t.id);
    assert(await readThread(storage, GAII, t.id) === null, 'gone');
    assert((await listThreads(storage, GAII)).length === 0, 'and out of the list');
    storage.close?.();
  });
});

describe('the archive', () => {
  it('keeps the live count at the ceiling, and every conversation stays reachable', async () => {
    // The point is the key COUNT: five conversations a day is 1825 keys a year against a ceiling of
    // 1000, so live threads have to stop accumulating. Rolling happens on the write path, so what is
    // asserted here is the END STATE rather than the return of a manual sweep.
    const storage = await freshStorage();
    const config = cfg({ chatMaxLiveThreads: 3 });

    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const t = await createThread(storage, config, GAII, `chat ${i}`);
      await appendTurn(storage, GAII, t.id, turn('user', `hi ${i}`, new Date(Date.UTC(2026, 4, 1 + i)).toISOString()));
      ids.push(t.id);
    }
    await archiveOverflow(storage, config, GAII);

    const live = await listThreads(storage, GAII);
    assert(live.length === 3, `never more than the ceiling stays open, got ${live.length}`);

    // Nothing was lost: every conversation is either open or inside a month record.
    const archives = await storage.listMemory(GAII, { prefix: 'chat.archive.' });
    const archivedIds = archives.flatMap((r) => ((r.value as { threads?: Array<{ id: string }> }).threads ?? []).map((x) => x.id));
    const accountedFor = new Set([...live.map((t) => t.id), ...archivedIds]);
    assert(ids.every((id) => accountedFor.has(id)), 'every conversation is either open or archived');
    assert(archivedIds.length === 3, `three were rolled away, got ${archivedIds.length}`);

    storage.close?.();
  });

  it('does nothing while there is room', async () => {
    const storage = await freshStorage();
    const config = cfg({ chatMaxLiveThreads: 10 });
    await createThread(storage, config, GAII);
    await createThread(storage, config, GAII);

    assert(await archiveOverflow(storage, config, GAII) === 0, 'nothing to roll');
    assert((await listThreads(storage, GAII)).length === 2, 'both still open');

    storage.close?.();
  });

  it('adds to the month that already exists instead of replacing it', async () => {
    const storage = await freshStorage();
    const config = cfg({ chatMaxLiveThreads: 1 });
    const when = new Date(Date.UTC(2026, 4, 9)).toISOString();

    // Four conversations, all stamped into the same month, with room for one open at a time.
    for (let i = 0; i < 4; i++) {
      const t = await createThread(storage, config, GAII, `round ${i}`);
      await appendTurn(storage, GAII, t.id, turn('user', 'x', when));
      await archiveOverflow(storage, config, GAII);
    }

    const bundle = (await storage.getMemory(GAII, 'chat.archive.2026-05'))?.value as { threads?: unknown[] };
    assert((bundle?.threads?.length ?? 0) === 3, `the month accumulated rather than being replaced, got ${bundle?.threads?.length}`);
    assert((await listThreads(storage, GAII)).length === 1, 'one stays open');

    storage.close?.();
  });
});
