/**
 * @file workspace-provision-rollback.test.ts
 * @description Provisioning a workspace is four ordered writes — lock each records schema, write the
 *   manifest, write the readme, append to the organism's registry — and it had no rollback. A failure
 *   at write three left locked schemas and a manifest that no registry knows about: a workspace that
 *   half exists, which nothing lists and nothing cleans.
 *
 *   This matters more than it looks. A package install already undoes its components in reverse and
 *   names what it could not undo, but a workspace CANNOT be a package component (the seven legal
 *   types are csm, extension, cortex, app, msm, memory, translation), so it can never ride that
 *   rollback. It needs its own.
 * @structure
 *   - the happy path still provisions everything
 *   - a failure at the readme leaves nothing behind
 *   - a failure at the registry leaves nothing behind AND the registry keeps its previous contents
 *   - what could not be undone is reported rather than swallowed
 * @usage pnpm test -- workspace-provision-rollback
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial (TARGET-070).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { provisionWorkspace } from '../../src/services/workspace-provision.js';
import { loadConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';

const ORG = 'org-abc';
const OWNER_GHII = 'alice@aimeat-local-001-dev';

const MANIFEST = {
    manifestVersion: '1.0',
    id: 'shop',
    name: 'Shop',
    kind: 'project',
    status: 'active',
    objectTypes: [
        { name: 'catalog', namespace: 'shop.catalog', mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: 'shop.catalog' },
    ],
};

const SCHEMAS = {
    'shop.catalog': { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
};

function input(extra: Record<string, unknown> = {}) {
    return {
        orgId: ORG,
        ownerName: 'alice',
        ownerGhii: OWNER_GHII,
        name: 'Shop',
        manifest: structuredClone(MANIFEST),
        schemas: structuredClone(SCHEMAS),
        ...extra,
    };
}

/** A storage that throws the first time a key matching `failOn` is written. */
function failingAt(storage: SqliteStorage, failOn: RegExp): Storage {
    let fired = false;
    return new Proxy(storage, {
        get(target, prop, receiver) {
            if (prop === 'setMemory') {
                return async (record: { key: string }) => {
                    if (!fired && failOn.test(record.key)) {
                        fired = true;
                        throw new Error(`storage refused ${record.key}`);
                    }
                    return (target as unknown as Storage).setMemory(record as never);
                };
            }
            return Reflect.get(target, prop, receiver);
        },
    }) as unknown as Storage;
}

/** Everything provisioning writes, so a test can assert none of it is left. */
async function leftovers(storage: SqliteStorage, ws: string) {
    const root = `organism.${ORG}.w.${ws}`;
    return {
        manifest: await storage.getMemory(OWNER_GHII, `${root}.meta.manifest`),
        readme: await storage.getMemory(OWNER_GHII, `${root}.meta.readme`),
        schema: await storage.getSchema(`${root}.shop.catalog`, 'prefix'),
    };
}

describe('provisionWorkspace rollback', () => {
    let storage: SqliteStorage;

    beforeEach(() => {
        storage = new SqliteStorage(':memory:');
    });

    it('the happy path provisions the schema, the manifest, the readme and the registry entry', async () => {
        const res = await provisionWorkspace(storage as never, loadConfig().config, input());
        const left = await leftovers(storage, res.ws);
        expect(left.manifest).not.toBeNull();
        expect(left.readme).not.toBeNull();
        expect(left.schema).not.toBeNull();

        const reg = await storage.getMemory(OWNER_GHII, `organism.${ORG}.meta.workspaces`);
        expect((reg?.value as { workspaces: { id: string }[] }).workspaces.map(w => w.id)).toContain(res.ws);
    });

    it('a failure writing the readme leaves nothing behind', async () => {
        const guarded = failingAt(storage, /\.meta\.readme$/);
        await expect(provisionWorkspace(guarded, loadConfig().config, input())).rejects.toThrow(/readme/);

        // The ws id is generated inside, so sweep every key under the organism instead.
        const rows = await storage.listMemory(OWNER_GHII, { prefix: `organism.${ORG}.` });
        expect(rows.map(r => r.key)).toEqual([]);
    });

    it('a failure appending to the registry leaves nothing behind and keeps the registry as it was', async () => {
        // A registry that already holds one workspace: the rollback must restore exactly this.
        const first = await provisionWorkspace(storage as never, loadConfig().config, input({ name: 'First' }));

        const guarded = failingAt(storage, /\.meta\.workspaces$/);
        await expect(provisionWorkspace(guarded, loadConfig().config, input({ name: 'Second' }))).rejects.toThrow(/workspaces/);

        const reg = await storage.getMemory(OWNER_GHII, `organism.${ORG}.meta.workspaces`);
        const ids = (reg?.value as { workspaces: { id: string }[] }).workspaces.map(w => w.id);
        expect(ids).toEqual([first.ws]);

        // And the second workspace's own keys are gone: only the first one's remain.
        const rows = await storage.listMemory(OWNER_GHII, { prefix: `organism.${ORG}.w.` });
        for (const row of rows) expect(row.key.startsWith(`organism.${ORG}.w.${first.ws}`)).toBe(true);
    });

    // A rollback that reports success it did not achieve is worse than none, because nobody goes
    // looking for the leftovers. The installer names its orphans; so does this.
    it('names what it could not undo instead of claiming a clean rollback', async () => {
        const stubborn = new Proxy(storage, {
            get(target, prop, receiver) {
                if (prop === 'setMemory') {
                    return async (record: { key: string }) => {
                        if (/\.meta\.readme$/.test(record.key)) throw new Error('storage refused the readme');
                        return (target as unknown as Storage).setMemory(record as never);
                    };
                }
                // The undo cannot get the manifest back out.
                if (prop === 'deleteMemory') return async () => false;
                return Reflect.get(target, prop, receiver);
            },
        }) as unknown as Storage;

        await expect(provisionWorkspace(stubborn, loadConfig().config, input()))
            .rejects.toThrow(/Partial rollback — these were left behind: .*meta\.manifest/);
    });
});
