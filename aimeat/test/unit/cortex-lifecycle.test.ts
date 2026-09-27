/**
 * @file cortex-lifecycle.test.ts
 * @description installCortex against a lib component that arrives without its bytes. The install
 *   read only `libs`, so `{ manifest, lib: {...} }` (or a ZIP with the file outside libs/) answered
 *   201, recorded the component, wrote nothing, and the app then 404ed on the lib URL with the node
 *   calling the cortex installed (curated pitfall cortex-register-reactivate, 2026-09-13). Run against
 *   an in-memory storage double: the function needs no server.
 * @usage pnpm exec vitest run test/unit/cortex-lifecycle.test.ts
 * @version-history
 *   v1.1.0 — 2026-09-26 — Activation publishes a cortex action under the caller's resolved identity
 *     (a person's GHII), and deactivation deletes it under that identity and under the bare account
 *     name (secaudit 2026-09, R3 7c).
 *   v1.0.0 — 2026-09-13 — Initial: a lib with no content is refused before anything is written.
 */
import { describe, it, expect } from 'vitest';
import {
    installCortex, activateCortex, deactivateCortex, libsWithoutContent,
} from '../../src/services/cortex-lifecycle.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, CortexExtensionRecord } from '../../src/storage/interface.js';

const config = { nodeId: 'test-node', cortexMaxLibSizeKb: 512, cortexMaxInstalled: 50 } as unknown as AimeatConfig;
const caller = { ownerName: 'alice', gaii: 'alice', isOperator: false };

const MANIFEST = [
    'apiVersion: cortex.aimeat.org/v1',
    'kind: Extension',
    'metadata:',
    '  name: laake',
    '  namespace: alice',
    'spec:',
    '  version: 1.0.0',
    '  components:',
    '    - type: lib',
    '      name: laake',
    '      filename: laake.js',
    '      exports: [lookup]',
    '      api_surface: AIMEAT.laake.lookup(id)',
].join('\n');

/** Only what installCortex touches, recording every write. */
function fakeStorage() {
    const writes: string[] = [];
    const storage = {
        listCortexExtensions: async () => [],
        getCortexExtension: async () => null,
        createCortexExtension: async (r: CortexExtensionRecord) => { writes.push(`record:${r.name}`); return r; },
        setCortexLibFile: async (name: string, file: string) => { writes.push(`lib:${name}/${file}`); },
        saveComponentVersion: async () => {},
        replaceDependencyEdges: async () => {},
    } as unknown as Storage;
    return { storage, writes };
}

describe('installCortex: a lib component needs its bytes', () => {
    it('refuses a lib whose filename has no content in libs, naming the file and the key, and writes nothing', async () => {
        const { storage, writes } = fakeStorage();
        const out = await installCortex({ storage, config }, caller, { manifest: MANIFEST, libs: { 'other.js': 'x' } });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.refusal.status).toBe(400);
        expect(out.refusal.code).toBe('INVALID_MANIFEST');
        expect(out.refusal.message).toContain('laake.js');
        expect(out.refusal.message).toContain('libs');
        expect(writes).toEqual([]);
    });

    it('refuses the same when no libs were sent at all (the `lib` spelling never reaches here)', async () => {
        const { storage, writes } = fakeStorage();
        const out = await installCortex({ storage, config }, caller, { manifest: MANIFEST });
        expect(out.ok).toBe(false);
        expect(writes).toEqual([]);
    });

    it('still answers 409 for a name this owner already holds, before asking about the bytes', async () => {
        const { storage, writes } = fakeStorage();
        (storage as unknown as { getCortexExtension: () => Promise<unknown> }).getCortexExtension =
            async () => ({ name: 'laake', installedBy: 'alice' });
        const out = await installCortex({ storage, config }, caller, { manifest: MANIFEST });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.refusal.status).toBe(409);
        expect(out.refusal.code).toBe('CONFLICT');
        expect(writes).toEqual([]);
    });

    it('installs and writes the bytes when the file is there', async () => {
        const { storage, writes } = fakeStorage();
        const out = await installCortex({ storage, config }, caller, { manifest: MANIFEST, libs: { 'laake.js': '(function(){})();' } });
        expect(out.ok).toBe(true);
        expect(writes).toEqual(['record:laake', 'lib:laake/laake.js']);
    });
});

