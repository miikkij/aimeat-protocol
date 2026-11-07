/**
 * @file test/unit/csm-service.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description services/csm-service.ts on an in-memory SQLite node: the owner prefix, the visibility a
 *   read is filtered by, the versions a PUT keeps (and a stale version refused), csm:write for an agent,
 *   getCsmCompiled and its hash, and the in-use refusal registerCsmUseCheck adds to delete. The E2E
 *   suite (test/e2e-csm.ts) proves the routes; this file proves the parts a suite cannot reach, the
 *   use-check registry above all, since a suite cannot register a check inside the node.
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial (CSM owner prefix, visibility, versions, csm:write, in-use; Jouni, 2026-11-07).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { callerFromAuth } from '../../src/services/caller-context.js';
import {
    createCsmAs, updateCsmAs, setCsmVisibilityAs, deleteCsmAs, getCsmFor, listCsmsFor, listCsmVersionsFor,
    getCsmVersionFor, getCsmCompiled, registerCsmUseCheck, draftCsmFromSample, ownerPrefixed,
} from '../../src/services/csm-service.js';

const NODE = 'node-test';
const config = { nodeId: NODE, baseUrl: 'https://node.test' } as unknown as AimeatConfig;

const YAML = (name: string, extra = '') => `csm: "1.0"
service:
  name: ${name}
  type: data
  description: Sensor rows
data_schema:
  required:
    temperature: { type: number }
${extra}`;

describe('csm-service', () => {
    let storage: Storage;
    const deps = () => ({ storage, config });
    const owner = (name: string) => callerFromAuth({ sub: name, owner: name, roles: ['owner'], scopes: [] }, NODE, storage);
    const agent = (ownerName: string, scopes: string[]) =>
        callerFromAuth({ sub: `bot#${ownerName}@${NODE}`, owner: ownerName, roles: ['agent'], scopes }, NODE, storage);

    beforeEach(() => { storage = new SqliteStorage(':memory:') as unknown as Storage; });

    it('prefixes a new name with the account, once, and answers the final name', async () => {
        expect(ownerPrefixed('sensor', 'alice')).toBe('alice.sensor');
        expect(ownerPrefixed('alice.sensor', 'alice')).toBe('alice.sensor');
        const out = await createCsmAs(deps(), owner('alice'), { yaml: YAML('sensor') });
        expect(out.ok && out.status).toBe(201);
        expect(out.ok && out.data.csm.name).toBe('alice.sensor');
        expect(out.ok && out.data.csm.version).toBe(1);
        expect(out.ok && out.data.csm.visibility).toBe('public');
        const again = await createCsmAs(deps(), owner('alice'), { yaml: YAML('alice.sensor') });
        expect(!again.ok && again.code).toBe('CSM_NAME_TAKEN');
        // Another account naming alice's prefix still gets its own.
        const bob = await createCsmAs(deps(), owner('bob'), { yaml: YAML('alice.sensor') });
        expect(bob.ok && bob.data.csm.name).toBe('bob.alice.sensor');
    });

    it('takes the node default when no visibility is named', async () => {
        const closed = { ...config, csmDefaultVisibility: 'members' } as unknown as AimeatConfig;
        const out = await createCsmAs({ storage, config: closed }, owner('alice'), { yaml: YAML('m') });
        expect(out.ok && out.data.csm.visibility).toBe('members');
    });

    it('filters reads by visibility: private for the account, members for any account, public for anyone', async () => {
        await createCsmAs(deps(), owner('alice'), { yaml: YAML('priv'), visibility: 'private' });
        await createCsmAs(deps(), owner('alice'), { yaml: YAML('mem'), visibility: 'members' });
        await createCsmAs(deps(), owner('alice'), { yaml: YAML('pub') });
        const names = async (viewer: ReturnType<typeof owner> | null) =>
            (await listCsmsFor(deps(), viewer)).data.services.map(s => s.name).sort();
        expect(await names(owner('alice'))).toEqual(['alice.mem', 'alice.priv', 'alice.pub']);
        expect(await names(agent('alice', []))).toEqual(['alice.mem', 'alice.priv', 'alice.pub']);
        expect(await names(owner('bob'))).toEqual(['alice.mem', 'alice.pub']);
        expect(await names(null)).toEqual(['alice.pub']);
        const hidden = await getCsmFor(deps(), owner('bob'), 'alice.priv');
        expect(!hidden.ok && hidden.status).toBe(404);
        expect(!(await getCsmFor(deps(), null, 'alice.mem')).ok).toBe(true);
    });

    it('refuses an agent without csm:write and lets one with it, or with a wildcard, write in its owner\'s account', async () => {
        const none = await createCsmAs(deps(), agent('alice', ['memory:write']), { yaml: YAML('a1') });
        expect(!none.ok && none.code).toBe('SCOPE_DENIED');
        const word = await createCsmAs(deps(), agent('alice', ['csm:write']), { yaml: YAML('a2') });
        expect(word.ok && word.data.csm.name).toBe('alice.a2');
        const star = await createCsmAs(deps(), agent('alice', ['csm:*']), { yaml: YAML('a3') });
        expect(star.ok && star.data.csm.registered_by).toBe('alice');
        // An agent of bob with csm:write cannot change alice's CSM.
        const cross = await setCsmVisibilityAs(deps(), agent('bob', ['*']), 'alice.a2', 'private');
        expect(!cross.ok && cross.status).toBe(403);
    });

    it('keeps the replaced version, raises the version, moves the lock, and refuses a stale version', async () => {
        await createCsmAs(deps(), owner('alice'), { yaml: YAML('v') });
        const before = await getCsmCompiled(storage, 'alice.v');
        expect(before?.version).toBe(1);
        const stale = await updateCsmAs(deps(), owner('alice'), 'alice.v', { yaml: YAML('v'), expected_version: 2 });
        expect(!stale.ok && stale.code).toBe('VERSION_CONFLICT');
        const none = await updateCsmAs(deps(), owner('alice'), 'alice.v', { yaml: YAML('v') });
        expect(!none.ok && none.code).toBe('INVALID_INPUT');
        const renamed = await updateCsmAs(deps(), owner('alice'), 'alice.v', { yaml: YAML('other'), expected_version: 1 });
        expect(!renamed.ok && renamed.code).toBe('INVALID_INPUT');
        const next = YAML('v', '  optional:\n    humidity: { type: integer }');
        const ok = await updateCsmAs(deps(), owner('alice'), 'alice.v', { yaml: next, expected_version: 1 });
        expect(ok.ok && ok.data.csm.version).toBe(2);
        const after = await getCsmCompiled(storage, 'alice.v');
        expect(after?.version).toBe(2);
        expect(after?.hash).not.toBe(before?.hash);
        expect((after?.jsonSchema.properties as Record<string, unknown>).humidity).toEqual({ type: 'integer' });
        expect((await storage.getSchema('csm.alice.v', 'prefix'))?.schemaJson).toEqual(after?.jsonSchema);
        const v1 = await getCsmCompiled(storage, 'alice.v', 1);
        expect(v1?.hash).toBe(before?.hash);
        const list = await listCsmVersionsFor(deps(), owner('alice'), 'alice.v');
        expect(list.ok && list.data.versions.map(v => [v.version, v.current])).toEqual([[1, false], [2, true]]);
        const one = await getCsmVersionFor(deps(), owner('alice'), 'alice.v', 1);
        expect(one.ok && one.data.current).toBe(false);
        const again = await updateCsmAs(deps(), owner('alice'), 'alice.v', { yaml: next, expected_version: 1 });
        expect(!again.ok && again.code).toBe('VERSION_CONFLICT');
        expect(await getCsmCompiled(storage, 'alice.v', 9)).toBeNull();
        expect(await getCsmCompiled(storage, 'nobody.x')).toBeNull();
    });

    it('answers the same hash for the same schema whatever the key order', async () => {
        await createCsmAs(deps(), owner('alice'), { yaml: YAML('h') });
        const a = await getCsmCompiled(storage, 'alice.h');
        await createCsmAs(deps(), owner('bob'), { yaml: YAML('h') });
        const b = await getCsmCompiled(storage, 'bob.h');
        expect(a?.hash).toMatch(/^[0-9a-f]{64}$/);
        expect(a?.hash).toBe(b?.hash);
    });

    it('refuses delete with IN_USE while a registered check names a user, and deletes the versions with it', async () => {
        await createCsmAs(deps(), owner('alice'), { yaml: YAML('u') });
        await updateCsmAs(deps(), owner('alice'), 'alice.u', { yaml: YAML('u'), expected_version: 1 });
        const stop = registerCsmUseCheck(async (name) => (name === 'alice.u' ? ['receiver alice/ruuvi'] : []));
        try {
            const refused = await deleteCsmAs(deps(), owner('alice'), 'alice.u');
            expect(!refused.ok && refused.code).toBe('IN_USE');
            expect(!refused.ok && refused.details).toEqual({ users: ['receiver alice/ruuvi'] });
            expect(await storage.getCsm('alice.u')).not.toBeNull();
            // Another account is refused before it learns who uses it.
            const other = await deleteCsmAs(deps(), owner('bob'), 'alice.u');
            expect(!other.ok && other.code).toBe('FORBIDDEN');
        } finally { stop(); }
        const ok = await deleteCsmAs(deps(), owner('alice'), 'alice.u');
        expect(ok.ok).toBe(true);
        expect(await storage.getCsm('alice.u')).toBeNull();
        expect(await storage.listCsmVersions('alice.u')).toEqual([]);
        expect(await storage.getSchema('csm.alice.u', 'prefix')).toBeNull();
    });

    it('a check that throws names nobody', async () => {
        await createCsmAs(deps(), owner('alice'), { yaml: YAML('t') });
        const stop = registerCsmUseCheck(async () => { throw new Error('boom'); });
        try { expect((await deleteCsmAs(deps(), owner('alice'), 'alice.t')).ok).toBe(true); } finally { stop(); }
    });

    it('drafts from a sample under the prefixed name and stores nothing', async () => {
        const out = await draftCsmFromSample(deps(), agent('alice', ['csm:write']), { name: 'ruuvi', sample: { temperature: 21.5 } });
        expect(out.ok && out.data.name).toBe('alice.ruuvi');
        expect(out.ok && out.data.stored).toBe(false);
        expect(await storage.listCsms()).toEqual([]);
        const refused = await draftCsmFromSample(deps(), agent('alice', []), { name: 'ruuvi', sample: { a: 1 } });
        expect(!refused.ok && refused.code).toBe('SCOPE_DENIED');
    });

    it('refuses an organism visibility for an organism the caller is not in', async () => {
        await createCsmAs(deps(), owner('alice'), { yaml: YAML('o') });
        const out = await setCsmVisibilityAs(deps(), owner('alice'), 'alice.o', 'organism:org-doesnotexist');
        expect(!out.ok && out.code).toBe('INVALID_INPUT');
        const bad = await setCsmVisibilityAs(deps(), owner('alice'), 'alice.o', 'everyone');
        expect(!bad.ok && bad.code).toBe('INVALID_INPUT');
    });
});
