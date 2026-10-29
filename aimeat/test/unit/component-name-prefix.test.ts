/**
 * @file component-name-prefix.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Extension and cortex names that start with `aimeat-` belong to what the node ships
 *   (services/component-name-prefix.ts; secaudit2026oct26 round 8c, extensions-02). An account could
 *   install under a name a coming release adds, because the running build does not know the name yet.
 *   Run against storage doubles: the cortex doors need no server. The extension doors are covered in
 *   test/e2e-component-namespaces.ts.
 * @structure every name shipped after the rule carries the prefix · installCortex and the PUT create
 *   branch refuse a new prefixed name to an account · the operator, an account's own name and an
 *   account taking back a prefixed bare name it released itself are not refused
 * @usage pnpm exec vitest run test/unit/component-name-prefix.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (secaudit2026oct26 round 8c).
 */
import { describe, it, expect } from 'vitest';
import { installCortex } from '../../src/services/cortex-lifecycle.js';
import { upsertCortex } from '../../src/routes/cortex/upsert.js';
import { bundledCortexNames } from '../../src/services/cortex-seeder.js';
import { BUILTIN_EXTENSIONS } from '../../src/data/builtin-extensions/index.js';
import { nodePrefixRefusal, hasNodePrefix } from '../../src/services/component-name-prefix.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, CortexExtensionRecord } from '../../src/storage/interface.js';

const config = { nodeId: 'test-node', cortexMaxLibSizeKb: 512, cortexMaxInstalled: 50 } as unknown as AimeatConfig;
const alice = { ownerName: 'alice', gaii: 'alice', isOperator: false };
const operator = { ownerName: 'root', gaii: 'root', isOperator: true };

/** The two built-in extensions shipped before the rule; they keep their names. */
const SHIPPED_BEFORE_THE_RULE = new Set(['living-hooks', 'vocab-finto']);

const manifest = (name: string, namespace: string) => [
    'apiVersion: cortex.aimeat.org/v1', 'kind: Extension', 'metadata:', `  name: ${name}`, `  namespace: ${namespace}`,
    'spec:', '  version: 1.0.0', '  components:', '    - type: lib', '      name: x', '      filename: x.js', '      exports: [x]',
].join('\n');

/** A node where no cortex has a record yet; `released` is the released-name row the double answers. */
function emptyStorage(released: { holder: string } | null = null) {
    const writes: string[] = [];
    const storage = {
        listCortexExtensions: async () => [],
        getCortexExtension: async () => null,
        getReleasedComponentName: async () => released,
        deleteReleasedComponentName: async () => {},
        createCortexExtension: async (r: CortexExtensionRecord) => { writes.push(`record:${r.name}`); return r; },
        setCortexLibFile: async (name: string, file: string) => { writes.push(`lib:${name}/${file}`); },
        saveComponentVersion: async () => {},
        replaceDependencyEdges: async () => {},
    } as unknown as Storage;
    return { storage, writes };
}

describe('what the node ships carries the aimeat- prefix', () => {
    it('every built-in extension added after the rule starts with aimeat-', () => {
        const unprefixed = BUILTIN_EXTENSIONS.map(b => b.name).filter(n => !SHIPPED_BEFORE_THE_RULE.has(n) && !hasNodePrefix(n));
        expect(unprefixed).toEqual([]);
    });

    it('every bundled cortex starts with aimeat-', () => {
        const names = [...bundledCortexNames()];
        expect(names.length).toBeGreaterThan(0);
        expect(names.filter(n => !hasNodePrefix(n))).toEqual([]);
    });
});

describe('an account does not install a new cortex under an aimeat- name', () => {
    it('installCortex refuses a prefixed name the build does not ship yet, and writes nothing', async () => {
        const { storage, writes } = emptyStorage();
        const out = await installCortex({ storage, config }, alice, { manifest: manifest('aimeat-coming-soon', 'alice'), libs: { 'x.js': 'window.x=1' } });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.refusal.status).toBe(409);
        expect(out.refusal.code).toBe('NAME_RESERVED');
        expect(out.refusal.message).toContain('alice-coming-soon');
        expect(writes).toEqual([]);
    });

    it('the PUT create branch refuses it the same way', async () => {
        const { storage, writes } = emptyStorage();
        const out = await upsertCortex({ storage, config }, alice, { name: 'aimeat-coming-soon', manifest: manifest('aimeat-coming-soon', 'alice'), libs: { 'x.js': 'window.x=1' } });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.refusal.code).toBe('NAME_RESERVED');
        expect(writes).toEqual([]);
    });

    it('the operator installs a prefixed name, and an account installs its own name as before', async () => {
        const op = emptyStorage();
        expect((await installCortex({ storage: op.storage, config }, operator, { manifest: manifest('aimeat-coming-soon', 'aimeat'), libs: { 'x.js': 'window.x=1' } })).ok).toBe(true);
        const own = emptyStorage();
        expect((await installCortex({ storage: own.storage, config }, alice, { manifest: manifest('alice-coming-soon', 'alice'), libs: { 'x.js': 'window.x=1' } })).ok).toBe(true);
    });

    it('an account takes back a prefixed bare name it released itself', async () => {
        const { storage } = emptyStorage({ holder: 'alice' });
        expect(await nodePrefixRefusal(storage, 'cortex', 'aimeat-old-own', { ownerName: 'alice', isOperator: false })).toBeNull();
        const other = emptyStorage({ holder: 'bob' });
        expect((await nodePrefixRefusal(other.storage, 'cortex', 'aimeat-old-own', { ownerName: 'alice', isOperator: false }))?.code).toBe('NAME_RESERVED');
    });
});
