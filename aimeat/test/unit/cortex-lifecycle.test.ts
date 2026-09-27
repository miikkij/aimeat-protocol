/**
 * @file cortex-lifecycle.test.ts
 * @description installCortex against a lib component that arrives without its bytes. The install
 *   read only `libs`, so `{ manifest, lib: {...} }` (or a ZIP with the file outside libs/) answered
 *   201, recorded the component, wrote nothing, and the app then 404ed on the lib URL with the node
 *   calling the cortex installed (curated pitfall cortex-register-reactivate, 2026-09-13). Run against
 *   an in-memory storage double: the function needs no server.
 * @usage pnpm exec vitest run test/unit/cortex-lifecycle.test.ts
 * @version-history
 *   v1.3.0 — 2026-09-26 — A record stored without the identity has each action deleted under every
 *     principal of the account that installed the cortex: its bare name, its GHII, its agents and its
 *     ecosystem apps, and the deactivator's own two. The prompts and ontologies an activation wrote are
 *     deleted under the same principals.
 *   v1.2.0 — 2026-09-26 — Activation records the identity it published the actions under, and
 *     deactivation and uninstall delete them under it, whoever does them: the person after their
 *     agent, an operator after the owner. A record without it keeps the deactivator's identity and
 *     bare name (secaudit 2026-09, R3 7c).
 *   v1.1.0 — 2026-09-26 — Activation publishes a cortex action under the caller's resolved identity
 *     (a person's GHII), and deactivation deletes it under that identity and under the bare account
 *     name (secaudit 2026-09, R3 7c).
 *   v1.0.0 — 2026-09-13 — Initial: a lib with no content is refused before anything is written.
 */
