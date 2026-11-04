/**
 * @file test/unit/storage-group-binding.test.ts
 * @description A group file with no group id, against a real SQLite store. No upload path can create
 *   one any more, so a row an older node stored is seeded directly: that row is what these tests are
 *   about. The visibility change refuses to make such a file, and a file that has a group keeps it.
 *   The record-files rule opens a stored row of this kind to the workspace its writer links it in,
 *   because nobody reads it through a group, and it keeps the three rules that hold for a private file.
 * @structure Two describes: changeStorageFileVisibility() and bindFileToWorkspace().
 * @usage cd aimeat && pnpm exec vitest run test/unit/storage-group-binding.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial. Red before the change: a private file went to 'group' with no group
 *     id, and a bound row stayed at 'group'.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, StorageFileRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { authorizeRead } from '../../src/services/access-guard.js';
import { changeStorageFileVisibility } from '../../src/services/storage-file-write.js';
import { bindFileToWorkspace } from '../../src/services/record-files.js';

const NODE = 'aimeat-group-binding-test';
const ALICE = `alice@${NODE}`;
const ALICE_AGENT = `claude#alice@${NODE}`;
const BOB = `bob@${NODE}`;
const WORKSPACE = 'org-1/ws-1';

let storage: Storage;
let config: AimeatConfig;

async function seed(owner: string, key: string, visibility: StorageFileRecord['visibility'], groupId?: string): Promise<void> {
    await storage.createStorageFile({
        key, ownerGaii: owner, visibility, ...(groupId ? { groupId } : {}),
        mimeType: 'text/html', size: 5, data: Buffer.from('hello'), createdAt: new Date().toISOString(),
    } as StorageFileRecord);
}
const meta = async (owner: string, key: string) => (await storage.getStorageFileMeta(owner, key))!;
const writerAlice = { principal: ALICE, ownerName: 'alice', ownerGhii: ALICE };
const writerAgent = { principal: ALICE_AGENT, ownerName: 'alice', ownerGhii: ALICE };
const writerBob = { principal: BOB, ownerName: 'bob', ownerGhii: BOB };

beforeAll(() => {
    setThisNodeId(NODE);
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    config = { ...loadConfig().config, nodeId: NODE, consentEnabled: true };
});

afterAll(() => { setThisNodeId(null); });

describe('changeStorageFileVisibility and a file with no group', () => {
    it('refuses to make a private file a group file, since this change cannot name a group', async () => {
        await seed(ALICE, 'change/private.html', 'private');
        const out = await changeStorageFileVisibility({ storage, config }, ALICE, 'change/private.html', 'group');
        expect(out).toMatchObject({ ok: false, status: 400, code: 'INVALID_INPUT' });
        expect(!out.ok && out.message).toContain('group_id');
        expect((await meta(ALICE, 'change/private.html')).visibility).toBe('private');
    });

    it('lets a stored group file with no group move to another visibility, which is how its owner repairs it', async () => {
        await seed(ALICE, 'change/stranded.html', 'group');
        const out = await changeStorageFileVisibility({ storage, config }, ALICE, 'change/stranded.html', 'workspace', { workspaceRef: WORKSPACE });
        expect(out.ok).toBe(true);
        const after = await meta(ALICE, 'change/stranded.html');
        expect(after.visibility).toBe('workspace');
        expect(after.workspaceRef).toBe(WORKSPACE);
    });

    it('lets a file that has a group go back to it', async () => {
        await seed(ALICE, 'change/grouped.html', 'group', 'grp-1');
        expect((await changeStorageFileVisibility({ storage, config }, ALICE, 'change/grouped.html', 'private')).ok).toBe(true);
        const back = await changeStorageFileVisibility({ storage, config }, ALICE, 'change/grouped.html', 'group');
        expect(back.ok).toBe(true);
        const after = await meta(ALICE, 'change/grouped.html');
        expect(after.visibility).toBe('group');
        expect(after.groupId).toBe('grp-1');
    });

    it('still answers 404 for a file that does not exist', async () => {
        const out = await changeStorageFileVisibility({ storage, config }, ALICE, 'change/absent.html', 'group');
        expect(out).toMatchObject({ ok: false, status: 404, code: 'NOT_FOUND' });
    });
});

describe('bindFileToWorkspace and a stored group file with no group', () => {
    it('the row reads as the defect it is: a stranger is refused with missing_group_id', async () => {
        await seed(ALICE, 'bind/reason.html', 'group');
        const r = await authorizeRead(storage, config, {
            ownerGaii: ALICE, accessorGaii: BOB, resourceKey: 'storage:bind/reason.html', visibility: 'group', action: 'read', noAudit: true,
        });
        expect(r).toMatchObject({ allowed: false, reason: 'missing_group_id' });
    });

    it('its writer linking it opens it to the workspace', async () => {
        await seed(ALICE_AGENT, 'bind/own.html', 'group');
        await bindFileToWorkspace(storage, writerAgent, ALICE_AGENT, 'bind/own.html', WORKSPACE);
        const after = await meta(ALICE_AGENT, 'bind/own.html');
        expect(after.visibility).toBe('workspace');
        expect(after.workspaceRef).toBe(WORKSPACE);
    });

    it('a person linking their own agent\'s row opens it, as with a private file', async () => {
        await seed(ALICE_AGENT, 'bind/agents.html', 'group');
        await bindFileToWorkspace(storage, writerAlice, ALICE_AGENT, 'bind/agents.html', WORKSPACE);
        expect((await meta(ALICE_AGENT, 'bind/agents.html')).visibility).toBe('workspace');
    });

    it('an agent does not open its owner\'s row by linking it', async () => {
        await seed(ALICE, 'bind/owners.html', 'group');
        await bindFileToWorkspace(storage, writerAgent, ALICE, 'bind/owners.html', WORKSPACE);
        expect((await meta(ALICE, 'bind/owners.html')).visibility).toBe('group');
    });

    it('another person does not open it by linking it', async () => {
        await seed(ALICE, 'bind/foreign.html', 'group');
        await bindFileToWorkspace(storage, writerBob, ALICE, 'bind/foreign.html', WORKSPACE);
        expect((await meta(ALICE, 'bind/foreign.html')).visibility).toBe('group');
    });

    it('a file that has a group stays with its group, because rebinding would take its readers away', async () => {
        await seed(ALICE, 'bind/grouped.html', 'group', 'grp-1');
        await bindFileToWorkspace(storage, writerAlice, ALICE, 'bind/grouped.html', WORKSPACE);
        const after = await meta(ALICE, 'bind/grouped.html');
        expect(after.visibility).toBe('group');
        expect(after.groupId).toBe('grp-1');
    });
});
