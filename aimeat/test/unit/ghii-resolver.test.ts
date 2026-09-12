/**
 * @file test/unit/ghii-resolver.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What resolveGhii may return, on every branch it has.
 *
 *   The whole point of these four is the value that must NEVER come back: a bare account name.
 *   `alice` instead of `alice@node-id` is invisible to list, search and update, so a moderation
 *   verdict, a review or a package author filed under it is filed nowhere a person can find. Until
 *   2026-09-12 the helper took a fallback identity from its caller and every route handed it
 *   `req.auth!.sub`, which on an owner session is exactly that bare name — and a `catch` returned it
 *   for a database disturbance too, silently.
 *
 *   The storage double is two lines on purpose. A test that stands up a provider proves the
 *   provider; these ask what the helper does with what it is handed, including the one answer no
 *   integration test can produce on demand — a lookup that throws.
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial. wish-identity-gate-sees-resolveghii, acceptance criterion 4.
 */
import { describe, it, expect } from 'vitest';
import type { Storage } from '../../src/storage/interface.js';
import type { GHIIRecord } from '../../src/models/types.js';
import { resolveGhii } from '../../src/utils/ghii-resolver.js';

const NODE = { nodeId: 'aimeat-test-001' };

/** A storage whose only interesting method is the one this helper calls. */
const storageThat = (answer: () => Promise<GHIIRecord | null>): Storage =>
  ({ getGHIIByOwner: answer } as unknown as Storage);

describe('resolveGhii', () => {
  it('returns the GHII on the record when the owner has one', async () => {
    const storage = storageThat(async () => ({ ghii: 'alice@somewhere-else' } as GHIIRecord));
    expect(await resolveGhii(storage, 'alice', NODE)).toBe('alice@somewhere-else');
  });

  it('composes the GHII this node would have created when the owner has no record', async () => {
    // An imported account or an unfinished migration. Every GHII this node creates is
    // `${username}@${config.nodeId}` (owner-provisioning.ts, register-login.ts, admin.ts,
    // setup.ts), so the composed form is the same string the missing record would have carried.
    const storage = storageThat(async () => null);
    expect(await resolveGhii(storage, 'alice', NODE)).toBe('alice@aimeat-test-001');
  });

  it('lets a storage fault through rather than answering it with a guess', async () => {
    // The behaviour this replaces: `catch { return fallback }` answered a database disturbance with
    // the caller's `sub` and told nobody, so a verdict could be filed under the wrong identity by a
    // moment's trouble. A fault is not a missing record, and the route answering 500 is the honest
    // outcome.
    const storage = storageThat(async () => { throw new Error('connection terminated unexpectedly'); });
    await expect(resolveGhii(storage, 'alice', NODE)).rejects.toThrow('connection terminated unexpectedly');
  });

  it('never answers with a bare account name, whatever the storage does', async () => {
    // The one assertion that covers the class rather than a branch: three storages, and not one of
    // the answers may be the account name on its own.
    const answers: string[] = [];
    for (const answer of [
      async (): Promise<GHIIRecord | null> => ({ ghii: 'alice@aimeat-test-001' } as GHIIRecord),
      async (): Promise<GHIIRecord | null> => null,
      async (): Promise<GHIIRecord | null> => ({ ghii: 'alice@another-node' } as GHIIRecord),
    ]) {
      answers.push(await resolveGhii(storageThat(answer), 'alice', NODE));
    }
    expect(answers.filter((a) => !a.includes('@'))).toEqual([]);
  });
});