import { describe, it, expect } from 'vitest';
import {
    installCortex, activateCortex, deactivateCortex, deleteCortex, libsWithoutContent,
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
    const operator = { ownerName: 'root', gaii: 'root', identity: 'root@test-node', isOperator: true };
    const ACTION_ID = 'cortex-laake-lookup';

    /** Every principal alice's account holds: her bare name, her GHII, her agent and her ecosystem app. */
    const ALICE_PRINCIPALS = ['alice', 'alice@test-node', 'bot#alice@test-node', 'eco:drum#alice@test-node'];

    /**
     * One cortex with one action component, recording every action written and deleted and every
     * memory record deleted. `actionProvider` is the identity a stored activation says its actions
     * were published under; left out, the record is one written before activation stored it.
     * `promptKeys` are the prompt records the stored activation lists.
     */
    function activationStorage(status: 'active' | 'inactive', actionIds: string[], actionProvider?: string, promptKeys: string[] = []) {
        const created: { id: string; providerGaii: string }[] = [];
        const deleted: { id: string; providerGaii: string }[] = [];
        const memoryDeleted: { owner: string; key: string }[] = [];
        let record = {
            name: 'laake', installedBy: 'alice', status,
            components: [{ type: 'action', name: 'lookup', description: 'Looks one up', input_schema: { type: 'object' } }],
            activationArtifacts: {
                schemaKeys: [], promptKeys, actionIds, boardIds: [], seedDataKeys: [], ontologyKeys: [], libFiles: [],
                ...(actionProvider ? { actionProvider } : {}),
            },
        } as unknown as CortexExtensionRecord;
        const storage = {
            getCortexExtension: async () => record,
            updateCortexExtension: async (_name: string, patch: Partial<CortexExtensionRecord>) => { record = { ...record, ...patch }; },
            deleteCortexExtension: async () => true,
            deleteCortexLibFile: async () => true,
            deleteDependencyEdges: async () => {},
            deleteComponentVersions: async () => {},
            createAction: async (a: { id: string; providerGaii: string }) => { created.push({ id: a.id, providerGaii: a.providerGaii }); return a; },
            deleteAction: async (id: string, providerGaii: string) => { deleted.push({ id, providerGaii }); return true; },
            deleteMemory: async (owner: string, key: string) => { memoryDeleted.push({ owner, key }); return true; },
            getGHIIByOwner: async (name: string) => (name === 'alice' ? { ghii: 'alice@test-node', ownerName: 'alice' } : null),
            getAgentsByOwner: async (name: string) => (name === 'alice' ? [{ gaii: 'bot#alice@test-node', owner: 'alice' }] : []),
            getEcosystemAppsByOwner: async (name: string) => (name === 'alice' ? [{ geai: 'eco:drum#alice@test-node', owner: 'alice' }] : []),
        } as unknown as Storage;
        return { storage, created, deleted, memoryDeleted, stored: () => record };
    }

    it("publishes a person's cortex action under their GHII, not under the bare account name", async () => {
        const { storage, created } = activationStorage('inactive', []);
        const out = await activateCortex({ storage, config }, person, 'laake');
        expect(out.ok).toBe(true);
        expect(created).toEqual([{ id: ACTION_ID, providerGaii: 'alice@test-node' }]);
    });

    it("records the identity it published the actions under: the agent's GAII when an agent activates", async () => {
        const { storage, stored } = activationStorage('inactive', []);
        expect((await activateCortex({ storage, config }, agent, 'laake')).ok).toBe(true);
        expect(stored().activationArtifacts.actionIds).toEqual([ACTION_ID]);
        expect(stored().activationArtifacts.actionProvider).toBe('bot#alice@test-node');
    });

    it('the person deactivates what their agent activated: the action goes, under the GAII it was published under', async () => {
        const { storage, deleted } = activationStorage('active', [ACTION_ID], 'bot#alice@test-node');
        expect((await deactivateCortex({ storage, config }, person, 'laake')).ok).toBe(true);
        expect(deleted).toEqual([{ id: ACTION_ID, providerGaii: 'bot#alice@test-node' }]);
    });

    it("an operator uninstalls another owner's active cortex: the action goes, under the owner's GHII", async () => {
        const { storage, deleted } = activationStorage('active', [ACTION_ID], 'alice@test-node');
        expect((await deleteCortex({ storage, config }, operator, 'laake')).ok).toBe(true);
        expect(deleted).toEqual([{ id: ACTION_ID, providerGaii: 'alice@test-node' }]);
    });

    // A record stored before activation named its provider does not say who published the actions:
    // the person, one of their agents or apps, whoever activated it. Each action id is deleted under
    // every principal of the account that installed the cortex, and under the deactivator's own two.
    it('a record stored without the identity: the person deactivates what their agent activated, and the action goes under every principal of the account', async () => {
        const { storage, deleted } = activationStorage('active', [ACTION_ID]);
        expect((await deactivateCortex({ storage, config }, person, 'laake')).ok).toBe(true);
        expect(deleted).toEqual(expect.arrayContaining(ALICE_PRINCIPALS.map(providerGaii => ({ id: ACTION_ID, providerGaii }))));
        expect(deleted).toHaveLength(ALICE_PRINCIPALS.length);
    });

    it("a record stored without the identity: an operator deactivates it, and the action goes under the owner's principals as well as the operator's", async () => {
        const { storage, deleted } = activationStorage('active', [ACTION_ID]);
        expect((await deactivateCortex({ storage, config }, operator, 'laake')).ok).toBe(true);
        expect(deleted).toEqual(expect.arrayContaining(
            [...ALICE_PRINCIPALS, 'root', 'root@test-node'].map(providerGaii => ({ id: ACTION_ID, providerGaii }))));
        expect(deleted).toHaveLength(ALICE_PRINCIPALS.length + 2);
    });

    it('the person deactivates what their agent activated: the prompt the activation wrote goes too, under every principal of the account', async () => {
        const PROMPT = '__cortex__/laake/prompts/ask';
        const { storage, memoryDeleted } = activationStorage('active', [ACTION_ID], 'bot#alice@test-node', [PROMPT]);
        expect((await deactivateCortex({ storage, config }, person, 'laake')).ok).toBe(true);
        expect(memoryDeleted).toEqual(expect.arrayContaining(ALICE_PRINCIPALS.map(owner => ({ owner, key: PROMPT }))));
        expect(memoryDeleted).toHaveLength(ALICE_PRINCIPALS.length);
    });

    it('an agent publishes and deletes under its own GAII, once', async () => {
        const on = activationStorage('inactive', []);
        expect((await activateCortex({ storage: on.storage, config }, agent, 'laake')).ok).toBe(true);
        expect(on.created).toEqual([{ id: ACTION_ID, providerGaii: 'bot#alice@test-node' }]);
        const off = activationStorage('active', [ACTION_ID], 'bot#alice@test-node');
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
