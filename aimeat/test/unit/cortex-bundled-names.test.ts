/**
 * @file cortex-bundled-names.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The name of a cortex the node ships (public/cortex-bundled) identifies the node's own
 *   library (secaudit2026oct22). Apps load it from its bare address, and the app-building prompt and
 *   the library-pack registry send every app there. While the name had no record (the boot window
 *   before seeding, or after an operator removed a pack), any owner could install a cortex under it
 *   and keep it, and the seeder later skipped or refreshed that record without asking whose it was.
 *   Run against storage doubles: the functions need no server.
 * @structure installCortex and the PUT create branch refuse a shipped name to an owner and let the
 *   operator through · the seeder leaves a shipped name another account holds as it is and opens one
 *   security incident for it, once
 * @usage pnpm exec vitest run test/unit/cortex-bundled-names.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22).
 */
import { describe, it, expect } from 'vitest';
import { installCortex } from '../../src/services/cortex-lifecycle.js';
import { upsertCortex } from '../../src/routes/cortex/upsert.js';
import { seedBundledCortexes } from '../../src/services/cortex-seeder.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, CortexExtensionRecord } from '../../src/storage/interface.js';

const config = { nodeId: 'test-node', cortexMaxLibSizeKb: 512, cortexMaxInstalled: 50 } as unknown as AimeatConfig;
const alice = { ownerName: 'alice', gaii: 'alice', isOperator: false };
const operator = { ownerName: 'root', gaii: 'root', isOperator: true };

const manifest = (name: string, namespace: string) => [
    'apiVersion: cortex.aimeat.org/v1', 'kind: Extension', 'metadata:', `  name: ${name}`, `  namespace: ${namespace}`,
    'spec:', '  version: 1.1.3', '  components:', '    - type: lib', '      name: x', '      filename: x.js', '      exports: [x]',
].join('\n');

/** A node where no cortex has a record yet. */
function emptyStorage() {
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

describe('a shipped cortex name is the node\'s own', () => {
    it('installCortex refuses it to an owner while it has no record, and writes nothing', async () => {
        const { storage, writes } = emptyStorage();
        const out = await installCortex({ storage, config }, alice, { manifest: manifest('aimeat-charts', 'alice'), libs: { 'x.js': 'window.x=1' } });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.refusal.status).toBe(409);
        expect(out.refusal.code).toBe('NAME_RESERVED');
        expect(out.refusal.message).toContain('alice-aimeat-charts');
        expect(writes).toEqual([]);
    });

    it('the PUT create branch refuses it the same way', async () => {
        const { storage, writes } = emptyStorage();
        const out = await upsertCortex({ storage, config }, alice, { name: 'aimeat-charts', manifest: manifest('aimeat-charts', 'alice'), libs: { 'x.js': 'window.x=1' } });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.refusal.code).toBe('NAME_RESERVED');
        expect(writes).toEqual([]);
    });

    it('an owner\'s own name still installs, and the operator may install a shipped name', async () => {
        const own = emptyStorage();
        expect((await installCortex({ storage: own.storage, config }, alice, { manifest: manifest('alice-charts', 'alice'), libs: { 'x.js': 'window.x=1' } })).ok).toBe(true);
        const op = emptyStorage();
        expect((await installCortex({ storage: op.storage, config }, operator, { manifest: manifest('aimeat-charts', 'aimeat'), libs: { 'x.js': 'window.x=1' } })).ok).toBe(true);
    });
});

describe('the seeder and a shipped name another account holds', () => {
    function seededStorage() {
        const writes: string[] = [];
        const memory: Array<{ key: string; ownerGaii: string; value: unknown }> = [];
        const storage = {
            getCortexExtension: async (name: string) => name === 'aimeat-charts'
                ? { name, installedBy: 'mallory', version: '0.0.1', status: 'active' } : null,
            setCortexLibFile: async (name: string, file: string) => { writes.push(`lib:${name}/${file}`); },
            createCortexExtension: async (r: CortexExtensionRecord) => { writes.push(`record:${r.name}`); return r; },
            updateCortexExtension: async (name: string) => { writes.push(`update:${name}`); },
            setMemory: async (r: { key: string; ownerGaii: string; value: unknown }) => { memory.push(r); return r; },
            listAllMemory: async (opts: { prefix?: string }) => ({ items: memory.filter(m => m.key.startsWith(opts.prefix ?? '')), total: memory.length }),
        } as unknown as Storage;
        return { storage, writes, memory };
    }

    it('leaves the record and its bytes as they are, and opens one incident naming the holder', async () => {
        const { storage, writes, memory } = seededStorage();
        await seedBundledCortexes(storage, 'system@test-node', { nodeId: 'test-node' });
        expect(writes.filter(w => w.includes('aimeat-charts'))).toEqual([]);
        const incidents = memory.filter(m => m.key.startsWith('security.incident.'));
        expect(incidents).toHaveLength(1);
        expect(JSON.stringify(incidents[0].value)).toContain('mallory');
        // The other shipped packs are seeded as before.
        expect(writes).toContain('record:aimeat-input');
    });

    it('a second boot opens no second incident for the same holder', async () => {
        const { storage, memory } = seededStorage();
        await seedBundledCortexes(storage, 'system@test-node', { nodeId: 'test-node' });
        await seedBundledCortexes(storage, 'system@test-node', { nodeId: 'test-node' });
        expect(memory.filter(m => m.key.startsWith('security.incident.'))).toHaveLength(1);
    });
});
