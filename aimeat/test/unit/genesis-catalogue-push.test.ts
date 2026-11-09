/**
 * @file test/unit/genesis-catalogue-push.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the genesis catalogue push sends a genesis peer (services/genesis-sync.ts
 *   federableCatalogue), on an in-memory SQLite node: a federable CSM only when it is public, as the
 *   local cross-catalogue and the peer service summary list it, and the actions tied to such a CSM.
 *   The peer stores what it is sent as public genesis entries, so a private, members or organism CSM
 *   sent there would be listed by name to anyone (secaudit2026nov08b round 15,
 *   push-lists-non-public-federable-csms). A suite needs two nodes and a peer; this needs neither.
 * @usage cd aimeat && pnpm exec vitest run test/unit/genesis-catalogue-push.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08b round 15).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, ActionRecord } from '../../src/storage/interface.js';
import { federableCatalogue } from '../../src/services/genesis-sync.js';

const NOW = '2026-11-08T00:00:00.000Z';

describe('federableCatalogue', () => {
    let storage: Storage;
    beforeEach(() => { storage = new SqliteStorage(':memory:') as unknown as Storage; });

    async function csm(name: string, visibility: string, federate: boolean, type: string) {
        await storage.createCsm({
            name, definition: { service: { name, type } }, jsonSchemaKey: `csm.${name}`, serviceType: type,
            registeredBy: 'alice', registeredAt: NOW, updatedAt: NOW, visibility, version: 1, ...(federate ? { federate: true } : {}),
        });
    }
    async function action(id: string, category: string, tags: string[]) {
        await storage.createAction({
            id, providerGaii: 'alice@node-test', displayName: id, description: id, category, inputSchema: {}, outputSchema: {},
            pricing: { tollMorsels: 0 }, tags, createdAt: NOW, updatedAt: NOW,
        } as ActionRecord);
    }

    it('sends a public federable CSM and its actions, and no private, members or organism one', async () => {
        await csm('alice.open', 'public', true, 'open-type');
        await csm('alice.secret', 'private', true, 'secret-type');
        await csm('alice.team', 'members', true, 'team-type');
        await csm('alice.org', 'organism:org-1', true, 'org-type');
        await csm('alice.local', 'public', false, 'local-type');
        await action('act-open', 'open-type', []);
        await action('act-open-tag', 'other', ['csm:alice.open']);
        await action('act-secret', 'secret-type', []);
        await action('act-secret-tag', 'other', ['csm:alice.secret']);
        await action('act-federate', 'other', ['federate:yes']);
        const out = await federableCatalogue(storage);
        expect(out.csms.map(c => c.name)).toEqual(['alice.open']);
        expect(out.actions.map(a => a.id).sort()).toEqual(['act-federate', 'act-open', 'act-open-tag']);
    });
});
