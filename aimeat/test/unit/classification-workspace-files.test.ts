/**
 * @file test/unit/classification-workspace-files.test.ts
 * @description A file shared into an organism workspace takes the organism's classification (Jouni,
 *   2026-10-05: "they should"; secaudit 2026-10, DATA-4). Before, every file was its holder's alone,
 *   so a workspace image left with an export, by federation or to an outside service whatever the
 *   organism's labels said. On a real SQLite store with classification on for everyone.
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { OrganismRecord, OrganismMembershipRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { fileTarget, setLabel, targetOf, type LabelActor } from '../../src/services/classification/labels.js';
import { systemReader } from '../../src/services/classification/reader.js';
import { resetClassificationAudit } from '../../src/services/classification/audit.js';

const N = 'n';
const ALICE = `alice@${N}`;
const ORG = 'o1';
const stamp = '2026-10-05T12:00:00.000Z';
const alice: LabelActor = { principal: ALICE, ownerGhii: ALICE, ownerName: 'alice', kind: 'human' };

describe('DATA-4: a file shared into a workspace is classified by its organism', () => {
    let storage: SqliteStorage;
    let config: AimeatConfig;
    const deps = () => ({ storage, config });

    beforeEach(async () => {
        storage = new SqliteStorage(':memory:');
        config = { ...loadConfig().config, nodeId: N, classificationMode: 'all' };
        resetClassificationAudit();
        await storage.createOwner({ name: 'alice', displayName: 'alice', publicKey: 'pk', roles: ['owner'], createdAt: stamp });
        await storage.createGHII({ username: 'alice', nodeId: N, ghii: ALICE, displayName: 'alice', ownerName: 'alice', verificationLevel: 0, totpEnabled: false, createdAt: stamp, updatedAt: stamp } as never);
        await storage.createOrganism({
            id: ORG, name: 'Org', description: 'x', type: 'project', interests: [], creatorGhii: ALICE, createdBy: ALICE, owners: [ALICE],
            admins: [ALICE], members: [ALICE], agentGaiis: [], boardId: 'b1', joinPolicy: 'invite_only', maxMembers: 10, visibility: 'private',
            moderationConfig: { flagsEnabled: false, autoHideThreshold: 5, appealsEnabled: false },
            memoryNamespace: `organism.${ORG}`, createdAt: stamp, updatedAt: stamp,
        } as OrganismRecord);
        await storage.createMembership({ id: 'm-alice', organismId: ORG, ghii: 'alice', role: 'creator', status: 'active', joinedAt: stamp } as OrganismMembershipRecord);
        for (const [key, ref] of [['shared/plan.png', `${ORG}/ws1`], ['own/photo.png', undefined]] as const) {
            await storage.createStorageFile({
                key, ownerGaii: ALICE, visibility: ref ? 'workspace' : 'private', ...(ref ? { workspaceRef: ref } : {}),
                mimeType: 'image/png', size: 3, data: Buffer.from('png'), createdAt: stamp,
            } as never);
        }
    });
    afterEach(() => { storage.close(); resetClassificationAudit(); });

    it('the workspace file is kept inside the organism by its default label; the personal file leaves', async () => {
        const reader = systemReader(deps(), ALICE);
        const shared = await reader.leave(['shared/plan.png'], k => fileTarget(ALICE, k, `${ORG}/ws1`), { kind: 'external', to: 'bob@elsewhere' });
        expect(shared.left.map(l => l.label)).toEqual(['sisainen']);
        const own = await reader.leave(['own/photo.png'], k => fileTarget(ALICE, k), { kind: 'external', to: 'bob@elsewhere' });
        expect(own.kept).toEqual(['own/photo.png']);
    });

    it('a label request that names the holder and the key lands at the organism\'s address', async () => {
        const named = targetOf(alice, { kind: 'file', key: 'shared/plan.png' });
        await setLabel(deps(), alice, named, { label: 'julkinen' });
        const row = await storage.getContentLabel(fileTarget(ALICE, 'shared/plan.png', `${ORG}/ws1`));
        expect(row?.label).toBe('julkinen');
        expect(await storage.getContentLabel(named)).toBeFalsy();
    });
});
