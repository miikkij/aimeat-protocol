/**
 * @file memory-write-authority.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shared write service honors the same explicit scope grants as the doors.
 * @version-history 1.0.0 2026-09-27 Reserved-scope regression without changing existing E2Es.
 */
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { writeMemoryRecord } from '../../src/services/memory-write.js';

type TestStorage = Storage & { close(): void | Promise<void> };

describe('shared memory write authority', () => {
  it.each([['*'], ['memory:*'], ['memory:write']])(
    'does not infer a reserved-write grant from %s',
    async scope => {
      const storage = new SqliteStorage(':memory:') as unknown as TestStorage;
      const read = vi.spyOn(storage, 'getMemory');
      const write = vi.spyOn(storage, 'setMemory');
      try {
        const config = { ...loadConfig().config, aiProvenance: false };
        const principal = `writer#alice@${config.nodeId}`;
        const result = await writeMemoryRecord({ storage, config }, {
          principal, targetGaii: principal, scopes: [scope], roles: ['agent'],
        }, {
          key: 'audit.authority', value: { saved: true }, visibility: 'private',
          pipeline: 'test', authorisingScope: 'memory:write-reserved',
        });
        expect(result).toMatchObject({ ok: false, status: 403, code: 'SCOPE_DENIED' });
        expect(read).not.toHaveBeenCalled();
        expect(write).not.toHaveBeenCalled();
      } finally {
        vi.restoreAllMocks();
        await storage.close();
      }
    },
  );

  it.each(['memory:write-reserved', '*', 'memory:*'])(
    'continues to allow the granted ordinary write with %s',
    async scope => {
      const storage = new SqliteStorage(':memory:') as unknown as TestStorage;
      try {
        const config = { ...loadConfig().config, aiProvenance: false };
        const principal = `writer#alice@${config.nodeId}`;
        const result = await writeMemoryRecord({ storage, config }, {
          principal, targetGaii: principal, scopes: [scope], roles: ['agent'],
        }, {
          key: 'audit.authority', value: { saved: true }, visibility: 'private', pipeline: 'test',
          authorisingScope: scope === 'memory:write-reserved' ? scope : 'memory:write',
        });
        expect(result.ok).toBe(true);
        expect((await storage.getMemory(principal, 'audit.authority'))?.value).toEqual({ saved: true });
      } finally {
        await storage.close();
      }
    },
  );
});