describe('activateCortex and deactivateCortex: a cortex action is keyed on the resolved identity', () => {
    // A person's session names them by the bare account name (`gaii`); POST /v1/actions and every
    // work door name them by their GHII (`identity`), so that is where their actions have to be.
    const person = { ownerName: 'alice', gaii: 'alice', identity: 'alice@test-node', isOperator: false };
    const agent = { ownerName: 'alice', gaii: 'bot#alice@test-node', identity: 'bot#alice@test-node', isOperator: false };
    const ACTION_ID = 'cortex-laake-lookup';

    /** One cortex with one action component, recording every action written and deleted. */
    function activationStorage(status: 'active' | 'inactive', actionIds: string[]) {
        const created: { id: string; providerGaii: string }[] = [];
        const deleted: { id: string; providerGaii: string }[] = [];
        let record = {
            name: 'laake', installedBy: 'alice', status,
            components: [{ type: 'action', name: 'lookup', description: 'Looks one up', input_schema: { type: 'object' } }],
            activationArtifacts: {
                schemaKeys: [], promptKeys: [], actionIds, boardIds: [], seedDataKeys: [], ontologyKeys: [], libFiles: [],
            },
        } as unknown as CortexExtensionRecord;
        const storage = {
            getCortexExtension: async () => record,
            updateCortexExtension: async (_name: string, patch: Partial<CortexExtensionRecord>) => { record = { ...record, ...patch }; },
            createAction: async (a: { id: string; providerGaii: string }) => { created.push({ id: a.id, providerGaii: a.providerGaii }); return a; },
            deleteAction: async (id: string, providerGaii: string) => { deleted.push({ id, providerGaii }); return true; },
        } as unknown as Storage;
        return { storage, created, deleted };
    }

    it("publishes a person's cortex action under their GHII, not under the bare account name", async () => {
        const { storage, created } = activationStorage('inactive', []);
        const out = await activateCortex({ storage, config }, person, 'laake');
        expect(out.ok).toBe(true);
        expect(created).toEqual([{ id: ACTION_ID, providerGaii: 'alice@test-node' }]);
    });

    it('deletes each action under the GHII and under the bare account name on deactivation', async () => {
        const { storage, deleted } = activationStorage('active', [ACTION_ID]);
        const out = await deactivateCortex({ storage, config }, person, 'laake');
        expect(out.ok).toBe(true);
        expect(deleted).toHaveLength(2);
        expect(deleted).toEqual(expect.arrayContaining([
            { id: ACTION_ID, providerGaii: 'alice@test-node' },
            { id: ACTION_ID, providerGaii: 'alice' },
        ]));
    });

    it('an agent publishes and deletes under its own GAII, once', async () => {
        const on = activationStorage('inactive', []);
        expect((await activateCortex({ storage: on.storage, config }, agent, 'laake')).ok).toBe(true);
        expect(on.created).toEqual([{ id: ACTION_ID, providerGaii: 'bot#alice@test-node' }]);
        const off = activationStorage('active', [ACTION_ID]);
        expect((await deactivateCortex({ storage: off.storage, config }, agent, 'laake')).ok).toBe(true);
        expect(off.deleted).toEqual([{ id: ACTION_ID, providerGaii: 'bot#alice@test-node' }]);
    });
});

describe('libsWithoutContent', () => {
    const components = [
        { type: 'lib', name: 'a', filename: 'a.js', exports: [], api_surface: '' },
        { type: 'lib', name: 'b', filename: 'b.js', exports: [], api_surface: '' },
        { type: 'prompt', name: 'p', content: 'x' },
    ] as unknown as CortexExtensionRecord['components'];

    it('lists every lib filename with neither new content nor stored bytes', () => {
        expect(libsWithoutContent(components, {})).toEqual(['a.js', 'b.js']);
        expect(libsWithoutContent(components, { 'a.js': 'x' })).toEqual(['b.js']);
        expect(libsWithoutContent(components, { 'a.js': 'x' }, new Set(['b.js']))).toEqual([]);
    });
});
