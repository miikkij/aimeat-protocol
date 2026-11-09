/**
 * @file test/unit/content-leftovers-evidence.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The removal of the content class fingerprint loop's leftovers deletes only files it
 *   has positive evidence are the pipeline's own (secaudit2026nov08b round 15,
 *   content/leftovers-delete-unreserved-prefix). A person's own file whose key merely starts with
 *   `contentclass-` stays. The use kept: an orphaned kept text and sections file under the pipeline's
 *   own names, and the files the loop's facts named, are still removed.
 * @usage cd aimeat && pnpm exec vitest run test/unit/content-leftovers-evidence.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08b round 15).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { removeFingerprintLoopLeftovers } from '../../src/services/content/leftovers.js';
import { profileKeyOf, putFacts, sourceIdOf, textKeyOf } from '../../src/services/content/facts-store.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import type { Storage, StorageFileRecord } from '../../src/storage/interface.js';
import type { ContentFacts } from '../../src/services/content/types.js';

const OWNER = 'alice@node-1';
const OLD = '2026-11-08T09:00:00Z';
const NOW = Date.parse('2026-11-08T12:00:00Z');

const file = (key: string, extra: Partial<StorageFileRecord> = {}): StorageFileRecord => ({
  key, ownerGaii: OWNER, visibility: 'private', mimeType: 'text/plain', size: 20, data: Buffer.alloc(20, 120), createdAt: OLD, ...extra,
});

describe('removeFingerprintLoopLeftovers acts on positive evidence', () => {
  let storage: Storage;
  let config: AimeatConfig;
  const writer = { principal: OWNER, ownerGhii: OWNER, scopes: [] as string[], roles: ['owner'] };
  const facts = (key: string, extra: Partial<ContentFacts> = {}): ContentFacts => {
    const source = { kind: 'file' as const, owner: OWNER, key };
    return {
      source, sourceId: sourceIdOf(source), stages: {}, readFrom: 'sha256:x', updatedAt: '2026-11-05T00:00:00Z',
      technical: { kind: 'text', size: 1, mimeType: 'text/plain', contentHash: 'sha256:x' }, ...extra,
    } as ContentFacts;
  };

  beforeEach(async () => {
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    config = { ...loadConfig().config, nodeId: 'node-1' };
    // The owner has facts, so the job reads their files.
    await putFacts({ storage, config }, writer, facts('docs/report.pdf'));
    await storage.createStorageFile(file('docs/report.pdf', { mimeType: 'application/pdf' }));
  });

  it('keeps a person\'s own files whose keys start with contentclass-', async () => {
    const own = ['contentclass-notes.md', 'contentclass-text/my-notes.txt', 'contentclass-profile/plan.json', 'contentclass-archive/a.txt'];
    for (const key of own) await storage.createStorageFile(file(key));
    await removeFingerprintLoopLeftovers({ storage, config }, { now: NOW });
    const keys = (await storage.listStorageFiles(OWNER)).map(f => f.key);
    for (const key of own) expect(keys).toContain(key);
  });

  it('use kept: removes an orphaned kept text and sections file under the pipeline\'s own names', async () => {
    const sid = sourceIdOf({ kind: 'file', owner: OWNER, key: 'gone/old.pdf' });
    await storage.createStorageFile(file(textKeyOf(sid)));
    await storage.createStorageFile(file(profileKeyOf(sid), { mimeType: 'application/json' }));
    const out = await removeFingerprintLoopLeftovers({ storage, config }, { now: NOW });
    expect(out).toEqual([{ owner: OWNER, facts: 0, files: 2, failed: 0 }]);
    expect((await storage.listStorageFiles(OWNER)).map(f => f.key)).toEqual(['docs/report.pdf']);
  });

  it('use kept: removes the files the loop\'s own facts named, whatever their names', async () => {
    await putFacts({ storage, config }, writer, facts('contentclass-profile/x.json', {
      textKey: 'contentclass-text/loop-a.txt',
      profile: { detailKey: 'contentclass-profile/loop-a.json' } as ContentFacts['profile'],
    }));
    await storage.createStorageFile(file('contentclass-text/loop-a.txt'));
    await storage.createStorageFile(file('contentclass-profile/loop-a.json', { mimeType: 'application/json' }));
    const out = await removeFingerprintLoopLeftovers({ storage, config }, { now: NOW });
    expect(out).toEqual([{ owner: OWNER, facts: 1, files: 2, failed: 0 }]);
  });
});
