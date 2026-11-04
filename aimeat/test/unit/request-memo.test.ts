/**
 * @file test/unit/request-memo.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rules of the request memo (services/request-memo.ts): one read per request for
 *   the same record, and a read of storage every time the memo cannot be sure: outside a request, after
 *   the response, after any write, for a storage nobody prepared, after a failed read and after
 *   MEMO_MAX_AGE_MS.
 * @usage cd aimeat && pnpm exec vitest run test/unit/request-memo.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item C2).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { requestContext, type RequestScope } from '../../src/utils/request-context.js';
import { installRequestMemo, memoGetAgent, memoGetOwner, MEMO_MAX_AGE_MS } from '../../src/services/request-memo.js';
import type { Storage } from '../../src/storage/interface.js';

class FakeStore {
  reads = 0;
  agent: { gaii: string; description: string } | null = { gaii: 'a#o@n', description: 'first' };
  failNext = false;
  async getAgent(_gaii: string) {
    this.reads++;
    if (this.failNext) { this.failNext = false; throw new Error('read failed'); }
    return this.agent ? { ...this.agent } : null;
  }
  async getOwner(_name: string) { this.reads++; return { name: 'o' }; }
  async updateAgent(_gaii: string, patch: { description: string }) {
    if (this.agent) this.agent.description = patch.description;
    return this.agent;
  }
}

function prepared(): { store: FakeStore; storage: Storage } {
  const store = new FakeStore();
  const storage = store as unknown as Storage;
  installRequestMemo(storage);
  return { store, storage };
}

/** Run `fn` inside an open request scope, as middleware/request-id.ts opens one. */
function inRequest<T>(fn: (scope: RequestScope) => Promise<T>): Promise<T> {
  const scope: RequestScope = { open: true };
  return requestContext.run({ requestId: 'req-test', scope }, () => fn(scope));
}

afterEach(() => { vi.useRealTimers(); });

describe('request memo (codebase analysis 2026-11-03, C2)', () => {
  it('reads once per request for the same record, and keeps the agent and the owner apart', async () => {
    const { store, storage } = prepared();
    await inRequest(async () => {
      const a = await memoGetAgent(storage, 'a#o@n');
      const b = await memoGetAgent(storage, 'a#o@n');
      await memoGetOwner(storage, 'o');
      expect(a).toEqual(b);
    });
    expect(store.reads).toBe(2);
  });

  it('reads every time outside a request', async () => {
    const { store, storage } = prepared();
    await memoGetAgent(storage, 'a#o@n');
    await memoGetAgent(storage, 'a#o@n');
    expect(store.reads).toBe(2);
  });

  it('reads every time after the response (a closed scope)', async () => {
    const { store, storage } = prepared();
    await inRequest(async (scope) => {
      await memoGetAgent(storage, 'a#o@n');
      scope.open = false;
      await memoGetAgent(storage, 'a#o@n');
    });
    expect(store.reads).toBe(2);
  });

  it('reads every time from a storage installRequestMemo did not prepare', async () => {
    const store = new FakeStore();
    await inRequest(async () => {
      await memoGetAgent(store as unknown as Storage, 'a#o@n');
      await memoGetAgent(store as unknown as Storage, 'a#o@n');
    });
    expect(store.reads).toBe(2);
  });

  it('a write in the request makes the next read see it', async () => {
    const { store, storage } = prepared();
    await inRequest(async () => {
      expect((await memoGetAgent(storage, 'a#o@n'))?.description).toBe('first');
      await storage.updateAgent('a#o@n', { description: 'second' } as never);
      expect((await memoGetAgent(storage, 'a#o@n'))?.description).toBe('second');
    });
    expect(store.reads).toBe(2);
  });

  it('a failed read is not kept: the caller gets the error and the next asker reads again', async () => {
    const { store, storage } = prepared();
    store.failNext = true;
    await inRequest(async () => {
      await expect(memoGetAgent(storage, 'a#o@n')).rejects.toThrow('read failed');
      expect((await memoGetAgent(storage, 'a#o@n'))?.description).toBe('first');
    });
    expect(store.reads).toBe(2);
  });

  it(`an answer older than ${MEMO_MAX_AGE_MS} ms is read again`, async () => {
    const { store, storage } = prepared();
    vi.useFakeTimers({ toFake: ['Date'] });
    await inRequest(async () => {
      await memoGetAgent(storage, 'a#o@n');
      vi.setSystemTime(Date.now() + MEMO_MAX_AGE_MS + 1);
      await memoGetAgent(storage, 'a#o@n');
    });
    expect(store.reads).toBe(2);
  });

  it('a missing record is answered as missing, once', async () => {
    const { store, storage } = prepared();
    store.agent = null;
    await inRequest(async () => {
      expect(await memoGetAgent(storage, 'a#o@n')).toBeNull();
      expect(await memoGetAgent(storage, 'a#o@n')).toBeNull();
    });
    expect(store.reads).toBe(1);
  });
});
