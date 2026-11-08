/**
 * @file test/unit/csm-ownership.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description services/csm-service.ts: whose use of a CSM blocks its deletion, and who the
 *   registering account is after its name was released and taken again (secaudit2026nov08 round 14).
 *   Developer ruling 2 of 2026-11-08: the registering account may delete its own CSM; other accounts'
 *   receivers keep validating against their stored copy and their owners get a notice; only the
 *   registering account's own uses block deletion, and the refusal names no other account's receiver.
 *   An account registered after the CSM is a later holder of the name, not its registering account.
 *   The existing file test/unit/csm-service.test.ts stays the contract for everything else.
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08 round 14: in-use-counts-other-accounts-receivers,
 *     registeredBy-bare-name-survives-account-erasure, schema-lock-table-public-read).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { callerFromAuth } from '../../src/services/caller-context.js';
import {
    createCsmAs, updateCsmAs, setCsmVisibilityAs, deleteCsmAs, getCsmFor, registerCsmUseCheck, csmLockShownTo,
} from '../../src/services/csm-service.js';

const NODE = 'node-test';
const config = { nodeId: NODE, baseUrl: 'https://node.test' } as unknown as AimeatConfig;

const YAML = (name: string) => `csm: "1.0"
service:
  name: ${name}
  type: data
  description: Sensor rows
data_schema:
  required:
    temperature: { type: number }
`;

describe('csm ownership', () => {
    let storage: Storage;
    const deps = () => ({ storage, config });
    const owner = (name: string) => callerFromAuth({ sub: name, owner: name, roles: ['owner'], scopes: [] }, NODE, storage);
    const notices = async (name: string) =>
        (await storage.listMemory(`${name}@${NODE}`, { prefix: 'notif.' })).map(r => r.value as { type: string; body?: string; i18n?: { key: string; vars?: Record<string, unknown> } });
    const account = (name: string, at: string) =>
        storage.createOwner({ name, displayName: name, publicKey: 'pk', roles: ['owner'], createdAt: at } as never);

    beforeEach(() => { storage = new SqliteStorage(':memory:') as unknown as Storage; });

    it('lets the registering account delete a CSM only other accounts use, and tells those owners', async () => {
        await createCsmAs(deps(), owner('alice'), { yaml: YAML('shared') });
        const stop = registerCsmUseCheck(async (name) => (name === 'alice.shared'
            ? [{ label: 'receiver bob/ruuvi', account: 'bob', name: 'ruuvi', link: '/v1/profile?tab=receivers' }] : []));
        try {
            const out = await deleteCsmAs(deps(), owner('alice'), 'alice.shared');
            expect(out.ok).toBe(true);
            expect(out.ok && out.data.other_accounts_told).toBe(1);
            expect(JSON.stringify(out)).not.toContain('bob');
            expect(await storage.getCsm('alice.shared')).toBeNull();
            const told = (await notices('bob')).filter(n => n.type === 'csm_removed');
            expect(told).toHaveLength(1);
            expect(told[0]!.i18n?.vars).toMatchObject({ csm: 'alice.shared', uses: 'ruuvi' });
            expect(await notices('alice')).toEqual([]);
        } finally { stop(); }
    });

    it('still refuses while the registering account itself uses it, and names only its own uses', async () => {
        await createCsmAs(deps(), owner('alice'), { yaml: YAML('both') });
        const stop = registerCsmUseCheck(async (name) => (name === 'alice.both'
            ? [{ label: 'receiver alice/home', account: 'alice' }, { label: 'receiver bob/ruuvi', account: 'bob' }] : []));
        try {
            const refused = await deleteCsmAs(deps(), owner('alice'), 'alice.both');
            expect(!refused.ok && refused.code).toBe('IN_USE');
            expect(!refused.ok && refused.details?.users).toEqual(['receiver alice/home']);
            expect(JSON.stringify(refused)).not.toContain('bob');
            const operator = await deleteCsmAs(deps(), owner('op'), 'alice.both', { asOperator: true });
            expect(!operator.ok && operator.code).toBe('IN_USE');
            expect(JSON.stringify(operator)).not.toContain('bob');
            expect(await storage.getCsm('alice.both')).not.toBeNull();
            expect(await notices('bob')).toEqual([]);
        } finally { stop(); }
    });

    it('lets the operator delete a CSM only other accounts use', async () => {
        await createCsmAs(deps(), owner('alice'), { yaml: YAML('op') });
        const stop = registerCsmUseCheck(async (name) => (name === 'alice.op' ? [{ label: 'receiver bob/ruuvi', account: 'bob' }] : []));
        try {
            const out = await deleteCsmAs(deps(), owner('op'), 'alice.op', { asOperator: true });
            expect(out.ok).toBe(true);
            expect((await notices('bob')).map(n => n.type)).toEqual(['csm_removed']);
        } finally { stop(); }
    });

    it('does not treat the next account of an erased name as the registering account', async () => {
        await account('carol', '2026-01-01T00:00:00.000Z');
        await createCsmAs(deps(), owner('carol'), { yaml: YAML('probe'), visibility: 'private' });
        await createCsmAs(deps(), owner('carol'), { yaml: YAML('shared') });
        expect((await getCsmFor(deps(), owner('carol'), 'carol.probe')).ok).toBe(true);
        // The account is erased and the name taken again by another person.
        await storage.deleteOwner('carol');
        await account('carol', new Date(Date.now() + 60_000).toISOString());
        const read = await getCsmFor(deps(), owner('carol'), 'carol.probe');
        expect(!read.ok && read.status).toBe(404);
        const put = await updateCsmAs(deps(), owner('carol'), 'carol.shared', { yaml: YAML('shared'), expected_version: 1 });
        expect(!put.ok && put.status).toBe(403);
        const vis = await setCsmVisibilityAs(deps(), owner('carol'), 'carol.shared', 'private');
        expect(!vis.ok && vis.status).toBe(403);
        const del = await deleteCsmAs(deps(), owner('carol'), 'carol.shared');
        expect(!del.ok && del.status).toBe(403);
        expect(await storage.getCsm('carol.shared')).not.toBeNull();
        // Everyone else keeps the public one, and the operator can still remove it.
        expect((await getCsmFor(deps(), null, 'carol.shared')).ok).toBe(true);
        expect((await deleteCsmAs(deps(), owner('op'), 'carol.shared', { asOperator: true })).ok).toBe(true);
    });

    it('keeps the registering account in charge while it holds its name', async () => {
        await account('dave', '2026-01-01T00:00:00.000Z');
        await createCsmAs(deps(), owner('dave'), { yaml: YAML('mine'), visibility: 'private' });
        expect((await getCsmFor(deps(), owner('dave'), 'dave.mine')).ok).toBe(true);
        expect((await updateCsmAs(deps(), owner('dave'), 'dave.mine', { yaml: YAML('mine'), expected_version: 1 })).ok).toBe(true);
        expect((await deleteCsmAs(deps(), owner('dave'), 'dave.mine')).ok).toBe(true);
    });

    it('shows a CSM\'s own lock row only to whoever may read the CSM; other rows stay public', async () => {
        await createCsmAs(deps(), owner('alice'), { yaml: YAML('secret'), visibility: 'private' });
        await createCsmAs(deps(), owner('alice'), { yaml: YAML('open') });
        expect(await csmLockShownTo(storage, 'csm.alice.secret', null)).toBe(false);
        expect(await csmLockShownTo(storage, 'csm.alice.secret', owner('bob'))).toBe(false);
        expect(await csmLockShownTo(storage, 'csm.alice.secret', owner('alice'))).toBe(true);
        expect(await csmLockShownTo(storage, 'csm.alice.open', null)).toBe(true);
        expect(await csmLockShownTo(storage, 'organism.x.w.y.records', null)).toBe(true);
        expect(await csmLockShownTo(storage, 'csm.nobody.here', null)).toBe(true);
    });
});
