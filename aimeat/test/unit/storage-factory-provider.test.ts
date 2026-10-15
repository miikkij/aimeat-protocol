/**
 * @file storage-factory-provider.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Feature-list audit row 168: a storage provider word the factory does not know made the
 *   node start on an empty in-memory database, which the factory's own comment calls far worse than
 *   refusing to start. A misspelt AIMEAT_STORAGE (`sqlit`) now refuses, naming the supported words;
 *   `memory`, the default when nothing is set, still opens the in-memory database.
 * @usage cd aimeat && pnpm exec vitest run test/unit/storage-factory-provider.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-15 — Initial (feature-list audit 168).
 */
import { describe, it, expect } from 'vitest';
import { createStorage } from '../../src/storage/storage-factory.js';

describe('createStorage and the provider word', () => {
    it('refuses a word it does not know, and names the supported ones', async () => {
        await expect(createStorage({ provider: 'sqlit' as never })).rejects.toThrow(/sqlit.*postgres-kysely.*sqlite.*memory/s);
    });

    it('opens the in-memory database for "memory", the default', async () => {
        const storage = await createStorage({ provider: 'memory' });
        expect(typeof storage.getAgent).toBe('function');
    });
});
