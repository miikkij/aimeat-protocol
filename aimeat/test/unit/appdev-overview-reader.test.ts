/**
 * @file test/unit/appdev-overview-reader.test.ts
 * @description The appdev overview lists the owner's skills through the caller's own reader
 *   (services/appdev-overview.ts). It rebuilt one from the owner's name, so an AI on a personal
 *   access token was read as the owner and saw the skills hidden from AI (secaudit 2026-10, DATA-2).
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial.
 */
import { describe, it, expect } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { ContentReader } from '../../src/services/classification/reader.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { buildAppdevOverview } from '../../src/services/appdev-overview.js';

const NODE = 'test-node';
const ALICE = `alice@${NODE}`;
const config = { nodeId: NODE, baseUrl: 'http://localhost:40050' } as unknown as AimeatConfig;

/** A reader for an AI holding alice's personal access token, for which the classification hides everything. */
function hidingReader(): ContentReader {
    return {
        kind: 'ai', identity: ALICE, principal: ALICE, auth: { sub: 'alice', owner: 'alice', roles: ['owner'] } as never,
        warnings: [], show: async () => [], useForAi: async () => {},
    } as unknown as ContentReader;
}

describe('the appdev overview\'s skills', () => {
    it('are listed through the caller\'s reader, so a skill hidden from it is left out', async () => {
        const storage = new SqliteStorage(':memory:');
        const now = new Date().toISOString();
        await storage.setMemory({
            key: 'skills.private-playbook.manifest', ownerGaii: ALICE, visibility: 'private', tags: ['skill'], ttlHours: null,
            value: { name: 'private-playbook', description: 'Hidden from AI', files: [], version: '1.0.0' },
            version: 1, createdAt: now, updatedAt: now,
        } as never);
        const out = await buildAppdevOverview(storage as never, config, hidingReader(), { sections: ['skills'] });
        const user = ((out.skills as { user?: { items?: Array<{ ref: string }> } | Array<{ ref: string }> })?.user) as unknown;
        expect(JSON.stringify(user ?? [])).not.toContain('private-playbook');
    });
});
